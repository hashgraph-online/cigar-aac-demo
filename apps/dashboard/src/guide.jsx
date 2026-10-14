import React from 'react';

export function openHederaGuide(event) {
  event?.preventDefault();
  const tour = document.getElementById('demo-guide');
  const hedera = document.getElementById('hedera-setup');
  if (tour && hedera) { tour.open = true; hedera.open = true; hedera.scrollIntoView({ block: 'start' }); }
}

export function DemoGuide() {
  return <details className="demo-guide" id="demo-guide">
    <summary><span>How to use this demo</span><small>A short tour · optional Hedera setup</small></summary>
    <div className="demo-guide-body">
      <div className="tour-intro"><span className="section-label">START HERE</span><h2>One action. Follow the evidence.</h2><p>You can explore every scenario locally. No account, API key or model provider is needed.</p></div>
      <ol className="tour-steps">
        <li><strong>Run the happy path.</strong> Keep “A payment done right” and “Local · no network”, then press “Run this scenario”. The supplier payment and reviewer are simulated.</li>
        <li><strong>Follow the five chapters.</strong> Know shows the permitted context; Act shows the host’s authority check; Prove shows the signed record; Witness explains its timestamp limits; Verify checks the evidence independently.</li>
        <li><strong>Open the actual JSON.</strong> On Prove, expand “Show AAC JSON &amp; draft 5”. Inspect the capsule, its referenced artifacts and the draft sections behind each field.</li>
        <li><strong>Try to change history.</strong> In the experiment below, choose a field and press “Edit &amp; verify”. The named failures expose the unsigned edit. Download the original evidence and import it into the file checker for a second opinion.</li>
        <li><strong>Change the stakes.</strong> Try an over-limit request, a quiet gateway or a poisoned inbox. A blocked payment can have valid evidence. “An edited receipt” deliberately fails verification.</li>
      </ol>
      <div className="tour-boundary"><strong>What does a passing result mean?</strong><p>The included evidence is internally consistent under the demo’s checks. It does not prove business truth, real-world identity or that every action was recorded.</p></div>
      <details className="hedera-setup" id="hedera-setup">
        <summary>Add a public witness with Hedera testnet</summary>
        <p>This optional path publishes a checkpoint digest to the public test network. The invoice, payment amount and context stay local.</p>
        <ol>
          <li>Visit the <a href="https://portal.hedera.com/" target="_blank" rel="noreferrer">Hedera Portal ↗</a>, register or sign in, and complete its email/profile prompts.</li>
          <li>Select testnet and create a testnet account. On the account dashboard, find your account ID and the matching DER-encoded private key. Use the portal’s funding/refill control or the <a href="https://portal.hedera.com/faucet" target="_blank" rel="noreferrer">testnet faucet ↗</a> if you need test HBAR.</li>
          <li>On your own machine, copy the repository’s <code>.env.example</code> to <code>.env</code> and fill in these values. The key stays in the local server configuration; this page has no key entry field.</li>
        </ol>
        <pre aria-label="Hedera testnet configuration" tabIndex={0}>{'HEDERA_NETWORK=testnet\nHEDERA_ACCOUNT_ID=YOUR_TESTNET_ACCOUNT_ID\nHEDERA_PRIVATE_KEY=YOUR_DER_PRIVATE_KEY\n# HEDERA_TOPIC_ID is optional; the demo can create a topic.'}</pre>
        <p>Restart with <code>npm start</code> without <code>--offline</code>. Choose “Hedera testnet” in the Witness menu and run a scenario. Each explicit Hedera run spends test HBAR to submit one checkpoint message; the first can also create a topic.</p>
        <p>On Witness, use the topic and HashScan link to inspect the public record. “Confirmed on Hedera” appears only after a matching mirror-node read. A delayed mirror stays pending; a submission failure keeps the local evidence.</p>
        <p className="fine-print">Use a testnet-only key. No mainnet submission is supported. Downloads, JSON disclosures and edits do not submit another transaction. A Hedera consensus timestamp establishes publication of a commitment, not when the simulated business action occurred.</p>
        <div className="tour-links"><a href="https://docs.hedera.com/learn/getting-started/create-portal-account" target="_blank" rel="noreferrer">Official account guide ↗</a><a href="https://hol.org" target="_blank" rel="noreferrer">About HOL ↗</a></div>
      </details>
    </div>
  </details>;
}
