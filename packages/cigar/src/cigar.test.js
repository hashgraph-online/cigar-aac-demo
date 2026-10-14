import { describe, it, expect } from 'vitest';
import { keyPairFromSeed } from '@cigar-aac/cose';
import { digestForType, jcs } from '@cigar-aac/cpb';
import { meetsFloor, authorityRank, evaluateContract, screenSource } from './policy.js';
import { ingest, compileContext, replay } from './compile.js';
import { intersectAuthority, issueHandoff, authorizeEffect } from './handoff.js';
import { EffectLedger, verifyEffectChain } from './effects.js';

let tick = 0;
const now = () => new Date(Date.UTC(2026, 8, 21, 14, 0, tick++)).toISOString();
const reset = () => { tick = 0; };

const kp = keyPairFromSeed('34'.repeat(32));

const GOVERNANCE = {
  allowedPurposes: ['settle_approved_invoice', 'reconcile_payments'],
  principals: {
    'treasury-ops': { purposes: ['settle_approved_invoice', 'reconcile_payments'] },
    'marketing-ops': { purposes: [] },
  },
};

const SOURCES = [
  {
    source_id: 'erp://invoices/INV-2026-0918',
    subject: 'invoice:INV-2026-0918',
    record_type: 'claim',
    authority: 'system-of-record',
    verification_state: 'verified',
    valid_from: '2026-09-18T00:00:00Z',
    token_cost: 400,
    content: { invoice: 'INV-2026-0918', amount: '48200.00', currency: 'EUR', version: 3 },
  },
  {
    source_id: 'erp://invoices/INV-2026-0918@v2',
    subject: 'invoice:INV-2026-0918',
    record_type: 'claim',
    authority: 'system-of-record',
    verification_state: 'verified',
    superseded_by: ['erp://invoices/INV-2026-0918'],
    token_cost: 400,
    content: { invoice: 'INV-2026-0918', amount: '52900.00', currency: 'EUR', version: 2 },
  },
  {
    source_id: 'email://ap-inbox/msg-88213',
    subject: 'vendor:meridian',
    record_type: 'claim',
    authority: 'unverified',
    verification_state: 'unverified',
    token_cost: 300,
    content: { subject: 'URGENT: updated bank details', iban: 'LT12 3456 7890 1234 5678' },
  },
  {
    source_id: 'policy://treasury/payment-authority',
    record_type: 'instruction',
    authority: 'governance',
    verification_state: 'verified',
    token_cost: 500,
    content: { ceiling: '50000.00', currency: 'EUR', requires: ['goods_receipt'] },
  },
  {
    source_id: 'erp://goods-receipt/GR-55021',
    record_type: 'evidence',
    evidence_kind: 'goods_receipt',
    authority: 'system-of-record',
    verification_state: 'verified',
    token_cost: 200,
    content: { receipt: 'GR-55021', received: '2026-09-19' },
  },
  {
    source_id: 'erp://vendors/meridian-components',
    record_type: 'evidence',
    evidence_kind: 'vendor_bank_verification',
    authority: 'system-of-record',
    verification_state: 'verified',
    valid_to: '2026-11-02T00:00:00Z',
    token_cost: 250,
    transform: { name: 'redact_account_tail', note: 'last 4 digits only' },
    content: { vendor: 'Meridian Components GmbH', iban_tail: '3000', verified_at: '2026-08-02' },
  },
];

const CONTRACT = {
  contract_id: 'cc-8812',
  task: 'Settle approved invoice INV-2026-0918',
  purpose: 'settle_approved_invoice',
  principal: 'treasury-ops',
  project: 'ap-automation',
  consumer: 'ap-settlement-agent',
  required_evidence: ['goods_receipt', 'vendor_bank_verification'],
  trust_floor: 'system-of-record',
  budget: { max_records: 6, max_tokens: 8000 },
  as_of: '2026-09-21T14:00:00Z',
};

const compile = (contract = CONTRACT, sources = SOURCES) => {
  reset();
  const snapshot = ingest(sources, { now });
  const result = compileContext({ contract, snapshot, governance: GOVERNANCE, now });
  return { snapshot, ...result };
};

describe('authority tiers and the trust floor', () => {
  it('orders tiers from most to least authoritative', () => {
    expect(authorityRank('governance')).toBeLessThan(authorityRank('system-of-record'));
    expect(authorityRank('system-of-record')).toBeLessThan(authorityRank('unverified'));
  });

  it('admits at or above the floor and refuses below it', () => {
    expect(meetsFloor('governance', 'system-of-record')).toBe(true);
    expect(meetsFloor('system-of-record', 'system-of-record')).toBe(true);
    expect(meetsFloor('unverified', 'system-of-record')).toBe(false);
  });

  it('refuses an unknown tier rather than defaulting it', () => {
    expect(() => authorityRank('probably-fine')).toThrow(/unknown authority tier/);
  });
});

describe('the context contract is evaluated before retrieval', () => {
  it('accepts a well-formed contract from an authorized principal', () => {
    expect(evaluateContract(CONTRACT, GOVERNANCE).ok).toBe(true);
  });

  it('refuses a principal not authorized for the purpose', () => {
    const v = evaluateContract({ ...CONTRACT, principal: 'marketing-ops' }, GOVERNANCE);
    expect(v.ok).toBe(false);
    expect(v.decisions.find((d) => d.name.includes('authorized for this purpose')).ok).toBe(false);
  });

  it('refuses an unrecognized purpose', () => {
    expect(evaluateContract({ ...CONTRACT, purpose: 'exfiltrate' }, GOVERNANCE).ok).toBe(false);
  });

  it('refuses an unbounded budget', () => {
    const v = evaluateContract({ ...CONTRACT, budget: { max_records: 0, max_tokens: 0 } }, GOVERNANCE);
    expect(v.ok).toBe(false);
  });

  it('stops the whole compile before any source is screened', () => {
    const result = compile({ ...CONTRACT, principal: 'marketing-ops' });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('contract');
    expect(result.manifest).toBeUndefined();
  });
});

describe('source screening', () => {
  const screen = (id, contract = CONTRACT) =>
    screenSource(SOURCES.find((s) => s.source_id === id), contract, SOURCES);

  it('excludes an unverified source below the trust floor', () => {
    // The poisoned "new bank details" email, kept out before retrieval.
    const v = screen('email://ap-inbox/msg-88213');
    expect(v.admit).toBe(false);
    expect(v.rule).toBe('trust_floor');
  });

  it('excludes a superseded version even though it is authentic and verified', () => {
    const v = screen('erp://invoices/INV-2026-0918@v2');
    expect(v.admit).toBe(false);
    expect(v.rule).toBe('supersession');
    expect(v.reason).toContain('erp://invoices/INV-2026-0918');
  });

  it('admits the current, verified system-of-record version', () => {
    expect(screen('erp://invoices/INV-2026-0918').admit).toBe(true);
  });

  it('excludes a source outside its validity window', () => {
    const v = screen('erp://vendors/meridian-components', { ...CONTRACT, as_of: '2027-01-01T00:00:00Z' });
    expect(v.admit).toBe(false);
    expect(v.rule).toBe('validity_window');
  });

  it('excludes protected material bound to a different purpose', () => {
    const record = {
      source_id: 'hr://salary/emp-42',
      record_type: 'claim',
      authority: 'system-of-record',
      verification_state: 'verified',
      protected_for: ['payroll_run'],
      content: {},
    };
    const v = screenSource(record, CONTRACT, [record]);
    expect(v.admit).toBe(false);
    expect(v.rule).toBe('purpose_binding');
  });

  it('always states the rule that decided, so an exclusion is itself evidence', () => {
    for (const s of SOURCES) {
      const v = screenSource(s, CONTRACT, SOURCES);
      expect(v.rule).toBeTruthy();
      expect(v.reason).toBeTruthy();
    }
  });
});

describe('the SelectionManifest', () => {
  const { manifest } = compile();

  it('records everything considered, not only what was chosen', () => {
    expect(manifest.considered).toHaveLength(SOURCES.length);
  });

  it('cites each exclusion with its rule and reason', () => {
    const poisoned = manifest.excluded.find((e) => e.source_id === 'email://ap-inbox/msg-88213');
    expect(poisoned.rule).toBe('trust_floor');
    expect(poisoned.reason).toMatch(/below the contract's trust floor/);

    const superseded = manifest.excluded.find((e) => e.source_id === 'erp://invoices/INV-2026-0918@v2');
    expect(superseded.rule).toBe('supersession');
  });

  it('confirms the contract’s required evidence was satisfied', () => {
    expect(manifest.evidence_satisfied).toBe(true);
    expect(manifest.missing_evidence).toEqual([]);
  });

  it('reports missing required evidence rather than proceeding quietly', () => {
    const withoutReceipt = SOURCES.filter((s) => s.evidence_kind !== 'goods_receipt');
    const { manifest: m } = compile(CONTRACT, withoutReceipt);
    expect(m.evidence_satisfied).toBe(false);
    expect(m.missing_evidence).toEqual(['goods_receipt']);
  });

  it('records transformations applied on the way in', () => {
    expect(manifest.transformations).toEqual([
      {
        source_id: 'erp://vendors/meridian-components',
        transform: 'redact_account_tail',
        note: 'last 4 digits only',
      },
    ]);
  });

  it('accounts for the budget it charged', () => {
    expect(manifest.budget.records_charged).toBe(manifest.selected.length);
    expect(manifest.budget.records_charged).toBeLessThanOrEqual(manifest.budget.records_limit);
    expect(manifest.budget.tokens_charged).toBeLessThanOrEqual(manifest.budget.tokens_limit);
  });

  it('names what could invalidate the result, derived from what was selected', () => {
    const conditions = manifest.invalidators.map((i) => i.condition).join(' | ');
    expect(conditions).toMatch(/superseded/);
    expect(conditions).toMatch(/2026-11-02T00:00:00Z/);
    expect(conditions).toMatch(/governing instruction is amended/);
    // Every invalidator names the records it would affect.
    for (const inv of manifest.invalidators) expect(inv.affects.length).toBeGreaterThan(0);
  });

  it('drops the weakest sources first when the budget squeezes', () => {
    const { manifest: m } = compile({ ...CONTRACT, budget: { max_records: 2, max_tokens: 8000 } });
    expect(m.selected).toHaveLength(2);
    // Governance outranks system-of-record, so the policy survives.
    expect(m.selected[0].authority).toBe('governance');
    expect(m.excluded.some((e) => e.rule === 'budget')).toBe(true);
  });
});

describe('reconciliation', () => {
  it('resolves two claims about one subject by authority, then recency', () => {
    const attested = {
      source_id: 'vendor-portal://invoices/INV-2026-0918',
      subject: 'invoice:INV-2026-0918',
      record_type: 'claim',
      authority: 'system-of-record',
      verification_state: 'verified',
      valid_from: '2026-09-10T00:00:00Z',
      token_cost: 100,
      content: { invoice: 'INV-2026-0918', amount: '48200.00', version: 1 },
    };
    const { manifest } = compile(CONTRACT, [...SOURCES, attested]);
    const rec = manifest.reconciliations.find((r) => r.subject === 'invoice:INV-2026-0918');
    expect(rec).toBeTruthy();
    // Same authority tier, so the later validity instant wins.
    expect(rec.resolved_to).toBe('erp://invoices/INV-2026-0918');
    expect(rec.candidates).toHaveLength(2);
  });
});

describe('the ContextBundle', () => {
  const { bundle, manifest } = compile();

  it('carries only what was selected', () => {
    expect(bundle.records).toHaveLength(manifest.selected.length);
    const ids = bundle.records.map((r) => r.source_id);
    expect(ids).not.toContain('email://ap-inbox/msg-88213');
    expect(ids).not.toContain('erp://invoices/INV-2026-0918@v2');
  });

  it('never contains the excluded content — not merely a flag saying it was excluded', () => {
    // The whole point of policy before disclosure.
    expect(jcs(bundle)).not.toContain('LT12 3456 7890 1234 5678');
    expect(jcs(bundle)).not.toContain('52900.00');
  });

  it('names its own digest and its manifest', () => {
    expect(bundle.bundle_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.manifest_digest).toBe(manifest.manifest_digest);
    expect(digestForType('cigar-context-bundle', bundle).digest).toBe(bundle.bundle_digest);
  });

  it('is declared for exactly one consumer', () => {
    expect(bundle.consumer).toBe('ap-settlement-agent');
  });
});

describe('the decision environment and replay', () => {
  const compiled = compile();

  it('binds task, contract, manifest, bundle and snapshot together', () => {
    const e = compiled.environment;
    expect(e.task).toBe(CONTRACT.task);
    expect(e.manifest_digest).toBe(compiled.manifest.manifest_digest);
    expect(e.bundle_digest).toBe(compiled.bundle.bundle_digest);
    expect(e.snapshot_digest).toBe(compiled.snapshot.snapshot_digest);
    expect(e.component_versions.context_abi).toBe('cigar.context.v1');
  });

  it('replays clean against the captured artifacts', () => {
    const r = replay({
      environment: compiled.environment,
      manifest: compiled.manifest,
      bundle: compiled.bundle,
      contract: CONTRACT,
      snapshot: compiled.snapshot,
    });
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('detects an edited manifest at replay', () => {
    const tampered = JSON.parse(JSON.stringify(compiled.manifest));
    tampered.excluded = [];
    const r = replay({
      environment: compiled.environment,
      manifest: tampered,
      bundle: compiled.bundle,
      contract: CONTRACT,
      snapshot: compiled.snapshot,
    });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.includes('manifest')).ok).toBe(false);
  });

  it('states that it does not re-run the model or expose reasoning', () => {
    const r = replay({
      environment: compiled.environment,
      manifest: compiled.manifest,
      bundle: compiled.bundle,
      contract: CONTRACT,
      snapshot: compiled.snapshot,
    });
    expect(r.scope.doesNotEstablish.join(' ')).toMatch(/internal reasoning/);
  });

  it('is deterministic: the same inputs give the same digests', () => {
    expect(compile().environment.env_digest).toBe(compiled.environment.env_digest);
  });
});

describe('scoped handoff: authority is intersected, not transferred', () => {
  const held = {
    capabilities: ['payments:dispatch', 'payments:reconcile', 'ledger:read'],
    budget: { amount_max: '50000.00', currency: 'EUR' },
    expiry: '2026-09-21T18:00:00Z',
  };

  it('grants only the intersection of held and requested', () => {
    const i = intersectAuthority({
      held,
      requested: {
        capabilities: ['payments:dispatch', 'payments:refund'],
        budget: { amount_max: '60000.00', currency: 'EUR' },
        expiry: '2026-09-22T00:00:00Z',
      },
    });
    expect(i.granted).toEqual(['payments:dispatch']);
    expect(i.refused).toEqual(['payments:refund']);
  });

  it('takes the lower budget ceiling', () => {
    const i = intersectAuthority({
      held,
      requested: { capabilities: [], budget: { amount_max: '60000.00', currency: 'EUR' }, expiry: held.expiry },
    });
    expect(i.budget.amount_max).toBe('50000.00');
    expect(i.budget.capped_by).toBe('delegator');
  });

  it('names the request as the cap when it asks for less than is held', () => {
    const i = intersectAuthority({
      held,
      requested: { capabilities: [], budget: { amount_max: '1000.00', currency: 'EUR' }, expiry: held.expiry },
    });
    expect(i.budget.amount_max).toBe('1000.00');
    expect(i.budget.capped_by).toBe('request');
  });

  it('says neither side capped when both declare the same ceiling', () => {
    // Attributing the limit to one side would be a quiet falsehood in a demo
    // whose whole point is that the record says what actually happened.
    const i = intersectAuthority({
      held,
      requested: { capabilities: [], budget: { amount_max: '50000.00', currency: 'EUR' }, expiry: held.expiry },
    });
    expect(i.budget.capped_by).toMatch(/neither/);
  });

  it('takes the earlier expiry', () => {
    const i = intersectAuthority({
      held,
      requested: { capabilities: [], budget: { amount_max: '1.00', currency: 'EUR' }, expiry: '2026-09-21T15:00:00Z' },
    });
    expect(i.expiry).toBe('2026-09-21T15:00:00Z');
    expect(i.expiry_capped_by).toBe('request');
  });

  it('expresses money as an exact decimal string', () => {
    const i = intersectAuthority({
      held,
      requested: { capabilities: [], budget: { amount_max: '48200.00', currency: 'EUR' }, expiry: held.expiry },
    });
    expect(typeof i.budget.amount_max).toBe('string');
    expect(i.budget.amount_max).toBe('48200.00');
  });

  it('issues a recipient-bound, signed handoff', () => {
    reset();
    const { handoff, digest, cose_sign1_b64 } = issueHandoff({
      handoff_id: 'ho-7731',
      issuer: 'treasury-ops',
      recipient: 'ap-settlement-agent',
      task: 'settle_approved_invoice',
      acceptance_criteria: ['amount matches invoice', 'goods receipt present'],
      held,
      requested: {
        capabilities: ['payments:dispatch'],
        budget: { amount_max: '50000.00', currency: 'EUR' },
        expiry: held.expiry,
      },
      keyPair: kp,
      now,
    });
    expect(handoff.recipient).toBe('ap-settlement-agent');
    expect(handoff.authority_derivation.rule).toBe('intersection');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(cose_sign1_b64.length).toBeGreaterThan(0);
  });
});

describe('effect authorization against the handoff', () => {
  const handoff = {
    granted_capabilities: ['payments:dispatch'],
    budget: { amount_max: '50000.00', currency: 'EUR' },
    expiry: '2026-09-21T18:00:00Z',
  };

  it('authorizes an in-scope, in-budget, unexpired effect', () => {
    const r = authorizeEffect({ handoff, capability: 'payments:dispatch', amount: '48200.00', at: '2026-09-21T14:32:07Z' });
    expect(r.ok).toBe(true);
  });

  it('refuses a capability the handoff never granted', () => {
    const r = authorizeEffect({ handoff, capability: 'payments:refund', amount: '1.00', at: '2026-09-21T14:32:07Z' });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.includes('capability')).ok).toBe(false);
  });

  it('refuses an amount over the delegated ceiling', () => {
    const r = authorizeEffect({ handoff, capability: 'payments:dispatch', amount: '50000.01', at: '2026-09-21T14:32:07Z' });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.includes('budget')).ok).toBe(false);
  });

  it('refuses after expiry', () => {
    const r = authorizeEffect({ handoff, capability: 'payments:dispatch', amount: '1.00', at: '2026-09-22T00:00:00Z' });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name.includes('expired')).ok).toBe(false);
  });
});

describe('the effect lifecycle ledger', () => {
  const intent = {
    effect_type: 'send_payment',
    target: 'swift://gateway.northwind/payments',
    protected_arguments: ['creditor_iban'],
    preconditions: ['goods_receipt_present', 'amount_matches_invoice'],
    expected_result: 'payment_accepted',
    originating_decision: 'dec-4471',
    authorization: 'ho-7731',
    risk_level: 'high',
    retry_policy: { max_attempts: 1, note: 'no blind retry on an unconfirmed payment' },
    idempotency_key: 'pay:INV-2026-0918:48200.00:EUR',
    irreversibility_class: 'one_way_consequential',
  };

  const newLedger = () => {
    reset();
    return new EffectLedger({ ledger_id: 'el-1', intent, now });
  };

  it('records the intent before anything is dispatched', () => {
    const l = newLedger();
    expect(l.state).toBe('intent_recorded');
    expect(l.transitions[0].detail.idempotency_key).toBe(intent.idempotency_key);
  });

  it('hash-chains every transition', () => {
    const l = newLedger();
    l.append('authorized', { handoff: 'ho-7731' });
    l.append('dispatched', { attempt: 1 });
    expect(l.transitions[1].prev_hash).toBe(l.transitions[0].entry_hash);
    expect(l.transitions[2].prev_hash).toBe(l.transitions[1].entry_hash);
    expect(verifyEffectChain(l.artifact().ledger).ok).toBe(true);
  });

  it('refuses an illegal transition', () => {
    const l = newLedger();
    // You cannot observe a result for something never dispatched.
    expect(() => l.append('observed', {})).toThrow(/illegal effect transition/);
  });

  it('refuses to jump from dispatched straight to reconciled', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    expect(() => l.append('reconciled', {})).toThrow(/illegal effect transition/);
  });

  it('detects a rewritten transition', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    const { ledger } = l.artifact();
    ledger.transitions[1].detail = { handoff: 'ho-FORGED' };
    const v = verifyEffectChain(ledger);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/hashes to/);
  });

  it('detects a deleted transition', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    l.append('unknown', {});
    const { ledger } = l.artifact();
    ledger.transitions.splice(2, 1);
    expect(verifyEffectChain(ledger).ok).toBe(false);
  });
});

describe('UNKNOWN mapped onto an AAC effect block', () => {
  const intent = {
    effect_type: 'send_payment',
    target: 'swift://gateway.northwind/payments',
    idempotency_key: 'pay:INV-2026-0918:48200.00:EUR',
    irreversibility_class: 'one_way_consequential',
    risk_level: 'high',
  };
  const newLedger = () => { reset(); return new EffectLedger({ ledger_id: 'el-1', intent, now }); };

  it('maps intent-only to planned, with no attestation', () => {
    const e = newLedger().toAacEffect();
    expect(e.status).toBe('planned');
    expect(e.effect_attestation).toBeUndefined();
  });

  it('maps UNKNOWN to dispatched with NO response_digest', () => {
    // The honest shape. `confirmed` is unreachable here by construction.
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    l.append('unknown', { reason: 'gateway timeout after 30s, no response body' });
    const e = l.toAacEffect();
    expect(e.status).toBe('dispatched');
    expect(e.effect_attestation).toBe('gate_executed');
    expect(e.response_digest).toBeUndefined();
    expect(l.toAssuranceEffectMode()).toBe('dispatched_unconfirmed');
  });

  it('maps a reconciled observation to confirmed, binding the response', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    l.append('unknown', { reason: 'gateway timeout' });
    l.append('reconciled', { response_digest: 'dd'.repeat(32), source: 'erp://payments/ledger' });
    const e = l.toAacEffect();
    expect(e.status).toBe('confirmed');
    expect(e.response_digest).toBe('dd'.repeat(32));
    expect(l.toAssuranceEffectMode()).toBe('confirmed');
  });

  it('maps compensation to reverted', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    l.append('unknown', {});
    l.append('compensated', { action: 'duplicate suppressed' });
    expect(l.toAacEffect().status).toBe('reverted');
  });

  it('carries the idempotency key as the AAC external_ref join key', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    expect(l.toAacEffect().external_ref).toBe(intent.idempotency_key);
  });

  it('preserves the irreversibility class all the way through', () => {
    const l = newLedger();
    l.append('authorized', {});
    l.append('dispatched', {});
    expect(l.toAacEffect().irreversibility_class).toBe('one_way_consequential');
  });

  it('refuses an intent carrying a binary float where money belongs', () => {
    reset();
    expect(
      () => new EffectLedger({ ledger_id: 'x', intent: { ...intent, amount: 48200.5 }, now }),
    ).toThrow(/floating-point/);
  });
});
