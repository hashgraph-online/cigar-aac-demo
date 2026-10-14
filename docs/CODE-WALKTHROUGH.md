# Code walkthrough — CIGAR 0.14.0

Follow one run through the current execution path. The original technical PRD
retains the initial design and protocol decisions.

## 1. The host owns business policy

[corpus.js](../apps/server/src/corpus.js) provides explicit scenario records and a
contract. Monetary amounts are decimal strings.

[cigar.js](../apps/server/src/cigar.js) applies host rules for purpose, principal,
trust floor, supersession, validity and purpose binding. Excluded content is
never sent to Python. These are application rules, not native CIGAR functions.

## 2. The published package compiles the context

[cigar_bridge.py](../apps/server/python/cigar_bridge.py) imports `cigar_sdk` from
`hol-cigar==0.14.0`. It creates a native graph in the run’s domain, ingests only
host-authorized documents and links the invoice to its required policy, goods
receipt, supplier verification and duplicate check.

A host-owned read-only view compiles the required dependency closure under exact
token/block limits. The bridge verifies the snapshot, asks the native worker to
explain its selection, and reads the invoice from the resulting evidence blocks.

A separately authored fixture reviewer evaluates the invoice statement. CIGAR
checks the review bindings and releases it. The same claim without a review
abstains. Revalidation happens immediately before returning to the host effect
gate. The worker closes before the invocation returns.

Missing/wrong Python installations and native refusals stop execution. There is
no fallback to the legacy JavaScript compiler. A graph is scoped to one isolated
demo run; a production application should reuse an appropriate graph across
related work and coordinate revalidation with effect execution.

## 3. Adapt without replacing the native evidence

The host emits the demo profile’s manifest and context bundle. Selected content
comes from the native result, not a second independent selection algorithm.

The untouched result travels as `referenced_artifacts.cigar_execution`. The AAC
AUDIT member cites `native_execution_digest`. The proposed artifact type
`cigar-native-execution` uses JCS/SHA-256 with no exclusions. Unlike JCS-N, this
binding preserves native nulls and empty collections.

The old `packages/cigar/src/compile.js` remains a tested reference model. The
active engine imports its compiler from `apps/server/src/cigar.js`.

## 4. Execute the demo business action

[engine.js](../apps/server/src/engine.js) reads the invoice from compiled context.
[handoff.js](../packages/cigar/src/handoff.js) and
[effects.js](../packages/cigar/src/effects.js) are demo application helpers.

The authority gate precedes simulated dispatch. The uncertain-outcome scenario
appends UNKNOWN, reconciliation and duplicate-retry suppression. These are
scripted gateway observations, not a banking integration.

## 5. Seal, checkpoint and witness

AAC seals four typed references. CPB computes canonical digests. COSE signs with
Ed25519. CLL produces inclusion proofs and a signed checkpoint.

The local transparency service accepts the current run’s log ID. It is a
demo-owned signer. HTTP runs have unique graph domains and log identities, so
independent demonstrations do not claim conflicting histories of one durable log.

If explicitly requested, [anchor.js](../apps/server/src/anchor.js) calls
[hedera-client.js](../apps/server/src/hedera-client.js) to submit one digest
message and re-read the mirror. Only a matching verified message makes
`public_anchor.confirmed` true. An unmatched mirror record does not count.

## 6. Verify without the producing runtime

[verify.js](../packages/verifier/src/verify.js) imports evidence/crypto packages,
never CIGAR, Python, Express or the Hedera SDK. It recomputes capsule IDs and
member digests, checks signatures and invariants, resolves the signed native
artifact reference, and verifies inclusion and receipts. The caller may supply
a mirror record for online confirmation.

Empty evidence is rejected. Modifying or removing the native artifact is
rejected. No verdict certifies business truth or real-world identity.

## 7. Keep the interface tied to one execution

[index.js](../apps/server/src/index.js) retains the last 50 runs in memory.
Downloads and tamper experiments address the exact run ID.

[App.jsx](../apps/dashboard/src/App.jsx) shows the completed execution and its
five chapters. Navigating a chapter never re-executes an action. Witness labels
come from the verified result, not the presence of credentials.

## Validation

```sh
npm run doctor
npm test
npm run test:cigar
npm run build
npm run test:ui
```

Browser tests run the complete pipeline on desktop/mobile, download evidence and
check it in the separate CLI, edit all six tamper surfaces, import files, test
failure recovery, and check keyboard navigation, contrast and responsive bounds.
