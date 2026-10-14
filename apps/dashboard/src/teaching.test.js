import { describe, it, expect } from 'vitest';
import { runScenario, SCENARIOS } from '../../server/src/engine.js';
import { STEPS, CHECK_GROUPS, SCENARIO_ROLES } from './teaching.js';

/**
 * The storytelling layer: every step is setup -> action -> payoff, and the
 * words are computed from the run. These tests exist because narration that
 * does not change when the data changes is how a demo starts lying.
 */

const runs = Object.fromEntries(SCENARIOS.map((s) => [s.id, runScenario(s.id)]));

/** An anchored variant, shaped as the server produces it. */
const anchored = (r) => ({
  ...r,
  bundle: {
    ...r.bundle,
    scitt: {
      ...r.bundle.scitt,
      hedera: {
        network: 'testnet', topic_id: '0.0.10684243', sequence_number: 16,
        consensus_timestamp: '1790181237.888664417', message_bytes: 261,
      },
    },
  },
});

describe('every step has a complete beat', () => {
  it('has a question, a setup, a headline, a principle and notices', () => {
    for (const r of Object.values(runs)) {
      for (const st of STEPS) {
        expect(st.question.length, st.id).toBeGreaterThan(10);
        expect(st.why.length, st.id).toBeGreaterThan(20);
        expect(st.setup(r).length, `${st.id} setup`).toBeGreaterThan(40);
        const h = st.headline(r);
        expect(String(h.value).length, `${st.id} headline`).toBeGreaterThan(0);
        expect(h.label.length, `${st.id} headline label`).toBeGreaterThan(0);
      }
    }
  });

  it('gives exactly three things to notice on every step of every scenario', () => {
    // The rhythm the audience learns. A fourth notice on step 4 once pushed
    // the payoff behind the dock on a projector.
    for (const [id, r] of Object.entries(runs)) {
      for (const st of STEPS) {
        expect(st.notice(r), `${id} / ${st.id}`).toHaveLength(3);
        expect(st.notice(anchored(r)), `${id} / ${st.id} anchored`).toHaveLength(3);
      }
    }
  });

  it('never leaves a notice without a label and a body', () => {
    for (const r of Object.values(runs)) {
      for (const st of STEPS) {
        for (const n of st.notice(r)) {
          expect(n.label.length).toBeGreaterThan(5);
          expect(n.body.length).toBeGreaterThan(5);
        }
      }
    }
  });
});

describe('the setup tells you what to watch, per scenario', () => {
  const setup = (scenario, step) => STEPS.find((s) => s.id === step).setup(runs[scenario]);

  it('names the poison before step 1 of the poisoned run', () => {
    expect(setup('poisoned-context', 'context')).toMatch(/bank details/);
    expect(setup('poisoned-context', 'context')).toMatch(/9 sources/);
    expect(setup('clean-settlement', 'context')).not.toMatch(/bank details/);
  });

  it('names the over-limit amount before the blocked payment', () => {
    expect(setup('policy-block', 'action')).toMatch(/€68,400/);
    expect(setup('policy-block', 'action')).toMatch(/€50,000/);
  });

  it('warns that the payment API goes quiet before the UNKNOWN run', () => {
    expect(setup('unknown-reconcile', 'action')).toMatch(/stops responding/);
    expect(setup('clean-settlement', 'action')).not.toMatch(/stops responding/);
  });

  it('counts the records when a run seals more than one', () => {
    expect(setup('unknown-reconcile', 'record')).toMatch(/3 verdicts happened, so 3 records/);
    expect(setup('clean-settlement', 'record')).not.toMatch(/verdicts happened/);
  });

  it('names Hedera as the destination only when a run was anchored', () => {
    expect(setup('clean-settlement', 'log')).toMatch(/independent witness/);
    expect(STEPS.find((s) => s.id === 'log').setup(anchored(runs['clean-settlement']))).toMatch(/Hedera testnet/);
  });

  it('announces the forgery before the tamper run is verified', () => {
    expect(setup('tamper', 'verify')).toMatch(/edited one field/);
    expect(setup('clean-settlement', 'verify')).not.toMatch(/edited/);
  });
});

describe('the payoff reflects what actually happened', () => {
  const headline = (scenario, step) => STEPS.find((s) => s.id === step).headline(runs[scenario]).value;

  it('reports the true outcome of the effect', () => {
    expect(headline('clean-settlement', 'action')).toBe('Settled');
    expect(headline('policy-block', 'action')).toBe('Refused');
    expect(headline('unknown-reconcile', 'action')).toBe('Corrected');
  });

  it('reports the source counts for each context', () => {
    expect(headline('clean-settlement', 'context')).toBe('5 of 7');
    expect(headline('poisoned-context', 'context')).toBe('5 of 9');
  });

  it('reports failure on the tamper run and success elsewhere', () => {
    expect(headline('tamper', 'verify')).toMatch(/failed/);
    expect(headline('clean-settlement', 'verify')).toMatch(/^\d+ \/ \d+$/);
  });

  it('humanizes the consensus time in the anchor notice', () => {
    const n = STEPS.find((s) => s.id === 'log').notice(anchored(runs['clean-settlement']))[2];
    expect(n.label).toMatch(/Hedera testnet recorded it, at sequence 16/);
    // en-GB abbreviates September as "Sept", so allow three or four letters.
    expect(n.body).toMatch(/UTC on \d{1,2} \w{3,4} \d{4}/);
    expect(n.body).not.toMatch(/1790181237/);
  });

  it('names excluded sources by two path segments, never one', () => {
    // "september" alone named nothing a viewer could recognize.
    const body = STEPS.find((s) => s.id === 'context').notice(runs['clean-settlement'])[0].body;
    expect(body).toMatch(/payroll\/september/);
    expect(body).not.toMatch(/(^|\s)september\b/);
  });
});

describe('structure', () => {
  it('maps each step to one of the four questions, with step 4 onwards on verifiability', () => {
    expect(STEPS.map((s) => s.answers)).toEqual(['knew', 'allowed', 'happened', 'verifiable', 'verifiable']);
  });

  it('orders the five situations for teaching', () => {
    const order = Object.entries(SCENARIO_ROLES).sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
    expect(order).toEqual(['clean-settlement', 'policy-block', 'unknown-reconcile', 'poisoned-context', 'tamper']);
  });

  it('groups every verifier check id into exactly one plain-language question', () => {
    const ids = CHECK_GROUPS.flatMap((g) => g.ids);
    expect(new Set(ids).size).toBe(ids.length);
    const emitted = new Set(Object.values(runs).flatMap((r) => r.verification.checks.map((c) => c.id)));
    for (const id of emitted) expect(ids, `check ${id} has no group`).toContain(id);
  });
});
