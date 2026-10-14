import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Configuration from .env, with no dependency.
 *
 * Node has loadEnvFile built in, so a dotenv package would be dead weight.
 * Real environment variables win over the file, which is what CI and a
 * container expect.
 */
const ENV_PATH = resolve(import.meta.dirname, '../../../.env');

let loaded = false;
export function loadEnv() {
  if (process.env.DEMO_OFFLINE === '1') return;
  if (loaded) return;
  loaded = true;
  if (!existsSync(ENV_PATH)) return;
  try {
    process.loadEnvFile(ENV_PATH);
  } catch (e) {
    console.warn(`  .env present but could not be read: ${e.message}`);
  }
}

/**
 * Hedera configuration.
 *
 * `configured` is the only switch that matters: without an account id and a
 * private key the demo runs exactly as it did before, with the local
 * transparency service. Nothing about the offline path depends on this.
 */
export function hederaConfig() {
  if (process.env.DEMO_OFFLINE === '1') return { configured: false, accountId: null, privateKey: null, network: 'testnet', topicId: null, timeoutMs: 20000 };
  const accountId = process.env.HEDERA_ACCOUNT_ID?.trim() || null;
  const privateKey = process.env.HEDERA_PRIVATE_KEY?.trim() || null;
  const network = (process.env.HEDERA_NETWORK?.trim() || 'testnet').toLowerCase();
  const topicId = process.env.HEDERA_TOPIC_ID?.trim() || null;
  const configurationError = network !== 'testnet' ? 'This demo supports Hedera testnet only. Set HEDERA_NETWORK=testnet.'
    : accountId && !/^0\.0\.[1-9]\d*$/.test(accountId) ? 'Use a numeric Hedera testnet account ID such as 0.0.12345.'
    : topicId && !/^0\.0\.[1-9]\d*$/.test(topicId) ? 'HEDERA_TOPIC_ID must be a numeric topic ID such as 0.0.12345.' : null;

  return {
    configured: Boolean(accountId && privateKey && !configurationError),
    configurationError,
    accountId,
    // Never returned to a caller, never logged, never serialized.
    privateKey,
    network,
    topicId,
    timeoutMs: Math.min(60000, Math.max(1000, Number(process.env.HEDERA_TIMEOUT_MS) || 20000)),
  };
}

/** Safe to show a user or put in a response: no key material. */
export function hederaPublicConfig() {
  const c = hederaConfig();
  return {
    configured: c.configured,
    network: c.network,
    account_id: c.accountId,
    topic_id: c.topicId,
    error: c.configurationError ?? null,
  };
}
