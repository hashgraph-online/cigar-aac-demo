import { encode, decode, Tagged } from './cbor.js';
import { ed25519Sign, ed25519Verify, publicKeyFromRaw, rawPublicKey } from './keys.js';

/**
 * COSE_Sign1 (RFC 9052) with Ed25519.
 *
 *   COSE_Sign1 = [ protected: bstr, unprotected: map, payload: bstr/nil, signature: bstr ]
 *
 * The signature is computed over the CBOR encoding of Sig_Structure:
 *
 *   Sig_Structure = [ "Signature1", protected: bstr, external_aad: bstr, payload: bstr ]
 *
 * The protected header is signed *as its serialized bytes*. This is the detail
 * that makes SCITT's claim work: issuer and subject "sit inside the signed
 * unit", so you cannot move a statement to a different issuer without breaking
 * the signature.
 */

/** COSE header parameter labels used here. */
export const HEADER = Object.freeze({
  alg: 1,
  crit: 2,
  content_type: 3,
  kid: 4,
  /** CWT Claims in a COSE header — carries SCITT's iss/sub inside the signed unit. */
  cwt_claims: 15,
  /** RFC 9942 receipts: verifiable data structure algorithm identifier. */
  vds: 395,
  /** RFC 9942 receipts: verifiable data structure proofs. */
  vdp: 396,
});

/** CWT claim keys (RFC 8392). */
export const CWT = Object.freeze({ iss: 1, sub: 2, iat: 6 });

/** Proof labels inside the `vdp` map. */
export const VDP = Object.freeze({ inclusion: -1, consistency: -2 });

/** COSE algorithm identifiers. */
export const ALG = Object.freeze({ EdDSA: -8 });

/** Verifiable data structure identifiers. MMR_SHA256 is a requested assignment. */
export const VDS = Object.freeze({ RFC9162_SHA256: 1, MMR_SHA256: 3 });

export const COSE_SIGN1_TAG = 18;

function toMap(obj) {
  const m = new Map();
  for (const [k, v] of Object.entries(obj)) m.set(Number(k), v);
  return m;
}

/** Build the Sig_Structure bytes that a signature actually covers. */
export function sigStructure(protectedBytes, payload, externalAad = Buffer.alloc(0)) {
  return encode(['Signature1', protectedBytes, externalAad, payload]);
}

/**
 * Produce a COSE_Sign1.
 *
 * @param {object} o
 * @param {Record<number, unknown>} o.protectedHeader  integer-labelled entries
 * @param {Record<number, unknown>} [o.unprotectedHeader]
 * @param {Buffer} o.payload
 * @param {import('node:crypto').KeyObject} o.privateKey
 * @param {Buffer} [o.externalAad]
 * @returns {{ bytes: Buffer, protectedBytes: Buffer, signature: Buffer }}
 */
export function signSign1({
  protectedHeader,
  unprotectedHeader = {},
  payload,
  privateKey,
  externalAad = Buffer.alloc(0),
}) {
  const protectedBytes = encode(toMap(protectedHeader));
  const signature = ed25519Sign(sigStructure(protectedBytes, payload, externalAad), privateKey);
  const bytes = encode(
    new Tagged(COSE_SIGN1_TAG, [
      protectedBytes,
      toMap(unprotectedHeader),
      payload,
      signature,
    ]),
  );
  return { bytes, protectedBytes, signature };
}

/**
 * Attach entries to an existing COSE_Sign1's *unprotected* header without
 * re-signing. This is how an RFC 9942 receipt rides along with the statement
 * it witnesses — "the record travels with its own proof."
 */
export function attachUnprotected(sign1Bytes, entries) {
  const parsed = parseSign1(sign1Bytes);
  const unprotected = new Map(parsed.unprotected);
  for (const [k, v] of Object.entries(entries)) unprotected.set(Number(k), v);
  return encode(
    new Tagged(COSE_SIGN1_TAG, [
      parsed.protectedBytes,
      unprotected,
      parsed.payload,
      parsed.signature,
    ]),
  );
}

/** Parse a COSE_Sign1 without verifying it. */
export function parseSign1(bytes) {
  const item = decode(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const arr = item instanceof Tagged ? item.value : item;
  const tag = item instanceof Tagged ? item.tag : null;
  if (!Array.isArray(arr) || arr.length !== 4) {
    throw new Error('not a COSE_Sign1: expected a 4-element array');
  }
  const [protectedBytes, unprotected, payload, signature] = arr;
  const protectedHeader = protectedBytes.length ? decode(protectedBytes) : new Map();
  return {
    tag,
    protectedBytes,
    protectedHeader,
    unprotectedIsMap: unprotected instanceof Map,
    unprotected: unprotected instanceof Map ? unprotected : new Map(),
    payload,
    signature,
  };
}

/**
 * Verify a COSE_Sign1.
 *
 * The key comes from the protected `kid` (a raw Ed25519 public key) unless the
 * caller supplies one. Supplying one is the stronger check — it asks "was this
 * signed by the key I expected?" rather than "is this internally consistent?"
 */
export function verifySign1(bytes, { publicKey, externalAad = Buffer.alloc(0) } = {}) {
  let parsed;
  try {
    parsed = parseSign1(bytes);
  } catch (e) {
    return { ok: false, reason: `malformed COSE_Sign1: ${e.message}` };
  }

  if (parsed.tag !== null && parsed.tag !== COSE_SIGN1_TAG) {
    return { ok: false, reason: `unexpected COSE tag ${parsed.tag}, expected 18` };
  }

  const alg = parsed.protectedHeader.get(HEADER.alg);
  if (alg !== ALG.EdDSA) {
    return { ok: false, reason: `unexpected alg ${alg}, expected -8 (EdDSA)` };
  }

  const kid = parsed.protectedHeader.get(HEADER.kid);
  let key = publicKey;
  let keySource = 'caller-supplied';
  if (!key) {
    if (!Buffer.isBuffer(kid) || kid.length !== 32) {
      return { ok: false, reason: 'no public key supplied and protected kid is not a raw Ed25519 key' };
    }
    key = publicKeyFromRaw(kid);
    keySource = 'protected kid';
  } else if (Buffer.isBuffer(kid) && kid.length === 32) {
    // A statement whose kid names a different key than the one we trust is a
    // substitution attempt, not a signature failure. Say which it is.
    if (!kid.equals(rawPublicKey(key))) {
      return {
        ok: false,
        reason: 'protected kid does not match the expected signing key',
        kid: kid.toString('hex'),
        expectedKid: rawPublicKey(key).toString('hex'),
      };
    }
  }

  const tbs = sigStructure(parsed.protectedBytes, parsed.payload, externalAad);
  const ok = ed25519Verify(tbs, parsed.signature, key);
  return {
    ok,
    reason: ok ? null : 'Ed25519 signature does not verify over Sig_Structure',
    keySource,
    kid: Buffer.isBuffer(kid) ? kid.toString('hex') : null,
    contentType: parsed.protectedHeader.get(HEADER.content_type) ?? null,
    payload: parsed.payload,
    signedBytes: tbs.length,
  };
}

/** Read the CWT claims map (SCITT iss/sub) out of a protected header. */
export function cwtClaims(protectedHeader) {
  const claims = protectedHeader.get(HEADER.cwt_claims);
  if (!(claims instanceof Map)) return null;
  return {
    iss: claims.get(CWT.iss) ?? null,
    sub: claims.get(CWT.sub) ?? null,
    iat: claims.get(CWT.iat) ?? null,
  };
}
