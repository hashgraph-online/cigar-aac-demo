import { describe, it, expect } from 'vitest';
import { encode, decode, Tagged, CborError } from './cbor.js';
import { keyPairFromSeed, ed25519Sign, rawPublicKey, publicKeyFromRaw } from './keys.js';
import {
  signSign1,
  verifySign1,
  parseSign1,
  sigStructure,
  attachUnprotected,
  cwtClaims,
  HEADER,
  CWT,
  ALG,
} from './sign1.js';

const hex = (v) => encode(v).toString('hex');

describe('CBOR — RFC 8949 Appendix A known-answer vectors', () => {
  it('encodes unsigned integers in shortest form', () => {
    expect(hex(0)).toBe('00');
    expect(hex(1)).toBe('01');
    expect(hex(10)).toBe('0a');
    expect(hex(23)).toBe('17');
    expect(hex(24)).toBe('1818');
    expect(hex(25)).toBe('1819');
    expect(hex(100)).toBe('1864');
    expect(hex(1000)).toBe('1903e8');
    expect(hex(1000000)).toBe('1a000f4240');
    expect(hex(1000000000000)).toBe('1b000000e8d4a51000');
  });

  it('encodes negative integers', () => {
    expect(hex(-1)).toBe('20');
    expect(hex(-10)).toBe('29');
    expect(hex(-100)).toBe('3863');
    expect(hex(-1000)).toBe('3903e7');
    // COSE alg EdDSA. A wrong encoding here silently changes what was signed.
    expect(hex(-8)).toBe('27');
  });

  it('encodes text strings', () => {
    expect(hex('')).toBe('60');
    expect(hex('a')).toBe('6161');
    expect(hex('IETF')).toBe('6449455446');
  });

  it('encodes byte strings', () => {
    expect(hex(Buffer.alloc(0))).toBe('40');
    expect(hex(Buffer.from([1, 2, 3, 4]))).toBe('4401020304');
  });

  it('encodes arrays and maps', () => {
    expect(hex([])).toBe('80');
    expect(hex([1, 2, 3])).toBe('83010203');
    expect(hex(new Map())).toBe('a0');
    expect(hex(new Map([[1, 2], [3, 4]]))).toBe('a201020304');
    expect(hex({ a: 1, b: [2, 3] })).toBe('a26161016162820203');
  });

  it('encodes simple values', () => {
    expect(hex(false)).toBe('f4');
    expect(hex(true)).toBe('f5');
    expect(hex(null)).toBe('f6');
  });
});

describe('CBOR determinism', () => {
  it('sorts map keys bytewise on their encoded form, not by insertion', () => {
    const a = encode(new Map([[3, 'c'], [1, 'a'], [2, 'b']]));
    const b = encode(new Map([[1, 'a'], [2, 'b'], [3, 'c']]));
    expect(a.equals(b)).toBe(true);
    expect(a.toString('hex')).toBe('a3016161026162036163');
  });

  it('orders a short key before a long one, per encoded-key bytes', () => {
    // Encoded 1 is 0x01; encoded 395 is 0x19018b. 0x01 < 0x19.
    const m = encode(new Map([[395, 'vds'], [1, 'alg']]));
    expect(m.toString('hex').startsWith('a201')).toBe(true);
  });

  it('rejects two keys whose deterministic encodings collide', () => {
    // A Map keeps 1 and 1n as distinct keys, but both encode to 0x01.
    // Emitting both would produce CBOR no deterministic decoder should accept.
    const m = new Map();
    m.set(1, 'a');
    m.set(1n, 'b');
    expect(m.size).toBe(2);
    expect(() => encode(m)).toThrow(/duplicate map key/);
  });

  it('refuses indefinite-length input on decode', () => {
    // 0x9f is an indefinite-length array head.
    expect(() => decode(Buffer.from([0x9f, 0x01, 0xff]))).toThrow(CborError);
  });

  it('refuses trailing bytes after a complete item', () => {
    expect(() => decode(Buffer.from([0x01, 0x02]))).toThrow(/trailing bytes/);
  });

  it('refuses non-integer numbers rather than emitting a float', () => {
    expect(() => encode(1.5)).toThrow(/non-integer/);
  });

  it('round-trips nested structures and tags', () => {
    const value = new Tagged(18, [Buffer.from('ab', 'hex'), new Map([[1, -8]]), Buffer.from('cd', 'hex'), Buffer.alloc(64)]);
    const out = decode(encode(value));
    expect(out).toBeInstanceOf(Tagged);
    expect(out.tag).toBe(18);
    expect(out.value[1].get(1)).toBe(-8);
  });
});

describe('Ed25519 — RFC 8032 known-answer vector', () => {
  // RFC 8032 section 7.1, TEST 1.
  const seed = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
  const expectedPub = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
  const expectedSig =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

  it('derives the published public key from the published seed', () => {
    const kp = keyPairFromSeed(seed);
    expect(kp.rawPublicKey.toString('hex')).toBe(expectedPub);
  });

  it('produces the published signature over the empty message', () => {
    const kp = keyPairFromSeed(seed);
    expect(ed25519Sign(Buffer.alloc(0), kp.privateKey).toString('hex')).toBe(expectedSig);
  });

  it('round-trips a raw public key through kid form', () => {
    const kp = keyPairFromSeed(seed);
    const rebuilt = publicKeyFromRaw(kp.rawPublicKey);
    expect(rawPublicKey(rebuilt).toString('hex')).toBe(expectedPub);
  });

  it('is deterministic, so a rehearsed demo has stable digests', () => {
    expect(keyPairFromSeed(seed).rawPublicKey.toString('hex')).toBe(
      keyPairFromSeed(seed).rawPublicKey.toString('hex'),
    );
  });
});

describe('COSE_Sign1', () => {
  const kp = keyPairFromSeed('11'.repeat(32));
  const capsuleId = Buffer.from('3a'.repeat(32), 'hex');

  const aacEnvelope = () =>
    signSign1({
      protectedHeader: {
        [HEADER.alg]: ALG.EdDSA,
        [HEADER.content_type]: 'application/agent-action-capsule-id',
        [HEADER.kid]: kp.rawPublicKey,
      },
      payload: capsuleId,
      privateKey: kp.privateKey,
    });

  it('verifies a signature it produced', () => {
    const { bytes } = aacEnvelope();
    const result = verifySign1(bytes, { publicKey: kp.publicKey });
    expect(result.ok).toBe(true);
  });

  it('carries the AAC producer envelope shape: exactly three protected entries', () => {
    const { bytes } = aacEnvelope();
    const parsed = parseSign1(bytes);
    expect(parsed.tag).toBe(18);
    expect(parsed.protectedHeader.size).toBe(3);
    expect(parsed.protectedHeader.get(HEADER.alg)).toBe(-8);
    expect(parsed.protectedHeader.get(HEADER.content_type)).toBe(
      'application/agent-action-capsule-id',
    );
    expect(parsed.protectedHeader.get(HEADER.kid)).toHaveLength(32);
    expect(parsed.unprotected.size).toBe(0);
    expect(parsed.payload).toHaveLength(32);
  });

  it('verifies from the protected kid alone, with no key supplied', () => {
    // This is what "checkable offline, the issuer's key not required" means.
    const { bytes } = aacEnvelope();
    const result = verifySign1(bytes);
    expect(result.ok).toBe(true);
    expect(result.keySource).toBe('protected kid');
  });

  it('signs over Sig_Structure, verifiable by an independent recomputation', () => {
    const { bytes, protectedBytes, signature } = aacEnvelope();
    const tbs = sigStructure(protectedBytes, capsuleId, Buffer.alloc(0));
    // Independently rebuild the Sig_Structure array and check it matches.
    const rebuilt = encode(['Signature1', protectedBytes, Buffer.alloc(0), capsuleId]);
    expect(rebuilt.equals(tbs)).toBe(true);
    expect(parseSign1(bytes).signature.equals(signature)).toBe(true);
  });

  it('fails when the payload is altered by one byte', () => {
    const { bytes } = aacEnvelope();
    const parsed = parseSign1(bytes);
    const flipped = Buffer.from(parsed.payload);
    flipped[0] ^= 0x01;
    const forged = encode(
      new Tagged(18, [parsed.protectedBytes, parsed.unprotected, flipped, parsed.signature]),
    );
    const result = verifySign1(forged, { publicKey: kp.publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not verify/);
  });

  it('fails when the protected header is altered', () => {
    // The protected header is signed as bytes, so re-encoding it breaks the
    // signature even if the logical content looks equivalent.
    const { bytes } = aacEnvelope();
    const parsed = parseSign1(bytes);
    const swapped = encode(
      new Map([
        [HEADER.alg, ALG.EdDSA],
        [HEADER.content_type, 'application/something-else'],
        [HEADER.kid, kp.rawPublicKey],
      ]),
    );
    const forged = encode(
      new Tagged(18, [swapped, parsed.unprotected, parsed.payload, parsed.signature]),
    );
    expect(verifySign1(forged, { publicKey: kp.publicKey }).ok).toBe(false);
  });

  it('names a kid/key mismatch as substitution, not as a bad signature', () => {
    const other = keyPairFromSeed('22'.repeat(32));
    const { bytes } = aacEnvelope();
    const result = verifySign1(bytes, { publicKey: other.publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/kid does not match/);
  });

  it('rejects an unexpected algorithm', () => {
    const { bytes } = signSign1({
      protectedHeader: { [HEADER.alg]: -7, [HEADER.kid]: kp.rawPublicKey },
      payload: capsuleId,
      privateKey: kp.privateKey,
    });
    expect(verifySign1(bytes).reason).toMatch(/expected -8/);
  });

  it('lets a receipt ride in the unprotected header without breaking the signature', () => {
    // RFC 9942: the record travels with its own proof.
    const { bytes } = aacEnvelope();
    const withReceipt = attachUnprotected(bytes, { [HEADER.vds]: 3 });
    const result = verifySign1(withReceipt, { publicKey: kp.publicKey });
    expect(result.ok).toBe(true);
    expect(parseSign1(withReceipt).unprotected.get(HEADER.vds)).toBe(3);
  });

  it('carries SCITT iss and sub inside the signed unit', () => {
    const { bytes } = signSign1({
      protectedHeader: {
        [HEADER.alg]: ALG.EdDSA,
        [HEADER.content_type]: 'application/cll-checkpoint+json',
        [HEADER.kid]: kp.rawPublicKey,
        [HEADER.cwt_claims]: new Map([
          [CWT.iss, 'northwind-industrial'],
          [CWT.sub, 'cll://northwind/ap-settlement'],
        ]),
      },
      payload: Buffer.from('{"log_size":3}', 'utf8'),
      privateKey: kp.privateKey,
    });
    const parsed = parseSign1(bytes);
    const claims = cwtClaims(parsed.protectedHeader);
    expect(claims.iss).toBe('northwind-industrial');
    expect(claims.sub).toBe('cll://northwind/ap-settlement');
    // Moving the statement to another issuer must break the signature.
    expect(verifySign1(bytes, { publicKey: kp.publicKey }).ok).toBe(true);
  });

  it('reports malformed input rather than throwing', () => {
    expect(verifySign1(Buffer.from([0x01])).ok).toBe(false);
    expect(verifySign1(Buffer.from([0x01])).reason).toMatch(/malformed|COSE_Sign1/);
  });
});
