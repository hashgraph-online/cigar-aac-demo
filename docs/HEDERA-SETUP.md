# Optional Hedera testnet witnessing

The complete HOL demo works locally without an account. This guide adds a real
public checkpoint commitment. It does not connect a bank or make the simulated
payment real. The application submits to **testnet only**.

## 1. Create a Portal profile and testnet account

1. Open [Hedera Portal](https://portal.hedera.com/). Choose its registration /
   testnet-account entry and sign up, or sign in to an existing profile. Complete
   the email verification and profile prompts presented by the portal.
2. Select **testnet** in the network selector. Create a testnet account from the
   account dashboard if one is not already listed. A Portal login and a network
   account are separate things; you need the network account's ID and key.
3. Open that account's details. Copy its numeric **Account ID** (`0.0.…`) and
   matching **DER-encoded private key**. Use the private key, not the public key,
   EVM address, Portal API key or login password. DER encoding avoids the
   ambiguity between raw ECDSA and Ed25519 keys.
4. Check the test HBAR balance. Use the portal's funding/refill control or the
   [testnet faucet](https://portal.hedera.com/faucet) if needed. Follow the quota
   and eligibility shown there; this guide does not promise a fixed allocation.

The portal UI can change. Hedera's current
[account guide](https://docs.hedera.com/learn/getting-started/create-portal-account)
explains account creation and finding the matching ID / DER key. Its older
[Portal setup walkthrough](https://docs.hedera.com/hedera/tutorials/smart-contracts/hscs-workshop/setup)
also shows the email/profile and account-detail flow. You do not need to execute
a sample transfer or create another account with an SDK for this demo.

## 2. Configure the local server

Copy `.env.example` to a new `.env` file in the repository root using your editor
or file manager. Preserve an existing .env rather than overwriting it. Fill in:

```dotenv
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=YOUR_TESTNET_ACCOUNT_ID
HEDERA_PRIVATE_KEY=YOUR_DER_PRIVATE_KEY
HEDERA_TOPIC_ID=
```

The ID and key must belong to the same testnet account. Keep the real key only
in your local file or process environment. .env is ignored by Git. The browser
has no key entry form, and credentials are not included in an evidence bundle
or sent to the native CIGAR worker. Never use a production account key here.

Stop the server with Ctrl+C, then restart:

```sh
npm start
```

Do not use `--offline` or `DEMO_OFFLINE=1` for the Hedera path: those deliberately
bypass .env and disable the network witness. Local witnessing still remains the
initial UI selection when Hedera credentials are configured.

## 3. Publish and inspect one run

1. Select **Hedera testnet** in the Witness menu before running a scenario.
2. Run the scenario. The server seals evidence locally, then submits one HCS
   message containing only a checkpoint / statement commitment and opaque log
   coordinates. The invoice, amount, bank details and context are not published.
3. With no `HEDERA_TOPIC_ID`, the first Hedera run creates a topic. The server
   reuses it until stopped. Copy the topic ID displayed on Witness into .env to
   reuse the same topic across restarts. Supply a topic your key can submit to.
4. Follow the topic / HashScan link on **Witness**. A matching mirror-node
   read produces **Confirmed on Hedera**. A submission without mirror readback
   remains pending. A failed submission retains the local evidence and shows
   the reason. Each new explicit Hedera run submits again and spends test HBAR.

Opening chapters, showing JSON, editing an evidence copy, downloading and
importing a run do not submit another transaction.

The confirmed consensus time concerns publication of the checkpoint commitment.
It does not establish when the fixture business event occurred, business truth,
key authorization, or AAC `anchored` assurance. The local receipt remains a
separate demo-owned receipt with a self-attested clock.

## 4. Check the exported evidence

After JavaScript dependencies have been installed by setup, the standalone CLI
can verify a downloaded bundle without running CIGAR or the server:

```sh
node packages/verifier/src/cli.js evidence-bundle.json
node packages/verifier/src/cli.js evidence-bundle.json --online
```

Offline verification checks the included bindings and proofs. `--online`
re-reads an existing public message; it does not submit or require a private key.

For an explicitly invoked live integration check after configuration:

```sh
npm run check:hedera
```

This submits one clean-scenario checkpoint to testnet (and can create a topic),
requires matching mirror confirmation, and writes the evidence under ignored
`artifacts/`. It is intentionally separate from automated tests and setup.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Hedera option is unavailable | Restart after editing .env; remove offline mode; use testnet and a numeric account ID; fill both ID and private key |
| Key does not control the account / INVALID_SIGNATURE | Copy ID and DER private key from the same account; confirm the network; do not substitute the public key |
| Insufficient balance | Request test HBAR through the portal/faucet; current quotas are shown there |
| Topic submission refused | Clear an incorrect topic ID or use a topic whose submit-key policy your key satisfies |
| Confirmation pending | The mirror may lag; retry online verification of the downloaded evidence without submitting another run |
| Portal account disappeared | Test networks can reset; recreate/refund the account and update its ID/key/topic from the portal |

The account guide and portal were checked on 2026-10-14. No private credentials
are needed to follow the local demo or read these instructions.
