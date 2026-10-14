# HOL · CIGAR x AAC Demo

**Governed context before an action. Checkable evidence afterward.**

An interactive, open-source demonstration of governed context before an action
and checkable evidence afterward. Follow a simulated €48,200 supplier payment
through **CIGAR 0.14.0 → AAC draft 5 → a local checkpoint witness → optional
Hedera testnet publication**, then try changing the evidence.

The payment, agent and reviewer are scripted fixtures. CIGAR's native context
compilation, cryptographic signatures, content commitments and verification
execute for real. No model provider, bank connection, HOL account or database is
required. The app is branded and maintained as a HOL demonstration; references
to external protocols and projects do not imply endorsement.

## Start with one command

Install **Node.js 24 LTS** (or supported Node.js 22.12+) and **Python 3.14** with
pip/venv, then clone or download this repository. In its directory, run:

```sh
npm start
```

That command installs the locked JavaScript dependencies, creates the local
Python environment, installs the pinned native CIGAR package, performs a real
compile/verify check, builds the dashboard and opens your browser once the server
is healthy. First setup needs internet access. No Rust compiler is needed.
Later starts reuse unchanged setup/build steps and still check the native worker.

Open [localhost:4319](http://localhost:4319) if the browser does not open
(the server binds to loopback). Stop with **Ctrl+C**.

```sh
npm start -- --offline --no-open
```

Use that variant for a headless local demonstration that bypasses .env and
explicitly disables public witnessing. If your platform has no matching Python
3.14 native wheel, setup stops with an installation error; there is no fallback
compiler. CIGAR's published native inventory includes macOS ARM64/x64, Linux
ARM64/x64 (glibc and musl), and Windows x64; see its
[package documentation](https://pypi.org/project/hol-cigar/0.14.0/).

## Understand it in three minutes

1. Keep **A payment done right** and **Local · no network**, then run it.
2. Walk through **Know → Act → Prove → Witness → Verify**. Context permission,
   payment authority, action outcome and evidence integrity answer different
   questions.
3. On **Prove**, open **Show AAC JSON & draft 5**. Inspect the actual run's capsule
   and referenced WHO / CAN / DID / AUDIT JSON, with section links to the
   [pinned draft](https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05).
4. In the experiment below, change a field and press **Edit & verify**. The
   verifier names the failures. The original run remains available.
5. Download the run's evidence and import it into the file checker, or verify it
   with the separate CLI. Inspect **How to use this demo** for an in-page tour.

| Situation | What to notice | Expected verification |
| --- | --- | --- |
| A payment done right | An allowed request with an observed fixture result | Pass |
| An over-limit request | €68,400 exceeds the €50,000 authority; refusal leaves evidence | Pass |
| A gateway goes quiet | UNKNOWN stays intact; later records confirm settlement and suppress a retry | Three records pass |
| A poisoned inbox | Host policy excludes untrusted instructions before native context compilation | Pass |
| An edited receipt | An unsigned edit upgrades the original dispatched record | Fail, intentionally |

“Blocked” is a business outcome; “Pass” is an evidence verdict. A passing refusal
record shows what the producer attested about its gate. It cannot prove that
nothing happened outside the recorded system. The edited-receipt scenario works
by exposing invalid evidence.

## Add an optional public witness

[Create a Hedera Portal testnet account and configure the demo](docs/HEDERA-SETUP.md).
The guide covers registration, the account ID / DER private key, funding, local
configuration, topic reuse, mirror confirmation and troubleshooting.

Local witnessing is the default even when credentials are configured. A user
must select **Hedera testnet** and run a scenario to submit. Only digest
commitments and opaque log coordinates become public. Each explicit Hedera run
spends test HBAR; the first can create a topic. Mainnet submissions are disabled.
Viewing JSON, downloads, imports and tamper experiments do not submit again.

A matching mirror readback adds a public consensus timestamp for publication of
the checkpoint commitment. It does not establish the fixture action's occurrence
time. The local receipt is demo-owned and supplies no independent public clock.
Neither receipt path claims per-capsule AAC `anchored` assurance.

## What runs and what remains a fixture

| Component | Scope |
| --- | --- |
| CIGAR | Published `hol-cigar==0.14.0` Python SDK and bundled Rust worker: native source views, required dependency closure, exact `o200k_base` budgets, citations, snapshot verification and review binding |
| Host application | Demo purpose/trust/source policy and a separate delegated-payment authority gate; a CIGAR assessment does not authorize payment |
| Reviewer, agent and gateway | Scripted scenario logic; no LLM or bank transfer |
| AAC | Draft-05 capsule construction and supported payload/envelope checks; format `"4"`, plain JCS and separate Producer Envelopes |
| WHO / CAN / DID / AUDIT | Proposed, demo-local composition slots and artifact types; AAC does not mandate these four slots |
| CPB / CLL / local receipt | Demo interoperability profile with real canonical digests, Ed25519 COSE, Merkle inclusion proofs and a signed checkpoint / receipt |
| Hedera | Optional real testnet HCS commitment; public confirmation requires matching mirror data |
| Verifier | Separate JavaScript entry point sharing the repository's crypto/profile libraries; no CIGAR, Python or Hedera SDK import |

The native CIGAR result is exported unchanged and bound with JCS through the
proposed `cigar-native-execution` type. Capsule and request/response digests
preserve all nested members, nulls and empty collections. Other referenced
artifacts use their explicitly declared demo digest contexts; those contexts
must not be interchanged. See [AAC integration notes](docs/AAC-DRAFT-05.md).

Signing seeds and business timestamps are public, fixed fixtures. HTTP runs get
fresh CIGAR domains and log identities. A signature authenticates a key's
commitment, not a real identity or its authority. A valid log proves inclusion
of supplied records; it does not prove absence of unrecorded activity.

The demo does not claim full SCITT service, AAC Class 2, standardized composition
mapping or production security conformance. Its local receipt is a demo profile,
and the HCS anchor is not an RFC 9942 COSE receipt. See [security and scope](SECURITY.md).

## Verify a downloaded file

After the JavaScript setup, without starting the server or Python:

```sh
node packages/verifier/src/cli.js evidence-bundle.json
node packages/verifier/src/cli.js evidence-bundle.json --online
```

The first command is offline. The second only reads an existing Hedera message;
it does not submit or need credentials. Exit status is 0 for Pass, 1 for Fail.
The dashboard's file checker verifies offline. Retained server runs are in memory
and expire after a restart or after the last 50 runs; downloaded files remain
independently checkable under the demo profile.

## Develop and validate

```sh
npm run setup
npm run dev
```

The API serves 4319 and Vite serves [localhost:5319](http://localhost:5319).
`npm run doctor` checks the native worker; `npm run setup -- --force` refreshes
local setup caches. To use a different existing Python 3.14 virtual environment,
set an absolute `CIGAR_PYTHON` path in your shell before setup/start.

```sh
npm run check
npm run test:ui
npm audit
```

`check` runs JavaScript tests, native Python tests, a production build and source
publication checks. Browser tests use installed Chrome by default. Without
Chrome, install Chromium using `npx playwright install chromium`, set
`PLAYWRIGHT_CHANNEL=chromium` in your shell, and run `npm run test:ui`.
CI installs Chromium automatically. Tests do not read .env or submit Hedera
transactions. The separately invoked `npm run check:hedera` is a live testnet
check described in the Hedera guide.

## Documentation and licensing

To create a source release from a Git checkout after setup, run:

```sh
npm run package:source
```

The command runs publication checks and writes a content-addressed ZIP plus a
SHA-256 checksum in `artifacts/releases/`. It includes the current working-tree
source, lockfile, tests, documentation, logos, licenses and a per-file
`SOURCE-MANIFEST.json`. It excludes Git history, installed dependencies, builds,
local credentials, generated evidence and machine-local configuration. A
recipient can extract the ZIP and run `npm start` without Git.

- [Presenter guide](docs/PRESENTING.md): a five-minute explanation and careful claims.
- [Hedera setup](docs/HEDERA-SETUP.md): optional Portal and public witness setup.
- [AAC draft 5 integration](docs/AAC-DRAFT-05.md): field mapping and verifier boundaries.
- [Standards and scope](docs/STANDARDS.md): pinned sources, implementation scope and evidence limits.
- [Code walkthrough](docs/CODE-WALKTHROUGH.md): the active execution path.
- [CIGAR integration notes](docs/UPGRADE-0.14.0.md): native worker boundaries and APIs.
- [Release validation](docs/RELEASE-READINESS.md): results, limitations and publication scope.
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [third-party notices](THIRD_PARTY_NOTICES.md).

Original software is **Apache-2.0**; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Bundled fonts retain their SIL Open Font License notices. Dependency licenses
remain with their distributions. HOL branding does not grant endorsement rights.
The original PRD is historical design context; current integration behavior is
specified in the implementation and current notes above.
