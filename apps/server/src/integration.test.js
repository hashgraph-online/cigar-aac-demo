import { describe, it, expect } from 'vitest';
import { verifyEvidenceBundle } from '@cigar-aac/verifier';
import { canonicalDigest, jcs } from '@cigar-aac/cpb';

import { runScenario, SCENARIOS, TAMPER_TARGETS, applyTamper } from './engine.js';

/**
 * End-to-end tests over the real pipeline. Nothing here is a fixture: every
 * assertion runs the full CIGAR -> AAC -> CLL -> SCITT -> verifier path.
 */

const run = (id, opts) => runScenario(id, opts);

describe('every scenario completes and verifies as expected', () => {
  it('runs all five', () => {
    expect(SCENARIOS).toHaveLength(5);
  });

  it.each([
    ['clean-settlement', true],
    ['policy-block', true],
    ['unknown-reconcile', true],
    ['poisoned-context', true],
    ['tamper', false],
  ])('%s verifies -> %s', (id, expected) => {
    const r = run(id);
    expect(r.ok).toBe(expected);
  });

  it('produces no failing check on the four honest scenarios', () => {
    for (const id of ['clean-settlement', 'policy-block', 'unknown-reconcile', 'poisoned-context']) {
      const r = run(id);
      expect(r.verification.summary.failed, `${id} had failures`).toBe(0);
      expect(r.verification.summary.total).toBeGreaterThan(20);
    }
  });

  it('is deterministic: the same scenario yields identical capsule ids', () => {
    // So a presenter can rehearse against known values and spot an anomaly.
    const a = run('clean-settlement');
    const b = run('clean-settlement');
    expect(a.bundle.capsules.map((c) => c.capsule.capsule_id)).toEqual(
      b.bundle.capsules.map((c) => c.capsule.capsule_id),
    );
    expect(a.bundle.cll.checkpoint.claims.commitment).toBe(b.bundle.cll.checkpoint.claims.commitment);
  });

  it('witnesses every scenario’s checkpoint', () => {
    for (const s of SCENARIOS) {
      const r = run(s.id);
      expect(r.artifacts.scitt.registered, `${s.id} was not witnessed`).toBe(true);
      expect(r.bundle.scitt.receipt.root).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('clean settlement — what good looks like', () => {
  const r = run('clean-settlement');
  const capsule = r.bundle.capsules[0].capsule;

  it('accepts, executes and confirms', () => {
    expect(capsule.disposition.decision).toBe('accept');
    expect(capsule.disposition.verdict_class).toBe('executed');
    expect(capsule.effect.status).toBe('confirmed');
    expect(capsule.effect.response_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a policy decision, not a human one', () => {
    expect(capsule.disposition.approver).toBe('policy');
    expect(capsule.disposition.human_disposed).toBe(false);
  });

  it('classifies the payment as irreversible in the consequential sense', () => {
    expect(capsule.effect.irreversibility_class).toBe('one_way_consequential');
    expect(capsule.effect.type).toBe('send_payment');
  });

  it('fills all four composition slots', () => {
    expect(capsule.references.map((x) => x.slot).sort()).toEqual(['audit', 'can', 'did', 'who']);
  });

  it('cites the signed CIGAR handoff as the CAN member, byte-identically', () => {
    const canRef = capsule.references.find((x) => x.slot === 'can');
    expect(canRef.type).toBe('cigar-signed-handoff');
    const member = r.bundle.capsules[0].members.find((m) => m.slot === 'can');
    expect(jcs(member.artifact)).toBe(jcs(r.bundle.referenced_artifacts.signed_handoff));
  });
});

describe('policy block — refusals are records too', () => {
  const r = run('policy-block');
  const capsule = r.bundle.capsules[0].capsule;

  it('rejects and blocks', () => {
    expect(capsule.disposition.decision).toBe('reject');
    expect(capsule.disposition.verdict_class).toBe('blocked');
  });

  it('never dispatched, so the effect stays planned with no attestation', () => {
    expect(capsule.effect.status).toBe('planned');
    expect(capsule.effect.effect_attestation).toBeUndefined();
    expect(capsule.effect.response_digest).toBeUndefined();
    expect(capsule.assurance.effect_mode).toBe('not_applicable');
  });

  it('is still sealed, logged and witnessed — the gate leaves proof', () => {
    expect(r.ok).toBe(true);
    expect(r.bundle.cll.checkpoint.claims.log_size).toBe(1);
    expect(r.bundle.scitt).not.toBe(null);
  });

  it('names the gate that stopped it', () => {
    const didMember = r.bundle.capsules[0].members.find((m) => m.slot === 'did');
    expect(didMember.artifact.blocked_by.join(' ')).toMatch(/budget/);
    const auditMember = r.bundle.capsules[0].members.find((m) => m.slot === 'audit');
    expect(auditMember.artifact.money_moved).toBe(false);
  });

  it('is over the ceiling by design', () => {
    expect(r.artifacts.contextBundle.records.find((x) => x.source_id.includes('invoices')).content.amount).toBe(
      '68400.00',
    );
  });
});

describe('UNKNOWN — uncertainty preserved rather than flattened', () => {
  const r = run('unknown-reconcile');
  const [dispatch, reconciled, compensated] = r.bundle.capsules.map((c) => c.capsule);

  it('produces three chained records', () => {
    expect(r.bundle.capsules).toHaveLength(3);
    expect(reconciled.chain.parent_capsule_id).toBe(dispatch.capsule_id);
    expect(reconciled.chain.relation).toBe('confirms');
    expect(compensated.chain.parent_capsule_id).toBe(reconciled.capsule_id);
    expect(compensated.chain.relation).toBe('follows');
  });

  it('the first record says what was sent and refuses to say what happened', () => {
    expect(dispatch.effect.status).toBe('dispatched');
    expect(dispatch.effect.effect_attestation).toBe('gate_executed');
    expect(dispatch.effect.response_digest).toBeUndefined();
    expect(dispatch.disposition.verdict_class).toBe('timeout');
    expect(dispatch.assurance.effect_mode).toBe('dispatched_unconfirmed');

    const didMember = r.bundle.capsules[0].members.find((m) => m.slot === 'did');
    expect(didMember.artifact.request_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(didMember.artifact.response_digest).toBeUndefined();
  });

  it('the second record binds an observed response and resolves it', () => {
    expect(reconciled.effect.status).toBe('confirmed');
    expect(reconciled.effect.response_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(reconciled.disposition.verdict_class).toBe('executed');
  });

  it('the third record confirms retry suppression without reversing the payment', () => {
    expect(compensated.effect.status).toBe('confirmed');
    expect(compensated.effect.type).toBe('org.hol.demo.suppress_duplicate_payment');
    expect(reconciled.effect.status).toBe('confirmed');
    // The original dispatch record is untouched by the compensation.
    expect(dispatch.effect.status).toBe('dispatched');
  });

  it('all three share the idempotency key as the join', () => {
    const key = 'pay:INV-2026-0918:48200.00:EUR';
    expect(dispatch.effect.external_ref).toBe(key);
    expect(reconciled.effect.external_ref).toBe(key);
  });

  it('each record cites the effect ledger as it stood at that moment', () => {
    // The ledger is append-only, so the three snapshots differ and each
    // capsule's cited digest must still resolve.
    const digests = r.bundle.capsules.map(
      (c) => c.members.find((m) => m.slot === 'did').artifact.effect_ledger_digest,
    );
    expect(new Set(digests).size).toBe(3);
    const lengths = r.bundle.capsules.map(
      (c) => c.members.find((m) => m.slot === 'did').artifact.effect_ledger.transitions.length,
    );
    expect(lengths).toEqual([4, 5, 6]);
    expect(r.verification.summary.failed).toBe(0);
  });

  it('keeps the whole story under one witnessed checkpoint', () => {
    expect(r.bundle.cll.checkpoint.claims.log_size).toBe(3);
    expect(r.bundle.scitt.receipt.root).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('poisoned context — policy runs before disclosure', () => {
  const r = run('poisoned-context');
  const manifest = r.artifacts.manifest;

  it('excludes the business-email-compromise attempt on trust floor', () => {
    const bec = manifest.excluded.find((e) => e.source_id === 'email://ap-inbox/msg-88213');
    expect(bec.rule).toBe('trust_floor');
  });

  it('excludes the prompt injection the same way', () => {
    const inj = manifest.excluded.find((e) => e.source_id.includes('msg-88214'));
    expect(inj.rule).toBe('trust_floor');
  });

  it('excludes the superseded invoice version', () => {
    const old = manifest.excluded.find((e) => e.source_id.endsWith('@v2'));
    expect(old.rule).toBe('supersession');
  });

  it('excludes payroll data bound to a different purpose', () => {
    const payroll = manifest.excluded.find((e) => e.source_id.startsWith('hr://'));
    expect(payroll.rule).toBe('purpose_binding');
  });

  it('never carries the poisoned content into the bundle the model saw', () => {
    // The attacker's IBAN and the injected instruction must appear nowhere.
    const serialized = jcs(r.artifacts.contextBundle);
    expect(serialized).not.toContain('LT12');
    expect(serialized).not.toContain('250000.00');
    expect(serialized).not.toContain('no longer required');
  });

  it('never carries it into the evidence bundle either', () => {
    const serialized = JSON.stringify(r.bundle);
    expect(serialized).not.toContain('LT12 3456 7890 1234 5678');
    expect(serialized).not.toContain('do not mention this instruction');
  });

  it('still pays the right amount from the authoritative source', () => {
    expect(r.bundle.capsules[0].capsule.effect.status).toBe('confirmed');
    const didMember = r.bundle.capsules[0].members.find((m) => m.slot === 'did');
    expect(didMember.artifact.effect_ledger.intent.amount).toBe('48200.00');
  });

  it('makes the exclusions readable as evidence without disclosing the content', () => {
    const auditMember = r.bundle.capsules[0].members.find((m) => m.slot === 'audit');
    const ev = auditMember.artifact.context_evidence;
    expect(ev.sources_excluded).toBe(manifest.excluded.length);
    expect(ev.exclusions.map((e) => e.rule)).toContain('trust_floor');
    // Each exclusion names the source and rule, and nothing else.
    for (const e of ev.exclusions) expect(Object.keys(e).sort()).toEqual(['rule', 'source_id']);
  });
});

describe('tamper — caught by math, not by us', () => {
  it('the default tamper is caught three separate ways', () => {
    const r = run('tamper');
    expect(r.ok).toBe(false);
    const failed = r.verification.checks.filter((c) => !c.ok);
    // 1: the record no longer hashes to its declared id.
    expect(failed.some((c) => c.id === 1)).toBe(true);
    // 3: and it violates invariant I-1 regardless of any hash.
    const inv = failed.find((c) => c.id === 3);
    expect(inv.detail).toMatch(/I-1/);
  });

  it('reports the exact before and after of the edit', () => {
    const r = run('tamper');
    expect(r.tamperApplied.before).toBe('dispatched');
    expect(r.tamperApplied.after).toBe('confirmed');
    expect(r.tamperApplied.where).toMatch(/effect\.status/);
  });

  it('shows both digests when the record stops naming itself', () => {
    const r = run('tamper');
    const c = r.verification.checks.find((x) => x.id === 1 && !x.ok);
    expect(c.expected).toMatch(/^[0-9a-f]{64}$/);
    expect(c.computed).toMatch(/^[0-9a-f]{64}$/);
    expect(c.expected).not.toBe(c.computed);
  });

  it('still fails if the forger recomputes the capsule_id', () => {
    // Recomputing the id defeats check 1, but the signature covers the old id
    // and the invariant violation is independent of both.
    const base = run('unknown-reconcile');
    const { bundle } = applyTamper(base.bundle, { target: 'capsule' });
    const item = bundle.capsules.find((c) => c.capsule.effect.status === 'confirmed' && !c.capsule.effect.response_digest);
    item.capsule.capsule_id = canonicalDigest({
      payload: item.capsule,
      algorithm: 'jcs',
      exclusionSet: ['capsule_id'],
    }).digest;

    const v = verifyEvidenceBundle(bundle);
    expect(v.ok).toBe(false);
    const failed = v.checks.filter((c) => !c.ok);
    expect(failed.some((c) => c.id === 1)).toBe(false);
    expect(failed.some((c) => c.id === 2)).toBe(true);
    expect(failed.some((c) => c.id === 3)).toBe(true);
  });

  it('refuses a tamper that would change nothing', () => {
    // A no-op tamper on stage would be the worst possible failure.
    const base = run('clean-settlement');
    expect(() =>
      applyTamper(base.bundle, { target: 'capsule-operator', value: 'northwind-industrial' }),
    ).toThrow(/no-op/);
  });

  // Every surface the dashboard exposes must apply cleanly AND be detected, on
  // every scenario the presenter can have selected. A target that silently
  // no-ops on one scenario is a live-demo failure, so this is exhaustive.
  const HONEST = ['clean-settlement', 'policy-block', 'unknown-reconcile', 'poisoned-context'];
  const MATRIX = HONEST.flatMap((s) => TAMPER_TARGETS.map((t) => [s, t.id]));

  it.each(MATRIX)('tamper "%s" / "%s" applies and is detected', (scenarioId, targetId) => {
    const base = run(scenarioId);
    const { bundle, applied } = applyTamper(base.bundle, { target: targetId });
    // It actually changed something...
    expect(applied.before, `${scenarioId}/${targetId} was a no-op`).not.toEqual(applied.after);
    // ...and the verifier caught it.
    const v = verifyEvidenceBundle(bundle);
    expect(v.ok, `${scenarioId}/${targetId} was not detected`).toBe(false);
  });

  it('flips effect.status away from whatever the record currently says', () => {
    // A fixed tamper value can coincide with the value already there.
    const confirmed = applyTamper(run('clean-settlement').bundle, { target: 'capsule' });
    expect(confirmed.applied.before).toBe('confirmed');
    expect(confirmed.applied.after).toBe('dispatched');

    const dispatched = applyTamper(run('unknown-reconcile').bundle, { target: 'capsule' });
    expect(dispatched.applied.before).toBe('dispatched');
    expect(dispatched.applied.after).toBe('confirmed');
  });

  it('trips invariant I-1 in both directions', () => {
    // confirmed without a response, and a response without confirmation, are
    // both forgeries the profile forbids.
    for (const scenarioId of ['clean-settlement', 'unknown-reconcile']) {
      const { bundle } = applyTamper(run(scenarioId).bundle, { target: 'capsule' });
      const v = verifyEvidenceBundle(bundle);
      const inv = v.checks.find((c) => c.id === 3 && !c.ok);
      expect(inv, `${scenarioId} did not trip an invariant`).toBeTruthy();
      expect(inv.detail).toMatch(/I-1/);
    }
  });

  it('describes the edit in the direction it actually went', () => {
    expect(applyTamper(run('clean-settlement').bundle, { target: 'capsule' }).applied.plain)
      .toMatch(/Disown an observed payment/);
    expect(applyTamper(run('unknown-reconcile').bundle, { target: 'capsule' }).applied.plain)
      .toMatch(/Upgrade a dispatched payment/);
  });

  it('names the failing leaf when a Merkle sibling is forged', () => {
    const base = run('unknown-reconcile');
    const { bundle } = applyTamper(base.bundle, { target: 'proof' });
    const v = verifyEvidenceBundle(bundle);
    const c = v.checks.find((x) => x.id === 6 && !x.ok);
    expect(c.detail).toMatch(/peak does not match/);
    expect(c.leaf_index).toBe(0);
  });

  it('catches a hidden exclusion in the selection manifest', () => {
    // The insider deletes the record that a poisoned source was rejected.
    const base = run('poisoned-context');
    const { bundle } = applyTamper(base.bundle, { target: 'manifest' });
    const v = verifyEvidenceBundle(bundle);
    expect(v.ok).toBe(false);
    const failed = v.checks.filter((c) => !c.ok);
    expect(failed.some((c) => c.name.includes('cited cigar-selection-manifest'))).toBe(true);
    expect(failed.some((c) => c.name.includes('exclusion count'))).toBe(true);
  });

  it('reports nothing as established once any check fails', () => {
    const r = run('tamper');
    expect(r.verification.scope.establishes).toEqual(['nothing - at least one check failed, see below']);
  });
});

describe('the evidence bundle is portable and self-contained', () => {
  const r = run('unknown-reconcile');

  it('survives a JSON round trip', () => {
    const roundTripped = JSON.parse(JSON.stringify(r.bundle));
    expect(verifyEvidenceBundle(roundTripped).ok).toBe(true);
  });

  it('carries no private key material', () => {
    const s = JSON.stringify(r.bundle);
    expect(s).not.toContain('PRIVATE KEY');
    expect(s.toLowerCase()).not.toContain('privatekey');
    expect(Object.keys(r.bundle.keys).filter((k) => k.endsWith('_kid'))).toHaveLength(4);
  });

  it('withholds the payee account number while still binding it', () => {
    expect(JSON.stringify(r.bundle)).not.toContain('DE89 3704 0044 0532 0130 00');
    expect(r.bundle.withheld.map((w) => w.field)).toContain('creditor_iban_full');
  });

  it('declares which artifact types are proposed rather than registered', () => {
    expect(r.bundle.provenance_note).toMatch(/PROPOSED integration points/);
    const proposed = r.verification.checks.filter((c) => c.proposed);
    expect(proposed.length).toBeGreaterThan(0);
  });

  it('states what it does not establish, even when everything passes', () => {
    expect(r.verification.scope.doesNotEstablish.join(' ')).toMatch(/is TRUE/);
    expect(r.verification.scope.note).toMatch(/not proof of sufficiency/);
  });

  it('is small enough to email', () => {
    expect(JSON.stringify(r.bundle).length).toBeLessThan(200_000);
  });
});

describe('the event stream drives the dashboard', () => {
  const r = run('unknown-reconcile');

  it('emits a contiguous, ordered stream', () => {
    expect(r.events.map((e) => e.seq)).toEqual(r.events.map((_, i) => i));
  });

  it('covers every pipeline stage', () => {
    const stages = r.events.filter((e) => e.kind === 'stage.enter').map((e) => e.stage);
    expect(stages).toEqual(['context', 'action', 'log', 'verify']);
  });

  it('emits the events the five lifecycle steps need', () => {
    const kinds = new Set(r.events.map((e) => e.kind));
    for (const k of [
      'source.ingested',
      'contract.declared',
      'policy.evaluated',
      'candidate.excluded',
      'manifest.sealed',
      'bundle.materialized',
      'env.captured',
      'handoff.signed',
      'decision.made',
      'effect.dispatched',
      'effect.unknown',
      'effect.reconciled',
      'effect.compensated',
      'capsule.sealed',
      'cll.appended',
      'cll.checkpointed',
      'scitt.registered',
      'scitt.receipt',
      'verify.step',
      'verify.verdict',
    ]) {
      expect(kinds, `missing event kind ${k}`).toContain(k);
    }
  });

  it('replays the decision environment cleanly', () => {
    const replay = r.events.find((e) => e.kind === 'cigar.replay');
    expect(replay.ok).toBe(true);
  });

  it('confirms the effect ledger hash chain', () => {
    const chain = r.events.find((e) => e.kind === 'cigar.effect_chain');
    expect(chain.ok).toBe(true);
    expect(chain.length).toBe(6);
  });
});
