import React, { useEffect, useState } from 'react';

/**
 * Shared primitives.
 *
 * The dual-register rule lives here: every claim appears twice, as a
 * plain-language line anyone can read and as the bytes behind it one click
 * away. Neither is a mode the presenter has to remember to switch.
 */

/** Status chip. Always carries a glyph AND a word, never colour alone. */
export function Badge({ state, children, title }) {
  const map = {
    good: { cls: 'good', gl: '✓' },
    bad: { cls: 'bad', gl: '✕' },
    warn: { cls: 'warn', gl: '!' },
    idle: { cls: 'idle', gl: '·' },
    cigar: { cls: 'cigar', gl: '◆' },
    aac: { cls: 'aac', gl: '◆' },
    proposed: { cls: 'proposed', gl: '△' },
  };
  const m = map[state] ?? map.idle;
  return (
    <span className={`badge ${m.cls}`} title={title}>
      <span className="gl" aria-hidden="true">{m.gl}</span>
      {children}
    </span>
  );
}

/** A 64-char digest, shown head-and-tail with the full value on demand. */
export function Digest({ value, chars = 12, title }) {
  const [full, setFull] = useState(false);
  if (!value) return <span className="hex tail">—</span>;
  const s = String(value);
  if (full || s.length <= chars + 6) {
    return (
      <span className="hex lead" onClick={() => setFull(false)} style={{ cursor: 'pointer' }} title="click to shorten">
        {s}
      </span>
    );
  }
  return (
    <span
      onClick={() => setFull(true)}
      style={{ cursor: 'pointer' }}
      title={title ?? 'click for the full digest'}
    >
      <span className="hex lead">{s.slice(0, chars)}</span>
      <span className="hex tail">…{s.slice(-4)}</span>
    </span>
  );
}

/** The technical register: a collapsed drawer of canonical bytes / raw JSON. */
export function Bytes({ label = 'bytes', children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button className="bytes-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '‹' : '›'} {label}
      </button>
      {open && <div className="bytes-body fade-in">{children}</div>}
    </div>
  );
}

export function Json({ value, max = 340 }) {
  return <pre style={{ maxHeight: max }}>{JSON.stringify(value, null, 2)}</pre>;
}

export function Card({ title, eyebrow, family, right, children, claim, sub, id }) {
  const accent = family === 'cigar' ? 'var(--cigar)' : family === 'aac' ? 'var(--aac)' : 'var(--brief-slate)';
  return (
    <section className="card" id={id} style={id ? { scrollMarginTop: 96 } : undefined}>
      {(title || eyebrow) && (
        <header style={{ borderLeft: `3px solid ${accent}`, borderTopLeftRadius: 10 }}>
          <div className="row">
            <div style={{ minWidth: 0 }}>
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              {title && <h3 style={{ fontSize: 17, marginTop: eyebrow ? 3 : 0 }}>{title}</h3>}
            </div>
            <div className="spacer" />
            {right}
          </div>
          {claim && <p className="claim small" style={{ marginTop: 10 }}>{claim}</p>}
          {sub && <p className="sub" style={{ marginTop: 4 }}>{sub}</p>}
        </header>
      )}
      <div className="body">{children}</div>
    </section>
  );
}

export function KV({ rows }) {
  return (
    <dl className="kv">
      {/*
        Keyed by index, not by label. Labels may be React elements (a <Term>
        that defines itself), and React coerces a non-string key to
        "[object Object]" - so every such row would collide on one key.
      */}
      {rows.filter(Boolean).map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Scope statements. Always shown in pairs, so a verdict cannot be over-read. */
export function Scope({ establishes, doesNotEstablish, note }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>What this establishes</div>
        <ul className="scope-list does">
          {establishes.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>What it does NOT establish</div>
        <ul className="scope-list doesnt">
          {doesNotEstablish.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </div>
      {note && <p className="note" style={{ gridColumn: '1 / -1' }}>{note}</p>}
    </div>
  );
}

export function Meter({ value, limit, label, unit = '' }) {
  const pct = limit ? Math.min(100, (value / limit) * 100) : 0;
  return (
    <div>
      <div className="row" style={{ fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: 'var(--ink-2)' }}>{label}</span>
        <div className="spacer" />
        <span className="mono" style={{ fontSize: 12.5 }}>
          {value.toLocaleString()}{unit} / {limit.toLocaleString()}{unit}
        </span>
      </div>
      <div className="meter"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** A big single number with a label. Not a chart, because it is one value. */
export function Stat({ value, label, tone = 'neutral', sub }) {
  const color =
    tone === 'good' ? 'var(--good-inkable)'
    : tone === 'bad' ? 'var(--critical-inkable)'
    : tone === 'warn' ? 'var(--warning-inkable)'
    : 'var(--ink-1)';
  return (
    <div>
      <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div className="eyebrow" style={{ marginTop: 4 }}>{label}</div>
      {sub && <div className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* =================================================================== */
/* Teaching primitives, added in the UX pass.                          */
/* =================================================================== */

/**
 * Terminology context, so a term can define itself wherever it appears.
 *
 * A glossary at the bottom of a long page is a glossary nobody reads: by the
 * time you have scrolled to it you have lost the sentence that sent you.
 */
export const TermsContext = React.createContext({});

/**
 * An inline term with its definition one hover or tap away.
 *
 * Plain-language first, precise definition second. A reader who only needs the
 * first line should not have to read past it.
 */
export function Term({ children, of }) {
  const terms = React.useContext(TermsContext);
  const [open, setOpen] = useState(false);
  const key = of ?? (typeof children === 'string' ? children : null);
  const def = key ? terms[key] : null;

  if (!def) return <>{children}</>;

  return (
    <span
      className="term"
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label={`${key}: ${def.plain}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    >
      {children}
      {open && (
        <span className="term-pop fade-in" role="tooltip">
          <span className="term-pop-name">{key}</span>
          <span className="term-pop-plain">{def.plain}</span>
          <span className="term-pop-precise">{def.precise}</span>
        </span>
      )}
    </span>
  );
}

/**
 * "What to notice" — the bridge between a screen full of true facts and a
 * reader knowing which one is the point.
 */
export function Notices({ items }) {
  if (!items?.length) return null;
  return (
    <ol className="notices">
      {items.map((it, i) => (
        <li key={i}>
          <span className="notices-n" aria-hidden="true">{i + 1}</span>
          <div>
            <div className="notices-label">{it.label}</div>
            <div className="notices-body">{it.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A disclosure section. Secondary depth stays available without being present. */
export function Collapsible({ title, subtitle, children, defaultOpen = false, tone = 'neutral', right }) {
  const [open, setOpen] = useState(defaultOpen);
  // Follow `defaultOpen` when it changes, so a caller can drive these from the
  // density switch. A local toggle still wins until the driver moves again.
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <section className={`collapsible ${tone}`}>
      <button className="collapsible-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="collapsible-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="collapsible-title">{title}</span>
          {subtitle && <span className="collapsible-sub">{subtitle}</span>}
        </span>
        {right}
      </button>
      {open && <div className="collapsible-body fade-in">{children}</div>}
    </section>
  );
}


/* =================================================================== */
/* UX pass 2: density control and the landing hero.                    */
/* =================================================================== */

/**
 * Detail density.
 *
 * NOT a mode switch on the narrative - the story is identical either way, and
 * every drawer stays clickable regardless. This only sets the DEFAULT open
 * state of the heavy sections: tables, digest lists, canonical bytes.
 *
 * Why it earns its place: a non-technical viewer landing on a page of hex and
 * Merkle proofs has to do work just to find the sentence meant for them. An
 * engineer, conversely, resents clicking twelve drawers. One switch serves
 * both without either seeing a different set of facts.
 */
export const DetailContext = React.createContext(false);

/**
 * A heavy section, open by default only in technical density.
 *
 * Follows the global switch, but a local toggle wins until the switch moves
 * again - so opening one drawer in plain mode does not flip the whole page.
 */
export function Detail({ label, hint, children, tone = 'neutral' }) {
  const technical = React.useContext(DetailContext);
  const [open, setOpen] = useState(technical);
  useEffect(() => { setOpen(technical); }, [technical]);

  return (
    <section className={`collapsible ${tone}`} style={{ background: 'transparent' }}>
      <button className="collapsible-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="collapsible-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="collapsible-title" style={{ fontSize: 14 }}>{label}</span>
          {hint && <span className="collapsible-sub" style={{ fontSize: 12.5 }}>{hint}</span>}
        </span>
      </button>
      {open && <div className="collapsible-body fade-in">{children}</div>}
    </section>
  );
}

/** The one number or phrase a step is really about. */
export function Headline({ value, label, tone = 'neutral', sub }) {
  const color =
    tone === 'good' ? 'var(--good-inkable)'
    : tone === 'bad' ? 'var(--critical-inkable)'
    : tone === 'warn' ? 'var(--warning-inkable)'
    : 'var(--ink-1)';
  return (
    <div className="headline">
      <div className="headline-value" style={{ color }}>{value}</div>
      <div className="headline-label">{label}</div>
      {sub && <div className="headline-sub">{sub}</div>}
    </div>
  );
}
