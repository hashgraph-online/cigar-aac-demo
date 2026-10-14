import { typedRef, verifyTypedRef, digestForType, findFloatingPointNumbers, idBytes, jcs } from '@cigar-aac/cpb';
import { signSign1, HEADER, ALG } from '@cigar-aac/cose';
import { assertCapsuleInvariants, assertDigestMaterial, registryFindings } from './invariants.js';
import { capsuleIdentity, deriveAssurance, verifyCapsulePayload, verifyProducerEnvelope } from './profile.js';
import {
  SPEC_VERSION,
  FORMAT_VERSION,
  CAPSULE_ID_MEDIA_TYPE,
  CAPSULE_MEDIA_TYPE,
  SLOT,
} from './enums.js';

/**
 * seal(who, can, did, audit) — one capsule, four slots.
 *
 * The composition rule that makes this worth doing: a member already produced
 * elsewhere is CITED BYTE-IDENTICALLY, never re-minted. This function never
 * rewrites, reformats or re-signs a member artifact; it only computes that
 * artifact's digest under the digest context its registered type pins, and
 * records a typed reference.
 *
 * That is the concrete answer to the AAIF brief's question "Can a recipient-
 * bound CIGAR handoff be consumed directly as a CAN member without re-signing
 * or re-minting it?" — yes, and the verifier resolves it without ever seeing
 * the runtime that produced it.
 */

/** Build a slot member: a typed reference plus the artifact it names. */
function member(slot, type, artifact) {
  if (!SLOT.includes(slot)) throw new Error(`unknown slot "${slot}"`);

  // Monetary and quantity values must be exact decimal strings; refuse a
  // member that carries a binary float anywhere in it.
  const floats = findFloatingPointNumbers(artifact);
  if (floats.length) {
    throw new Error(
      `member "${slot}" carries JSON floating-point value(s) at ` +
        `${floats.map((f) => f.path).join(', ')} — monetary and quantity values ` +
        'must be exact decimal strings',
    );
  }

  assertDigestMaterial(artifact);
  const ref = typedRef(type, artifact, { slot });
  const { canonical } = digestForType(type, artifact);
  return { slot, type, ref, artifact, canonical };
}

export const who = (artifact, type = 'aac-who') => member('who', type, artifact);
export const can = (artifact, type) => member('can', type, artifact);
export const did = (artifact, type = 'aac-did') => member('did', type, artifact);
export const audit = (artifact, type = 'aac-audit') => member('audit', type, artifact);

/**
 * Seal a capsule.
 *
 * @param {object} o
 * @param {object[]} o.members results of who()/can()/did()/audit()
 * @param {object} o.keyPair  { privateKey, rawPublicKey }
 * @returns {object} the sealed capsule plus everything needed to verify it
 */
export function sealCapsule({
  action_id,
  action_type,
  operator,
  developer,
  timestamp,
  epoch_id = null,
  disposition = null,
  effect = null,
  assurance = null,
  chain = null,
  cross_party = null,
  provenance_mode = null,
  references: additionalReferences = [],
  members = [],
  keyPair,
  canonicalizationId = 'jcs',
}) {
  const references = [...members.map((m) => m.ref), ...additionalReferences];

  // Build the record. Members are referenced, never inlined — the capsule
  // stays small and content-private, and the artifacts stay where they were.
  const record = {
    spec_version: SPEC_VERSION,
    format_version: FORMAT_VERSION,
    canonicalization_id: canonicalizationId,
    action_id,
    action_type,
    operator,
    developer,
    timestamp,
  };
  if (epoch_id) record.epoch_id = epoch_id;
  if (disposition) record.disposition = disposition;
  if (effect) record.effect = effect;
  record.assurance = assurance ?? deriveAssurance({ effect, chain, cross_party });
  // effect_attestation is a derived report field, not part of assurance.
  if (!assurance) delete record.assurance.effect_attestation;
  if (chain) record.chain = chain;
  if (references.length) record.references = references;
  if (cross_party) record.cross_party = cross_party;
  if (provenance_mode) record.provenance_mode = provenance_mode;

  // Enforce the profile invariants before anything is signed. A violating
  // capsule is never produced, so it can never be presented as evidence.
  assertCapsuleInvariants(record);
  for (const finding of registryFindings(record)) {
    if (finding.field !== 'spec_version' && !/^(?:[a-z][a-z0-9+.-]*:|(?:[\w-]+\.)+[\w-]+)/i.test(finding.value)) {
      throw new Error(`${finding.field}: producer-defined registry values must be namespaced with a URI or reverse-DNS prefix`);
    }
  }
  const supported = deriveAssurance(record);
  for (const [field, order] of Object.entries({
    attestation_mode: ['self_attested', 'anchored'],
    ledger_mode: ['standalone', 'chained', 'anchored'],
    cross_party_rung: ['unilateral_fallback', 'acknowledged_receipt', 'full_bilateral'],
  })) {
    if (order.indexOf(record.assurance[field]) > order.indexOf(supported[field])) {
      throw new Error(`assurance.${field} overclaims the evidence available at seal time`);
    }
  }

  // capsule_id over the record with capsule_id itself excluded — it cannot be
  // inside the preimage it helps compute.
  const derivation = capsuleIdentity(record);
  const capsule = { ...record, capsule_id: derivation.digest };

  // Producer envelope: COSE_Sign1 over the RAW 32 BYTES of capsule_id, with a
  // protected header of exactly three entries.
  const payload = idBytes(derivation.digest);
  const { bytes, protectedBytes, signature } = signSign1({
    protectedHeader: {
      [HEADER.alg]: ALG.EdDSA,
      [HEADER.content_type]: CAPSULE_ID_MEDIA_TYPE,
      [HEADER.kid]: keyPair.rawPublicKey,
    },
    payload,
    privateKey: keyPair.privateKey,
  });

  return {
    capsule,
    capsule_id: derivation.digest,
    canonical: derivation.canonical,
    digest_context: {
      algorithm: derivation.algorithm,
      exclusion_set: derivation.exclusionSet,
      preimage_bytes: derivation.preimageBytes,
    },
    media_type: CAPSULE_MEDIA_TYPE,
    cose_sign1_b64: bytes.toString('base64'),
    cose: {
      protected_hex: protectedBytes.toString('hex'),
      signature_hex: signature.toString('hex'),
      payload_hex: payload.toString('hex'),
      kid_hex: keyPair.rawPublicKey.toString('hex'),
      alg: 'EdDSA (-8)',
      content_type: CAPSULE_ID_MEDIA_TYPE,
      bytes: bytes.length,
    },
    /** The member artifacts, kept alongside so a bundle can carry them. */
    members: members.map((m) => ({
      slot: m.slot,
      type: m.type,
      ref: m.ref,
      artifact: m.artifact,
      canonical: m.canonical,
    })),
  };
}

/**
 * Recompute a capsule_id from a capsule record.
 * The verifier's first question: does this record actually name itself?
 */
export function recomputeCapsuleId(capsule) {
  return capsuleIdentity(capsule);
}

/** Payload and each envelope are reported independently; composition is demo-local. */
export function verifyCapsule(input = {}) {
  const { capsule, cose_sign1_b64, producer_envelopes, memberArtifacts = {}, store = [] } = input ?? {};
  const payload = verifyCapsulePayload(capsule, { store });
  const steps = payload.checks.map((step) => ({ ...step }));
  const supplied = producer_envelopes ?? (cose_sign1_b64 === undefined ? [] : [cose_sign1_b64]);
  const envelopes = Array.isArray(supplied)
    ? supplied.map((envelope) => verifyProducerEnvelope(capsule?.capsule_id, envelope))
    : [{ ok: false, reason: 'producer_envelopes must be an array', authenticated_public_key: null }];
  for (const [i, result] of envelopes.entries()) steps.push({
    name: `producer signature over the capsule_id (${i + 1})`, ok: result.ok,
    detail: result.reason ?? `Ed25519, kid ${result.authenticated_public_key}`,
  });
  for (const ref of Array.isArray(capsule?.references) ? capsule.references : []) {
    if (!ref?.slot) continue; // Generic cross-stream citations need not be disclosed.
    const artifact = memberArtifacts?.[ref.slot];
    if (artifact === undefined) {
      steps.push({ name: `slot "${ref.slot}" member artifact present`, ok: false,
        detail: `no artifact supplied for slot "${ref.slot}" (type ${ref.type})` });
      continue;
    }
    try {
      const result = verifyTypedRef(ref, artifact);
      steps.push({ name: `slot "${ref.slot}" resolves (${ref.type})`, ok: result.ok,
        detail: result.ok ? `${ref.digest} under ${result.context.algorithm}` : result.reason,
        expected: result.expected, computed: result.actual, proposed: result.context.proposed });
    } catch (error) {
      steps.push({ name: `slot "${ref.slot}" resolves (${ref.type})`, ok: false, detail: error.message });
    }
  }
  return { ok: steps.every((s) => s.ok), steps, payload, envelopes };
}

export { jcs };
