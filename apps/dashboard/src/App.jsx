import React, { useEffect, useRef, useState } from 'react';
import { parseJson } from '@cigar-aac/cpb/json';
import { CHAPTERS, SCENARIO_COPY, sourceName, money, witnessStatus } from './experience.js';
import { CHECK_GROUPS } from './teaching.js';
import './experience.css';
import { DemoGuide, openHederaGuide } from './guide.jsx';

async function api(path, body, signal) {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const data = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw new Error(data.error || 'The request could not complete.');
  return data;
}

function Status({ state = 'idle', children }) {
  return <span className={'proof-status status-' + state}><span aria-hidden="true" />{children}</span>;
}

function EvidenceChecks({ verification }) {
  return <div className="proof-checks">
    {CHECK_GROUPS.map((group) => {
      const checks = verification.checks.filter((check) => group.ids.includes(check.id));
      if (!checks.length) return null;
      const failed = checks.filter((check) => !check.ok);
      return <details key={group.title} className={failed.length ? 'checks-failed' : ''} open={failed.length ? true : undefined}>
        <summary><span className="check-symbol" aria-hidden="true">{failed.length ? '×' : '✓'}</span><span>{group.title}</span><span className="check-count">{checks.length - failed.length}/{checks.length}</span></summary>
        <p>{group.plain}</p>
        {checks.map((check, index) => <div className="check-row" key={index}>
          <strong>{check.ok ? '✓ ' : '× '}{check.name}</strong><p>{check.detail}</p>
        </div>)}
      </details>;
    })}
  </div>;
}

function ContextChapter({ result }) {
  const { manifest, cigar } = result.artifacts;
  return <>
    <div className="chapter-heading"><span className="section-label">01 / CIGAR</span><h3>The right information. Within the rules.</h3><p>The host sets the source permissions. CIGAR compiles that view, includes the required evidence, and checks the exact context size.</p></div>
    <div className="context-summary">
      <div><strong>{manifest.selected.length}<small> / {manifest.considered.length}</small></strong><span>sources selected</span></div>
      <div><strong>{manifest.budget.tokens_charged}<small> tokens</small></strong><span>including source citations</span></div>
      <div><strong>{manifest.budget.tokens_available.toLocaleString()}</strong><span>available after reserving {manifest.budget.tokens_reserved}</span></div>
    </div>
    <div className="source-columns">
      <div><h4><span className="mini-dot mint" />Included in context</h4>{manifest.selected.map((source) => <div className="source-row" key={source.source_id}><span aria-hidden="true">✓</span><span>{sourceName(source.source_id)}<small>{source.authority.replaceAll('-', ' ')}</small></span></div>)}</div>
      <div><h4><span className="mini-dot amber" />Excluded before compilation</h4>{manifest.excluded.map((source) => <div className="source-row excluded" key={source.source_id}><span aria-hidden="true">−</span><span>{sourceName(source.source_id)}<small>{source.rule.replaceAll('_', ' ')}</small></span></div>)}
        <div className="quiet-callout">The evidence names the excluded sources and the rules. Their content stays out of the exported bundle.</div>
      </div>
    </div>
    <div className="review-strip"><span className="review-icon" aria-hidden="true">✓</span><div><strong>Reviewed claim released</strong><p>{cigar.draft.claims[0].text}</p></div><span className="tiny-tag">Without review: withheld</span></div>
    <p className="fine-print">The reviewer and payment gateway are scripted fixtures. CIGAR executes the source, budget, citation and review-binding checks using the published 0.14.0 native worker.</p>
  </>;
}

function ActionChapter({ result }) {
  const ledger = result.artifacts.effectLedger.ledger;
  const ceiling = result.artifacts.handoff.handoff.budget.amount_max;
  const refused = ledger.terminal_state === 'refused';
  const reconciled = ledger.transitions.some((transition) => transition.state === 'unknown');
  const names = { intent_recorded: 'Intent recorded', planned: 'Intent recorded', authorized: 'Permission checked', dispatched: 'Request sent', unknown: 'Outcome unknown', observed: 'Response observed', reconciled: 'Reconciled', compensated: 'Retry suppressed', refused: 'Blocked before dispatch' };
  return <>
    <div className="chapter-heading"><span className="section-label">02 / APPLICATION POLICY</span><h3>{refused ? 'The agent stopped at its limit.' : reconciled ? 'A timeout never became a false success.' : 'Permission first. Then the payment.'}</h3><p>{refused ? 'The invoice exceeds the delegated ceiling. The host refused the request and preserved evidence that the gate fired.' : reconciled ? 'The original uncertainty stays on record. A later observation resolves it; a separate action prevents a duplicate retry.' : 'The application checked the delegated authority before the scripted gateway returned a payment receipt.'}</p></div>
    <div className="authority-card"><div><span>Invoice amount</span><strong>{money(ledger.intent.amount)}</strong></div><div><span>Delegated ceiling</span><strong>{money(ceiling)}</strong></div><div className={'authority-meter ' + (refused ? 'over-limit' : '')}><span style={{ width: Math.min(100, Number(ledger.intent.amount) / Number(ceiling) * 100) + '%' }} /></div><p>{refused ? money(Number(ledger.intent.amount) - Number(ceiling)) + ' above the limit · no dispatch' : 'Within the limit · a review assessment alone does not authorize payment'}</p></div>
    <ol className="effect-steps">{ledger.transitions.map((transition, index) => <li key={index} className={transition.state === 'unknown' ? 'effect-unknown' : ''}><span>{String(index + 1).padStart(2, '0')}</span><strong>{names[transition.state] ?? transition.state}</strong>{transition.state === 'unknown' && <small>No success claimed</small>}</li>)}</ol>
    <div className="principle"><span>WHY THIS MATTERS</span><p>{refused ? 'A refusal is an auditable outcome. This signed record states that the simulated attempt reached the control and was blocked.' : '“Sent” and “confirmed” are different facts. The evidence keeps them separate, so a retry cannot erase an uncertain outcome.'}</p></div>
  </>;
}

function RecordChapter({ result }) {
  const records = result.bundle.capsules;
  const draft = 'https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05';
  return <>
    <div className="chapter-heading"><span className="section-label">03 / AGENT ACTION CAPSULE · DRAFT 5</span><h3>A portable receipt for the whole decision.</h3><p>AAC binds four questions into a signed record. It references the original evidence by fingerprint, so another party can check exactly what the record refers to.</p></div>
    <div className="capsule-slots">{[
      ['WHO', 'Who was accountable?', 'Northwind Industrial and its settlement agent.'],
      ['CAN', 'What could it do?', 'The signed delegation and its €50,000 ceiling.'],
      ['DID', 'What actually happened?', 'The request, observed result, or recorded refusal.'],
      ['AUDIT', 'What supports that story?', 'CIGAR’s native context, review, selection and exclusions.'],
    ].map(([slot, label, detail]) => <div key={slot}><span className="slot-label">{slot}</span><h4>{label}</h4><p>{detail}</p></div>)}</div>
    <div className="receipt-stack">{records.map((item, index) => <div className="receipt-row" key={index}><span className="receipt-number">0{index + 1}</span><div><strong>{item.label}</strong><code>{item.capsule.capsule_id.slice(0, 24)}…</code></div><span className="tiny-tag">{item.capsule.effect.status}</span></div>)}</div>
    <details className="aac-inspector">
      <summary>Show AAC JSON &amp; draft 5</summary>
      <div className="aac-inspector-body">
        <div className="aac-draft-intro"><div><h4>From the draft to this record</h4><p>The JSON below comes from this run’s evidence bundle. Opening it does not execute the action again.</p></div><a href={draft} target="_blank" rel="noreferrer">Read AAC draft 5 ↗</a></div>
        <p className="fine-print">Draft 5 is an Internet-Draft, a work in progress. Its serialization version remains <code>"4"</code>.</p>
        <dl className="aac-field-map">
          <dt>Version &amp; identity</dt><dd><code>spec_version</code> names draft 5. <code>format_version: "4"</code> and <code>canonicalization_id: "jcs"</code> fix the digest rules. <code>capsule_id</code> commits the entire record, including chain links and references. <a href={draft + '#section-5.1'} target="_blank" rel="noreferrer">§5.1 ↗</a></dd>
          <dt>Parties &amp; verdict</dt><dd><code>operator</code>, <code>developer</code> and <code>timestamp</code> identify the accountable parties and claimed action time. <code>disposition</code> records the policy decision and its honest human involvement flag. <a href={draft + '#section-5.5'} target="_blank" rel="noreferrer">§5.5 ↗</a></dd>
          <dt>Effect &amp; assurance</dt><dd><code>effect</code> separates a sent request from an observed response. <code>assurance</code> reports self-attestation, effect evidence and chain linkage. This demo’s local checkpoint receipt does not confer AAC <code>anchored</code> assurance. <a href={draft + '#section-5.3'} target="_blank" rel="noreferrer">§5.3 ↗</a> <a href={draft + '#section-5.4'} target="_blank" rel="noreferrer">§5.4 ↗</a></dd>
          <dt>Original evidence</dt><dd><code>references[]</code> cites artifacts through <code>type</code>, <code>digest_alg</code> and <code>digest</code>. WHO / CAN / DID / AUDIT and the extra <code>slot</code> field are this demo’s composition mapping; AAC does not mandate those four slots. The CAN artifact preserves the original signed delegation. <a href={draft + '#section-5.5.5'} target="_blank" rel="noreferrer">§5.5.5 ↗</a></dd>
          <dt>Producer signature</dt><dd>The separate COSE_Sign1 envelope signs the raw 32-byte Capsule ID. Its key authenticates the signature; authorization remains a separate policy decision. <a href={draft + '#section-3.1'} target="_blank" rel="noreferrer">§3.1 ↗</a></dd>
        </dl>
        {result.tamperApplied && <p className="aac-edit-note">This scenario includes an unsigned edit. The JSON below is the edited bundle checked by the verifier.</p>}
        {records.map((item, index) => <details className="aac-json-record" key={item.capsule.action_id} open={index === 0}>
          <summary>Record {index + 1}: {item.label}</summary>
          <div className="aac-json-body"><span className="section-label">CAPSULE JSON · {item.capsule.spec_version}</span><pre tabIndex={0} aria-label={'AAC JSON: ' + item.label}>{JSON.stringify(item.capsule, null, 2)}</pre>
            <details className="aac-member-inspector"><summary>Show referenced WHO / CAN / DID / AUDIT JSON</summary><p>These artifacts travel alongside the capsule. Their typed digest contexts are defined by this demo’s artifact registry; the capsule itself uses plain JCS.</p>{item.members.map((member) => <details key={member.slot}><summary>{member.slot.toUpperCase()} · {member.type}</summary><pre tabIndex={0} aria-label={member.slot.toUpperCase() + ' artifact JSON'}>{JSON.stringify(member.artifact, null, 2)}</pre></details>)}</details>
          </div>
        </details>)}
      </div>
    </details>
    <p className="fine-print">Signatures bind the evidence to the included demo keys. They do not certify a real-world identity or prove that a claim is true.</p>
  </>;
}

function WitnessChapter({ result }) {
  const witness = witnessStatus(result);
  const anchor = result.bundle.scitt?.hedera;
  return <>
    <div className="chapter-heading"><span className="section-label">04 / SCITT + HEDERA</span><h3>A history that can be checked later.</h3><p>The local log commits the signed records into one fingerprint. A SCITT-style receipt witnesses that checkpoint. Hedera can add an independently recorded consensus timestamp.</p></div>
    <div className="witness-diagram"><div><span className="diagram-number">{result.bundle.capsules.length}</span><strong>Signed records</strong><small>Detailed evidence</small></div><span className="diagram-arrow" aria-hidden="true">→</span><div><span className="diagram-mark" aria-hidden="true">#</span><strong>One checkpoint</strong><small>History fingerprint</small></div><span className="diagram-arrow" aria-hidden="true">→</span><div><span className="diagram-mark" aria-hidden="true">{anchor ? 'ℏ' : '✓'}</span><strong>{anchor ? 'Hedera ' + anchor.network : 'Local witness'}</strong><small>{anchor ? 'Public consensus' : 'Demo receipt signer'}</small></div></div>
    <div className={'witness-result witness-' + witness.state}><Status state={witness.state}>{witness.label}</Status><p>{witness.detail}</p>{anchor && <div className="anchor-coordinates"><span>Topic <strong>{anchor.topic_id}</strong></span><span>Message <strong>{anchor.sequence_number}</strong></span><a href={anchor.explorer_url} target="_blank" rel="noreferrer">View on HashScan ↗</a></div>}</div>
    <div className="principle"><span>WHAT BECOMES PUBLIC?</span><p>{anchor ? anchor.message_bytes + ' bytes: ' : 'Only '}the checkpoint commitment, statement digest, opaque log identifier and log size. The invoice, amount, bank details and context are not published to Hedera.</p></div>
    <p className="fine-print">The Hedera HCS anchor supplements the local receipt; it is not itself a standard SCITT COSE receipt. Offline verification checks its binding. Network confirmation requires a mirror-node read.</p>
  </>;
}

function VerifyChapter({ result }) {
  const { verification } = result;
  return <>
    <div className="chapter-heading"><span className="section-label">05 / INDEPENDENT VERIFICATION</span><h3>{verification.ok ? 'The evidence checks out.' : 'The edited story does not check out.'}</h3><p>{verification.ok ? 'The verifier recomputed the fingerprints and checked signatures, references, log inclusion and the witness receipt. It does not import CIGAR.' : 'The verifier was handed the evidence alone. The edited record failed named checks; no access to the original runtime was needed.'}</p></div>
    <div className={'verification-score ' + (verification.ok ? '' : 'score-failed')}><strong>{verification.summary.passed}<small> / {verification.summary.total}</small></strong><div><h4>checks passed</h4><p>{verification.ok ? 'Signed evidence is internally consistent.' : verification.summary.failed + ' failed checks expose the edit.'}</p></div></div>
    <EvidenceChecks verification={verification} />
    <div className="principle"><span>PROOF HAS A SCOPE</span><p>These checks establish evidence integrity. They do not prove a real payment happened, that a business claim is true, or that the signer held the authority it claimed.</p></div>
  </>;
}

const CHAPTER_COMPONENTS = [ContextChapter, ActionChapter, RecordChapter, WitnessChapter, VerifyChapter];

export default function App() {
  const [reference, setReference] = useState(null);
  const [referenceError, setReferenceError] = useState('');
  const [scenario, setScenario] = useState('clean-settlement');
  const [witness, setWitness] = useState('local');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chapter, setChapter] = useState(0);
  const [technical, setTechnical] = useState(false);
  const [tamperTarget, setTamperTarget] = useState('capsule');
  const [tampered, setTampered] = useState(null);
  const [tamperBusy, setTamperBusy] = useState(false);
  const [tamperError, setTamperError] = useState('');
  const [imported, setImported] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const epoch = useRef(0);
  const fileInput = useRef(null);
  const runController = useRef(null);
  const copy = SCENARIO_COPY[scenario];

  useEffect(() => {
    const controller = new AbortController();
    setReferenceError('');
    api('/reference', undefined, controller.signal).then(setReference).catch((error) => {
      if (error.name !== 'AbortError') setReferenceError(error.message);
    });
    return () => controller.abort();
  }, [loadAttempt]);
  useEffect(() => () => { epoch.current += 1; runController.current?.abort(); }, []);

  function selectScenario(id) {
    epoch.current += 1;
    runController.current?.abort();
    setScenario(id); setResult(null); setChapter(0); setError(''); setBusy(false);
    setTampered(null); setTamperError(''); setTamperBusy(false);
  }
  async function run() {
    const token = ++epoch.current;
    runController.current?.abort();
    const controller = new AbortController();
    runController.current = controller;
    setBusy(true); setError(''); setResult(null); setTampered(null); setTamperError('');
    try {
      const data = await api('/run/' + scenario, { witness }, controller.signal);
      if (token !== epoch.current) return;
      setResult(data); setChapter(0);
    } catch (error) {
      if (token === epoch.current && error.name !== 'AbortError') setError(error.message);
    } finally { if (token === epoch.current) setBusy(false); }
  }
  async function tamper() {
    const token = epoch.current;
    setTamperBusy(true); setTamperError('');
    try {
      const data = await api('/runs/' + result.run_id + '/tamper', { target: tamperTarget });
      if (token === epoch.current) setTampered(data);
    } catch (error) { if (token === epoch.current) setTamperError(error.message); }
    finally { if (token === epoch.current) setTamperBusy(false); }
  }
  async function verifyFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportBusy(true); setImportError(''); setImported(null);
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Choose an evidence JSON file smaller than 4 MB.');
      const bundle = parseJson(await file.text());
      const verification = await api('/verify', bundle);
      setImported({ name: file.name, verification });
    } catch (error) { setImportError(error.message); }
    finally { setImportBusy(false); event.target.value = ''; }
  }

  const runtimeReady = reference?.cigar?.ready === true;
  const verified = result?.verification.ok;
  const witnessResult = witnessStatus(result);
  const ActiveChapter = CHAPTER_COMPONENTS[chapter];
  const amount = scenario === 'policy-block' ? '68400.00' : '48200.00';

  return <div className="proof-app">
    <a className="skip-link" href="#workspace">Skip to the interactive demo</a>
    <header className="proof-header">
      <a className="proof-brand" href="#top" aria-label="HOL home"><img className="hol-logo" src="/brand/hol-logo.png" alt="HOL" width="600" height="201" /></a>
      <div className="header-right"><span className="demo-label">INTERACTIVE DEMO</span><Status state={runtimeReady ? 'good' : 'idle'}>{reference ? (runtimeReady ? 'CIGAR 0.14.0 ready' : 'Runtime needs setup') : 'Connecting…'}</Status></div>
    </header>

    <main id="top">
      <section className="proof-hero">
        <div className="hero-editorial"><span className="section-label"><span className="mini-dot mint" /> GOVERNED CONTEXT. PORTABLE EVIDENCE.</span><h1>CIGAR <span>x AAC Demo</span></h1><p>Know what your agent knew, what it was allowed to do, and what actually happened. Then let someone else verify it.</p><div className="hero-technology"><span>CIGAR <small>governs context</small></span><b>+</b><span>AAC <small>seals evidence</small></span><b>+</b><span>SCITT / Hedera <small>witnesses history</small></span></div></div>
        <div className="transaction-card"><div className="transaction-top"><span>THE SCENARIO</span><span className="tiny-tag">Simulation</span></div><div className="transaction-amount">{money(amount)}<span>supplier payment</span></div><div className="transaction-parties"><div><span>FROM</span><strong>Northwind Industrial</strong></div><span aria-hidden="true">↗</span><div><span>TO</span><strong>Meridian Components</strong></div></div><div className="transaction-footer"><span className="mini-dot mint" /> €50,000 delegated limit <span>INV–2026–0918</span></div></div>
      </section>

      <DemoGuide />

      {referenceError && <div className="app-alert" role="alert"><strong>Couldn’t connect to the demo.</strong><p>{referenceError}</p><button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></div>}
      {reference && !runtimeReady && <div className="app-alert" role="alert"><strong>The CIGAR runtime needs setup.</strong><p>{reference.cigar.error}</p><button onClick={() => window.location.reload()}>Check again</button></div>}

      <section className="demo-workspace" id="workspace" aria-label="Interactive evidence demonstration">
        <aside className="scenario-rail"><div className="rail-heading"><span className="section-label">01 / PICK A SITUATION</span><h2>Same agent.<br />Different stakes.</h2></div><nav aria-label="Demo scenarios">{Object.entries(SCENARIO_COPY).map(([id, item], index) => <button key={id} className={'scenario-choice ' + (scenario === id ? 'selected' : '')} aria-pressed={scenario === id} onClick={() => selectScenario(id)} disabled={busy || tamperBusy}><span className="scenario-glyph" aria-hidden="true">{item.glyph}</span><span><strong>{item.label}</strong><small>{item.short}</small></span><span className="scenario-order">0{index + 1}</span></button>)}</nav><div className="rail-note"><span className="note-mark" aria-hidden="true">i</span><p>Real CIGAR execution.<br />Real signatures and proofs.<br />Simulated business activity.</p></div></aside>

        <div className="execution-space">
          <div className="scenario-intro"><div><span className="section-label">{copy.tag}</span><h2>{copy.question}</h2><p>{copy.body}</p></div><div className="run-controls"><label className="witness-picker">Witness<select aria-label="Witness mode" value={witness} onChange={(event) => { setWitness(event.target.value); setResult(null); setTampered(null); epoch.current += 1; }} disabled={busy || tamperBusy}><option value="local">Local · no network</option><option value="hedera" disabled={!reference?.hedera?.configured}>Hedera {reference?.hedera?.network ?? 'testnet'}{reference?.hedera?.configured ? '' : ' · not configured'}</option></select></label>{!reference?.hedera?.configured && <a className="hedera-setup-link" href="#hedera-setup" onClick={openHederaGuide}>Set up Hedera testnet ↗</a>}<button className="run-button" onClick={run} disabled={busy || tamperBusy || !runtimeReady}><span aria-hidden="true">{busy ? '◌' : '↗'}</span>{busy ? 'Executing scenario…' : result ? 'Run again' : 'Run this scenario'}</button></div></div>

          <div className="execution-note"><span className="mini-dot" /><span>{busy ? 'Running CIGAR, signing the evidence, and checking the result' + (witness === 'hedera' ? ' · publishing a digest to Hedera' : '') + '…' : witness === 'hedera' ? 'This run will publish a digest to Hedera ' + reference?.hedera?.network + '. Business content stays local.' : 'Runs locally. No bank transfer, live model, or public network submission.'}</span></div>
          {error && <div className="app-alert" role="alert"><strong>The run did not complete.</strong><p>{error}</p><span>Fix the reported issue, then run this scenario again.</span></div>}

          {!result && <div className={'ready-stage ' + (busy ? 'stage-busy' : '')} aria-live="polite"><div className="ready-orbit" aria-hidden="true"><span className="orbit-ring" /><span className="orbit-core">{busy ? '◌' : '↗'}</span><span className="orbit-node node-a">C</span><span className="orbit-node node-b">A</span><span className="orbit-node node-c">ℏ</span></div><h3>{busy ? 'Building a record you can check.' : 'One action. A complete chain of evidence.'}</h3><p>{busy ? 'The result will appear after execution and verification finish.' : 'Run the scenario, follow the evidence, then try changing a signed record.'}</p><div className="ready-steps">{CHAPTERS.map((step, index) => <React.Fragment key={step.verb}><span><b>0{index + 1}</b>{step.verb}</span>{index < 4 && <i aria-hidden="true">→</i>}</React.Fragment>)}</div></div>}

          {result && <>
            <div className={'outcome-banner ' + (verified ? '' : 'outcome-detected')} role="status"><span className="outcome-symbol" aria-hidden="true">{verified ? '✓' : '≠'}</span><div><strong>{copy.outcome}</strong><p>{copy.takeaway}</p></div><span className="outcome-count">{result.verification.summary.passed}/{result.verification.summary.total}<small>checks passed</small></span></div>
            <div className="evidence-toolbar"><span className="section-label">02 / FOLLOW THE EVIDENCE</span><Status state={witnessResult.state}>{witnessResult.label}</Status></div>
            <div className="chapter-tabs" role="tablist" aria-label="Evidence journey">{CHAPTERS.map((step, index) => <button id={'chapter-tab-' + index} role="tab" aria-selected={chapter === index} aria-controls="chapter-panel" tabIndex={chapter === index ? 0 : -1} key={step.title} className={chapter === index ? 'active' : ''} onClick={() => setChapter(index)} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + (event.key === 'ArrowRight' ? 1 : 4)) % 5; setChapter(next); document.getElementById('chapter-tab-' + next)?.focus(); } }}><span>0{index + 1}</span>{step.verb}<small>{step.owner}</small></button>)}</div>
            <div className="chapter-panel" id="chapter-panel" role="tabpanel" aria-labelledby={'chapter-tab-' + chapter}><ActiveChapter result={result} /></div>
            <div className="chapter-bottom"><span>{chapter + 1} of 5 · {CHAPTERS[chapter].title}</span><div><button className="quiet-button" disabled={chapter === 0} onClick={() => setChapter((step) => step - 1)}>← Back</button>{chapter < 4 ? <button className="next-button" onClick={() => setChapter((step) => step + 1)}>Next: {CHAPTERS[chapter + 1].verb.toLowerCase()} →</button> : <a className="next-button" href="#tamper-lab">Try changing the evidence ↓</a>}</div></div>
            <div className="evidence-actions"><a className="download-button" href={'/api/runs/' + result.run_id + '/bundle'} download>↓ Download this run’s evidence</a><button className="quiet-button" aria-expanded={technical} onClick={() => setTechnical((shown) => !shown)}>{technical ? 'Hide' : 'Inspect'} technical details {technical ? '−' : '+'}</button></div>
            {technical && <section className="technical-drawer" aria-label="Technical evidence"><h3>Executed with hol-cigar 0.14.0</h3><p>The native worker’s output travels with the evidence and is bound by the signed AUDIT reference. The verifier checks that binding without installing Python or CIGAR.</p><dl><dt>Context snapshot</dt><dd><code>{result.artifacts.cigar.compiled.context.snapshot.id}</code></dd><dt>Tokenizer</dt><dd>{result.artifacts.manifest.budget.tokenizer}</dd><dt>Review decision</dt><dd>{result.artifacts.cigar.assessment.assessment.decision} · fixture reviewer</dd><dt>Run</dt><dd><code>{result.run_id}</code></dd></dl><details><summary>Native CIGAR context and assessment</summary><pre>{JSON.stringify(result.artifacts.cigar, null, 2)}</pre></details><details><summary>Full portable evidence bundle</summary><pre>{JSON.stringify(result.bundle, null, 2)}</pre></details><details><summary>Recorded execution events ({result.events.length})</summary><pre>{JSON.stringify(result.events, null, 2)}</pre></details><p>Scenario timestamps are fixed for repeatability. Hedera consensus timestamps, when confirmed, come from the live network.</p></section>}
          </>}
        </div>
      </section>

      <section className="value-section" aria-label="The value of the three layers"><div className="value-heading"><span className="section-label">THE VALUE OF THE COMBINATION</span><h2>Control before.<br />Accountability after.</h2></div><article><span className="value-number">01</span><h3>CIGAR</h3><strong>Give autonomy a boundary.</strong><p>Compile authorized context, preserve source citations, enforce exact budgets, and bind reviews to the information actually used.</p></article><article><span className="value-number">02</span><h3>AAC</h3><strong>Make the action explainable.</strong><p>Package identity, authority, action and audit evidence into a signed record that can move between systems.</p></article><article><span className="value-number">03</span><h3>SCITT + Hedera</h3><strong>Make history independently visible.</strong><p>Witness the history’s fingerprint. A confirmed Hedera anchor adds a public consensus timestamp without publishing the business content.</p></article></section>

      <section className="experiment-grid">
        <div className="tamper-lab" id="tamper-lab"><span className="section-label">03 / DON’T TAKE OUR WORD FOR IT</span><h2>Change the story.<br />Watch the proof object.</h2><p>Edit a copy of this run’s evidence without signing it again. The original stays available for comparison.</p><div className="experiment-controls"><label>Change<select aria-label="Evidence field to tamper with" value={tamperTarget} onChange={(event) => { setTamperTarget(event.target.value); setTampered(null); }} disabled={!result || tamperBusy || busy}>{(reference?.tamper_targets ?? [{ id: 'capsule', label: 'The record: effect.status' }]).map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label><button onClick={tamper} disabled={!result || busy || tamperBusy} className="tamper-button">{tamperBusy ? 'Checking the edit…' : 'Edit & verify →'}</button></div>{!result && <span className="helper-text">Run a scenario above to unlock this experiment.</span>}{tamperError && <p className="app-alert" role="alert">{tamperError}</p>}{tampered && <div className="tamper-outcome" role="status"><Status state={tampered.after.ok ? 'warn' : 'bad'}>{tampered.after.ok ? 'No integrity failure detected' : 'Edit detected'}</Status><p>{tampered.applied.plain}</p><div className="edit-comparison"><div><span>BEFORE</span><code>{JSON.stringify(tampered.applied.before)}</code></div><span aria-hidden="true">→</span><div><span>AFTER</span><code>{JSON.stringify(tampered.applied.after)}</code></div></div><strong>{tampered.after.summary.failed} checks failed</strong><p>{tampered.after.summary.first_failure?.name}</p><details><summary>See the failed checks</summary>{tampered.after.checks.filter((check) => !check.ok).map((check, index) => <p key={index}><strong>{check.name}</strong><br />{check.detail}</p>)}</details></div>}</div>
        <div className="verify-file"><span className="section-label">TAKE THE EVIDENCE WITH YOU</span><h2>One file.<br />A second opinion.</h2><p>Download a run, then bring the JSON back here to recheck it. The verifier only needs the file; it does not need CIGAR or the run’s private state.</p><input type="file" accept=".json,application/json" ref={fileInput} onChange={verifyFile} className="file-input" aria-label="Upload an evidence bundle" /><button className="upload-button" onClick={() => fileInput.current?.click()} disabled={importBusy}>{importBusy ? 'Verifying file…' : '↑ Choose evidence JSON'}</button><span className="helper-text">Checked by this demo’s local server. Public Hedera confirmation is not repeated here.</span>{importError && <p className="app-alert" role="alert">{importError}</p>}{imported && <div className="import-result" role="status"><Status state={imported.verification.ok ? 'good' : 'bad'}>{imported.verification.ok ? 'Evidence verified' : 'Evidence rejected'}</Status><p>{imported.name}</p><strong>{imported.verification.summary.passed}/{imported.verification.summary.total} checks passed</strong><p>{imported.verification.summary.first_failure?.name}</p></div>}<details className="cli-instructions"><summary>Verify without this application</summary><p>From a copy of this repository, no server or network required:</p><code>node packages/verifier/src/cli.js evidence-bundle.json</code><p>Use <code>--online</code> to confirm an included anchor against a Hedera mirror node.</p></details></div>
      </section>

      <section className="scope-section"><span className="section-label">BUILT TO EXPLAIN, NOT OVERCLAIM</span><p>This demo runs <a href="https://pypi.org/project/hol-cigar/0.14.0/" target="_blank" rel="noreferrer">hol-cigar 0.14.0</a> with a scripted agent, fixture reviewer and simulated payment gateway. AAC, payload binding and local logging use a proposed interoperability profile. A local witness proves internal consistency; only a confirmed Hedera anchor adds a public timestamp. No result certifies business truth.</p></section>
    </main>
    <footer className="proof-footer"><strong>HOL · CIGAR x AAC Demo</strong><span>Useful autonomy needs checkable evidence.</span><a href="#top">Back to top ↑</a></footer>
  </div>;
}
