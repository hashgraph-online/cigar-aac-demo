/**
 * The system, as a graph — and the narration of one event at a time.
 *
 * The problem this solves: during playback, numbers were mutating in eight
 * places at once while the step summary showed the FINAL answer for a step the
 * run had only just entered. There was no single place to look for what had
 * just happened, so following along was impossible.
 *
 * The model here is a flight recorder:
 *
 *   topology  WHERE it is happening  - one node lights up at a time
 *   now       WHAT just happened     - one event, in a sentence, with its payload
 *   log       WHAT HAS happened      - append-only, newest last
 *
 * Nothing else moves while an event is being narrated.
 */

/** Stage columns. These double as the step navigation. */
export const STAGES = [
  { id: 'sources', step: null, label: 'Sources', family: 'neutral', note: 'what exists' },
  { id: 'context', step: 'context', n: 1, label: 'Compile context', family: 'cigar', note: 'CIGAR' },
  { id: 'action', step: 'action', n: 2, label: 'Decide and act', family: 'cigar', note: 'CIGAR' },
  { id: 'record', step: 'record', n: 3, label: 'Seal the record', family: 'aac', note: 'AAC + CPB' },
  { id: 'log', step: 'log', n: 4, label: 'Checkpoint and witness', family: 'aac', note: 'CLL + SCITT' },
  { id: 'verify', step: 'verify', n: 5, label: 'Replay and verify', family: 'neutral', note: 'a stranger' },
];

/**
 * Nodes. `trust` drives the visual treatment:
 *   local     never leaves the producer
 *   external  a third party, outside this trust boundary
 *   risky     present but not authoritative
 */
export const NODES = [
  { id: 'sor', stage: 'sources', label: 'Systems of record', sub: 'ERP, HR, ledger' },
  { id: 'governance', stage: 'sources', label: 'Policy store', sub: 'governance tier' },
  { id: 'inbox', stage: 'sources', label: 'AP inbox', sub: 'unverified', trust: 'risky' },

  { id: 'ingest', stage: 'context', label: 'Snapshot', sub: 'typed records + provenance' },
  { id: 'gate', stage: 'context', label: 'Policy gate', sub: 'runs before retrieval' },
  { id: 'reconciler', stage: 'context', label: 'Reconciler', sub: 'authority, then recency' },
  { id: 'packer', stage: 'context', label: 'Packer', sub: 'budget + manifest' },
  { id: 'bundle', stage: 'context', label: 'Context bundle', sub: 'for one consumer' },
  { id: 'env', stage: 'context', label: 'Decision environment', sub: 'bound for replay' },

  { id: 'delegator', stage: 'action', label: 'Delegator', sub: 'signs the handoff' },
  { id: 'agent', stage: 'action', label: 'Agent', sub: 'ap-settlement-agent' },
  { id: 'gateway', stage: 'action', label: 'Effect gateway', sub: 'hash-chained ledger' },
  { id: 'bank', stage: 'action', label: 'Payment API', sub: 'outside the boundary', trust: 'external' },

  { id: 'sealer', stage: 'record', label: 'seal()', sub: 'who · can · did · audit' },

  { id: 'cll', stage: 'log', label: 'Local log', sub: 'entries never leave', trust: 'local' },
  { id: 'checkpointer', stage: 'log', label: 'Checkpoint', sub: 'only this travels' },
  { id: 'witness', stage: 'log', label: 'Transparency service', sub: 'third-party witness', trust: 'external' },

  { id: 'verifier', stage: 'verify', label: 'Independent verifier', sub: 'no access to the runtime', trust: 'external' },
];

/** Edges, for drawing the flow between stages. */
export const EDGES = [
  ['sor', 'ingest'], ['governance', 'ingest'], ['inbox', 'gate'],
  ['ingest', 'gate'], ['gate', 'reconciler'], ['reconciler', 'packer'],
  ['packer', 'bundle'], ['bundle', 'env'],
  ['env', 'agent'], ['delegator', 'agent'], ['agent', 'gateway'], ['gateway', 'bank'],
  ['gateway', 'sealer'], ['env', 'sealer'],
  ['sealer', 'cll'], ['cll', 'checkpointer'], ['checkpointer', 'witness'],
  ['witness', 'verifier'], ['cll', 'verifier'],
];

/**
 * A source's last TWO path segments: "payroll/september", not "september".
 * One segment was ambiguous on screen - "Read september" named no source a
 * viewer could recognize.
 */
const shortId = (s) => {
  const parts = String(s ?? '').replace(/^[a-z]+:\/\//, '').split('/').filter(Boolean);
  return parts.length ? parts.slice(-2).join('/') : String(s);
};
const shortHex = (h) => (h ? `${String(h).slice(0, 12)}…` : null);

/** base64 -> short hex, for display only. Browser-safe: no Node Buffer. */
const Buffer_from_b64 = (b64) => {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    let hex = '';
    for (let i = 0; i < Math.min(bin.length, 8); i += 1) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return String(b64);
  }
};

/** Which node an event is happening at. */
export function nodeForEvent(e) {
  switch (e.kind) {
    case 'source.ingested':
      if (String(e.source_id).startsWith('policy://')) return 'governance';
      if (String(e.source_id).startsWith('email://')) return 'inbox';
      return 'sor';
    case 'contract.declared':
    case 'policy.evaluated':
    case 'candidate.considered':
    case 'candidate.excluded':
      return 'gate';
    case 'conflict.reconciled':
      return 'reconciler';
    case 'budget.charged':
    case 'context.compiled':
    case 'manifest.sealed':
      return 'packer';
    case 'bundle.materialized':
      return 'bundle';
    case 'env.captured':
    case 'cigar.replay':
      return 'env';
    case 'handoff.signed':
      return 'delegator';
    case 'decision.made':
      return 'agent';
    case 'effect.intent_recorded':
    case 'effect.authorized':
    case 'effect.authorization_check':
    case 'cigar.effect_chain':
      return 'gateway';
    case 'effect.dispatched':
    case 'effect.unknown':
    case 'effect.observed':
    case 'effect.reconciled':
      return 'bank';
    case 'effect.compensated':
    case 'effect.refused':
    case 'effect.failed':
      return 'gateway';
    case 'capsule.sealed':
      return 'sealer';
    case 'cll.appended':
    case 'cll.mmr':
      return 'cll';
    case 'cll.checkpointed':
      return 'checkpointer';
    case 'scitt.registered':
    case 'scitt.receipt':
    case 'scitt.anchored':
    case 'scitt.anchor_failed':
      return 'witness';
    case 'verify.step':
    case 'verify.verdict':
    case 'tamper.applied':
      return 'verifier';
    default:
      return null;
  }
}

/**
 * Narrate one event: what happened, and by what mechanism.
 *
 * `tone` drives colour; `facts` are the "how" — the specific values that make
 * the claim checkable rather than decorative.
 */
export function describeEvent(e) {
  const F = (label, value) => ({ label, value });

  switch (e.kind) {
    case 'context.compiled':
      return {
        title: 'CIGAR 0.14.0 compiled and verified the context',
        body: 'The native worker enforced the authorized view, required evidence and exact token budget. The reviewed statement was released; the same statement without a review was withheld.',
        tone: 'good',
        facts: [F('package', `${e.package} ${e.version}`), F('tokens including citations', e.tokens), F('review', e.review)],
      };
    case 'stage.enter':
      return { title: e.label, kind: 'stage', tone: 'neutral', facts: [] };

    case 'source.ingested':
      return {
        title: `Read ${shortId(e.source_id)}`,
        body: 'Snapshotted immutably, with provenance, before anything is decided.',
        tone: e.verification_state === 'verified' ? 'neutral' : 'warn',
        facts: [
          F('source', e.source_id),
          F('type', e.record_type),
          F('authority', e.authority),
          F('verified', e.verification_state),
          F('content digest', shortHex(e.content_digest)),
        ],
      };

    case 'contract.declared':
      return {
        title: 'Context contract declared',
        body: `Purpose "${e.contract?.purpose}" for principal "${e.contract?.principal}". This is evaluated before any source is read.`,
        tone: 'neutral',
        facts: [
          F('purpose', e.contract?.purpose),
          F('trust floor', e.contract?.trust_floor),
          F('budget', `${e.contract?.budget?.max_records} records / ${e.contract?.budget?.max_tokens} tokens`),
          F('required evidence', (e.contract?.required_evidence ?? []).join(', ')),
        ],
      };

    case 'policy.evaluated':
      return {
        title: e.ok ? `Policy check passed: ${e.name}` : `Policy check FAILED: ${e.name}`,
        body: 'The contract itself is checked first. A refused contract stops the run before retrieval.',
        tone: e.ok ? 'good' : 'bad',
        facts: [F('check', e.name), F('detail', e.detail)],
      };

    case 'candidate.considered':
      return {
        title: `Considering ${shortId(e.source_id)}`,
        body: 'Screened against the contract before its content is fetched.',
        tone: 'neutral',
        facts: [F('source', e.source_id), F('authority', e.authority), F('type', e.record_type)],
      };

    case 'candidate.excluded':
      return {
        title: `Excluded ${shortId(e.source_id)}`,
        body: 'Never fetched, never materialized, never shown to the model — and the exclusion is itself evidence.',
        tone: 'bad',
        facts: [F('source', e.source_id), F('rule', e.rule), F('reason', e.reason)],
      };

    case 'conflict.reconciled':
      return {
        title: `Reconciled conflicting claims about ${shortId(e.subject)}`,
        body: 'Two authentic sources disagreed. Source authority decides, then validity recency.',
        tone: 'neutral',
        facts: [F('subject', e.subject), F('candidates', (e.candidates ?? []).join(' vs ')), F('resolved to', e.resolved_to)],
      };

    case 'budget.charged':
      return {
        title: `Packed ${shortId(e.source_id)}`,
        body: 'Charged against the declared budget. When the budget squeezes, the weakest sources drop first.',
        tone: 'neutral',
        facts: [F('source', e.source_id), F('records used', e.records), F('tokens used', e.tokens)],
      };

    case 'manifest.sealed':
      return {
        title: 'Selection manifest sealed',
        body: 'The receipt for the research: considered, selected, excluded, transformed, and what would invalidate it.',
        tone: 'good',
        facts: [
          F('considered', e.considered),
          F('selected', e.selected),
          F('excluded', e.excluded),
          F('digest', shortHex(e.manifest_digest)),
        ],
      };

    case 'bundle.materialized':
      return {
        title: 'Context bundle materialized',
        body: `Built for exactly one consumer: ${e.consumer}. This is all the agent can see.`,
        tone: 'good',
        facts: [F('records', e.records), F('consumer', e.consumer), F('digest', shortHex(e.bundle_digest))],
      };

    case 'env.captured':
      return {
        title: 'Decision environment captured',
        body: 'Task, contract, manifest, bundle and component versions bound together, so this decision can be replayed.',
        tone: 'good',
        facts: [F('digest', shortHex(e.env_digest))],
      };

    case 'handoff.signed':
      return {
        title: 'Authority delegated, and narrowed',
        body: 'The agent gets a signed, recipient-bound permission slip. Authority is intersected, never handed over whole.',
        tone: 'good',
        facts: [
          F('granted', (e.granted ?? []).join(', ')),
          F('refused', (e.refused ?? []).join(', ') || 'none'),
          F('ceiling', `${e.budget?.amount_max} ${e.budget?.currency}`),
          F('digest', shortHex(e.digest)),
        ],
      };

    case 'decision.made':
      return {
        title: `Agent decided to ${e.decision?.outcome}`,
        body: 'Derived from the bundle it was given — not from anything outside it.',
        tone: 'neutral',
        facts: [
          F('invoice', e.decision?.invoice),
          F('amount', `${e.decision?.amount} ${e.decision?.currency}`),
          F('payee verified', String(e.decision?.payee_verified)),
        ],
      };

    case 'effect.intent_recorded':
      return {
        title: 'Effect intent recorded',
        body: 'Written down BEFORE anything leaves the boundary, so an attempt can never be silently forgotten.',
        tone: 'neutral',
        facts: [
          F('target', e.detail?.target),
          F('idempotency key', e.detail?.idempotency_key),
          F('risk', e.detail?.risk_level),
          F('reversibility', e.detail?.irreversibility_class),
        ],
      };

    case 'effect.authorization_check':
      return {
        title: e.ok ? `Authority check passed: ${e.name}` : `Authority check FAILED: ${e.name}`,
        body: 'Checked against the delegated handoff, not against the agent’s own opinion.',
        tone: e.ok ? 'good' : 'bad',
        facts: [F('check', e.name), F('detail', e.detail)],
      };

    case 'effect.authorized':
      return {
        title: 'Effect authorized',
        body: 'The handoff permits this capability, this amount, at this time.',
        tone: 'good',
        facts: [F('handoff', e.detail?.handoff)],
      };

    case 'effect.dispatched':
      return {
        title: 'Payment dispatched',
        body: 'The request has left the boundary. Nothing is known yet about what happened to it.',
        tone: 'warn',
        facts: [F('attempt', e.detail?.attempt), F('gateway', e.detail?.gateway), F('request digest', shortHex(e.detail?.request_digest))],
      };

    case 'effect.unknown':
      return {
        title: 'UNKNOWN — no response observed',
        body: 'The request went out and nothing came back. Not success, not failure. This is the state most systems do not have.',
        tone: 'warn',
        facts: [F('reason', e.detail?.reason), F('observed', 'nothing')],
      };

    case 'effect.observed':
      return {
        title: 'Response observed and bound',
        body: 'A result came back and was bound by digest to the request that caused it.',
        tone: 'good',
        facts: [F('status', e.detail?.observation?.status), F('reference', e.detail?.observation?.gateway_ref), F('response digest', shortHex(e.detail?.response_digest))],
      };

    case 'effect.reconciled':
      return {
        title: 'Ambiguity resolved',
        body: 'An independent source settled what the timeout left open. Recorded as a new event, not an edit.',
        tone: 'good',
        facts: [F('source', e.detail?.source), F('response digest', shortHex(e.detail?.response_digest))],
      };

    case 'effect.compensated':
      return {
        title: 'Compensating action taken',
        body: 'The duplicate a naive retry would have sent was suppressed — and that correction is its own record.',
        tone: 'good',
        facts: [F('action', e.detail?.action), F('key', e.detail?.idempotency_key)],
      };

    case 'effect.refused':
      return {
        title: 'Refused before dispatch',
        body: 'The gate stopped it. No money moved, and the refusal leaves a record.',
        tone: 'bad',
        facts: [F('reason', e.detail?.reason)],
      };

    case 'capsule.sealed':
      return {
        title: 'Record sealed',
        body: `${e.label}. Four slots, each citing its evidence by digest rather than copying it in.`,
        tone: 'good',
        facts: [
          F('capsule_id', shortHex(e.capsule_id)),
          F('canonical bytes', e.canonical_bytes),
          F('effect status', e.effect?.status ?? 'none'),
          F('verdict', e.disposition?.verdict_class),
          ...(e.slots ?? []).map((s) => F(`slot ${s.slot}`, `${s.type} → ${shortHex(s.digest)}`)),
        ],
      };

    case 'cll.appended':
      return {
        title: `Appended to the local log at leaf ${e.leaf_index}`,
        body: 'The entry stays here. Its position is fixed permanently the moment it is written.',
        tone: 'neutral',
        facts: [F('leaf', e.leaf_index), F('leaf hash', shortHex(e.leaf_hash)), F('log size', e.log_size)],
      };

    case 'cll.mmr':
      return {
        title: `Merkle forest: ${e.leaf_count} leaves, ${e.peaks?.length} peak(s)`,
        body: 'Each peak is a perfect Merkle subtree. Appending never restructures an earlier leaf.',
        tone: 'neutral',
        facts: [F('nodes', e.mmr_size), F('root', shortHex(e.root))],
      };

    case 'cll.checkpointed':
      return {
        title: `Checkpoint signed — ${e.bytes_on_the_wire} bytes`,
        body: 'One small signed commitment to the entire history. This is the only thing that leaves.',
        tone: 'good',
        facts: [
          F('log size', e.claims?.log_size),
          F('commitment', shortHex(e.claims?.commitment)),
          F('previous', e.claims?.prev_commitment ? shortHex(e.claims.prev_commitment) : 'none (first)'),
          F('on the wire', `${e.bytes_on_the_wire} bytes`),
        ],
      };

    case 'scitt.registered':
      return {
        title: e.registered ? 'Witness accepted the checkpoint' : 'Witness REFUSED the checkpoint',
        body: e.registered
          ? 'Policy was evaluated on the header alone — the witness never parsed the payload.'
          : String(e.reason),
        tone: e.registered ? 'good' : 'bad',
        facts: (e.policy?.checks ?? []).map((c) => F(c.name, c.detail)),
      };

    case 'scitt.receipt':
      return {
        title: 'Receipt issued',
        body: 'A second signature, by the witness, over a proof. It says this was registered by this time — never that the claim is true.',
        tone: 'good',
        facts: [
          F('service', e.receipt?.service_id),
          F('published root', shortHex(e.receipt?.root)),
          F('leaf / size', `${e.receipt?.leaf_index} of ${e.receipt?.log_size}`),
          F('proof type', e.receipt?.vds),
        ],
      };

    case 'scitt.anchored':
      return {
        title: `Anchored to Hedera ${e.network}`,
        body:
          'A commitment to the checkpoint is now a message on a public consensus network. '
          + 'The timestamp is the network\u2019s, not ours \u2014 which is the point.'
          + (e.created_topic ? ' A topic was created for this run; put its id in .env to reuse it.' : ''),
        tone: e.confirmed ? 'good' : 'warn',
        facts: [
          F('topic', e.topic_id),
          F('sequence', e.sequence_number),
          F('consensus time', e.consensus_timestamp),
          F('running hash', shortHex(Buffer_from_b64(e.running_hash))),
          F('published', `${e.message_bytes} bytes \u2014 digests only`),
          F('re-read from mirror', e.confirmed ? 'yes, confirmed' : 'not in this run'),
        ],
      };

    case 'scitt.anchor_failed':
      return {
        title: 'Public anchoring unavailable',
        body:
          'The run is complete and still verifiable against the local transparency service. '
          + 'The failure is recorded rather than hidden.',
        tone: 'warn',
        facts: [F('reason', e.reason)],
      };

    case 'cigar.replay':
      return {
        title: e.ok ? 'Decision environment replays clean' : 'Replay MISMATCH',
        body: 'The captured inputs still hash to what was recorded. This does not re-run the model.',
        tone: e.ok ? 'good' : 'bad',
        facts: (e.checks ?? []).map((c) => F(c.name, c.ok ? 'match' : 'differs')),
      };

    case 'cigar.effect_chain':
      return {
        title: e.ok ? `Effect ledger chain intact (${e.length} transitions)` : 'Effect ledger chain BROKEN',
        body: 'Tamper-evidence from the log alone, with no signature involved.',
        tone: e.ok ? 'good' : 'bad',
        facts: (e.problems ?? []).map((p, i) => F(`problem ${i + 1}`, p)),
      };

    case 'tamper.applied':
      return {
        title: `Record edited: ${e.label}`,
        body: `${e.plain} Not re-signed — which is what an insider edit looks like.`,
        tone: 'bad',
        facts: [F('where', e.where), F('before', JSON.stringify(e.before)), F('after', JSON.stringify(e.after))],
      };

    case 'verify.step':
      return {
        title: e.ok ? `Check passed: ${e.name}` : `Check FAILED: ${e.name}`,
        body: e.detail,
        tone: e.ok ? 'good' : 'bad',
        facts: e.ok ? [] : [F('expected', e.expected), F('computed', e.computed)].filter((f) => f.value),
      };

    case 'verify.verdict':
      return {
        title: e.ok ? 'VERIFIED' : 'VERIFICATION FAILED',
        body: e.ok
          ? 'Every check passed, computed from one file with no network and no access to the producing system.'
          : String(e.summary?.first_failure?.name ?? ''),
        tone: e.ok ? 'good' : 'bad',
        facts: [F('passed', `${e.summary?.passed} of ${e.summary?.total}`), F('records', e.summary?.records)],
      };

    case 'run.refused':
      return {
        title: 'Run refused',
        body: String(e.reason),
        tone: 'bad',
        facts: [F('stage', e.stage)],
      };

    default:
      return { title: e.kind, body: '', tone: 'neutral', facts: [] };
  }
}

/** Events that deserve a longer beat, because they are the point. */
export const MILESTONES = new Set([
  'manifest.sealed', 'bundle.materialized', 'handoff.signed', 'decision.made',
  'effect.dispatched', 'effect.unknown', 'effect.observed', 'effect.reconciled',
  'effect.compensated', 'effect.refused', 'capsule.sealed', 'cll.checkpointed',
  'scitt.receipt', 'verify.verdict', 'tamper.applied', 'candidate.excluded',
  'scitt.anchored', 'scitt.anchor_failed',
]);
