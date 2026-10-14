/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * The whole point of this file is that two independent implementations must
 * produce the same bytes for the same logical payload. CPB calls that
 * "one digest, one meaning, in anyone's verifier". Getting it wrong is the
 * exact failure the CPB conformance vector suite exists to pin.
 *
 * Three rules do the work:
 *   1. Object members are sorted by the UTF-16 code units of their names.
 *   2. Numbers use ECMAScript Number::toString (what JSON.stringify emits).
 *   3. No insignificant whitespace.
 */

/** Serialize a JSON string per RFC 8785's escaping table. */
function serializeString(s) {
  // RFC 8785 §3.2.2.2 rejects unpaired UTF-16 surrogates, including in keys.
  if (!s.isWellFormed()) throw new JcsError('lone surrogate is not valid I-JSON Unicode');
  // JSON.stringify's escaping already matches RFC 8785: the short forms
  // \" \\ \b \f \n \r \t, \u00xx (lowercase hex) for remaining C0 controls,
  // and non-ASCII emitted raw as UTF-8.
  return JSON.stringify(s);
}

/** Serialize a JSON number per RFC 8785 (ECMAScript Number::toString). */
function serializeNumber(n) {
  if (!Number.isFinite(n)) {
    throw new JcsError(`non-finite number cannot be canonicalized: ${n}`);
  }
  // JSON.stringify(-0) === "0", which is what RFC 8785 requires.
  return JSON.stringify(n);
}

export class JcsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JcsError';
  }
}

/**
 * Canonicalize a JSON value to its RFC 8785 string form.
 * @param {unknown} value
 * @returns {string}
 */
export function jcs(value) {
  return serialize(value, []);
}

function serialize(value, path) {
  const where = () => (path.length ? ` at /${path.join('/')}` : '');

  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      try {
        return serializeNumber(value);
      } catch (e) {
        throw new JcsError(`${e.message}${where()}`);
      }
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new JcsError(`value of type ${typeof value} is not JSON${where()}`);
  }

  if (Array.isArray(value)) {
    const parts = value.map((el, i) => serialize(el, [...path, String(i)]));
    return `[${parts.join(',')}]`;
  }

  // I-JSON: reject the things that silently change meaning across languages.
  if (value instanceof Date) {
    throw new JcsError(`Date is not a JSON value — pass an RFC 3339 string${where()}`);
  }

  const keys = Object.keys(value);
  // Default JS string comparison is by UTF-16 code unit, which is exactly
  // what RFC 8785 specifies. Copy before sorting; never mutate the caller's key order.
  const sorted = [...keys].sort();

  const parts = [];
  for (const key of sorted) {
    const v = value[key];
    if (v === undefined) {
      // `undefined` is not a JSON value. JSON.stringify would silently drop
      // the member; dropping it silently is how two implementations disagree.
      throw new JcsError(`member "${key}" is undefined — omit it or use null${where()}`);
    }
    parts.push(`${serializeString(key)}:${serialize(v, [...path, key])}`);
  }
  return `{${parts.join(',')}}`;
}

/** Canonical UTF-8 octets for a JSON value. */
export function jcsBytes(value) {
  return Buffer.from(jcs(value), 'utf8');
}
