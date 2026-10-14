import { describe, it, expect, afterEach, vi } from 'vitest';
import { runScenario } from './engine.js';
import { compileContext, checkCigarRuntime } from './cigar.js';
import { buildContract, buildSources, GOVERNANCE } from './corpus.js';
import { ingest } from '@cigar-aac/cigar';
import { verifyEvidenceBundle } from '@cigar-aac/verifier';

afterEach(() => vi.unstubAllEnvs());
const now = () => '2026-09-21T14:00:00Z';

describe('published hol-cigar 0.14.0 execution', () => {
  const run = runScenario('poisoned-context');
  const native = run.bundle.referenced_artifacts.cigar_execution;

  it('uses the installed native worker, not the legacy compiler', () => {
    expect(native.package).toBe('hol-cigar');
    expect(native.version).toBe('0.14.0');
    expect(native.capabilities.core_version).toBe('0.14.0');
    expect(native.capabilities.features).toContain('context_views.v1');
    expect(native.snapshot_verified).toBe(true);
    expect(native.compiled.context.view.id).toBe('treasury-settlement');
  });
  it('bases the decision context on native selected evidence and an exact budget', () => {
    const { snapshot } = native.compiled.context;
    expect(snapshot.tokenizer).toMatch(/^o200k_base/);
    expect(snapshot.stats.rendered_tokens).toBe(run.artifacts.manifest.budget.tokens_charged);
    expect(snapshot.stats.rendered_tokens).toBeLessThanOrEqual(snapshot.stats.available_tokens);
    expect(snapshot.stats.available_tokens).toBe(7488);
    expect(Object.keys(native.selected).sort()).toEqual(run.artifacts.contextBundle.records.map((r) => r.source_id).sort());
    for (const record of run.artifacts.contextBundle.records) expect(record.content).toEqual(native.selected[record.source_id]);
    expect(JSON.stringify(native)).not.toContain('LT12');
    expect(JSON.stringify(native)).not.toContain('1844200');
  });
  it('executes review release and missing-review abstention', () => {
    expect(native.assessment.assessment.decision).toBe('release');
    expect(native.missing_review.assessment.decision).toBe('abstain');
    expect(native.assessment.assessment.snapshot_id).toBe(native.compiled.context.snapshot.id);
    expect(native.reviewer).toBe('scripted-fixture');
  });
  it('binds the untouched native artifact to signed AAC evidence', () => {
    const changed = structuredClone(run.bundle);
    changed.referenced_artifacts.cigar_execution.compiled.context.snapshot.blocks[0].text += 'edited';
    const verdict = verifyEvidenceBundle(changed);
    expect(verdict.ok).toBe(false);
    expect(verdict.checks.some((check) => !check.ok && check.name.includes('cigar-native-execution'))).toBe(true);
  });
  it('rejects a missing native artifact', () => {
    const changed = structuredClone(run.bundle);
    delete changed.referenced_artifacts.cigar_execution;
    expect(verifyEvidenceBundle(changed).ok).toBe(false);
  });
  it('fails closed when required evidence cannot fit in the budget', () => {
    const contract = buildContract();
    contract.budget.max_tokens = 80;
    contract.budget.reserve_tokens = 0;
    expect(() => compileContext({ scenario: 'clean-settlement', contract, snapshot: ingest(buildSources(), { now }), governance: GOVERNANCE, now })).toThrow(/CIGAR/);
  });
  it('fails closed when a hard dependency was withdrawn', () => {
    const sources = buildSources().filter((record) => !record.source_id.includes('goods-receipt'));
    expect(() => compileContext({ scenario: 'clean-settlement', contract: buildContract(), snapshot: ingest(sources, { now }), governance: GOVERNANCE, now })).toThrow(/CIGAR/);
  });
  it('does not silently revert to a local model if Python is unavailable', () => {
    vi.stubEnv('CIGAR_PYTHON', '/not-installed/cigar-demo/python');
    expect(checkCigarRuntime().ready).toBe(false);
    expect(() => runScenario('clean-settlement')).toThrow(/setup:cigar/);
  });
  it('rejects an empty proof instead of returning a vacuous PASS', () => {
    const changed = structuredClone(run.bundle);
    changed.capsules = [];
    expect(verifyEvidenceBundle(changed).ok).toBe(false);
  });
});
