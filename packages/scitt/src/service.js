import { createHash } from 'node:crypto';
import {
  signSign1,
  verifySign1,
  parseSign1,
  HEADER,
  CWT,
  ALG,
  VDS,
  VDP,
  cwtClaims,
  encode,
  decode,
} from '@cigar-aac/cose';
import { buildMmr, inclusionProof, verifyInclusion } from '@cigar-aac/cll';
import { CHECKPOINT_MEDIA_TYPE } from '@cigar-aac/cll';

/**
 * A SCITT Transparency Service (RFC 9943 architecture, RFC 9942 receipts).
 *
 * There is no new protocol here: statements are registered and receipts are
 * read. What the service adds over a signature is narrow and worth stating
 * precisely, because overclaiming it is the fastest way to lose an audience
 * that knows better:
 *
 *   a receipt says   : this exact statement was registered, and by when
 *   a receipt does not say : that the claim inside it is true
 *
 * Two structural properties follow from registration:
 *   inclusion proof   - this statement is under the published root, checked
 *                       against the root rather than the issuer's word
 *   consistency proof - log N+1 is log N plus more; nothing committed was rewritten
 */

export const RECEIPT_MEDIA_TYPE = 'application/scitt-receipt+cose';

/**
 * Demo-local private-use COSE header label carrying an action class, so the
 * registration policy can gate on it without parsing the payload.
 *
 * PROPOSED, not registered. The briefing states that policy "gates by
 * statement type and action class - without parsing the payload", which
 * requires the class to be visible in the header. This is one concrete way to
 * do that, offered for discussion.
 */
export const HEADER_ACTION_CLASS = -65537;

export class TransparencyService {
  /**
   * @param {object} o
   * @param {string} o.serviceId
   * @param {import('node:crypto').KeyObject} o.privateKey
   * @param {Buffer} o.rawPublicKey
   * @param {object} [o.policy]
   * @param {string[]} [o.policy.acceptedContentTypes]
   * @param {string[]} [o.policy.acceptedIssuers]
   * @param {string[]} [o.policy.acceptedActionClasses]
   * @param {boolean} [o.policy.checkpointAware] refuse a non-extending checkpoint
   * @param {() => string} [o.now]
   */
  constructor({ serviceId, privateKey, rawPublicKey, policy = {}, now }) {
    this.serviceId = serviceId;
    this.privateKey = privateKey;
    this.rawPublicKey = rawPublicKey;
    this.now = now ?? (() => new Date().toISOString());
    this.policy = {
      acceptedContentTypes: policy.acceptedContentTypes ?? null,
      acceptedIssuers: policy.acceptedIssuers ?? null,
      acceptedActionClasses: policy.acceptedActionClasses ?? null,
      checkpointAware: policy.checkpointAware ?? true,
    };

    /** The service's verifiable data structure: one leaf per registered statement. */
    this.leaves = [];
    this.registrations = [];
    /** Last checkpoint accepted per log id, for the extension refusal. */
    this.lastCheckpointByLog = new Map();
  }

  /**
   * Evaluate registration policy against the *header only*.
   *
   * Deliberately never touches the payload. A witness that had to understand
   * payloads would need a parser for every profile that ever registers with
   * it, and would become a bottleneck on the ecosystem it exists to serve.
   */
  evaluatePolicy(protectedHeader) {
    const contentType = protectedHeader.get(HEADER.content_type) ?? null;
    const claims = cwtClaims(protectedHeader);
    const actionClass = protectedHeader.get(HEADER_ACTION_CLASS) ?? null;
    const checks = [];

    if (this.policy.acceptedContentTypes) {
      checks.push({
        name: 'statement type is accepted',
        ok: this.policy.acceptedContentTypes.includes(contentType),
        detail: contentType ?? '(none declared)',
      });
    }
    if (this.policy.acceptedIssuers) {
      checks.push({
        name: 'issuer is accepted',
        ok: Boolean(claims?.iss) && this.policy.acceptedIssuers.includes(claims.iss),
        detail: claims?.iss ?? '(no iss claim)',
      });
    }
    if (this.policy.acceptedActionClasses) {
      checks.push({
        name: 'action class is accepted',
        ok: Boolean(actionClass) && this.policy.acceptedActionClasses.includes(actionClass),
        detail: actionClass ?? '(no action class declared)',
      });
    }

    return {
      ok: checks.every((c) => c.ok),
      checks,
      contentType,
      issuer: claims?.iss ?? null,
      subject: claims?.sub ?? null,
      actionClass,
      payloadInspected: false,
    };
  }

  /**
   * Register a signed statement and return a receipt.
   *
   * @param {Buffer} signedStatementBytes a COSE_Sign1
   * @returns {{registered:boolean, reason?:string, policy:object, receipt?:object, entry?:object}}
   */
  register(signedStatementBytes) {
    const bytes = Buffer.isBuffer(signedStatementBytes)
      ? signedStatementBytes
      : Buffer.from(signedStatementBytes);

    // 1. The statement must be a well-formed, internally valid COSE_Sign1.
    //    The service checks the signature verifies under the key the statement
    //    itself names; it does not thereby vouch for that key's authority.
    const sig = verifySign1(bytes);
    if (!sig.ok) {
      return { registered: false, reason: `statement signature invalid: ${sig.reason}`, policy: null };
    }

    const parsed = parseSign1(bytes);
    const policy = this.evaluatePolicy(parsed.protectedHeader);
    if (!policy.ok) {
      const failed = policy.checks.filter((c) => !c.ok).map((c) => c.name);
      return { registered: false, reason: `registration policy refused: ${failed.join('; ')}`, policy };
    }

    // 2. A checkpoint-aware witness refuses a checkpoint that does not extend
    //    the last one it accepted for that log. This is what makes rewriting
    //    history detectable by a third party rather than only by the producer.
    let extension = null;
    if (this.policy.checkpointAware && policy.contentType === CHECKPOINT_MEDIA_TYPE) {
      const claims = JSON.parse(parsed.payload.toString('utf8'));
      const last = this.lastCheckpointByLog.get(claims.log_id) ?? null;
      if (last) {
        const extendsOk =
          claims.prev_size === last.log_size &&
          claims.prev_commitment === last.commitment &&
          claims.log_size >= last.log_size;
        extension = {
          ok: extendsOk,
          from: { log_size: last.log_size, commitment: last.commitment },
          to: { log_size: claims.log_size, commitment: claims.commitment },
        };
        if (!extendsOk) {
          return {
            registered: false,
            reason:
              `checkpoint does not extend the last accepted one for log "${claims.log_id}": ` +
              `expected prev (${last.log_size}, ${last.commitment.slice(0, 12)}...), ` +
              `got (${claims.prev_size}, ${String(claims.prev_commitment).slice(0, 12)}...)`,
            policy,
            extension,
          };
        }
      } else {
        extension = { ok: true, from: null, to: { log_size: claims.log_size, commitment: claims.commitment } };
      }
      this.lastCheckpointByLog.set(claims.log_id, claims);
    }

    // 3. Append the registered statement to the service's verifiable data
    //    structure. The leaf commits to the whole signed statement's bytes.
    const leafHash = createHash('sha256').update(bytes).digest();
    const leafIndex = this.leaves.length;
    this.leaves.push(leafHash);

    const registeredAt = this.now();
    const mmr = buildMmr(this.leaves);
    const proof = inclusionProof(mmr, leafIndex);
    const root = mmr.root;

    // 4. Issue the receipt: a second COSE_Sign1, signed by the service, whose
    //    payload is the published root and whose unprotected header carries
    //    the inclusion proof. It rides in the statement's unprotected header
    //    so the record travels with its own proof.
    const { bytes: receiptBytes } = signSign1({
      protectedHeader: {
        [HEADER.alg]: ALG.EdDSA,
        [HEADER.content_type]: RECEIPT_MEDIA_TYPE,
        [HEADER.kid]: this.rawPublicKey,
        [HEADER.vds]: VDS.MMR_SHA256,
        [HEADER.cwt_claims]: new Map([
          [CWT.iss, this.serviceId],
          [CWT.sub, policy.subject ?? `statement/${leafIndex}`],
          [CWT.iat, Math.floor(Date.parse(registeredAt) / 1000)],
        ]),
      },
      unprotectedHeader: {
        [HEADER.vdp]: new Map([[VDP.inclusion, [encodeInclusionProof(proof)]]]),
      },
      payload: root,
      privateKey: this.privateKey,
    });

    const entry = {
      leaf_index: leafIndex,
      leaf_hash: leafHash.toString('hex'),
      registered_at: registeredAt,
      statement_content_type: policy.contentType,
      issuer: policy.issuer,
      subject: policy.subject,
      log_size: this.leaves.length,
      root: root.toString('hex'),
    };
    this.registrations.push(entry);

    return {
      registered: true,
      policy,
      extension,
      entry,
      receipt: {
        cose_sign1_b64: receiptBytes.toString('base64'),
        root: root.toString('hex'),
        leaf_index: leafIndex,
        log_size: this.leaves.length,
        registered_at: registeredAt,
        service_id: this.serviceId,
        vds: 'MMR_SHA256',
        proof,
        bytes: receiptBytes.length,
      },
      /** What the receipt establishes, and what it does not. Shown verbatim in the UI. */
      scope: {
        establishes: [
          'this exact signed statement was registered with this service',
          'it is included under the published root, checked against the root',
          'the receipt carries the demo witness’s claimed registration time, not an independent clock',
        ],
        doesNotEstablish: [
          'that the claim inside the statement is true',
          'that the issuer held the authority it asserts',
          'that the statement is still current, or has not been superseded',
          'availability of the statement in future',
        ],
      },
    };
  }

  /** The service's currently published root. */
  publishedRoot() {
    if (this.leaves.length === 0) return null;
    return buildMmr(this.leaves).root.toString('hex');
  }
}

/** vdp inclusion proof, CBOR: [ index, [ +bstr ] ] per the MMR profile. */
export function encodeInclusionProof(proof) {
  return encode([proof.leaf_index, proof.path.map((p) => Buffer.from(p.hash, 'hex'))]);
}

/**
 * Verify a receipt offline.
 *
 * Note what is *not* required: any network access, and any key other than the
 * one the receipt itself names. That is the property that makes a receipt
 * portable across trust boundaries.
 */
export function verifyReceipt({ receipt, statementBytes, serviceKey = null }) {
  const steps = [];
  const receiptBytes = Buffer.from(receipt.cose_sign1_b64, 'base64');

  const sig = verifySign1(receiptBytes, serviceKey ? { publicKey: serviceKey } : undefined);
  steps.push({
    name: 'receipt signature (COSE_Sign1 by the Transparency Service)',
    ok: sig.ok,
    detail: sig.ok
      ? `signed by kid ${sig.kid?.slice(0, 16)}... over ${sig.signedBytes} bytes`
      : sig.reason,
  });
  if (!sig.ok) return { ok: false, steps };

  const parsed = parseSign1(receiptBytes);
  const claims = cwtClaims(parsed.protectedHeader);
  const metadataAgrees = Buffer.isBuffer(parsed.payload) && receipt.root === parsed.payload.toString('hex')
    && receipt.service_id === claims?.iss
    && Number.isFinite(Date.parse(receipt.registered_at))
    && Math.floor(Date.parse(receipt.registered_at) / 1000) === claims?.iat
    && receipt.leaf_index === receipt.proof?.leaf_index
    && receipt.log_size === receipt.proof?.log_size;
  steps.push({ name: 'receipt metadata agrees with its signed root and claims', ok: metadataAgrees,
    detail: metadataAgrees ? 'root, signer, claimed time and proof coordinates agree; the local clock remains self-attested'
      : 'receipt metadata differs from its protected claims, signed root or proof coordinates' });

  const vds = parsed.protectedHeader.get(HEADER.vds);
  steps.push({
    name: 'verifiable data structure declared (vds, label 395)',
    ok: vds === VDS.MMR_SHA256,
    detail: vds === VDS.MMR_SHA256 ? `MMR_SHA256 (${vds})` : `unexpected vds ${vds}`,
  });

  const vdp = parsed.unprotected.get(HEADER.vdp);
  const hasProof = vdp instanceof Map && Array.isArray(vdp.get(VDP.inclusion));
  steps.push({
    name: 'inclusion proof present (vdp, label 396, entry -1)',
    ok: hasProof,
    detail: hasProof ? `${vdp.get(VDP.inclusion).length} proof(s)` : 'no inclusion proof in vdp',
  });
  if (!hasProof) return { ok: false, steps };

  // The receipt's payload is the published root the signature covers.
  const root = parsed.payload;
  steps.push({
    name: 'receipt commits to a published root',
    ok: Buffer.isBuffer(root) && root.length === 32,
    detail: Buffer.isBuffer(root) ? root.toString('hex') : 'payload is not a 32-byte root',
  });

  // Recompute this statement's leaf from its bytes and check it lands under
  // that root. Recomputing is the point: the receipt does not get to assert
  // which leaf it covers.
  const leafHash = createHash('sha256').update(statementBytes).digest();

  const inclusion = verifyInclusion({ leafHash, proof: receipt.proof, root });
  steps.push({
    name: 'statement is included under the published root',
    ok: inclusion.ok,
    detail: inclusion.ok
      ? `leaf ${receipt.proof.leaf_index} of ${receipt.proof.log_size}, path length ${inclusion.pathLength}`
      : inclusion.reason,
    computed: inclusion.computedRoot,
    expected: root.toString('hex'),
  });

  // Cross-check that the CBOR vdp proof agrees with the JSON proof we folded,
  // so a receipt cannot carry one proof for machines and another for humans.
  const cborProof = decode(vdp.get(VDP.inclusion)[0]);
  const cborIndex = cborProof[0];
  const cborPath = cborProof[1].map((b) => b.toString('hex'));
  const agrees =
    cborIndex === receipt.proof.leaf_index &&
    cborPath.length === receipt.proof.path.length &&
    cborPath.every((h, i) => h === receipt.proof.path[i].hash);
  steps.push({
    name: 'CBOR vdp proof agrees with the presented proof',
    ok: agrees,
    detail: agrees ? `index ${cborIndex}, ${cborPath.length} nodes` : 'vdp proof and presented proof differ',
  });

  return { ok: steps.every((s) => s.ok), steps, root: root.toString('hex') };
}
