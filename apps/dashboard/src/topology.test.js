import { describe, it, expect } from 'vitest';
import { runScenario, SCENARIOS } from '../../server/src/engine.js';
import { NODES, STAGES, nodeForEvent, describeEvent, MILESTONES } from './topology.js';

/**
 * The narration layer had no tests, and it cost a live-demo crash: an edit
 * meant for describeEvent() landed in nodeForEvent() because both switches
 * contain `case 'cigar.replay':`. That broke the env.captured fallthrough, so
 * every run threw "F is not defined" the moment step 1 captured its decision
 * environment.
 *
 * These tests run the real event stream of every scenario through both
 * functions, which is the check that would have caught it.
 */

const NODE_IDS = new Set(NODES.map((n) => n.id));

/** The events the server adds after the offline run, when Hedera is on. */
const ANCHOR_EVENTS = [
  {
    kind: 'scitt.anchored',
    network: 'testnet',
    topic_id: '0.0.10684243',
    sequence_number: 6,
    consensus_timestamp: '1790180715.235499104',
    running_hash: Buffer.from('running').toString('base64'),
    message_bytes: 261,
    confirmed: true,
    created_topic: false,
  },
  { kind: 'scitt.anchor_failed', reason: 'mirror node had not indexed the message' },
];

const allEvents = () => [
  ...SCENARIOS.flatMap((s) => runScenario(s.id).events),
  ...ANCHOR_EVENTS,
];

describe('nodeForEvent', () => {
  it('returns a known node id or null for every real event - never an object', () => {
    // The crash signature: a narration object returned where a node id belongs.
    for (const e of allEvents()) {
      const n = nodeForEvent(e);
      expect(n === null || typeof n === 'string', `${e.kind} returned ${typeof n}`).toBe(true);
      if (n !== null) expect(NODE_IDS.has(n), `${e.kind} -> unknown node "${n}"`).toBe(true);
    }
  });

  it('maps the decision environment to its own node', () => {
    expect(nodeForEvent({ kind: 'env.captured' })).toBe('env');
    expect(nodeForEvent({ kind: 'cigar.replay' })).toBe('env');
  });

  it('maps the public anchor to the witness', () => {
    expect(nodeForEvent(ANCHOR_EVENTS[0])).toBe('witness');
    expect(nodeForEvent(ANCHOR_EVENTS[1])).toBe('witness');
  });

  it('attributes every event of every scenario to some node', () => {
    // stage.enter is structural, not work at a component.
    const orphans = allEvents()
      .filter((e) => e.kind !== 'stage.enter' && nodeForEvent(e) === null)
      .map((e) => e.kind);
    expect([...new Set(orphans)]).toEqual([]);
  });
});

describe('describeEvent', () => {
  it('narrates every real event without throwing', () => {
    for (const e of allEvents()) {
      expect(() => describeEvent(e), e.kind).not.toThrow();
    }
  });

  it('always returns a title, a known tone and a list of facts', () => {
    for (const e of allEvents()) {
      const d = describeEvent(e);
      expect(typeof d.title, e.kind).toBe('string');
      expect(d.title.length, e.kind).toBeGreaterThan(0);
      expect(['good', 'bad', 'warn', 'neutral'], e.kind).toContain(d.tone);
      expect(Array.isArray(d.facts), e.kind).toBe(true);
    }
  });

  it('has a written narration for every event kind, not the raw kind as a fallback', () => {
    // Falling through to the default would put "cll.checkpointed" on screen.
    const raw = allEvents().filter((e) => e.kind !== 'stage.enter' && describeEvent(e).title === e.kind);
    expect([...new Set(raw.map((e) => e.kind))]).toEqual([]);
  });

  it('narrates the public anchor with its real coordinates', () => {
    const d = describeEvent(ANCHOR_EVENTS[0]);
    expect(d.title).toMatch(/Hedera testnet/);
    const facts = Object.fromEntries(d.facts.map((f) => [f.label, f.value]));
    expect(facts.topic).toBe('0.0.10684243');
    expect(facts.sequence).toBe(6);
    expect(facts['re-read from mirror']).toBe('yes, confirmed');
  });

  it('flags an unconfirmed anchor as a warning, not a success', () => {
    expect(describeEvent({ ...ANCHOR_EVENTS[0], confirmed: false }).tone).toBe('warn');
  });

  it('narrates a failed anchor as recorded, not hidden', () => {
    const d = describeEvent(ANCHOR_EVENTS[1]);
    expect(d.tone).toBe('warn');
    expect(d.body).toMatch(/recorded rather than hidden/);
  });

  it('never leaks business content into the narration of a public anchor', () => {
    const text = JSON.stringify(describeEvent(ANCHOR_EVENTS[0]));
    for (const secret of ['48200', 'INV-2026-0918', 'Meridian']) expect(text).not.toContain(secret);
  });
});

describe('topology structure', () => {
  it('places every node in a real stage', () => {
    const stages = new Set(STAGES.map((s) => s.id));
    for (const n of NODES) expect(stages.has(n.stage), n.id).toBe(true);
  });

  it('holds the public anchor as a milestone', () => {
    expect(MILESTONES.has('scitt.anchored')).toBe(true);
  });
});
