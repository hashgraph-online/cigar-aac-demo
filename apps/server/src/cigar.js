import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { canonicalDigest, digestForType, jcs } from '@cigar-aac/cpb';
import { evaluateContract, screenSource, authorityRank } from '@cigar-aac/cigar';

const ROOT = resolve(import.meta.dirname, '../../..');
const BRIDGE = resolve(ROOT, 'apps/server/python/cigar_bridge.py');
export const CIGAR_VERSION = '0.14.0';
const SETUP = 'Run npm run setup:cigar with Python 3.14 installed, then restart the demo server.';

function pythonPath() {
  const executable = process.env.CIGAR_PYTHON || resolve(ROOT, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!isAbsolute(executable) || !existsSync(executable)) {
    throw new Error(`CIGAR ${CIGAR_VERSION} needs an installed Python environment. ${SETUP}`);
  }
  return executable;
}

function python(args, input) {
  const result = spawnSync(pythonPath(), args, {
    input, encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024,
    // The native graph never needs the server's Hedera credentials.
    env: {
      PATH: process.env.PATH ?? '', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
  });
  if (result.error) throw new Error(`CIGAR worker could not complete: ${result.error.code}. ${SETUP}`);
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { throw new Error(`CIGAR returned no valid result (exit ${result.status}). ${SETUP}`); }
  if (result.status !== 0 || body.ok === false) {
    throw new Error(`CIGAR refused the context: ${body.code ?? 'WorkerError'} — ${body.error ?? body.guidance ?? SETUP}`);
  }
  return body;
}

/** Executes a real compile and verify, not just an import/version check. */
export function checkCigarRuntime() {
  try {
    const report = python(['-m', 'cigar_sdk.local_cli', 'doctor', '--json']);
    const ready = report.status === 'ready' && report.compile_verified === true &&
      report.capabilities?.package_version === CIGAR_VERSION && report.worker_capabilities?.core_version === CIGAR_VERSION;
    return { ready, package: 'hol-cigar', version: CIGAR_VERSION, report, error: ready ? null : `CIGAR runtime/version check failed. ${SETUP}` };
  } catch (error) {
    return { ready: false, package: 'hol-cigar', version: CIGAR_VERSION, error: error.message };
  }
}

export function executeNativeContext({ scenario, contract, records, runId }) {
  return python([BRIDGE], JSON.stringify({ scenario, contract, records, ...(runId ? { domain: `northwind-settlement/${runId}` } : {}) })).result;
}

/**
 * Business policy is owned by this host. The official CIGAR 0.14.0 worker
 * enforces the resulting source scope, required evidence closure, exact token
 * budget and review bindings. These adapter artifacts are demo profile types;
 * the unmodified native output is carried and separately bound with JCS.
 */
export function compileContext({ scenario, contract, snapshot, governance, emit = () => {}, now, runId }) {
  const contractVerdict = evaluateContract(contract, governance);
  for (const decision of contractVerdict.decisions) emit({ kind: 'policy.evaluated', ...decision });
  if (!contractVerdict.ok) throw new Error('The host context contract was refused before retrieval');

  const considered = [], excluded = [], admitted = [];
  for (const record of snapshot.records) {
    considered.push({ source_id: record.source_id, record_type: record.record_type, authority: record.authority, verification_state: record.verification_state });
    emit({ kind: 'candidate.considered', ...considered.at(-1) });
    const verdict = screenSource(record, contract, snapshot.records);
    if (verdict.admit) admitted.push(record);
    else {
      const exclusion = { source_id: record.source_id, rule: verdict.rule, reason: verdict.reason };
      excluded.push(exclusion);
      emit({ kind: 'candidate.excluded', ...exclusion });
    }
  }

  const bySubject = new Map(), reconciliations = [];
  for (const record of admitted) {
    const key = record.subject ?? record.source_id;
    bySubject.set(key, [...(bySubject.get(key) ?? []), record]);
  }
  const candidates = [];
  for (const [subject, group] of bySubject) {
    const ranked = [...group].sort((a, b) => authorityRank(a.authority) - authorityRank(b.authority) || Date.parse(b.valid_from ?? 0) - Date.parse(a.valid_from ?? 0));
    candidates.push(ranked[0]);
    if (ranked.length > 1) {
      const reconciliation = { subject, candidates: ranked.map((r) => r.source_id), resolved_to: ranked[0].source_id, rule: 'source authority, then validity recency' };
      reconciliations.push(reconciliation);
      emit({ kind: 'conflict.reconciled', ...reconciliation });
      for (const loser of ranked.slice(1)) {
        const exclusion = { source_id: loser.source_id, rule: 'conflict_resolution', reason: `resolved to ${ranked[0].source_id}` };
        excluded.push(exclusion);
        emit({ kind: 'candidate.excluded', ...exclusion });
      }
    }
  }

  const native = executeNativeContext({ scenario, contract, records: candidates, runId });
  const nativeDigest = digestForType('cigar-native-execution', native).digest;
  const selectedIds = Object.keys(native.selected);
  const selectedRecords = selectedIds.map((id) => {
    const original = candidates.find((r) => r.source_id === id);
    if (!original || jcs(original.content) !== jcs(native.selected[id])) throw new Error('CIGAR returned a source outside the authorized input');
    return { ...original, content: native.selected[id] };
  });
  const missingEvidence = contract.required_evidence.filter((kind) => !selectedRecords.some((r) => r.evidence_kind === kind));
  if (missingEvidence.length) throw new Error(`CIGAR context lacks required evidence: ${missingEvidence.join(', ')}`);
  for (const candidate of candidates.filter((r) => !selectedIds.includes(r.source_id))) {
    const exclusion = { source_id: candidate.source_id, rule: 'native_selection', reason: 'not selected by the CIGAR graph within the declared budget' };
    excluded.push(exclusion);
    emit({ kind: 'candidate.excluded', ...exclusion });
  }

  const nativeSnapshot = native.compiled.context.snapshot;
  const tokens = nativeSnapshot.stats.rendered_tokens;
  emit({ kind: 'budget.charged', source_id: 'complete rendered context, including citations', records: selectedIds.length, tokens });
  emit({ kind: 'context.compiled', package: native.package, version: native.version, snapshot_id: nativeSnapshot.id,
    tokens, available_tokens: nativeSnapshot.stats.available_tokens, sources: selectedIds.length,
    review: native.assessment.assessment.decision, missing_review: native.missing_review.assessment.decision });

  const manifest = {
    manifest_kind: 'cigar-selection-manifest', contract_id: contract.contract_id, compiled_at: now(),
    snapshot_digest: snapshot.snapshot_digest, considered,
    selected: selectedRecords.map((r, index) => ({ source_id: r.source_id, record_type: r.record_type, authority: r.authority,
      rank: index + 1, reason: 'selected by hol-cigar 0.14.0 with its required dependency closure' })),
    excluded, reconciliations, required_evidence: contract.required_evidence, evidence_satisfied: true, missing_evidence: [],
    transformations: selectedRecords.filter((r) => r.transform).map((r) => ({ source_id: r.source_id, transform: r.transform.name, note: r.transform.note })),
    budget: { records_limit: contract.budget.max_records, records_charged: selectedIds.length,
      tokens_limit: contract.budget.max_tokens, tokens_reserved: contract.budget.reserve_tokens ?? 512,
      tokens_available: nativeSnapshot.stats.available_tokens, tokens_charged: tokens, tokenizer: nativeSnapshot.tokenizer },
    native_snapshot_id: nativeSnapshot.id,
    invalidators: [
      { condition: 'any source or relationship inside the authorized view changes; compile again and obtain fresh reviews', affects: selectedIds },
      { condition: 'the host changes or revokes the source scope or treasury policy', affects: ['*'] },
      ...selectedRecords.filter((r) => r.valid_to).map((r) => ({ condition: `${r.source_id} expires at ${r.valid_to}`, affects: [r.source_id] })),
    ],
  };
  manifest.manifest_digest = digestForType('cigar-selection-manifest', manifest).digest;
  emit({ kind: 'manifest.sealed', manifest_digest: manifest.manifest_digest, considered: considered.length, selected: selectedIds.length, excluded: excluded.length });

  const bundle = {
    bundle_kind: 'cigar-context-bundle', contract_id: contract.contract_id, consumer: contract.consumer, materialized_at: now(),
    format: 'semantic/records+v1', manifest_digest: manifest.manifest_digest, native_execution_digest: nativeDigest,
    records: selectedRecords.map((r) => ({ source_id: r.source_id, record_type: r.record_type, authority: r.authority, content: r.content })),
  };
  bundle.bundle_digest = digestForType('cigar-context-bundle', bundle).digest;
  emit({ kind: 'bundle.materialized', bundle_digest: bundle.bundle_digest, records: selectedIds.length, consumer: bundle.consumer });

  const environment = {
    env_kind: 'cigar-decision-environment', contract_id: contract.contract_id, captured_at: now(), task: contract.task,
    contract_digest: canonicalDigest({ payload: contract, algorithm: 'jcs-n' }).digest,
    manifest_digest: manifest.manifest_digest, bundle_digest: bundle.bundle_digest, snapshot_digest: snapshot.snapshot_digest,
    native_execution_digest: nativeDigest, policy_decisions: contractVerdict.decisions,
    component_versions: { hol_cigar: CIGAR_VERSION, adapter: 'hol-proof-of-action/0.2.0', context_abi: 'cigar.context.v1', compiler: 'native Rust worker via Python' },
    observations: [],
  };
  environment.env_digest = digestForType('cigar-decision-environment', environment).digest;
  emit({ kind: 'env.captured', env_digest: environment.env_digest });
  return { ok: true, contractVerdict, manifest, bundle, environment, selectedRecords, native, nativeDigest };
}
