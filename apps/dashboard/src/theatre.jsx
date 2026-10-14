import React, { useEffect, useRef } from 'react';

import { STAGES, NODES, describeEvent, nodeForEvent } from './topology.js';

/**
 * The execution theatre: where, what, and what-so-far.
 *
 * Three regions, each answering exactly one question, so a viewer's eye has
 * one place to go for new information:
 *
 *   Topology  where in the system this is happening
 *   Now       what just happened, and by what mechanism
 *   Log       what has happened so far
 */

/* ------------------------------------------------------------------ */
/* Now                                                                 */
/* ------------------------------------------------------------------ */

/** The single event under the spotlight. */
export function NowPanel({ event, index, total, idle }) {
  if (!event) {
    return (
      <div className="now idle">
        <div className="now-eyebrow">Ready</div>
        <div className="now-title">{idle ?? 'Press play to run this step.'}</div>
      </div>
    );
  }

  const d = describeEvent(event);
  const node = NODES.find((n) => n.id === nodeForEvent(event));

  return (
    <div className={`now tone-${d.tone}`} key={event.seq}>
      <div className="row" style={{ gap: 8, marginBottom: 7 }}>
        <span className="now-eyebrow">
          {node ? node.label : 'Runtime'}
        </span>
        <div className="spacer" />
        <span className="mono now-counter">{index + 1} / {total}</span>
      </div>

      <div className="now-title">{d.title}</div>
      {d.body && <div className="now-body">{d.body}</div>}

      {d.facts.length > 0 && (
        <dl className="now-facts">
          {d.facts.filter((f) => f.value !== undefined && f.value !== null && f.value !== '').map((f, i) => (
            <React.Fragment key={i}>
              <dt>{f.label}</dt>
              <dd>{String(f.value)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

/** Append-only history of the run so far, newest last. */
export function EventLog({ events, activeSeq, maxHeight = 260, title = 'What has happened' }) {
  const ref = useRef(null);

  // Keep the newest line in view without yanking the whole page.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="log">
      <div className="log-head">
        <span className="now-eyebrow">{title}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{events.length}</span>
      </div>
      <ol className="log-list" ref={ref} style={{ maxHeight }}>
        {events.map((e) => {
          const d = describeEvent(e);
          return (
            <li
              key={e.seq}
              className={`log-item tone-${d.tone}${e.seq === activeSeq ? ' active' : ''}`}
            >
              <span className="log-gl" aria-hidden="true">
                {d.tone === 'good' ? '✓' : d.tone === 'bad' ? '✕' : d.tone === 'warn' ? '!' : '·'}
              </span>
              <span className="log-text">{d.title}</span>
            </li>
          );
        })}
        {events.length === 0 && <li className="log-empty">Nothing yet.</li>}
      </ol>
    </div>
  );
}

/**
 * A one-line "you are here", for the sticky bar.
 *
 * The full topology is ~230px tall, which is too much to pin on a laptop
 * screen - it ate 40% of the viewport and pushed the narration below the fold.
 * The map stays in flow above; this is what follows you down the page.
 */
export function MiniMap({ currentStep, reachedSteps, activeNode, onSelectStep, nodeOverrides = {} }) {
  // Same overrides as the topology, so the two never name one component twice.
  const base = NODES.find((n) => n.id === activeNode);
  const node = base ? { ...base, ...(nodeOverrides[base.id] ?? {}) } : null;
  const steps = STAGES.filter((st) => st.step);
  return (
    <div className="minimap">
      {steps.map((st, i) => {
        const done = reachedSteps.includes(st.step);
        const cur = st.step === currentStep;
        const accent =
          st.family === 'cigar' ? 'var(--cigar)'
          : st.family === 'aac' ? 'var(--aac)'
          : 'var(--brief-slate)';
        return (
          <React.Fragment key={st.id}>
            <button
              className={`mini-step${cur ? ' current' : ''}${done ? ' done' : ''}`}
              style={{ '--accent': accent }}
              onClick={() => onSelectStep(st.step)}
              aria-current={cur ? 'step' : undefined}
            >
              <span className="mini-n">{done && !cur ? '\u2713' : st.n}</span>
              <span className="mini-label">{st.label}</span>
            </button>
            {i < steps.length - 1 && <span className="mini-sep" aria-hidden="true">{'\u203a'}</span>}
          </React.Fragment>
        );
      })}
      {node && (
        <span className="mini-at">
          <span className="mini-at-dot" aria-hidden="true" />
          at <strong>{node.label}</strong>
        </span>
      )}
    </div>
  );
}

/* =================================================================== */
/* UX pass 4: the stage                                                 */
/* =================================================================== */

/**
 * The system as a vertical flow, for the right-hand side of the stage.
 *
 * Vertical so it can sit beside the story rather than above it: the old
 * horizontal map pushed the narration below the fold, so on a projector the
 * audience watched the map while the story happened off-screen. Here the rail
 * fills in top to bottom as steps complete, which is the flow made literal.
 *
 * Only the ACTIVE node expands to show what it does. Every other node is a
 * label; its description is one hover away. Trust tags stay on every node,
 * because they carry the security story at a glance.
 */
export function FlowMap({ activeNode, visitedNodes, currentStep, reachedSteps, onSelectStep, nodeOverrides = {}, started }) {
  return (
    <ol className="flow" aria-label="The system, end to end">
      {STAGES.map((stage) => {
        const nodes = NODES.filter((n) => n.stage === stage.id);
        const isCurrent = stage.step && stage.step === currentStep;
        const isDone = stage.step ? reachedSteps.includes(stage.step) : started;
        const accent =
          stage.family === 'cigar' ? 'var(--cigar)'
          : stage.family === 'aac' ? 'var(--aac)'
          : 'var(--brief-slate)';
        return (
          <li
            key={stage.id}
            className={`flow-stage${isCurrent ? ' current' : ''}${isDone ? ' done' : ''}`}
            style={{ '--accent': accent }}
          >
            <span className="flow-dot" aria-hidden="true">
              {isDone && !isCurrent ? '✓' : stage.n ?? ''}
            </span>
            <div className="flow-body">
              <button
                className="flow-head"
                onClick={() => stage.step && onSelectStep(stage.step)}
                disabled={!stage.step}
                aria-current={isCurrent ? 'step' : undefined}
                title={stage.step ? `Go to step ${stage.n}` : 'The world outside the runtime'}
              >
                <span className="flow-label">{stage.label}</span>
                <span className="flow-note">{stage.note}</span>
              </button>
              <div className="flow-nodes">
                {nodes.map((base) => {
                  const n = { ...base, ...(nodeOverrides[base.id] ?? {}) };
                  const active = n.id === activeNode;
                  const visited = visitedNodes.has(n.id);
                  return (
                    <span
                      key={n.id}
                      className={
                        'flow-node'
                        + (active ? ' active' : '')
                        + (visited ? ' visited' : '')
                        + (n.trust ? ` trust-${n.trust}` : '')
                      }
                      title={`${n.label} — ${n.sub}`}
                    >
                      <span className="flow-node-label">{n.label}</span>
                      {active && <span className="flow-node-sub">{n.sub}</span>}
                      {n.trust === 'external' && <span className="flow-tag">outside</span>}
                      {n.trust === 'local' && <span className="flow-tag local">stays local</span>}
                      {n.trust === 'risky' && <span className="flow-tag risky">not trusted</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The brief's four questions, filling in as the story answers them.
 *
 * This is the thread through the whole walkthrough, and at the end it IS the
 * scorecard - so there is exactly one of it on screen, not a progress strip and
 * a separate summary card saying the same thing twice.
 */
export function StorySoFar({ questions, answers, currentQuestion, complete }) {
  return (
    <div className={`sofar${complete ? ' complete' : ''}`}>
      <div className="sofar-head">
        <span className="now-eyebrow">The four questions</span>
        <span className="sofar-src">page 1 of the brief</span>
      </div>
      <ol className="sofar-list">
        {questions.map((q) => {
          const a = answers[q.id] ?? { state: 'idle' };
          const answered = a.state !== 'idle';
          const current = !complete && q.id === currentQuestion;
          return (
            <li key={q.id} className={`sofar-item ${answered ? a.state : 'idle'}${current ? ' current' : ''}`}>
              <span className="sofar-gl" aria-hidden="true">
                {!answered ? q.n : a.state === 'bad' ? '✕' : a.state === 'warn' ? '!' : '✓'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="sofar-q">
                  {q.question}
                  {current && <span className="sofar-here">this step</span>}
                </div>
                {answered && <div className="sofar-a">{a.line}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="sofar-foot">
        Green means <em>answerable</em>, not favourable &mdash; a correctly blocked payment is green.
      </div>
    </div>
  );
}
