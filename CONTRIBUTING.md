# Contributing to HOL Proof of action

Start from a clone of the repository with Node.js 24 LTS (or supported Node.js
22.12+) and Python 3.14 installed. From the repository directory:

```sh
npm start
```

The launcher installs from package-lock.json, prepares a local Python environment,
checks the actual CIGAR worker, builds the page and opens the browser. Stop with
Ctrl+C. For code changes, run `npm run dev` after setup; Vite serves port 5319
and proxies the API on 4319. `npm run setup -- --force` refreshes the local
installation/build caches. Neither command installs system runtimes.

Before submitting a change:

```sh
npm run check
npm run test:ui
```

Without installed Chrome, run `npx playwright install chromium`, set `PLAYWRIGHT_CHANNEL=chromium` in your shell,
then run `npm run test:ui`. Without that setting, the suite uses installed Chrome.
On Linux, `npx playwright install --with-deps chromium` also installs the browser's
OS prerequisites. CI runs the full browser suite on Linux and unit/native/build
checks on Linux, macOS and Windows with Node.js 24.

Keep these boundaries intact:

- The server uses the published hol-cigar worker. Missing dependencies fail with
  setup guidance; they never select the legacy JavaScript compiler.
- The verifier must not import CIGAR, Python, Express or the Hedera SDK.
- Runtime authority and evidence integrity are different claims. Preserve the
  explicit distinction between fixtures, producer assertions and independently
  checked evidence.
- A download or disclosure addresses the displayed run. It must not create
  another run or a network submission.
- New protocol behavior needs positive and negative vectors, including malformed
  input. UI changes should retain keyboard operation and visible focus.

All automated checks use local witnessing and do not load .env or submit public
transactions. Follow [Hedera setup](docs/HEDERA-SETUP.md) for a separately invoked
live testnet check. Never include a populated environment file or generated
account keys in a contribution. The repeated signing seeds in scenario code are
intentional, public test fixtures; they must never become runtime credentials.

Changes to root dependencies must preserve package-lock.json. Python versions
are pinned in requirements.txt. Keep the documented ethers override until the
Hiero SDK's own pin includes the patched WebSocket dependency; re-run npm audit
and the key-format and end-to-end checks when removing it.

Contributions to the original software are licensed under Apache-2.0, as in
LICENSE. Preserve third-party notices and attribution.
