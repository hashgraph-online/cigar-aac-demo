# Technical PRD — CIGAR + AAC Minimal Interop Profile Demo

> Historical design record. For current HOL behavior, AAC draft 5 rules and
> verification boundaries, see [AAC integration](AAC-DRAFT-05.md) and the
> [active code walkthrough](CODE-WALKTHROUGH.md). Earlier design choices below
> are preserved as background and may differ from the implementation.

**Status:** Alpha build spec
**Date:** 2026-09-21
**Source of requirements:** `CIGAR_AAC_AAIF_3_Page_Brief.pdf` (AAIF Discussion Primer, September 2026)
**Audience for the artifact:** Linux Foundation / Agentic AI Foundation (AAIF) Security Working Group — technical and non-technical attendees in the same room.

> **Implementation update, 2026-09-28:** This document preserves the original
> design and protocol choices. The active context path now executes the published
> `hol-cigar==0.14.0` Python package and its bundled native worker. The source
> view, graph closure, exact token budget and review checks are native; business
> policy and payment execution remain demo fixtures. The old local-model compiler
> is no longer used by the scenario engine. Current behavior and UI instructions
> are in [UPGRADE-0.14.0.md](UPGRADE-0.14.0.md), [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md)
> and [PRESENTING.md](PRESENTING.md). Local is the default witness mode; only an
> explicitly selected Hedera run publishes, and downloads never resubmit.

---

## 1. Why this exists

The source brief is a *discussion primer*. It argues a thesis and then ends with an explicit invitation:

> **Suggested next step:** Define one minimal interop profile: CIGAR governs context + one effect; AAC references the resulting artifacts; CLL checkpoints them; SCITT optionally witnesses the checkpoint; an independent verifier checks the record without needing CIGAR internals.

**This project builds exactly that sentence and makes it executable.**

The brief's thesis is that CIGAR and the AAC family solve adjacent halves of one accountability problem:

- **CIGAR** (Context Intelligence Graph Agentic Runtime) governs *the decision environment that produces an action* — which sources were authorized, what was selected and excluded, what policy and budget applied, what authority was delegated, and what happened to the effect afterward.
- **The AAC family** makes *the resulting record* portable, canonically bound, tamper-evident and independently witnessable — AAC for the record, CPB for the digest, CLL for the log, SCITT for the witness.

The primer asserts these compose. Nobody has demonstrated it running. A slide deck cannot answer the fourth question on page 1 — *"Can another party verify it later?"* — because the only honest answer to that question is a verifier you can watch succeed and watch fail.

### 1.1 The gap this demo closes

| The brief says | The demo must show |
|---|---|
| "AAC should reference, rather than duplicate, CIGAR artifacts" | A capsule whose CAN member is the *byte-identical* CIGAR handoff, cited by typed digest, never re-minted |
| "Preserve uncertainty instead of flattening an attempt into a completed action" | A live `dispatched` → `UNKNOWN` → reconciled → compensated transition, with `confirmed` structurally unreachable until a response is observed |
| "Independent systems identify the same artifacts, detect rewriting and verify a witness receipt" | A verifier process with **no code path into CIGAR**, that passes on a clean bundle and fails with a named digest mismatch on a tampered one |
| "Selective disclosure with externally verifiable commitments" | An evidence bundle carrying digests and proofs, with `withheld[]` declaring what was deliberately not disclosed, still verifying |

### 1.2 Non-goals

This is explicitly **not**:

- A proposed AAIF architecture, or a claim that any mapping here is normative. The brief marks its own artifact mapping with "*Proposed integration point for discussion, not a normative mapping in the current drafts*" and this demo inherits that caveat, visibly, in the UI.
- A production implementation of any of the seven Internet-Drafts involved. It is a *conformant-in-structure* reference that makes the seam testable.
- A merger of the specifications. The brief's framing — "Test the seam without merging the specifications or expanding either layer beyond its core purpose" — is a design constraint on this codebase, enforced by module boundaries (§5.6).
- A re-implementation of the published CIGAR context engine. The current demo executes **hol-cigar 0.14.0** for context and review binding. The original local compiler remains a tested reference; application policy, handoff and effect helpers remain a demo profile.

---

## 2. Grounding: what the specs actually say

Everything in this section was verified against primary sources during design, and it is what the implementation must match. Deviations are tracked in §9.

### 2.1 CIGAR — Context Intelligence Graph Agentic Runtime

Five-stage context compilation:

1. **Ingest immutable source state** — sources become typed records (claims, symbols, instructions, decisions, evidence) with provenance.
2. **Apply a context contract** — caller declares purpose, constraints, required evidence, target consumer, budget. **Policy evaluation happens before retrieval**, not after.
3. **Retrieve, reconcile, pack** — approved retrievers produce candidates; the compiler reconciles conflicts using source authority, validity time and verification status.
4. **Materialize for the consumer** — the semantic bundle renders into an approved format.
5. **Capture the decision environment** — task, context contract, selection manifest, bundle, policies, component versions, observations bound together.

Key artifacts:
- **ContextBundle** — the information actually delivered to the model/agent.
- **SelectionManifest** — what was considered, selected, excluded, which transformations applied, and what could invalidate the result.

External effect lifecycle. Before dispatch, an **effect intent** records: target, protected arguments, preconditions, expected result, originating decision, authorization, risk level, retry policy, idempotency identity. States run intent → authorization → dispatch → observation, with an **`UNKNOWN`** state when the result is ambiguous, then reconciliation and possible compensation. **Transitions are append-only and hash-chained.**

Delegation: a child agent receives a **signed, scoped handoff capsule** naming recipient, task, acceptance criteria, requested capabilities, budget and expiry. Authority is **intersected during delegation, not transferred unrestricted**.

### 2.2 AAC — Agent Action Capsule (`draft-mih-scitt-agent-action-capsule`)

A digest-committed record of one agent action. Recorded **on every verdict, including refusals** — a blocked or denied capsule is the auditor-grade evidence that a gate worked.

Required top-level fields: `spec_version`, `format_version` (`"4"`), `canonicalization_id` (`"jcs"` for format 4), `capsule_id` (64 lowercase hex), `action_id`, `action_type` (`"fyi"` | `"decide"`), `operator` (accountable tenant), `developer` (agent identity + version), `timestamp` (RFC 3339 UTC).

Optional: `epoch_id`, `disposition`, `effect`, `assurance`, `chain`, `references`, `cross_party`.

**`disposition`** — required `decision` (`accept` | `reject` | `needs_input` | `deferred`), `approver` (closed enum: `human` | `policy` | `counterparty`), `human_disposed` (boolean). Optional `verdict_class`, `reason_digest`, `authority`, `expiry_policy`.

**`verdict_class`** vocabulary: `executed`, `blocked`, `hitl_dispatched`, `denied`, `timeout`, `errored`, `engine_failure`, `deferred`, `needs_decision`, `expired`, `escalated`, `resolved`, `epoch_boundary`.

**`effect`** — `status` ∈ `planned` | `dispatched` | `confirmed` | `failed` | `reverted`; `type` (registry-governed, e.g. `write_order`, `send_payment`); `effect_attestation` ∈ `gate_executed` | `runtime_claimed` (required when dispatched, absent when planned); `response_digest` (present only for `confirmed`); optional `external_ref`, `irreversibility_class` ∈ `two_way` | `one_way_recoverable` | `one_way_consequential` | `one_way_terminal`.

**`assurance`** — `attestation_mode` ∈ `self_attested` | `anchored`; `effect_mode` ∈ `not_applicable` | `dispatched_unconfirmed` | `confirmed`; `ledger_mode` ∈ `standalone` | `chained` | `anchored`; optional `cross_party_rung` ∈ `unilateral_fallback` | `acknowledged_receipt` | `full_bilateral`.

Two invariants the implementation must make structurally unreachable:
- **I-1:** a producer MUST NOT emit `status: "confirmed"` without a `response_digest` over the actually observed response.
- **I-2:** `human_disposed: true` MUST NOT pair with any `approver` other than `"human"`.

`capsule_id` for format 4: remove `capsule_id`, JCS-canonicalize, SHA-256, lowercase hex.

Producer envelope is **COSE_Sign1** with a protected header of exactly three entries: `alg` (label 1) = `-8` (EdDSA/Ed25519), `content_type` (label 3) = `"application/agent-action-capsule-id"`, `kid` (label 4) = raw 32-byte Ed25519 public key. Payload is the raw 32 bytes decoded from hex `capsule_id`. Unprotected header empty.

**Composition — the four slots.** `seal(who(…), can(…), did(…), audit(…))` produces one capsule that references each member by CPB typed digest ref annotated with its slot. A member already produced elsewhere is **cited byte-identically, never re-minted.**

| Slot | Question it answers | Content |
|---|---|---|
| `who` | Who acted, on whose behalf? | Identity and pedigree |
| `can` | What permitted it? | The authority — often a carried, foreign-signed artifact, bound as-transmitted |
| `did` | What was actually done? | `request_digest` and `response_digest` held apart, so *may* never reads as *did* |
| `audit` | Under what disposition and limits? | `verdict_class`, timestamp, assurance, `withheld[]` |

Member ref shape: `{ "type": "capsule", "digest_alg": "SHA-256", "digest": "8f3a2c1d…", "slot": "can" }`

### 2.3 CPB — Canonical Payload Binding (`draft-mih-sokolov-scitt-payload-binding`)

One digest, one meaning, in anyone's verifier.

`CANONICAL-DIGEST(jcs-n, P) = lowercase_hex(SHA-256(JCS(normalize(P minus exclusion_set))))`

**`jcs-n`**: after removing the exclusion set and before serializing, remove — bottom-up and recursively — every member whose value is JSON `null`, an empty array, or an empty object. Then RFC 8785 JCS, then SHA-256, then lowercase hex (64 ASCII chars).

**Hard constraint:** monetary and quantity values anywhere in a `jcs-n` payload MUST be exact decimal strings, not JSON floating-point numbers. *(The payment scenario is built to exercise this: `"48200.00"`, never `48200.0`.)*

Typed digest reference: required `type` (from the Artifact Type Registry), `digest_alg`, `digest`. Additional fields MAY be present and MUST be ignored by verifiers that do not understand them.

Two registries. The **Canonicalization Algorithm Registry** (`jcs`, `jcs-n`, `cde-n` reserved) is **immutable** — new behavior requires a new entry, never a retroactive edit. The **Artifact Type Registry** binds a type name to its digest context (field set, exclusion set, algorithm, output representation). A verifier resolves digest context **from the reference's `type`, never from the field beside it.**

Log leaf rule: when a Transparency Service keys its log on a derived identifier, the leaf MUST be computed over the **raw bytes** of the identifier, not its hex-string encoding. `bytes.fromhex(D)` — 32 bytes — not `D.encode("utf-8")` — 64 bytes.

Verification scope, quoted because the UI must repeat it: CPB verification alone MUST NOT be interpreted as establishing issuer authority, artifact validity, scope, freshness, revocation status, policy compliance, semantic acceptance, or application authorization.

### 2.4 CLL — Checkpointed Local Log (`draft-mih-scitt-checkpointed-local-log`)

A producer-operated, append-only local log with periodic signed checkpoints. **Entries stay local and never publish; only the checkpoint travels.** 10k–100k records collapse to one ~200-byte checkpoint.

The log is a **Merkle Mountain Range** — a forest, not a tree. Each peak is a perfect binary Merkle subtree. Append is O(log n) and never restructures an earlier leaf. Peaks are bagged into a single 32-byte root for the checkpoint commitment.

Checkpoint claims (spec Table 1): `kind`, `log_size`, `commitment`, `prev_size`, `prev_commitment`, `issued_at`, `cadence`.

What each layer proves — this table drives a dashboard panel verbatim:

| From the log, even unsigned | From the witness | From the signature |
|---|---|---|
| order, completeness (range proof over contiguous leaves), tamper-evidence | contemporaneity (an append-time bracket), non-equivocation | authorship — and only authorship |

MMR hashing per `draft-bryce-cose-receipts-mmr-profile`: leaf hashes are supplied directly as `H(x)` with **no domain-separation prefix**; interior nodes **MUST prefix the value with `pos`** — `hash_pospair64(pos, a, b) = H(pos_be64 ‖ a ‖ b)`, `pos` being the 1-based MMR position of the parent, big-endian 64-bit.

Inclusion proof CBOR: `inclusion-proof = bstr .cbor [ index: uint, inclusion-path: [ + bstr ] ]`

### 2.5a Hedera Consensus Service as an alternative witness (added)

A Hedera topic is an ordered, consensus-timestamped, running-hash-chained message sequence
agreed by a public BFT network — structurally a transparency log. It supplies the two
properties the CLL briefing attributes to a witness (contemporaneity and non-equivocation)
with a stronger independence story than a self-hosted service signing its own receipts,
because the producer cannot forge a consensus timestamp.

Boundaries, stated because overclaiming here would be fatal with this audience:

- **Not an RFC 9942 receipt.** No `COSE_Sign1` over a Merkle inclusion proof. The VDS is
  consensus ordering plus a running hash, so `HCS_CONSENSUS_V1` is a PROPOSED local
  identifier, not an IETF registration. The local MMR receipt is retained alongside it.
- **Digest-only disclosure.** The published message carries `statement_sha256`,
  `commitment`, `log_id` and `log_size` — under 400 bytes, so a topic message never chunks.
  A test asserts no business content appears, per scenario.
- **Offline vs confirmed.** Offline verification establishes that the receipt names *this*
  statement. Establishing that the network accepted it requires one mirror-node read, which
  is opt-in (`--online`) and reported as a distinct check rather than folded into the
  verdict.

Architecture: the construction and verification logic lives in `packages/scitt/src/hedera.js`
with **no dependencies and no I/O**, so the verifier stays offline-capable and SDK-free. The
`@hashgraph/sdk` submission and mirror reads live at the edge in `apps/server`. A boundary
test asserts the SDK never reaches a library package.

**Findings from the first live runs (2026-09-23, topic `0.0.10684243`):**

1. *Key-type ambiguity.* The first submission failed at precheck with `INVALID_SIGNATURE`. A
   `0x`-prefixed 32-byte hex key is valid under both ECDSA secp256k1 and ED25519, and the
   SDK's `fromStringDer()` silently accepts raw hex and reads it as ED25519. The client
   parsed candidates in order and took the first that succeeded — the wrong one. Fixed by
   deriving each candidate's public key and keeping the one that matches the account's key
   on a mirror node; a mismatch is now an explicit error naming the account.
2. *Mirror ingestion lag.* All five first confirmations returned 404, although every
   message was on the network — the mirror indexes a few seconds after consensus. A single
   read reports a true message as missing. Fixed with polling and backoff; live runs
   confirm on read 2–3, adding roughly 1.5–3s.
3. *A dead button.* With the network round trip, the run takes ~3s to return. The primary
   button read "Start the walkthrough" while disabled for that window, so a click did
   nothing. It now reads "Anchoring to Hedera…" and the narration explains the wait.

Two further defects surfaced while exercising the live flow, both in the dashboard's
narration layer and both caused by unasserted text substitutions during development: an
edit meant for `describeEvent()` landed in `nodeForEvent()` (both switches contain
`case 'cigar.replay':`), crashing every run at step 1; and a display helper was never
defined because its anchor string did not match. That layer now has its own tests, running
every event of every scenario through both functions.

Degradation: anchoring runs **after** the offline, deterministic scenario run, so the test
suite stays synchronous and a hostile network cannot affect a run. Any failure falls back to
the local witness with the reason recorded in the bundle and narrated in the UI.

### 2.5 SCITT — the witness layer (RFC 9943 architecture, RFC 9942 receipts)

No new protocol. Register statements, read receipts.

- **Signed Statement** — COSE_Sign1 (RFC 9052). Protected header carries `iss`, `sub`, `alg`, `content_type`; issuer and subject sit *inside* the signed unit. Payload is the statement bytes — an AAC capsule, or a CLL checkpoint.
- **Transparency Service** — registration policy gates by statement type and action class **without parsing the payload**. The registered statement is appended to the service's verifiable data structure. A checkpoint-aware witness **refuses a checkpoint that does not extend the last one it accepted.**
- **Receipt** — a second COSE_Sign1, signed by the service, over a verifiable-data-structure proof. Carries a SHA-256 Merkle inclusion path to a published root. Rides in the statement's **unprotected** header, so the record travels with its own proof. Checkable offline; the issuer's key is not required.
- Receipt header labels: `vds` = **395**, `vdp` = **396**; inside the `vdp` map, inclusion-proof = **-1**, consistency-proof = **-2**.

**What a receipt never says:** that the claim is true. Only that it was registered, and by when. The dashboard states this on the witness panel — overclaiming here is the single most likely way to lose a security working group's trust.

---

## 3. Product requirements

### 3.1 The one-sentence test

A viewer with no prior exposure should, within 90 seconds of watching, be able to answer the brief's four questions about a specific agent action, and should have watched an independent verifier both accept a real record and reject a forged one.

### 3.2 Functional requirements

**FR-1 — Run the minimal interop profile end to end.** CIGAR governs context and one effect; AAC references the resulting artifacts; CLL checkpoints them; SCITT witnesses the checkpoint; an independent verifier checks the record.

**FR-2 — Five scenarios, all real runs, no fixtures.** Each executes the full pipeline and produces a genuinely different record:

| # | Scenario | What it proves | Terminal state |
|---|---|---|---|
| S1 | **Clean settlement** | The happy path produces a complete, verifiable record | `accept` / `executed` / `confirmed` |
| S2 | **Policy block before disclosure** | Refusals are records too; the gate is provable; protected context was never disclosed | `reject` / `blocked` / no effect |
| S3 | **Timeout → UNKNOWN → reconcile → compensate** | Uncertainty is preserved, not flattened; `confirmed` is unreachable without an observed response | `dispatched`→`UNKNOWN`→`confirmed` + compensation |
| S4 | **Poisoned / superseded source excluded** | The SelectionManifest catches an unauthorized and a superseded source before retrieval | `accept` on clean context, exclusions cited |
| S5 | **Tamper** | A post-hoc edit is caught by math, at a named leaf, with both digests shown | verifier `FAIL` |

**FR-3 — Independent verification.** The verifier must be reachable as its own entry point, must consume only an evidence bundle, and must have no import path to the CIGAR runtime. Enforced by test, not by convention (§5.6).

**FR-4 — Live tamper surface.** The operator can select any field in any sealed artifact, change its value, and re-verify without re-signing. The failure must name the check, the leaf, and both digests.

**FR-5 — Dual-register dashboard.** Every claim appears in two registers at once: a plain-language answer for non-technical viewers, and the underlying bytes/digests/proofs one click away. Neither is a separate "mode" the presenter has to remember to switch.

**FR-6 — Evidence bundle export.** Any run exports a portable JSON bundle that a third party can verify with a single command, offline, with no access to this server.

**FR-7 — Honest labeling.** Anything self-attested says so. Anything proposed-not-normative says so. The `withheld[]` list is visible. Open questions from the brief's page 3 are surfaced, unresolved, as first-class UI content — they are the discussion this demo is meant to start.

### 3.3 Presentation requirements

**PR-1** — Runs fully offline. Conference wifi is assumed hostile. No network call in the critical path.
**PR-2** — Cold start to first scenario complete in under 15 seconds, single command.
**PR-3** — Readable from the back of a room: ≥16px body, high contrast, no essential information conveyed by color alone.
**PR-4** — Visual identity inherits the source brief's palette so the demo reads as the same body of work.
**PR-5** — Deterministic. The same scenario produces the same digests across runs given a fixed seed, so the presenter can rehearse against known values and spot a genuine anomaly.
**PR-6** — Every panel answers "so what?" in one line, for the viewer who just walked in.

### 3.4 Accuracy requirements

**AR-1** — Real cryptography throughout: Ed25519 signatures, SHA-256 digests, RFC 8785 JCS, real MMR proofs, real COSE_Sign1 structures. No mocked or simulated crypto anywhere. When Hedera credentials are supplied, real consensus submissions to a public testnet.

**AR-5** — The witness is pluggable, and which one ran is always stated. Absent credentials the demo is unchanged; present, the bundle names Hedera and carries coordinates anyone can re-read. A failed anchor is recorded, never hidden.
**AR-2** — Spec field names and enum values used verbatim, per §2. No invented field names in any sealed artifact.
**AR-3** — Known-answer tests: RFC 8785 JCS vectors, an independently-computed MMR fixture, AAC invariant negative tests, and MUST-FAIL cases for the digest construction.
**AR-4** — Where the drafts are ambiguous or silent, the code declares the choice explicitly and the UI flags it as an open question rather than quietly picking one (§9).

---

## 4. The scenario: autonomous supplier payment

Chosen because it exercises every hard part of the seam without contrivance: real money, a foreign-signed authority artifact, an irreversible effect class, a natural ambiguity window, and a compensation path.

**Setting.** `Northwind Industrial` runs a treasury agent, `ap-settlement-agent v2.4.1`, authorized to settle approved supplier invoices under $50,000 without human sign-off.

**The action.** Settle invoice `INV-2026-0918` — $48,200.00 to `Meridian Components GmbH`.

**Sources available to CIGAR** (each with authority tier, validity window, verification state, and a supersession graph):

| Source | Type | Authority | Note |
|---|---|---|---|
| `erp://invoices/INV-2026-0918` | claim | system-of-record | the invoice, v3 |
| `erp://invoices/INV-2026-0918@v2` | claim | system-of-record | **superseded by v3** — amount differed |
| `erp://vendors/meridian-components` | claim | system-of-record | banking details, verified 2026-08-02 |
| `policy://treasury/payment-authority` | instruction | governance | the $50K ceiling and its conditions |
| `email://ap-inbox/msg-88213` | claim | **unverified** | "urgent: new bank details" — the poison in S4 |
| `erp://goods-receipt/GR-55021` | evidence | system-of-record | required evidence: goods received |
| `erp://payments/ledger` | evidence | system-of-record | duplicate-payment check |

**Context contract.** purpose `settle_approved_invoice`; principal `treasury-ops`; project `ap-automation`; required evidence `goods_receipt` + `vendor_bank_verification`; trust floor `system-of-record`; budget 8,000 tokens / 6 records; consumer `ap-settlement-agent`.

**Why S4 lands.** The unverified email asks to redirect funds — a live BEC pattern the security WG will recognize on sight. It is excluded *before retrieval* by the trust floor, and the exclusion is cited in the SelectionManifest with a reason. The superseded `@v2` invoice is excluded by the supersession graph. The demo's point: both exclusions are *evidence*, visible to an auditor who never sees the underlying content.

**Why S3 lands.** The payment gateway accepts the request and then times out. The agent knows it dispatched and does not know whether money moved. `status: dispatched`, `effect_attestation: gate_executed`, `assurance.effect_mode: dispatched_unconfirmed`, `verdict_class: timeout`, and **no `response_digest`** — so `confirmed` is structurally unreachable. Reconciliation against the payment ledger later observes settlement, binds `response_digest`, and emits a linked capsule with `verdict_class: resolved`. A compensation record suppresses the duplicate the naive retry would have sent. Three capsules, hash-chained, all in one CLL log, all under one witnessed checkpoint.

---

## 5. Architecture

### 5.1 Stack

**JavaScript (ESM) with JSDoc types**, Node 24 (native Ed25519 via `node:crypto`), npm workspaces. React + Vite dashboard. Express server. Vitest. Zero third-party runtime dependencies in any of the seven library packages — the primitives are implemented against the specs so the whole crypto and evidence path is auditable in the room, and cross-checked by KATs. (The dashboard uses React; the demo server uses Express. Neither is on the evidence path, and a test asserts the library packages stay clean.)

> **Revised during the build.** This originally specified TypeScript. Plain ESM was chosen instead because FR-6 requires the verifier to run standalone and offline with a single command: `node packages/verifier/src/cli.js <bundle>.json`. A build step between a third party and their ability to check the evidence undermines the claim the verifier exists to make, and is one more thing to fail on stage. Types are carried in JSDoc.

### 5.2 Package graph

```
packages/
  cpb        JCS (RFC 8785), jcs-n normalization, canonical digest,
             typed digest refs, canonicalization + artifact registries
  cose       deterministic CBOR, COSE_Sign1 sign/verify, Sig_Structure,
             receipt headers (vds 395 / vdp 396)
  cll        MMR (append, peaks, bagging, inclusion + range proofs),
             checkpoint construction and signing
  scitt      Transparency Service: registration policy, VDS append,
             RFC 9942 receipt issuance, checkpoint-extension refusal
  aac        seal(who, can, did, audit), capsule_id, slot member refs,
             enums, invariants I-1 and I-2
  cigar      governed context runtime: source snapshot, typed records,
             context contract, policy engine, reconciliation,
             SelectionManifest, ContextBundle, budgets, scoped handoff,
             hash-chained effect lifecycle ledger, replay
  verifier   independent verifier — evidence bundle in, verdict out
apps/
  server     scenario orchestration, SSE event stream, bundle export,
             tamper endpoint
  dashboard  React presentation dashboard
```

Dependency rule: `cpb` ← `cose` ← `cll` ← `scitt`; `aac` → `cpb` + `cose`; `cigar` → `cpb` + `cose`; `verifier` → `cpb` + `cose` + `cll` + `scitt` + `aac`.

### 5.3 The event stream

The orchestrator emits a typed event per pipeline step. The dashboard is a pure function of this stream, which means the pipeline animation is not a cartoon — it is the actual execution.

> **Revised during the build.** Both transports exist: `GET /api/stream/:id` emits the run as server-sent events, and `POST /api/run/:id` returns the completed run in one response. The dashboard consumes the second and animates the event list client-side. That is deliberate for a live presentation — the presenter can pause, step, rewind and skip to the end, and a network hiccup cannot interrupt a run that has already finished. The events are identical either way.

Event kinds: `source.ingested`, `contract.declared`, `policy.evaluated`, `record.typed`, `candidate.considered`, `candidate.excluded`, `conflict.reconciled`, `budget.charged`, `manifest.sealed`, `bundle.materialized`, `env.captured`, `handoff.signed`, `decision.made`, `effect.intent`, `effect.authorized`, `effect.dispatched`, `effect.unknown`, `effect.observed`, `effect.reconciled`, `effect.compensated`, `capsule.sealed`, `cll.appended`, `cll.checkpointed`, `scitt.registered`, `scitt.receipt`, `verify.step`, `verify.verdict`.

### 5.4 Evidence bundle

The portable unit. Contains: the AAC capsule(s) and their COSE_Sign1 envelopes; typed digest refs for every slot member; the referenced CIGAR artifacts (ContextBundle digest, SelectionManifest, signed handoff, effect ledger) **as originals, cited not re-minted**; the CLL inclusion proof per capsule; the signed checkpoint; the SCITT signed statement and receipt; the public keys; and a `withheld[]` manifest. It must verify with no access to the producing runtime.

### 5.5 Verification algorithm

Ten ordered checks, each independently reportable so a partial failure is legible:

1. Recompute each `capsule_id` from its record under the declared canonicalization → compare.
2. Verify each capsule's COSE_Sign1 over the raw 32-byte `capsule_id` payload.
3. Check AAC profile invariants I-1 and I-2, and enum membership.
4. Resolve every typed digest ref's context **from the registry by `type`** and recompute the referenced artifact's digest → compare.
5. Verify the hash-chain links between related capsules (`chain`).
6. Recompute each CLL leaf from raw `capsule_id` bytes; verify the inclusion proof to the checkpoint commitment.
7. Verify the checkpoint's COSE_Sign1, and that it extends `prev_commitment` at `prev_size`.
8. Verify the SCITT signed statement's COSE_Sign1 over the checkpoint bytes.
9. Verify the SCITT receipt: its own signature, and the inclusion path to the published root.
10. Report scope limits: what this verdict does *and does not* establish (§2.3, §2.5).

### 5.6 Enforced boundaries

The brief's constraint — test the seam without merging the specs — is load-bearing, so it is a test:

- `packages/verifier/package.json` MUST NOT depend on `@cigar-aac/cigar`; a test asserts no transitive import path exists.
- `packages/aac` MUST NOT import from `packages/cigar`. The capsule knows about *typed digest refs*, never about ContextBundles.
- `packages/cigar` MUST NOT import from `packages/aac`. The runtime produces artifacts; it does not know they will be sealed.
- CIGAR artifacts entering a capsule pass through the CPB typed-ref boundary only.

These four rules are the technical statement of the brief's design principle: *AAC should reference, rather than duplicate, CIGAR artifacts.*

---

## 6. Dashboard specification

### 6.1 Layout

**Revised during the build — a teaching-first pass.** The first implementation was a single
long scroll of eight equally-weighted cards, with the seam diagram acting as navigation for
a panel far below the fold. Three problems followed: the click and its effect were never on
screen together, so the diagram did not read as a control; the timeline and the seam were
two unrelated navigation axes competing for the same attention; and orientation was lost
entirely on scroll. The structure is now:

1. **Header** — what this is, in two sentences.
2. **Learning path** — the five situations as a numbered path with a role for each
   (*Start here · Then · The hard one · The attack · The punchline*), so the order is
   suggested rather than left to the presenter.
3. **The situation** — the question this scenario asks, and why it matters.
4. **The four questions** — the brief's page 1, answered live, with an explicit note that a
   lamp reports *answerability*, not a favourable outcome.
5. **Sticky orientation bar** — scenario, the four answers compressed to chips, step
   position, and the single play control. Survives scrolling.
6. **Stepper** — the five lifecycle steps as both progress indicator and navigation,
   carrying family colour, owning layer, and a live count per step. This absorbs the old
   seam diagram's job, which is why there is now one navigation axis instead of two.
7. **Step content** — one step at a time: the plain question, why the step exists, the
   brief's own lifecycle wording, then **What to notice** (two or three callouts *computed
   from the run*, never fixed prose), then the live panels, then exactly one obvious next
   action.
8. **Experiment** — the tamper surface, framed as predict → test → result.
9. **Reference** — open questions, the full glossary, and specification status, as
   collapsed disclosures rather than a wall.

**Revised again — a second subtraction pass.** The first restructure added structure but
subtracted nothing: landing still carried five scenario cards, four question cards, five
stepper boxes, three simultaneous status displays and 170 words of prose, at 12 interactive
elements above the fold. Measured, then cut:

| | before | after |
|---|---|---|
| Controls above the fold, on landing | 12 | 2 |
| Section headers above the fold | 9 | 1 |
| Words of prose above the fold | 170 | 49 |

What changed:

- **A landing that is a title card, not a control panel.** One hook, one sentence, one
  button — plus a second button for an all-engineer room that starts in technical density.
  Nothing auto-runs; the walkthrough begins when the viewer asks.
- **The four questions moved off the landing.** On arrival they were four more cards to
  parse before anything had happened. Each step is now tagged with the single question it
  answers, and all four return as a closing **scorecard** once the run completes — which is
  when a summary means something.
- **One big number per step.** Each step leads with the one figure it is about
  (*5 of 7 sources reached the agent*; *469 bytes is all that left*; *23/23 checks pass*)
  before any table or digest.
- **A density control, Plain by default.** Not a mode switch on the narrative — the story
  and the facts are identical either way, and every drawer stays clickable regardless. It
  sets the default open state of the heavy sections, so a non-technical viewer is not made
  to hunt for the sentence meant for them, and an engineer flips one switch instead of
  twelve drawers.
- **The stepper became a rail**, and the five boxes with two lines each became underlined
  tabs at roughly a third of the ink, still carrying live per-step counts.
- **The situation framing shrank** from a two-column card with a 21px claim to a compact
  strip that scrolls away, because it is read once.
- **The sticky bar dropped from nine elements to four**; the raw event-kind readout is
  developer noise and now appears only in technical density.

Three components were deleted once their jobs were absorbed: `Seam` (into the rail),
`QuestionLamps` (into the scorecard) and `Stepper`/`AnswerStrip` (into the rail and its
counts). No functionality was removed — every panel, control, scenario, tamper target and
byte drawer is still reachable.

**Revised a third time — the execution model.** With the layout calm, playback itself was
still unfollowable, and measurement showed why:

- The step pointer advanced the instant a step's FIRST event arrived, and the summary was
  computed from the FINAL result. At 31% progress the headline already read *5 of 7* while
  the rail still said "7 sources read" — the narration ran ahead of the data, then raced
  through *Settled → 469 bytes → 23/23* in about a second.
- The default interval was 28ms. Seventy-five events at 28ms is 37 events per second.
- Numbers mutated in eight places at once, with no single place to look for what changed.

The execution model is now a flight recorder, with three regions each answering exactly one
question:

| Region | Question |
|---|---|
| **Topology** | *where* in the system this is happening |
| **Now** | *what* just happened, and by what mechanism |
| **Log** | *what has happened* so far |

- **Playback is step-scoped.** Pressing play runs to the end of the current step and stops.
  The summary appears only once the step has actually finished, and the button label always
  states what pressing it will do. One subtlety: steps are not contiguous event ranges
  (each verdict is sealed as it happens, so `effect.*` and `capsule.sealed` interleave), so
  the stop index is explicit rather than derived — a derived boundary moved out from under
  the check in the same render and playback never paused.
- **Pacing is 340ms per event, with milestones held 2.6× longer.** The longest step takes
  about 13 seconds.
- **The guided/manual step duality is gone.** One pointer: the step you chose to run.
- **A topology graph** of 18 nodes across six columns shows the whole system, with the
  executing component lit and trust boundaries marked (`stays local`, `outside`,
  `not trusted`). Stage columns double as step navigation. A one-line minimap follows the
  viewer down the page, so the full 230px map does not have to be pinned.
- **Every event has a written narration** — a title, a sentence of mechanism, and the
  specific field values that make the claim checkable rather than decorative. These are
  derived from the event, so switching scenario cannot leave stale captions behind.

**Revised a fourth time — the stage.** Measured at 1440×860, a typical projector:
opening the walkthrough put the live narration at y=920 on an 860px screen, so the room
watched the map while the story happened off-screen. After step 1 the page restated the
result in three places, carried three separate forward buttons, and ran to 868 words.

The walkthrough is now a single **stage**, sized to one screen:

- **Story on the left, system on the right, both visible at once.** The system is a
  vertical flow map whose rail fills top to bottom as steps complete; only the executing
  node expands to say what it does.
- **Every step is setup → action → payoff.** *Setup* is one scenario-aware sentence telling
  the room what to watch for — computed from the run, so the poisoned situation names the
  bank-details email and the blocked one names €68,400 against €50,000. *Action* is the
  narration. *Payoff* appears only when the step has finished: one number, the principle,
  and **exactly three** things to notice, on every step of every situation.
- **One primary action, in one place.** It lives in the stage's dock and joins the sticky
  bar only when the stage has scrolled out of view — likewise the one-line map.
- **The four questions fill in beside the map** and are the scorecard at the end, so there
  is one of them rather than a progress strip plus a summary card.
- **Evidence below the stage, under one heading**, with each panel relabelled as evidence
  and its duplicate restatement of the result removed.
- **The landing previews the journey** as a five-step timeline.

| At 1440×860 | before | after |
|---|---|---|
| Narration while a step runs | y=920, off-screen | y=389, on screen |
| Map visible with the narration | no | yes |
| Forward buttons on screen | 3 | 1 |
| Words on page after step 1 | 868 | 622 |
| Page height | 2953px | 2067px |

Defects this pass surfaced, all fixed and now covered by tests:

- **A race on scenario switch.** With Hedera a run takes ~3s; switching scenario during
  that wait was ignored, then the in-flight run's result was displayed under the newly
  selected scenario — a Tamper label over a clean settlement's "34/34, whole chain
  verified". Newer requests now supersede stale ones, and a result renders only under the
  scenario that produced it.
- **The experiment's call to action was unreachable.** Finishing step 5 always means the
  run is complete, so "watch again" won every time. The ending now points at the
  experiment, with "watch again" as the secondary.
- **The payoff box was always green**, including around "2 failed" and "Refused".
- **Narration was ghosted.** It faded in from opacity 0 on every event; at 340ms per event
  it was half-transparent for most of its life, and never fully visible at faster paces.
- **Step 1's last event narrated under step 2's heading**, then fell back to "Press play"
  while playing, because chapter markers were filtered out of the step lookup.
- **Evidence headings rendered "\\U00B7".** Double-quoted JSX attributes do not process
  escapes. A static test now fails the build on any such escape.
- **Step 4 had four notices when anchored**, pushing its payoff behind the dock.

**Progressive disclosure** governs the whole thing: one concept per screen, secondary depth
available but not present, and reference material collapsed until asked for. The 48
verifier check rows are grouped under five plain-language questions, collapsed when
passing and auto-opened on failure.

**Guided by default, manual on demand.** Pressing play advances the timeline *and* the step
view together. Clicking a step takes manual control and reveals everything up to it. Arrow
keys step; space plays and pauses.

### 6.2 Dual register

Every panel carries a one-line plain-language claim in large type, and a `⟨ bytes ⟩` affordance revealing the canonical JSON, the digest inputs and the hex. Non-technical viewers read the top line; engineers open the drawer. No mode switch.

**Added in the UX pass: terms define themselves in place.** A glossary at the foot of a long page is a glossary nobody reads — by the time you have scrolled to it you have lost the sentence that sent you. Every piece of jargon is wrapped in a `<Term>` that shows, on hover or tap, a plain-language gloss first and the precise definition second. One `TERMS` map on the server feeds both the inline definitions and the reference glossary, so the two cannot drift.

### 6.3 Visual identity

Inherited from the brief for **chrome**: deep slate `#243746` for structure, teal `#2a7d7d` and warm sand `#8a6a3a` for section accents, pale mint `#e8f3ef` for thesis statements.

**Revised during the build.** The brief's teal and sand were validated as a categorical pair and failed two hard gates: both sit below the chroma floor (0.078 / 0.077, reading as grey), and they are only 13.3 normal-vision ΔE apart — below the 15 floor, meaning a full-colour reader struggles to tell them apart. Teal cannot reach the chroma floor at that lightness in sRGB at all. The two data-bearing hues that carry layer identity (CIGAR / AAC family) were therefore snapped to a validated blue+orange pair: light `#2a78d6` / `#eb6834`, dark `#3987e5` / `#d95926`, which clear the lightness band, chroma floor, CVD separation, normal-vision floor and 3:1 contrast in both modes. The brief's own colours are kept as chrome, where they carry no meaning and their low separation costs nothing.

Status colours are reserved (`good` `#0ca30c`, `warning` `#fab219`, `critical` `#d03b3b`) and always ship with a glyph and a word, so no state is ever conveyed by colour alone. Light and dark are separately selected, not an automatic flip.

---

## 7. Build sequence

| Phase | Deliverable | Done when |
|---|---|---|
| P0 | Monorepo scaffold, tooling | `npm test` runs green on an empty suite |
| P1 | `cpb` + `cose` | RFC 8785 KATs pass; COSE_Sign1 round-trips; jcs-n MUST-FAIL cases fail correctly |
| P2 | `cll` + `scitt` | MMR matches an independently-computed fixture; inclusion proofs verify; receipts verify offline; non-extending checkpoint refused |
| P3 | `aac` | `seal()` produces a format-4 capsule; I-1 and I-2 unreachable; slot refs resolve |
| P4 | `cigar` | Five-stage compile runs; manifest cites exclusions; effect ledger reaches UNKNOWN and reconciles |
| P5 | `verifier` | Ten checks implemented; clean bundle PASS; tampered bundle FAIL with named mismatch; boundary tests pass |
| P6 | `server` | All five scenarios run end-to-end over SSE; bundle export |
| P7 | `dashboard` | All five regions live; readable at distance; **Alpha complete** |

**Delivered.** All eight phases complete. 284 tests pass. All five scenarios run from a cold start with one command, the verifier passes clean and fails tampered with named digest mismatches, every one of the 24 scenario x tamper-target combinations is exercised by test, and the whole thing runs with the network off.

Alpha exit criteria: all five scenarios run from a cold start with one command; the verifier passes clean and fails tampered with a named digest mismatch; the dashboard presents both registers; the whole thing works with the network off.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Spec ambiguity leads to a wrong claim in front of the WG | §9 declares every choice; UI labels them as open questions rather than settled |
| Demo reads as a CIGAR or AAC product pitch | Neutral framing throughout; both layers' limits stated; the open questions are given equal billing |
| Hand-rolled crypto is subtly wrong | KATs against published vectors; independent recomputation in tests; primitives kept small enough to read aloud |
| Live demo fails on stage | Fully offline; deterministic seed; export/replay path so a recorded run can stand in |
| Viewers over-read the verifier's verdict | Check 10 exists solely to state scope limits, and the UI cannot hide it |

---

## 9. Declared choices where the drafts are ambiguous

Each of these is surfaced in the dashboard as an open question, mapped to the brief's page-3 list. They are the demo's actual contribution to the discussion.

**C-1 — AAC exclusion set.** `draft-…-capsule-04` says format 4 removes only `capsule_id` before plain JCS. The CPB Artifact Type Registry entry for `agent-action-capsule` states `jcs` with exclusion set `{capsule_id, chain}`. The talk describes `capsule_id` as covering signature and `key_id`. The implementation makes the exclusion set explicit and configurable, defaults to format-4 behavior (`{capsule_id}`), and displays the active digest context next to every digest. *Maps to the brief's "Artifact references."*

**C-2 — `jcs` vs `jcs-n` for capsules.** Format 4 declares `canonicalization_id: "jcs"`, while CPB's flagship algorithm is `jcs-n`. Both are implemented; the active one is declared in-record and shown in the UI. A toggle demonstrates that the two produce different digests for the same payload — the exact class of failure the CPB vector suite exists to pin.

**C-3 — CLL checkpoint field names.** The spec's Table 1 uses `kind` / `log_size` / `commitment` / `prev_size` / `prev_commitment` / `issued_at` / `cadence`; the AAIF talk uses shorthand `size` / `root` / `prev_root`. The implementation uses the normative Table 1 names and notes the shorthand in the UI.

**C-4 — Peak bagging.** The talk describes bagging right-to-left as `sha256(right ‖ left)`; the MMR profile position-commits interior nodes as `H(pos_be64 ‖ a ‖ b)` and signs a peak rather than a bagged root. The implementation bags with the position-committed rule to stay consistent with the profile's node hashing, documents the divergence from the talk's simplification, and pins the result with a KAT.

**C-5 — Which CIGAR artifact lands in `CAN`.** The brief proposes the signed handoff/capability as a natural CAN candidate and asks whether it can be consumed directly without re-signing. The implementation cites the handoff byte-identically via a typed digest ref and demonstrates a verifier resolving it without re-minting — an existence proof for the brief's "Authority mapping" question.

**C-6 — How UNKNOWN maps into AAC.** The brief asks how UNKNOWN, reconciliation and compensation map into portable records. The implementation proposes: UNKNOWN → `effect.status: dispatched` + `verdict_class: timeout` + `assurance.effect_mode: dispatched_unconfirmed` + absent `response_digest`; reconciliation → a linked capsule with `verdict_class: resolved` binding `response_digest`; compensation → a further linked capsule with `effect.status: reverted`. Offered as a concrete proposal to argue with, not a claim. *Maps to the brief's "Action uncertainty."*

**C-7 — Granularity.** One capsule per verdict, not per runtime event; the CLL leaf is the capsule. Alternatives are noted in the UI. *Maps to the brief's "Granularity + privacy."*

---

## 10. Sources

- `CIGAR_AAC_AAIF_3_Page_Brief.pdf` — the source brief
- `draft-mih-scitt-agent-action-capsule` — AAC profile
- `draft-mih-sokolov-scitt-payload-binding` — CPB
- `draft-mih-scitt-checkpointed-local-log` — CLL
- `draft-bryce-cose-receipts-mmr-profile` — MMR proofs
- `draft-mih-sato-agent-accountability-composition` — composition
- RFC 9943 (SCITT architecture), RFC 9942 (COSE receipts), RFC 8785 (JCS), RFC 9052 (COSE)
- `agentactioncapsule.org` · `canonicalpayloadbinding.org`
- `hol.org/blog/cigar-a-governed-context-runtime-for-ai-agents` — CIGAR
- AAIF Observability & Tracing WG briefing, 2026-09-02
