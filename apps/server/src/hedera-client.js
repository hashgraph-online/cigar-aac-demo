import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk';
import {
  buildAnchorMessage,
  buildHederaReceipt,
  mirrorBaseUrl,
  mirrorMessageUrl,
} from '@cigar-aac/scitt';
import { hederaConfig } from './env.js';

/**
 * The only part of this demo that touches a network.
 *
 * Kept at the edge on purpose: packages/* stay dependency-free so the crypto
 * and verification path remains auditable in-repo and checkable offline. This
 * file is the exception, and it is the one file whose failure must never take
 * the demo down - every path returns a reason instead of throwing.
 */

let cached = null;

/** Release SDK connections for CLI checks and graceful server shutdown. */
export function closeHederaWitness() {
  cached?.client?.close();
  cached = null;
}

/**
 * Resolve the operator key, checked against the account it claims to control.
 *
 * Why this is not a simple parse: a raw 32-byte hex string is a valid private
 * key under BOTH ECDSA secp256k1 and ED25519, so the string alone cannot tell
 * you which one it is. Worse, the SDK's fromStringDer() silently accepts raw
 * hex and reinterprets it as ED25519 - so "try parsers in order, take the first
 * that succeeds" signs with the wrong key and the network answers
 * INVALID_SIGNATURE. That is exactly what happened on the first live run.
 *
 * So: parse under every plausible algorithm, derive each public key, and keep
 * the one that matches the account's public key as published on a mirror node.
 * If none matches, say so plainly - that key does not belong to that account.
 */
async function resolveOperatorKey(cfg) {
  const raw = cfg.privateKey;
  const body = raw.replace(/^0x/i, '');
  const looksDer = /^30[0-9a-f]{2}/i.test(body);

  // Only offer DER when the string is actually DER-shaped; otherwise
  // fromStringDer() would silently misread it.
  const candidates = [
    ...(looksDer ? [['DER', () => PrivateKey.fromStringDer(raw)]] : []),
    ['ECDSA_SECP256K1', () => PrivateKey.fromStringECDSA(raw)],
    ['ED25519', () => PrivateKey.fromStringED25519(raw)],
  ];

  const parsed = [];
  for (const [format, fn] of candidates) {
    try {
      const key = fn();
      parsed.push({
        format,
        key,
        pubRaw: key.publicKey.toStringRaw().toLowerCase(),
        pubDer: key.publicKey.toStringDer().toLowerCase(),
      });
    } catch {
      // Not valid under this algorithm; try the next.
    }
  }
  if (parsed.length === 0) {
    throw new Error('HEDERA_PRIVATE_KEY is not a valid ED25519, ECDSA or DER-encoded key');
  }

  // The authoritative answer: which candidate controls this account?
  let accountKey = null;
  try {
    const res = await fetch(
      `${mirrorBaseUrl(cfg.network)}/api/v1/accounts/${cfg.accountId}`,
      { signal: AbortSignal.timeout(cfg.timeoutMs) },
    );
    if (res.ok) {
      const acct = await res.json();
      accountKey = acct?.key?.key ? { type: acct.key._type, key: String(acct.key.key).toLowerCase() } : null;
    }
  } catch {
    // Mirror unreachable; fall back to convention below, and say so.
  }

  if (accountKey) {
    const match = parsed.find(
      (p) => accountKey.key === p.pubRaw || accountKey.key === p.pubDer
        || accountKey.key.endsWith(p.pubRaw) || p.pubDer.endsWith(accountKey.key),
    );
    if (!match) {
      throw new Error(
        `HEDERA_PRIVATE_KEY does not control account ${cfg.accountId}: the account's ` +
        `${accountKey.type} public key matches none of the ${parsed.length} ways this key ` +
        'can be read. Check that the key and account id belong together.',
      );
    }
    return { key: match.key, format: match.format, verifiedAgainstAccount: true, accountKeyType: accountKey.type };
  }

  // No mirror answer. Follow the Hedera portal's own convention - 0x-prefixed
  // hex is ECDSA, DER-prefixed is DER, bare hex is ED25519 - and flag that the
  // choice was not verified.
  const byConvention = looksDer ? 'DER' : raw.toLowerCase().startsWith('0x') ? 'ECDSA_SECP256K1' : 'ED25519';
  const pick = parsed.find((p) => p.format === byConvention) ?? parsed[0];
  return { key: pick.key, format: pick.format, verifiedAgainstAccount: false, accountKeyType: null };
}

async function clientFor(cfg) {
  const client =
    cfg.network === 'mainnet' ? Client.forMainnet()
    : cfg.network === 'previewnet' ? Client.forPreviewnet()
    : Client.forTestnet();
  const resolved = await resolveOperatorKey(cfg);
  client.setOperator(cfg.accountId, resolved.key);
  client.setRequestTimeout(cfg.timeoutMs);
  return { client, ...resolved };
}

/**
 * Prepare the witness: build a client and make sure a topic exists.
 * Returns `{ ok: false, reason }` rather than throwing, always.
 */
export async function initHederaWitness() {
  const cfg = hederaConfig();
  if (!cfg.configured) {
    return { ok: false, reason: cfg.configurationError ?? 'HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are not set' };
  }
  if (cached?.ok) return cached;

  try {
    const { client, format, verifiedAgainstAccount, accountKeyType } = await clientFor(cfg);

    let topicId = cfg.topicId;
    let created = false;
    if (!topicId) {
      // No topic configured, so make one. Cheap on testnet, but the id should
      // be put in .env afterwards so every run anchors to the same topic and
      // the sequence numbers mean something.
      const receipt = await (await new TopicCreateTransaction()
        .setTopicMemo('HOL Proof of action - checkpoint anchor (demo)')
        .execute(client)).getReceipt(client);
      topicId = receipt.topicId.toString();
      created = true;
    }

    cached = {
      ok: true,
      client,
      network: cfg.network,
      accountId: cfg.accountId,
      topicId,
      createdTopic: created,
      keyFormat: format,
      keyVerifiedAgainstAccount: verifiedAgainstAccount,
      accountKeyType,
    };
    return cached;
  } catch (e) {
    return { ok: false, reason: `Hedera witness unavailable: ${e.message}` };
  }
}

/**
 * Register a signed statement by anchoring a commitment to it on a topic.
 *
 * Only digests are published. The message is built by the dependency-free
 * module so that the exact bytes are reproducible by a verifier that has never
 * loaded the SDK.
 */
export async function anchorStatement({ statementBytes, commitment, logId, logSize }) {
  const w = await initHederaWitness();
  if (!w.ok) return { ok: false, reason: w.reason };

  const { payload, bytes } = buildAnchorMessage({ statementBytes, commitment, logId, logSize });

  try {
    const submitted = await new TopicMessageSubmitTransaction()
      .setTopicId(w.topicId)
      .setMessage(bytes)
      .execute(w.client);

    const receipt = await submitted.getReceipt(w.client);
    const record = await submitted.getRecord(w.client);

    const consensus = {
      sequenceNumber: Number(receipt.topicSequenceNumber?.toString() ?? 0),
      runningHash: Buffer.from(receipt.topicRunningHash ?? []).toString('base64'),
      runningHashVersion: 3,
      consensusTimestamp: timestampString(record.consensusTimestamp),
      transactionId: submitted.transactionId?.toString() ?? null,
    };

    return {
      ok: true,
      payload,
      receipt: buildHederaReceipt({
        network: w.network,
        topicId: w.topicId,
        messageBytes: bytes,
        consensus,
        submittedAt: new Date().toISOString(),
      }),
      createdTopic: w.createdTopic,
    };
  } catch (e) {
    return { ok: false, reason: `anchor submission failed: ${e.message}` };
  }
}

/** Hedera timestamps are seconds.nanos; the mirror node reports the same shape. */
function timestampString(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') return ts;
  const seconds = ts.seconds?.toString?.() ?? String(ts.seconds ?? '');
  const nanos = String(ts.nanos ?? 0).padStart(9, '0');
  return seconds ? `${seconds}.${nanos}` : null;
}

/**
 * Read the anchor back from a mirror node.
 *
 * This is the step that turns "the receipt names this statement" into "a public
 * network recorded it". Uses built-in fetch, so the verifier can do the same
 * with no dependency at all.
 *
 * Retries on 404, because a mirror node indexes consensus a few seconds AFTER
 * it happens. The first live runs read back immediately and got 404 every time
 * even though all five messages were on the network - a single read reports a
 * true message as missing. Anything other than 404 is a real answer and is
 * returned at once.
 */
export async function fetchMirrorRecord(
  { network, topicId, sequenceNumber },
  { timeoutMs = 20000, intervalMs = 1500 } = {},
) {
  const url = mirrorMessageUrl(network, topicId, sequenceNumber);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let last = null;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(8000, timeoutMs)) });
      if (res.ok) return { ok: true, record: await res.json(), url, attempts };
      if (res.status !== 404) return { ok: false, reason: `mirror node returned ${res.status}`, url, attempts };
      last = 'not yet indexed (404)';
    } catch (e) {
      last = `unreachable: ${e.message}`;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    ok: false,
    reason: `mirror node had not indexed the message after ${attempts} attempts over ${Math.round(timeoutMs / 1000)}s (${last})`,
    url,
    attempts,
  };
}
