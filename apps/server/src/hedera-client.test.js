import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateKey } from '@hiero-ledger/sdk';
import { initHederaWitness, closeHederaWitness } from './hedera-client.js';
import { hederaPublicConfig } from './env.js';

afterEach(() => { closeHederaWitness(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure(key) {
  vi.stubEnv('DEMO_OFFLINE', '');
  vi.stubEnv('HEDERA_NETWORK', 'testnet');
  vi.stubEnv('HEDERA_ACCOUNT_ID', '0.0.800123');
  vi.stubEnv('HEDERA_PRIVATE_KEY', key);
  vi.stubEnv('HEDERA_TOPIC_ID', '0.0.800124');
}

describe('Hiero SDK key formats and network boundaries', () => {
  it.each(['ECDSA_DER', 'ECDSA_RAW', 'ED25519_DER', 'ED25519_RAW'])('matches %s to the mocked public account without submitting', async (format) => {
    const key = format.startsWith('ECDSA') ? PrivateKey.fromStringECDSA('11'.repeat(32)) : PrivateKey.fromStringED25519('11'.repeat(32));
    configure(format.endsWith('DER') ? key.toStringDer() : key.toStringRaw());
    const fetch = vi.fn(async () => new Response(JSON.stringify({ key: { _type: format.startsWith('ECDSA') ? 'ECDSA_SECP256K1' : 'ED25519', key: key.publicKey.toStringRaw() } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await initHederaWitness();
    expect(result.ok).toBe(true);
    expect(result.keyVerifiedAgainstAccount).toBe(true);
    expect(result.createdTopic).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://testnet.mirrornode.hedera.com/api/v1/accounts/0.0.800123');
    expect(JSON.stringify(hederaPublicConfig())).not.toContain(key.toStringRaw());
  });
  it('refuses mainnet before opening a client or contacting a network', async () => {
    configure('unused-test-fixture'); vi.stubEnv('HEDERA_NETWORK', 'mainnet');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await initHederaWitness();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/testnet only/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses malformed account coordinates before contacting a network', async () => {
    configure('unused-test-fixture'); vi.stubEnv('HEDERA_ACCOUNT_ID', 'account-not-an-id');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await initHederaWitness();
    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
