# CIGAR 0.14.0 integration

The active path uses the exact PyPI release `hol-cigar==0.14.0` and
`protobuf==6.33.5`, isolated in `.venv`. Python 3.14 is required. See the
[published package](https://pypi.org/project/hol-cigar/0.14.0/) and its installed
`cigar_sdk/AGENT_GUIDE.md` for the local context API contract.

## Boundaries

| Owner | Responsibility |
|---|---|
| Demo host | Purpose/principal/source rules, fixture ingestion, delegation, payment authority, gateway simulation, semantic fixture reviews |
| Official CIGAR worker | Source-scoped view, required graph closure, exact rendered token budget, selection explanation, citations, snapshot integrity and review binding |
| AAC/CPB/CLL demo profile | Signed portable evidence, canonical references, log inclusion and checkpoint |
| Local SCITT-style service | Demo-owned receipt signing; no independent public clock |
| Hedera HCS | Optional public commitment, sequence and consensus time, confirmed through a mirror |
| Independent verifier | File-only verification without importing CIGAR; optional public mirror read supplied by the caller |

No model is called. A fixture reviewer independently knows the expected invoice
statement; changing the invoice does not change that expectation. CIGAR releases
supported reviews and abstains when reviews are missing. The application’s
authority check is separate from the assessment.

The adapter exports the original native result under
`referenced_artifacts.cigar_execution`. Its proposed artifact type uses JCS with
no exclusions, so null and empty fields retain their meaning. AAC’s AUDIT
member signs a reference to it. Tampering with or removing it fails verification.

## Runtime and lifecycle

Each scenario uses a bounded synchronous JSON subprocess call. Python owns one
native graph for the run and closes it with a context manager. This keeps
scenario domains isolated; it is not a design for a high-throughput shared graph
service. Native limits and the bridge timeout bound work. The bridge does not
inherit Hedera credentials from the Node process.

The server’s health check executes the package’s real doctor compile/verify and
checks both package and core version. Missing dependencies never select a mock.
After installing dependencies, restart the server to refresh startup readiness.

Business timestamps and signing seeds remain fixtures. API runs have fresh
domain and log IDs. Deterministic direct engine calls are retained for tests.
The in-memory run cache retains 50 results, is cleared on restart, and returns
404 for expired runs. Download evidence before restarting.

## API behavior

| Method and route | Behavior |
|---|---|
| `GET /api/health` | Actual startup native readiness; 503 when unavailable |
| `GET /api/reference` | Scenarios, public runtime status and safe witness configuration |
| `POST /api/run/:scenario` | Execute and retain one run; body `{ "witness": "local" }` is the default |
| `POST /api/run/:scenario` with `witness: "hedera"` | Execute, submit one public digest and attempt mirror confirmation |
| `GET /api/runs/:runId/bundle` | Download exactly that run; no execution or publication |
| `POST /api/runs/:runId/tamper` | Edit a copy of that run and re-verify; no publication |
| `POST /api/verify` | Independently verify uploaded evidence offline |
| `GET /api/bundle/:scenario` | Legacy local-only generation; never publishes |
| `GET /api/stream/:scenario` | Local execution events and retained run ID; never publishes |

Hedera failure is visible and retains the local receipt. An actual verified
mirror match is required for confirmation; merely passing a mirror object does
not qualify. The CLI’s `--online` option rechecks an existing commitment without
resubmission. Configuration alone is never displayed as network confirmation.

## Validation evidence

The checked-in suites exercise the official native worker, all scenarios, every
tamper control, exact-run exports, CLI verification, file imports, errors,
keyboard navigation, mobile bounds and automated accessibility checks.

A live testnet run during this upgrade published to **topic 0.0.10684243,
message 76**, consensus timestamp **1790615375.841250016**. Both the run and a
separate online verifier read passed **35/35 checks**. The public coordinates
refer to that validation artifact; later runs have their own identities.
The local artifact is `artifacts/hedera-testnet-evidence.json` (gitignored).

The Hedera anchor is additional evidence, not a standard SCITT COSE receipt.
The composition profile and native-artifact type are demo proposals. Integrity
does not prove business truth, source authority, real identities, or absence of
unrecorded actions.
