/**
 * AAC vocabularies, verbatim from draft-mih-scitt-agent-action-capsule.
 *
 * Registry vocabularies are extensible: unknown strings are informational.
 * Structural enums (action type, approver, effect status and assurance modes)
 * remain closed. See draft-05 sections 4, 6 and 12.
 */

export const SPEC_VERSION = 'draft-mih-scitt-agent-action-capsule-05';
export const FORMAT_VERSION = '4';
export const CAPSULE_MEDIA_TYPE = 'application/agent-action-capsule+json';
export const CAPSULE_ID_MEDIA_TYPE = 'application/agent-action-capsule-id';

export const ACTION_TYPE = Object.freeze(['fyi', 'decide']);

export const DECISION = Object.freeze(['accept', 'reject', 'needs_input', 'deferred']);

export const APPROVER = Object.freeze(['human', 'policy', 'counterparty']);

export const VERDICT_CLASS = Object.freeze([
  'executed',
  'blocked',
  'hitl_dispatched',
  'denied',
  'timeout',
  'errored',
  'engine_failure',
  'deferred',
  'needs_decision',
  'expired',
  'escalated',
  'resolved',
  'epoch_boundary',
]);

export const EFFECT_STATUS = Object.freeze([
  'planned',
  'dispatched',
  'confirmed',
  'failed',
  'reverted',
]);

export const EFFECT_ATTESTATION = Object.freeze(['gate_executed', 'runtime_claimed', 'host_served_observed']);

export const EFFECT_TYPE = Object.freeze(['write_order', 'send_payment', 'inference_completion']);
export const CHAIN_RELATION = Object.freeze(['follows', 'confirms', 'supersedes', 'epoch_opens', 'duplicates']);
export const CITATION_PURPOSE = Object.freeze(['acted_on', 'responds_to', 'ran_under', 'counterparty_half', 'counterparty_inclusion', 'corroborates_source_time']);
export const NEVER_DISPATCH = Object.freeze(['blocked', 'hitl_dispatched', 'denied', 'engine_failure', 'deferred', 'needs_decision', 'expired', 'escalated', 'resolved']);

export const IRREVERSIBILITY_CLASS = Object.freeze([
  'two_way',
  'one_way_recoverable',
  'one_way_consequential',
  'one_way_terminal',
]);

export const ATTESTATION_MODE = Object.freeze(['self_attested', 'anchored']);

export const EFFECT_MODE = Object.freeze(['not_applicable', 'dispatched_unconfirmed', 'confirmed']);

export const LEDGER_MODE = Object.freeze(['standalone', 'chained', 'anchored']);

export const CROSS_PARTY_RUNG = Object.freeze([
  'unilateral_fallback',
  'acknowledged_receipt',
  'full_bilateral',
]);

/** The four composition slots. */
export const SLOT = Object.freeze(['who', 'can', 'did', 'audit']);

/** Human-readable gloss for each slot, used by the dashboard. */
export const SLOT_MEANING = Object.freeze({
  who: {
    question: 'Who acted, and on whose behalf?',
    content: 'Identity and pedigree.',
  },
  can: {
    question: 'What permitted it?',
    content:
      'The authority that allowed the action — often a carried, foreign-signed ' +
      'artifact, bound exactly as transmitted.',
  },
  did: {
    question: 'What was actually done?',
    content:
      'The action itself, with request_digest and response_digest held apart, ' +
      'so "may" never reads as "did".',
  },
  audit: {
    question: 'Under what disposition, and with what limits?',
    content: 'Verdict class, timestamp, assurance, and what was withheld.',
  },
});
