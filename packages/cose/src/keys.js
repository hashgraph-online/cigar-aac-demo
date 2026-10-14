import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Ed25519 key handling.
 *
 * AAC pins `kid` to the raw 32-byte Ed25519 public key rather than a name.
 * That choice matters: the key identifier *is* the key, so a verifier can
 * check a signature without resolving an identifier through any directory,
 * which is what "checkable offline, issuer's key not required" depends on.
 */

/** Deterministic keygen from a 32-byte seed, so a rehearsed demo has stable digests. */
export function keyPairFromSeed(seed) {
  const s = Buffer.isBuffer(seed) ? seed : Buffer.from(seed, 'hex');
  if (s.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  // RFC 8410 PKCS#8 wrapper for an Ed25519 private key: the fixed 16-byte
  // prefix below is the SEQUENCE/version/AlgorithmIdentifier/OCTET STRING
  // header, followed by the raw 32-byte seed.
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    s,
  ]);
  const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  return wrap(privateKey, publicKey);
}

export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return wrap(privateKey, publicKey);
}

function wrap(privateKey, publicKey) {
  return {
    privateKey,
    publicKey,
    /** The raw 32-byte public key — used verbatim as the COSE `kid`. */
    rawPublicKey: rawPublicKey(publicKey),
  };
}

/** Extract the raw 32 bytes of an Ed25519 public key. */
export function rawPublicKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url');
}

/** Rebuild a usable public key from its raw 32 bytes (what a `kid` carries). */
export function publicKeyFromRaw(raw) {
  const b = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (b.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: b.toString('base64url') },
    format: 'jwk',
  });
}

export function ed25519Sign(message, privateKey) {
  return sign(null, message, privateKey);
}

export function ed25519Verify(message, signature, publicKey) {
  try {
    return verify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}
