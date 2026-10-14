import { createHash } from 'node:crypto';
import { canonicalDigest, digestForType, jcs } from '@cigar-aac/cpb';
import { keyPairFromSeed } from '@cigar-aac/cose';
import { CheckpointedLocalLog, CHECKPOINT_MEDIA_TYPE } from '@cigar-aac/cll';
import { TransparencyService, HEADER_ACTION_CLASS } from '@cigar-aac/scitt';
import { sealCapsule, who, can, did, audit } from '@cigar-aac/aac';
import {
  ingest,
  replay,
  issueHandoff,
  authorizeEffect,
  EffectLedger,
  verifyEffectChain,
} from '@cigar-aac/cigar';
import { compileContext } from './cigar.js';
import { verifyEvidenceBundle, BUNDLE_FORMAT } from '@cigar-aac/verifier';
import { buildSources, buildContract, GOVERNANCE, HELD_AUTHORITY, OPERATOR, AGENT } from './corpus.js';

/**
 * The minimal interop profile, executed.
 *
 * The AAIF brief's suggested next step, in one sentence:
 *
 *   "CIGAR governs context + one effect; AAC references the resulting
 *    artifacts; CLL checkpoints them; SCITT optionally witnesses the
 *    checkpoint; an independent verifier checks the record without needing
 *    CIGAR internals."
 *
 * This file is that sentence as code. Nothing here is a fixture: every digest,
 * signature, proof and receipt in the dashboard is produced by this run.
 */

/** Fixed seeds so a rehearsed demo produces the same digests every time. */
const KEYS = {
  delegator: keyPairFromSeed('01'.repeat(32)),
  agent: keyPairFromSeed('02'.repeat(32)),
  log: keyPairFromSeed('03'.repeat(32)),
  witness: keyPairFromSeed('04'.repeat(32)),
};

/** A deterministic clock: one second per observed step. */
function makeClock(start = Date.UTC(2026, 8, 21, 14, 0, 0)) {
  let n = 0;
  return () => new Date(start + n++ * 1000).toISOString();
}

const sha256Hex = (v) => createHash('sha256').update(jcs(v), 'utf8').digest('hex');

export const SCENARIOS = [
  {
    id: 'clean-settlement',
    title: 'Clean settlement',
    question: 'What does a complete, verifiable record actually look like?',
    plain:
      'An agent settles a 48,200 EUR supplier invoice inside its delegated authority. ' +
      'Everything works. This is the baseline: what good looks like, end to end.',
    proves: 'The happy path produces a record another party can check without asking us anything.',
    expect: 'accept / executed / confirmed',
  },
  {
    id: 'policy-block',
    title: 'Blocked by policy',
    question: 'When a gate stops an agent, how do you prove the gate worked?',
    plain:
      'The same agent is asked to settle a 68,400 EUR invoice. That is above its delegated ' +
      'ceiling, so the payment never leaves. No simulated payment was dispatched - and the record of that refusal ' +
      'is itself signed and locally witnessed.',
    proves: 'Refusals are records too. A blocked capsule is the auditor-grade evidence that a gate worked.',
    expect: 'reject / blocked / no effect dispatched',
  },
  {
    id: 'unknown-reconcile',
    title: 'Timeout, then UNKNOWN',
    question: 'The payment API timed out. Did the money move or not?',
    plain:
      'The payment is dispatched and the gateway stops responding. The agent knows it sent ' +
      'the request and does not know what happened. It records exactly that - not success, ' +
      'not failure. Later, reconciliation against the payment ledger resolves it, and a ' +
      'compensation record suppresses the duplicate a naive retry would have sent.',
    proves:
      'Uncertainty is preserved rather than flattened. "confirmed" is structurally unreachable ' +
      'until a response has actually been observed.',
    expect: 'dispatched -> UNKNOWN -> confirmed + retry suppressed, three chained records',
  },
  {
    id: 'poisoned-context',
    title: 'Poisoned context',
    question: 'An attacker emails new bank details. What stops it, and can you prove it stopped?',
    plain:
      'The same settlement, but the inbox now contains a business-email-compromise attempt ' +
      'asking for the payee account to be changed, and an attachment carrying a prompt ' +
      'injection that claims to raise the payment ceiling. Both are excluded before retrieval, ' +
      'and the exclusions are cited in the record.',
    proves:
      'Policy runs before disclosure, so the poison never reaches the model - and the exclusion ' +
      'is evidence an auditor can read without ever seeing the excluded content.',
    expect: 'accept / executed / confirmed, with exclusions cited',
  },
  {
    id: 'tamper',
    title: 'Tamper',
    question: 'Someone edits the record afterwards. Does anyone notice?',
    plain:
      'A clean settlement is produced, then one field is edited without re-signing - exactly ' +
      'what a motivated insider would do. The independent verifier is run again.',
    proves: 'A tampered record is caught by math, at a named leaf, with both digests shown.',
    expect: 'verifier FAIL with a named digest mismatch',
  },
];

/**
 * Run one scenario end to end.
 *
 * @param {string} id
 * @param {{emit?: (e:object)=>void, tamper?: {target:string, path:string, value:unknown}}} options
 */
export function runScenario(id, { emit = () => {}, tamper = null, runId = null } = {}) {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}"`);

  const now = makeClock();
  const events = [];
  const record = (e) => {
    // Envelope last: a payload field must never clobber the stream's own
    // sequence number or timestamp, or the dashboard loses its ordering.
    const event = { ...e, seq: events.length, at: now() };
    events.push(event);
    emit(event);
    return event;
  };

  const poisoned = id === 'poisoned-context';
  const amount = id === 'policy-block' ? '68400.00' : '48200.00';
  // The tamper scenario runs the UNKNOWN pipeline, because the most
  // interesting forgery is an insider hiding an unresolved payment by
  // upgrading the dispatched record to claim it completed. That breaks the
  // record's self-naming AND violates invariant I-1 at the same time.
  const timeoutFlow = id === 'unknown-reconcile' || id === 'tamper';
  const sources = buildSources({ amount, poisoned });
  const contract = buildContract({ amount });

  // =====================================================================
  // 1. COMPILE CONTEXT - CIGAR snapshots authorized sources and produces a
  //    provenance-bearing ContextBundle + SelectionManifest.
  // =====================================================================
  record({ kind: 'stage.enter', stage: 'context', label: 'Compile context' });

  const snapshot = ingest(sources, { now });
  for (const r of snapshot.records) {
    record({
      kind: 'source.ingested',
      source_id: r.source_id,
      record_type: r.record_type,
      authority: r.authority,
      verification_state: r.verification_state,
      content_digest: r.provenance.content_digest,
    });
  }
  record({ kind: 'contract.declared', contract });

  const compiled = compileContext({ scenario: id, contract, snapshot, governance: GOVERNANCE, emit: record, now, runId });
  if (!compiled.ok) {
    record({ kind: 'run.refused', stage: compiled.stage, reason: compiled.reason });
    return { scenario, events, ok: false, refused: compiled.reason };
  }

  // =====================================================================
  // 2. DECIDE + ACT - the agent operates inside bounded context and
  //    authority; effects preserve intent, observation and honest UNKNOWN.
  // =====================================================================
  record({ kind: 'stage.enter', stage: 'action', label: 'Decide and act' });

  // Delegation: authority is intersected, never transferred unrestricted.
  const handoffResult = issueHandoff({
    handoff_id: 'ho-7731',
    issuer: 'treasury-ops',
    recipient: 'ap-settlement-agent',
    task: 'settle_approved_invoice',
    acceptance_criteria: [
      'amount matches the current invoice version',
      'goods receipt present and accepted',
      'payee bank details verified within 90 days',
      'no prior payment against the same purchase order',
    ],
    held: HELD_AUTHORITY,
    requested: {
      capabilities: ['payments:dispatch', 'payments:reconcile', 'payments:compensate', 'payments:refund'],
      budget: { amount_max: '50000.00', currency: 'EUR' },
      expiry: '2026-09-21T18:00:00Z',
    },
    keyPair: KEYS.delegator,
    now,
  });
  record({
    kind: 'handoff.signed',
    handoff_id: handoffResult.handoff.handoff_id,
    digest: handoffResult.digest,
    granted: handoffResult.handoff.granted_capabilities,
    refused: handoffResult.handoff.refused_capabilities,
    budget: handoffResult.handoff.budget,
  });

  // The decision, derived from the compiled bundle rather than asserted.
  const invoiceRecord = compiled.bundle.records.find((r) => r.source_id.startsWith('erp://invoices/'));
  const decision = {
    decision_id: 'dec-4471',
    outcome: 'settle',
    invoice: invoiceRecord.content.invoice,
    amount: invoiceRecord.content.amount,
    currency: invoiceRecord.content.currency,
    payee_verified: compiled.bundle.records.some((r) => r.source_id === 'erp://vendors/meridian-components'),
    rationale_digest: sha256Hex({ bundle: compiled.bundle.bundle_digest, task: contract.task }),
  };
  record({ kind: 'decision.made', decision });

  // The effect intent, recorded BEFORE anything leaves the boundary.
  const intent = {
    effect_type: 'send_payment',
    target: 'swift://gateway.northwind/payments',
    protected_arguments: ['creditor_iban'],
    preconditions: contract.required_evidence,
    expected_result: 'payment_accepted',
    originating_decision: decision.decision_id,
    authorization: handoffResult.handoff.handoff_id,
    risk_level: 'high',
    retry_policy: { max_attempts: 1, note: 'no blind retry while an outcome is unobserved' },
    idempotency_key: `pay:${decision.invoice}:${decision.amount}:${decision.currency}`,
    irreversibility_class: 'one_way_consequential',
    amount: decision.amount,
    currency: decision.currency,
  };
  const ledger = new EffectLedger({ ledger_id: 'el-9007', intent, now, emit: record });

  // Authority check against the handoff, as its own step.
  const authz = authorizeEffect({
    handoff: handoffResult.handoff,
    capability: 'payments:dispatch',
    amount: decision.amount,
    at: now(),
  });
  for (const c of authz.checks) {
    record({ kind: 'effect.authorization_check', name: c.name, ok: c.ok, detail: c.detail });
  }

  const requestPayload = {
    creditor: decision.invoice,
    amount: decision.amount,
    currency: decision.currency,
    idempotency_key: intent.idempotency_key,
  };
  const requestDigest = canonicalDigest({ payload: requestPayload, algorithm: 'jcs' }).digest;

  /** Capsules produced by this run, in order. */
  const sealedCapsules = [];
  const cll = new CheckpointedLocalLog({
    logId: runId ? `northwind-ap-settlement/${runId}` : 'northwind-ap-settlement-fixture',
    privateKey: KEYS.log.privateKey,
    rawPublicKey: KEYS.log.rawPublicKey,
    cadence: 'on-verdict',
    now,
  });

  /** Seal one capsule, append it to the log, and record the events. */
  const sealAndLog = ({
    action_id,
    disposition,
    effectBlock,
    assurance,
    chain = null,
    didArtifact,
    auditArtifact,
    label,
  }) => {
    const members = [
      who(
        {
          principal: contract.principal,
          agent: AGENT,
          on_behalf_of: OPERATOR,
          project: contract.project,
          delegation: { handoff_id: handoffResult.handoff.handoff_id, rule: 'intersection' },
        },
        'aac-who',
      ),
      // CAN cites the signed CIGAR handoff byte-identically. Never re-minted.
      can(handoffResult.handoff, 'cigar-signed-handoff'),
      did({ request: requestPayload, ...didArtifact }, 'aac-did'),
      audit(auditArtifact, 'aac-audit'),
    ];

    const sealed = sealCapsule({
      action_id,
      action_type: 'decide',
      operator: OPERATOR,
      developer: AGENT,
      timestamp: now(),
      epoch_id: 'epoch-2026-09',
      disposition,
      effect: { ...effectBlock, ...(effectBlock.status !== 'planned' && didArtifact.request_digest ? { request_digest: didArtifact.request_digest } : {}) },
      assurance: { ...assurance, ledger_mode: chain ? 'chained' : 'standalone' },
      chain,
      members,
      keyPair: KEYS.agent,
      canonicalizationId: 'jcs',
    });

    const leafIndex = cll.append({
      id: sealed.capsule_id,
      kind: 'agent-action-capsule',
      // Local-only content. This never leaves the producer.
      local: { label, creditor_iban_full: 'DE89 3704 0044 0532 0130 00' },
    });

    record({
      kind: 'capsule.sealed',
      action_id,
      capsule_id: sealed.capsule_id,
      label,
      slots: sealed.members.map((m) => ({ slot: m.slot, type: m.type, digest: m.ref.digest })),
      disposition,
      effect: sealed.capsule.effect,
      canonical_bytes: sealed.digest_context.preimage_bytes,
    });
    record({
      kind: 'cll.appended',
      leaf_index: leafIndex,
      capsule_id: sealed.capsule_id,
      leaf_hash: cll.entries[leafIndex].leaf_hash,
      log_size: cll.logSize,
    });

    sealedCapsules.push({ sealed, leafIndex, label });
    return { sealed, leafIndex };
  };

  const auditBase = (verdictClass, extra = {}) => ({
    verdict_class: verdictClass,
    timestamp: now(),
    assurance_note: 'self-attested producer; a separate demo-owned receipt witnesses the local checkpoint, without claiming AAC anchored assurance',
    limits: [
      'this record does not assert that the payment was correct, only what was done',
      'the CAN member is a delegated authority artifact, not proof the delegator held it',
    ],
    // Selective disclosure: what was deliberately not disclosed, declared.
    withheld: ['creditor_iban_full', 'invoice_pdf', 'model_reasoning'],
    context_evidence: {
      native_execution_digest: compiled.nativeDigest,
      selection_manifest_digest: compiled.manifest.manifest_digest,
      context_bundle_digest: compiled.bundle.bundle_digest,
      decision_environment_digest: compiled.environment.env_digest,
      sources_considered: compiled.manifest.considered.length,
      sources_selected: compiled.manifest.selected.length,
      sources_excluded: compiled.manifest.excluded.length,
      exclusions: compiled.manifest.excluded.map((e) => ({ source_id: e.source_id, rule: e.rule })),
    },
    ...extra,
  });

  if (!authz.ok) {
    // -------------------------------------------------------------------
    // The gate refused. Nothing was dispatched. A record is produced anyway,
    // because a refusal that leaves no trace is indistinguishable from a gate
    // that was never reached.
    // -------------------------------------------------------------------
    ledger.append('refused', {
      reason: authz.checks.filter((c) => !c.ok).map((c) => c.name).join('; '),
      checks: authz.checks,
    });
    const { ledger: ledgerArtifact, digest: ledgerDigest } = ledger.artifact();

    sealAndLog({
      action_id: `act-${decision.invoice}-blocked`,
      label: 'payment blocked before dispatch',
      disposition: {
        decision: 'reject',
        approver: 'policy',
        human_disposed: false,
        verdict_class: 'blocked',
        reason_digest: sha256Hex(authz.checks),
        authority: `handoff:${handoffResult.handoff.handoff_id}`,
      },
      effectBlock: ledger.toAacEffect(),
      assurance: {
        attestation_mode: 'self_attested',
        effect_mode: ledger.toAssuranceEffectMode(),
        ledger_mode: 'standalone',
        cross_party_rung: 'unilateral_fallback',
      },
      didArtifact: {
        effect_type: intent.effect_type,
        target: intent.target,
        request_digest: requestDigest,
        // No response_digest: nothing was sent, so nothing was observed.
        effect_ledger: ledgerArtifact,
        effect_ledger_digest: ledgerDigest,
        terminal_state: ledger.state,
        blocked_by: authz.checks.filter((c) => !c.ok).map((c) => c.name),
      },
      auditArtifact: auditBase('blocked', {
        gate: 'delegated-budget-ceiling',
        money_moved: false,
      }),
    });
  } else {
    // -------------------------------------------------------------------
    // Authorized. Dispatch.
    // -------------------------------------------------------------------
    ledger.append('authorized', { handoff: handoffResult.handoff.handoff_id, checks: authz.checks });
    ledger.append('dispatched', {
      attempt: 1,
      request_digest: requestDigest,
      gateway: intent.target,
    });

    if (timeoutFlow) {
      // ---- UNKNOWN. The request left; no result was observed.
      ledger.append('unknown', {
        reason: 'gateway did not respond within 30s; no response body, no error code',
        observed: null,
        note: 'the request is known to have left the boundary; its outcome is not known',
      });
      const snapA = ledger.artifact();

      const first = sealAndLog({
        action_id: `act-${decision.invoice}-dispatch`,
        label: 'dispatched, outcome unobserved',
        disposition: {
          decision: 'accept',
          approver: 'policy',
          human_disposed: false,
          verdict_class: 'timeout',
          authority: `handoff:${handoffResult.handoff.handoff_id}`,
        },
        // dispatched, gate_executed, and deliberately NO response_digest.
        effectBlock: ledger.toAacEffect(),
        assurance: {
          attestation_mode: 'self_attested',
          effect_mode: ledger.toAssuranceEffectMode(),
          ledger_mode: 'standalone',
          cross_party_rung: 'unilateral_fallback',
        },
        didArtifact: {
          effect_type: intent.effect_type,
          target: intent.target,
          request_digest: requestDigest,
          effect_ledger: snapA.ledger,
          effect_ledger_digest: snapA.digest,
          terminal_state: 'unknown',
          note:
            'request_digest is present and response_digest is absent. The record says ' +
            'what was sent and refuses to say what happened, because nobody knows yet.',
        },
        auditArtifact: auditBase('timeout', {
          money_moved: 'unknown',
          operator_obligation: 'reconcile against the payment ledger before any retry',
        }),
      });

      // ---- Reconciliation: an independent observation resolves it.
      const responsePayload = {
        gateway_ref: 'SWIFT-9F2A7C41',
        settled_at: '2026-09-21T14:03:11Z',
        amount: decision.amount,
        currency: decision.currency,
        status: 'settled',
      };
      const responseDigest = canonicalDigest({ payload: responsePayload, algorithm: 'jcs' }).digest;
      ledger.append('reconciled', {
        source: 'erp://payments/ledger',
        observation: responsePayload,
        response_digest: responseDigest,
        note: 'the payment did land; the ambiguity was real and is now resolved',
      });
      const snapB = ledger.artifact();

      const second = sealAndLog({
        action_id: `act-${decision.invoice}-reconciled`,
        label: 'reconciled: the payment did land',
        chain: {
          parent_capsule_id: first.sealed.capsule_id,
          relation: 'confirms',
        },
        disposition: {
          decision: 'accept',
          approver: 'policy',
          human_disposed: false,
          verdict_class: 'executed',
          authority: `handoff:${handoffResult.handoff.handoff_id}`,
        },
        effectBlock: ledger.toAacEffect(),
        assurance: {
          attestation_mode: 'self_attested',
          effect_mode: ledger.toAssuranceEffectMode(),
          ledger_mode: 'standalone',
          cross_party_rung: 'unilateral_fallback',
        },
        didArtifact: {
          effect_type: intent.effect_type,
          target: intent.target,
          request_digest: requestDigest,
          response_digest: responseDigest,
          response: responsePayload,
          effect_ledger: snapB.ledger,
          effect_ledger_digest: snapB.digest,
          terminal_state: 'reconciled',
        },
        auditArtifact: auditBase('executed', {
          money_moved: true,
          resolved_by: 'erp://payments/ledger',
        }),
      });

      // A distinct queue action suppresses a retry; it does not reverse the payment.
      const cancelRequest = { cancel: intent.idempotency_key };
      const cancelResponse = { idempotency_key: intent.idempotency_key, status: 'duplicate_suppressed' };
      const cancelRequestDigest = canonicalDigest({ payload: cancelRequest, algorithm: 'jcs' }).digest;
      const cancelResponseDigest = canonicalDigest({ payload: cancelResponse, algorithm: 'jcs' }).digest;
      ledger.append('compensated', {
        observation: cancelResponse,
        response_digest: cancelResponseDigest,
        action: 'duplicate_suppressed',
        idempotency_key: intent.idempotency_key,
        note:
          'the queued retry was cancelled because reconciliation confirmed settlement; ' +
          'the compensating action is recorded as its own event, not as an edit',
      });
      const snapC = ledger.artifact();

      sealAndLog({
        action_id: `act-${decision.invoice}-compensated`,
        label: 'compensation: duplicate suppressed',
        chain: { parent_capsule_id: second.sealed.capsule_id, relation: 'follows' },
        disposition: {
          decision: 'accept',
          approver: 'policy',
          human_disposed: false,
          verdict_class: 'executed',
          authority: `handoff:${handoffResult.handoff.handoff_id}`,
        },
        effectBlock: {
          status: 'confirmed', type: 'org.hol.demo.suppress_duplicate_payment',
          effect_attestation: 'gate_executed', response_digest: cancelResponseDigest,
          external_ref: intent.idempotency_key, irreversibility_class: 'two_way',
        },
        assurance: {
          attestation_mode: 'self_attested',
          effect_mode: 'confirmed',
          ledger_mode: 'standalone',
          cross_party_rung: 'unilateral_fallback',
        },
        didArtifact: {
          effect_type: 'org.hol.demo.suppress_duplicate_payment',
          target: 'queue://northwind/payment-retries',
          request: cancelRequest,
          response: cancelResponse,
          request_digest: cancelRequestDigest,
          response_digest: cancelResponseDigest,
          effect_ledger: snapC.ledger,
          effect_ledger_digest: snapC.digest,
          terminal_state: 'compensated',
        },
        auditArtifact: auditBase('executed', {
          compensates: second.sealed.capsule_id,
          money_moved: false,
          note: 'a compensating action, recorded separately; the original record is untouched',
        }),
      });
    } else {
      // ---- Observed cleanly.
      const responsePayload = {
        gateway_ref: 'SWIFT-7B31E902',
        settled_at: '2026-09-21T14:01:04Z',
        amount: decision.amount,
        currency: decision.currency,
        status: 'settled',
      };
      const responseDigest = canonicalDigest({ payload: responsePayload, algorithm: 'jcs' }).digest;
      ledger.append('observed', { observation: responsePayload, response_digest: responseDigest });
      const snap = ledger.artifact();

      sealAndLog({
        action_id: `act-${decision.invoice}-settled`,
        label: 'payment settled and observed',
        disposition: {
          decision: 'accept',
          approver: 'policy',
          human_disposed: false,
          verdict_class: 'executed',
          authority: `handoff:${handoffResult.handoff.handoff_id}`,
        },
        effectBlock: ledger.toAacEffect(),
        assurance: {
          attestation_mode: 'self_attested',
          effect_mode: ledger.toAssuranceEffectMode(),
          ledger_mode: 'standalone',
          cross_party_rung: 'unilateral_fallback',
        },
        didArtifact: {
          effect_type: intent.effect_type,
          target: intent.target,
          request_digest: requestDigest,
          response_digest: responseDigest,
          response: responsePayload,
          effect_ledger: snap.ledger,
          effect_ledger_digest: snap.digest,
          terminal_state: 'observed',
        },
        auditArtifact: auditBase('executed', { money_moved: true }),
      });
    }
  }

  // =====================================================================
  // 3 + 4. CHECKPOINT AND WITNESS - records enter a CLL; the checkpoint is
  //        SCITT-registered and carries a verifiable receipt.
  // =====================================================================
  record({ kind: 'stage.enter', stage: 'log', label: 'Checkpoint and witness' });

  const mmr = cll.mmr();
  record({
    kind: 'cll.mmr',
    leaf_count: mmr.leafCount,
    mmr_size: mmr.mmrSize,
    peaks: mmr.peaks.map((p) => ({ pos: p.pos, height: p.height, hash: p.hash.toString('hex') })),
    root: mmr.root.toString('hex'),
  });

  const checkpoint = cll.checkpoint();
  record({
    kind: 'cll.checkpointed',
    claims: checkpoint.claims,
    bytes_on_the_wire: checkpoint.bytes_on_the_wire,
    entries_covered: cll.logSize,
  });

  const witness = new TransparencyService({
    serviceId: 'anchor.demo.hol',
    privateKey: KEYS.witness.privateKey,
    rawPublicKey: KEYS.witness.rawPublicKey,
    policy: {
      acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE],
      acceptedIssuers: [cll.logId],
      checkpointAware: true,
    },
    now,
  });

  const statementBytes = Buffer.from(checkpoint.cose_sign1_b64, 'base64');
  const registration = witness.register(statementBytes);
  record({
    kind: 'scitt.registered',
    registered: registration.registered,
    reason: registration.reason ?? null,
    policy: registration.policy,
    entry: registration.entry ?? null,
  });
  if (registration.registered) {
    record({
      kind: 'scitt.receipt',
      receipt: {
        service_id: registration.receipt.service_id,
        root: registration.receipt.root,
        leaf_index: registration.receipt.leaf_index,
        log_size: registration.receipt.log_size,
        registered_at: registration.receipt.registered_at,
        vds: registration.receipt.vds,
        bytes: registration.receipt.bytes,
      },
      scope: registration.scope,
    });
  }

  // =====================================================================
  // 5. REPLAY + VERIFY
  // =====================================================================
  record({ kind: 'stage.enter', stage: 'verify', label: 'Replay and verify' });

  const replayResult = replay({
    environment: compiled.environment,
    manifest: compiled.manifest,
    bundle: compiled.bundle,
    contract,
    snapshot,
  });
  record({ kind: 'cigar.replay', ok: replayResult.ok, checks: replayResult.checks, scope: replayResult.scope });

  const chainResult = verifyEffectChain(ledger.artifact().ledger);
  record({ kind: 'cigar.effect_chain', ...chainResult });

  // ---- Assemble the portable evidence bundle.
  let bundle = buildBundle({
    scenario,
    sealedCapsules,
    cll,
    checkpoint,
    registration,
    compiled,
    handoffResult,
    contract,
    producedAt: now(),
  });

  // ---- Tamper, if asked. Applied to the bundle only, never re-signed.
  let tamperApplied = null;
  if (tamper || id === 'tamper') {
    const spec = tamper ?? {
      target: 'capsule',
      path: 'effect.status',
      value: 'confirmed',
      note: 'an insider upgrades a record to claim the payment completed',
    };
    const result = applyTamper(bundle, spec);
    bundle = result.bundle;
    tamperApplied = result.applied;
    record({ kind: 'tamper.applied', ...result.applied });
  }

  const verification = verifyEvidenceBundle(bundle);
  for (const c of verification.checks) record({ kind: 'verify.step', ...c });
  record({ kind: 'verify.verdict', ok: verification.ok, summary: verification.summary, scope: verification.scope });

  return {
    scenario,
    ok: verification.ok,
    events,
    bundle,
    verification,
    tamperApplied,
    artifacts: {
      cigar: compiled.native,
      snapshot,
      contract,
      manifest: compiled.manifest,
      contextBundle: compiled.bundle,
      environment: compiled.environment,
      handoff: handoffResult,
      effectLedger: ledger.artifact(),
      capsules: sealedCapsules.map((c) => ({ ...c.sealed, label: c.label, leafIndex: c.leafIndex })),
      cll: {
        log_id: cll.logId,
        entries: cll.entries.map(({ local, ...e }) => e),
        mmr: {
          leaf_count: mmr.leafCount,
          mmr_size: mmr.mmrSize,
          peaks: mmr.peaks.map((p) => ({ pos: p.pos, height: p.height, hash: p.hash.toString('hex') })),
          root: mmr.root.toString('hex'),
        },
        checkpoint,
      },
      scitt: registration,
      replay: replayResult,
      effectChain: chainResult,
      keys: {
        delegator_kid: KEYS.delegator.rawPublicKey.toString('hex'),
        agent_kid: KEYS.agent.rawPublicKey.toString('hex'),
        log_kid: KEYS.log.rawPublicKey.toString('hex'),
        witness_kid: KEYS.witness.rawPublicKey.toString('hex'),
      },
    },
  };
}

/** Assemble the portable evidence bundle. */
export function buildBundle({
  scenario,
  sealedCapsules,
  cll,
  checkpoint,
  registration,
  compiled,
  handoffResult,
  contract,
  producedAt,
}) {
  return {
    bundle_format: BUNDLE_FORMAT,
    produced_at: producedAt,
    scenario: { id: scenario.id, title: scenario.title, question: scenario.question },

    capsules: sealedCapsules.map(({ sealed, leafIndex, label }) => ({
      label,
      capsule: sealed.capsule,
      cose_sign1_b64: sealed.cose_sign1_b64,
      media_type: sealed.media_type,
      digest_context: sealed.digest_context,
      members: sealed.members.map((m) => ({ slot: m.slot, type: m.type, ref: m.ref, artifact: m.artifact })),
      cll: { leaf_index: leafIndex, proof: cll.proofFor(leafIndex) },
    })),

    cll: {
      log_id: cll.logId,
      checkpoint: { claims: checkpoint.claims, cose_sign1_b64: checkpoint.cose_sign1_b64 },
      previous_checkpoint: null,
      // Entry ids and leaf hashes travel; the local content does not.
      entries: cll.entries.map(({ local, ...e }) => e),
    },

    scitt: registration.registered
      ? {
          service_id: registration.receipt.service_id,
          statement_b64: checkpoint.cose_sign1_b64,
          receipt: registration.receipt,
          scope: registration.scope,
        }
      : null,

    /**
     * The CIGAR artifacts this record REFERENCES rather than duplicates.
     * Carried here so a verifier can resolve the typed refs, and cited
     * byte-identically: nothing in here was re-minted for the capsule.
     */
    referenced_artifacts: {
      cigar_execution: compiled.native,
      context_contract: contract,
      selection_manifest: compiled.manifest,
      context_bundle: compiled.bundle,
      decision_environment: compiled.environment,
      signed_handoff: handoffResult.handoff,
      signed_handoff_cose_b64: handoffResult.cose_sign1_b64,
    },

    /** Selective disclosure: what was deliberately not included. */
    withheld: [
      { field: 'creditor_iban_full', reason: 'only the last four digits are present in the authorized fixture; no full-account commitment is claimed' },
      { field: 'invoice_pdf', reason: 'this scenario uses structured invoice data; no PDF was ingested or committed' },
      { field: 'model_reasoning', reason: 'chain-of-thought is never captured, by design' },
      { field: 'excluded_source_content', reason: 'excluded material is named and reasoned about, never carried' },
    ],

    keys: {
      note:
        'Public keys only. Every signature here also carries its key in the protected ' +
        'kid, so a verifier needs nothing from this list.',
      agent_kid: KEYS.agent.rawPublicKey.toString('hex'),
      delegator_kid: KEYS.delegator.rawPublicKey.toString('hex'),
      log_kid: KEYS.log.rawPublicKey.toString('hex'),
      witness_kid: KEYS.witness.rawPublicKey.toString('hex'),
    },

    provenance_note:
      'Context executed by hol-cigar 0.14.0 (PyPI) and its bundled native Rust worker. ' +
      'Scripted payment gateway and fixture reviewer; no bank transfer or live model. ' +
      'Business policy, handoff, effect lifecycle, and AAC composition use this demo profile. ' +
      'CIGAR artifact types here are PROPOSED integration points for discussion, not a ' +
      'normative mapping in the current drafts.',
  };
}

/** Targets the tamper panel can edit. */
export const TAMPER_TARGETS = [
  {
    id: 'capsule',
    label: 'The record: effect.status',
    path: 'effect.status',
    /**
     * Flip the status to the other side of the observed/unobserved line,
     * whichever direction this record is currently on. Both directions are
     * forgeries and both are caught twice: the record stops hashing to its
     * declared id, AND invariant I-1 fires, because "confirmed" requires a
     * response_digest and the other states forbid one.
     */
    resolve: (current) => (current === 'confirmed' ? 'dispatched' : 'confirmed'),
    plainFor: (current) =>
      current === 'confirmed'
        ? 'Disown an observed payment by downgrading it to a mere attempt.'
        : 'Upgrade a dispatched payment to claim it completed.',
    plain: 'Flip a payment across the observed / unobserved line.',
    breaks: 'capsule_id no longer matches the record, the signature covers the old id, and invariant I-1 fires.',
  },
  {
    id: 'capsule-operator',
    label: 'The record: operator',
    path: 'operator',
    value: 'someone-else-ltd',
    plain: 'Reassign the action to a different accountable company.',
    breaks: 'capsule_id no longer matches the record.',
  },
  {
    id: 'handoff',
    label: 'The authority: budget ceiling',
    path: 'budget.amount_max',
    value: '500000.00',
    plain: 'Raise the delegated payment ceiling after the fact.',
    breaks: 'the CAN slot reference no longer resolves to the handoff.',
  },
  {
    id: 'manifest',
    label: 'The context: hide an exclusion',
    path: 'excluded',
    value: [],
    plain: 'Delete the record that a poisoned source was rejected.',
    breaks: 'the selection manifest digest cited by the AUDIT member no longer matches.',
  },
  {
    id: 'checkpoint',
    label: 'The log: checkpoint commitment',
    path: 'commitment',
    value: '00'.repeat(32),
    plain: 'Point the checkpoint at a different history.',
    breaks: 'the checkpoint signature fails, and inclusion proofs no longer reach the root.',
  },
  {
    id: 'proof',
    label: 'The proof: an inclusion path node',
    path: 'path.0.hash',
    value: 'ff'.repeat(32),
    plain: 'Forge a Merkle sibling hash.',
    breaks: 'the recomputed peak does not match, so the record is not in this log.',
  },
];

const readPath = (obj, path) => path.split('.').reduce((cur, p) => (cur == null ? cur : cur[p]), obj);

/** The value a target currently points at, so `resolve` can pick a different one. */
function currentValueFor(bundle, target, path) {
  switch (target.id) {
    case 'capsule':
    case 'capsule-operator': {
      const item =
        bundle.capsules.find((c) => !path.startsWith('effect.') || c.capsule.effect) ?? bundle.capsules[0];
      return readPath(item.capsule, path);
    }
    case 'handoff':
      return readPath(bundle.referenced_artifacts.signed_handoff, path);
    case 'manifest':
      return readPath(bundle.referenced_artifacts.selection_manifest, path);
    case 'checkpoint':
      return readPath(bundle.cll.checkpoint.claims, path);
    default:
      return undefined;
  }
}

const setPath = (obj, path, value) => {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  const last = parts[parts.length - 1];
  const before = cur[last];
  cur[last] = value;
  return before;
};

/** Apply a tamper to a bundle, without re-signing anything. */
export function applyTamper(bundle, spec) {
  const copy = JSON.parse(JSON.stringify(bundle));
  const target = TAMPER_TARGETS.find((t) => t.id === spec.target) ?? TAMPER_TARGETS[0];
  const path = spec.path ?? target.path;

  /**
   * Work out what to change it TO, given what it currently is. A fixed value
   * can silently coincide with the value already there, and a tamper that
   * changes nothing proves nothing - so targets that can collide declare a
   * `resolve` instead.
   */
  let value = spec.value;
  if (value === undefined) {
    if (target.resolve) {
      const current = currentValueFor(copy, target, path);
      value = target.resolve(current);
    } else {
      value = target.value;
    }
  }

  let before;
  let where;

  switch (target.id) {
    case 'capsule':
    case 'capsule-operator': {
      // Pick a record where this edit actually changes something. A tamper
      // demo that silently no-ops is the worst possible failure on stage, so
      // this searches for a record whose current value differs, and the guard
      // below refuses to proceed if none does.
      let idx = copy.capsules.findIndex((c) => {
        if (path.startsWith('effect.') && !c.capsule.effect) return false;
        return readPath(c.capsule, path) !== value;
      });
      if (idx < 0) idx = copy.capsules.findIndex((c) => !path.startsWith('effect.') || c.capsule.effect);
      if (idx < 0) idx = 0;
      const item = copy.capsules[idx];
      before = setPath(item.capsule, path, value);
      where = `capsules[${idx}].capsule.${path} (${item.capsule.action_id})`;
      break;
    }
    case 'handoff': {
      before = setPath(copy.referenced_artifacts.signed_handoff, path, value);
      // The CAN member artifact each capsule carries is the same handoff.
      for (const c of copy.capsules) {
        const canMember = c.members.find((m) => m.slot === 'can');
        if (canMember) setPath(canMember.artifact, path, value);
      }
      where = `referenced_artifacts.signed_handoff.${path}`;
      break;
    }
    case 'manifest': {
      before = setPath(copy.referenced_artifacts.selection_manifest, path, value);
      where = `referenced_artifacts.selection_manifest.${path}`;
      break;
    }
    case 'checkpoint': {
      before = setPath(copy.cll.checkpoint.claims, path, value);
      where = `cll.checkpoint.claims.${path}`;
      break;
    }
    case 'proof': {
      const item = copy.capsules[0];
      if (!item.cll.proof.path.length) {
        // A single-leaf log has an empty path; edit the peak instead.
        before = item.cll.proof.peaks[0];
        item.cll.proof.peaks[0] = 'ff'.repeat(32);
        where = `capsules[0].cll.proof.peaks[0]`;
      } else {
        before = item.cll.proof.path[0].hash;
        item.cll.proof.path[0].hash = value;
        where = `capsules[0].cll.proof.path[0].hash`;
      }
      break;
    }
    default:
      throw new Error(`unknown tamper target "${spec.target}"`);
  }

  if (JSON.stringify(before) === JSON.stringify(value)) {
    throw new Error(
      `tamper "${target.id}" would be a no-op: ${where} is already ` +
        `${JSON.stringify(value)}. A tamper that changes nothing proves nothing.`,
    );
  }

  return {
    bundle: copy,
    applied: {
      target: target.id,
      label: target.label,
      where,
      before,
      after: value,
      plain: target.plainFor ? target.plainFor(before) : target.plain,
      expected_break: target.breaks,
      note: 'the artifact was edited and NOT re-signed, which is what an insider edit looks like',
    },
  };
}

export { SCENARIOS as scenarios, KEYS };
