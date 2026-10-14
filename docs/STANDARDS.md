# Standards and scope

This is a working educational demonstration of CIGAR context execution and AAC
evidence construction. The following sources were checked on 2026-10-14. A
pinned Internet-Draft is a work in progress, not an approved Internet Standard.
The implementation and test results below are not a certification of arbitrary
implementations or a claim of production security.

## Sources and implementation

| Layer | Primary source | What this demo implements |
| --- | --- | --- |
| CIGAR | [hol-cigar 0.14.0](https://pypi.org/project/hol-cigar/0.14.0/) | The installed Python SDK and bundled native worker compile and verify context. Host source permissions, delegated payment authority, reviewer and gateway behavior are application code. |
| AAC | [draft-mih-scitt-agent-action-capsule-05](https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05) | Format `"4"`, plain JCS, digest commitments, supported payload checks in section 6 order, and independent Producer Envelope verification. See the [field mapping](AAC-DRAFT-05.md). |
| JCS | [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) | Recursive UTF-16 property ordering and canonical UTF-8 serialization; no normalization of capsule nulls, empty containers or Unicode. Text imports reject duplicate member names, including escaped spellings. AAC additionally restricts numbers to safe integers and exact decimal strings. |
| COSE / CBOR | [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052.html), [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html) | A minimal Ed25519 COSE_Sign1 implementation, not a general COSE library. AAC envelopes enforce tag 18, exactly the three protected headers, an empty unprotected map, and a raw 32-byte Capsule ID payload. |
| CPB-style artifact references | [Payload Binding draft](https://datatracker.ietf.org/doc/draft-mih-sokolov-scitt-payload-binding/) | A demo-local artifact registry chooses each artifact's digest context. Proposed CIGAR and WHO/CAN/DID/AUDIT types are not IANA registrations. Some legacy adapter types deliberately retain `jcs-n`; AAC capsules and request/response commitments use plain `jcs`. This is not a claim of full conformance to every revision of the CPB draft. |
| Checkpoint log / SCITT-style witness | [Local Log draft](https://datatracker.ietf.org/doc/draft-mih-scitt-checkpointed-local-log/), [RFC 9943](https://www.rfc-editor.org/rfc/rfc9943.html), [RFC 9942](https://www.rfc-editor.org/rfc/rfc9942.html) | A demo-owned position-committing Merkle log, signed checkpoint and receipt. The log's peak bagging and JSON/CBOR proof container are the repository's interoperability profile. This is not an independently operated SCITT service or a claim of full wire compatibility with an external MMR receipt profile. |
| Hedera | [Official account setup](https://docs.hedera.com/learn/getting-started/create-portal-account), [HCS topic messages](https://docs.hedera.com/reference/rest-api/topics) | Optional testnet HCS publication of checkpoint digests and opaque log coordinates. Mirror readback checks the exact published bytes and consensus coordinates. It is not an RFC 9942 COSE receipt. |

## AAC details that matter

- A draft-05 producer emits `spec_version: "draft-mih-scitt-agent-action-capsule-05"`;
  the serialization version remains `"4"`. The verifier accepts format-4
  draft-04 payloads and treats unfamiliar prose revisions as informational.
- Capsule identity excludes only top-level `capsule_id` and local composite
  `signature` / `key_id` fields. Chain links, references and all nested members
  remain committed. Producer Envelopes travel separately.
- An authenticated producer key is returned separately from authorization.
  Fixed demo keys do not establish a real operator's identity or authority.
- A planned refusal carries no request/response digest or effect attestation.
  Dispatch requires an attestation; confirmation requires a response digest.
  An UNKNOWN outcome is preserved; reconciliation adds a new executed capsule.
- Registry values are extensible and unknown values are informational.
  Structural declarations and closed enums fail closed. Assurance overclaims
  are reported separately from payload validity with conservative derived modes.
- All demonstration capsules claim self-attestation and unilateral evidence.
  Hash chaining can derive `chained`. Neither a checkpoint receipt nor an HCS
  message upgrades the capsule to AAC `attestation_mode: "anchored"`.
- The generic AAC verifier can inspect bare payloads and multiple independent
  envelopes. The demo's evidence-bundle profile additionally requires a producer
  signature and the disclosed composition artifacts that its UI promises.

## How to interpret the result

**Pass means evidence integrity under the implemented demo profile.** It does
not mean the business claim is true. The over-limit scenario correctly passes
verification of a refusal; the edited-receipt scenario correctly fails.

The payment, companies, agent, reviewer and business clock are fixtures. No LLM
or bank is called. CIGAR execution, signatures, digest checks and inclusion
proofs run for real. Hedera publication runs for real only when explicitly
selected and configured. A confirmed network timestamp concerns publication of
a commitment, not the payment's occurrence time.

The verifier shares this repository's canonicalization, crypto and profile
libraries. It runs without the producer server, Python or Hedera SDK; it is
not a separately authored implementation. Class 2 manifest evaluation,
independent key authorization, per-capsule SCITT registration, source-time
substrate verification and selective disclosure remain outside this demo.

See [release validation](RELEASE-READINESS.md) for actual test results and the
record of the authorized live testnet check. Cross-platform CI is configured;
local testing does not substitute for its first hosted run.
