import { describe, it, expect } from 'vitest';
import { parseJson } from './json.js';

describe('unambiguous JSON input for digest verification', () => {
  it.each([
    '{"a":1,"a":2}',
    '{"nested":{"amount":"1.00","amount":"2.00"}}',
    '[{"a":1,"\\u0061":2}]',
    '{"__proto__":{},"__proto__":null}',
  ])('rejects duplicate names before they can be silently overwritten: %s', (source) => {
    expect(() => parseJson(source)).toThrow(/duplicate JSON member/);
  });
  it('keeps object scopes, escaped strings and values distinct', () => {
    const source = '{"a":[{"a":"a","quoted\\\"name":"x"},{"a":null}],"b":{},"c":[],"value":"{\\\"a\\\":1}"}';
    expect(parseJson(source)).toEqual(JSON.parse(source));
  });
  it.each(['{"a":', '{"a":1,}', 'undefined'])('rejects invalid syntax: %s', (source) => {
    expect(() => parseJson(source)).toThrow('This file is not valid JSON.');
  });
  it('bounds nested input without recursing in JavaScript', () => {
    expect(() => parseJson('['.repeat(129) + '0' + ']'.repeat(129))).toThrow(/nesting/);
    expect(parseJson('['.repeat(128) + '0' + ']'.repeat(128))).toBeInstanceOf(Array);
  });
});
