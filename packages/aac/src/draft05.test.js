import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalDigest, jcs } from '@cigar-aac/cpb';
import { keyPairFromSeed, parseSign1, encode, Tagged, signSign1, HEADER } from '@cigar-aac/cose';
import { sealCapsule, recomputeCapsuleId, verifyCapsule, verifyCapsulePayload, verifyProducerEnvelope, SPEC_VERSION } from './index.js';

const kp = keyPairFromSeed('12'.repeat(32));
const base = () => sealCapsule({ action_id: 'action-1', action_type: 'decide', operator: 'org.example.operator', developer: 'org.example.agent/1', timestamp: '2026-10-14T12:00:00Z', keyPair: kp });
const reidentify = (c) => ({ ...c, capsule_id: canonicalDigest({ payload: c, algorithm: 'jcs', exclusionSet: ['capsule_id', 'signature', 'key_id'] }).digest });
const changed = (patch) => reidentify({ ...base().capsule, ...patch });
const check = (result, n) => result.checks.find((c) => c.id === n);
const ref = (patch = {}) => ({ type: 'org.example.artifact', digest_alg: 'SHA-256', digest: 'aa'.repeat(32), ...patch });
const backfill = (patch = {}) => ({ mode: 'backfilled', source_ref: ref(), source_asserted_at: '2026-01-01T12:00:00Z', imported_at: '2026-10-14T12:00:00Z', import_batch: 'batch-1', ...patch });

describe('AAC draft-05 identity and fail-closed declarations', () => {
  it('emits draft 5 with serialization format 4', () => {
    expect(base().capsule).toMatchObject({ spec_version: SPEC_VERSION, format_version: '4', canonicalization_id: 'jcs' });
    expect(SPEC_VERSION).toBe('draft-mih-scitt-agent-action-capsule-05');
  });
  it.each([
    { format_version: '2' }, { format_version: 4 }, { format_version: null },
    ...['jcs-n', '', 'unknown', null, 4, undefined].map((canonicalization_id) => ({ canonicalization_id })),
  ])('rejects unsupported declarations before hashing: %j', (patch) => {
    const c = { ...base().capsule, ...patch };
    if (c.canonicalization_id === undefined) delete c.canonicalization_id;
    const result = verifyCapsulePayload(c);
    expect(check(result, 1).ok).toBe(false);
    expect(result.identity).toBe(null);
    expect(() => recomputeCapsuleId(c)).toThrow();
  });
  it.each(['draft-mih-scitt-agent-action-capsule-04', 'draft-mih-scitt-agent-action-capsule-99'])('accepts format-4 capsules regardless of prose revision: %s', (spec_version) => {
    expect(verifyCapsulePayload(changed({ spec_version })).ok).toBe(true);
  });
  it('preserves every nested member, null and empty collection in the identity', () => {
    const c = changed({ extension: { z: { unlisted: null, list: [], object: {} }, a: 'retained' } });
    const { capsule_id, ...preimage } = c;
    expect(recomputeCapsuleId(c).digest).toBe(createHash('sha256').update(jcs(preimage), 'utf8').digest('hex'));
    expect(recomputeCapsuleId(c).canonical).toContain('"z":{"list":[],"object":{},"unlisted":null}');
    const removed = structuredClone(c);
    delete removed.extension.z.unlisted;
    expect(verifyCapsulePayload(removed).ok).toBe(false);
  });
  it('does not drop a root member named __proto__ during exclusion', () => {
    const c = JSON.parse(JSON.stringify(base().capsule).replace('{', '{"__proto__":{"committed":true},'));
    const identity = recomputeCapsuleId(c);
    expect(identity.canonical).toContain('"__proto__":{"committed":true}');
    delete c.__proto__;
    expect(recomputeCapsuleId(c).digest).not.toBe(identity.digest);
  });
  it('ignores only local composite envelope fields, while committing references and chain', () => {
    const c = base().capsule;
    expect(recomputeCapsuleId({ ...c, signature: 'local-envelope', key_id: 'local-key' }).digest).toBe(c.capsule_id);
    expect(recomputeCapsuleId({ ...c, references: [ref()] }).digest).not.toBe(c.capsule_id);
    expect(recomputeCapsuleId({ ...c, chain: { parent_capsule_id: 'bb'.repeat(32), relation: 'follows' } }).digest).not.toBe(c.capsule_id);
  });
  it.each([1.25, Number.MAX_SAFE_INTEGER + 1, Infinity])('rejects noninteger or unsafe JSON material %s', (value) => {
    const c = { ...base().capsule, nested: { value } };
    expect(check(verifyCapsulePayload(c), 1).ok).toBe(false);
  });
  it.each([null, [], 'not a capsule', {}, { capsule_id: 42 }])('returns structured failures for malformed input %j', (input) => {
    expect(() => verifyCapsulePayload(input)).not.toThrow();
    const result = verifyCapsulePayload(input);
    expect(result.ok).toBe(false);
    expect(result.checks.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('draft-05 effect, verdict and registry rules', () => {
  it.each(['failed', 'reverted'])('requires attestation for %s, and allows a bound failure response', (status) => {
    const effect = { type: 'send_payment', status, response_digest: 'ab'.repeat(32) };
    const c = changed({ effect, assurance: { attestation_mode: 'self_attested', effect_mode: 'dispatched_unconfirmed', ledger_mode: 'standalone' } });
    expect(check(verifyCapsulePayload(c), 5).ok).toBe(false);
    const attested = reidentify({ ...c, effect: { ...effect, effect_attestation: 'host_served_observed' } });
    expect(verifyCapsulePayload(attested).ok).toBe(true);
  });
  it.each(['planned', 'dispatched'])('forbids response_digest on %s', (status) => {
    expect(check(verifyCapsulePayload(changed({ effect: { type: 'send_payment', status, response_digest: 'aa'.repeat(32) } })), 3).ok).toBe(false);
  });
  it('forbids request_digest and attestation on a planned effect', () => {
    const result = verifyCapsulePayload(changed({ effect: { type: 'send_payment', status: 'planned', request_digest: 'aa'.repeat(32), effect_attestation: 'gate_executed' } }));
    expect(check(result, 3).ok).toBe(false);
    expect(check(result, 5).ok).toBe(false);
  });
  it.each(['blocked', 'denied', 'resolved', 'engine_failure', 'deferred'])('rejects a dispatch paired with %s', (verdict_class) => {
    const c = changed({ disposition: { decision: 'reject', approver: 'policy', human_disposed: false, verdict_class }, effect: { status: 'dispatched', type: 'send_payment', effect_attestation: 'gate_executed' } });
    expect(check(verifyCapsulePayload(c), 4).ok).toBe(false);
  });
  it('caps unknown attestation grades and reports all seven unknown registry values without rejection', () => {
    const c = changed({ disposition: { decision: 'future_decision', approver: 'policy', human_disposed: false, verdict_class: 'future_verdict' }, effect: { type: 'future_effect', irreversibility_class: 'future_irreversibility', status: 'dispatched', effect_attestation: 'future_grade' }, chain: { parent_capsule_id: base().capsule_id, relation: 'future_relation' }, references: [ref({ citation_purpose: 'future_purpose' })] });
    const result = verifyCapsulePayload(c, { store: [base().capsule, c] });
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.code === 'unknown_registry_value')).toHaveLength(7);
    expect(result.derived_assurance.effect_attestation).toBe('runtime_claimed');
  });
  it('keeps the approver enum closed and enforces human-disposition honesty', () => {
    for (const patch of [{ approver: 'robot', human_disposed: false }, { approver: 'policy', human_disposed: true }]) {
      expect(check(verifyCapsulePayload(changed({ disposition: { decision: 'accept', ...patch } })), 1).ok).toBe(false);
    }
  });
});

describe('same-stream chain, assurance and cross-stream references', () => {
  it('derives chained from its own block even when the store cannot resolve the parent', () => {
    const c = changed({ chain: { parent_capsule_id: 'ab'.repeat(32), relation: 'follows' } });
    const result = verifyCapsulePayload(c);
    expect(check(result, 6).ok).toBe(false);
    expect(result.derived_assurance.ledger_mode).toBe('chained');
  });
  it('does not require disclosure or resolution of a generic reference target', () => {
    expect(verifyCapsulePayload(changed({ references: [ref()] })).ok).toBe(true);
  });
  it('rejects references that duplicate the same-stream parent identity', () => {
    const c = changed({ chain: { parent_capsule_id: 'aa'.repeat(32), relation: 'follows' }, references: [ref()] });
    expect(check(verifyCapsulePayload(c), 1).ok).toBe(false);
  });
  it('reports unsupported anchored claims and counterparty claims as overclaims', () => {
    const c = changed({ assurance: { attestation_mode: 'anchored', ledger_mode: 'anchored', effect_mode: 'not_applicable', cross_party_rung: 'full_bilateral' } });
    const result = verifyCapsulePayload(c);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.code === 'assurance_overclaim')).toHaveLength(3);
    expect(result.derived_assurance).toMatchObject({ attestation_mode: 'self_attested', ledger_mode: 'standalone', cross_party_rung: 'unilateral_fallback' });
  });
  it('does not permit producers to seal unsupported anchored claims', () => {
    expect(() => sealCapsule({ ...base().capsule, keyPair: kp, assurance: { attestation_mode: 'anchored', ledger_mode: 'anchored', effect_mode: 'not_applicable' } })).toThrow(/overclaims/);
  });
  it('reports cross-party rungs from well-formed references and correlators', () => {
    const c = changed({ cross_party: { initiator_ref: 'ab'.repeat(32), counterparty_ref: 'cd'.repeat(32), correlator: 'exchange-1', substantive: true }, assurance: { attestation_mode: 'self_attested', effect_mode: 'not_applicable', ledger_mode: 'standalone', cross_party_rung: 'full_bilateral' } });
    expect(verifyCapsulePayload(c).derived_assurance.cross_party_rung).toBe('full_bilateral');
  });
  it('reports a later concurrent supersedes without invalidating either payload', () => {
    const parent = base().capsule;
    const one = changed({ action_id: 'one', chain: { parent_capsule_id: parent.capsule_id, relation: 'supersedes' } });
    const two = changed({ action_id: 'two', chain: { parent_capsule_id: parent.capsule_id, relation: 'supersedes' } });
    const result = verifyCapsulePayload(two, { store: [parent, one, two] });
    expect(result.ok).toBe(true);
    expect(result.findings).toContainEqual({ code: 'concurrent_supersedes', authoritative_capsule_id: one.capsule_id });
  });
  it('reports retention as declared, never independently attested', () => {
    const retention = { declarant: 'org.example.storage', retained_until: '2027-01-01T00:00:00Z' };
    const result = verifyCapsulePayload(changed({ references: [ref({ retention })] }));
    expect(result.ok).toBe(true);
    expect(result.declarations.retention[0]).toMatchObject({ ...retention, status: 'declared_not_attested' });
    expect(check(verifyCapsulePayload(changed({ references: [ref({ retention: { declarant: 'org.example.storage' } })] })), 1).ok).toBe(false);
  });
  it('requires an integer log index that agrees with the enclosed proof', () => {
    for (const leaf_index of ['0', -1, 1]) {
      const log_coordinates = { log_id: 'external-log', leaf_index, inclusion_proof: { leaf_index: 0 } };
      expect(check(verifyCapsulePayload(changed({ references: [ref({ log_coordinates })] })), 1).ok).toBe(false);
    }
    const log_coordinates = { log_id: 'external-log', leaf_index: 0, inclusion_proof: { leaf_index: 0 } };
    const result = verifyCapsulePayload(changed({ references: [ref({ log_coordinates })] }));
    expect(result.declarations.log_coordinates[0].status).toBe('structurally_recorded_not_verified');
  });
});

describe('backfilled provenance never launders occurrence time', () => {
  it('accepts well-formed backfills with self-attested time and an explicit cap', () => {
    const result = verifyCapsulePayload(changed({ provenance_mode: backfill() }));
    expect(result.ok).toBe(true);
    expect(result.provenance).toEqual({ mode: 'backfilled', derived_time_rung: 'self_attested', log_witnessed_occurrence_time: false });
  });
  it.each(['source_ref', 'source_asserted_at', 'import_batch', 'imported_at'])('requires %s on a backfill', (field) => {
    const p = backfill(); delete p[field];
    expect(check(verifyCapsulePayload(changed({ provenance_mode: p })), 9).ok).toBe(false);
  });
  it('rejects import-time equality and uncorroborated witnessed occurrence time', () => {
    for (const patch of [{ imported_at: '2026-01-01T12:00:00Z' }, { time_rung: 'witnessed' }]) {
      expect(check(verifyCapsulePayload(changed({ provenance_mode: backfill(patch) })), 9).ok).toBe(false);
    }
  });
  it('keeps source-time corroboration separate from custody and log-witnessed time', () => {
    const c = changed({ provenance_mode: backfill({ time_rung: 'witnessed' }), references: [ref({ citation_purpose: 'corroborates_source_time' })] });
    const result = verifyCapsulePayload(c);
    expect(result.ok).toBe(true);
    expect(result.provenance).toMatchObject({ derived_time_rung: 'witnessed', log_witnessed_occurrence_time: false });
    expect(result.derived_assurance.attestation_mode).toBe('self_attested');
  });
});

describe('Producer Envelopes are independent and malformed envelopes never throw', () => {
  it('verifies bare payloads without requiring an envelope', () => {
    expect(verifyCapsule({ capsule: base().capsule }).ok).toBe(true);
  });
  it('returns failures for malformed wrapper input, references and envelope collections', () => {
    for (const input of [null, { capsule: { ...base().capsule, references: [null] } }, { capsule: base().capsule, producer_envelopes: {} }]) {
      expect(() => verifyCapsule(input)).not.toThrow();
      expect(verifyCapsule(input).ok).toBe(false);
    }
  });
  it('returns authenticated public keys separately from authorization', () => {
    expect(verifyProducerEnvelope(base().capsule_id, base().cose_sign1_b64)).toMatchObject({ ok: true, authenticated_public_key: kp.rawPublicKey.toString('hex'), authorization: 'not_evaluated' });
  });
  it.each(['not base64!', '', null, 'AA=='])('handles malformed envelope %s', (envelope) => {
    expect(() => verifyProducerEnvelope(base().capsule_id, envelope)).not.toThrow();
    expect(verifyProducerEnvelope(base().capsule_id, envelope).ok).toBe(false);
  });
  it('requires tag 18 and an actual empty unprotected map', () => {
    const sealed = base();
    const p = parseSign1(Buffer.from(sealed.cose_sign1_b64, 'base64'));
    for (const wire of [encode([p.protectedBytes, new Map(), p.payload, p.signature]), encode(new Tagged(18, [p.protectedBytes, [], p.payload, p.signature]))]) {
      expect(verifyProducerEnvelope(sealed.capsule_id, wire.toString('base64')).ok).toBe(false);
    }
  });
  it('rejects a valid signature over hex text instead of the raw 32-byte ID', () => {
    const sealed = base();
    const wrong = signSign1({ protectedHeader: { [HEADER.alg]: -8, [HEADER.content_type]: 'application/agent-action-capsule-id', [HEADER.kid]: kp.rawPublicKey }, payload: Buffer.from(sealed.capsule_id), privateKey: kp.privateKey });
    expect(verifyProducerEnvelope(sealed.capsule_id, wrong.bytes.toString('base64')).ok).toBe(false);
  });
  it('retains a good independent envelope and payload result when another envelope is invalid', () => {
    const sealed = base();
    const result = verifyCapsule({ capsule: sealed.capsule, producer_envelopes: ['AA==', sealed.cose_sign1_b64] });
    expect(result.payload.ok).toBe(true);
    expect(result.envelopes.map((e) => e.ok)).toEqual([false, true]);
    expect(result.envelopes[1].authenticated_public_key).toBe(kp.rawPublicKey.toString('hex'));
  });
});
