/**
 * The teaching layer.
 *
 * The five steps are the brief's own end-to-end lifecycle. Each one carries:
 *
 *   question  the plain question a newcomer actually has at this point
 *   why       why this step exists at all, in one sentence
 *   lifecycle the brief's own wording, for anyone following along in the PDF
 *   notice()  two or three things to look at, COMPUTED FROM THE RUN
 *
 * `notice()` is deliberately a function of the result rather than fixed prose.
 * Narration that does not change when the data changes is how a demo starts
 * lying: the presenter switches scenario and the captions keep describing the
 * old one.
 */

const n = (x) => Number(x ?? 0);


/** "48200.00", "EUR" -> "\u20ac48,200". Money reads better as money. */
const money = (amount, currency = 'EUR') => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const sym = currency === 'EUR' ? '\u20ac' : currency === 'USD' ? '$' : `${currency} `;
  return sym + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
};

/** Hedera "seconds.nanos" -> "16:33:57 UTC on 23 Sep 2026". */
const consensusTime = (ts) => {
  const [sec, nanos = '0'] = String(ts ?? '').split('.');
  const d = new Date(Number(sec) * 1000 + Math.floor(Number(nanos.padEnd(9, '0').slice(0, 3))));
  if (Number.isNaN(d.getTime())) return String(ts);
  const time = d.toISOString().slice(11, 19);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${time} UTC on ${day}`;
};

export const STEPS = [
  {
    id: 'context',
    setup: (r) => {
      const m = r.artifacts.manifest;
      const untrusted = m.considered.filter((c) => c.authority === 'unverified');
      if (untrusted.length) {
        return (
          `${m.considered.length} sources are in play this time \u2014 including ${untrusted.length} from an `
          + 'unverified inbox: an email saying the supplier\u2019s bank details have changed, and an '
          + 'attachment claiming the payment limit was raised. Watch what the policy gate does with them.'
        );
      }
      return (
        `${m.considered.length} sources are available to the agent. Before it can read any of them, a `
        + 'policy gate checks each against a contract: who is asking, for what purpose, and how '
        + 'trustworthy a source has to be.'
      );
    },
    headline: (r) => {
      const m = r.artifacts.manifest;
      return {
        value: `${m.selected.length} of ${m.considered.length}`,
        label: 'sources were allowed to reach the agent',
        sub: `The other ${m.excluded.length} were excluded before retrieval \u2014 never fetched, never shown to the model, each with a stated reason.`,
        tone: 'neutral',
      };
    },
    n: 1,
    label: 'Compile context',
    short: 'Context',
    family: 'cigar',
    owner: 'CIGAR',
    answers: 'knew',
    question: 'What is this agent even allowed to know?',
    why:
      'Before an agent can act, something has to decide what may reach it. Deciding that ' +
      'afterwards is just a log of what already leaked.',
    lifecycle:
      'CIGAR snapshots authorized sources and produces a provenance-bearing ContextBundle ' +
      'and SelectionManifest.',
    notice: (r) => {
      const m = r.artifacts.manifest;
      const out = [];

      out.push({
        label: `${m.excluded.length} of ${m.considered.length} sources never reached the agent`,
        body:
          m.excluded.length === 0
            ? 'Every source cleared the contract on this run.'
            : m.excluded
                .map((e) => `${e.source_id.replace(/^[a-z]+:\/\//, '').split('/').slice(-2).join('/')} \u2014 ${e.rule.replace(/_/g, ' ')}`)
                .join(' · '),
      });

      out.push({
        label: 'The excluded content is absent, not redacted',
        body:
          'Policy ran before retrieval, so the rejected material was never fetched and is ' +
          'nowhere in the bundle. Open the bytes below and search for it.',
      });

      if (m.transformations.length) {
        out.push({
          label: 'What did survive was reshaped on the way in',
          body: m.transformations.map((t) => `${t.transform}: ${t.note}`).join(' · '),
        });
      } else {
        out.push({
          label: 'The manifest says what would make this answer wrong later',
          body: `${m.invalidators.length} invalidating conditions are recorded, each naming the sources it would affect.`,
        });
      }

      return out;
    },
  },

  {
    id: 'action',
    setup: (r) => {
      const h = r.artifacts.handoff.handoff;
      const led = r.artifacts.effectLedger.ledger;
      const amount = money(led.intent.amount, led.intent.currency);
      const ceiling = money(h.budget.amount_max, h.budget.currency);
      const states = new Set(led.transitions.map((t) => t.state));
      if (Number(led.intent.amount) > Number(h.budget.amount_max)) {
        return `The invoice is ${amount}. The agent can be trusted with at most ${ceiling}. Watch the authority being narrowed \u2014 and then watch the gate.`;
      }
      if (states.has('unknown')) {
        return `The agent may spend up to ${ceiling}; the invoice is ${amount}, so the payment goes out. Then the payment API stops responding. Watch what gets recorded when nobody knows the outcome.`;
      }
      return `The agent may spend up to ${ceiling}; the invoice is ${amount}. Watch its authority being narrowed, then checked, and only then used.`;
    },
    headline: (r) => {
      const t = r.artifacts.effectLedger.ledger.terminal_state;
      const map = {
        refused: { value: 'Refused', label: 'no money moved', tone: 'warn',
          sub: 'The gate stopped it before dispatch, and the refusal is itself a signed, witnessed record.' },
        unknown: { value: 'UNKNOWN', label: 'sent, and nobody knows the outcome', tone: 'warn',
          sub: 'The request is known to have left. The result was never observed. The record says exactly that.' },
        observed: { value: 'Settled', label: 'sent, and the result was observed', tone: 'good',
          sub: 'A response came back and was bound to the request that caused it.' },
        reconciled: { value: 'Resolved', label: 'ambiguity settled after the fact', tone: 'good',
          sub: 'An independent observation resolved what the timeout left open.' },
        compensated: { value: 'Corrected', label: 'resolved, then a duplicate suppressed', tone: 'good',
          sub: 'Three states in order, appended and never rewritten.' },
      };
      return map[t] ?? { value: t, label: 'effect state', tone: 'neutral' };
    },
    n: 2,
    label: 'Decide and act',
    short: 'Action',
    family: 'cigar',
    owner: 'CIGAR',
    answers: 'allowed',
    question: 'What was it allowed to do, and what did it actually do?',
    why:
      'Authority and outcome are different questions. Most systems record neither ' +
      'separately, which is why "was it allowed to?" and "did it work?" collapse into one ' +
      'unanswerable question.',
    lifecycle:
      'The agent operates inside bounded context and authority; effects preserve intent, ' +
      'observation and honest UNKNOWN states.',
    notice: (r) => {
      const h = r.artifacts.handoff.handoff;
      const led = r.artifacts.effectLedger.ledger;
      const asked = h.granted_capabilities.length + h.refused_capabilities.length;
      const out = [];

      out.push({
        label: `It asked for ${asked} powers and was granted ${h.granted_capabilities.length}`,
        body:
          h.refused_capabilities.length
            ? `Refused: ${h.refused_capabilities.join(', ')} — the delegator did not hold it, so it could not pass it on.`
            : 'Everything it asked for was within what the delegator held.',
      });

      out.push({
        label: `The ceiling is ${h.budget.amount_max} ${h.budget.currency}`,
        body: `Capped by: ${h.budget.capped_by}. Authority is intersected during delegation, never transferred whole.`,
      });

      const term = led.terminal_state;
      out.push({
        label:
          term === 'refused' ? 'The gate refused, and that refusal is a record'
          : term === 'unknown' ? 'The request left and no answer came back'
          : term === 'compensated' ? 'Three states, in order: sent, then resolved, then corrected'
          : 'The request was sent and an answer was observed',
        body:
          term === 'refused'
            ? 'Nothing was dispatched. A refusal that leaves no trace is indistinguishable from a gate that was never reached.'
            : term === 'unknown'
              ? 'The ledger records dispatch as known and outcome as unknown. That is the only true statement available at that moment.'
              : term === 'compensated'
                ? `${led.transitions.length} hash-chained transitions. Nothing was rewritten — the correction is a new event.`
                : `${led.transitions.length} hash-chained transitions, appended and never edited.`,
      });

      return out;
    },
  },

  {
    id: 'record',
    setup: (r) => {
      const n = r.bundle.capsules.length;
      const base =
        'Everything so far happened inside one company\u2019s runtime. Now it becomes a record anyone '
        + 'can check without trusting that company.';
      return n > 1
        ? `${base} ${n} verdicts happened, so ${n} records are sealed \u2014 one per verdict, each linked to the one before.`
        : base;
    },
    headline: (r) => {
      const n = r.bundle.capsules.length;
      const bytes = r.bundle.capsules[0].digest_context.preimage_bytes;
      return {
        value: `${n} record${n === 1 ? '' : 's'}`,
        label: `${bytes} bytes each, naming itself by its own fingerprint`,
        sub: 'Nothing is copied in. The record points at the evidence by digest, so it stays small and the content stays private.',
        tone: 'neutral',
      };
    },
    n: 3,
    label: 'Seal the record',
    short: 'Record',
    family: 'aac',
    owner: 'AAC + CPB',
    answers: 'happened',
    question: 'How does that become something another company can read?',
    why:
      'Everything so far lives inside one vendor’s runtime. This is the step that turns ' +
      'it into a record with no vendor in it.',
    lifecycle:
      'AAC records WHO, CAN, action/DID evidence and AUDIT; CPB references cite existing ' +
      'artifacts rather than re-minting them.',
    notice: (r) => {
      const item = r.bundle.capsules[0];
      const cap = item.capsule;
      const out = [];

      const refSize = JSON.stringify(r.bundle.referenced_artifacts).length;
      out.push({
        label: `The record is ${item.digest_context.preimage_bytes} bytes and points at ${refSize.toLocaleString()} bytes of evidence`,
        body:
          'Members are referenced by digest, never copied in. The capsule stays small and ' +
          'content-private; the artifacts stay where they already were.',
      });

      out.push({
        label: 'CAN is the permission slip from step 2, cited byte-identically',
        body:
          'Not re-signed, not reformatted, not re-minted. That is the brief’s "authority ' +
          'mapping" question answered by construction rather than by argument.',
      });

      if (cap.effect && cap.effect.status === 'dispatched') {
        out.push({
          label: 'response_digest is missing on purpose',
          body:
            'effect.status is "dispatched" and no response was observed, so there is nothing ' +
            'honest to put there. The profile makes "confirmed" structurally unreachable ' +
            'without it — a conformant producer cannot overstate this even by accident.',
        });
      } else if (cap.effect && cap.effect.status === 'planned') {
        out.push({
          label: 'A blocked action still gets a full record',
          body:
            `verdict_class "${cap.disposition.verdict_class}", effect status "planned", no ` +
            'attestation, because nothing left the boundary. Refusals are evidence that a gate fired.',
        });
      } else {
        out.push({
          label: 'The decision was made by policy, and says so',
          body:
            `approver "${cap.disposition?.approver}", human_disposed ${String(cap.disposition?.human_disposed)}. ` +
            'A policy decision cannot be recorded as a human one — the profile forbids the pairing.',
        });
      }

      return out;
    },
  },

  {
    id: 'log',
    setup: (r) => {
      const a = r.bundle.scitt?.hedera;
      const where = a ? `a public network \u2014 Hedera ${a.network} \u2014` : 'an independent witness,';
      return `The records stay here, in a local log. Only a small fingerprint of the entire history leaves, to ${where} which stamps the moment it saw it.`;
    },
    headline: (r) => {
      const cp = r.artifacts.cll.checkpoint;
      return {
        value: `${cp.bytes_on_the_wire} bytes`,
        label: `is all that left, covering ${cp.claims.log_size} record${cp.claims.log_size === 1 ? '' : 's'}`,
        sub: r.artifacts.scitt.registered
          ? 'An outside witness stamped that summary. Every record inherits the timestamp through its inclusion proof, and the witness never saw a single record.'
          : `The witness refused it: ${r.artifacts.scitt.reason}`,
        tone: 'neutral',
      };
    },
    n: 4,
    label: 'Checkpoint and witness',
    short: 'Log',
    family: 'aac',
    owner: 'CLL + SCITT',
    answers: 'verifiable',
    question: 'What stops someone quietly rewriting this next year?',
    why:
      'A signature proves who wrote a record. It says nothing about whether the record ' +
      'existed yesterday, or whether three others were deleted around it.',
    lifecycle:
      'Records enter a CLL; a checkpoint or AAC statement is SCITT-registered and carries a ' +
      'verifiable receipt.',
    notice: (r) => {
      const cp = r.artifacts.cll.checkpoint;
      const mmr = r.artifacts.cll.mmr;
      const out = [];

      out.push({
        label: `${cp.claims.log_size} record${cp.claims.log_size === 1 ? '' : 's'} became one ${cp.bytes_on_the_wire}-byte summary`,
        body:
          'That summary is the only thing that left. Ten records or a hundred thousand, it ' +
          'stays the same size — it grows only by the digits of the count.',
      });

      out.push({
        label: `${mmr.peaks.length} peak${mmr.peaks.length === 1 ? '' : 's'}, bagged into one 32-byte root`,
        body:
          'The log is a forest, not a tree. Appending never restructures an earlier record, ' +
          'so a record’s position is fixed the moment it is written.',
      });

      // Exactly three notices, like every other step. The public anchor used
      // to be a fourth, which pushed step 4's payoff behind the dock on a
      // projector - and broke the rhythm the audience had learned.
      const anchor = r.bundle.scitt?.hedera;
      const anchorError = r.bundle.scitt?.hedera_error;
      if (anchor) {
        out.push({
          label: `Hedera ${anchor.network} recorded it, at sequence ${anchor.sequence_number}`,
          body:
            `The summary is message ${anchor.sequence_number} on topic ${anchor.topic_id}, timestamped by the `
            + `network at ${consensusTime(anchor.consensus_timestamp)} \u2014 not by us, so not ours to backdate. `
            + 'Every record inherits that stamp through its inclusion proof; the network only ever saw a '
            + `${anchor.message_bytes}-byte digest.`,
        });
      } else if (!r.artifacts.scitt.registered) {
        out.push({ label: 'The witness refused this statement', body: String(r.artifacts.scitt.reason) });
      } else {
        out.push({
          label: 'The outside witness stamped the summary, not the records',
          body:
            'Each record inherits that timestamp through its inclusion proof. The witness never saw a '
            + 'single record, and never parsed one.'
            + (anchorError ? ` Public anchoring to Hedera was unavailable this run: ${anchorError}` : ''),
        });
      }

      return out;
    },
  },

  {
    id: 'verify',
    setup: (r) =>
      r.tamperApplied
        ? 'Since it was sealed, someone has edited one field of the record without re-signing it. A stranger gets the file. Can they tell?'
        : 'A stranger gets one file. No access to the runtime, no database, no network. Can they confirm every claim in it?',
    headline: (r) => {
      const v = r.verification;
      return {
        value: v.ok ? `${v.summary.passed} / ${v.summary.total}` : `${v.summary.failed} failed`,
        label: v.ok ? 'independent checks pass' : `of ${v.summary.total} independent checks`,
        sub: v.ok
          ? 'Computed from one file, with no network and no access to the system that produced it.'
          : String(v.summary.first_failure?.name ?? ''),
        tone: v.ok ? 'good' : 'bad',
      };
    },
    n: 5,
    label: 'Replay and verify',
    short: 'Verify',
    family: 'neutral',
    owner: 'Independent verifier',
    answers: 'verifiable',
    question: 'Can a stranger check all of this without trusting us?',
    why:
      'This is the only question a slide cannot answer. Either you can watch a verifier ' +
      'accept a real record and reject a forged one, or you are taking someone’s word for it.',
    lifecycle:
      'CIGAR replay can include the checkpoint, receipt and referenced artifacts, so auditors ' +
      'can reconstruct context and verify portable proofs.',
    notice: (r) => {
      const v = r.verification;
      const out = [];

      out.push({
        label: v.ok
          ? `${v.summary.total} checks pass, with no network and no access to us`
          : `${v.summary.failed} of ${v.summary.total} checks FAIL`,
        body: v.ok
          ? 'Every digest here was recomputed from the bytes, not read from a field that ' +
            'claimed it. The verifier was handed a file and nothing else.'
          : String(v.summary.first_failure?.detail ?? ''),
      });

      out.push({
        label: 'The verifier cannot reach the runtime that produced this',
        body:
          'It has no import path to CIGAR, direct or transitive, and a test fails the build ' +
          'if anyone adds one. "Independent" is a dependency rule here, not an adjective.',
      });

      out.push({
        label: 'Read what it does NOT establish before you read the verdict',
        body:
          'None of this says a claim is true, or that the operator held the authority it ' +
          'asserts. Digest equality is a join mechanism, not proof of sufficiency.',
      });

      return out;
    },
  },
];

/** The stage id each step lights up in the seam diagram. */
export const STEP_STAGES = {
  context: ['sources', 'cigar'],
  action: ['agent'],
  record: ['record'],
  log: ['log'],
  verify: [],
};

/**
 * Plain-language groupings for the verifier's ten checks.
 *
 * Forty-eight check rows is not a result, it is a wall. Grouped under the
 * question each one answers, a reader can collapse what passed and look only
 * at what did not.
 */
export const CHECK_GROUPS = [
  { ids: [0], title: 'Is this even the right kind of file?', plain: 'Bundle format.' },
  {
    ids: [1, 2, 3],
    title: 'Is the record genuine and internally honest?',
    plain:
      'Each record must hash to the id it claims, be signed by the key it names, and obey ' +
      'the profile rules that stop it overstating what happened.',
  },
  {
    ids: [4, 5],
    title: 'Do its references point at real, unmodified evidence?',
    plain:
      'Every digest the record cites is recomputed from the artifact carried alongside it, ' +
      'using the rule the registry pins for that artifact type.',
  },
  {
    ids: [6, 7],
    title: 'Is it in the history book, at a fixed position?',
    plain:
      'Each record’s leaf is recomputed and its inclusion proof folded to the checkpoint, ' +
      'whose signature and chaining are checked too.',
  },
  {
    ids: [10],
    title: 'Did a public network record it?',
    plain:
      'Present only when the run was anchored to Hedera. Offline this proves the receipt names '
      + 'this exact statement; confirming the network accepted it needs one mirror-node read.',
  },
  {
    ids: [8, 9],
    title: 'Did an outside witness see these exact bytes?',
    plain:
      'The registered statement must be byte-identical to the checkpoint we hold, and the ' +
      'receipt must verify offline against its published root.',
  },
];

/** Recommended teaching order, and why each scenario is worth its minutes. */
export const SCENARIO_ROLES = {
  'clean-settlement': { order: 1, role: 'Start here', why: 'Establishes what good looks like.' },
  'policy-block': { order: 2, role: 'Then', why: 'Shows a refusal is evidence too.' },
  'unknown-reconcile': { order: 3, role: 'The hard one', why: 'The case most systems get wrong.' },
  'poisoned-context': { order: 4, role: 'The attack', why: 'A live BEC attempt, stopped and proven stopped.' },
  'tamper': { order: 5, role: 'The punchline', why: 'A forged record, caught by math.' },
};
