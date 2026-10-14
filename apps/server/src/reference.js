/**
 * Reference content the dashboard shows as first-class UI.
 *
 * The open questions matter as much as the working code. The AAIF brief is a
 * discussion primer, and a demo that quietly resolved its open questions by
 * fiat would be answering a question nobody asked. Every declared choice below
 * is surfaced in the UI as a choice, not as a finding.
 */

export const FOUR_QUESTIONS = [
  {
    id: 'knew',
    short: 'KNEW',
    n: 1,
    question: 'What did the agent know?',
    detail: 'Which sources, versions and context were selected - and why?',
    answered_by: 'CIGAR SelectionManifest + ContextBundle',
  },
  {
    id: 'allowed',
    short: 'ALLOWED',
    n: 2,
    question: 'What was it allowed to do?',
    detail: 'Which policy, capabilities, budgets and delegated authority applied?',
    answered_by: 'CIGAR context contract + signed handoff, cited as the AAC CAN member',
  },
  {
    id: 'happened',
    short: 'HAPPENED',
    n: 3,
    question: 'What actually happened?',
    detail: 'What was intended, dispatched, observed, uncertain, reconciled or compensated?',
    answered_by: 'CIGAR effect ledger, mapped into the AAC effect block and DID member',
  },
  {
    id: 'verifiable',
    short: 'VERIFIABLE',
    n: 4,
    question: 'Can another party verify it later?',
    detail: 'Can independent systems identify the same artifacts, detect rewriting and verify a witness receipt?',
    answered_by: 'CPB digests + CLL inclusion proofs + a SCITT receipt, checked by the independent verifier',
  },
];

export const LAYERS = [
  {
    id: 'sources',
    label: 'Sources',
    family: 'neutral',
    blurb: 'Systems of record, governance policy, evidence, and whatever else arrives.',
  },
  {
    id: 'cigar',
    label: 'CIGAR decision environment',
    family: 'cigar',
    blurb: 'Governs the decision environment that produces an action.',
    detail:
      'Governed context: deterministic bundles, manifests, source identity, selection and ' +
      'exclusion, budgets. Bounded authority: policy before disclosure, recipient-bound ' +
      'handoffs. Recoverable effects: intent, authorization, dispatch, observation, UNKNOWN, ' +
      'reconciliation, compensation.',
  },
  {
    id: 'agent',
    label: 'Agent / action',
    family: 'neutral',
    blurb: 'One decision, one effect, inside bounded context and authority.',
  },
  {
    id: 'record',
    label: 'AAC + CPB record',
    family: 'aac',
    blurb: 'Makes the resulting record portable and canonically bound.',
    detail:
      'AAC: one shared action record connecting identity, authority, action evidence and ' +
      'disposition. CPB: one canonical digest rule, so a digest has the same meaning in ' +
      'anyone’s verifier.',
  },
  {
    id: 'log',
    label: 'CLL + SCITT log / witness',
    family: 'aac',
    blurb: 'Makes the history tamper-evident and independently witnessable.',
    detail:
      'CLL: append-only local history with signed checkpoints; entries stay local. SCITT: ' +
      'independent registration and receipts for inclusion and consistency - and an external ' +
      'time bracket, not truth of the claim.',
  },
];

/** The brief's page-3 open questions, with what this demo actually did about each. */
export const OPEN_QUESTIONS = [
  {
    id: 'artifact-references',
    title: 'Artifact references',
    question:
      'Should CPB/AAC define or register typed references for context bundles, selection ' +
      'manifests, policy decisions and effect evidence?',
    demo_choice:
      'This demo registers five demo-local artifact types (context bundle, selection manifest, ' +
      'signed handoff, effect ledger, decision environment), each pinning an exclusion set and ' +
      'a canonicalization algorithm. They are labelled PROPOSED everywhere they appear.',
    unresolved:
      'Whether those types belong in the CPB Artifact Type Registry, and who maintains the ' +
      'digest context for an artifact defined by another project.',
    prd_ref: 'C-1',
  },
  {
    id: 'authority-mapping',
    title: 'Authority mapping',
    question:
      'Can a recipient-bound CIGAR handoff be consumed directly as a CAN member without ' +
      're-signing or re-minting it?',
    demo_choice:
      'Yes, and it is demonstrated: the CAN slot carries a typed digest reference to the ' +
      'signed handoff, and the verifier resolves it against the byte-identical artifact. ' +
      'Nothing is re-signed.',
    unresolved:
      'Whether a CAN member should also carry the delegator’s signature chain, and how a ' +
      'verifier learns the delegator held what it delegated - which this demo explicitly ' +
      'does NOT establish.',
    prd_ref: 'C-5',
  },
  {
    id: 'action-uncertainty',
    title: 'Action uncertainty',
    question:
      'How should intent, UNKNOWN, reconciliation and compensation map into portable ' +
      'action/audit records?',
    demo_choice:
      'UNKNOWN maps to effect.status "dispatched" with effect_attestation "gate_executed", ' +
      'assurance.effect_mode "dispatched_unconfirmed", verdict_class "timeout", and NO ' +
      'response_digest. Reconciliation uses verdict_class "executed" and chain.relation "confirms" ' +
      'to bind the observed response. A separate confirmed retry-suppression action follows it; ' +
      'it does not reverse the payment. Draft-05 reserves "resolved" for non-executing closures.',
    unresolved:
      'Whether UNKNOWN deserves its own status value rather than being inferred from ' +
      '"dispatched" plus an absent response_digest, and whether verdict_class "timeout" is the ' +
      'right vocabulary for an unobserved outcome as opposed to a known failure.',
    prd_ref: 'C-6',
  },
  {
    id: 'granularity-privacy',
    title: 'Granularity + privacy',
    question:
      'Which runtime events deserve capsules or checkpoints, and how do we keep evidence ' +
      'discoverable without over-disclosing context?',
    demo_choice:
      'One capsule per verdict, not per runtime event. The CLL leaf is the capsule id. Context ' +
      'is referenced by digest and never inlined, and a withheld[] list declares what was ' +
      'deliberately not disclosed.',
    unresolved:
      'Whether per-verdict is the right granularity for long-running agents, and what the ' +
      'lookup key should be - a digest is self-derived but needs an index somebody holds.',
    prd_ref: 'C-7',
  },
  {
    id: 'canonicalization',
    title: 'Which canonicalization, and who declares it',
    question:
      'AAC format 4 declares canonicalization_id "jcs", while CPB’s flagship algorithm is ' +
      '"jcs-n". Which applies to a capsule, and which to the artifacts it references?',
    demo_choice:
      'Capsules use "jcs" as format 4 declares. The proposed CIGAR artifact types use "jcs-n". ' +
      'Both are implemented, and the dashboard shows that the same payload digests differently ' +
      'under each - which is the failure mode the CPB vector suite exists to pin.',
    unresolved:
      'Whether mixing algorithms across a reference graph is acceptable, and whether the AAC ' +
      'exclusion set is {capsule_id} per draft-04 or {capsule_id, chain} per the CPB registry ' +
      'entry. The two sources differ.',
    prd_ref: 'C-1, C-2',
  },
];

/** What each layer proves, and what it does not. Straight from the CLL briefing. */
export const PROOF_SOURCES = [
  {
    from: 'the log, even unsigned',
    proves: ['order', 'completeness over a contiguous range', 'tamper-evidence'],
  },
  {
    from: 'the witness',
    proves: ['contemporaneity - an append-time bracket', 'non-equivocation'],
  },
  {
    from: 'the signature',
    proves: ['authorship - and only authorship'],
  },
];

/**
 * Terminology, as one source of truth.
 *
 * Used twice: for the inline definitions that let a term explain itself where
 * it appears, and for the reference glossary. A learner should never have to
 * scroll to the bottom of the page to find out what a word means - by then
 * they have lost the sentence they were reading.
 *
 * `plain` is the version for someone who has never seen any of this. `precise`
 * is for the engineer who wants the actual definition. Both are shown, plain
 * first, because a reader who only needs the first line should not have to
 * read past the second.
 */
export const TERMS = {
  CIGAR: {
    plain: 'The part that decides what the agent is allowed to know and do.',
    precise:
      'Context Intelligence Graph Agentic Runtime. Governs the decision environment that ' +
      'produces an action: which sources were authorized, what was selected and excluded, ' +
      'what policy and budget applied, and what happened to the effect afterwards.',
  },
  AAC: {
    plain: 'The record of what the agent actually did, in a format anyone can check.',
    precise:
      'Agent Action Capsule. A digest-committed record of one agent action, written on ' +
      'every verdict including refusals. An IETF Internet-Draft SCITT profile.',
  },
  CPB: {
    plain: 'The rule for turning a record into a fingerprint, so everyone gets the same one.',
    precise:
      'Canonical Payload Binding. Defines CANONICAL-DIGEST so a digest has the same ' +
      'meaning in anyone\u2019s verifier, plus registries for canonicalization algorithms ' +
      'and artifact types.',
  },
  CLL: {
    plain: 'The tamper-evident history book. Only a tiny summary of it ever leaves.',
    precise:
      'Checkpointed Local Log. A producer-operated append-only log; entries stay local and ' +
      'only a signed checkpoint - a commitment to the whole history - travels.',
  },
  SCITT: {
    plain: 'An outside witness that stamps the summary, proving when it existed.',
    precise:
      'The witness layer. A Transparency Service registers signed statements and issues ' +
      'receipts. RFC 9943 architecture, RFC 9942 receipts. No new protocol.',
  },
  ContextBundle: {
    plain: 'The exact set of information handed to the agent - nothing more.',
    precise: 'The materialized context delivered to the model or agent runtime.',
  },
  SelectionManifest: {
    plain: 'The receipt for the research: what was looked at, what was used, what was thrown out and why.',
    precise:
      'Records what was considered, what was selected, what was excluded, which ' +
      'transformations were applied, and what could invalidate the result.',
  },
  handoff: {
    plain: 'A signed permission slip naming exactly one agent and exactly what it may do.',
    precise:
      'A signed, recipient-bound capability handoff: recipient, task, acceptance criteria, ' +
      'granted capabilities, budget and expiry. Authority is intersected during delegation, ' +
      'never transferred unrestricted.',
  },
  'trust floor': {
    plain: 'The minimum trustworthiness a source must have before the agent may even read it.',
    precise:
      'A contract-declared minimum authority tier. Sources below it are excluded before ' +
      'retrieval, so protected material is never fetched.',
  },
  supersession: {
    plain: 'A newer version exists, so the old one is out of date even though it is genuine.',
    precise:
      'A record marked superseded_by another is excluded despite being authentic, ' +
      'authorized and verified. Authenticity is not currency.',
  },
  capsule_id: {
    plain: 'The record\u2019s fingerprint, taken of itself. Change one character and it stops matching.',
    precise:
      'SHA-256 over the capsule\u2019s own canonical bytes with capsule_id excluded from the ' +
      'preimage. The record names itself.',
  },
  MMR: {
    plain: 'A way of stacking records so you can prove one is in the pile without showing the pile.',
    precise:
      'Merkle Mountain Range. A forest of perfect binary Merkle subtrees; appending is ' +
      'O(log n) and never restructures an earlier leaf, so a leaf index is permanent.',
  },
  checkpoint: {
    plain: 'A ~200-byte signed summary that commits to the entire history so far.',
    precise:
      'A signed commitment carrying kind, log_size, commitment, prev_size, ' +
      'prev_commitment, issued_at and cadence. Its size does not grow with the log.',
  },
  'inclusion proof': {
    plain: 'A short path of fingerprints showing your record really is inside the summary.',
    precise:
      'A logarithmic path of sibling hashes folded to a peak, plus the peak set, checked ' +
      'against the checkpoint commitment. Structure is derived from log_size, not trusted.',
  },
  receipt: {
    plain: 'The witness\u2019s signed note saying "I saw this, at this time". Not "this is true".',
    precise:
      'A second COSE_Sign1, signed by the Transparency Service, over a ' +
      'verifiable-data-structure proof, carrying a Merkle inclusion path to a published ' +
      'root. Checkable offline.',
  },
  JCS: {
    plain: 'One agreed way to write JSON down, so the same data always gives the same fingerprint.',
    precise:
      'JSON Canonicalization Scheme, RFC 8785. Members sorted by UTF-16 code unit, ' +
      'ECMAScript number serialization, no insignificant whitespace.',
  },
  'jcs-n': {
    plain: 'JCS, plus stripping out empty fields first.',
    precise:
      'RFC 8785 JCS over a payload with null, empty-array and empty-object members removed ' +
      'bottom-up; SHA-256; lowercase hex.',
  },
  COSE_Sign1: {
    plain: 'The signature wrapper. It signs the header too, so you cannot move it elsewhere.',
    precise:
      'RFC 9052 single-signer structure. The signature covers Sig_Structure, which includes ' +
      'the protected header as serialized bytes.',
  },
  UNKNOWN: {
    plain: 'The request went out and no answer came back. Not success. Not failure.',
    precise:
      'The effect state where dispatch is known to have happened and the outcome has not ' +
      'been observed. Collapsing it into success or failure destroys the only honest answer.',
  },
  verdict_class: {
    plain: 'A one-word reason for the decision: executed, blocked, timeout, resolved, and so on.',
    precise:
      'A closed vocabulary: executed, blocked, hitl_dispatched, denied, timeout, errored, ' +
      'engine_failure, deferred, needs_decision, expired, escalated, resolved, epoch_boundary.',
  },
  response_digest: {
    plain: 'The fingerprint of what actually came back. Absent means nothing came back.',
    precise:
      'Present only for effect.status "confirmed", over the actually observed response. ' +
      'Invariant I-1 makes "confirmed" unreachable without it.',
  },
  effect_attestation: {
    plain: 'Who says the request was really sent - the gate that sent it, or just the agent.',
    precise:
      'gate_executed or runtime_claimed. Required once status is past "planned", absent ' +
      'while merely planned.',
  },
  irreversibility_class: {
    plain: 'How hard this is to undo, from "just undo it" to "the money is gone".',
    precise:
      'two_way, one_way_recoverable, one_way_consequential or one_way_terminal.',
  },
  slot: {
    plain: 'One of the four questions a record answers: who, what permitted it, what was done, under what limits.',
    precise:
      'WHO / CAN / DID / AUDIT. Each is cited by a CPB typed digest reference annotated ' +
      'with its slot; a member already produced elsewhere is cited byte-identically.',
  },
  'typed digest reference': {
    plain: 'A pointer that names a thing by its fingerprint plus what kind of thing it is.',
    precise:
      'Required members type, digest_alg and digest. A verifier resolves the digest context ' +
      'from the registry by type, never from a field beside the reference.',
  },
  'evidence bundle': {
    plain: 'Everything a stranger needs in one file to check the whole story themselves.',
    precise:
      'Capsules and envelopes, slot member artifacts, referenced CIGAR artifacts, inclusion ' +
      'proofs, the signed checkpoint, the SCITT statement and receipt, public keys, and a ' +
      'withheld[] manifest.',
  },
};

/** The footer glossary, derived from the same source. */
export const GLOSSARY = Object.entries(TERMS).map(([term, d]) => [term, d.precise]);

export const SPEC_SOURCES = [
  ['draft-mih-scitt-agent-action-capsule-05', 'AAC profile · draft 5', 'https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05'],
  ['draft-mih-sokolov-scitt-payload-binding', 'Canonical Payload Binding', 'https://datatracker.ietf.org/doc/draft-mih-sokolov-scitt-payload-binding/'],
  ['draft-mih-scitt-checkpointed-local-log', 'Checkpointed Local Log', 'https://datatracker.ietf.org/doc/draft-mih-scitt-checkpointed-local-log/'],
  ['draft-bryce-cose-receipts-mmr-profile', 'MMR proofs for COSE receipts', 'https://datatracker.ietf.org/doc/draft-bryce-cose-receipts-mmr-profile/'],
  ['RFC 9943', 'SCITT architecture', 'https://www.rfc-editor.org/info/rfc9943'],
  ['RFC 9942', 'COSE receipts', 'https://www.rfc-editor.org/info/rfc9942'],
  ['RFC 8785', 'JSON Canonicalization Scheme', 'https://www.rfc-editor.org/info/rfc8785'],
  ['RFC 9052', 'COSE structures and signing', 'https://www.rfc-editor.org/info/rfc9052'],
  ['CIGAR', 'Context Intelligence Graph Agentic Runtime', 'https://hol.org/blog/cigar-a-governed-context-runtime-for-ai-agents'],
  ['agentactioncapsule.org', 'AAC project site', 'https://agentactioncapsule.org'],
  ['canonicalpayloadbinding.org', 'CPB project site', 'https://canonicalpayloadbinding.org'],
];

export const STATUS_NOTE =
  'Context compilation and review binding execute in hol-cigar 0.14.0 from PyPI, using its native worker. ' +
  'Business policy, the payment gateway, and the semantic reviewer are demo fixtures. ' +
  'AAC, CPB and CLL composition uses a proposed interoperability profile, not a normative mapping. ' +
  'A local witness is a demo signer; only a confirmed Hedera anchor supplies independent public timing.';
