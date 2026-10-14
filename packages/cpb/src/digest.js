import { createHash } from 'node:crypto';
import { jcs, jcsBytes } from './jcs.js';
import { normalizeJcsN } from './normalize.js';
import { lookupAlgorithm, lookupArtifactType } from './registry.js';

/**
 * CPB canonical digest:
 *   CANONICAL-DIGEST(A, P) = lowercase_hex(SHA-256(A(P minus exclusion_set)))
 */

function stripExclusionSet(payload, exclusionSet) {
  if (!exclusionSet || exclusionSet.length === 0) return payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const out = Object.create(null);
  for (const key of Object.keys(payload)) {
    if (exclusionSet.includes(key)) continue;
    out[key] = payload[key];
  }
  return out;
}

/**
 * Compute a canonical digest and return the full derivation, not just the hex.
 * The dashboard shows every intermediate step, because "trust me, the hash
 * matches" is precisely the claim a verifier is supposed to replace.
 *
 * @param {object} options
 * @param {unknown} options.payload
 * @param {string} [options.algorithm='jcs-n']
 * @param {string[]} [options.exclusionSet=[]]
 * @returns {{digest: string, canonical: string, algorithm: string,
 *            exclusionSet: string[], preimageBytes: number}}
 */
export function canonicalDigest({ payload, algorithm = 'jcs-n', exclusionSet = [] }) {
  const algo = lookupAlgorithm(algorithm);
  const stripped = stripExclusionSet(payload, exclusionSet);
  const prepared = algo.normalize ? normalizeJcsN(stripped) : stripped;
  const canonical = jcs(prepared);
  const bytes = Buffer.from(canonical, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  return {
    digest,
    canonical,
    algorithm,
    exclusionSet: [...exclusionSet],
    preimageBytes: bytes.length,
  };
}

/**
 * Compute the digest of an artifact using the digest context its *registered
 * type* pins. This is the only function the verifier is allowed to use when
 * resolving a typed reference.
 */
export function digestForType(type, payload) {
  const entry = lookupArtifactType(type);
  return canonicalDigest({
    payload,
    algorithm: entry.algorithm,
    exclusionSet: entry.exclusionSet,
  });
}

/**
 * Build a CPB typed digest reference.
 *
 * Required members are `type`, `digest_alg` and `digest`. Extra members MAY be
 * present and MUST be ignored by verifiers that do not understand them — which
 * is what lets the composition profile hang `slot` off a reference without
 * breaking a plain CPB verifier.
 */
export function typedRef(type, payload, extra = {}) {
  const { digest } = digestForType(type, payload);
  return { type, digest_alg: 'SHA-256', digest, ...extra };
}

/**
 * Verify a typed digest reference against a candidate artifact.
 * Resolves the digest context from the registry by `ref.type`, never from the
 * reference's own neighbouring fields.
 */
export function verifyTypedRef(ref, artifact) {
  const entry = lookupArtifactType(ref.type);
  if (ref.digest_alg !== 'SHA-256') {
    return {
      ok: false,
      reason: `unsupported digest_alg "${ref.digest_alg}"`,
      expected: ref.digest,
      actual: null,
      context: entry,
    };
  }
  const { digest, canonical } = digestForType(ref.type, artifact);
  return {
    ok: digest === ref.digest,
    reason: digest === ref.digest ? null : 'digest mismatch',
    expected: ref.digest,
    actual: digest,
    canonical,
    context: {
      type: entry.name,
      algorithm: entry.algorithm,
      exclusionSet: entry.exclusionSet,
      proposed: Boolean(entry.proposed),
    },
  };
}

/**
 * CPB: "monetary and quantity values anywhere in a payload using jcs-n MUST be
 * exact decimal strings, not JSON floating-point numbers."
 *
 * A library cannot know which field is money, so this reports every
 * non-integer JSON number and lets the caller decide. Our own artifact
 * builders run it and refuse to seal a payload that trips it — that is why the
 * payment scenario carries "48200.00" as a string and never 48200.0.
 */
export function findFloatingPointNumbers(payload, path = []) {
  const hits = [];
  const walk = (v, p) => {
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) hits.push({ path: `/${p.join('/')}`, value: v });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((el, i) => walk(el, [...p, String(i)]));
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], [...p, k]);
    }
  };
  walk(payload, path);
  return hits;
}

/** The 32 raw bytes named by a 64-char lowercase-hex derived identifier. */
export function idBytes(hexId) {
  if (!/^[0-9a-f]{64}$/.test(hexId)) {
    throw new Error(`not a 64-char lowercase hex identifier: ${hexId}`);
  }
  return Buffer.from(hexId, 'hex');
}

export { jcs, jcsBytes, normalizeJcsN };
