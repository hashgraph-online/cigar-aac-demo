# HOL CIGAR x AAC Demo release validation

This document records the source/publication scope and the validation performed
for the HOL-only release. It is a technical readiness record, not a claim of
formal protocol certification or production suitability.

## Publication scope

The public source set includes the demo, tests, exact dependency lockfile,
Apache-2.0 license, third-party notices, contributor/security documentation and
CI configuration. Machine-local assistant configuration, environments, setup
caches, generated evidence and the background discussion PDF are excluded.
Local copies remain available to the maintainer.

`npm run check:release` examines the prospective Git source set. It fails on
forbidden local paths and common credential patterns without printing their
values. It checks required release documentation, license metadata, Python pins
and the active brand. Public repeated signing seeds remain documented fixtures.
This is not an exhaustive secret-history scanner. No repository has been pushed
or made public as part of this preparation.

## Accuracy boundaries

- CIGAR 0.14.0 is the real installed Python/native worker; the host's source
  policy and payment authority checks are demo code. No LLM or bank is called.
- AAC draft 5 retains format 4 and plain JCS. WHO/CAN/DID/AUDIT are the demo's
  composition convention, not required AAC fields. Unknown registry extensions
  remain informational; structural enums and identity declarations fail closed.
- Capsule payloads, Producer Envelopes and local checkpoint receipts are
  distinct results. A self-contained key proves a signature, not key authority.
- The verifier binds displayed checkpoint claims to the signed checkpoint
  payload, receipt metadata to signed receipt claims, and proof coordinates to
  the signed log size. Regression tests cover those substitution boundaries.
- CBOR parsing rejects duplicate keys, truncated items, invalid UTF-8, unsafe
  integer representations and excessive nesting. JCS rejects lone surrogates.
  JSON file/API/CLI input rejects duplicate member names, including escaped
  spellings, and limits nesting before verification.
- A local witness clock is self-attested. A matching public Hedera mirror record
  confirms publication of a checkpoint commitment, not business occurrence time.
  No local/Hedera checkpoint path upgrades per-capsule AAC assurance to anchored.
- Generic cross-stream references can be undisclosed. Disclosed composition
  artifacts are checked under their declared digest contexts, which can differ.
- The server is local and unauthenticated; it is not a public funded service.
  Hedera submissions are testnet-only and explicitly selected by the user.

## Validation record

Checked on 2026-10-14 on macOS ARM64, Node.js 24.15.0 and Python 3.14.7:

| Check | Result |
| --- | --- |
| `npm run check` | Passed: 501 JavaScript tests, 7 native Python tests, production build and publication source checks |
| `npm run test:ui` | Passed: 14 desktop/mobile browser tests using installed Chrome, including all scenarios/chapters, downloads checked by the separate CLI, imports, all exposed edits, error recovery, keyboard navigation, overflow and automated WCAG A/AA checks |
| `npm audit --json` | 0 advisories at all severities in the updated lockfile |
| OSV queries for pinned hol-cigar 0.14.0 / protobuf 6.33.5 | No advisories returned for either version at check time |
| Clean `npm start -- --offline --no-open` | Passed from a separate source copy with no node_modules, .venv, build output, setup cache or credentials; created a fresh Python environment, installed locked dependencies, checked CIGAR, built and served HOL |
| Clean-start health + scenario | Healthy CIGAR 0.14.0; AAC draft-05; clean settlement passed all 30 checks |
| Cached restart | Passed; reused JavaScript/Python/build steps and repeated the actual CIGAR health check |
| Shutdown | Ctrl+C stopped the smoke-test server and released its port |
| Missing custom Python path | Stopped before setup with a clear recovery instruction and a nonzero exit |
| Hiero SDK network/key boundaries | Actual SDK key parsing tested for raw/DER Ed25519 and ECDSA, with mocked mirror responses; mainnet/malformed coordinates refused before network access |
| Authorized live `npm run check:hedera` | Passed: 41/41 checks; submitted one testnet checkpoint and confirmed its exact bytes and consensus coordinates against the public mirror |
| Separate verifier CLI with `--online` | Passed: 41/41 checks on the exported live evidence, independently re-reading the public mirror without operator credentials or a running demo server |
| Duplicate JSON input | Regression cases cover duplicate names at nested levels, escaped name collisions and nesting limits; raw API smoke check returns HTTP 400 for ambiguous JSON |
| Source ZIP | 124 source files plus a per-file SHA-256 manifest; ZIP integrity, inventory, every file hash and local-file exclusions checked |
| Extracted source ZIP startup | Passed `npm start -- --offline --no-open` in a fresh directory without Git history, dependencies, a Python environment or build output; setup installed the dependencies and served the renamed HOL demo |
| Extracted source ZIP scenarios | All five scenarios produced the expected verdicts; the separate CLI passed 30/30 checks on the clean-settlement download |
| Separate Python digest cross-check | Recomputed all six capsule identities from the four honest scenarios using independently written standard-library JSON/SHA-256 code; all matched. This checks the emitted integer/string JSON fixtures, not arbitrary JCS inputs or the signature/receipt implementation |

The dependency refresh replaced the older SDK/tooling tree, which initially
reported 30 npm advisories, with @hiero-ledger/sdk 2.90.0, Vite 8.3.4, Vitest
5.0.4 and plugin-react 6.1.2. The ethers/ws overrides are documented and locked.
The upstream SDK still depends on deprecated crypto-js; no advisory was reported
for it at check time, but future releases should track its upstream replacement.

CI is configured separately. Its Linux/macOS/Windows results will only exist
after the repository is hosted and the workflow runs; those are not claimed as
completed by this local validation.

The final source archive is created with `npm run package:source`. Its filename
includes the first 12 characters of its SHA-256 digest; the adjacent `.sha256`
file carries the complete digest. The included `SOURCE-MANIFEST.json` records
each source file's exact size and digest. Documentation-only validation-record
updates are repackaged after the extracted-source smoke test. Archives contain
no repository history. The [standards and scope guide](STANDARDS.md) records
the primary sources and distinguishes the active AAC draft-05 implementation
from demo-local composition and receipt profiles.

The single authorized live check used testnet topic `0.0.10684243`, sequence `84`,
with consensus timestamp `1792003487.275408104`. The public record can be inspected
in [HashScan](https://hashscan.io/testnet/topic/0.0.10684243) or through the
[specific mirror message](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10684243/messages/84).
The generated evidence remains a local, ignored artifact; credentials are not
included in the public source set. This confirms the tested checkpoint's public
publication and verification, within the accuracy boundaries above.
