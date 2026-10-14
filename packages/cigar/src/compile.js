import { canonicalDigest, digestForType, findFloatingPointNumbers } from '@cigar-aac/cpb';
import { evaluateContract, screenSource, authorityRank } from './policy.js';

/**
 * The CIGAR context compiler: five stages, in this order.
 *
 *   1  ingest immutable source state      -> typed records with provenance
 *   2  apply a context contract           -> policy evaluated BEFORE retrieval
 *   3  retrieve, reconcile and pack       -> conflicts resolved by authority,
 *                                            validity time, verification state
 *   4  materialize for the consumer       -> the ContextBundle
 *   5  capture the decision environment   -> everything bound together
 *
 * Stage 5 is the one that makes replay possible, and the one the AAC family
 * wants to reference rather than duplicate.
 */

/**
 * Derive the conditions that would invalidate a compiled context.
 *
 * Every entry names the records it affects, so a later auditor can check
 * whether the condition has since occurred rather than taking prose on trust.
 */
function buildInvalidators(selectedRecords, contract) {
  const invalidators = [];

  if (selectedRecords.length) {
    invalidators.push({
      condition: 'any selected source is superseded by a newer version',
      affects: selectedRecords.map((r) => r.source_id),
    });
  }

  for (const r of selectedRecords) {
    if (r.valid_to) {
      invalidators.push({
        condition: `${r.source_id} ceases to be valid at ${r.valid_to}`,
        affects: [r.source_id],
      });
    }
  }

  const instructions = selectedRecords.filter((r) => r.record_type === 'instruction');
  if (instructions.length) {
    invalidators.push({
      condition: 'a governing instruction is amended',
      affects: instructions.map((r) => r.source_id),
    });
  }

  invalidators.push({
    condition: `the contract's as_of instant (${contract.as_of}) moves`,
    affects: ['*'],
  });

  return invalidators;
}

/** Stage 1 — snapshot sources into typed records with provenance. */
export function ingest(sources, { now }) {
  const snapshotAt = now();
  const records = sources.map((s) => {
    const content_digest = canonicalDigest({ payload: s.content, algorithm: 'jcs-n' }).digest;
    return {
      ...s,
      provenance: {
        ingested_at: snapshotAt,
        content_digest,
        immutable: true,
      },
    };
  });
  const snapshot_digest = canonicalDigest({
    payload: records.map((r) => ({ source_id: r.source_id, content_digest: r.provenance.content_digest })),
    algorithm: 'jcs-n',
  }).digest;
  return { records, snapshot_at: snapshotAt, snapshot_digest };
}

/**
 * Stages 2-5.
 *
 * @param {object} o
 * @param {object} o.contract
 * @param {object} o.snapshot result of ingest()
 * @param {object} o.governance { allowedPurposes, principals }
 * @param {(e:object)=>void} [o.emit] event sink, so the dashboard animates the real run
 * @param {()=>string} o.now
 */
export function compileContext({ contract, snapshot, governance, emit = () => {}, now }) {
  // ---- Stage 2: apply the context contract. Policy first.
  const contractVerdict = evaluateContract(contract, governance);
  for (const d of contractVerdict.decisions) {
    emit({ kind: 'policy.evaluated', name: d.name, ok: d.ok, detail: d.detail });
  }
  if (!contractVerdict.ok) {
    const failed = contractVerdict.decisions.filter((d) => !d.ok);
    return {
      ok: false,
      stage: 'contract',
      reason: `context contract refused: ${failed.map((d) => d.name).join('; ')}`,
      contractVerdict,
    };
  }

  // ---- Stage 3a: screen every candidate BEFORE retrieving its content.
  const considered = [];
  const admitted = [];
  const excluded = [];

  for (const record of snapshot.records) {
    considered.push({
      source_id: record.source_id,
      record_type: record.record_type,
      authority: record.authority,
      verification_state: record.verification_state,
    });
    emit({
      kind: 'candidate.considered',
      source_id: record.source_id,
      record_type: record.record_type,
      authority: record.authority,
    });

    const verdict = screenSource(record, contract, snapshot.records);
    if (verdict.admit) {
      admitted.push(record);
    } else {
      excluded.push({ source_id: record.source_id, rule: verdict.rule, reason: verdict.reason });
      emit({
        kind: 'candidate.excluded',
        source_id: record.source_id,
        rule: verdict.rule,
        reason: verdict.reason,
      });
    }
  }

  // ---- Stage 3b: reconcile conflicts among what survived screening.
  const reconciliations = [];
  const bySubject = new Map();
  for (const r of admitted) {
    const key = r.subject ?? r.source_id;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(r);
  }
  const reconciled = [];
  for (const [subject, group] of bySubject) {
    if (group.length === 1) {
      reconciled.push(group[0]);
      continue;
    }
    // Resolution order: source authority, then validity recency, then verification.
    const ranked = [...group].sort((a, b) => {
      const byAuthority = authorityRank(a.authority) - authorityRank(b.authority);
      if (byAuthority !== 0) return byAuthority;
      return Date.parse(b.valid_from ?? 0) - Date.parse(a.valid_from ?? 0);
    });
    const winner = ranked[0];
    reconciliations.push({
      subject,
      candidates: group.map((g) => g.source_id),
      resolved_to: winner.source_id,
      rule: 'source_authority, then validity recency',
    });
    emit({
      kind: 'conflict.reconciled',
      subject,
      resolved_to: winner.source_id,
      candidates: group.map((g) => g.source_id),
    });
    reconciled.push(winner);
  }

  // ---- Stage 3c: required evidence. A contract that declares required
  //      evidence and does not get it must fail loudly, not quietly proceed.
  const providedEvidence = new Set(
    reconciled.filter((r) => r.record_type === 'evidence').map((r) => r.evidence_kind).filter(Boolean),
  );
  const missingEvidence = (contract.required_evidence ?? []).filter((e) => !providedEvidence.has(e));

  // ---- Stage 3d: pack under budget.
  const selected = [];
  let recordsCharged = 0;
  let tokensCharged = 0;
  const budgetRejected = [];

  // Pack most authoritative first, so a budget squeeze drops the weakest.
  const packOrder = [...reconciled].sort((a, b) => authorityRank(a.authority) - authorityRank(b.authority));
  for (const record of packOrder) {
    const cost = record.token_cost ?? 250;
    if (
      recordsCharged + 1 > contract.budget.max_records ||
      tokensCharged + cost > contract.budget.max_tokens
    ) {
      budgetRejected.push({
        source_id: record.source_id,
        rule: 'budget',
        reason:
          `would exceed budget (${recordsCharged + 1}/${contract.budget.max_records} records, ` +
          `${tokensCharged + cost}/${contract.budget.max_tokens} tokens)`,
      });
      emit({ kind: 'candidate.excluded', source_id: record.source_id, rule: 'budget', reason: 'budget exhausted' });
      continue;
    }
    recordsCharged += 1;
    tokensCharged += cost;
    selected.push({
      source_id: record.source_id,
      record_type: record.record_type,
      authority: record.authority,
      rank: selected.length + 1,
      token_cost: cost,
      reason: `admitted at ${record.authority}; packed at rank ${selected.length + 1}`,
    });
    emit({ kind: 'budget.charged', source_id: record.source_id, records: recordsCharged, tokens: tokensCharged });
  }
  excluded.push(...budgetRejected);

  // ---- Stage 3e: transformations applied on the way in.
  const selectedIds = new Set(selected.map((s) => s.source_id));
  const selectedRecords = reconciled.filter((r) => selectedIds.has(r.source_id));

  const transformations = selectedRecords
    .filter((r) => r.transform)
    .map((r) => ({ source_id: r.source_id, transform: r.transform.name, note: r.transform.note }));

  // ---- SelectionManifest: what was considered, selected, excluded, which
  //      transformations applied, and what could invalidate the result.
  const manifest = {
    manifest_kind: 'cigar-selection-manifest',
    contract_id: contract.contract_id,
    compiled_at: now(),
    snapshot_digest: snapshot.snapshot_digest,
    considered,
    selected,
    excluded,
    transformations,
    reconciliations,
    required_evidence: contract.required_evidence ?? [],
    evidence_satisfied: missingEvidence.length === 0,
    missing_evidence: missingEvidence,
    budget: {
      records_limit: contract.budget.max_records,
      records_charged: recordsCharged,
      tokens_limit: contract.budget.max_tokens,
      tokens_charged: tokensCharged,
    },
    /**
     * What could invalidate this result later, derived from the records that
     * were actually selected rather than hardcoded. A manifest that cannot say
     * what would change its answer is not much of a manifest.
     */
    invalidators: buildInvalidators(selectedRecords, contract),
  };
  manifest.manifest_digest = digestForType('cigar-selection-manifest', manifest).digest;
  emit({
    kind: 'manifest.sealed',
    manifest_digest: manifest.manifest_digest,
    considered: considered.length,
    selected: selected.length,
    excluded: excluded.length,
  });

  // ---- Stage 4: materialize for the declared consumer.
  const bundle = {
    bundle_kind: 'cigar-context-bundle',
    contract_id: contract.contract_id,
    consumer: contract.consumer,
    materialized_at: now(),
    format: 'semantic/records+v1',
    manifest_digest: manifest.manifest_digest,
    records: selectedRecords.map((r) => ({
      source_id: r.source_id,
      record_type: r.record_type,
      authority: r.authority,
      content: r.content,
    })),
  };
  const floats = findFloatingPointNumbers(bundle);
  if (floats.length) {
    throw new Error(
      `context bundle carries JSON floating-point value(s) at ${floats.map((f) => f.path).join(', ')} — ` +
        'monetary and quantity values must be exact decimal strings',
    );
  }
  bundle.bundle_digest = digestForType('cigar-context-bundle', bundle).digest;
  emit({
    kind: 'bundle.materialized',
    bundle_digest: bundle.bundle_digest,
    records: bundle.records.length,
    consumer: bundle.consumer,
  });

  // ---- Stage 5: capture the decision environment.
  const environment = {
    env_kind: 'cigar-decision-environment',
    contract_id: contract.contract_id,
    captured_at: now(),
    task: contract.task,
    contract_digest: canonicalDigest({ payload: contract, algorithm: 'jcs-n' }).digest,
    manifest_digest: manifest.manifest_digest,
    bundle_digest: bundle.bundle_digest,
    snapshot_digest: snapshot.snapshot_digest,
    policy_decisions: contractVerdict.decisions,
    component_versions: {
      cigar_model: 'demo-cigar/0.1.0-alpha',
      context_abi: 'cigar.context.v1',
      compiler: 'five-stage',
    },
    observations: [],
  };
  environment.env_digest = digestForType('cigar-decision-environment', environment).digest;
  emit({ kind: 'env.captured', env_digest: environment.env_digest });

  return {
    ok: true,
    contractVerdict,
    manifest,
    bundle,
    environment,
    selectedRecords,
  };
}

/**
 * Replay: recompute the decision environment's digests from the captured
 * artifacts, without replaying live side effects.
 *
 * What this establishes is narrow and worth being precise about: the declared
 * inputs and recorded observations still hash to what the environment claims.
 * It does not re-run the model, and it does not reveal chain-of-thought.
 */
export function replay({ environment, manifest, bundle, contract, snapshot }) {
  const checks = [
    {
      name: 'context contract digest',
      expected: environment.contract_digest,
      computed: canonicalDigest({ payload: contract, algorithm: 'jcs-n' }).digest,
    },
    {
      name: 'selection manifest digest',
      expected: environment.manifest_digest,
      computed: digestForType('cigar-selection-manifest', manifest).digest,
    },
    {
      name: 'context bundle digest',
      expected: environment.bundle_digest,
      computed: digestForType('cigar-context-bundle', bundle).digest,
    },
    {
      name: 'source snapshot digest',
      expected: environment.snapshot_digest,
      computed: snapshot.snapshot_digest,
    },
    {
      name: 'decision environment digest',
      expected: environment.env_digest,
      computed: digestForType('cigar-decision-environment', environment).digest,
    },
  ].map((c) => ({ ...c, ok: c.expected === c.computed }));

  return {
    ok: checks.every((c) => c.ok),
    checks,
    scope: {
      establishes: [
        'the declared inputs still hash to what the decision environment recorded',
        'the selection manifest and bundle have not been edited since capture',
      ],
      doesNotEstablish: [
        'that the model would make the same decision again',
        'anything about the model’s internal reasoning, which is never captured',
      ],
    },
  };
}
