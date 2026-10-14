import { createHash } from 'node:crypto';
import { verifyTypedRef, canonicalDigest, idBytes, jcs } from '@cigar-aac/cpb';
import { verifyInclusion, verifyCheckpoint, leafHashForId } from '@cigar-aac/cll';
import { verifyReceipt, verifyHederaReceiptOffline, verifyHederaReceiptAgainstMirror, hederaScope } from '@cigar-aac/scitt';
import { verifyCapsulePayload, verifyProducerEnvelope } from '@cigar-aac/aac';

/**
 * The independent verifier.
 *
 * This module is the point of the whole exercise. It answers the AAIF brief's
 * fourth question - "Can another party verify it later?" - under the
 * constraint the brief sets: an independent verifier checks the record WITHOUT
 * needing CIGAR internals.
 *
 * So: this file imports the record format (aac), the digest rule (cpb), the
 * signature format (cose), the log (cll) and the witness (scitt). It does NOT
 * import the runtime that produced any of it. There is no code path from here
 * into @cigar-aac/cigar, and a test asserts that rather than trusting it.
 *
 * Everything it needs arrives in one evidence bundle. No network, no database,
 * no access to the producing system, no key it was not handed.
 */

export const BUNDLE_FORMAT = 'cigar-aac-evidence-bundle/v1';

/** A single check's result, shaped so the dashboard can stream it. */
const check = (id, name, ok, detail, extra = {}) => ({ id, name, ok, detail, ...extra });

/**
 * Verify an evidence bundle.
 * @param {object} bundle
 * @param {{mirrorRecord?: object|null}} [options] a mirror-node record, when the
 *        caller has chosen to go online and re-read a public anchor
 */
export function verifyEvidenceBundle(bundle, options = {}) {
  const checks = [];
  try { return verifyBundle(bundle, options, checks); }
  catch (error) {
    checks.push(check(0, 'malformed evidence bundle', false, error.message));
    return finish(checks, bundle);
  }
}

function verifyBundle(bundle, { mirrorRecord = null } = {}, checks) {
  const fail = (id, name, detail, extra) => checks.push(check(id, name, false, detail, extra));

  if (bundle?.bundle_format !== BUNDLE_FORMAT) {
    fail(0, 'bundle format is recognized', `expected ${BUNDLE_FORMAT}, got ${bundle?.bundle_format}`);
    return finish(checks, bundle);
  }

  const capsules = bundle.capsules ?? [];
  if (!Array.isArray(capsules) || capsules.length === 0) {
    fail(0, 'evidence contains at least one capsule', 'an empty evidence bundle cannot establish an action record');
    return finish(checks, bundle);
  }

  const payloadResults = capsules.map((item) => verifyCapsulePayload(item?.capsule, { store: capsules }));

  // ---- 1. Identity uses only the format-4/JCS path, after declaration checks.
  for (const [i, item] of capsules.entries()) {
    const profile = payloadResults[i];
    const identity = profile.identity;
    const identityCheck = profile.checks[1];
    checks.push(check(1, `capsule_id recomputes from the record (${item?.capsule?.action_id ?? i})`, identityCheck.ok,
      identityCheck.detail, { expected: item?.capsule?.capsule_id, computed: identity?.digest,
        canonical: identity?.canonical, algorithm: identity?.algorithm, exclusion_set: identity?.exclusionSet }));
  }

  // ---- 2. Each Producer Envelope is independent of payload Class 1 and the others.
  const envelopeResults = [];
  for (const item of capsules) {
    const envelopes = item.producer_envelopes ?? (item.cose_sign1_b64 === undefined ? [] : [item.cose_sign1_b64]);
    if (!Array.isArray(envelopes) || envelopes.length === 0) {
      fail(2, 'demo bundle includes a producer envelope', 'the demo bundle profile requires signed evidence; bare AAC payload validity is reported separately');
      continue;
    }
    for (const [i, envelope] of envelopes.entries()) {
      const result = verifyProducerEnvelope(item.capsule?.capsule_id, envelope);
      envelopeResults.push({ capsule_id: item.capsule?.capsule_id, index: i, ...result });
      checks.push(check(2, `producer signature over capsule_id (${item.capsule?.action_id}, envelope ${i + 1})`, result.ok,
        result.reason ?? `Ed25519 over the raw 32 bytes, kid ${result.authenticated_public_key}`,
        { kid: result.authenticated_public_key, signed_bytes: result.signed_bytes, authorization: result.authorization }));
    }
  }

  // ---- 3. Draft-05 Class 1 payload checks; no manifest or runtime dependency.
  for (const [i, item] of capsules.entries()) {
    const profile = payloadResults[i];
    const agentChecks = profile.checks.filter((c) => ![2, 6].includes(c.id));
    checks.push(check(3, `AAC profile invariants (${item?.capsule?.action_id ?? i})`, agentChecks.every((c) => c.ok),
      agentChecks.filter((c) => !c.ok).map((c) => c.detail).join('; ') || 'AAC draft-05 format, effect binding, verdict, attestation and provenance checks pass',
      { profile_checks: agentChecks, findings: profile.findings, derived_assurance: profile.derived_assurance }));
  }

  // ---- 4. Do the slot members resolve? The digest context comes from the
  //         registry, keyed on the reference's declared type.
  for (const item of capsules) {
    for (const ref of item.capsule.references ?? []) {
      if (!ref.slot) continue; // Cross-stream references are informational citations, not required disclosure.
      const member = (item.members ?? []).find((m) => m.slot === ref.slot);
      if (!member) {
        fail(4, `slot "${ref.slot}" member present (${item.capsule.action_id})`,
          `the capsule references a ${ref.type} in slot "${ref.slot}" but the bundle does not carry it`);
        continue;
      }
      const result = verifyTypedRef(ref, member.artifact);
      checks.push(
        check(4, `slot "${ref.slot}" resolves to its artifact (${ref.type})`, result.ok,
          result.ok
            ? `${ref.digest.slice(0, 16)}... under "${result.context.algorithm}"` +
              (result.context.proposed ? ' - PROPOSED artifact type, not IETF-registered' : '')
            : `reference says ${result.expected.slice(0, 16)}... but the artifact digests to ${result.actual.slice(0, 16)}...`,
          {
            expected: result.expected,
            computed: result.actual,
            digest_context: result.context,
            proposed: result.context.proposed,
          }),
      );
    }
  }

  // The demo discloses request/response JSON in DID. Commit the whole value,
  // including nested fields, nulls and empty collections (AAC draft-05 §2).
  for (const item of capsules) {
    const did = (item.members ?? []).find((m) => m.slot === 'did')?.artifact;
    if (!did) continue;
    for (const field of ['request', 'response']) {
      if (did[field] === undefined) continue;
      const computed = canonicalDigest({ payload: did[field], algorithm: 'jcs' }).digest;
      const digestField = field + '_digest';
      const claimed = did[digestField];
      const effectClaim = item.capsule.effect?.[digestField];
      const ok = claimed === computed && (effectClaim === undefined || effectClaim === computed);
      checks.push(check(4, `whole ${field} JSON binding (${item.capsule.action_id})`, ok,
        ok ? 'SHA-256 over plain JCS of the entire disclosed value' : 'disclosed JSON does not match its DID or effect digest',
        { expected: claimed, computed }));
    }
  }

  // ---- 4b. The AUDIT member cites CIGAR artifacts by digest rather than
  //          carrying them. Resolve those citations against the artifacts the
  //          bundle carries, using the registry's digest context per type.
  //
  //          Without this check, an operator could edit the selection manifest
  //          - deleting the record that a poisoned source was rejected - and
  //          every other check would still pass. This is the step that makes
  //          "AAC references rather than duplicates CIGAR artifacts" mean
  //          something to a verifier.
  const referenced = bundle.referenced_artifacts ?? null;
  const CITED = [
    ['native_execution_digest', 'cigar_execution', 'cigar-native-execution'],
    ['selection_manifest_digest', 'selection_manifest', 'cigar-selection-manifest'],
    ['context_bundle_digest', 'context_bundle', 'cigar-context-bundle'],
    ['decision_environment_digest', 'decision_environment', 'cigar-decision-environment'],
  ];

  for (const item of capsules) {
    const auditMember = (item.members ?? []).find((m) => m.slot === 'audit');
    const cited = auditMember?.artifact?.context_evidence;
    if (!cited) continue;

    for (const [digestField, artifactField, type] of CITED) {
      const claimed = cited[digestField];
      if (!claimed) continue;
      const artifact = referenced?.[artifactField];
      if (!artifact) {
        fail(4, `cited ${type} is carried (${item.capsule.action_id})`,
          `the AUDIT member cites a ${type} by digest but the bundle does not carry it`);
        continue;
      }
      const result = verifyTypedRef({ type, digest_alg: 'SHA-256', digest: claimed }, artifact);
      checks.push(
        check(4, `cited ${type} resolves (${item.capsule.action_id})`, result.ok,
          result.ok
            ? `${claimed.slice(0, 16)}... matches the carried artifact under "${result.context.algorithm}"`
            : `the AUDIT member cites ${claimed.slice(0, 16)}... but the carried artifact digests to ${result.actual.slice(0, 16)}...`,
          { expected: result.expected, computed: result.actual, digest_context: result.context }),
      );
    }

    // The exclusion count the record asserts must match the manifest carried.
    const manifest = referenced?.selection_manifest;
    if (manifest && typeof cited.sources_excluded === 'number') {
      const actual = (manifest.excluded ?? []).length;
      const ok = actual === cited.sources_excluded;
      checks.push(
        check(4, `exclusion count agrees with the manifest (${item.capsule.action_id})`, ok,
          ok
            ? `${actual} source(s) excluded, as the record asserts`
            : `the record asserts ${cited.sources_excluded} exclusion(s) but the manifest carries ${actual}`,
          { expected: String(cited.sources_excluded), computed: String(actual) }),
      );
    }
  }

  // ---- 5. Only chain is same-stream custody; references never satisfy this check.
  for (const [i, item] of capsules.entries()) {
    const chain = payloadResults[i].checks[5];
    checks.push(check(5, `capsule chain links (${item.capsule.action_id})`, chain.ok, chain.detail,
      { parent: item.capsule.chain?.parent_capsule_id, relation: item.capsule.chain?.relation }));
  }

  // ---- 6. Is each record in the log, under the checkpoint's commitment?
  const checkpoint = bundle.cll?.checkpoint ?? null;
  if (!checkpoint) {
    fail(6, 'log inclusion', 'the bundle carries no CLL checkpoint');
  } else {
    for (const item of capsules) {
      if (!item.cll) {
        fail(6, `log inclusion (${item.capsule.action_id})`, 'no inclusion proof supplied for this record');
        continue;
      }
      // Recompute the leaf from the raw id bytes rather than trusting the
      // leaf hash the bundle happens to carry.
      const recomputedLeaf = leafHashForId(item.capsule.capsule_id);
      const inclusion = verifyInclusion({
        leafHash: recomputedLeaf,
        proof: item.cll.proof,
        root: checkpoint.claims.commitment,
      });
      checks.push(
        check(6, `record is in the log under the checkpoint (${item.capsule.action_id})`, inclusion.ok,
          inclusion.ok
            ? `leaf ${item.cll.proof.leaf_index} of ${item.cll.proof.log_size}, ${inclusion.pathLength}-node path to ${inclusion.computedRoot.slice(0, 16)}...`
            : inclusion.reason,
          {
            leaf_index: item.cll.proof.leaf_index,
            leaf_hash: recomputedLeaf.toString('hex'),
            computed: inclusion.computedRoot,
            expected: checkpoint.claims.commitment,
          }),
      );
    }
  }

  // ---- 7. Is the checkpoint signed, canonical, and does it extend its predecessor?
  if (checkpoint) {
    const cpResult = verifyCheckpoint(Buffer.from(checkpoint.cose_sign1_b64, 'base64'), {
      previousClaims: bundle.cll.previous_checkpoint?.claims ?? null,
    });
    const metadataMatches = cpResult.claims !== null && jcs(cpResult.claims) === jcs(checkpoint.claims);
    checks.push(check(7, 'checkpoint metadata matches the signed payload', metadataMatches,
      metadataMatches ? 'the root, log size, log identity and timestamps used for inclusion are authenticated by this checkpoint signature'
        : 'the displayed checkpoint claims differ from the signed checkpoint payload'));
    if (cpResult.claims) {
      const sameLog = cpResult.claims.log_id === bundle.cll.log_id;
      checks.push(check(7, 'checkpoint belongs to the declared log', sameLog,
        sameLog ? 'log identifiers agree' : 'bundle log_id differs from the signed checkpoint log_id'));
      for (const item of capsules) {
        const coordinatesAgree = item.cll?.proof?.log_size === cpResult.claims.log_size
          && item.cll?.leaf_index === item.cll?.proof?.leaf_index;
        checks.push(check(7, `log proof coordinates agree (${item.capsule.action_id})`, coordinatesAgree,
          coordinatesAgree ? 'zero-based leaf index and signed log size agree' : 'proof log size or leaf index differs from the supplied coordinates'));
      }
    }
    for (const step of cpResult.steps) {
      checks.push(check(7, `checkpoint: ${step.name}`, step.ok, step.detail));
    }
  }

  // ---- 8. Are the bytes the witness registered the same bytes we hold?
  const scitt = bundle.scitt ?? null;
  if (!scitt) {
    checks.push(
      check(8, 'witness registration', true,
        'this bundle is self-attested: no witness receipt is present, and it claims none'),
    );
  } else if (checkpoint) {
    const held = Buffer.from(checkpoint.cose_sign1_b64, 'base64');
    const registered = Buffer.from(scitt.statement_b64, 'base64');
    const same = held.equals(registered);
    checks.push(
      check(8, 'the registered statement is the checkpoint we hold', same,
        same
          ? `${held.length} bytes, byte-identical`
          : `the bundle's checkpoint is ${held.length} bytes and the registered statement is ${registered.length} bytes; they differ`,
        { statement_sha256: createHash('sha256').update(registered).digest('hex') }),
    );
  }

  // ---- 9. Does the receipt verify offline, without the witness's help?
  if (scitt) {
    const receiptResult = verifyReceipt({
      receipt: scitt.receipt,
      statementBytes: Buffer.from(scitt.statement_b64, 'base64'),
    });
    for (const step of receiptResult.steps) {
      checks.push(check(9, `receipt: ${step.name}`, step.ok, step.detail, {
        computed: step.computed,
        expected: step.expected,
      }));
    }
  }

  // ---- 10. Did a public network record a commitment to this?
  //
  //  Present only when the run was anchored. Deliberately split into what can
  //  be established offline and what cannot: offline you can prove the receipt
  //  names THIS statement; proving the network accepted it needs a mirror read,
  //  which the caller supplies rather than this function performing I/O.
  const anchor = bundle.scitt?.hedera ?? null;
  let mirrorConfirmed = false;
  if (anchor) {
    const statementBytes = Buffer.from(bundle.scitt.statement_b64, 'base64');
    const result = mirrorRecord
      ? verifyHederaReceiptAgainstMirror({ receipt: anchor, statementBytes, mirrorRecord })
      : verifyHederaReceiptOffline({ receipt: anchor, statementBytes });
    mirrorConfirmed = result.ok && result.confirmed;

    for (const st of result.steps) {
      checks.push(check(10, `public anchor: ${st.name}`, st.ok, st.detail, {
        expected: st.expected,
        computed: st.computed,
      }));
    }

    // Not a failure - a scope statement. An unconfirmed anchor is still a
    // truthful record of what was submitted; it simply has not been re-read.
    checks.push(
      check(10, 'consensus inclusion re-checked against a mirror node', true,
        result.confirmed
          ? `confirmed: ${anchor.network} topic ${anchor.topic_id}, sequence ${anchor.sequence_number}, consensus ${anchor.consensus_timestamp}`
          : 'NOT re-checked in this run \u2014 offline verification proves the receipt names this '
            + `statement, not that the network accepted it. Re-check at ${anchor.mirror_url}`,
        { confirmed: result.confirmed }),
    );
  }

  return finish(checks, bundle, { mirrorConfirmed: anchor ? mirrorConfirmed : null, payloadResults, envelopeResults });
}

function finish(checks, bundle, { mirrorConfirmed = null, payloadResults = [], envelopeResults = [] } = {}) {
  const ok = checks.every((c) => c.ok);
  const witnessed = Boolean(bundle?.scitt);
  const anchor = bundle?.scitt?.hedera ?? null;
  const anchorScope = anchor ? hederaScope(anchor, { confirmed: Boolean(mirrorConfirmed) }) : null;

  return {
    ok,
    checks,
    aac: {
      profile: 'draft-mih-scitt-agent-action-capsule-05',
      payloads: payloadResults.map((result, i) => ({ capsule_id: bundle.capsules[i]?.capsule?.capsule_id, ...result })),
      producer_envelopes: envelopeResults,
      assurance_scope: 'Local checkpoint receipts and Hedera checkpoint anchoring do not confer per-Capsule RFC 9943 registration or externally trusted AAC anchored assurance.',
    },
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      records: bundle?.capsules?.length ?? 0,
      log_size: bundle?.cll?.checkpoint?.claims?.log_size ?? null,
      witnessed,
      witness: bundle?.scitt?.witness ?? (witnessed ? 'local' : null),
      public_anchor: anchor
        ? {
            network: anchor.network,
            topic_id: anchor.topic_id,
            sequence_number: anchor.sequence_number,
            consensus_timestamp: anchor.consensus_timestamp,
            confirmed: Boolean(mirrorConfirmed),
            explorer_url: anchor.explorer_url,
          }
        : null,
      first_failure: checks.find((c) => !c.ok) ?? null,
    },

    // ---- 10. The scope report, which is a check in its own right: a verifier
    //          that lets a reader over-read its verdict has failed at its job.
    scope: {
      establishes: ok
        ? [
            'each record names itself: its declared id is the digest of its own bytes',
            'each record was signed by the key its envelope names',
            'each record satisfies the AAC profile invariants, re-checked here',
            'every disclosed composition artifact matches its declared canonical digest context',
            'the records sit at fixed positions in an append-only log',
            witnessed
              ? 'the demo-owned witness signed a receipt over the supplied log checkpoint'
              : 'no witness is claimed, and none is required for the above',
            ...(anchorScope ? anchorScope.establishes : []),
          ]
        : ['nothing - at least one check failed, see below'],
      doesNotEstablish: [
        'that any claim inside a record is TRUE',
        'an independently trustworthy timestamp from the local witness clock',
        'that the operator held the authority the CAN member asserts',
        'that the policy encoded in the runtime was the right policy',
        'that the agent should have taken this action',
        'that no other, unrecorded action was also taken',
        witnessed
          ? 'future availability of any of these artifacts'
          : 'contemporaneity - nothing here brackets when it happened',
        ...(anchorScope ? anchorScope.doesNotEstablish.filter((x) => !x.startsWith('that any claim')) : []),
      ],
      note:
        'Digest equality is a join mechanism, not proof of sufficiency. Each record ' +
        'verifies independently; that two records agree on a digest says they refer ' +
        'to the same thing, not that the thing was correct.',
    },
    verifier: {
      name: '@cigar-aac/verifier',
      independence:
        'This verifier has no import path to the CIGAR runtime. It read only the ' +
        'evidence bundle, used no network, and needed no key it was not handed.',
    },
  };
}

export { jcs, idBytes };
