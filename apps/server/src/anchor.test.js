import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyEvidenceBundle } from '@cigar-aac/verifier';
import {
  buildAnchorMessage,
  buildHederaReceipt,
  HEDERA_WITNESS,
} from '@cigar-aac/scitt';
import { runScenario } from './engine.js';
import { hederaEnabled } from './anchor.js';

/**
 * The anchored path, end to end on a real bundle, with no network and no
 * credentials. The SDK submission is the only thing not covered here; these
 * tests simulate its result using the mirror-node shape taken from live
 * testnet data.
 */

/** Anchor a real run the way anchor.js does, but with a synthetic consensus result. */
function anchorLocally(result, { seq = 4, ts = '1790027173.227046219' } = {}) {
  const statementBytes = Buffer.from(result.bundle.scitt.statement_b64, 'base64');
  const claims = result.bundle.cll.checkpoint.claims;
  const { bytes } = buildAnchorMessage({
    statementBytes,
    commitment: claims.commitment,
    logId: claims.log_id,
    logSize: claims.log_size,
  });
  const receipt = buildHederaReceipt({
    network: 'testnet',
    topicId: '0.0.9498849',
    messageBytes: bytes,
    consensus: {
      sequenceNumber: seq,
      runningHash: Buffer.from('rh').toString('base64'),
      runningHashVersion: 3,
      consensusTimestamp: ts,
      transactionId: '0.0.1234@1790027160.000000000',
    },
    submittedAt: '2026-09-21T14:05:00Z',
  });
  const bundle = {
    ...result.bundle,
    scitt: { ...result.bundle.scitt, witness: HEDERA_WITNESS, hedera: receipt },
  };
  const mirrorRecord = {
    consensus_timestamp: receipt.consensus_timestamp,
    message: receipt.message_b64,
    running_hash: receipt.running_hash,
    running_hash_version: 3,
    sequence_number: receipt.sequence_number,
    topic_id: receipt.topic_id,
  };
  return { bundle, receipt, mirrorRecord, statementBytes };
}

describe('the demo runs unchanged without credentials', () => {
  it('switches on credentials alone, independent of the machine it runs on', () => {
    // This used to assert "disabled" and quietly assumed no .env existed - so
    // it broke the moment a developer added real credentials. It now controls
    // the variables itself. Note it never touches the network.
    // Configuration reads process.env only; tests never open a local .env.
    const saved = {
      id: process.env.HEDERA_ACCOUNT_ID,
      key: process.env.HEDERA_PRIVATE_KEY,
      offline: process.env.DEMO_OFFLINE,
      network: process.env.HEDERA_NETWORK,
    };
    try {
      process.env.DEMO_OFFLINE = '';
      process.env.HEDERA_NETWORK = 'testnet';
      delete process.env.HEDERA_ACCOUNT_ID;
      delete process.env.HEDERA_PRIVATE_KEY;
      expect(hederaEnabled()).toBe(false);

      process.env.HEDERA_ACCOUNT_ID = '0.0.1';
      expect(hederaEnabled(), 'an account id alone must not enable it').toBe(false);

      process.env.HEDERA_PRIVATE_KEY = 'placeholder';
      expect(hederaEnabled()).toBe(true);
    } finally {
      for (const [k, v] of [['HEDERA_ACCOUNT_ID', saved.id], ['HEDERA_PRIVATE_KEY', saved.key], ['DEMO_OFFLINE', saved.offline], ['HEDERA_NETWORK', saved.network]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('never anchors from runScenario, whatever the environment', () => {
    // Anchoring happens only in the server route, after the offline run. So
    // the test suite cannot reach a public network even with real credentials
    // sitting in .env.
    const r = runScenario('clean-settlement');
    expect(r.bundle.scitt.hedera).toBeUndefined();
    expect(r.bundle.scitt.witness).toBeUndefined();
  });

  it('still verifies every scenario against the local transparency service', () => {
    for (const id of ['clean-settlement', 'policy-block', 'unknown-reconcile', 'poisoned-context']) {
      const r = runScenario(id);
      expect(r.ok, id).toBe(true);
      expect(r.bundle.scitt.hedera).toBeUndefined();
    }
  });

  it('reports no public anchor in the summary', () => {
    expect(runScenario('clean-settlement').verification.summary.public_anchor).toBe(null);
  });
});

describe('an anchored bundle verifies', () => {
  const base = runScenario('unknown-reconcile');
  const { bundle, receipt, mirrorRecord, statementBytes } = anchorLocally(base);

  it('passes offline, without re-reading the network', () => {
    const v = verifyEvidenceBundle(bundle);
    expect(v.ok).toBe(true);
  });

  it('does not claim consensus was confirmed when checked offline', () => {
    const v = verifyEvidenceBundle(bundle);
    expect(v.summary.public_anchor.confirmed).toBe(false);
    const step = v.checks.find((c) => c.name.includes('re-checked against a mirror node'));
    expect(step.detail).toMatch(/NOT re-checked/);
    expect(step.detail).toContain(receipt.mirror_url);
  });

  it('confirms consensus when a mirror record is supplied', () => {
    const v = verifyEvidenceBundle(bundle, { mirrorRecord });
    expect(v.ok).toBe(true);
    expect(v.summary.public_anchor.confirmed).toBe(true);
    expect(v.summary.public_anchor.consensus_timestamp).toBe(receipt.consensus_timestamp);
  });

  it('names Hedera as the witness in the summary', () => {
    const v = verifyEvidenceBundle(bundle, { mirrorRecord });
    expect(v.summary.witness).toBe(HEDERA_WITNESS);
    expect(v.summary.public_anchor.topic_id).toBe('0.0.9498849');
  });

  it('claims an unforgeable time bracket only once confirmed', () => {
    expect(verifyEvidenceBundle(bundle).scope.establishes.join(' ')).not.toMatch(/cannot forge/);
    expect(verifyEvidenceBundle(bundle, { mirrorRecord }).scope.establishes.join(' ')).toMatch(/cannot forge/);
  });

  it('still refuses to say the claim inside the record is true', () => {
    const v = verifyEvidenceBundle(bundle, { mirrorRecord });
    expect(v.scope.doesNotEstablish.join(' ')).toMatch(/is TRUE/);
    expect(v.scope.doesNotEstablish.join(' ')).toMatch(/not a signed Merkle inclusion proof/);
  });

  it('keeps the RFC 9942 local receipt alongside the anchor', () => {
    // Different properties: the COSE receipt is offline-checkable and
    // spec-shaped; the anchor is a public, unforgeable time bracket.
    expect(bundle.scitt.receipt.vds).toBe('MMR_SHA256');
    expect(bundle.scitt.hedera.witness).toBe(HEDERA_WITNESS);
    const v = verifyEvidenceBundle(bundle, { mirrorRecord });
    expect(v.checks.some((c) => c.id === 9 && c.ok)).toBe(true);
    expect(v.checks.some((c) => c.id === 10 && c.ok)).toBe(true);
  });
});

describe('an anchor cannot be moved to another record', () => {
  const a = runScenario('clean-settlement');
  const b = runScenario('poisoned-context');

  it('fails when a valid anchor is attached to a different bundle', () => {
    const { receipt } = anchorLocally(a);
    const forged = {
      ...b.bundle,
      scitt: { ...b.bundle.scitt, witness: HEDERA_WITNESS, hedera: receipt },
    };
    const v = verifyEvidenceBundle(forged);
    expect(v.ok).toBe(false);
    const step = v.checks.find((c) => c.name.includes('names this exact statement'));
    expect(step.ok).toBe(false);
  });

  it('fails when the anchored digest is edited', () => {
    const { bundle, statementBytes } = anchorLocally(a);
    const tampered = JSON.parse(JSON.stringify(bundle));
    const msg = JSON.parse(Buffer.from(tampered.scitt.hedera.message_b64, 'base64').toString('utf8'));
    msg.statement_sha256 = createHash('sha256').update('something else').digest('hex');
    tampered.scitt.hedera.message_b64 = Buffer.from(JSON.stringify(msg), 'utf8').toString('base64');
    expect(verifyEvidenceBundle(tampered).ok).toBe(false);
    void statementBytes;
  });

  it('fails when the consensus timestamp is backdated', () => {
    const { bundle, mirrorRecord } = anchorLocally(a);
    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.scitt.hedera.consensus_timestamp = '1600000000.000000000';
    const v = verifyEvidenceBundle(tampered, { mirrorRecord });
    expect(v.ok).toBe(false);
    expect(v.checks.find((c) => c.name.includes('consensus timestamp matches')).ok).toBe(false);
    expect(v.summary.public_anchor.confirmed).toBe(false);
  });
});

describe('nothing about the payment reaches the public network', () => {
  it('publishes digests only, for every scenario', () => {
    for (const id of ['clean-settlement', 'unknown-reconcile', 'poisoned-context', 'policy-block']) {
      const { receipt } = anchorLocally(runScenario(id));
      const published = Buffer.from(receipt.message_b64, 'base64').toString('utf8');
      for (const secret of ['48200', '68400', 'INV-2026-0918', 'Meridian', 'DE89', 'LT12', 'treasury-ops']) {
        expect(published, `${id} leaked "${secret}" to the topic`).not.toContain(secret);
      }
    }
  });

  it('publishes under 400 bytes, so a topic message is never chunked', () => {
    const { receipt } = anchorLocally(runScenario('unknown-reconcile'));
    expect(receipt.message_bytes).toBeLessThan(400);
  });
});
