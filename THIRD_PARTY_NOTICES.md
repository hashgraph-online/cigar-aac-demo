# Third-party notices

Original repository code is Apache-2.0. See LICENSE and NOTICE. Dependency
licenses and upstream copyright notices remain in their installed packages.

| Component | Use | License / source |
| --- | --- | --- |
| hol-cigar 0.14.0 | Python SDK and bundled native context worker; installed from PyPI, not vendored | Apache-2.0; upstream LICENSE and NOTICE in the installed distribution; https://pypi.org/project/hol-cigar/0.14.0/ |
| protobuf 6.33.5 | Python serialization dependency | BSD-3-Clause; installed distribution notices |
| Roboto | Bundled body font | SIL Open Font License 1.1; apps/dashboard/src/assets/fonts/Roboto-OFL.txt |
| Roboto Mono | Bundled heading/code font | SIL Open Font License 1.1; apps/dashboard/src/assets/fonts/Roboto-Mono-OFL.txt |
| React / React DOM | Dashboard rendering | MIT; installed distribution notices |
| Express | Local API and asset server | MIT; installed distribution notices |
| @hiero-ledger/sdk | Optional Hedera testnet adapter | Apache-2.0; installed distribution notices |
| Vite / Vitest / Playwright / axe | Build and validation tools | Their installed MIT / Apache-2.0 / MPL-2.0 notices, as applicable |

package-lock.json records exact npm dependencies, integrity hashes and declared
licenses. Some transitives use MPL-2.0 or a BSD/GPL dual choice. They are installed
as separate packages with their upstream notices; this repository does not
relicense them. The SDK's ethers transitive is overridden to 6.17.0 so the pinned
WebSocket implementation includes advisory fixes; ws is additionally pinned to 8.22.0. Check the lockfile and
current npm audit results before changing that override.

Protocol documents are external references, not bundled standards text. The AAC
mapping is independently authored demo code. References to AAC, CPB, CLL, COSE,
SCITT and Hedera explain interoperability and do not imply endorsement.

The historical third-party discussion PDF is retained only as local background
material and excluded from the public source set. It is not covered by the
repository's Apache license. HOL branding is the sole active demo branding.

The bundled HOL wordmark and icon come from the official brand kit at
https://hol.org/brand (Logo_Whole_Dark.png and Logo_Icon.png). The local assets
remove transparent canvas margins and resize the originals without changing
their colors or proportions. favicon.ico packages the icon at 16, 32, 48 and
256 pixels. HOL marks retain their owners' rights; the repository's Apache
license does not grant trademark or endorsement rights.
