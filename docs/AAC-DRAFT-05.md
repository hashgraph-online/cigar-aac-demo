# AAC draft 5 integration

The demo produces `draft-mih-scitt-agent-action-capsule-05` capsules using
serialization format `"4"` and `canonicalization_id: "jcs"`.
The pinned source is [AAC draft 5](https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05),
an individual Internet-Draft and work in progress.

## Show the integration during a demo

Run a situation, choose **Prove**, then open **Show AAC JSON & draft 5**.
The disclosure contains a section-by-section field mapping and a link to the
pinned draft. Each record reveals the capsule from the displayed run's evidence
bundle. The first record is expanded initially. The nested artifact disclosures
show the actual WHO, CAN, DID and AUDIT JSON referenced by that record.
Opening a disclosure does not rerun a scenario, submit a transaction or fetch
another capsule. The tamper scenario explicitly labels the displayed edited JSON.

## Field mapping

| Capsule field | Demo input | Draft section |
| --- | --- | --- |
| `spec_version`, `format_version`, `canonicalization_id` | Pinned draft 5; format 4; plain JCS | 2, 5.1 |
| `operator`, `developer`, `timestamp`, `epoch_id` | Demo tenant, agent identity, fixture clock and configuration epoch | 5.1–5.2 |
| `disposition` | Host policy outcome; human involvement remains false | 5.5 |
| `effect` | Payment or retry-suppression action, request digest and observed response digest | 5.3 |
| `assurance` | Self-attestation; effect evidence; standalone or same-stream chained custody | 5.4 |
| `chain` | Same-stream parent and `confirms` / `follows` relation | 5.5.4 |
| `references[]` | Typed artifact digests, with a demo-local `slot` extension | 5.5.5 |
| `capsule_id` | SHA-256 of UTF-8 plain JCS, excluding `capsule_id` and local composite `signature` / `key_id` fields | 5.1 |

The WHO / CAN / DID / AUDIT grouping is this demo's composition mapping. AAC
draft 5 does not require those four slots. Their artifact types remain proposed,
demo-local integration types. The CAN artifact is the original signed CIGAR
handoff; the AUDIT artifact binds the unchanged native CIGAR output by digest.
Typed references use their artifact registry's declared digest context. Existing
CIGAR adapter types that use `jcs-n` retain that distinct context; a `jcs-n`
**capsule** is rejected. The capsule and committed request/response JSON use
plain JCS, with all nested members, nulls and empty collections participating.

The Producer Envelope is separate from the capsule JSON. It is tagged
COSE_Sign1 with exactly the draft's three protected headers and an attached raw
32-byte Capsule ID. Its authenticated public key is reported separately from
authorization. Bare payloads and multiple independent envelopes can be checked
through the AAC package. The demo bundle additionally requires a producer
envelope because it presents signed evidence.

## Honest scenario mappings

- A blocked payment has a planned effect, no effect attestation and no effect
  request/response digests. Its DID artifact can still describe the intended
  request that the policy refused.
- A timeout records a dispatched effect with a request digest and no response
  digest.
- Reconciliation creates a new `executed` capsule with a confirmed effect and
  `chain.relation: "confirms"`. The original timeout record stays unchanged.
  `resolved` is reserved for non-executing closures by draft 5 section 5.5.2.
- Suppressing the queued retry is a separate confirmed queue action with its
  own request, response and `org.hol.demo.suppress_duplicate_payment` effect
  type. It chains with `follows`. It does not assert that the settled payment
  was reverted.

All generated capsules claim `attestation_mode: "self_attested"` and
`cross_party_rung: "unilateral_fallback"`. The first record claims standalone
custody; later records with parent links claim chained custody. The demo-owned
checkpoint receipt and an optional Hedera commitment remain separate evidence.
Neither is a per-capsule RFC 9943 registration statement and receipt under an
externally trusted service key, so neither upgrades AAC assurance to `anchored`.

## Verification boundaries

`packages/aac/src/profile.js` returns the nine draft-5 payload checks in section
6 order. It rejects unsupported format/canonicalization declarations before
hashing, malformed digest material, invalid effect bindings, forbidden
verdict/effect pairings, missing effect attestations, invalid chain parents and
malformed provenance. Registry extensions are informational; structural enums
remain closed. Assurance overclaims are findings with conservative derived
values. Producer constructors reject unsupported assurance claims.

Optional backfill provenance is checked structurally, with explicit occurrence-
time caps. Retention declarations and external log coordinates are reported as
carried claims, not independent attestations. Cross-stream reference resolution
is not required for payload validity, while the demo bundle separately resolves
its disclosed composition artifacts. The verifier recomputes whole disclosed
request/response JSON commitments and checks their agreement with DID and effect
fields. It retains the existing CIGAR-evidence, log inclusion and checkpoint
receipt checks.

This is a demo interoperability implementation, not an assertion of full SCITT
service or Class 2 conformance. It does not implement manifest-aware AAC Class 2
constraint evaluation, independent authorization policy, per-capsule RFC 9943
registration, trusted AAC anchoring, source timestamp substrate verification,
selective-disclosure proofs or cross-algorithm re-anchoring. The library reports
conservative assurance for unsupported substrate evidence.

## Validation

`npm test` covers the draft-5 identity, format rejection, nested JSON commitments,
open registries, verdict/effect rules, assurance reconciliation, provenance,
retention, external log indices and malformed/multiple envelopes, together with
the existing scenario and cryptographic tests.

`npm run build` builds the dashboard. `npm run test:ui` checks desktop and mobile
flows. The AAC inspector test compares every displayed capsule JSON with the
same run's API bundle, checks the hidden pinned draft link and section mapping,
resolves the displayed CAN JSON, checks accessibility and horizontal overflow,
and ensures opening disclosures does not trigger another run.
