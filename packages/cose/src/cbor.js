/**
 * Minimal deterministic CBOR (RFC 8949) — enough for COSE, and small enough to
 * read aloud in a room full of people who are entitled to be suspicious.
 *
 * Deterministic encoding requirements applied (RFC 8949 section 4.2.1):
 *   - integers and lengths use the shortest form that fits
 *   - definite-length encoding only
 *   - map keys are sorted by the bytewise lexicographic order of their
 *     own deterministic encodings
 *
 * That last rule is why two implementations can agree on the bytes a signature
 * covers. Without it, "the same" COSE structure has many encodings and a
 * verifier cannot recompute what was signed.
 */

const MAJOR = {
  UINT: 0,
  NINT: 1,
  BSTR: 2,
  TSTR: 3,
  ARRAY: 4,
  MAP: 5,
  TAG: 6,
  SIMPLE: 7,
};

export class CborError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CborError';
  }
}

/** A CBOR tagged value. */
export class Tagged {
  constructor(tag, value) {
    this.tag = tag;
    this.value = value;
  }
}

function head(major, argument) {
  const n = BigInt(argument);
  if (n < 0n) throw new CborError('head argument must be non-negative');
  const mt = major << 5;
  if (n < 24n) return Buffer.from([mt | Number(n)]);
  if (n <= 0xffn) return Buffer.from([mt | 24, Number(n)]);
  if (n <= 0xffffn) {
    const b = Buffer.alloc(3);
    b[0] = mt | 25;
    b.writeUInt16BE(Number(n), 1);
    return b;
  }
  if (n <= 0xffffffffn) {
    const b = Buffer.alloc(5);
    b[0] = mt | 26;
    b.writeUInt32BE(Number(n), 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = mt | 27;
  b.writeBigUInt64BE(n, 1);
  return b;
}

/**
 * Encode a JS value as deterministic CBOR.
 *
 * Mapping: Buffer/Uint8Array -> bstr, string -> tstr, safe integer -> uint/nint,
 * Array -> array, Map -> map (preferred: keys may be integers), plain object ->
 * map with text keys, Tagged -> tag, null/true/false -> simple values.
 */
export function encode(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === undefined) return Buffer.from([0xf7]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === false) return Buffer.from([0xf4]);

  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      // Floats are deliberately unsupported: every value this demo signs is an
      // integer, a string or a byte string, and a float would be one more way
      // for two encoders to disagree.
      throw new CborError(`non-integer or unsafe number ${value} is not supported`);
    }
    const n = BigInt(value);
    return n >= 0n ? head(MAJOR.UINT, n) : head(MAJOR.NINT, -1n - n);
  }

  if (Buffer.isBuffer(value)) return Buffer.concat([head(MAJOR.BSTR, value.length), value]);
  if (value instanceof Uint8Array) {
    const b = Buffer.from(value);
    return Buffer.concat([head(MAJOR.BSTR, b.length), b]);
  }

  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([head(MAJOR.TSTR, b.length), b]);
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => encode(v));
    return Buffer.concat([head(MAJOR.ARRAY, value.length), ...items]);
  }

  if (value instanceof Tagged) {
    return Buffer.concat([head(MAJOR.TAG, value.tag), encode(value.value)]);
  }

  if (value instanceof Map) return encodeMapEntries([...value.entries()]);
  if (typeof value === 'object') return encodeMapEntries(Object.entries(value));

  throw new CborError(`cannot encode value of type ${typeof value}`);
}

function encodeMapEntries(entries) {
  const encoded = entries.map(([k, v]) => ({ k: encode(k), v: encode(v) }));
  // Deterministic map ordering: bytewise lexicographic on the encoded key.
  encoded.sort((a, b) => Buffer.compare(a.k, b.k));
  for (let i = 1; i < encoded.length; i += 1) {
    if (Buffer.compare(encoded[i - 1].k, encoded[i].k) === 0) {
      throw new CborError('duplicate map key in deterministic CBOR');
    }
  }
  return Buffer.concat([
    head(MAJOR.MAP, encoded.length),
    ...encoded.flatMap(({ k, v }) => [k, v]),
  ]);
}

/** Decode CBOR. Returns { value, bytesRead }. Maps decode to Map. */
export function decodeFirst(buf, offset = 0, depth = 0) {
  if (depth > 64) throw new CborError('CBOR nesting limit exceeded');
  if (offset >= buf.length) throw new CborError('unexpected end of CBOR input');
  const ib = buf[offset];
  const major = ib >> 5;
  const ai = ib & 0x1f;
  let pos = offset + 1;
  let arg = BigInt(ai);
  const extra = { 24: 1, 25: 2, 26: 4, 27: 8 }[ai] ?? 0;
  if (pos + extra > buf.length) throw new CborError('truncated CBOR argument');

  if (ai === 24) {
    arg = BigInt(buf[pos]);
    pos += 1;
  } else if (ai === 25) {
    arg = BigInt(buf.readUInt16BE(pos));
    pos += 2;
  } else if (ai === 26) {
    arg = BigInt(buf.readUInt32BE(pos));
    pos += 4;
  } else if (ai === 27) {
    arg = buf.readBigUInt64BE(pos);
    pos += 8;
  } else if (ai >= 28 && ai <= 30) {
    throw new CborError(`reserved additional information ${ai}`);
  } else if (ai === 31) {
    throw new CborError('indefinite-length items are not permitted');
  }

  if (arg > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError('CBOR value exceeds the safe integer range');
  const n = Number(arg);

  switch (major) {
    case MAJOR.UINT:
      return { value: n, bytesRead: pos - offset };
    case MAJOR.NINT:
      return { value: -1 - n, bytesRead: pos - offset };
    case MAJOR.BSTR: {
      if (pos + n > buf.length) throw new CborError('truncated byte string');
      const value = buf.subarray(pos, pos + n);
      return { value: Buffer.from(value), bytesRead: pos + n - offset };
    }
    case MAJOR.TSTR: {
      if (pos + n > buf.length) throw new CborError('truncated text string');
      let value;
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(pos, pos + n)); }
      catch { throw new CborError('invalid UTF-8 text string'); }
      return { value, bytesRead: pos + n - offset };
    }
    case MAJOR.ARRAY: {
      if (n > buf.length - pos) throw new CborError('truncated CBOR array');
      const out = [];
      let p = pos;
      for (let i = 0; i < n; i += 1) {
        const r = decodeFirst(buf, p, depth + 1);
        out.push(r.value);
        p += r.bytesRead;
      }
      return { value: out, bytesRead: p - offset };
    }
    case MAJOR.MAP: {
      if (n * 2 > buf.length - pos) throw new CborError('truncated CBOR map');
      const seen = new Set();
      const out = new Map();
      let p = pos;
      for (let i = 0; i < n; i += 1) {
        const k = decodeFirst(buf, p, depth + 1);
        p += k.bytesRead;
        const v = decodeFirst(buf, p, depth + 1);
        p += v.bytesRead;
        if (!['number', 'string'].includes(typeof k.value)) throw new CborError('this COSE profile supports only integer or text map keys');
        const identity = encode(k.value).toString('hex');
        if (seen.has(identity)) throw new CborError('duplicate map key');
        seen.add(identity);
        out.set(k.value, v.value);
      }
      return { value: out, bytesRead: p - offset };
    }
    case MAJOR.TAG: {
      const inner = decodeFirst(buf, pos, depth + 1);
      return {
        value: new Tagged(n, inner.value),
        bytesRead: pos + inner.bytesRead - offset,
      };
    }
    case MAJOR.SIMPLE:
      if (ai === 20) return { value: false, bytesRead: pos - offset };
      if (ai === 21) return { value: true, bytesRead: pos - offset };
      if (ai === 22) return { value: null, bytesRead: pos - offset };
      if (ai === 23) return { value: undefined, bytesRead: pos - offset };
      throw new CborError(`unsupported simple/float value (ai=${ai})`);
    default:
      throw new CborError(`unsupported major type ${major}`);
  }
}

export function decode(buf) {
  const { value, bytesRead } = decodeFirst(buf, 0);
  if (bytesRead !== buf.length) {
    throw new CborError(`trailing bytes after CBOR item (${buf.length - bytesRead} extra)`);
  }
  return value;
}
