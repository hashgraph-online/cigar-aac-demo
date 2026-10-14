import { digestForType, canonicalDigest } from '@cigar-aac/cpb';
import { signSign1, HEADER, ALG } from '@cigar-aac/cose';

/**
 * Scoped capability handoff.
 *
 * The rule that matters: authority is INTERSECTED during delegation, not
 * transferred unrestricted. A child agent can never hold more than its parent
 * held, and never more than it asked for. Budgets take the minimum, expiry
 * takes the earlier instant.
 *
 * This artifact is the natural CAN member for a capsule: it is a signed,
 * recipient-bound statement of exactly what was permitted. AAC cites it
 * byte-identically rather than re-minting it.
 */

/** Intersect requested capabilities with what the delegator actually holds. */
export function intersectAuthority({ held, requested }) {
  const granted = requested.capabilities.filter((c) => held.capabilities.includes(c));
  const refused = requested.capabilities.filter((c) => !held.capabilities.includes(c));

  const heldMax = Number(held.budget.amount_max);
  const wantMax = Number(requested.budget.amount_max);
  const grantedMax = Math.min(heldMax, wantMax);

  const expiry =
    Date.parse(requested.expiry) < Date.parse(held.expiry) ? requested.expiry : held.expiry;

  return {
    granted,
    refused,
    budget: {
      // Money as an exact decimal string, never a binary float.
      amount_max: grantedMax.toFixed(2),
      currency: held.budget.currency,
      // Name the binding constraint honestly. When both sides state the same
      // ceiling, neither one capped anything, and saying "request" would
      // misattribute a limit the delegator also imposed.
      capped_by: heldMax === wantMax ? 'neither — both declared the same ceiling'
        : heldMax < wantMax ? 'delegator'
        : 'request',
    },
    expiry,
    expiry_capped_by: expiry === held.expiry ? 'delegator' : 'request',
  };
}

/**
 * Issue a signed, recipient-bound handoff.
 *
 * @param {object} o
 * @param {object} o.held         the delegator's own authority
 * @param {object} o.requested    what the child asked for
 * @param {object} o.keyPair      the delegator's key
 */
export function issueHandoff({
  handoff_id,
  issuer,
  recipient,
  task,
  acceptance_criteria,
  held,
  requested,
  keyPair,
  now,
}) {
  const intersection = intersectAuthority({ held, requested });

  const handoff = {
    handoff_kind: 'cigar-signed-handoff',
    handoff_id,
    issuer,
    // Recipient-bound: this handoff is usable by exactly one recipient.
    recipient,
    task,
    acceptance_criteria,
    granted_capabilities: intersection.granted,
    refused_capabilities: intersection.refused,
    budget: intersection.budget,
    expiry: intersection.expiry,
    issued_at: now(),
    authority_derivation: {
      rule: 'intersection',
      held_capabilities: held.capabilities,
      requested_capabilities: requested.capabilities,
      note: 'authority is intersected during delegation, never transferred unrestricted',
    },
  };

  // Sign the handoff. The signature is over the canonical bytes of the
  // handoff, so the artifact can be cited as-transmitted by another format.
  const canonical = canonicalDigest({ payload: handoff, algorithm: 'jcs-n' });
  const { bytes } = signSign1({
    protectedHeader: {
      [HEADER.alg]: ALG.EdDSA,
      [HEADER.content_type]: 'application/cigar-signed-handoff+json',
      [HEADER.kid]: keyPair.rawPublicKey,
    },
    payload: Buffer.from(canonical.canonical, 'utf8'),
    privateKey: keyPair.privateKey,
  });

  return {
    handoff,
    intersection,
    canonical: canonical.canonical,
    digest: digestForType('cigar-signed-handoff', handoff).digest,
    cose_sign1_b64: bytes.toString('base64'),
  };
}

/** Would this handoff permit a given effect? Checked before dispatch. */
export function authorizeEffect({ handoff, capability, amount, at }) {
  const checks = [];

  checks.push({
    name: 'capability is granted by the handoff',
    ok: handoff.granted_capabilities.includes(capability),
    detail: `${capability} in [${handoff.granted_capabilities.join(', ')}]`,
  });

  const within = Number(amount) <= Number(handoff.budget.amount_max);
  checks.push({
    name: 'amount is within the delegated budget',
    ok: within,
    detail: `${amount} ${handoff.budget.currency} against a ceiling of ${handoff.budget.amount_max}`,
  });

  const unexpired = Date.parse(at) <= Date.parse(handoff.expiry);
  checks.push({
    name: 'handoff has not expired',
    ok: unexpired,
    detail: `at ${at}, expires ${handoff.expiry}`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}
