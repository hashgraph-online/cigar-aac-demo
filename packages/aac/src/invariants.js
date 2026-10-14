import {
  ACTION_TYPE, APPROVER, ATTESTATION_MODE, CROSS_PARTY_RUNG, DECISION,
  EFFECT_ATTESTATION, EFFECT_MODE, EFFECT_STATUS, EFFECT_TYPE,
  IRREVERSIBILITY_CLASS, LEDGER_MODE, VERDICT_CLASS, CHAIN_RELATION,
  CITATION_PURPOSE, NEVER_DISPATCH,
} from './enums.js';

export class InvariantViolation extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'InvariantViolation';
    this.code = code;
  }
}
const fail = (code, message) => { throw new InvariantViolation(code, message); };
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isDigest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const text = (v, field) => {
  if (typeof v !== 'string' || v.length === 0) fail('TYPE', `${field} must be a nonempty string`);
};
const object = (v, field) => { if (!isObject(v)) fail('TYPE', `${field} must be an object`); };
const inEnum = (value, allowed, field) => {
  if (!allowed.includes(value)) fail('ENUM', `${field} must be one of [${allowed.join(', ')}], got ${JSON.stringify(value)}`);
};
const digest = (v, field) => { if (!isDigest(v)) fail('DIGEST', `${field} must be 64 lowercase hexadecimal characters`); };
const timestamp = (v, field, utc = false) => {
  const suffix = utc ? 'Z' : '(?:Z|[+-]\\d{2}:\\d{2})';
  const match = typeof v === 'string' && new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?' + suffix + '$').exec(v);
  if (!match || !Number.isFinite(Date.parse(v))) fail('TIMESTAMP', `${field} must be RFC 3339${utc ? ' UTC with a Z offset' : ''}`);
  const [, y, m, d, h, min, sec] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate() || h > 23 || min > 59 || sec > 59) {
    fail('TIMESTAMP', `${field} has invalid calendar components`);
  }
};

/** Digest-bearing AAC material is JSON, with only safe integer numbers. */
export function assertDigestMaterial(value, path = '') {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    fail('NUMBER', `${path || '/'} carries a floating-point or unsafe integer value; use exact decimal strings`);
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (Array.isArray(value)) { value.forEach((v, i) => assertDigestMaterial(v, `${path}/${i}`)); return; }
  if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail('TYPE', `${path || '/'} is not a JSON value`);
  }
  for (const [key, v] of Object.entries(value)) assertDigestMaterial(v, `${path}/${key}`);
}

/** Check declarations BEFORE choosing any digest algorithm. spec_version is informational. */
export function assertCapsuleStructure(c, { requireId = false } = {}) {
  object(c, 'capsule');
  for (const field of ['spec_version', 'format_version', 'canonicalization_id', 'action_id', 'action_type', 'operator', 'developer', 'timestamp']) {
    if (c[field] === undefined || c[field] === null) fail('REQUIRED', `${field} is required`);
    text(c[field], field);
  }
  if (c.format_version !== '4' || c.canonicalization_id !== 'jcs') {
    fail('FORMAT', 'AAC draft-05 requires format_version "4" and canonicalization_id "jcs"');
  }
  // signature/key_id belong to a local composite envelope, not the Capsule preimage.
  const { signature, key_id, ...payload } = c;
  assertDigestMaterial(payload);
  if (requireId || c.capsule_id !== undefined) digest(c.capsule_id, 'capsule_id');
  inEnum(c.action_type, ACTION_TYPE, 'action_type');
  timestamp(c.timestamp, 'timestamp', true);
  if (c.epoch_id !== undefined) text(c.epoch_id, 'epoch_id');
  const d = c.disposition;
  if (d !== undefined) {
    object(d, 'disposition');
    text(d.decision, 'disposition.decision');
    inEnum(d.approver, APPROVER, 'disposition.approver');
    if (typeof d.human_disposed !== 'boolean') fail('TYPE', 'disposition.human_disposed must be a boolean');
    if (d.human_disposed && d.approver !== 'human') fail('I-2', `human_disposed is true but approver is "${d.approver}" — a non-human decision must not be recorded as a human one`);
    if (d.verdict_class !== undefined) text(d.verdict_class, 'disposition.verdict_class');
    if (d.reason_digest !== undefined) digest(d.reason_digest, 'disposition.reason_digest');
    if (d.authority !== undefined) text(d.authority, 'disposition.authority');
    if (d.expiry_policy !== undefined) {
      object(d.expiry_policy, 'disposition.expiry_policy');
      if (!Number.isSafeInteger(d.expiry_policy.ttl_seconds) || d.expiry_policy.ttl_seconds < 0) fail('TYPE', 'expiry_policy.ttl_seconds must be a nonnegative integer');
      inEnum(d.expiry_policy.on_expiry, ['expired', 'escalated'], 'expiry_policy.on_expiry');
    }
  }
  if (c.effect !== undefined) {
    object(c.effect, 'effect');
    inEnum(c.effect.status, EFFECT_STATUS, 'effect.status');
    text(c.effect.type, 'effect.type');
    for (const field of ['request_digest', 'response_digest', 'agent_input_digest', 'agent_output_digest']) {
      if (c.effect[field] !== undefined) digest(c.effect[field], `effect.${field}`);
    }
    if (c.effect.irreversibility_class !== undefined) text(c.effect.irreversibility_class, 'effect.irreversibility_class');
    if (c.effect.effect_attestation !== undefined) text(c.effect.effect_attestation, 'effect.effect_attestation');
  }
  object(c.assurance, 'assurance');
  inEnum(c.assurance.attestation_mode, ATTESTATION_MODE, 'assurance.attestation_mode');
  inEnum(c.assurance.effect_mode, EFFECT_MODE, 'assurance.effect_mode');
  inEnum(c.assurance.ledger_mode, LEDGER_MODE, 'assurance.ledger_mode');
  if (c.assurance.cross_party_rung !== undefined) inEnum(c.assurance.cross_party_rung, CROSS_PARTY_RUNG, 'assurance.cross_party_rung');
  if (c.chain !== undefined) {
    object(c.chain, 'chain');
    digest(c.chain.parent_capsule_id, 'chain.parent_capsule_id');
    text(c.chain.relation, 'chain.relation');
    if (c.chain.parent_capsule_id === c.capsule_id) fail('CHAIN', 'a Capsule cannot be its own chain parent');
  }
  if (c.references !== undefined) {
    if (!Array.isArray(c.references)) fail('TYPE', 'references must be an array');
    for (const [i, ref] of c.references.entries()) {
      assertReference(ref, `references[${i}]`);
      if (ref.digest === c.chain?.parent_capsule_id && ref.digest_alg === 'SHA-256') fail('REFERENCE', 'references must not duplicate chain.parent_capsule_id');
    }
  }
  if (c.cross_party !== undefined) {
    object(c.cross_party, 'cross_party');
    digest(c.cross_party.initiator_ref, 'cross_party.initiator_ref');
    if (c.assurance.cross_party_rung === undefined) fail('REQUIRED', 'assurance.cross_party_rung is required with cross_party');
    if (c.cross_party.substantive !== undefined && typeof c.cross_party.substantive !== 'boolean') fail('TYPE', 'cross_party.substantive must be boolean');
  }
}

export function assertReference(ref, field = 'reference') {
  object(ref, field);
  text(ref.type, `${field}.type`);
  text(ref.digest_alg, `${field}.digest_alg`);
  text(ref.digest, `${field}.digest`);
  if (ref.digest_alg === 'SHA-256') digest(ref.digest, `${field}.digest`);
  if (ref.citation_purpose !== undefined) text(ref.citation_purpose, `${field}.citation_purpose`);
  if (ref.retention !== undefined) {
    object(ref.retention, `${field}.retention`);
    text(ref.retention.declarant, `${field}.retention.declarant`);
    if (ref.retention.retained_until === undefined && ref.retention.not_retained_after === undefined) fail('RETENTION', 'retention requires retained_until or not_retained_after');
    for (const key of ['retained_until', 'not_retained_after']) if (ref.retention[key] !== undefined) timestamp(ref.retention[key], `${field}.retention.${key}`);
  }
  if (ref.log_coordinates !== undefined) {
    const l = ref.log_coordinates;
    object(l, `${field}.log_coordinates`);
    text(l.log_id, `${field}.log_coordinates.log_id`);
    if (!Number.isSafeInteger(l.leaf_index) || l.leaf_index < 0) fail('LOG_INDEX', 'log_coordinates.leaf_index must be a zero-based JSON integer');
    object(l.inclusion_proof, `${field}.log_coordinates.inclusion_proof`);
    if (l.inclusion_proof.leaf_index !== l.leaf_index) fail('LOG_INDEX', 'log_coordinates.leaf_index must agree with inclusion_proof.leaf_index');
  }
}

export function deriveEffectMode(c) {
  const e = c.effect;
  if (!e || e.status === 'planned') return 'not_applicable';
  return e.status === 'confirmed' && isDigest(e.response_digest) ? 'confirmed' : 'dispatched_unconfirmed';
}
export function assertEffectBinding(c) {
  const e = c.effect;
  if (!e) return;
  if (e.status === 'confirmed' && !isDigest(e.response_digest)) fail('I-1', 'effect.status is "confirmed" but there is no well-formed response_digest — a dispatched attempt must not be presented as an observed completion');
  if (['planned', 'dispatched'].includes(e.status) && e.response_digest !== undefined) fail('I-1', 'response_digest is only meaningful for an observed result, not planned or dispatched');
  if (e.status === 'planned' && e.request_digest !== undefined) fail('I-1', 'a planned effect must not carry request_digest');
}
export function assertVerdictEffect(c) {
  const mode = deriveEffectMode(c);
  const vc = c.disposition?.verdict_class;
  if (NEVER_DISPATCH.includes(vc) && mode !== 'not_applicable') fail('ORTHOGONALITY', `verdict_class "${vc}" never dispatches and requires effect_mode "not_applicable"`);
  if (vc === 'errored' && mode !== 'dispatched_unconfirmed') fail('ORTHOGONALITY', 'errored requires dispatched_unconfirmed');
}
export function assertEffectAttestation(c) {
  const e = c.effect;
  if (!e) return;
  if (e.status === 'planned' && e.effect_attestation !== undefined) fail('ATTESTATION', 'effect_attestation must be absent while the effect is only planned');
  if (e.status !== 'planned' && e.effect_attestation === undefined) fail('ATTESTATION', `effect_attestation is required once status is "${e.status}"`);
}
export function assertProvenance(c) {
  const p = c.provenance_mode;
  if (p === undefined) return;
  object(p, 'provenance_mode');
  inEnum(p.mode, ['contemporaneous', 'backfilled'], 'provenance_mode.mode');
  if (p.mode === 'contemporaneous') {
    if (p.time_rung !== undefined) fail('PROVENANCE', 'time_rung must be absent unless mode is backfilled');
    return;
  }
  assertReference(p.source_ref, 'provenance_mode.source_ref');
  timestamp(p.source_asserted_at, 'provenance_mode.source_asserted_at');
  timestamp(p.imported_at, 'provenance_mode.imported_at');
  text(p.import_batch, 'provenance_mode.import_batch');
  if (p.source_asserted_at === p.imported_at) fail('PROVENANCE', 'backfilled imported_at must not equal source_asserted_at');
  if (p.time_rung !== undefined) inEnum(p.time_rung, ['self_attested', 'witnessed'], 'provenance_mode.time_rung');
  if (p.time_rung === 'witnessed' && !(c.references ?? []).some((r) => r.citation_purpose === 'corroborates_source_time')) fail('PROVENANCE', 'witnessed source time requires a corroborates_source_time reference');
}

/** Seven registries are open; unknown values never change the acceptance verdict. */
export function registryFindings(c) {
  const out = [];
  const add = (value, known, field) => { if (value !== undefined && !known.includes(value)) out.push({ code: 'unknown_registry_value', field, value }); };
  add(c.spec_version, ['draft-mih-scitt-agent-action-capsule-04', 'draft-mih-scitt-agent-action-capsule-05'], 'spec_version');
  add(c.disposition?.decision, DECISION, 'disposition.decision');
  add(c.disposition?.verdict_class, VERDICT_CLASS, 'disposition.verdict_class');
  add(c.effect?.type, EFFECT_TYPE, 'effect.type');
  add(c.effect?.irreversibility_class, IRREVERSIBILITY_CLASS, 'effect.irreversibility_class');
  add(c.effect?.effect_attestation, EFFECT_ATTESTATION, 'effect.effect_attestation');
  add(c.chain?.relation, CHAIN_RELATION, 'chain.relation');
  for (const [i, ref] of (c.references ?? []).entries()) add(ref.citation_purpose, CITATION_PURPOSE, `references[${i}].citation_purpose`);
  return out;
}

/** Construction-time checks; arbitrary external bytes are checked independently. */
export function assertCapsuleInvariants(c) {
  assertCapsuleStructure(c);
  assertEffectBinding(c);
  assertVerdictEffect(c);
  assertEffectAttestation(c);
  assertProvenance(c);
  const expected = deriveEffectMode(c);
  if (c.assurance.effect_mode !== expected) fail('COHERENCE', c.effect
    ? `assurance.effect_mode "${c.assurance.effect_mode}" contradicts effect.status "${c.effect.status}" (expected "${expected}")`
    : `assurance.effect_mode is "${c.assurance.effect_mode}" but the capsule records no effect`);
  return true;
}
export function checkCapsuleInvariants(c) {
  try { assertCapsuleInvariants(c); return { ok: true, code: null, reason: null }; }
  catch (e) { return { ok: false, code: e.code ?? 'STRUCTURE', reason: e.message }; }
}
