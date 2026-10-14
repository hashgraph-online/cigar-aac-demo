import { describe, it, expect } from 'vitest';
import { jcs, JcsError } from './jcs.js';
import { normalizeJcsN } from './normalize.js';
import {
  canonicalDigest,
  digestForType,
  typedRef,
  verifyTypedRef,
  findFloatingPointNumbers,
  idBytes,
} from './digest.js';

describe('RFC 8785 JCS — known-answer vectors', () => {
  it('matches the RFC 8785 worked example', () => {
    // Assembled from code points so no escaping layer can quietly alter the
    // vector. Input string is: EURO, '$', U+000F, LF, 'A', apostrophe, 'B',
    // '"', backslash, backslash, '"', '/'.
    const ch = (...codes) => codes.map((c) => String.fromCharCode(c)).join('');
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: ch(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f),
      literals: [null, true, false],
    };

    // Expected canonical output. JCS escapes U+000F as the six characters
    // \u000f, LF as \n, each quote as \", and each backslash as \\.
    const B = ch(0x5c);
    const expectedString =
      ch(0x20ac, 0x24) + B + 'u000f' + B + 'n' + "A'B" + B + '"' + B + B + B + B + B + '"/';
    const expected =
      '{"literals":[null,true,false],' +
      '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"' + expectedString + '"}';

    expect(jcs(input)).toBe(expected);
  });

  it('sorts object members by UTF-16 code unit, not by locale', () => {
    // Capital letters sort before lowercase in UTF-16; a locale-aware sort
    // would interleave them and produce a different digest.
    expect(jcs({ b: 1, A: 2, a: 3, B: 4 })).toBe('{"A":2,"B":4,"a":3,"b":1}');
  });

  it('sorts nested members independently at each level', () => {
    expect(jcs({ z: { y: 1, x: 2 }, a: [{ c: 1, b: 2 }] })).toBe(
      '{"a":[{"b":2,"c":1}],"z":{"x":2,"y":1}}',
    );
  });

  it('serializes negative zero as 0', () => {
    expect(jcs({ v: -0 })).toBe('{"v":0}');
  });

  it('emits no insignificant whitespace', () => {
    expect(jcs({ a: [1, 2], b: {} })).toBe('{"a":[1,2],"b":{}}');
  });

  it('preserves array order', () => {
    expect(jcs([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits non-ASCII raw rather than escaped', () => {
    const umlautU = String.fromCharCode(0xfc);
    const name = 'M' + umlautU + 'nchen';
    expect(jcs({ k: name })).toBe('{"k":"' + name + '"}');
  });
});

describe('JCS MUST-FAIL cases', () => {
  it('rejects NaN and Infinity', () => {
    expect(() => jcs({ v: NaN })).toThrow(JcsError);
    expect(() => jcs({ v: Infinity })).toThrow(JcsError);
  });

  it('rejects undefined members instead of silently dropping them', () => {
    // JSON.stringify would drop this member. Silently dropping a member is
    // how two implementations produce two digests for "the same" payload.
    expect(() => jcs({ a: 1, b: undefined })).toThrow(/undefined/);
  });

  it('rejects a Date rather than guessing a serialization', () => {
    expect(() => jcs({ t: new Date(0) })).toThrow(/RFC 3339/);
  });

  it('does not mutate the input key order', () => {
    const input = { b: 1, a: 2 };
    jcs(input);
    expect(Object.keys(input)).toEqual(['b', 'a']);
  });
});

describe('jcs-n normalization', () => {
  it('removes null, empty-array and empty-object members', () => {
    expect(normalizeJcsN({ a: 1, b: null, c: [], d: {} })).toEqual({ a: 1 });
  });

  it('removes bottom-up, so a container emptied by removal is itself removed', () => {
    // The load-bearing case. A top-down pass would leave {"a":{}}.
    expect(normalizeJcsN({ a: { b: null }, keep: 1 })).toEqual({ keep: 1 });
  });

  it('collapses arbitrarily deep nesting bottom-up', () => {
    expect(normalizeJcsN({ a: { b: { c: { d: null } } }, keep: 1 })).toEqual({ keep: 1 });
  });

  it('preserves null array elements, which are not members', () => {
    // Dropping these would change the array length and therefore its meaning.
    expect(normalizeJcsN({ a: [1, null, 2] })).toEqual({ a: [1, null, 2] });
  });

  it('preserves false, 0 and empty string, which are not emptyish', () => {
    expect(normalizeJcsN({ a: false, b: 0, c: '' })).toEqual({ a: false, b: 0, c: '' });
  });

  it('produces a different digest than plain jcs for the same payload', () => {
    // This is CPB's whole reason to exist: declaring the algorithm is not
    // optional decoration. Two honest implementations disagreeing here is
    // exactly the class of failure the CPB vector suite pins down.
    const payload = { amount: '48200.00', memo: null };
    const plain = canonicalDigest({ payload, algorithm: 'jcs' });
    const normalized = canonicalDigest({ payload, algorithm: 'jcs-n' });
    expect(plain.canonical).toBe('{"amount":"48200.00","memo":null}');
    expect(normalized.canonical).toBe('{"amount":"48200.00"}');
    expect(plain.digest).not.toBe(normalized.digest);
  });
});

describe('canonical digest', () => {
  it('is 64 lowercase hex characters', () => {
    const { digest } = canonicalDigest({ payload: { a: 1 } });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches SHA-256 of the canonical bytes computed independently', async () => {
    const { createHash } = await import('node:crypto');
    const payload = { z: 1, a: 'two' };
    const { digest, canonical } = canonicalDigest({ payload, algorithm: 'jcs' });
    expect(canonical).toBe('{"a":"two","z":1}');
    expect(digest).toBe(createHash('sha256').update(canonical, 'utf8').digest('hex'));
  });

  it('is stable across key insertion order', () => {
    const a = canonicalDigest({ payload: { one: 1, two: 2, three: 3 } });
    const b = canonicalDigest({ payload: { three: 3, one: 1, two: 2 } });
    expect(a.digest).toBe(b.digest);
  });

  it('removes the exclusion set before canonicalizing', () => {
    const payload = { capsule_id: 'deadbeef', action_id: 'act-1' };
    const { canonical } = canonicalDigest({
      payload,
      algorithm: 'jcs',
      exclusionSet: ['capsule_id'],
    });
    expect(canonical).toBe('{"action_id":"act-1"}');
  });

  it('refuses a reserved algorithm', () => {
    expect(() => canonicalDigest({ payload: {}, algorithm: 'cde-n' })).toThrow(/reserved/);
  });
});

describe('typed digest references', () => {
  const handoff = {
    recipient: 'ap-settlement-agent',
    capabilities: ['payments:dispatch'],
    budget: { amount_max: '50000.00', currency: 'EUR' },
  };

  it('carries the three required members', () => {
    const ref = typedRef('cigar-signed-handoff', handoff);
    expect(ref.type).toBe('cigar-signed-handoff');
    expect(ref.digest_alg).toBe('SHA-256');
    expect(ref.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries extra members such as the composition slot', () => {
    const ref = typedRef('cigar-signed-handoff', handoff, { slot: 'can' });
    expect(ref.slot).toBe('can');
  });

  it('verifies against the byte-identical artifact', () => {
    const ref = typedRef('cigar-signed-handoff', handoff, { slot: 'can' });
    const result = verifyTypedRef(ref, handoff);
    expect(result.ok).toBe(true);
    expect(result.actual).toBe(ref.digest);
  });

  it('fails on a single changed character and reports both digests', () => {
    const ref = typedRef('cigar-signed-handoff', handoff);
    const tampered = { ...handoff, budget: { amount_max: '50000.01', currency: 'EUR' } };
    const result = verifyTypedRef(ref, tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('digest mismatch');
    expect(result.actual).not.toBe(result.expected);
  });

  it('resolves the digest context from the registry, not from the reference', () => {
    const ref = typedRef('cigar-signed-handoff', handoff);
    // A producer trying to smuggle in its own digest rule must be ignored.
    const hostile = { ...ref, algorithm: 'jcs', exclusionSet: ['budget'] };
    const result = verifyTypedRef(hostile, handoff);
    expect(result.ok).toBe(true);
    expect(result.context.algorithm).toBe('jcs-n');
    expect(result.context.exclusionSet).toEqual([]);
  });

  it('refuses an unknown artifact type rather than guessing', () => {
    expect(() => verifyTypedRef({ type: 'not-registered', digest_alg: 'SHA-256' }, {})).toThrow(
      /must not guess/,
    );
  });

  it('flags demo-local proposed types so the UI can label them', () => {
    const ref = typedRef('cigar-context-bundle', { a: 1 });
    expect(verifyTypedRef(ref, { a: 1 }).context.proposed).toBe(true);
    const capsuleRef = typedRef('agent-action-capsule', { a: 1 });
    expect(verifyTypedRef(capsuleRef, { a: 1 }).context.proposed).toBe(false);
  });

  it('pins the registered digest context for agent-action-capsule', () => {
    const capsule = { capsule_id: 'ff'.repeat(32), action_id: 'act-1', chain: { parent: 'x' } };
    const { canonical } = digestForType('agent-action-capsule', capsule);
    // Format 4: only capsule_id is excluded; `chain` stays in the preimage.
    expect(canonical).toBe('{"action_id":"act-1","chain":{"parent":"x"}}');
  });
});

describe('monetary value discipline', () => {
  it('flags JSON floating-point numbers', () => {
    const hits = findFloatingPointNumbers({ invoice: { amount: 48200.5 } });
    expect(hits).toEqual([{ path: '/invoice/amount', value: 48200.5 }]);
  });

  it('accepts exact decimal strings', () => {
    expect(findFloatingPointNumbers({ invoice: { amount: '48200.00' } })).toEqual([]);
  });

  it('shows why the rule exists: 0.1 + 0.2 does not round-trip', () => {
    const asFloat = canonicalDigest({ payload: { amount: 0.1 + 0.2 } });
    const asIntended = canonicalDigest({ payload: { amount: 0.3 } });
    expect(asFloat.canonical).toBe('{"amount":0.30000000000000004}');
    expect(asFloat.digest).not.toBe(asIntended.digest);
  });
});

describe('log leaf preimage — raw bytes, not the hex string', () => {
  it('decodes a derived identifier to 32 bytes', () => {
    const id = 'a'.repeat(64);
    expect(idBytes(id)).toHaveLength(32);
  });

  it('rejects uppercase hex and wrong lengths', () => {
    expect(() => idBytes('A'.repeat(64))).toThrow();
    expect(() => idBytes('ab')).toThrow();
  });

  it('is 32 bytes, not the 64 ASCII bytes of the hex string', () => {
    const id = 'a'.repeat(64);
    expect(idBytes(id).length).toBe(32);
    expect(Buffer.from(id, 'utf8').length).toBe(64);
  });
});
