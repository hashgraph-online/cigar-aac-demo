import { describe, it, expect } from 'vitest';
import { witnessStatus } from './experience.js';

describe('witness claims track evidence, never configuration', () => {
  it('does not call a local receipt independent public confirmation', () => {
    const state = witnessStatus({ bundle: { scitt: {} } });
    expect(state.label).toBe('Local witness only');
    expect(state.detail).toMatch(/No independent public timestamp/);
  });
  it('keeps an unconfirmed submission visibly pending', () => {
    expect(witnessStatus({ bundle: { scitt: { hedera: {} } }, verification: { summary: { public_anchor: { confirmed: false } } } }).state).toBe('warn');
  });
  it('claims confirmation only when the verifier confirms it', () => {
    expect(witnessStatus({ bundle: { scitt: { hedera: {} } }, verification: { summary: { public_anchor: { confirmed: true } } } }).label).toBe('Confirmed on Hedera');
  });
  it('preserves an anchoring failure instead of silently falling back', () => {
    const state = witnessStatus({ bundle: { scitt: { hedera_error: 'network unavailable' } } });
    expect(state.state).toBe('warn');
    expect(state.detail).toBe('network unavailable');
  });
});
