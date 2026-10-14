export const CHAPTERS = [
  { title: 'Trusted context', owner: 'CIGAR', verb: 'Know', meaning: 'Give the agent only the information it is allowed to use.' },
  { title: 'Bounded action', owner: 'Application policy', verb: 'Act', meaning: 'Check permission before dispatch. Record uncertainty honestly.' },
  { title: 'Signed evidence', owner: 'AAC', verb: 'Prove', meaning: 'Bind who acted, their authority, the result and its evidence.' },
  { title: 'Witnessed history', owner: 'SCITT + Hedera', verb: 'Witness', meaning: 'Commit the history so later edits can be detected.' },
  { title: 'Independent check', owner: 'Verifier', verb: 'Verify', meaning: 'Let another party check the evidence without the original runtime.' },
];

export const SCENARIO_COPY = {
  'clean-settlement': { label: 'A payment done right', short: 'The happy path', tag: 'START HERE', glyph: '↗', question: 'Can an agent act autonomously and leave proof?', body: 'An approved €48,200 invoice. A €50,000 spending limit. Follow one simulated payment from trusted information to independently verifiable evidence.', value: 'Move faster without losing accountability.', outcome: 'Payment confirmed', takeaway: 'The simulated gateway returned a receipt. The exact context, authority and outcome are bound into signed evidence.' },
  'policy-block': { label: 'An over-limit request', short: 'Permission matters', tag: 'CONTROL', glyph: '⊣', question: 'What happens when the agent asks for too much?', body: 'The invoice is now €68,400. Its €50,000 authority has not changed. A trustworthy agent must stop, and leave a record of the refusal.', value: 'Demonstrate that a control actually fired.', outcome: 'Payment blocked', takeaway: 'The application’s budget gate refused the payment before dispatch. The refusal has the same verifiable evidence as a successful action.' },
  'unknown-reconcile': { label: 'A gateway goes quiet', short: 'Uncertainty matters', tag: 'RESILIENCE', glyph: '◷', question: 'The request was sent. But did the payment happen?', body: 'A timeout is not a failure or a success. Watch the demo preserve the unknown outcome, reconcile it, and suppress a duplicate retry.', value: 'Prevent uncertainty from becoming a duplicate payment.', outcome: 'Reconciled · retry suppressed', takeaway: 'Three linked records preserve the story: sent with an unknown outcome, confirmed by reconciliation, then a duplicate retry suppressed.' },
  'poisoned-context': { label: 'A poisoned inbox', short: 'Trust matters', tag: 'DEFENSE', glyph: '◇', question: 'Can an email quietly change the rules?', body: 'An attacker sends new bank details and an attachment claiming a higher spending limit. The trusted host excludes both; CIGAR compiles the authorized view.', value: 'Keep unauthorized instructions out of the agent’s context.', outcome: 'Untrusted sources excluded', takeaway: 'Both attack sources were excluded before context compilation. The payment used the approved records, and the evidence names every exclusion.' },
  'tamper': { label: 'An edited receipt', short: 'Proof matters', tag: 'TRY TO BREAK IT', glyph: '≠', question: 'Someone changes the story. Can a stranger tell?', body: 'An insider edits a signed record to turn an unconfirmed payment into a confirmed one. The independent verifier gets the evidence and checks it again.', value: 'Turn “trust our logs” into evidence others can check.', outcome: 'Tampering detected', takeaway: 'The edited record no longer matches its signed fingerprint. The verifier also rejects a confirmation with no observed response.' },
};

export const SOURCE_NAMES = {
  'erp://invoices/INV-2026-0918': 'Approved invoice',
  'erp://invoices/INV-2026-0918@v2': 'Outdated invoice',
  'policy://treasury/payment-authority': 'Treasury policy',
  'erp://goods-receipt/GR-55021': 'Goods received',
  'erp://vendors/meridian-components': 'Verified supplier account',
  'erp://payments/ledger': 'Duplicate payment check',
  'hr://payroll/september': 'Private payroll data',
  'email://ap-inbox/msg-88213': 'Unverified bank-change email',
  'email://ap-inbox/msg-88214#attachment': 'Injected policy instruction',
};
export const sourceName = (id) => SOURCE_NAMES[id] ?? id;
export const money = (value) => new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));

/** A configured account is never evidence of a successful public anchor. */
export function witnessStatus(result) {
  if (!result) return { state: 'idle', label: 'Awaiting a run', detail: 'Witness status is determined from the completed evidence.' };
  const scitt = result.bundle?.scitt;
  const anchor = scitt?.hedera;
  if (anchor) {
    const confirmed = result.verification?.summary?.public_anchor?.confirmed === true;
    return {
      state: confirmed ? 'good' : 'warn',
      label: confirmed ? 'Confirmed on Hedera' : 'Hedera confirmation pending',
      detail: confirmed
        ? 'The mirror node returned the exact message recorded by consensus.'
        : 'A submission receipt is present. This check has not confirmed it against the network.',
    };
  }
  if (scitt?.hedera_error) return { state: 'warn', label: 'Hedera unavailable · local proof kept', detail: scitt.hedera_error };
  if (scitt) return { state: 'local', label: 'Local witness only', detail: 'A real signed receipt from this demo. No independent public timestamp is claimed.' };
  return { state: 'warn', label: 'No witness receipt', detail: 'Only the producer’s own signatures are available.' };
}
