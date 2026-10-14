/**
 * CIGAR policy evaluation.
 *
 * The ordering property that distinguishes this layer from a post-hoc audit
 * log: policy is evaluated BEFORE retrieval. Protected material is never
 * fetched, never materialized and never disclosed to the model unless the
 * contract's purpose, principal and trust floor already permit it.
 *
 * An after-the-fact record can tell you that something leaked. This ordering
 * is what stops it leaking.
 */

/**
 * Source authority tiers, most authoritative first.
 * A contract declares a trust floor; anything below it never enters retrieval.
 */
export const AUTHORITY_TIERS = Object.freeze([
  'governance',
  'system-of-record',
  'attested',
  'derived',
  'unverified',
]);

export const authorityRank = (authority) => {
  const i = AUTHORITY_TIERS.indexOf(authority);
  if (i === -1) throw new Error(`unknown authority tier "${authority}"`);
  return i;
};

/** Does `authority` meet or exceed the declared `floor`? */
export const meetsFloor = (authority, floor) => authorityRank(authority) <= authorityRank(floor);

export const RECORD_TYPES = Object.freeze(['claim', 'instruction', 'evidence', 'decision', 'symbol']);

/**
 * Evaluate the contract itself, before any source is touched.
 * @returns {{ok:boolean, decisions:{name:string,ok:boolean,detail:string}[]}}
 */
export function evaluateContract(contract, { allowedPurposes, principals }) {
  const decisions = [];

  decisions.push({
    name: 'purpose is declared and recognized',
    ok: allowedPurposes.includes(contract.purpose),
    detail: contract.purpose,
  });

  const principal = principals[contract.principal];
  decisions.push({
    name: 'principal is known',
    ok: Boolean(principal),
    detail: contract.principal,
  });

  if (principal) {
    decisions.push({
      name: 'principal is authorized for this purpose',
      ok: principal.purposes.includes(contract.purpose),
      detail: `${contract.principal} may: ${principal.purposes.join(', ')}`,
    });
  }

  decisions.push({
    name: 'trust floor is declared',
    ok: AUTHORITY_TIERS.includes(contract.trust_floor),
    detail: `floor = ${contract.trust_floor}`,
  });

  decisions.push({
    name: 'budget is bounded',
    ok:
      Number.isInteger(contract.budget?.max_records) &&
      contract.budget.max_records > 0 &&
      Number.isInteger(contract.budget?.max_tokens) &&
      contract.budget.max_tokens > 0,
    detail: `${contract.budget?.max_records} records / ${contract.budget?.max_tokens} tokens`,
  });

  return { ok: decisions.every((d) => d.ok), decisions };
}

/**
 * Decide whether one candidate source may enter retrieval.
 * Returns an admit/exclude verdict with the rule that decided it, because an
 * exclusion without a reason is not evidence of anything.
 */
export function screenSource(record, contract, corpus) {
  // 1. Trust floor — this is the rule that stops the poisoned email.
  if (!meetsFloor(record.authority, contract.trust_floor)) {
    return {
      admit: false,
      rule: 'trust_floor',
      reason:
        `source authority "${record.authority}" is below the contract's trust floor ` +
        `"${contract.trust_floor}"`,
    };
  }

  // 2. Verification state.
  if (record.verification_state !== 'verified') {
    return {
      admit: false,
      rule: 'verification_state',
      reason: `source is ${record.verification_state}, and this contract requires verified sources`,
    };
  }

  // 3. Supersession — a superseded record is excluded even though it is
  //    authentic, authorized and verified. Authenticity is not currency.
  if (record.superseded_by?.length) {
    const by = record.superseded_by.join(', ');
    const successorPresent = record.superseded_by.some((id) => corpus.some((r) => r.source_id === id));
    return {
      admit: false,
      rule: 'supersession',
      reason: `superseded by ${by}${successorPresent ? '' : ' (successor not in snapshot)'}`,
    };
  }

  // 4. Validity window, evaluated against the contract's as_of instant.
  const asOf = Date.parse(contract.as_of);
  if (record.valid_from && Date.parse(record.valid_from) > asOf) {
    return { admit: false, rule: 'validity_window', reason: `not yet valid (from ${record.valid_from})` };
  }
  if (record.valid_to && Date.parse(record.valid_to) < asOf) {
    return { admit: false, rule: 'validity_window', reason: `expired (until ${record.valid_to})` };
  }

  // 5. Purpose binding on protected material — policy before disclosure.
  if (record.protected_for?.length && !record.protected_for.includes(contract.purpose)) {
    return {
      admit: false,
      rule: 'purpose_binding',
      reason:
        `protected material is bound to purposes [${record.protected_for.join(', ')}] ` +
        `and this contract's purpose is "${contract.purpose}"`,
    };
  }

  return { admit: true, rule: 'admitted', reason: `meets ${contract.trust_floor} floor, verified, current` };
}
