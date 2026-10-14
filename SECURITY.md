# Security and scope

HOL Proof of action is a local educational demonstration. It is not a payment
service, a production authorization gateway, a durable transparency service or
a complete implementation of every AAC/SCITT profile. Keep the server on its
default loopback address. There is no multi-user authentication or tenant
isolation for exposing this demo as a public funded service.

The private signing seeds in the demo source are intentionally public fixtures.
They establish reproducible cryptographic consistency, not a real identity.
Only the optional Hedera testnet operator key is an actual user credential.
Keep that key in a local .env or process environment; never commit it, paste it
into the web page or attach it to an issue. The native CIGAR subprocess receives
a restricted environment without the server's Hedera credentials.

The default is local witnessing, even with credentials configured. The demo
only allows testnet submissions after the user selects Hedera and runs a
scenario. A live submission can create a topic and spends test HBAR. Tests,
downloads, imports, JSON inspection and tamper experiments do not submit.

The verifier checks content integrity under the stated demo digest contexts,
cryptographic signatures, invariant checks and included proofs. A passing result
does not establish business truth, authorization of the included signing keys,
completeness of real-world activity or an independently trustworthy local clock.
Read the verification scope and docs/AAC-DRAFT-05.md before relying on a result.

If you discover a vulnerability, use the Git hosting service's private security
reporting facility once the repository is published, or contact HOL through the channels linked at
https://hol.org. Do not post credentials or a working exploit against a
public funded account in a public issue. Include the affected commit, platform,
reproduction steps using synthetic data and the relevant boundary/check.

Run npm audit and check the current advisories before distributing a release.
An audit returning no advisories is a point-in-time dependency check, not a
security certification. The publication source check detects forbidden local
paths and common credential patterns; it is not an exhaustive secret-history
scanner. Review Git history and access settings before making a repository public.
