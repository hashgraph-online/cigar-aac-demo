import { canonicalDigest } from '@cigar-aac/cpb';
import { parseSign1, verifySign1, HEADER, ALG } from '@cigar-aac/cose';
import { CAPSULE_ID_MEDIA_TYPE } from './enums.js';
import {
  assertCapsuleStructure, assertEffectBinding, assertVerdictEffect,
  assertEffectAttestation, assertProvenance, deriveEffectMode,
  registryFindings, isDigest, isObject,
} from './invariants.js';

/** Draft-05 §2 and §5.1: no digest is computed for an unsupported declaration. */
export function capsuleIdentity(c) {
  assertCapsuleStructure(c);
  return canonicalDigest({ payload: c, algorithm: 'jcs', exclusionSet: ['capsule_id', 'signature', 'key_id'] });
}

/** The bare Producer Envelope is independent of Class 1 payload validity. */
export function verifyProducerEnvelope(capsuleId, envelope) {
  try {
    if (!isDigest(capsuleId)) throw new Error('capsule_id is not a lowercase SHA-256 identifier');
    if (typeof envelope !== 'string' || !envelope.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope)) throw new Error('envelope must be base64-encoded COSE_Sign1');
    const bytes = Buffer.from(envelope, 'base64');
    const p = parseSign1(bytes);
    const kid = p.protectedHeader.get(HEADER.kid);
    const shape = p.tag === 18 && Buffer.isBuffer(p.protectedBytes) && p.protectedHeader instanceof Map
      && p.protectedHeader.size === 3 && p.protectedHeader.get(HEADER.alg) === ALG.EdDSA
      && p.protectedHeader.get(HEADER.content_type) === CAPSULE_ID_MEDIA_TYPE
      && Buffer.isBuffer(kid) && kid.length === 32
      && p.unprotectedIsMap && p.unprotected.size === 0
      && Buffer.isBuffer(p.payload) && p.payload.length === 32
      && Buffer.isBuffer(p.signature) && p.signature.length === 64;
    if (!shape) throw new Error('Producer Envelope requires tag 18, exactly three protected entries, empty unprotected map, 32-byte payload/key and 64-byte signature');
    if (p.payload.toString('hex') !== capsuleId) throw new Error('signature covers a different capsule_id');
    const sig = verifySign1(bytes);
    if (!sig.ok) throw new Error(sig.reason);
    return { ok: true, reason: null, authenticated_public_key: sig.kid, kid: sig.kid, signed_bytes: sig.signedBytes, authorization: 'not_evaluated' };
  } catch (error) {
    return { ok: false, reason: error.message, authenticated_public_key: null, authorization: 'not_evaluated' };
  }
}

export function deriveAssurance(c) {
  const cross = c?.cross_party;
  const counterparty = isDigest(cross?.counterparty_ref) && typeof cross?.correlator === 'string' && cross.correlator.length > 0;
  return {
    // This demo carries checkpoint receipts, not per-Capsule RFC 9943 registration
    // statements under externally trusted keys. Neither is an AAC anchored grade.
    attestation_mode: 'self_attested',
    effect_mode: deriveEffectMode(c ?? {}),
    ledger_mode: isDigest(c?.chain?.parent_capsule_id) && typeof c.chain.relation === 'string' && c.chain.relation.length ? 'chained' : 'standalone',
    cross_party_rung: !counterparty ? 'unilateral_fallback' : cross.substantive === true ? 'full_bilateral' : 'acknowledged_receipt',
    effect_attestation: !c?.effect || c.effect.status === 'planned' ? null
      : c.effect.effect_attestation === 'gate_executed' ? 'gate_executed' : 'runtime_claimed',
  };
}

/** Draft-05 §6: fixed-order payload checks, no models, clock or network. */
export function verifyCapsulePayload(capsule, { store = [] } = {}) {
  const checks = [];
  const findings = [];
  const run = (id, name, fn) => {
    try {
      const extra = fn() ?? {};
      checks.push({ id, name, ok: true, detail: 'passes', ...extra });
    } catch (error) { checks.push({ id, name, ok: false, detail: error.message, code: error.code ?? 'MALFORMED' }); }
  };
  run(1, 'structural declarations and JSON types', () => assertCapsuleStructure(capsule, { requireId: true }));
  const structurallyValid = checks[0].ok;
  let identity;
  run(2, 'capsule_id recomputes from the record', () => {
    if (!structurallyValid) throw new Error('identity not computed: structural declarations or JSON types are invalid');
    identity = capsuleIdentity(capsule);
    if (identity.digest !== capsule.capsule_id) throw new Error(`record hashes to ${identity.digest} but claims ${capsule.capsule_id}`);
    return { detail: `${identity.preimageBytes} bytes under plain JCS`, computed: identity.digest, canonical: identity.canonical };
  });
  checks[1].expected = capsule?.capsule_id;
  checks[1].computed = identity?.digest;
  run(3, 'confirmed-effect binding', () => assertEffectBinding(capsule));
  run(4, 'verdict/effect orthogonality', () => assertVerdictEffect(capsule));
  run(5, 'effect-attestation matrix', () => assertEffectAttestation(capsule));
  run(6, 'chain semantics', () => {
    if (!capsule?.chain) return { detail: 'no same-stream parent claimed' };
    const records = store.map((x) => x?.capsule ?? x);
    const parent = records.find((c) => c?.capsule_id === capsule.chain.parent_capsule_id);
    if (!parent) throw new Error('chain parent is absent from the supplied store');
    assertCapsuleStructure(parent, { requireId: true });
    if (capsuleIdentity(parent).digest !== parent.capsule_id || parent.operator !== capsule.operator) throw new Error('chain parent identity or operator does not match the same custody stream');
    const childIndex = records.findIndex((c) => c?.capsule_id === capsule.capsule_id);
    const parentIndex = records.indexOf(parent);
    if (childIndex >= 0 && parentIndex >= childIndex) throw new Error('chain parent must precede its child in ledger order');
    const siblings = records.filter((c) => c?.chain?.relation === 'supersedes' && c.chain.parent_capsule_id === parent.capsule_id);
    if (capsule.chain.relation === 'supersedes' && siblings.length > 1 && siblings[0].capsule_id !== capsule.capsule_id) findings.push({ code: 'concurrent_supersedes', authoritative_capsule_id: siblings[0].capsule_id });
    return { detail: `parent identity checked; relation ${capsule.chain.relation}` };
  });
  let derived;
  run(7, 'assurance reconciliation', () => {
    if (!structurallyValid) throw new Error('assurance unavailable: malformed Capsule');
    derived = deriveAssurance(capsule);
    const tiers = { attestation_mode: ['self_attested', 'anchored'], effect_mode: ['not_applicable', 'dispatched_unconfirmed', 'confirmed'], ledger_mode: ['standalone', 'chained', 'anchored'], cross_party_rung: ['unilateral_fallback', 'acknowledged_receipt', 'full_bilateral'] };
    for (const [field, order] of Object.entries(tiers)) {
      if (order.indexOf(capsule.assurance[field]) > order.indexOf(derived[field])) findings.push({ code: 'assurance_overclaim', field, claimed: capsule.assurance[field], derived: derived[field] });
    }
    return { detail: 'derived from this Capsule and the supported evidence; checkpoint receipts do not confer AAC anchored status', derived };
  });
  run(8, 'registry findings', () => {
    if (!structurallyValid) return { detail: 'not evaluated: malformed Capsule' };
    findings.push(...registryFindings(capsule));
    return { detail: 'unknown registry values are informational, never a rejection' };
  });
  run(9, 'provenance mode', () => assertProvenance(capsule));
  const provenance = isObject(capsule?.provenance_mode) ? {
    mode: capsule.provenance_mode.mode,
    derived_time_rung: checks[8].ok && capsule.provenance_mode.mode === 'backfilled' && capsule.provenance_mode.time_rung === 'witnessed' ? 'witnessed' : 'self_attested',
    log_witnessed_occurrence_time: false,
  } : null;
  return {
    ok: checks.every((c) => c.ok), checks, findings, derived_assurance: derived ?? null, provenance,
    identity: identity ?? null,
    declarations: {
      retention: (Array.isArray(capsule?.references) ? capsule.references : []).filter((r) => r?.retention).map((r) => ({ digest_alg: r.digest_alg, digest: r.digest, ...r.retention, status: 'declared_not_attested' })),
      log_coordinates: (Array.isArray(capsule?.references) ? capsule.references : []).filter((r) => r?.log_coordinates).map((r) => ({ digest: r.digest, ...r.log_coordinates, status: 'structurally_recorded_not_verified' })),
    },
  };
}
