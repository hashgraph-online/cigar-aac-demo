import { createHash } from 'node:crypto';

/**
 * Merkle Mountain Range — the log is a forest, not a tree.
 *
 * Each peak is a perfect binary Merkle subtree. Appending is O(log n) and
 * never restructures an earlier leaf, which is what lets a leaf's index be
 * fixed permanently by its inclusion under the root.
 *
 * Hashing follows draft-bryce-cose-receipts-mmr-profile:
 *   - leaf hashes are supplied directly as H(x); no domain-separation prefix
 *   - interior nodes MUST prefix the hashed value with their position:
 *       hash_pospair64(pos, a, b) = SHA-256( pos_be64 || a || b )
 *
 * Position-committing interior nodes is what stops a second-preimage attack
 * that reinterprets an interior node as a leaf, which is the job a plain
 * 0x00/0x01 domain-separation byte does in RFC 9162.
 */

const H = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();

/** Big-endian uint64 of a node position. */
export function pos64(pos) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(pos));
  return b;
}

/** hash_pospair64(pos, a, b) = H(pos || a || b) */
export function hashPosPair64(pos, a, b) {
  return H(pos64(pos), a, b);
}

/**
 * The MMR's shape for a given leaf count, computed without any hashes.
 *
 * A verifier needs this: because the structure is fully determined by the leaf
 * count, a verifier can derive every node position itself rather than trusting
 * positions a producer supplied in a proof. A proof therefore only has to
 * carry sibling *hashes* and sides.
 *
 * @param {number} leafCount
 * @returns {{
 *   mmrSize: number,
 *   leafPositions: number[],
 *   peaks: {pos:number,height:number}[],
 *   parentOf: Map<number, {pos:number, left:number, right:number}>,
 * }}
 */
export function mmrShape(leafCount) {
  /** @type {{height:number,pos:number}[]} */
  const stack = [];
  const leafPositions = [];
  const parentOf = new Map();
  let nextPos = 1;

  for (let i = 0; i < leafCount; i += 1) {
    const leafPos = nextPos;
    nextPos += 1;
    leafPositions.push(leafPos);
    stack.push({ height: 0, pos: leafPos });

    // Merge while the two rightmost peaks are the same height.
    while (stack.length >= 2 && stack[stack.length - 1].height === stack[stack.length - 2].height) {
      const right = stack.pop();
      const left = stack.pop();
      const parentPos = nextPos;
      nextPos += 1;
      parentOf.set(left.pos, { pos: parentPos, left: left.pos, right: right.pos });
      parentOf.set(right.pos, { pos: parentPos, left: left.pos, right: right.pos });
      stack.push({ height: left.height + 1, pos: parentPos });
    }
  }

  return {
    mmrSize: nextPos - 1,
    leafPositions,
    peaks: stack.map((p) => ({ pos: p.pos, height: p.height })),
    parentOf,
  };
}

/**
 * Bag the peaks into the single 32-byte commitment a checkpoint carries.
 *
 * Right-to-left, as described in the AAIF briefing, using the same
 * position-committed rule as interior nodes so the whole structure hashes
 * consistently. Bagging positions continue from mmrSize.
 *
 * With a single peak there is nothing to bag and the root *is* that peak —
 * matching the MMR profile's "the node itself where the proof path is empty".
 *
 * See docs/PRD-TECHNICAL.md section 9, C-4: the briefing's shorthand is
 * sha256(right || left); this implementation position-commits the pair.
 */
export function bagPeaks(peakHashes, mmrSize) {
  if (peakHashes.length === 0) throw new Error('cannot bag zero peaks');
  let acc = peakHashes[peakHashes.length - 1];
  let pos = mmrSize;
  for (let i = peakHashes.length - 2; i >= 0; i -= 1) {
    pos += 1;
    acc = hashPosPair64(pos, peakHashes[i], acc);
  }
  return acc;
}

/**
 * Build a full MMR from leaf hashes.
 * @param {Buffer[]} leafHashes
 */
export function buildMmr(leafHashes) {
  const nodes = new Map();
  /** @type {{height:number,pos:number,hash:Buffer}[]} */
  const stack = [];
  const leafPositions = [];
  let nextPos = 1;

  for (const leafHash of leafHashes) {
    if (!Buffer.isBuffer(leafHash) || leafHash.length !== 32) {
      throw new Error('each leaf hash must be 32 bytes');
    }
    const leafPos = nextPos;
    nextPos += 1;
    nodes.set(leafPos, leafHash);
    leafPositions.push(leafPos);
    stack.push({ height: 0, pos: leafPos, hash: leafHash });

    while (stack.length >= 2 && stack[stack.length - 1].height === stack[stack.length - 2].height) {
      const right = stack.pop();
      const left = stack.pop();
      const parentPos = nextPos;
      nextPos += 1;
      const hash = hashPosPair64(parentPos, left.hash, right.hash);
      nodes.set(parentPos, hash);
      stack.push({ height: left.height + 1, pos: parentPos, hash });
    }
  }

  const mmrSize = nextPos - 1;
  const peaks = stack.map((p) => ({ pos: p.pos, height: p.height, hash: p.hash }));
  const root = peaks.length ? bagPeaks(peaks.map((p) => p.hash), mmrSize) : null;

  return { nodes, peaks, mmrSize, leafCount: leafHashes.length, leafPositions, root };
}

/**
 * Produce an inclusion proof for a leaf.
 *
 * The proof carries only sibling hashes and sides, plus the sibling peaks.
 * Positions are deliberately *not* carried: the verifier derives them from the
 * leaf count via mmrShape, so a forged proof cannot lie about tree structure.
 */
export function inclusionProof(mmr, leafIndex) {
  if (leafIndex < 0 || leafIndex >= mmr.leafCount) {
    throw new Error(`leaf index ${leafIndex} out of range (0..${mmr.leafCount - 1})`);
  }
  const shape = mmrShape(mmr.leafCount);
  const path = [];

  let current = shape.leafPositions[leafIndex];
  for (;;) {
    const parent = shape.parentOf.get(current);
    if (!parent) break;
    const siblingPos = parent.left === current ? parent.right : parent.left;
    path.push({
      hash: mmr.nodes.get(siblingPos).toString('hex'),
      side: parent.left === current ? 'right' : 'left',
    });
    current = parent.pos;
  }

  // `current` is now the peak this leaf lives under.
  const peakIndex = mmr.peaks.findIndex((p) => p.pos === current);
  return {
    leaf_index: leafIndex,
    log_size: mmr.leafCount,
    path,
    peak_index: peakIndex,
    peaks: mmr.peaks.map((p) => p.hash.toString('hex')),
  };
}

/**
 * Verify an inclusion proof against a root, deriving all structure from
 * log_size rather than trusting the proof's own claims about the tree.
 *
 * @returns {{ok:boolean, reason:string|null, computedRoot:string, computedPeak:string}}
 */
export function verifyInclusion({ leafHash, proof, root }) {
  const { leaf_index: leafIndex, log_size: logSize, path, peak_index: peakIndex, peaks } = proof;

  if (!Number.isInteger(logSize) || logSize <= 0) {
    return fail('log_size must be a positive integer');
  }
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= logSize) {
    return fail(`leaf_index ${leafIndex} is outside a log of ${logSize} leaves`);
  }

  const shape = mmrShape(logSize);

  if (peaks.length !== shape.peaks.length) {
    return fail(
      `proof carries ${peaks.length} peaks but a ${logSize}-leaf log has ${shape.peaks.length}`,
    );
  }

  // Derive the expected path length and parent positions independently.
  const derivedPath = [];
  let current = shape.leafPositions[leafIndex];
  for (;;) {
    const parent = shape.parentOf.get(current);
    if (!parent) break;
    derivedPath.push({ parentPos: parent.pos, isLeft: parent.left === current });
    current = parent.pos;
  }
  const derivedPeakIndex = shape.peaks.findIndex((p) => p.pos === current);

  if (path.length !== derivedPath.length) {
    return fail(
      `proof path has ${path.length} nodes but leaf ${leafIndex} of a ${logSize}-leaf log needs ${derivedPath.length}`,
    );
  }
  if (peakIndex !== derivedPeakIndex) {
    return fail(`proof claims peak ${peakIndex} but leaf ${leafIndex} sits under peak ${derivedPeakIndex}`);
  }

  // Fold the path to the peak, using positions we derived, not positions we were given.
  let acc = leafHash;
  for (let i = 0; i < derivedPath.length; i += 1) {
    const sibling = Buffer.from(path[i].hash, 'hex');
    if (sibling.length !== 32) return fail(`proof path node ${i} is not 32 bytes`);
    const { parentPos, isLeft } = derivedPath[i];
    const declaredSide = path[i].side;
    const expectedSide = isLeft ? 'right' : 'left';
    if (declaredSide !== expectedSide) {
      return fail(`proof path node ${i} claims side "${declaredSide}" but structure requires "${expectedSide}"`);
    }
    acc = isLeft ? hashPosPair64(parentPos, acc, sibling) : hashPosPair64(parentPos, sibling, acc);
  }

  const computedPeak = acc;
  const claimedPeak = Buffer.from(peaks[derivedPeakIndex], 'hex');
  if (!computedPeak.equals(claimedPeak)) {
    return {
      ok: false,
      reason: 'recomputed peak does not match the peak in the proof',
      computedPeak: computedPeak.toString('hex'),
      computedRoot: null,
      expected: peaks[derivedPeakIndex],
    };
  }

  const computedRoot = bagPeaks(
    peaks.map((p) => Buffer.from(p, 'hex')),
    shape.mmrSize,
  );
  const rootBuf = Buffer.isBuffer(root) ? root : Buffer.from(root, 'hex');
  if (!computedRoot.equals(rootBuf)) {
    return {
      ok: false,
      reason: 'recomputed root does not match the checkpoint commitment',
      computedPeak: computedPeak.toString('hex'),
      computedRoot: computedRoot.toString('hex'),
      expected: rootBuf.toString('hex'),
    };
  }

  return {
    ok: true,
    reason: null,
    computedPeak: computedPeak.toString('hex'),
    computedRoot: computedRoot.toString('hex'),
    pathLength: derivedPath.length,
  };

  function fail(reason) {
    return { ok: false, reason, computedRoot: null, computedPeak: null };
  }
}
