import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { keyPairFromSeed, signSign1, parseSign1, HEADER, CWT, ALG, VDS, VDP } from '@cigar-aac/cose';
import { CheckpointedLocalLog, CHECKPOINT_MEDIA_TYPE, verifyInclusion } from '@cigar-aac/cll';
import { TransparencyService, verifyReceipt, HEADER_ACTION_CLASS, RECEIPT_MEDIA_TYPE } from './service.js';

const producer = keyPairFromSeed('ab'.repeat(32));
const witness = keyPairFromSeed('cd'.repeat(32));
const attacker = keyPairFromSeed('ef'.repeat(32));

let tick = 0;
const now = () => new Date(Date.UTC(2026, 8, 21, 12, 0, tick++)).toISOString();

const newService = (policy) => {
  tick = 0;
  return new TransparencyService({
    serviceId: 'anchor.demo.aaif',
    privateKey: witness.privateKey,
    rawPublicKey: witness.rawPublicKey,
    policy,
    now,
  });
};

const newLog = (logId = 'northwind-ap-settlement') =>
  new CheckpointedLocalLog({
    logId,
    privateKey: producer.privateKey,
    rawPublicKey: producer.rawPublicKey,
    now,
  });

const capsuleId = (n) => createHash('sha256').update(`capsule-${n}`).digest('hex');

/** A minimal AAC-style signed statement, for the non-checkpoint cases. */
const capsuleStatement = ({ key = producer, actionClass = 'payments', iss = 'northwind-industrial' } = {}) =>
  signSign1({
    protectedHeader: {
      [HEADER.alg]: ALG.EdDSA,
      [HEADER.content_type]: 'application/agent-action-capsule-id',
      [HEADER.kid]: key.rawPublicKey,
      [HEADER_ACTION_CLASS]: actionClass,
      [HEADER.cwt_claims]: new Map([[CWT.iss, iss], [CWT.sub, 'capsule/1']]),
    },
    payload: Buffer.from(capsuleId(1), 'hex'),
    privateKey: key.privateKey,
  }).bytes;

describe('registration policy', () => {
  it('accepts a statement whose type and issuer are allowed', () => {
    const svc = newService({
      acceptedContentTypes: ['application/agent-action-capsule-id'],
      acceptedIssuers: ['northwind-industrial'],
    });
    const result = svc.register(capsuleStatement());
    expect(result.registered).toBe(true);
    expect(result.policy.ok).toBe(true);
  });

  it('gates on statement type and action class without parsing the payload', () => {
    const svc = newService({
      acceptedContentTypes: ['application/agent-action-capsule-id'],
      acceptedActionClasses: ['payments'],
    });
    const result = svc.register(capsuleStatement({ actionClass: 'payments' }));
    expect(result.registered).toBe(true);
    // The whole point: the witness never needed a payload parser.
    expect(result.policy.payloadInspected).toBe(false);
  });

  it('refuses a statement type it does not accept', () => {
    const svc = newService({ acceptedContentTypes: ['application/cll-checkpoint+json'] });
    const result = svc.register(capsuleStatement());
    expect(result.registered).toBe(false);
    expect(result.reason).toMatch(/statement type/);
  });

  it('refuses an action class it does not accept', () => {
    const svc = newService({ acceptedActionClasses: ['read_only'] });
    const result = svc.register(capsuleStatement({ actionClass: 'payments' }));
    expect(result.registered).toBe(false);
    expect(result.reason).toMatch(/action class/);
  });

  it('refuses an issuer outside its allowlist', () => {
    const svc = newService({ acceptedIssuers: ['northwind-industrial'] });
    const result = svc.register(capsuleStatement({ iss: 'someone-else' }));
    expect(result.registered).toBe(false);
    expect(result.reason).toMatch(/issuer/);
  });

  it('refuses a statement whose signature does not verify', () => {
    const svc = newService();
    const bytes = Buffer.from(capsuleStatement());
    bytes[bytes.length - 1] ^= 0xff;
    const result = svc.register(bytes);
    expect(result.registered).toBe(false);
    expect(result.reason).toMatch(/signature invalid/);
  });

  it('registers with an empty policy but records what it saw', () => {
    const svc = newService();
    const result = svc.register(capsuleStatement());
    expect(result.registered).toBe(true);
    expect(result.entry.issuer).toBe('northwind-industrial');
    expect(result.entry.statement_content_type).toBe('application/agent-action-capsule-id');
  });
});

describe('checkpoint-aware witnessing', () => {
  it('accepts a first checkpoint from a log it has not seen', () => {
    const svc = newService({ acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE] });
    const log = newLog();
    log.append({ id: capsuleId(0) });
    const cp = log.checkpoint();
    const result = svc.register(Buffer.from(cp.cose_sign1_b64, 'base64'));
    expect(result.registered).toBe(true);
    expect(result.extension.from).toBe(null);
  });

  it('accepts a checkpoint that extends the last accepted one', () => {
    const svc = newService({ acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE] });
    const log = newLog();
    log.append({ id: capsuleId(0) });
    svc.register(Buffer.from(log.checkpoint().cose_sign1_b64, 'base64'));
    log.append({ id: capsuleId(1) });
    const result = svc.register(Buffer.from(log.checkpoint().cose_sign1_b64, 'base64'));
    expect(result.registered).toBe(true);
    expect(result.extension.ok).toBe(true);
    expect(result.extension.from.log_size).toBe(1);
    expect(result.extension.to.log_size).toBe(2);
  });

  it('refuses a checkpoint that does not extend the last accepted one', () => {
    // A producer rewriting history has to get this past a third party.
    const svc = newService({ acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE] });
    const honest = newLog();
    honest.append({ id: capsuleId(0) });
    honest.append({ id: capsuleId(1) });
    svc.register(Buffer.from(honest.checkpoint().cose_sign1_b64, 'base64'));

    // Same log id, different history: leaf 1 replaced.
    const forked = newLog();
    forked.append({ id: capsuleId(0) });
    forked.append({ id: capsuleId(77) });
    const result = svc.register(Buffer.from(forked.checkpoint().cose_sign1_b64, 'base64'));

    expect(result.registered).toBe(false);
    expect(result.reason).toMatch(/does not extend/);
  });

  it('keeps separate histories per log id', () => {
    const svc = newService({ acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE] });
    const a = newLog('log-a');
    const b = newLog('log-b');
    a.append({ id: capsuleId(0) });
    b.append({ id: capsuleId(1) });
    expect(svc.register(Buffer.from(a.checkpoint().cose_sign1_b64, 'base64')).registered).toBe(true);
    expect(svc.register(Buffer.from(b.checkpoint().cose_sign1_b64, 'base64')).registered).toBe(true);
  });
});

describe('RFC 9942 receipt', () => {
  const registerOne = () => {
    const svc = newService();
    const statement = capsuleStatement();
    const result = svc.register(statement);
    return { svc, statement, result };
  };

  it('carries the receipt headers the spec assigns', () => {
    const { result } = registerOne();
    const parsed = parseSign1(Buffer.from(result.receipt.cose_sign1_b64, 'base64'));
    expect(parsed.protectedHeader.get(HEADER.vds)).toBe(VDS.MMR_SHA256);
    expect(parsed.protectedHeader.get(HEADER.content_type)).toBe(RECEIPT_MEDIA_TYPE);
    expect(parsed.unprotected.get(HEADER.vdp)).toBeInstanceOf(Map);
    expect(parsed.unprotected.get(HEADER.vdp).get(VDP.inclusion)).toHaveLength(1);
  });

  it('is signed by the service, not by the producer', () => {
    const { result } = registerOne();
    const parsed = parseSign1(Buffer.from(result.receipt.cose_sign1_b64, 'base64'));
    expect(parsed.protectedHeader.get(HEADER.kid).toString('hex')).toBe(
      witness.rawPublicKey.toString('hex'),
    );
    expect(parsed.protectedHeader.get(HEADER.kid).toString('hex')).not.toBe(
      producer.rawPublicKey.toString('hex'),
    );
  });

  it('commits to a 32-byte published root', () => {
    const { svc, result } = registerOne();
    const parsed = parseSign1(Buffer.from(result.receipt.cose_sign1_b64, 'base64'));
    expect(parsed.payload).toHaveLength(32);
    expect(parsed.payload.toString('hex')).toBe(svc.publishedRoot());
  });

  it('verifies offline against the statement bytes', () => {
    const { statement, result } = registerOne();
    const v = verifyReceipt({ receipt: result.receipt, statementBytes: statement });
    expect(v.ok).toBe(true);
    expect(v.steps.every((s) => s.ok)).toBe(true);
  });

  it('verifies without the service key being supplied', () => {
    // "offline check - the issuer's key not required"
    const { statement, result } = registerOne();
    expect(verifyReceipt({ receipt: result.receipt, statementBytes: statement }).ok).toBe(true);
  });

  it('verifies when the expected service key is pinned', () => {
    const { statement, result } = registerOne();
    expect(
      verifyReceipt({ receipt: result.receipt, statementBytes: statement, serviceKey: witness.publicKey }).ok,
    ).toBe(true);
  });

  it('fails when pinned to the wrong service key', () => {
    const { statement, result } = registerOne();
    const v = verifyReceipt({
      receipt: result.receipt,
      statementBytes: statement,
      serviceKey: attacker.publicKey,
    });
    expect(v.ok).toBe(false);
  });

  it('fails when presented with a different statement', () => {
    // The receipt names one specific set of bytes, recomputed by the verifier.
    const { result } = registerOne();
    const other = capsuleStatement({ actionClass: 'other' });
    const v = verifyReceipt({ receipt: result.receipt, statementBytes: other });
    expect(v.ok).toBe(false);
    expect(v.steps.find((s) => s.name.includes('included under')).ok).toBe(false);
  });

  it('fails when the statement is altered by one byte', () => {
    const { statement, result } = registerOne();
    const tampered = Buffer.from(statement);
    tampered[10] ^= 0x01;
    expect(verifyReceipt({ receipt: result.receipt, statementBytes: tampered }).ok).toBe(false);
  });

  it('detects a proof swapped between the CBOR and presented forms', () => {
    // A receipt must not be able to carry one proof for machines and another
    // for humans reading the JSON.
    const { statement, result } = registerOne();
    const receipt = JSON.parse(JSON.stringify(result.receipt));
    receipt.proof.path = [{ hash: 'ab'.repeat(32), side: 'right' }];
    const v = verifyReceipt({ receipt, statementBytes: statement });
    expect(v.ok).toBe(false);
  });

  it('stays verifiable as the service log grows around it', () => {
    // An early receipt keeps proving inclusion under ITS root even after the
    // log advances; consistency between roots is a separate claim.
    const svc = newService();
    const first = capsuleStatement({ actionClass: 'a' });
    const firstResult = svc.register(first);
    for (let i = 0; i < 10; i += 1) svc.register(capsuleStatement({ actionClass: `class-${i}` }));
    expect(verifyReceipt({ receipt: firstResult.receipt, statementBytes: first }).ok).toBe(true);
    expect(svc.publishedRoot()).not.toBe(firstResult.receipt.root);
  });

  it('states its scope: what it establishes and what it does not', () => {
    const { result } = registerOne();
    expect(result.scope.establishes.length).toBeGreaterThan(0);
    expect(result.scope.doesNotEstablish.join(' ')).toMatch(/claim inside the statement is true/);
  });

  it('witnesses a CLL checkpoint, so every record inherits the stamp', () => {
    // The briefing: "The stamp lands on the checkpoint; every record inherits
    // it through its inclusion proof." This test walks that whole sentence.
    const svc = newService({ acceptedContentTypes: [CHECKPOINT_MEDIA_TYPE] });
    const log = newLog();
    for (let i = 0; i < 6; i += 1) log.append({ id: capsuleId(i) });
    const cp = log.checkpoint();
    const cpBytes = Buffer.from(cp.cose_sign1_b64, 'base64');

    // 1. The witness stamps the checkpoint, and only the checkpoint.
    const result = svc.register(cpBytes);
    expect(result.registered).toBe(true);
    expect(verifyReceipt({ receipt: result.receipt, statementBytes: cpBytes }).ok).toBe(true);

    // 2. One record, chosen after the fact, proves inclusion in the very
    //    commitment the witness stamped - so it inherits the timestamp
    //    without the witness ever having seen the record.
    const inclusion = verifyInclusion({
      leafHash: Buffer.from(log.entries[4].leaf_hash, 'hex'),
      proof: log.proofFor(4),
      root: cp.claims.commitment,
    });
    expect(inclusion.ok).toBe(true);
    expect(inclusion.computedRoot).toBe(cp.claims.commitment);

    // 3. Only the ~200-byte checkpoint ever left the producer.
    expect(cp.bytes_on_the_wire).toBeLessThan(600);
  });
});
