import { describe, it, expect } from 'vitest';
import { jcs } from './jcs.js';

describe('RFC 8785 Unicode', () => {
  it.each(['\ud800', '\udfff', 'before\ud800after'])('rejects lone surrogate values and keys', (bad) => {
    expect(() => jcs({ value: bad })).toThrow(/lone surrogate/);
    expect(() => jcs({ [bad]: 'value' })).toThrow(/lone surrogate/);
  });
  it('preserves valid supplementary characters and decomposed Unicode', () => {
    expect(jcs({ value: '😀 e\u0301' })).toBe('{"value":"😀 é"}');
  });
});
