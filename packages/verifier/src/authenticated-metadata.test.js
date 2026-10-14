import { describe, it, expect } from 'vitest';
import { sealCapsule } from '@cigar-aac/aac';
import { keyPairFromSeed } from '@cigar-aac/cose';
import { CheckpointedLocalLog } from '@cigar-aac/cll';
import { TransparencyService } from '@cigar-aac/scitt';
import { verifyEvidenceBundle, BUNDLE_FORMAT } from './verify.js';

function fixture() {
  const key = keyPairFromSeed('19'.repeat(32));
  const now = () => '2026-10-14T12:00:00Z';
  const sealed = sealCapsule({ action_id: 'action-1', action_type: 'fyi', operator: 'fixture', developer: 'fixture/1', timestamp: now(), keyPair: key });
  const log = new CheckpointedLocalLog({ logId: 'fixture-log', privateKey: key.privateKey, rawPublicKey: key.rawPublicKey, now });
  log.append({ id: sealed.capsule_id });
  const checkpoint = log.checkpoint();
  const service = new TransparencyService({ serviceId: 'fixture-witness', privateKey: key.privateKey, rawPublicKey: key.rawPublicKey, now });
  const registration = service.register(Buffer.from(checkpoint.cose_sign1_b64, 'base64'));
  return { bundle_format: BUNDLE_FORMAT, capsules: [{ ...sealed, cll: { leaf_index: 0, proof: log.proofFor(0) } }], cll: { log_id: log.logId, checkpoint }, scitt: { statement_b64: checkpoint.cose_sign1_b64, receipt: registration.receipt } };
}

describe('authenticated metadata boundaries', () => {
  it('verifies the complete fixture', () => expect(verifyEvidenceBundle(fixture()).ok).toBe(true));
  it.each(['log_id', 'log_size', 'commitment', 'issued_at'])('rejects independently altered checkpoint %s', (field) => {
    const bundle = fixture();
    bundle.cll.checkpoint.claims[field] = typeof bundle.cll.checkpoint.claims[field] === 'number' ? 999 : 'altered';
    const result = verifyEvidenceBundle(bundle);
    expect(result.ok).toBe(false);
    expect(result.checks.some((c) => !c.ok && c.name.includes('checkpoint metadata'))).toBe(true);
  });
  it.each(['root', 'service_id', 'registered_at', 'log_size', 'leaf_index'])('rejects altered receipt %s', (field) => {
    const bundle = fixture();
    bundle.scitt.receipt[field] = typeof bundle.scitt.receipt[field] === 'number' ? 999 : 'altered';
    expect(verifyEvidenceBundle(bundle).ok).toBe(false);
  });
  it('rejects an outer proof index that differs from the checked proof', () => {
    const bundle = fixture(); bundle.capsules[0].cll.leaf_index = 99;
    expect(verifyEvidenceBundle(bundle).ok).toBe(false);
  });
});
