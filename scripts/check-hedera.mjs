import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv, hederaConfig } from '../apps/server/src/env.js';
import { runScenario } from '../apps/server/src/engine.js';
import { anchorRun } from '../apps/server/src/anchor.js';
import { closeHederaWitness } from '../apps/server/src/hedera-client.js';

// Explicitly invoked live check: one checkpoint, testnet only. Never print
// environment contents, key material, or raw SDK errors.
loadEnv();
const config = hederaConfig();
if (!config.configured || config.network !== 'testnet') {
  console.error('Live validation requires a configured Hedera testnet account. No transaction submitted.');
  process.exitCode = 1;
} else {
  try {
    const result = await anchorRun(runScenario('clean-settlement', { runId: randomUUID() }));
    const directory = resolve(import.meta.dirname, '../artifacts');
    mkdirSync(directory, { recursive: true });
    const destination = resolve(directory, 'hedera-testnet-evidence.json');
    writeFileSync(destination, JSON.stringify(result.bundle, null, 2));
    const anchor = result.verification.summary.public_anchor;
    console.log(JSON.stringify({
      ok: result.ok,
      cigar: result.artifacts.cigar.version,
      checks: result.verification.summary.total,
      anchor,
      evidence: destination,
      error: result.bundle.scitt?.hedera_error ? 'Anchor submission did not complete; inspect the local evidence.' : null,
      mirror_error: result.bundle.scitt?.mirror_error ? 'Mirror confirmation pending; inspect the local evidence.' : null,
    }, null, 2));
    if (!result.ok || !anchor?.confirmed) process.exitCode = 1;
  } catch {
    console.error('Live validation could not complete. No credentials were logged.');
    process.exitCode = 1;
  } finally { closeHederaWitness(); }
}
