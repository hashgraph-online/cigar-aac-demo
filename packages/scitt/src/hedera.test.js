import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  HEDERA_WITNESS,
  HCS_VDS,
  ANCHOR_PROFILE,
  buildAnchorMessage,
  buildHederaReceipt,
  verifyHederaReceiptOffline,
  verifyHederaReceiptAgainstMirror,
  hederaScope,
  mirrorMessageUrl,
  explorerTopicUrl,
} from './hedera.js';

/**
 * These cover everything except the SDK submission itself, which needs real
 * credentials. The mirror-node record shape used here was taken from a live
 * testnet topic, so the field names and types are the real ones.
 */

const statement = Buffer.from('a signed statement, pretend this is COSE_Sign1 bytes', 'utf8');
const statementDigest = createHash('sha256').update(statement).digest('hex');
const commitment = 'ab'.repeat(32);

const anchorArgs = {
  statementBytes: statement,
  commitment,
  logId: 'northwind-ap-settlement',
  logSize: 3,
};

const consensus = {
  sequenceNumber: 7,
  runningHash: Buffer.from('running-hash-bytes').toString('base64'),
  runningHashVersion: 3,
  consensusTimestamp: '1790027173.227046219',
  transactionId: '0.0.1234@1790027160.000000000',
};

const makeReceipt = (overrides = {}) => {
  const { bytes } = buildAnchorMessage(anchorArgs);
  return {
    ...buildHederaReceipt({
      network: 'testnet',
      topicId: '0.0.9498849',
      messageBytes: bytes,
      consensus,
      submittedAt: '2026-09-21T14:05:00Z',
    }),
    ...overrides,
  };
};

/** A mirror record in the exact shape testnet returns. */
const makeMirror = (receipt, overrides = {}) => ({
  chunk_info: null,
  consensus_timestamp: receipt.consensus_timestamp,
  message: receipt.message_b64,
  payer_account_id: '0.0.1234',
  running_hash: receipt.running_hash,
  running_hash_version: 3,
  sequence_number: receipt.sequence_number,
  topic_id: receipt.topic_id,
  ...overrides,
});

describe('the anchored message publishes digests and nothing else', () => {
  const { payload, bytes } = buildAnchorMessage(anchorArgs);

  it('commits to the statement by digest', () => {
    expect(payload.statement_sha256).toBe(statementDigest);
  });

  it('carries the checkpoint commitment and log coordinates', () => {
    expect(payload.commitment).toBe(commitment);
    expect(payload.log_size).toBe(3);
    expect(payload.profile).toBe(ANCHOR_PROFILE);
  });

  it('contains no business content whatsoever', () => {
    // The whole privacy claim in one assertion: nothing about the payment is
    // on a public network.
    const text = bytes.toString('utf8');
    for (const secret of ['48200', 'INV-2026-0918', 'Meridian', 'IBAN', 'DE89']) {
      expect(text, `anchored message leaked "${secret}"`).not.toContain(secret);
    }
  });

  it('is small enough for a single topic message', () => {
    // HCS messages chunk above ~1 KiB; an anchor should never need chunking.
    expect(bytes.length).toBeLessThan(400);
  });

  it('is byte-reproducible from the same inputs', () => {
    expect(buildAnchorMessage(anchorArgs).bytes.equals(bytes)).toBe(true);
  });

  it('changes if the statement changes', () => {
    const other = buildAnchorMessage({ ...anchorArgs, statementBytes: Buffer.from('different') });
    expect(other.bytes.equals(bytes)).toBe(false);
  });
});

describe('the receipt', () => {
  const receipt = makeReceipt();

  it('names Hedera as the witness and declares its data structure', () => {
    expect(receipt.witness).toBe(HEDERA_WITNESS);
    expect(receipt.vds).toBe(HCS_VDS);
  });

  it('labels itself as NOT an RFC 9942 receipt', () => {
    // The audience for this demo will check. Overclaiming here would be fatal.
    expect(receipt.vds_note).toMatch(/not an RFC 9942 COSE receipt/);
    expect(receipt.vds_note).toMatch(/not an IETF registration/);
  });

  it('carries the consensus coordinates', () => {
    expect(receipt.topic_id).toBe('0.0.9498849');
    expect(receipt.sequence_number).toBe(7);
    expect(receipt.consensus_timestamp).toBe('1790027173.227046219');
    expect(receipt.running_hash).toBeTruthy();
  });

  it('carries no private key material', () => {
    const s = JSON.stringify(receipt).toLowerCase();
    expect(s).not.toContain('private');
    expect(s).not.toContain('operator');
  });

  it('points at a mirror node and an explorer so anyone can re-check', () => {
    expect(receipt.mirror_url).toBe(mirrorMessageUrl('testnet', '0.0.9498849', 7));
    expect(receipt.mirror_url).toContain('testnet.mirrornode.hedera.com');
    expect(receipt.explorer_url).toBe(explorerTopicUrl('testnet', '0.0.9498849'));
  });

  it('routes to the right mirror per network', () => {
    expect(mirrorMessageUrl('mainnet', '0.0.1', 1)).toContain('mainnet-public');
    expect(mirrorMessageUrl('previewnet', '0.0.1', 1)).toContain('previewnet');
  });
});

describe('offline verification', () => {
  it('passes on an untouched receipt', () => {
    const r = verifyHederaReceiptOffline({ receipt: makeReceipt(), statementBytes: statement });
    expect(r.ok).toBe(true);
  });

  it('never claims consensus was confirmed', () => {
    // The load-bearing caveat. Offline you cannot know the network took it.
    const r = verifyHederaReceiptOffline({ receipt: makeReceipt(), statementBytes: statement });
    expect(r.confirmed).toBe(false);
  });

  it('fails when presented with a different statement', () => {
    const r = verifyHederaReceiptOffline({
      receipt: makeReceipt(),
      statementBytes: Buffer.from('a different statement'),
    });
    expect(r.ok).toBe(false);
    const step = r.steps.find((s) => s.name.includes('names this exact statement'));
    expect(step.ok).toBe(false);
    expect(step.expected).not.toBe(step.computed);
  });

  it('fails a malformed topic id or sequence number', () => {
    expect(verifyHederaReceiptOffline({ receipt: makeReceipt({ topic_id: 'nope' }), statementBytes: statement }).ok).toBe(false);
    expect(verifyHederaReceiptOffline({ receipt: makeReceipt({ sequence_number: 0 }), statementBytes: statement }).ok).toBe(false);
  });

  it('rejects a receipt from a different witness', () => {
    const r = verifyHederaReceiptOffline({ receipt: makeReceipt({ witness: 'something-else' }), statementBytes: statement });
    expect(r.ok).toBe(false);
  });

  it('rejects an anchor that smuggled business content onto a public network', () => {
    const leaky = Buffer.from(JSON.stringify({
      v: 1, profile: ANCHOR_PROFILE, statement_sha256: statementDigest,
      commitment, log_id: 'x', log_size: 1, memo: 'paid INV-2026-0918',
    }), 'utf8');
    const r = verifyHederaReceiptOffline({
      receipt: makeReceipt({ message_b64: leaky.toString('base64'), message_bytes: leaky.length }),
      statementBytes: statement,
    });
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.name.includes('only digests')).ok).toBe(false);
  });

  it('reports unparseable published bytes rather than throwing', () => {
    const r = verifyHederaReceiptOffline({
      receipt: makeReceipt({ message_b64: Buffer.from('not json').toString('base64') }),
      statementBytes: statement,
    });
    expect(r.ok).toBe(false);
  });
});

describe('confirmation against a mirror node', () => {
  const receipt = makeReceipt();

  it('confirms when the network published these exact bytes', () => {
    const r = verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement, mirrorRecord: makeMirror(receipt),
    });
    expect(r.ok).toBe(true);
    expect(r.confirmed).toBe(true);
  });

  it('fails when the network published different bytes', () => {
    const r = verifyHederaReceiptAgainstMirror({
      receipt,
      statementBytes: statement,
      mirrorRecord: makeMirror(receipt, { message: Buffer.from('other').toString('base64') }),
    });
    expect(r.ok).toBe(false);
    expect(r.confirmed).toBe(false);
  });

  it('fails on a consensus timestamp the receipt does not claim', () => {
    const r = verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement,
      mirrorRecord: makeMirror(receipt, { consensus_timestamp: '1700000000.000000000' }),
    });
    expect(r.ok).toBe(false);
  });

  it('fails on a sequence or topic mismatch', () => {
    expect(verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement, mirrorRecord: makeMirror(receipt, { sequence_number: 8 }),
    }).ok).toBe(false);
    expect(verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement, mirrorRecord: makeMirror(receipt, { topic_id: '0.0.1' }),
    }).ok).toBe(false);
  });

  it('fails on a running hash mismatch', () => {
    const r = verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement,
      mirrorRecord: makeMirror(receipt, { running_hash: Buffer.from('tampered').toString('base64') }),
    });
    expect(r.ok).toBe(false);
  });

  it('handles a missing record without throwing', () => {
    const r = verifyHederaReceiptAgainstMirror({ receipt, statementBytes: statement, mirrorRecord: null });
    expect(r.ok).toBe(false);
  });

  it('tolerates the mirror returning numbers as strings', () => {
    // Mirror responses are JSON; be liberal about numeric representation.
    const r = verifyHederaReceiptAgainstMirror({
      receipt, statementBytes: statement,
      mirrorRecord: makeMirror(receipt, { sequence_number: '7' }),
    });
    expect(r.ok).toBe(true);
  });
});

describe('what a public anchor does and does not establish', () => {
  const receipt = makeReceipt();

  it('claims a third-party time bracket only once confirmed', () => {
    const unconfirmed = hederaScope(receipt, { confirmed: false });
    expect(unconfirmed.establishes.join(' ')).not.toMatch(/cannot forge/);
    expect(unconfirmed.doesNotEstablish.join(' ')).toMatch(/requires reading the mirror node/);

    const confirmed = hederaScope(receipt, { confirmed: true });
    expect(confirmed.establishes.join(' ')).toMatch(/cannot forge/);
  });

  it('never claims the statement is true', () => {
    for (const confirmed of [true, false]) {
      const scope = hederaScope(receipt, { confirmed });
      expect(scope.doesNotEstablish.join(' ')).toMatch(/is TRUE/);
      expect(scope.doesNotEstablish.join(' ')).toMatch(/not a signed Merkle inclusion proof/);
    }
  });

  it('states that only digests were published', () => {
    expect(hederaScope(receipt, { confirmed: true }).doesNotEstablish.join(' '))
      .toMatch(/only digests were published/);
  });
});
