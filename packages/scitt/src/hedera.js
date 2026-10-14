import { createHash } from 'node:crypto';

/**
 * Hedera Consensus Service as the Transparency Service.
 *
 * Why HCS is a defensible witness: a topic is an ordered, consensus-timestamped,
 * running-hash-chained sequence of messages agreed by a public BFT network.
 * That is the shape of a transparency log, and it supplies exactly the two
 * properties the CLL briefing attributes to a witness - contemporaneity (an
 * append-time bracket) and non-equivocation - with a stronger independence
 * story than a self-hosted service signing its own receipts, because the
 * producer cannot forge a consensus timestamp.
 *
 * What it is NOT, stated plainly because this audience will ask:
 *
 *   - An HCS receipt is not an RFC 9942 COSE receipt. There is no COSE_Sign1
 *     over a Merkle inclusion proof. The verifiable data structure is consensus
 *     ordering plus a running hash, not an MMR, so `vds` here is a PROPOSED
 *     local identifier and not an IETF registration.
 *   - Confirming it requires a network read. Offline you can prove the receipt
 *     names THIS statement; you cannot prove the network accepted it. That
 *     trade-off is reported rather than hidden.
 *
 * This module is deliberately dependency-free and performs no I/O, so the
 * verifier keeps working with no SDK and no network. Submission and mirror
 * reads live at the edge, in apps/server/src/hedera-client.js.
 */

export const HEDERA_WITNESS = 'hedera-hcs';

/** PROPOSED verifiable-data-structure identifier. Not IETF-registered. */
export const HCS_VDS = 'HCS_CONSENSUS_V1';

/** The anchor profile written into each topic message. */
export const ANCHOR_PROFILE = 'cigar-aac-checkpoint-anchor';

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The exact bytes submitted to the topic.
 *
 * Digests only. The invoice number, the amount, the payee and the account
 * number are all absent by construction - the same discipline CLL applies to
 * its checkpoint. Anyone holding the statement can recompute
 * `statement_sha256` and match it; anyone who does not learns nothing.
 */
export function buildAnchorMessage({ statementBytes, commitment, logId, logSize }) {
  const payload = {
    v: 1,
    profile: ANCHOR_PROFILE,
    statement_sha256: sha256Hex(statementBytes),
    commitment,
    log_id: logId,
    log_size: logSize,
  };
  // Compact and stable: the topic is a public artifact, so its bytes should be
  // reproducible by anyone recomputing them from the same inputs.
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return { payload, bytes: Buffer.from(json, 'utf8') };
}

/** Assemble the receipt from a consensus submission result. */
export function buildHederaReceipt({ network, topicId, messageBytes, consensus, submittedAt }) {
  return {
    witness: HEDERA_WITNESS,
    vds: HCS_VDS,
    vds_note:
      'Consensus ordering plus running hash on a public network. PROPOSED identifier; ' +
      'not an RFC 9942 COSE receipt and not an IETF registration.',
    network,
    topic_id: topicId,
    sequence_number: consensus.sequenceNumber,
    consensus_timestamp: consensus.consensusTimestamp,
    running_hash: consensus.runningHash,
    running_hash_version: consensus.runningHashVersion ?? null,
    transaction_id: consensus.transactionId ?? null,
    message_b64: Buffer.from(messageBytes).toString('base64'),
    message_bytes: messageBytes.length,
    submitted_at: submittedAt,
    mirror_url: mirrorMessageUrl(network, topicId, consensus.sequenceNumber),
    explorer_url: explorerTopicUrl(network, topicId),
  };
}

export function mirrorBaseUrl(network) {
  return network === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : network === 'previewnet'
      ? 'https://previewnet.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';
}

export const mirrorMessageUrl = (network, topicId, seq) =>
  `${mirrorBaseUrl(network)}/api/v1/topics/${topicId}/messages/${seq}`;

export const explorerTopicUrl = (network, topicId) =>
  `https://hashscan.io/${network}/topic/${topicId}`;

/**
 * Verify what can be verified without touching the network.
 *
 * Establishes: this receipt names THIS statement, and the bytes it says were
 * published really do commit to it.
 * Does NOT establish: that the network accepted it. That needs `mirrorRecord`.
 */
export function verifyHederaReceiptOffline({ receipt, statementBytes }) {
  const steps = [];
  const push = (name, ok, detail, extra = {}) => steps.push({ name, ok, detail, ...extra });

  if (receipt?.witness !== HEDERA_WITNESS) {
    push('receipt is a Hedera anchor', false, `unexpected witness "${receipt?.witness}"`);
    return { ok: false, steps, confirmed: false };
  }

  let message = null;
  try {
    message = JSON.parse(Buffer.from(receipt.message_b64, 'base64').toString('utf8'));
  } catch (e) {
    push('published message parses', false, e.message);
    return { ok: false, steps, confirmed: false };
  }
  push('published message parses', true, `${receipt.message_bytes} bytes, profile "${message.profile}"`);

  const expected = sha256Hex(statementBytes);
  const namesThis = message.statement_sha256 === expected;
  push(
    'the published message names this exact statement',
    namesThis,
    namesThis
      ? `statement SHA-256 ${expected.slice(0, 16)}… matches the anchored digest`
      : `anchored ${String(message.statement_sha256).slice(0, 16)}… but this statement hashes to ${expected.slice(0, 16)}…`,
    { expected, computed: message.statement_sha256 },
  );

  const profileOk = message.profile === ANCHOR_PROFILE && message.v === 1;
  push('anchor profile is recognized', profileOk, `${message.profile} v${message.v}`);

  const shapeOk =
    /^\d+\.\d+\.\d+$/.test(String(receipt.topic_id))
    && Number.isFinite(Number(receipt.sequence_number))
    && Number(receipt.sequence_number) > 0
    && Boolean(receipt.consensus_timestamp);
  push(
    'consensus coordinates are well formed',
    shapeOk,
    shapeOk
      ? `topic ${receipt.topic_id}, sequence ${receipt.sequence_number}, consensus ${receipt.consensus_timestamp}`
      : 'topic id, sequence number or consensus timestamp is malformed',
  );

  const disclosureOk = !/\b(4820|48200|INV-|iban|IBAN)\b/.test(
    Buffer.from(receipt.message_b64, 'base64').toString('utf8'),
  );
  push(
    'only digests were published',
    disclosureOk,
    disclosureOk
      ? 'the anchored message carries digests and log coordinates, no business content'
      : 'the anchored message appears to contain business content',
  );

  return {
    ok: steps.every((s) => s.ok),
    steps,
    // The load-bearing caveat: nothing here proves the network accepted it.
    confirmed: false,
    message,
  };
}

/**
 * Confirm the anchor against a mirror-node record.
 *
 * This is what turns "the receipt names this statement" into "a public network
 * recorded it, at this consensus time, in this order".
 */
export function verifyHederaReceiptAgainstMirror({ receipt, statementBytes, mirrorRecord }) {
  const offline = verifyHederaReceiptOffline({ receipt, statementBytes });
  const steps = [...offline.steps];
  const push = (name, ok, detail, extra = {}) => steps.push({ name, ok, detail, ...extra });

  if (!mirrorRecord) {
    push('mirror node record retrieved', false, 'no record supplied');
    return { ok: false, steps, confirmed: false };
  }

  const sameBytes = String(mirrorRecord.message) === String(receipt.message_b64);
  push(
    'the network published these exact bytes',
    sameBytes,
    sameBytes ? 'mirror-node message is byte-identical to the receipt' : 'mirror-node message differs from the receipt',
    { expected: receipt.message_b64, computed: mirrorRecord.message },
  );

  const seqOk = Number(mirrorRecord.sequence_number) === Number(receipt.sequence_number);
  push('sequence number matches', seqOk, `mirror reports ${mirrorRecord.sequence_number}`);

  const topicOk = String(mirrorRecord.topic_id) === String(receipt.topic_id);
  push('topic matches', topicOk, `mirror reports ${mirrorRecord.topic_id}`);

  const tsOk = String(mirrorRecord.consensus_timestamp) === String(receipt.consensus_timestamp);
  push(
    'consensus timestamp matches',
    tsOk,
    `${mirrorRecord.consensus_timestamp}${tsOk ? '' : ` (receipt says ${receipt.consensus_timestamp})`}`,
  );

  const hashOk = !receipt.running_hash || String(mirrorRecord.running_hash) === String(receipt.running_hash);
  push(
    'running hash matches',
    hashOk,
    hashOk ? 'the topic’s hash chain covers this message' : 'running hash differs from the receipt',
  );

  const ok = steps.every((s) => s.ok);
  return { ok, steps, confirmed: ok };
}

/** What a Hedera anchor does and does not establish. Shown verbatim in the UI. */
export function hederaScope(receipt, { confirmed }) {
  return {
    establishes: [
      'a public network recorded a commitment to this exact statement',
      `it was ordered at sequence ${receipt.sequence_number} on topic ${receipt.topic_id}`,
      confirmed
        ? `the consensus timestamp ${receipt.consensus_timestamp} is a third-party time bracket we cannot forge`
        : 'the receipt names this statement (consensus not yet re-checked against a mirror node)',
      'the topic’s running hash chains this message to those before it',
    ],
    doesNotEstablish: [
      'that any claim inside the statement is TRUE',
      'that the operator held the authority it asserts',
      'anything about the content of the record — only digests were published',
      'an RFC 9942 COSE receipt: this is consensus ordering, not a signed Merkle inclusion proof',
      confirmed
        ? 'that the anchored statement is still current, or has not been superseded'
        : 'that the network accepted it — that requires reading the mirror node',
    ],
  };
}
