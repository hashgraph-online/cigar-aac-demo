import { createHash } from 'node:crypto';
import { jcs, canonicalDigest, digestForType, findFloatingPointNumbers } from '@cigar-aac/cpb';

/**
 * The external effect lifecycle, as an append-only hash-chained ledger.
 *
 * The states CIGAR keeps distinct, and why each distinction earns its keep:
 *
 *   intent      what was going to be attempted, recorded before anything left
 *   authorized  the authority check that permitted it, as a separate step
 *   dispatched  the request left the boundary; the result is NOT yet known
 *   observed    a result came back and was bound to the request
 *   UNKNOWN     the request left and no result was observed
 *   reconciled  a later, independent observation resolved the ambiguity
 *   compensated a corrective effect, recorded as its own event
 *
 * UNKNOWN is the state most systems do not have, and its absence is why
 * "did the payment go out?" is so often unanswerable. Collapsing it into
 * either success or failure destroys the only honest answer available at the
 * time. Everything downstream of this ledger inherits that honesty or loses it
 * here.
 */

export const EFFECT_STATES = Object.freeze([
  'intent_recorded',
  'authorized',
  'dispatched',
  'observed',
  'unknown',
  'reconciled',
  'compensated',
  'failed',
  'refused',
]);

/** Which transitions are legal. An illegal transition is a bug, not a state. */
const LEGAL = Object.freeze({
  intent_recorded: ['authorized', 'refused'],
  authorized: ['dispatched', 'refused'],
  dispatched: ['observed', 'unknown', 'failed'],
  unknown: ['reconciled', 'compensated', 'failed'],
  observed: ['compensated', 'reconciled'],
  reconciled: ['compensated'],
  compensated: [],
  failed: ['compensated'],
  refused: [],
});

export class EffectLedger {
  /**
   * @param {object} o
   * @param {string} o.ledger_id
   * @param {object} o.intent the effect intent
   * @param {()=>string} o.now
   * @param {(e:object)=>void} [o.emit]
   */
  constructor({ ledger_id, intent, now, emit = () => {} }) {
    const floats = findFloatingPointNumbers(intent);
    if (floats.length) {
      throw new Error(
        `effect intent carries JSON floating-point value(s) at ${floats.map((f) => f.path).join(', ')}`,
      );
    }

    this.ledger_id = ledger_id;
    this.now = now;
    this.emit = emit;
    this.intent = intent;
    this.transitions = [];
    this.append('intent_recorded', {
      target: intent.target,
      idempotency_key: intent.idempotency_key,
      risk_level: intent.risk_level,
      irreversibility_class: intent.irreversibility_class,
    });
  }

  get state() {
    return this.transitions[this.transitions.length - 1].state;
  }

  /** Append a transition. Append-only and hash-chained; nothing is rewritten. */
  append(state, detail = {}) {
    if (!EFFECT_STATES.includes(state)) throw new Error(`unknown effect state "${state}"`);
    if (this.transitions.length) {
      const from = this.state;
      if (!LEGAL[from].includes(state)) {
        throw new Error(
          `illegal effect transition ${from} -> ${state}; legal from ${from}: [${LEGAL[from].join(', ')}]`,
        );
      }
    }

    const prev = this.transitions[this.transitions.length - 1] ?? null;
    const entry = {
      seq: this.transitions.length,
      state,
      at: this.now(),
      detail,
      prev_hash: prev ? prev.entry_hash : null,
    };
    entry.entry_hash = createHash('sha256').update(jcs(entry), 'utf8').digest('hex');
    this.transitions.push(entry);
    this.emit({
      kind: `effect.${state}`,
      ledger_id: this.ledger_id,
      // Named distinctly from the event stream's own `seq`.
      transition_seq: entry.seq,
      state,
      detail,
      entry_hash: entry.entry_hash,
    });
    return entry;
  }

  /**
   * The portable ledger artifact, as an immutable snapshot.
   *
   * Deep-copied deliberately. A capsule sealed now cites the ledger AS IT IS
   * NOW; if this returned a live reference, appending a later transition would
   * retroactively change what an already-signed capsule refers to, and the
   * digest in that capsule would stop resolving. An append-only log whose
   * snapshots mutate is not append-only in any useful sense.
   */
  artifact() {
    const ledger = {
      ledger_kind: 'cigar-effect-ledger',
      ledger_id: this.ledger_id,
      intent: structuredClone(this.intent),
      transitions: structuredClone(this.transitions),
      terminal_state: this.state,
    };
    return { ledger, digest: digestForType('cigar-effect-ledger', ledger).digest };
  }

  /**
   * Map this ledger's terminal state onto an AAC effect block.
   *
   * This is the demo's concrete proposal for the brief's open question "How
   * should intent, UNKNOWN, reconciliation and compensation map into portable
   * action/audit records?" — offered to be argued with, not asserted.
   *
   * See docs/PRD-TECHNICAL.md section 9, C-6.
   */
  toAacEffect() {
    const t = this.state;
    const observed = this.transitions.find((x) => x.state === 'observed' || x.state === 'reconciled');

    const common = {
      type: this.intent.effect_type,
      external_ref: this.intent.idempotency_key,
      irreversibility_class: this.intent.irreversibility_class,
    };

    if (t === 'intent_recorded' || t === 'refused' || t === 'authorized') {
      // Nothing left the boundary, so effect_attestation must be absent.
      return { status: 'planned', ...common };
    }
    if (t === 'dispatched' || t === 'unknown') {
      // The honest shape for UNKNOWN: dispatched, attested by the gate that
      // dispatched it, and deliberately carrying NO response_digest.
      return { status: 'dispatched', effect_attestation: 'gate_executed', ...common };
    }
    if (t === 'observed' || t === 'reconciled') {
      return {
        status: 'confirmed',
        effect_attestation: 'gate_executed',
        response_digest: observed.detail.response_digest,
        ...common,
      };
    }
    if (t === 'compensated') {
      return { status: 'reverted', effect_attestation: 'gate_executed', ...common };
    }
    return { status: 'failed', effect_attestation: 'gate_executed', ...common };
  }

  /** The AAC assurance.effect_mode that matches this ledger. */
  toAssuranceEffectMode() {
    const t = this.state;
    if (t === 'observed' || t === 'reconciled') return 'confirmed';
    if (t === 'dispatched' || t === 'unknown') return 'dispatched_unconfirmed';
    if (t === 'compensated' || t === 'failed') return 'dispatched_unconfirmed';
    return 'not_applicable';
  }
}

/**
 * Verify that an effect ledger's hash chain is intact.
 * Tamper-evidence from the log alone, with no signature involved.
 */
export function verifyEffectChain(ledger) {
  const problems = [];
  let prevHash = null;
  for (const [i, entry] of ledger.transitions.entries()) {
    if (entry.seq !== i) problems.push(`entry ${i} declares seq ${entry.seq}`);
    if (entry.prev_hash !== prevHash) {
      problems.push(
        `entry ${i} links to ${String(entry.prev_hash).slice(0, 12)}... but the previous entry hashes to ${String(prevHash).slice(0, 12)}...`,
      );
    }
    const { entry_hash: claimed, ...preimage } = entry;
    const recomputed = createHash('sha256').update(jcs(preimage), 'utf8').digest('hex');
    if (recomputed !== claimed) {
      problems.push(`entry ${i} (${entry.state}) hashes to ${recomputed.slice(0, 12)}... not ${String(claimed).slice(0, 12)}...`);
    }
    prevHash = claimed;
  }
  return { ok: problems.length === 0, problems, length: ledger.transitions.length };
}

export { canonicalDigest };
