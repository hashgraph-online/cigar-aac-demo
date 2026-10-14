import { describe, it, expect } from 'vitest';
import { keyPairFromSeed, parseSign1, verifySign1, HEADER } from '@cigar-aac/cose';
import { verifyTypedRef, jcs } from '@cigar-aac/cpb';
import { sealCapsule, who, can, did, audit, recomputeCapsuleId, verifyCapsule } from './seal.js';
import { assertCapsuleInvariants, InvariantViolation } from './invariants.js';
import { FORMAT_VERSION, CAPSULE_ID_MEDIA_TYPE, VERDICT_CLASS } from './enums.js';

const kp = keyPairFromSeed('12'.repeat(32));
const TS = '2026-09-21T14:32:07Z';

/** The recipient-bound CIGAR handoff, produced by the runtime and merely cited. */
const HANDOFF = Object.freeze({
  handoff_id: 'ho-7731',
  recipient: 'ap-settlement-agent',
  task: 'settle_approved_invoice',
  capabilities: ['payments:dispatch'],
  budget: { amount_max: '50000.00', currency: 'EUR' },
  expiry: '2026-09-21T18:00:00Z',
  issuer_signature: 'ed25519:8f3a2c1d0b',
});

const base = (overrides = {}) => ({
  action_id: 'act-INV-2026-0918',
  action_type: 'decide',
  operator: 'northwind-industrial',
  developer: 'ap-settlement-agent/2.4.1',
  timestamp: TS,
  keyPair: kp,
  ...overrides,
});

const fullMembers = () => [
  who({ principal: 'treasury-ops', agent: 'ap-settlement-agent/2.4.1', on_behalf_of: 'northwind-industrial' }),
  can(HANDOFF, 'cigar-signed-handoff'),
  did({ effect_type: 'send_payment', request_digest: 'aa'.repeat(32), response_digest: 'bb'.repeat(32) }),
  audit({ verdict_class: 'executed', timestamp: TS, withheld: ['vendor_bank_account'] }),
];

describe('seal() produces a format-4 capsule', () => {
  const sealed = sealCapsule(base({ members: fullMembers() }));

  it('declares the profile version, format and canonicalization', () => {
    expect(sealed.capsule.format_version).toBe(FORMAT_VERSION);
    expect(sealed.capsule.canonicalization_id).toBe('jcs');
    expect(sealed.capsule.spec_version).toMatch(/agent-action-capsule/);
  });

  it('names itself: capsule_id is 64 lowercase hex and recomputes', () => {
    expect(sealed.capsule_id).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputeCapsuleId(sealed.capsule).digest).toBe(sealed.capsule_id);
  });

  it('excludes capsule_id from its own preimage', () => {
    expect(sealed.digest_context.exclusion_set).toEqual(['capsule_id', 'signature', 'key_id']);
    expect(sealed.canonical).not.toContain('capsule_id');
  });

  it('is deterministic for the same inputs', () => {
    expect(sealCapsule(base({ members: fullMembers() })).capsule_id).toBe(sealed.capsule_id);
  });

  it('signs the raw 32 bytes of capsule_id, not its hex string', () => {
    const parsed = parseSign1(Buffer.from(sealed.cose_sign1_b64, 'base64'));
    expect(parsed.payload).toHaveLength(32);
    expect(parsed.payload.toString('hex')).toBe(sealed.capsule_id);
  });

  it('uses the producer envelope the profile specifies', () => {
    const parsed = parseSign1(Buffer.from(sealed.cose_sign1_b64, 'base64'));
    expect(parsed.protectedHeader.size).toBe(3);
    expect(parsed.protectedHeader.get(HEADER.alg)).toBe(-8);
    expect(parsed.protectedHeader.get(HEADER.content_type)).toBe(CAPSULE_ID_MEDIA_TYPE);
    expect(parsed.protectedHeader.get(HEADER.kid).toString('hex')).toBe(kp.rawPublicKey.toString('hex'));
    expect(parsed.unprotected.size).toBe(0);
  });

  it('verifies under the key its own kid names', () => {
    expect(verifySign1(Buffer.from(sealed.cose_sign1_b64, 'base64')).ok).toBe(true);
  });

  it('references all four slots rather than inlining them', () => {
    expect(sealed.capsule.references.map((r) => r.slot).sort()).toEqual(['audit', 'can', 'did', 'who']);
    for (const ref of sealed.capsule.references) {
      expect(ref.digest_alg).toBe('SHA-256');
      expect(ref.digest).toMatch(/^[0-9a-f]{64}$/);
    }
    // The capsule itself must not carry the member contents.
    expect(jcs(sealed.capsule)).not.toContain('treasury-ops');
    expect(jcs(sealed.capsule)).not.toContain('50000.00');
  });

  it('stays small regardless of how large the referenced artifacts are', () => {
    const big = { ...HANDOFF, notes: 'x'.repeat(50000) };
    const withBig = sealCapsule(base({ members: [can(big, 'cigar-signed-handoff')] }));
    expect(jcs(withBig.capsule).length).toBeLessThan(900);
  });
});

describe('the CAN member is cited byte-identically, never re-minted', () => {
  it('leaves the handoff object untouched', () => {
    const before = jcs(HANDOFF);
    sealCapsule(base({ members: [can(HANDOFF, 'cigar-signed-handoff')] }));
    expect(jcs(HANDOFF)).toBe(before);
  });

  it('resolves against the original artifact with no transformation', () => {
    // The brief's authority-mapping question, answered concretely: a
    // recipient-bound handoff is consumed as CAN without re-signing.
    const sealed = sealCapsule(base({ members: [can(HANDOFF, 'cigar-signed-handoff')] }));
    const ref = sealed.capsule.references.find((r) => r.slot === 'can');
    expect(verifyTypedRef(ref, HANDOFF).ok).toBe(true);
  });

  it('preserves the foreign signature inside the cited artifact', () => {
    const sealed = sealCapsule(base({ members: [can(HANDOFF, 'cigar-signed-handoff')] }));
    const member = sealed.members.find((m) => m.slot === 'can');
    expect(member.artifact.issuer_signature).toBe('ed25519:8f3a2c1d0b');
    // Nothing was excluded from the handoff's digest: it is bound as transmitted.
    expect(member.canonical).toContain('issuer_signature');
  });

  it('fails if the artifact is altered after sealing', () => {
    const sealed = sealCapsule(base({ members: [can(HANDOFF, 'cigar-signed-handoff')] }));
    const ref = sealed.capsule.references.find((r) => r.slot === 'can');
    const raised = { ...HANDOFF, budget: { amount_max: '500000.00', currency: 'EUR' } };
    const result = verifyTypedRef(ref, raised);
    expect(result.ok).toBe(false);
    expect(result.expected).not.toBe(result.actual);
  });
});

describe('invariant I-1 — a dispatched attempt is not a completed action', () => {
  it('refuses to seal confirmed without a response_digest', () => {
    expect(() =>
      sealCapsule(
        base({
          effect: { status: 'confirmed', type: 'send_payment', effect_attestation: 'gate_executed' },
        }),
      ),
    ).toThrow(InvariantViolation);
  });

  it('names I-1 in the error', () => {
    try {
      assertCapsuleInvariants({
        spec_version: 'x', format_version: '4', canonicalization_id: 'jcs',
        action_id: 'a', action_type: 'decide', operator: 'o', developer: 'd', timestamp: TS,
        effect: { status: 'confirmed', type: 'send_payment', effect_attestation: 'gate_executed' },
        assurance: { attestation_mode: 'self_attested', effect_mode: 'dispatched_unconfirmed', ledger_mode: 'standalone' },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('I-1');
      expect(e.message).toMatch(/must not be presented as an observed completion/);
    }
  });

  it('allows dispatched with no response_digest — the honest UNKNOWN shape', () => {
    const sealed = sealCapsule(
      base({
        effect: {
          status: 'dispatched',
          type: 'send_payment',
          effect_attestation: 'gate_executed',
          irreversibility_class: 'one_way_consequential',
        },
        assurance: { attestation_mode: 'self_attested', effect_mode: 'dispatched_unconfirmed', ledger_mode: 'standalone' },
        disposition: { decision: 'accept', approver: 'policy', human_disposed: false, verdict_class: 'timeout' },
      }),
    );
    expect(sealed.capsule.effect.status).toBe('dispatched');
    expect(sealed.capsule.effect.response_digest).toBeUndefined();
    expect(sealed.capsule.assurance.effect_mode).toBe('dispatched_unconfirmed');
  });

  it('allows confirmed once a response has actually been observed', () => {
    const sealed = sealCapsule(
      base({
        effect: {
          status: 'confirmed',
          type: 'send_payment',
          effect_attestation: 'gate_executed',
          response_digest: 'cc'.repeat(32),
        },
        assurance: { attestation_mode: 'self_attested', effect_mode: 'confirmed', ledger_mode: 'standalone' },
      }),
    );
    expect(sealed.capsule.effect.response_digest).toHaveLength(64);
  });

  it('refuses a response_digest on a status that has observed nothing', () => {
    expect(() =>
      sealCapsule(
        base({
          effect: {
            status: 'dispatched', type: 'send_payment',
            effect_attestation: 'gate_executed', response_digest: 'cc'.repeat(32),
          },
        }),
      ),
    ).toThrow(/only meaningful for an observed result/);
  });

  it('refuses effect_attestation while an effect is merely planned', () => {
    expect(() =>
      sealCapsule(base({ effect: { status: 'planned', type: 'send_payment', effect_attestation: 'gate_executed' } })),
    ).toThrow(/must be absent while the effect is only planned/);
  });

  it('requires effect_attestation once dispatched', () => {
    expect(() => sealCapsule(base({ effect: { status: 'dispatched', type: 'send_payment' } }))).toThrow(
      /required once status is "dispatched"/,
    );
  });
});

describe('invariant I-2 — a policy decision is not a human one', () => {
  it('refuses human_disposed true with a policy approver', () => {
    expect(() =>
      sealCapsule(base({ disposition: { decision: 'accept', approver: 'policy', human_disposed: true } })),
    ).toThrow(InvariantViolation);
  });

  it('names I-2 and explains why', () => {
    try {
      sealCapsule(base({ disposition: { decision: 'accept', approver: 'counterparty', human_disposed: true } }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.code).toBe('I-2');
      expect(e.message).toMatch(/must not be recorded as a human one/);
    }
  });

  it('allows human_disposed true with a human approver', () => {
    const sealed = sealCapsule(
      base({ disposition: { decision: 'accept', approver: 'human', human_disposed: true } }),
    );
    expect(sealed.capsule.disposition.human_disposed).toBe(true);
  });

  it('allows a policy approver that does not claim a human', () => {
    const sealed = sealCapsule(
      base({ disposition: { decision: 'reject', approver: 'policy', human_disposed: false, verdict_class: 'blocked' } }),
    );
    expect(sealed.capsule.disposition.verdict_class).toBe('blocked');
  });
});

describe('closed enums and coherence', () => {
  it('reports an unknown registry verdict as informational', () => {
    const sealed = sealCapsule(base({ disposition: {
      decision: 'accept', approver: 'policy', human_disposed: false, verdict_class: 'org.example.probably_fine',
    } }));
    const result = verifyCapsule(sealed);
    expect(result.ok).toBe(true);
    expect(result.payload.findings).toContainEqual({ code: 'unknown_registry_value', field: 'disposition.verdict_class', value: 'org.example.probably_fine' });
  });

  it('accepts every verdict_class in the published vocabulary', () => {
    for (const vc of VERDICT_CLASS) {
      const sealed = sealCapsule(
        base({ disposition: { decision: 'accept', approver: 'policy', human_disposed: false, verdict_class: vc },
          ...(vc === 'errored' ? { effect: { status: 'dispatched', type: 'send_payment', effect_attestation: 'gate_executed' } } : {}),
        }),
      );
      expect(sealed.capsule.disposition.verdict_class).toBe(vc);
    }
  });

  it('rejects an action_type outside fyi | decide', () => {
    expect(() => sealCapsule(base({ action_type: 'yolo' }))).toThrow(/action_type must be one of/);
  });

  it('rejects a non-UTC timestamp', () => {
    expect(() => sealCapsule(base({ timestamp: '2026-09-21T14:32:07+02:00' }))).toThrow(/RFC 3339 UTC/);
  });

  it('rejects an assurance summary that contradicts the effect it describes', () => {
    expect(() =>
      sealCapsule(
        base({
          effect: { status: 'dispatched', type: 'send_payment', effect_attestation: 'gate_executed' },
          assurance: { attestation_mode: 'self_attested', effect_mode: 'confirmed', ledger_mode: 'standalone' },
        }),
      ),
    ).toThrow(/contradicts effect.status/);
  });

  it('rejects an assurance claiming an effect when none is recorded', () => {
    expect(() =>
      sealCapsule(
        base({ assurance: { attestation_mode: 'self_attested', effect_mode: 'confirmed', ledger_mode: 'standalone' } }),
      ),
    ).toThrow(/records no effect/);
  });

  it('refuses to seal a member carrying a binary float where money belongs', () => {
    expect(() => can({ budget: { amount_max: 50000.5 } }, 'cigar-signed-handoff')).toThrow(
      /exact decimal strings/,
    );
  });
});

describe('verifyCapsule', () => {
  const sealed = sealCapsule(base({ members: fullMembers() }));
  const artifacts = Object.fromEntries(sealed.members.map((m) => [m.slot, m.artifact]));

  it('passes on a clean capsule with all members supplied', () => {
    const result = verifyCapsule({ ...sealed, memberArtifacts: artifacts });
    expect(result.ok).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(8);
  });

  it('fails the self-naming check when a field is edited after sealing', () => {
    const tampered = { ...sealed.capsule, operator: 'someone-else' };
    const result = verifyCapsule({ ...sealed, capsule: tampered, memberArtifacts: artifacts });
    expect(result.ok).toBe(false);
    const step = result.steps.find((s) => s.name.includes('recomputes'));
    expect(step.ok).toBe(false);
    expect(step.computed).not.toBe(step.expected);
  });

  it('fails when the capsule_id is edited to match a forged record', () => {
    // Changing the id too does not help: the signature covers the id.
    const forgedRecord = { ...sealed.capsule, operator: 'someone-else' };
    const forgedId = recomputeCapsuleId(forgedRecord).digest;
    const result = verifyCapsule({
      ...sealed,
      capsule: { ...forgedRecord, capsule_id: forgedId },
      memberArtifacts: artifacts,
    });
    expect(result.steps.find((s) => s.name.includes('recomputes')).ok).toBe(true);
    expect(result.steps.find((s) => s.name.includes('producer signature')).ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('fails when a member artifact is swapped', () => {
    const result = verifyCapsule({
      ...sealed,
      memberArtifacts: { ...artifacts, can: { ...HANDOFF, budget: { amount_max: '999999.00', currency: 'EUR' } } },
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.name.includes('slot "can"')).ok).toBe(false);
  });

  it('reports a missing member artifact rather than silently passing', () => {
    const { can: _omitted, ...withoutCan } = artifacts;
    const result = verifyCapsule({ ...sealed, memberArtifacts: withoutCan });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.name.includes('slot "can"')).detail).toMatch(/no artifact supplied/);
  });

  it('labels demo-local proposed artifact types', () => {
    const result = verifyCapsule({ ...sealed, memberArtifacts: artifacts });
    expect(result.steps.find((s) => s.name.includes('slot "can"')).proposed).toBe(true);
  });

  it('records what was deliberately withheld', () => {
    const auditMember = sealed.members.find((m) => m.slot === 'audit');
    expect(auditMember.artifact.withheld).toContain('vendor_bank_account');
    // And the withheld value itself never appears in the capsule.
    expect(jcs(sealed.capsule)).not.toContain('vendor_bank_account');
  });
});
