import { createHash } from 'node:crypto';
import { jcs, idBytes } from '@cigar-aac/cpb';
import { signSign1, verifySign1, parseSign1, HEADER, ALG, CWT } from '@cigar-aac/cose';
import { buildMmr, inclusionProof, verifyInclusion } from './mmr.js';

/**
 * Checkpointed Local Log.
 *
 * The discipline, in one sentence: entries are appended locally and never
 * published; only a checkpoint — a signed commitment to the log's entire
 * history — ever leaves the producer. Ten thousand records collapse into one
 * roughly 200-byte checkpoint.
 *
 * What each layer proves, kept straight because conflating them is the most
 * common overclaim in this space:
 *
 *   from the log, even unsigned : order, completeness, tamper-evidence
 *   from the witness           : contemporaneity, non-equivocation
 *   from the signature         : authorship — and only authorship
 */

export const CHECKPOINT_MEDIA_TYPE = 'application/cll-checkpoint+json';

/**
 * A log leaf commits to the *raw bytes* of a derived identifier.
 *
 * CPB is explicit and this is an easy, invisible bug: the preimage is the 32
 * bytes named by the hex string, never the 64 ASCII characters of the hex
 * string itself. Two implementations that disagree here produce two logs that
 * can never be reconciled.
 */
export function leafHashForId(hexId) {
  return createHash('sha256').update(idBytes(hexId)).digest();
}

export class CheckpointedLocalLog {
  /**
   * @param {object} o
   * @param {string} o.logId
   * @param {import('node:crypto').KeyObject} o.privateKey
   * @param {Buffer} o.rawPublicKey
   * @param {string} [o.cadence] declared checkpoint cadence
   * @param {() => string} [o.now] injected clock, so a demo can be deterministic
   */
  constructor({ logId, privateKey, rawPublicKey, cadence = 'on-append', now }) {
    this.logId = logId;
    this.privateKey = privateKey;
    this.rawPublicKey = rawPublicKey;
    this.cadence = cadence;
    this.now = now ?? (() => new Date().toISOString());

    /** Local entries. These never leave the producer. */
    this.entries = [];
    /** Every checkpoint issued, oldest first. */
    this.checkpoints = [];
  }

  /**
   * Append an entry. Returns its permanent leaf index.
   * @param {object} o
   * @param {string} o.id 64-char lowercase hex derived identifier
   * @param {string} [o.kind] local label, for the operator's own browsing
   * @param {object} [o.local] content kept local and never published
   */
  append({ id, kind = 'agent-action-capsule', local = null }) {
    const leafIndex = this.entries.length;
    this.entries.push({
      leaf_index: leafIndex,
      id,
      kind,
      leaf_hash: leafHashForId(id).toString('hex'),
      appended_at: this.now(),
      local,
    });
    return leafIndex;
  }

  get logSize() {
    return this.entries.length;
  }

  /** Rebuild the MMR over the current entries. */
  mmr() {
    return buildMmr(this.entries.map((e) => Buffer.from(e.leaf_hash, 'hex')));
  }

  /** The current 32-byte commitment, or null for an empty log. */
  commitment() {
    if (this.entries.length === 0) return null;
    return this.mmr().root;
  }

  /**
   * Issue a signed checkpoint.
   *
   * Field names follow the CLL draft's checkpoint claims table. The AAIF
   * briefing uses the shorthand size/root/prev_root for the same values; the
   * normative names are used here (see PRD section 9, C-3).
   */
  checkpoint() {
    if (this.entries.length === 0) throw new Error('cannot checkpoint an empty log');

    const previous = this.checkpoints[this.checkpoints.length - 1] ?? null;
    const claims = {
      kind: 'cll-checkpoint',
      log_id: this.logId,
      log_size: this.entries.length,
      commitment: this.commitment().toString('hex'),
      prev_size: previous ? previous.claims.log_size : 0,
      prev_commitment: previous ? previous.claims.commitment : null,
      issued_at: this.now(),
      cadence: this.cadence,
    };

    const payload = Buffer.from(jcs(claims), 'utf8');
    const { bytes } = signSign1({
      protectedHeader: {
        [HEADER.alg]: ALG.EdDSA,
        [HEADER.content_type]: CHECKPOINT_MEDIA_TYPE,
        [HEADER.kid]: this.rawPublicKey,
        [HEADER.cwt_claims]: new Map([
          [CWT.iss, this.logId],
          [CWT.sub, `cll://${this.logId}/checkpoint/${claims.log_size}`],
        ]),
      },
      payload,
      privateKey: this.privateKey,
    });

    const record = {
      claims,
      payload_b64: payload.toString('base64'),
      cose_sign1_b64: bytes.toString('base64'),
      bytes_on_the_wire: bytes.length,
    };
    this.checkpoints.push(record);
    return record;
  }

  /** An inclusion proof for one entry, against the current log. */
  proofFor(leafIndex) {
    return inclusionProof(this.mmr(), leafIndex);
  }

  /**
   * A range proof over contiguous leaves — the log's completeness claim.
   *
   * Scope, stated plainly: this demonstrates that every leaf in [start, end]
   * is included under one commitment and that their indices are contiguous
   * with no gaps. It is a per-leaf construction rather than the compact range
   * proof the MMR profile specifies, and the dashboard labels it as such.
   */
  rangeProof(start, end) {
    if (start < 0 || end >= this.entries.length || start > end) {
      throw new Error(`range ${start}..${end} outside a log of ${this.entries.length} leaves`);
    }
    const mmr = this.mmr();
    const leaves = [];
    for (let i = start; i <= end; i += 1) {
      leaves.push({
        leaf_index: i,
        leaf_hash: this.entries[i].leaf_hash,
        proof: inclusionProof(mmr, i),
      });
    }
    return {
      construction: 'per-leaf-inclusion',
      range: { start, end },
      log_size: this.entries.length,
      commitment: mmr.root.toString('hex'),
      leaves,
    };
  }
}

/**
 * Verify a signed checkpoint, and that it extends the one before it.
 *
 * The extension check is the part that turns a pile of individually signed
 * records into a stream: a producer who rewrites history has to either break a
 * signature or present a checkpoint that does not extend what a witness
 * already accepted.
 */
export function verifyCheckpoint(coseSign1Bytes, { expectedKey, previousClaims = null } = {}) {
  const steps = [];
  const sig = verifySign1(coseSign1Bytes, expectedKey ? { publicKey: expectedKey } : undefined);
  steps.push({
    name: 'checkpoint signature (COSE_Sign1, Ed25519)',
    ok: sig.ok,
    detail: sig.ok ? `signed over ${sig.signedBytes} bytes of Sig_Structure` : sig.reason,
  });
  if (!sig.ok) return { ok: false, steps, claims: null };

  const parsed = parseSign1(coseSign1Bytes);
  const contentType = parsed.protectedHeader.get(HEADER.content_type);
  const typeOk = contentType === CHECKPOINT_MEDIA_TYPE;
  steps.push({
    name: 'declared content type',
    ok: typeOk,
    detail: typeOk ? contentType : `expected ${CHECKPOINT_MEDIA_TYPE}, got ${contentType}`,
  });

  let claims;
  try {
    claims = JSON.parse(parsed.payload.toString('utf8'));
  } catch (e) {
    steps.push({ name: 'checkpoint payload parses', ok: false, detail: e.message });
    return { ok: false, steps, claims: null };
  }

  // The payload must be canonical: if a producer signed non-canonical bytes,
  // two verifiers could disagree about what the checkpoint says.
  const canonical = jcs(claims);
  const canonicalOk = canonical === parsed.payload.toString('utf8');
  steps.push({
    name: 'payload is canonical (RFC 8785 JCS)',
    ok: canonicalOk,
    detail: canonicalOk ? `${parsed.payload.length} canonical bytes` : 'payload is not JCS-canonical',
  });

  if (previousClaims) {
    const extendsOk =
      claims.prev_size === previousClaims.log_size &&
      claims.prev_commitment === previousClaims.commitment &&
      claims.log_size >= previousClaims.log_size;
    steps.push({
      name: 'extends the previously accepted checkpoint',
      ok: extendsOk,
      detail: extendsOk
        ? `size ${previousClaims.log_size} -> ${claims.log_size}`
        : `claims prev (${claims.prev_size}, ${String(claims.prev_commitment).slice(0, 12)}...) ` +
          `but last accepted was (${previousClaims.log_size}, ${String(previousClaims.commitment).slice(0, 12)}...)`,
    });
  }

  return { ok: steps.every((s) => s.ok), steps, claims };
}

export { buildMmr, inclusionProof, verifyInclusion };
