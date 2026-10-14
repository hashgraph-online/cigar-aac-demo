import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { keyPairFromSeed, parseSign1, HEADER } from '@cigar-aac/cose';
import { jcs } from '@cigar-aac/cpb';
import { mmrShape, buildMmr, bagPeaks, hashPosPair64, pos64, inclusionProof, verifyInclusion } from './mmr.js';
import { CheckpointedLocalLog, leafHashForId, verifyCheckpoint, CHECKPOINT_MEDIA_TYPE } from './log.js';

const leaf = (n) => createHash('sha256').update(`leaf-${n}`).digest();
const leaves = (n) => Array.from({ length: n }, (_, i) => leaf(i));

// ---------------------------------------------------------------------------
// An INDEPENDENT MMR implementation, written differently on purpose.
//
// This one derives leaf positions from the closed-form 2i - popcount(i) + 1
// and builds each perfect subtree by recursion, where the implementation under
// test uses an iterative peak stack. If both agree on a root, the roots are
// unlikely to be wrong in the same way.
// ---------------------------------------------------------------------------
const popcount = (n) => n.toString(2).split('').filter((c) => c === '1').length;
const leafPosFormula = (i) => 2 * i - popcount(i) + 1;

function perfectSubtree(hashes, startLeaf, height) {
  if (height === 0) {
    return { hash: hashes[startLeaf], pos: leafPosFormula(startLeaf) };
  }
  const half = 2 ** (height - 1);
  const L = perfectSubtree(hashes, startLeaf, height - 1);
  const R = perfectSubtree(hashes, startLeaf + half, height - 1);
  const pos = R.pos + 1;
  return { hash: hashPosPair64(pos, L.hash, R.hash), pos };
}

function independentRoot(hashes) {
  const n = hashes.length;
  const mmrSize = 2 * n - popcount(n);
  // Peaks correspond to the set bits of n, most significant first.
  const heights = [];
  for (let b = 31; b >= 0; b -= 1) if (n & (1 << b)) heights.push(b);
  const peaks = [];
  let consumed = 0;
  for (const h of heights) {
    peaks.push(perfectSubtree(hashes, consumed, h));
    consumed += 2 ** h;
  }
  // Bag right-to-left, positions continuing from mmrSize.
  let acc = peaks[peaks.length - 1].hash;
  let pos = mmrSize;
  for (let i = peaks.length - 2; i >= 0; i -= 1) {
    pos += 1;
    acc = hashPosPair64(pos, peaks[i].hash, acc);
  }
  return { root: acc, mmrSize, peaks };
}

describe('MMR structure — the AAIF briefing worked example', () => {
  it('turns 11 leaves into 19 nodes and three peaks of height 3, 1 and 0', () => {
    // This is the slide: "11 LEAVES - THREE PEAKS", peaks of 8, 2 and 1 leaves.
    const shape = mmrShape(11);
    expect(shape.mmrSize).toBe(19);
    expect(shape.peaks.map((p) => p.height)).toEqual([3, 1, 0]);
    expect(shape.peaks.map((p) => p.pos)).toEqual([15, 18, 19]);
  });

  it('gives leaf 7 a three-sibling path to its peak, plus the peak set', () => {
    // The briefing's slide says "inclusion proof for leaf 7 = a logarithmic
    // path of sibling hashes, 4 nodes". Leaf 7 sits under the height-3 peak,
    // which is three levels deep, so reaching that peak takes exactly three
    // sibling hashes. The slide's count of 4 presumably folds in one value for
    // the remaining peaks. The structure below is what an MMR actually
    // requires; the difference is in what you count, not in the tree.
    const mmr = buildMmr(leaves(11));
    const proof = inclusionProof(mmr, 7);
    expect(proof.path).toHaveLength(3);
    expect(proof.peak_index).toBe(0);
    expect(proof.peaks).toHaveLength(3);
    // Total material a verifier needs: 3 siblings + the 2 peaks it does not recompute.
    expect(proof.path.length + proof.peaks.length - 1).toBe(5);
  });

  it('places leaves at the positions the closed-form formula predicts', () => {
    const shape = mmrShape(11);
    expect(shape.leafPositions).toEqual([1, 2, 4, 5, 8, 9, 11, 12, 16, 17, 19]);
    expect(shape.leafPositions).toEqual(
      Array.from({ length: 11 }, (_, i) => leafPosFormula(i)),
    );
  });

  it('matches mmrSize = 2n - popcount(n) for many sizes', () => {
    for (let n = 1; n <= 64; n += 1) {
      expect(mmrShape(n).mmrSize).toBe(2 * n - popcount(n));
    }
  });

  it('never restructures an earlier leaf as the log grows', () => {
    // A leaf's index and position are fixed permanently on append.
    const small = mmrShape(5);
    const large = mmrShape(40);
    expect(large.leafPositions.slice(0, 5)).toEqual(small.leafPositions);
  });
});

describe('MMR root — cross-checked against an independent implementation', () => {
  it('agrees for every log size from 1 to 40', () => {
    for (let n = 1; n <= 40; n += 1) {
      const hashes = leaves(n);
      const mine = buildMmr(hashes);
      const theirs = independentRoot(hashes);
      expect(mine.mmrSize).toBe(theirs.mmrSize);
      expect(mine.root.toString('hex')).toBe(theirs.root.toString('hex'));
    }
  });

  it('agrees on peak hashes, not just the bagged root', () => {
    const hashes = leaves(11);
    const mine = buildMmr(hashes);
    const theirs = independentRoot(hashes);
    expect(mine.peaks.map((p) => p.hash.toString('hex'))).toEqual(
      theirs.peaks.map((p) => p.hash.toString('hex')),
    );
  });
});

describe('MMR hashing rules', () => {
  it('position-commits interior nodes: H(pos_be64 || a || b)', () => {
    const a = leaf(0);
    const b = leaf(1);
    const expected = createHash('sha256')
      .update(Buffer.concat([pos64(3), a, b]))
      .digest();
    expect(hashPosPair64(3, a, b).toString('hex')).toBe(expected.toString('hex'));
  });

  it('gives the same pair a different hash at a different position', () => {
    // This is what stops an interior node being reinterpreted elsewhere in
    // the tree; it does the job RFC 9162's 0x01 prefix does.
    expect(hashPosPair64(3, leaf(0), leaf(1))).not.toEqual(hashPosPair64(4, leaf(0), leaf(1)));
  });

  it('applies no domain-separation prefix to leaves', () => {
    const mmr = buildMmr([leaf(0)]);
    // A single-leaf log has one peak and nothing to bag, so root === the leaf.
    expect(mmr.root.toString('hex')).toBe(leaf(0).toString('hex'));
  });

  it('treats a single peak as the root without bagging', () => {
    for (const n of [1, 2, 4, 8, 16, 32]) {
      const mmr = buildMmr(leaves(n));
      expect(mmr.peaks).toHaveLength(1);
      expect(mmr.root.toString('hex')).toBe(mmr.peaks[0].hash.toString('hex'));
    }
  });

  it('bags right-to-left', () => {
    const mmr = buildMmr(leaves(3));
    // 3 leaves: peak over leaves 0-1 (pos 3) and leaf 2 (pos 4); mmrSize 4.
    const [p0, p1] = mmr.peaks.map((p) => p.hash);
    expect(mmr.root.toString('hex')).toBe(hashPosPair64(5, p0, p1).toString('hex'));
    expect(bagPeaks([p0, p1], 4).toString('hex')).toBe(mmr.root.toString('hex'));
  });
});

describe('inclusion proofs', () => {
  it('verifies every leaf at every log size up to 33', () => {
    for (let n = 1; n <= 33; n += 1) {
      const hashes = leaves(n);
      const mmr = buildMmr(hashes);
      for (let i = 0; i < n; i += 1) {
        const result = verifyInclusion({
          leafHash: hashes[i],
          proof: inclusionProof(mmr, i),
          root: mmr.root,
        });
        expect(result.ok, `leaf ${i} of ${n}`).toBe(true);
      }
    }
  });

  it('rejects a proof presented for the wrong leaf', () => {
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const result = verifyInclusion({
      leafHash: hashes[3],
      proof: inclusionProof(mmr, 7),
      root: mmr.root,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered sibling hash and reports the recomputed peak', () => {
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const proof = inclusionProof(mmr, 7);
    proof.path[0].hash = 'ff'.repeat(32);
    const result = verifyInclusion({ leafHash: hashes[7], proof, root: mmr.root });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/peak does not match/);
    expect(result.computedPeak).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a proof whose declared side was flipped', () => {
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const proof = inclusionProof(mmr, 7);
    proof.path[0].side = proof.path[0].side === 'left' ? 'right' : 'left';
    const result = verifyInclusion({ leafHash: hashes[7], proof, root: mmr.root });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/structure requires/);
  });

  it('rejects a path padded with extra nodes', () => {
    // The verifier derives the required path length from log_size, so a
    // producer cannot lengthen the path to reach an arbitrary root.
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const proof = inclusionProof(mmr, 7);
    proof.path.push({ hash: 'ab'.repeat(32), side: 'right' });
    const result = verifyInclusion({ leafHash: hashes[7], proof, root: mmr.root });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/needs 3/);
  });

  it('rejects a lie about which peak the leaf sits under', () => {
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const proof = inclusionProof(mmr, 7);
    proof.peak_index = 2;
    const result = verifyInclusion({ leafHash: hashes[7], proof, root: mmr.root });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sits under peak/);
  });

  it('rejects a valid proof checked against a different root', () => {
    const hashes = leaves(11);
    const mmr = buildMmr(hashes);
    const other = buildMmr(leaves(12));
    const result = verifyInclusion({
      leafHash: hashes[7],
      proof: inclusionProof(mmr, 7),
      root: other.root,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/checkpoint commitment/);
  });
});

describe('log leaf preimage', () => {
  it('hashes the 32 raw bytes of the id, not its 64 hex characters', () => {
    const id = '3a'.repeat(32);
    const correct = createHash('sha256').update(Buffer.from(id, 'hex')).digest('hex');
    const wrong = createHash('sha256').update(Buffer.from(id, 'utf8')).digest('hex');
    expect(leafHashForId(id).toString('hex')).toBe(correct);
    expect(leafHashForId(id).toString('hex')).not.toBe(wrong);
  });
});

describe('CheckpointedLocalLog', () => {
  const kp = keyPairFromSeed('ab'.repeat(32));
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 8, 21, 12, 0, clock++)).toISOString();

  const newLog = () => {
    clock = 0;
    return new CheckpointedLocalLog({
      logId: 'northwind-ap-settlement',
      privateKey: kp.privateKey,
      rawPublicKey: kp.rawPublicKey,
      cadence: 'on-append',
      now,
    });
  };

  const id = (n) => createHash('sha256').update(`capsule-${n}`).digest('hex');

  it('assigns permanent, contiguous leaf indices', () => {
    const log = newLog();
    expect(log.append({ id: id(0) })).toBe(0);
    expect(log.append({ id: id(1) })).toBe(1);
    expect(log.append({ id: id(2) })).toBe(2);
    expect(log.logSize).toBe(3);
  });

  it('issues a checkpoint carrying the draft checkpoint claims', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const cp = log.checkpoint();
    expect(Object.keys(cp.claims).sort()).toEqual([
      'cadence',
      'commitment',
      'issued_at',
      'kind',
      'log_id',
      'log_size',
      'prev_commitment',
      'prev_size',
    ]);
    expect(cp.claims.log_size).toBe(1);
    expect(cp.claims.prev_size).toBe(0);
    expect(cp.claims.prev_commitment).toBe(null);
    expect(cp.claims.commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps checkpoint size constant as the log grows by orders of magnitude', () => {
    // The briefing's claim, stated precisely: 10k-100k records collapse into
    // one small checkpoint. The load-bearing property is not an absolute byte
    // count but that the size does not grow with the log - a checkpoint
    // commits to the whole history in a fixed number of bytes.
    const small = newLog();
    for (let i = 0; i < 10; i += 1) small.append({ id: id(i) });
    const smallCp = small.checkpoint();

    const large = newLog();
    for (let i = 0; i < 50000; i += 1) large.append({ id: id(i) });
    const largeCp = large.checkpoint();

    expect(largeCp.claims.log_size).toBe(50000);
    // A 5000x bigger log costs only the extra decimal digits of the size,
    // which appears twice: in the claims, and in the CWT `sub` URI.
    // 10 -> 50000 is three more digits in each place, so six bytes total.
    expect(largeCp.bytes_on_the_wire - smallCp.bytes_on_the_wire).toBe(6);
    expect(largeCp.bytes_on_the_wire).toBeLessThan(600);
  });

  it('signs the checkpoint as a COSE_Sign1 with the checkpoint media type', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const cp = log.checkpoint();
    const parsed = parseSign1(Buffer.from(cp.cose_sign1_b64, 'base64'));
    expect(parsed.tag).toBe(18);
    expect(parsed.protectedHeader.get(HEADER.content_type)).toBe(CHECKPOINT_MEDIA_TYPE);
  });

  it('signs canonical JCS bytes', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const cp = log.checkpoint();
    expect(Buffer.from(cp.payload_b64, 'base64').toString('utf8')).toBe(jcs(cp.claims));
  });

  it('verifies a well-formed checkpoint', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const cp = log.checkpoint();
    const result = verifyCheckpoint(Buffer.from(cp.cose_sign1_b64, 'base64'), {
      expectedKey: kp.publicKey,
    });
    expect(result.ok).toBe(true);
  });

  it('chains each checkpoint to the one before it', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const first = log.checkpoint();
    log.append({ id: id(1) });
    log.append({ id: id(2) });
    const second = log.checkpoint();

    expect(second.claims.prev_size).toBe(1);
    expect(second.claims.prev_commitment).toBe(first.claims.commitment);

    const result = verifyCheckpoint(Buffer.from(second.cose_sign1_b64, 'base64'), {
      expectedKey: kp.publicKey,
      previousClaims: first.claims,
    });
    expect(result.ok).toBe(true);
  });

  it('detects a checkpoint that does not extend the last accepted one', () => {
    // A producer rewriting history must either break a signature or present a
    // checkpoint that fails this check.
    const log = newLog();
    log.append({ id: id(0) });
    const first = log.checkpoint();

    const forkedLog = newLog();
    forkedLog.append({ id: id(99) });
    forkedLog.append({ id: id(98) });
    const forked = forkedLog.checkpoint();

    const result = verifyCheckpoint(Buffer.from(forked.cose_sign1_b64, 'base64'), {
      expectedKey: kp.publicKey,
      previousClaims: first.claims,
    });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => s.name.includes('extends')).ok).toBe(false);
  });

  it('detects a tampered checkpoint payload', () => {
    const log = newLog();
    log.append({ id: id(0) });
    const cp = log.checkpoint();
    const bytes = Buffer.from(cp.cose_sign1_b64, 'base64');
    // Flip a byte inside the signed payload region.
    const forged = Buffer.from(bytes);
    const marker = forged.indexOf(Buffer.from('"log_size":1', 'utf8'));
    expect(marker).toBeGreaterThan(-1);
    forged[marker + 11] = '9'.charCodeAt(0);
    const result = verifyCheckpoint(forged, { expectedKey: kp.publicKey });
    expect(result.ok).toBe(false);
  });

  it('keeps entry content local — only the checkpoint travels', () => {
    const log = newLog();
    log.append({ id: id(0), local: { iban: 'DE89370400440532013000', memo: 'secret' } });
    const cp = log.checkpoint();
    const wire = Buffer.from(cp.cose_sign1_b64, 'base64').toString('binary');
    expect(wire).not.toContain('DE89370400440532013000');
    expect(wire).not.toContain('secret');
    expect(JSON.stringify(cp.claims)).not.toContain('secret');
  });

  it('proves a contiguous range is complete under one commitment', () => {
    const log = newLog();
    for (let i = 0; i < 9; i += 1) log.append({ id: id(i) });
    const rp = log.rangeProof(2, 5);
    expect(rp.leaves.map((l) => l.leaf_index)).toEqual([2, 3, 4, 5]);
    for (const l of rp.leaves) {
      const result = verifyInclusion({
        leafHash: Buffer.from(l.leaf_hash, 'hex'),
        proof: l.proof,
        root: rp.commitment,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('refuses to checkpoint an empty log', () => {
    expect(() => newLog().checkpoint()).toThrow(/empty log/);
  });
});
