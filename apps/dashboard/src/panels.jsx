import React, { useContext, useState } from 'react';
import { Badge, Bytes, Card, Collapsible, Detail, DetailContext, Digest, Json, KV, Meter, Scope, Stat, Term } from './ui.jsx';
import { CHECK_GROUPS } from './teaching.js';
import { EffectLifecycle, MmrForest, Slots } from './viz.jsx';

/* =================================================================== */
/* 1. SOURCES                                                          */
/* =================================================================== */
export function SourcesPanel({ result }) {
  const { artifacts } = result;
  const manifest = artifacts.manifest;
  const excludedBy = new Map(manifest.excluded.map((e) => [e.source_id, e]));
  const selectedBy = new Map(manifest.selected.map((s) => [s.source_id, s]));

  return (
    <Card
      eyebrow="Evidence · the selection manifest"
      title="What the policy gate decided about each source"
      family="cigar"
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 18 }}>
        <Stat value={manifest.considered.length} label="Considered" />
        <Stat value={manifest.selected.length} label="Selected" tone="good" />
        <Stat value={manifest.excluded.length} label="Excluded" tone="bad" />
        <Stat
          value={manifest.evidence_satisfied ? 'Yes' : 'No'}
          label="Required evidence met"
          tone={manifest.evidence_satisfied ? 'good' : 'bad'}
          sub={manifest.required_evidence.join(', ')}
        />
      </div>

      <Detail
        label={`All ${manifest.considered.length} sources, and the verdict on each`}
        hint="Every source considered, the rule that admitted or excluded it, and why."
      >
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Type</th>
            <th><Term of="trust floor">Authority</Term></th>
            <th>Verdict</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {manifest.considered.map((c) => {
            const ex = excludedBy.get(c.source_id);
            const sel = selectedBy.get(c.source_id);
            return (
              <tr key={c.source_id} className={ex ? 'excluded' : 'selected'}>
                <td className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{c.source_id}</td>
                <td>{c.record_type}</td>
                <td>
                  {c.authority}
                  {c.verification_state !== 'verified' && (
                    <div style={{ marginTop: 3 }}><Badge state="warn">unverified</Badge></div>
                  )}
                </td>
                <td>
                  {ex ? <Badge state="bad">excluded</Badge> : <Badge state="good">selected</Badge>}
                  {ex && <div className="mono" style={{ fontSize: 11, marginTop: 4, color: 'var(--ink-3)' }}>{ex.rule}</div>}
                  {sel && <div className="mono" style={{ fontSize: 11, marginTop: 4, color: 'var(--ink-3)' }}>rank {sel.rank}</div>}
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{ex ? ex.reason : sel?.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      </Detail>

      <Detail label="Budget, transformations and what could invalidate this" hint="How much context was spent, what was reshaped on the way in, and the conditions that would make this answer wrong later.">
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="grid" style={{ gap: 12 }}>
          <Meter
            value={manifest.budget.records_charged}
            limit={manifest.budget.records_limit}
            label="Budget: records"
          />
          <Meter
            value={manifest.budget.tokens_charged}
            limit={manifest.budget.tokens_limit}
            label="Budget: tokens"
          />
          {manifest.transformations.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Transformations applied on the way in</div>
              {manifest.transformations.map((t) => (
                <div key={t.source_id} style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  <span className="mono" style={{ fontSize: 12 }}>{t.transform}</span> — {t.note}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>What could invalidate this result</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)' }}>
            {manifest.invalidators.map((i) => <li key={i.condition}>{i.condition}</li>)}
          </ul>
        </div>
      </div>

      </Detail>

      <Detail label="Digests and canonical bytes" hint="What each artifact hashes to, and the exact bytes behind it.">
      <div className="grid" style={{ gap: 10 }}>
        <KV rows={[
          ['snapshot digest', <Digest value={artifacts.snapshot.snapshot_digest} chars={16} />],
          [<Term of="SelectionManifest">selection manifest</Term>, <Digest value={manifest.manifest_digest} chars={16} />],
          [<Term of="ContextBundle">context bundle</Term>, <Digest value={artifacts.contextBundle.bundle_digest} chars={16} />],
          ['decision environment', <Digest value={artifacts.environment.env_digest} chars={16} />],
        ]} />
        <div className="row wrap" style={{ gap: 8 }}>
          <Bytes label="context contract"><Json value={artifacts.contract} /></Bytes>
          <Bytes label="selection manifest"><Json value={manifest} /></Bytes>
          <Bytes label="context bundle (what the agent actually saw)"><Json value={artifacts.contextBundle} /></Bytes>
          <Bytes label="decision environment"><Json value={artifacts.environment} /></Bytes>
        </div>
      </div>
      </Detail>
    </Card>
  );
}

/* =================================================================== */
/* 2. AUTHORITY + ACTION                                               */
/* =================================================================== */
export function ActionPanel({ result }) {
  const { artifacts } = result;
  const handoff = artifacts.handoff.handoff;
  const ledger = artifacts.effectLedger.ledger;
  const decision = result.events.find((e) => e.kind === 'decision.made')?.decision;
  const authChecks = result.events.filter((e) => e.kind === 'effect.authorization_check');

  return (
    <>
      <Card
        eyebrow="Evidence · the signed handoff"
        title="Exactly what was delegated"
        family="cigar"
        sub="Authority is intersected during delegation, never transferred unrestricted. A child agent can never hold more than its parent held."
        right={<Badge state="cigar">signed handoff</Badge>}
      >
        <p className="note">
          This signed handoff is what the AAC record cites as its <strong>CAN</strong> member —
          byte-identically, never re-minted. That is the brief&rsquo;s &ldquo;authority
          mapping&rdquo; question answered by construction.
        </p>

        <Detail label="Exactly what was granted, refused and capped" hint="The capability intersection, the ceiling, and who imposed it.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Granted</div>
            <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
              {handoff.granted_capabilities.map((c) => (
                <Badge key={c} state="good">{c}</Badge>
              ))}
            </div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Refused — asked for, not held by the delegator</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {handoff.refused_capabilities.length === 0
                ? <span className="sub">none</span>
                : handoff.refused_capabilities.map((c) => <Badge key={c} state="bad">{c}</Badge>)}
            </div>
          </div>
          <KV rows={[
            ['recipient', handoff.recipient],
            ['issuer', handoff.issuer],
            ['ceiling', `${handoff.budget.amount_max} ${handoff.budget.currency} (capped by ${handoff.budget.capped_by})`],
            ['expiry', handoff.expiry],
            [<Term of="handoff">derivation</Term>, handoff.authority_derivation.rule],
            ['digest', <Digest value={artifacts.handoff.digest} chars={16} />],
          ]} />
        </div>


        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <Bytes label="signed handoff"><Json value={handoff} /></Bytes>
          <Bytes label="canonical bytes (jcs-n)"><pre>{artifacts.handoff.canonical}</pre></Bytes>
        </div>
        </Detail>
      </Card>

      <Card
        eyebrow="Evidence · the effect ledger"
        title="Every state the payment passed through"
        family="cigar"
        sub="Every transition is appended and hash-chained. Nothing is rewritten, so a correction is a new event rather than an edit."
        right={<Badge state={ledger.terminal_state === 'refused' ? 'bad' : ledger.terminal_state === 'unknown' ? 'warn' : 'good'}>
          {ledger.terminal_state}
        </Badge>}
      >
        {decision && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 18 }}>
            <Stat value={decision.invoice} label="Invoice" />
            <Stat value={`${decision.amount}`} label={`Amount (${decision.currency})`} />
            <Stat value={ledger.intent.irreversibility_class.replace(/_/g, ' ')} label={<Term of="irreversibility_class">Irreversibility</Term>} tone="warn" />
            <Stat value={ledger.intent.risk_level} label="Risk level" tone="warn" />
          </div>
        )}

        <EffectLifecycle transitions={ledger.transitions} />

        <Detail label="Authority checks, the intent, and the hash chain" hint="What was verified before dispatch, and every appended transition.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Authority checks before dispatch</div>
            {authChecks.map((c) => (
              <div key={c.name} className="row" style={{ gap: 8, padding: '4px 0', fontSize: 13 }}>
                <Badge state={c.ok ? 'good' : 'bad'}>{c.ok ? 'pass' : 'fail'}</Badge>
                <span style={{ color: 'var(--ink-2)' }}>{c.name}</span>
              </div>
            ))}
          </div>
          <KV rows={[
            ['effect type', ledger.intent.effect_type],
            ['target', ledger.intent.target],
            ['idempotency key', ledger.intent.idempotency_key],
            ['retry policy', ledger.intent.retry_policy?.note],
            ['chain length', `${ledger.transitions.length} transitions`],
            ['chain intact', <Badge state={result.artifacts.effectChain.ok ? 'good' : 'bad'}>
              {result.artifacts.effectChain.ok ? 'verified' : 'broken'}
            </Badge>],
          ]} />
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <Bytes label="effect intent"><Json value={ledger.intent} /></Bytes>
          <Bytes label="hash-chained transitions"><Json value={ledger.transitions} /></Bytes>
        </div>
        </Detail>
      </Card>
    </>
  );
}

/* =================================================================== */
/* 3. THE RECORD                                                       */
/* =================================================================== */
export function RecordPanel({ result }) {
  const [activeCapsule, setActiveCapsule] = useState(0);
  const [activeSlot, setActiveSlot] = useState('can');
  const capsules = result.bundle.capsules;
  const item = capsules[Math.min(activeCapsule, capsules.length - 1)];
  const capsule = item.capsule;
  const member = item.members.find((m) => m.slot === activeSlot);

  return (
    <Card
      eyebrow="Evidence · the sealed record"
      title="The capsule, slot by slot"
      family="aac"
      sub="Members are referenced by canonical digest, never inlined. The capsule stays small and content-private; the artifacts stay where they were."
      right={<Badge state="aac">{capsule.format_version === '4' ? 'format 4' : capsule.format_version}</Badge>}
    >
      {capsules.length > 1 && (
        <div className="tabs" style={{ marginBottom: 16 }}>
          {capsules.map((c, i) => (
            <button
              key={c.capsule.capsule_id}
              aria-selected={i === activeCapsule}
              onClick={() => setActiveCapsule(i)}
            >
              {i + 1}. {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 18 }}>
        <Stat
          value={capsule.disposition?.decision ?? '—'}
          label="Decision"
          tone={capsule.disposition?.decision === 'accept' ? 'good' : 'bad'}
        />
        <Stat
          value={capsule.disposition?.verdict_class ?? '—'}
          label={<Term of="verdict_class">Verdict class</Term>}
          tone={['blocked', 'denied', 'timeout'].includes(capsule.disposition?.verdict_class) ? 'warn' : 'good'}
        />
        <Stat
          value={capsule.effect?.status ?? 'none'}
          label="Effect status"
          tone={capsule.effect?.status === 'confirmed' ? 'good' : capsule.effect?.status === 'dispatched' ? 'warn' : 'neutral'}
          sub={capsule.effect?.response_digest ? 'response observed' : 'no response_digest'}
        />
        <Stat
          value={capsule.disposition?.human_disposed ? 'human' : (capsule.disposition?.approver ?? '—')}
          label="Approver"
          sub={capsule.disposition?.human_disposed ? 'a human actually acted' : 'no human claimed'}
        />
      </div>

      <div className="eyebrow" style={{ marginBottom: 8 }}>
        seal( who · can · did · audit ) — four <Term of="slot">slots</Term>, one capsule
      </div>
      <Slots members={item.members} active={activeSlot} onSelect={setActiveSlot} />

      {member && (
        <div className="fade-in" style={{ marginTop: 16, padding: 16, background: 'var(--surface-sunken)', borderRadius: 8, border: '1px solid var(--rule)' }}>
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <strong className="mono" style={{ color: 'var(--aac)' }}>{member.slot.toUpperCase()}</strong>
            <Badge state="aac">{member.type}</Badge>
            {member.type.startsWith('cigar-') && <Badge state="proposed">proposed artifact type</Badge>}
            {member.slot === 'can' && <Badge state="good">cited byte-identically, not re-minted</Badge>}
          </div>
          <KV rows={[
            [<Term of="typed digest reference">reference</Term>, <code style={{ fontSize: 12 }}>{JSON.stringify(member.ref)}</code>],
          ]} />
          <div style={{ marginTop: 10 }}>
            <Bytes label="member artifact" defaultOpen><Json value={member.artifact} max={300} /></Bytes>
          </div>
        </div>
      )}

      <Detail label="The capsule itself, its digest context and its signature" hint="Field by field, plus the COSE_Sign1 envelope and the exact bytes signed.">
      <div className="grid" style={{ gap: 12 }}>
        <KV rows={[
          [<Term of="capsule_id">capsule_id</Term>, <Digest value={capsule.capsule_id} chars={24} />],
          ['digest context', `${item.digest_context.algorithm}, exclusion set {${item.digest_context.exclusion_set.join(', ')}}, ${item.digest_context.preimage_bytes} canonical bytes`],
          ['action', `${capsule.action_id} · ${capsule.action_type}`],
          ['operator / developer', `${capsule.operator} · ${capsule.developer}`],
          ['assurance', capsule.assurance
            ? `${capsule.assurance.attestation_mode} · ${capsule.assurance.effect_mode} · ${capsule.assurance.ledger_mode}${capsule.assurance.cross_party_rung ? ` · ${capsule.assurance.cross_party_rung}` : ''}`
            : '—'],
          capsule.chain && ['chain', `${capsule.chain.relation} → ${capsule.chain.parent_capsule_id.slice(0, 16)}…`],
        ]} />
        <div className="row wrap" style={{ gap: 8 }}>
          <Bytes label="the capsule"><Json value={capsule} /></Bytes>
          <Bytes label="COSE_Sign1 envelope">
            <KV rows={[
              ['alg', 'EdDSA (-8)'],
              ['content_type', 'application/agent-action-capsule-id'],
              ['kid (raw Ed25519 key)', <Digest value={result.bundle.keys.agent_kid} chars={24} />],
              ['payload', `the raw 32 bytes of capsule_id, not its 64 hex characters`],
              ['base64', <span style={{ wordBreak: 'break-all', fontSize: 11 }}>{item.cose_sign1_b64}</span>],
            ]} />
          </Bytes>
        </div>
      </div>
      </Detail>
    </Card>
  );
}

/* =================================================================== */
/* 4. LOG + WITNESS                                                    */
/* =================================================================== */
/**
 * Hedera reports consensus time as "seconds.nanoseconds" since the epoch.
 * Keep the exact value for anyone re-checking, and add a form a person reads.
 */
function consensusHuman(ts) {
  const [sec, nanos = '0'] = String(ts ?? '').split('.');
  const ms = Number(sec) * 1000 + Math.floor(Number(nanos.padEnd(9, '0').slice(0, 3)));
  if (!Number.isFinite(ms)) return String(ts);
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function LogPanel({ result }) {
  const [leaf, setLeaf] = useState(0);
  const { artifacts, bundle } = result;
  const cp = artifacts.cll.checkpoint;
  const scitt = artifacts.scitt;
  const receipt = bundle.scitt?.receipt;

  const anchor = bundle.scitt?.hedera ?? null;
  const anchorConfirmed = Boolean(result.verification?.summary?.public_anchor?.confirmed);
  // Scope text is computed server-side and travels in the bundle: the
  // dashboard must not import a package that pulls in node:crypto.
  const anchorScope = bundle.scitt?.hedera_scope ?? null;
  const anchoredMessage = anchor
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(atob(anchor.message_b64)), null, 2);
        } catch {
          return anchor.message_b64;
        }
      })()
    : null;

  return (
    <>
      <Card
        eyebrow="Evidence · the local log"
        title="The log, and the checkpoint that leaves it"
        family="aac"
        sub="The log is a forest, not a tree. Appending is O(log n) and never restructures an earlier leaf, so a leaf's index is fixed permanently."
        right={<Badge state="aac"><Term of="MMR">MMR</Term> · SHA-256</Badge>}
      >
        <MmrForest mmr={artifacts.cll.mmr} highlightLeaf={leaf} entries={artifacts.cll.entries} />

        {artifacts.cll.entries.length > 1 && (
          <div className="row wrap" style={{ gap: 6, marginTop: 14 }}>
            <span className="eyebrow" style={{ marginRight: 4 }}>highlight leaf</span>
            {artifacts.cll.entries.map((e) => (
              <button
                key={e.leaf_index}
                className={leaf === e.leaf_index ? 'primary' : ''}
                style={{ padding: '3px 10px', fontSize: 13 }}
                onClick={() => setLeaf(e.leaf_index)}
              >
                {e.leaf_index}
              </button>
            ))}
          </div>
        )}

        <Detail label="Checkpoint claims, proofs, and what each layer proves" hint="The signed commitment field by field, the inclusion proof, and which guarantee comes from where.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}><Term of="checkpoint">Checkpoint</Term> claims</div>
            <KV rows={[
              ['kind', cp.claims.kind],
              ['log_size', String(cp.claims.log_size)],
              ['commitment', <Digest value={cp.claims.commitment} chars={20} />],
              ['prev_size', String(cp.claims.prev_size)],
              ['prev_commitment', cp.claims.prev_commitment ? <Digest value={cp.claims.prev_commitment} chars={16} /> : 'null (first checkpoint)'],
              ['issued_at', cp.claims.issued_at],
              ['cadence', cp.claims.cadence],
            ]} />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>What each layer proves</div>
            {result.reference.proof_sources.map((p) => (
              <div key={p.from} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 650 }}>from {p.from}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{p.proves.join(' · ')}</div>
              </div>
            ))}
            <p className="note" style={{ marginTop: 6 }}>
              Entry content stays local. The payee account number is bound by digest and never
              travels — check the bytes below and it is not there.
            </p>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <Bytes label="log entries (ids and leaf hashes only)"><Json value={artifacts.cll.entries} /></Bytes>
          <Bytes label="inclusion proof for the highlighted leaf">
            <Json value={bundle.capsules.find((c) => c.cll.leaf_index === leaf)?.cll.proof ?? {}} />
          </Bytes>
        </div>
        </Detail>
      </Card>

      <Card
        eyebrow="Evidence · the witness receipt"
        title="The spec-shaped receipt (RFC 9942)"
        family="aac"
        claim={scitt.registered ? undefined : `Refused: ${scitt.reason}`}
        sub="No new protocol. A statement is registered and a receipt is read. The receipt is a second COSE_Sign1, signed by the service, over a verifiable-data-structure proof."
        right={<Badge state={scitt.registered ? 'good' : 'bad'}>{scitt.registered ? 'witnessed' : 'refused'}</Badge>}
      >
        <Detail label="Registration policy and the receipt, field by field" hint="What the witness checked without parsing the payload, and what the receipt carries.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Registration policy — evaluated on the header alone</div>
            {scitt.policy?.checks?.map((c) => (
              <div key={c.name} className="row" style={{ gap: 8, padding: '3px 0', fontSize: 13 }}>
                <Badge state={c.ok ? 'good' : 'bad'}>{c.ok ? 'pass' : 'fail'}</Badge>
                <span style={{ color: 'var(--ink-2)' }}>{c.name}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.detail}</span>
              </div>
            ))}
            <p className="note" style={{ marginTop: 10 }}>
              The witness never parsed the payload. A witness that had to understand payloads would
              need a parser for every profile that ever registers with it.
            </p>
          </div>
          {receipt && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}><Term of="receipt">Receipt</Term></div>
              <KV rows={[
                ['service', receipt.service_id],
                ['published root', <Digest value={receipt.root} chars={20} />],
                ['leaf / log size', `${receipt.leaf_index} of ${receipt.log_size}`],
                ['registered at', receipt.registered_at],
                ['vds (label 395)', receipt.vds],
                ['vdp (label 396)', 'inclusion proof at entry -1'],
                ['size', `${receipt.bytes} bytes`],
              ]} />
            </div>
          )}
        </div>

        </Detail>

        {scitt.scope && (
          <div style={{ marginTop: 18 }}>
            <Scope
              establishes={scitt.scope.establishes}
              doesNotEstablish={scitt.scope.doesNotEstablish}
              note="A receipt never says the claim is true. Only that it was registered, and by when."
            />
          </div>
        )}
      </Card>

      {anchor && (
        <Card
          eyebrow={`Evidence \u00b7 the public anchor on Hedera ${anchor.network}`}
          title="A timestamp that is not ours to give"
          family="aac"
          sub="This is what a witness is for: contemporaneity and non-equivocation from a party with no stake in the record. We cannot backdate it, reorder it, or quietly drop it."
          right={<Badge state={anchorConfirmed ? 'good' : 'warn'}>{anchorConfirmed ? 're-read and confirmed' : 'submitted'}</Badge>}
        >
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 18, marginBottom: 16 }}>
            <Stat value={anchor.sequence_number} label="Topic sequence" />
            <Stat value={`${anchor.message_bytes} B`} label="Published" sub="digests only" />
            <Stat value={anchor.network} label="Network" />
            <Stat
              value={anchorConfirmed ? 'Yes' : 'Not yet'}
              label="Re-read from a mirror node"
              tone={anchorConfirmed ? 'good' : 'warn'}
            />
          </div>

          <p className="note">
            <strong>Exactly these bytes went onto a public network.</strong> Read them and
            satisfy yourself that the invoice number, the amount, the payee and the account
            number are not among them.
          </p>
          <pre style={{ marginTop: 10 }}>{anchoredMessage}</pre>

          <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
            <a href={anchor.explorer_url} target="_blank" rel="noreferrer"><button>View the topic on HashScan</button></a>
            <a href={anchor.mirror_url} target="_blank" rel="noreferrer"><button className="ghost">Fetch this message from a mirror node</button></a>
          </div>

          <div style={{ marginTop: 16 }}>
            <Detail label="Consensus coordinates and how to re-check them" hint="Everything needed to confirm this independently.">
              <KV rows={[
                ['topic', anchor.topic_id],
                ['sequence number', String(anchor.sequence_number)],
                ['consensus timestamp', `${anchor.consensus_timestamp}  (${consensusHuman(anchor.consensus_timestamp)})`],
                ['running hash', <span style={{ wordBreak: 'break-all' }}>{anchor.running_hash}</span>],
                ['transaction', anchor.transaction_id],
                ['declared vds', `${anchor.vds} \u2014 PROPOSED, not IETF-registered`],
                ['mirror url', <span style={{ wordBreak: 'break-all' }}>{anchor.mirror_url}</span>],
              ]} />
            </Detail>
          </div>

          <p className="note caution" style={{ marginTop: 14 }}>
            <strong>Not an RFC 9942 receipt.</strong> There is no COSE_Sign1 over a Merkle
            inclusion proof here; the verifiable data structure is consensus ordering plus a
            running hash. The spec-shaped receipt above still does that job, offline. These are
            two different guarantees and the bundle carries both.
          </p>

          {anchorScope && (
            <div style={{ marginTop: 16 }}>
              <Scope establishes={anchorScope.establishes} doesNotEstablish={anchorScope.doesNotEstablish} />
            </div>
          )}
        </Card>
      )}

      {result.bundle.scitt?.hedera_error && (
        <Card
          eyebrow="Public anchor"
          title="Hedera anchoring was unavailable this run"
          claim={result.bundle.scitt.hedera_error}
          sub="The run is complete and still verifies against the local transparency service. The failure is recorded rather than hidden, because a demo that silently degrades is a demo that lies about what it just proved."
          right={<Badge state="warn">local witness only</Badge>}
        />
      )}
    </>
  );
}

/* =================================================================== */
/* 5. THE VERIFIER                                                     */
/* =================================================================== */
export function VerifyPanel({ result, visibleChecks }) {
  const v = result.verification;
  const streaming = Boolean(visibleChecks);
  const checks = visibleChecks ?? v.checks;
  const replay = result.artifacts.replay;
  // In technical density the groups open with everything else; a failure
  // always opens its group regardless.
  const technical = useContext(DetailContext);

  // While checks are still arriving, the tiles must reflect what has actually
  // been seen. Showing the final counts next to a half-filled list gives the
  // answer away before the audience has watched it being reached.
  const summary = streaming
    ? {
        passed: checks.filter((c) => c.ok).length,
        failed: checks.filter((c) => !c.ok).length,
        total: v.summary.total,
        records: v.summary.records,
        log_size: v.summary.log_size,
        witnessed: v.summary.witnessed,
        first_failure: checks.find((c) => !c.ok) ?? null,
      }
    : v.summary;

  return (
    <>
      <Card
        eyebrow="Evidence · the independent verifier"
        title={streaming ? 'Checking\u2026' : 'Every check, grouped by what it proves'}
        sub={result.verification.verifier.independence}
        right={
          streaming
            ? <Badge state={summary.failed ? 'bad' : 'idle'}>verifying</Badge>
            : <Badge state={v.ok ? 'good' : 'bad'}>{v.ok ? 'PASS' : 'FAIL'}</Badge>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, marginBottom: 18 }}>
          <Stat
            value={streaming ? `${summary.passed}/${summary.total}` : summary.passed}
            label="Checks passed"
            tone="good"
          />
          <Stat value={summary.failed} label="Checks failed" tone={summary.failed ? 'bad' : 'neutral'} />
          <Stat value={summary.records} label="Records" />
          <Stat value={summary.log_size} label="Log size" />
          <Stat
            value={summary.witnessed ? 'Yes' : 'No'}
            label="Witnessed"
            tone={summary.witnessed ? 'good' : 'warn'}
          />
        </div>

        {/*
          Grouped rather than listed. Forty-eight rows is a wall; five questions
          with counts is something a reader can triage. Groups that passed stay
          shut, groups with a failure open themselves.
        */}
        <div className="grid" style={{ gap: 9 }}>
          {CHECK_GROUPS.map((group) => {
            const mine = checks.filter((c) => group.ids.includes(c.id));
            if (mine.length === 0) return null;
            const failed = mine.filter((c) => !c.ok);
            return (
              <Collapsible
                key={group.title}
                title={group.title}
                subtitle={group.plain}
                defaultOpen={failed.length > 0 || technical}
                tone={failed.length ? 'bad' : 'good'}
                right={
                  <Badge state={failed.length ? 'bad' : 'good'}>
                    {failed.length ? `${failed.length} of ${mine.length} failed` : `${mine.length} passed`}
                  </Badge>
                }
              >
                {mine.map((c, i) => (
                  <div
                    key={`${c.name}-${i}`}
                    className="fade-in"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 10,
                      padding: '6px 10px',
                      borderLeft: `3px solid ${c.ok ? 'var(--good)' : 'var(--critical)'}`,
                      background: c.ok ? 'transparent' : 'color-mix(in srgb, var(--critical) 8%, transparent)',
                      marginBottom: 3,
                    }}
                  >
                    <Badge state={c.ok ? 'good' : 'bad'}>{c.ok ? 'pass' : 'fail'}</Badge>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 550 }}>
                        {c.name}{' '}
                        {c.proposed && <Badge state="proposed">proposed type</Badge>}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2 }}>{c.detail}</div>
                      {!c.ok && c.expected && c.computed && (
                        <div className="mono" style={{ fontSize: 11.5, marginTop: 5 }}>
                          <div style={{ color: 'var(--critical-inkable)' }}>expected {c.expected}</div>
                          <div style={{ color: 'var(--critical-inkable)' }}>computed {c.computed}</div>
                        </div>
                      )}
                      {c.canonical && (
                        <div style={{ marginTop: 6 }}>
                          <Bytes label="canonical preimage"><pre style={{ maxHeight: 180 }}>{c.canonical}</pre></Bytes>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </Collapsible>
            );
          })}
        </div>

        {!streaming && (
          <div style={{ marginTop: 18 }}>
            <Scope establishes={v.scope.establishes} doesNotEstablish={v.scope.doesNotEstablish} note={v.scope.note} />
          </div>
        )}
      </Card>

      <Card
        eyebrow="Evidence · CIGAR replay"
        title="Replay the decision environment"
        family="cigar"
        claim={replay.ok
          ? 'The declared inputs still hash to what the decision environment recorded. Context and selection can be reconstructed.'
          : 'Replay FAILED: a captured artifact no longer matches its recorded digest.'}
        sub="Replay reconstructs the declared environment. It does not re-run the model, and it never captures chain-of-thought."
        right={<Badge state={replay.ok ? 'good' : 'bad'}>{replay.ok ? 'replays clean' : 'mismatch'}</Badge>}
      >
        <Detail label={`All ${replay.checks.length} recomputed digests`} hint="Each captured artifact, rehashed and compared.">
          {replay.checks.map((c) => (
            <div key={c.name} className="row" style={{ gap: 10, padding: '4px 0', fontSize: 13.5 }}>
              <Badge state={c.ok ? 'good' : 'bad'}>{c.ok ? 'match' : 'differs'}</Badge>
              <span style={{ minWidth: 210 }}>{c.name}</span>
              <Digest value={c.computed} chars={16} />
            </div>
          ))}
        </Detail>
        <div style={{ marginTop: 14 }}>
          <Scope establishes={replay.scope.establishes} doesNotEstablish={replay.scope.doesNotEstablish} />
        </div>
      </Card>
    </>
  );
}
