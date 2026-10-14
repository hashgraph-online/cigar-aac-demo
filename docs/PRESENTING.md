# Presenting HOL “CIGAR x AAC Demo”

Run `npm start` to set up, check and open the demo at http://localhost:4319. Confirm **CIGAR 0.14.0 ready**.
Use the local witness unless you intend to make a real Hedera submission.
The payment gateway and reviewer are fixtures; context execution, signatures,
proofs and verification are real.

## A five-minute story

Open with: “This is the CIGAR x AAC Demo. We’ll pay a supplier in a simulation,
then hand the evidence to someone who doesn’t have our runtime.”

1. **A payment done right.** Press **Run this scenario**. The outcome appears
   when execution completes. Tabs explore the completed run.
2. **Know.** The host chooses permitted sources. CIGAR’s native graph enforces
   that view and required evidence. Point to the exact token count and reviewed
   claim. Without a review, the claim is withheld.
3. **Act.** Compare €48,200 to the €50,000 ceiling. Application authority is a
   separate check from the CIGAR context assessment.
4. **Prove.** WHO, CAN, DID and AUDIT bind accountability, permission, action and
   evidence. Open **Show AAC JSON & draft 5** for the actual capsule, referenced artifacts
   and draft section mapping. These slots are a demo composition convention.
5. **Witness.** Show the actual state. A local receipt is not an independent
   clock. A confirmed Hedera anchor is a public digest commitment.
6. **Verify.** The independent verifier recomputes the evidence without CIGAR.
   A PASS establishes integrity, not business truth.
7. **Change the story.** Choose “The record: effect.status” in the experiment
   and press **Edit & verify**. Show the before/after values and named failures.
8. **Take it away.** Download this run’s evidence. Import the file into the
   checker or verify it from the command line.

## Pick one follow-up

- **An over-limit request:** €68,400 is blocked. The refusal still produces
  valid evidence. A successful control can cause a blocked business outcome.
- **A gateway goes quiet:** the original UNKNOWN record remains intact.
  Reconciliation and retry suppression add records without rewriting the first.
- **A poisoned inbox:** both attack sources are excluded. Their content never
  enters the native context or portable bundle.
- **An edited receipt:** the scenario intentionally ends with failed checks.
  That is the demonstration succeeding, not a broken system.

## If presenting Hedera

Select **Hedera testnet** before the run. Each explicit run publishes a digest.
Downloading, viewing chapters, importing and tampering never publish again.

At Witness, show the topic, message number and HashScan link. Say “confirmed”
only when the UI says **Confirmed on Hedera**. A delayed mirror gives a pending
state. A submission failure leaves local evidence intact and displays the failure.

For a separate online check of the downloaded file:

```sh
node packages/verifier/src/cli.js evidence-bundle.json --online
```

Only the public anchor is re-read. No transaction is sent.

## Questions to answer precisely

**Is this actually CIGAR?** Yes: hol-cigar 0.14.0 and its bundled native worker
execute compilation and review checks. Technical details show the full output.

**Did it send money or call a model?** No. The agent, reviewer and gateway are
fixtures. Cryptographic evidence and an optional live public anchor are real.

**Does CIGAR approve payments?** The application checks payment authority.
A context assessment does not grant permission for an external effect.

**Does a hash prove truth?** No. It binds content. A signature binds content to
a key. The verifier’s scope is displayed beside its result.

**Is the AAC/CIGAR mapping standardized?** No. It is a proposed interoperability
profile implemented by HOL; the pinned AAC draft does not mandate the four slots.

**Can the file checker confirm Hedera offline?** It checks the anchor’s binding
to the file. Public confirmation requires the online mirror read.
