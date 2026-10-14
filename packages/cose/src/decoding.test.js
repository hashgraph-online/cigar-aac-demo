import { describe, it, expect } from 'vitest';
import { decode, CborError } from './cbor.js';

describe('untrusted COSE CBOR decoding', () => {
  it.each(['58', '5900', '5a000000', '5b00000000000000', '430102', '636162', '8201', 'a101'])('rejects truncated input %s', (hex) => {
    expect(() => decode(Buffer.from(hex, 'hex'))).toThrow(CborError);
  });
  it.each(['a201010102', 'a20101180102'])('rejects duplicate map keys including alternate encodings %s', (hex) => {
    expect(() => decode(Buffer.from(hex, 'hex'))).toThrow(/duplicate map key/);
  });
  it('rejects invalid UTF-8 instead of replacing bytes', () => {
    expect(() => decode(Buffer.from('62c080', 'hex'))).toThrow(/invalid UTF-8/);
  });
  it('bounds nesting and integer precision', () => {
    expect(() => decode(Buffer.concat([Buffer.alloc(70, 0x81), Buffer.from([0x00])]))).toThrow(/nesting limit/);
    expect(() => decode(Buffer.from('1bffffffffffffffff', 'hex'))).toThrow(/safe integer/);
  });
});
