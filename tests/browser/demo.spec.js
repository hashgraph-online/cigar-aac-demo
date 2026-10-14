import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function run(page, id = 'clean-settlement') {
  const response = page.waitForResponse((response) => response.url().endsWith('/api/run/' + id) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  const result = await (await response).json();
  await expect(page.getByRole('tab', { name: /Know/ })).toBeVisible();
  return result;
}

test('HOL brand and the first-run tour explain local and optional public witnessing', async ({ page }, info) => {
  const submissions = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/run/')) submissions.push(request.url());
  });
  await page.goto('/');
  await expect(page).toHaveTitle('HOL — CIGAR x AAC Demo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CIGAR x AAC Demo');
  await expect(page.getByRole('link', { name: 'HOL home' }).getByRole('img', { name: 'HOL', exact: true })).toBeVisible();
  await expect(page.locator('.proof-header')).not.toContainText('AAIF');
  await page.getByRole('link', { name: 'Set up Hedera testnet' }).click();
  const tour = page.locator('#demo-guide');
  const setup = page.locator('#hedera-setup');
  await expect(tour).toHaveAttribute('open', '');
  await expect(setup).toHaveAttribute('open', '');
  await expect(setup.getByRole('link', { name: 'Hedera Portal' })).toHaveAttribute('href', 'https://portal.hedera.com/');
  await expect(setup.getByLabel('Hedera testnet configuration')).toContainText('YOUR_DER_PRIVATE_KEY');
  await expect(tour).toContainText('No account, API key or model provider is needed');
  await expect(setup).toContainText('No mainnet submission is supported');
  expect(submissions).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: info.outputPath('hol-onboarding.png'), fullPage: true });
});

test('AAC draft 5 inspector shows the current run JSON and its source mapping', async ({ page }, info) => {
  const executions = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/run/')) executions.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: /A gateway goes quiet/ }).click();
  const result = await run(page, 'unknown-reconcile');
  await page.getByRole('tab', { name: /Prove/ }).click();
  const inspector = page.locator('.aac-inspector');
  const draft = inspector.getByRole('link', { name: 'Read AAC draft 5' });
  await expect(draft).not.toBeVisible();
  await inspector.locator(':scope > summary').click();
  await expect(draft).toHaveAttribute('href', 'https://datatracker.ietf.org/doc/html/draft-mih-scitt-agent-action-capsule-05');
  await expect(draft).toBeVisible();
  await expect(inspector).toContainText('AAC does not mandate those four slots');
  await expect(inspector.getByRole('link', { name: '§5.5.5' })).toBeVisible();
  for (const [index, item] of result.bundle.capsules.entries()) {
    const record = inspector.locator('.aac-json-record').nth(index);
    if (index > 0) await record.locator(':scope > summary').click();
    const json = record.getByLabel('AAC JSON: ' + item.label);
    await expect(json).toBeVisible();
    expect(JSON.parse(await json.textContent())).toEqual(item.capsule);
    expect(item.capsule.spec_version).toBe('draft-mih-scitt-agent-action-capsule-05');
    expect(item.capsule.format_version).toBe('4');
  }
  const members = inspector.locator('.aac-member-inspector').first();
  await members.locator(':scope > summary').click();
  await members.locator('summary').filter({ hasText: 'CAN · cigar-signed-handoff' }).click();
  expect(JSON.parse(await members.getByLabel('CAN artifact JSON').textContent())).toEqual(result.bundle.referenced_artifacts.signed_handoff);
  expect(executions).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: info.outputPath('aac-draft-5.png'), fullPage: true });
  await inspector.locator(':scope > summary').click();
  await expect(draft).not.toBeVisible();
});

test('real native execution, every scenario, every chapter, no page errors', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('CIGAR 0.14.0 ready')).toBeVisible();
  await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true });
  const situations = [
    ['clean-settlement', 'A payment done right', 'Payment confirmed', true],
    ['policy-block', 'An over-limit request', 'Payment blocked', true],
    ['unknown-reconcile', 'A gateway goes quiet', 'Reconciled · retry suppressed', true],
    ['poisoned-context', 'A poisoned inbox', 'Untrusted sources excluded', true],
    ['tamper', 'An edited receipt', 'Tampering detected', false],
  ];
  for (const [id, label, outcome, ok] of situations) {
    await page.getByRole('button', { name: new RegExp(label) }).click();
    const result = await run(page, id);
    expect(result.artifacts.cigar.version).toBe('0.14.0');
    expect(result.ok).toBe(ok);
    await expect(page.locator('.outcome-banner')).toContainText(outcome);
    await expect(page.getByText('Local witness only', { exact: true })).toBeVisible();
    for (const verb of ['Know', 'Act', 'Prove', 'Witness', 'Verify']) {
      await page.getByRole('tab', { name: new RegExp(verb) }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const stage = await page.locator('.execution-space').boundingBox();
      const workspace = await page.locator('.demo-workspace').boundingBox();
      expect(stage.width).toBeLessThanOrEqual(workspace.width);
    }
    if (id === 'poisoned-context') {
      await page.getByRole('tab', { name: /Know/ }).click();
      await page.screenshot({ path: info.outputPath('poisoned-context.png'), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('download is the exact run, verifies in CLI, can be imported, and all edits are caught', async ({ page }) => {
  await page.goto('/');
  const result = await run(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download this run’s evidence' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const bundle = JSON.parse(await readFile(path, 'utf8'));
  expect(bundle).toEqual(result.bundle);
  const verified = spawnSync(process.execPath, ['packages/verifier/src/cli.js', path], { encoding: 'utf8' });
  expect(verified.status, verified.stdout + verified.stderr).toBe(0);
  await page.getByLabel('Upload an evidence bundle').setInputFiles({ name: 'evidence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByText('Evidence verified', { exact: true })).toBeVisible();
  for (const target of ['capsule', 'capsule-operator', 'handoff', 'manifest', 'checkpoint', 'proof']) {
    await page.getByLabel('Evidence field to tamper with').selectOption(target);
    await page.getByRole('button', { name: 'Edit & verify' }).click();
    await expect(page.getByText('Edit detected', { exact: true })).toBeVisible();
  }
  bundle.capsules[0].capsule.operator = 'edited-company';
  await page.getByLabel('Upload an evidence bundle').setInputFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByText('Evidence rejected', { exact: true })).toBeVisible();
  await page.getByLabel('Upload an evidence bundle').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(page.getByText('This file is not valid JSON.', { exact: true })).toBeVisible();
  await page.getByLabel('Upload an evidence bundle').setInputFiles({ name: 'ambiguous.json', mimeType: 'application/json', buffer: Buffer.from('{"capsules":[],"capsules":[]}') });
  await expect(page.getByText('This file contains duplicate JSON member names.', { exact: true })).toBeVisible();
});

test('accessible overview, chapters and keyboard navigation', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByText('CIGAR 0.14.0 ready')).toBeVisible();
  const violations = [];
  async function audit(state) {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    violations.push(...results.violations.map((violation) => ({ state, id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })) })));
  }
  await audit('overview');
  await run(page);
  for (const verb of ['Know', 'Act', 'Prove', 'Witness', 'Verify']) {
    await page.getByRole('tab', { name: new RegExp(verb) }).click();
    await audit(verb);
  }
  const firstTab = page.getByRole('tab', { name: /Know/ });
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Act/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /Act/ })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath('action.png'), fullPage: true });
  await page.getByRole('tabpanel').screenshot({ path: info.outputPath('action-detail.png') });
  await info.attach('accessibility.json', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  expect([...new Set(violations.flatMap((violation) => violation.nodes.map((node) => violation.id + ': ' + node.target.join(' '))))]).toEqual([]);
});

test('connection failures explain recovery without a dead run control', async ({ page }) => {
  await page.route('**/api/reference', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test connection failure' }) }));
  await page.goto('/');
  await expect(page.getByText('Couldn’t connect to the demo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run this scenario' })).toBeDisabled();
  await page.unroute('**/api/reference');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run this scenario' })).toBeEnabled();
  await page.route('**/api/run/*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Native worker unavailable' }) }));
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(page.getByText('The run did not complete.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run this scenario' })).toBeEnabled();
});

test('API validates requests, isolates run domains and downloads without re-executing', async ({ request }) => {
  const first = await (await request.post('/api/run/clean-settlement', { data: {} })).json();
  const second = await (await request.post('/api/run/clean-settlement', { data: {} })).json();
  expect(first.run_id).not.toBe(second.run_id);
  expect(first.artifacts.cigar.compiled.context.snapshot.domain).not.toBe(second.artifacts.cigar.compiled.context.snapshot.domain);
  expect(first.bundle.cll.log_id).not.toBe(second.bundle.cll.log_id);
  const original = await (await request.get('/api/runs/' + first.run_id + '/bundle')).json();
  expect(original).toEqual(first.bundle);
  expect((await request.post('/api/run/unknown-scenario', { data: {} })).status()).toBe(400);
  expect((await request.post('/api/run/clean-settlement', { data: { witness: 'invalid' } })).status()).toBe(400);
  expect((await request.post('/api/run/clean-settlement', { data: { witness: 'hedera' } })).status()).toBe(409);
  expect((await request.get('/api/runs/missing/bundle')).status()).toBe(404);
  expect((await request.post('/api/run/clean-settlement', { data: {}, headers: { origin: 'https://unrelated.example' } })).status()).toBe(403);
  const empty = await (await request.post('/api/verify', { data: { bundle_format: 'cigar-aac-evidence-bundle/v1', capsules: [] } })).json();
  expect(empty.ok).toBe(false);
});
