import { verifyEvidenceBundle } from '@cigar-aac/verifier';
import { HEDERA_WITNESS, hederaScope } from '@cigar-aac/scitt';
import { anchorStatement, fetchMirrorRecord } from './hedera-client.js';
import { hederaConfig } from './env.js';

/**
 * Anchoring is a separate, network-dependent step AFTER the offline run.
 *
 * Deliberately not folded into runScenario: the run stays synchronous,
 * deterministic and offline, which is what keeps the test suite honest and the
 * demo immune to a bad conference network. Anchoring is what the real sequence
 * looks like anyway - you seal and log locally, then publish a commitment.
 *
 * Every failure path degrades to the local witness and SAYS SO. A demo that
 * silently falls back is a demo that lies about what it just proved.
 */

export function hederaEnabled() {
  return hederaConfig().configured;
}

/**
 * Anchor a completed run's checkpoint to a Hedera topic, then re-verify.
 *
 * @param {object} result the output of runScenario
 * @param {{confirm?: boolean}} [options] confirm re-reads the mirror node
 */
export async function anchorRun(result, { confirm = true } = {}) {
  if (!result?.bundle?.scitt) return result;

  const statementB64 = result.bundle.scitt.statement_b64;
  const statementBytes = Buffer.from(statementB64, 'base64');
  const claims = result.bundle.cll.checkpoint.claims;

  const anchored = await anchorStatement({
    statementBytes,
    commitment: claims.commitment,
    logId: claims.log_id,
    logSize: claims.log_size,
  });

  if (!anchored.ok) {
    return withAnchorOutcome(result, {
      witness: 'local',
      hedera: null,
      hedera_error: anchored.reason,
    });
  }

  // Re-read it from a mirror node. This is the step that upgrades "the receipt
  // names this statement" to "a public network recorded it".
  let mirrorRecord = null;
  let mirrorError = null;
  let mirrorAttempts = 0;
  if (confirm) {
    const mirror = await fetchMirrorRecord({
      network: anchored.receipt.network,
      topicId: anchored.receipt.topic_id,
      sequenceNumber: anchored.receipt.sequence_number,
    });
    mirrorAttempts = mirror.attempts ?? 0;
    if (mirror.ok) mirrorRecord = mirror.record;
    else mirrorError = mirror.reason;
  }

  return withAnchorOutcome(
    result,
    {
      witness: HEDERA_WITNESS,
      hedera: anchored.receipt,
      hedera_error: null,
      mirror_error: mirrorError,
      mirror_attempts: mirrorAttempts,
      created_topic: anchored.createdTopic ?? false,
      // Carried in the bundle so the dashboard - and anyone reading the
      // exported JSON - gets the scope statement without recomputing it.
      hedera_scope: hederaScope(anchored.receipt, { confirmed: Boolean(mirrorRecord) }),
    },
    mirrorRecord,
  );
}

/**
 * Merge the anchor into the bundle, re-verify, and rebuild the tail of the
 * event stream so the walkthrough narrates the anchor before verification.
 */
function withAnchorOutcome(result, scittPatch, mirrorRecord = null) {
  const bundle = {
    ...result.bundle,
    scitt: { ...result.bundle.scitt, ...scittPatch },
  };

  const verification = verifyEvidenceBundle(bundle, { mirrorRecord });
  const confirmed = verification.summary.public_anchor?.confirmed === true;
  if (bundle.scitt.hedera) bundle.scitt.hedera_scope = hederaScope(bundle.scitt.hedera, { confirmed });

  // Keep every event except the verification ones, which are recomputed.
  const kept = result.events.filter(
    (e) => e.kind !== 'verify.step' && e.kind !== 'verify.verdict',
  );

  const anchorEvent = scittPatch.hedera
    ? {
        kind: 'scitt.anchored',
        at: scittPatch.hedera.submitted_at,
        network: scittPatch.hedera.network,
        topic_id: scittPatch.hedera.topic_id,
        sequence_number: scittPatch.hedera.sequence_number,
        consensus_timestamp: scittPatch.hedera.consensus_timestamp,
        running_hash: scittPatch.hedera.running_hash,
        message_bytes: scittPatch.hedera.message_bytes,
        explorer_url: scittPatch.hedera.explorer_url,
        mirror_url: scittPatch.hedera.mirror_url,
        confirmed,
        created_topic: scittPatch.created_topic ?? false,
      }
    : {
        kind: 'scitt.anchor_failed',
        reason: scittPatch.hedera_error,
      };

  // Insert after the last witness event, so it lands in the log step and the
  // step ordering stays monotonic.
  const lastWitness = kept.reduce(
    (acc, e, i) => (e.kind.startsWith('scitt.') ? i : acc),
    -1,
  );
  kept.splice(lastWitness + 1, 0, anchorEvent);

  const verifyEvents = [
    ...verification.checks.map((c) => ({ kind: 'verify.step', ...c })),
    {
      kind: 'verify.verdict',
      ok: verification.ok,
      summary: verification.summary,
      scope: verification.scope,
    },
  ];

  const events = [...kept, ...verifyEvents].map((e, i) => ({ ...e, seq: i }));

  return { ...result, bundle, verification, events, ok: verification.ok };
}
