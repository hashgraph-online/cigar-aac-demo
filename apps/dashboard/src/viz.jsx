import React from 'react';
import { Badge, Digest } from './ui.jsx';

/**
 * Visualizations.
 *
 * None of these are decorative: each one is drawn from the actual run. The
 * seam lights up from the real event stream, the MMR forest is the real tree,
 * and the state machine shows the transitions the effect ledger actually took.
 */

/* ------------------------------------------------------------------ */
/* The effect lifecycle, as the state machine it actually is.          */
/* ------------------------------------------------------------------ */
const LIFECYCLE = [
  { id: 'intent_recorded', label: 'intent', hint: 'recorded before anything leaves' },
  { id: 'authorized', label: 'authorized', hint: 'checked against the handoff' },
  { id: 'dispatched', label: 'dispatched', hint: 'the request left the boundary' },
  { id: 'unknown', label: 'UNKNOWN', hint: 'sent, and no result observed', emphasis: true },
  { id: 'observed', label: 'observed', hint: 'a result came back and was bound' },
  { id: 'reconciled', label: 'reconciled', hint: 'resolved by a later observation' },
  { id: 'compensated', label: 'compensated', hint: 'a corrective effect, recorded separately' },
  { id: 'refused', label: 'refused', hint: 'the gate stopped it' },
  { id: 'failed', label: 'failed', hint: 'a known runtime failure' },
];

export function EffectLifecycle({ transitions }) {
  const taken = new Map((transitions ?? []).map((t) => [t.state, t]));
  const order = LIFECYCLE.filter((s) => taken.has(s.id) || ['intent_recorded', 'authorized', 'dispatched'].includes(s.id));
  const terminal = transitions?.[transitions.length - 1]?.state;

  return (
    <div>
      <div className="row wrap" style={{ gap: 0, alignItems: 'stretch' }}>
        {order.map((s, i) => {
          const t = taken.get(s.id);
          const on = Boolean(t);
          const isTerminal = terminal === s.id;
          const tone = s.id === 'unknown' ? 'var(--warning)'
            : s.id === 'refused' || s.id === 'failed' ? 'var(--critical)'
            : 'var(--cigar)';
          return (
            <React.Fragment key={s.id}>
              <div
                style={{
                  minWidth: 120, flex: '0 1 auto', padding: '9px 12px', borderRadius: 8,
                  border: `${isTerminal ? 2 : 1}px solid ${on ? tone : 'var(--rule)'}`,
                  background: on ? (s.id === 'unknown' ? 'color-mix(in srgb, var(--warning) 12%, transparent)' : 'var(--cigar-soft)') : 'transparent',
                  opacity: on ? 1 : 0.42,
                }}
              >
                <div className="row" style={{ gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {t ? t.seq : '·'}
                  </span>
                  <span style={{
                    fontWeight: 700, fontSize: 13.5,
                    color: on ? (s.id === 'unknown' ? 'var(--warning-inkable)' : 'var(--ink-1)') : 'var(--ink-3)',
                    fontFamily: s.emphasis ? 'var(--mono)' : 'inherit',
                  }}>
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.3 }}>{s.hint}</div>
              </div>
              {i < order.length - 1 && (
                <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', padding: '0 5px', color: 'var(--ink-3)' }}>
                  {'→'}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {taken.has('unknown') && (
        <p className="note caution" style={{ marginTop: 14 }}>
          <strong>UNKNOWN is the state most systems do not have.</strong> The request is known to
          have left the boundary and its outcome is not known. Collapsing this into success or
          failure destroys the only honest answer available at the time.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The MMR: "the log is a forest, not a tree".                         */
/* ------------------------------------------------------------------ */
export function MmrForest({ mmr, highlightLeaf = null, entries = [] }) {
  if (!mmr) return null;
  const leafAt = (i) => entries[i];

  /** Lay out one peak as a triangle of rows, leaves at the bottom. */
  const renderPeak = (peak, peakIdx, firstLeaf) => {
    const leafCount = 2 ** peak.height;
    const rows = [];
    for (let h = peak.height; h >= 0; h -= 1) {
      const nodes = 2 ** (peak.height - h);
      rows.push(
        <div key={h} className="row" style={{ gap: 3, justifyContent: 'center' }}>
          {Array.from({ length: nodes }, (_, k) => {
            const isLeaf = h === 0;
            const leafIndex = firstLeaf + k;
            const hot = isLeaf && leafIndex === highlightLeaf;
            return (
              <div
                key={k}
                title={isLeaf ? `leaf ${leafIndex}` : `interior node, height ${h}`}
                style={{
                  width: isLeaf ? 26 : Math.max(26, 26 * 2 ** h + 3 * (2 ** h - 1)),
                  height: 15,
                  borderRadius: 3,
                  background: hot ? 'var(--aac)' : isLeaf ? 'var(--cigar)' : 'var(--cigar-soft)',
                  border: `1px solid ${hot ? 'var(--aac)' : 'var(--cigar)'}`,
                  boxShadow: hot ? '0 0 0 2px var(--surface-1), 0 0 0 4px var(--aac)' : 'none',
                }}
              />
            );
          })}
        </div>,
      );
    }
    return (
      <div key={peak.pos} style={{ textAlign: 'center' }}>
        <div className="grid" style={{ gap: 3 }}>{rows}</div>
        <div className="eyebrow" style={{ marginTop: 7, color: 'var(--ink-3)' }}>
          peak · {leafCount} leaf{leafCount === 1 ? '' : 'ves'} · h{peak.height}
        </div>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>pos {peak.pos}</div>
      </div>
    );
  };

  let consumed = 0;
  const peaks = mmr.peaks.map((p, i) => {
    const first = consumed;
    consumed += 2 ** p.height;
    return renderPeak(p, i, first);
  });

  return (
    <div>
      <div className="row" style={{ gap: 30, alignItems: 'flex-end', flexWrap: 'wrap', paddingBottom: 6 }}>
        {peaks}
        <div style={{ flex: '0 0 auto', paddingLeft: 10, borderLeft: '1px solid var(--rule)' }}>
          <div className="eyebrow">bagged root · 32 bytes</div>
          <div style={{ marginTop: 4 }}><Digest value={mmr.root} chars={20} /></div>
          <div className="sub" style={{ fontSize: 12.5, marginTop: 5 }}>
            One value committing to all {mmr.leaf_count} leaf{mmr.leaf_count === 1 ? '' : 'ves'}.
          </div>
        </div>
      </div>
      {highlightLeaf != null && leafAt(highlightLeaf) && (
        <div className="mono" style={{ fontSize: 12, marginTop: 10, color: 'var(--ink-2)' }}>
          leaf {highlightLeaf} = SHA-256(32 raw bytes of capsule_id) ={' '}
          <Digest value={leafAt(highlightLeaf).leaf_hash} chars={16} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The four composition slots.                                         */
/* ------------------------------------------------------------------ */
const SLOT_COPY = {
  who: { q: 'Who acted, and on whose behalf?', gloss: 'Identity and pedigree.' },
  can: { q: 'What permitted it?', gloss: 'The authority - a foreign-signed artifact, bound as transmitted.' },
  did: { q: 'What was actually done?', gloss: 'request_digest and response_digest held apart, so "may" never reads as "did".' },
  audit: { q: 'Under what disposition, and with what limits?', gloss: 'Verdict class, timestamp, assurance, and what was withheld.' },
};

export function Slots({ members, onSelect, active }) {
  const order = ['who', 'can', 'did', 'audit'];
  const bySlot = new Map((members ?? []).map((m) => [m.slot, m]));
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
      {order.map((slot) => {
        const m = bySlot.get(slot);
        const copy = SLOT_COPY[slot];
        return (
          <button
            key={slot}
            onClick={() => onSelect?.(slot)}
            aria-pressed={active === slot}
            style={{
              textAlign: 'left', display: 'block', padding: '12px 14px', borderRadius: 8,
              background: 'var(--aac-soft)',
              borderColor: active === slot ? 'var(--aac)' : 'var(--rule)',
              borderWidth: active === slot ? 2 : 1,
            }}
          >
            <div className="row" style={{ gap: 7, marginBottom: 5 }}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--aac)' }}>
                {slot.toUpperCase()}
              </span>
              {m?.ref?.digest && <Badge state="good">bound</Badge>}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{copy.q}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.35 }}>{copy.gloss}</div>
            {m && (
              <div style={{ marginTop: 8 }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{m.type}</div>
                <Digest value={m.ref.digest} chars={10} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* =================================================================== */
/* UX pass 2: less ink for the same information.                       */
/* =================================================================== */

/**
 * The step rail.
 *
 * The same navigation as before at roughly a third of the ink. Five bordered
 * boxes with two lines each competed with the step content they were meant to
 * introduce; a rail of underlines does the same job quietly.
 */
export function Rail({ steps, current, reached, onSelect, counts = {} }) {
  return (
    <nav className="rail" aria-label="Lifecycle steps">
      {steps.map((s) => {
        const isCurrent = s.id === current;
        const isReached = reached.includes(s.id);
        const accent =
          s.family === 'cigar' ? 'var(--cigar)'
          : s.family === 'aac' ? 'var(--aac)'
          : 'var(--brief-slate)';
        return (
          <button
            key={s.id}
            className={`rail-step${isCurrent ? ' current' : ''}${isReached ? ' reached' : ''}`}
            style={{ '--accent': accent }}
            onClick={() => onSelect(s.id)}
            aria-current={isCurrent ? 'step' : undefined}
            title={`${s.owner} — ${s.label}`}
          >
            <span className="rail-top">
              <span className="rail-n" aria-hidden="true">
                {isReached && !isCurrent ? '✓' : s.n}
              </span>
              <span className="rail-label">{s.short}</span>
            </span>
            <span className="rail-count">{counts[s.id] ?? ' '}</span>
          </button>
        );
      })}
    </nav>
  );
}
