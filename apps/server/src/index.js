import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runScenario, SCENARIOS, TAMPER_TARGETS, applyTamper } from './engine.js';
import { anchorRun } from './anchor.js';
import { closeHederaWitness } from './hedera-client.js';
import { hederaPublicConfig, loadEnv } from './env.js';
import { checkCigarRuntime } from './cigar.js';
import { verifyEvidenceBundle } from '@cigar-aac/verifier';
import { parseJson } from '@cigar-aac/cpb';
import { FOUR_QUESTIONS, LAYERS, OPEN_QUESTIONS, PROOF_SOURCES, GLOSSARY, TERMS, SPEC_SOURCES, STATUS_NOTE } from './reference.js';

/** Importing the app never listens, reads .env, or makes a network call. */
export function createApp({ run = runScenario, anchor = anchorRun, config = hederaPublicConfig, runtime = checkCigarRuntime() } = {}) {
  const app = express();
  const runs = new Map();
  app.use(express.json({ limit: '4mb', verify(_req, _res, bytes) {
    try { parseJson(bytes.toString('utf8')); }
    catch (error) { error.status = 400; throw error; }
  } }));
  app.use('/api', (req, res, next) => {
    // Vite proxies same-origin requests. Do not grant arbitrary websites
    // cross-origin access to an operator-funded local demo.
    if (req.method === 'POST' && req.headers.origin) {
      try {
        const host = new URL(req.headers.origin).hostname;
        if (host !== req.hostname && !(['localhost', '127.0.0.1', '[::1]'].includes(host) && ['localhost', '127.0.0.1', '::1'].includes(req.hostname))) {
          return res.status(403).json({ error: 'Use the demo from its own origin.' });
        }
      } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
    }
    next();
  });

  function remember(result, runId) {
    const stored = serialize({ ...result, run_id: runId, executed_at: new Date().toISOString() });
    runs.set(stored.run_id, stored);
    while (runs.size > 50) runs.delete(runs.keys().next().value);
    return stored;
  }
  function lookup(req, res) {
    const result = runs.get(req.params.runId);
    if (!result) res.status(404).json({ error: 'This run is no longer available. Run the scenario again.' });
    return result;
  }
  function download(res, result) {
    return res.set('Content-Disposition', 'attachment; filename="hol-evidence-' + result.scenario.id + '.json"')
      .type('json').send(JSON.stringify(result.bundle, null, 2));
  }

  app.get('/api/reference', (_req, res) => res.json({
    four_questions: FOUR_QUESTIONS, layers: LAYERS, open_questions: OPEN_QUESTIONS,
    proof_sources: PROOF_SOURCES, glossary: GLOSSARY, terms: TERMS, spec_sources: SPEC_SOURCES,
    status_note: STATUS_NOTE, hedera: config(), cigar: runtime, scenarios: SCENARIOS,
    tamper_targets: TAMPER_TARGETS.map(({ resolve: _resolve, plainFor, ...target }) => target),
  }));
  app.get('/api/scenarios', (_req, res) => res.json(SCENARIOS));
  app.get('/api/health', (_req, res) => res.status(runtime.ready ? 200 : 503).json({
    demo: 'hol-proof-of-action',
    ok: runtime.ready, scenarios: SCENARIOS.length, cigar: runtime, hedera: config(),
  }));

  app.post('/api/run/:id', async (req, res, next) => {
    try {
      if (!runtime.ready) return res.status(503).json({ error: runtime.error });
      const witness = req.body?.witness ?? 'local';
      if (!['local', 'hedera'].includes(witness)) return res.status(400).json({ error: 'Unknown witness mode.' });
      if (witness === 'hedera' && !config().configured) return res.status(409).json({ error: config().error ?? 'Hedera is not configured. Open the setup guide or use the local witness.' });
      const runId = randomUUID();
      const result = run(req.params.id, { runId });
      const completed = witness === 'hedera' ? await anchor(result) : result;
      res.json(remember(completed, runId));
    } catch (error) { next(error); }
  });

  app.get('/api/runs/:runId/bundle', (req, res) => {
    const result = lookup(req, res);
    if (result) download(res, result);
  });
  app.post('/api/runs/:runId/tamper', (req, res, next) => {
    try {
      const base = lookup(req, res);
      if (!base) return;
      const { bundle, applied } = applyTamper(base.bundle, { target: req.body?.target ?? 'capsule' });
      res.json({ run_id: base.run_id, applied, before: verifyEvidenceBundle(base.bundle), after: verifyEvidenceBundle(bundle), bundle });
    } catch (error) { next(error); }
  });
  app.post('/api/verify', (req, res, next) => {
    try { res.json(verifyEvidenceBundle(req.body)); }
    catch (error) { next(error); }
  });

  // Compatibility endpoints execute locally; GET never publishes to Hedera.
  app.get('/api/bundle/:id', (req, res, next) => {
    try { download(res, run(req.params.id, { runId: randomUUID() })); } catch (error) { next(error); }
  });
  app.post('/api/tamper/:id', (req, res, next) => {
    try {
      const base = run(req.params.id, { runId: randomUUID() });
      const { bundle, applied } = applyTamper(base.bundle, { target: req.body?.target ?? 'capsule' });
      res.json({ applied, before: base.verification, after: verifyEvidenceBundle(bundle), bundle });
    } catch (error) { next(error); }
  });
  app.get('/api/stream/:id', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event) => res.write('data: ' + JSON.stringify(event) + '\n\n');
    try {
      const runId = randomUUID();
      const result = remember(run(req.params.id, { emit: send, runId }), runId);
      send({ kind: 'run.complete', ok: result.ok, run_id: result.run_id, summary: result.verification.summary });
    } catch (error) { send({ kind: 'run.error', error: error.message }); }
    res.end();
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, _req, res, _next) => res.status(error.status ?? 400).json({
    error: error.type === 'entity.parse.failed' ? 'The evidence file is not valid JSON.' : error.message,
  }));
  const dist = resolve(import.meta.dirname, '../../dashboard/dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  return app;
}

function serialize(result) {
  return JSON.parse(JSON.stringify(result, (_key, value) =>
    value?.type === 'Buffer' && Array.isArray(value.data) ? Buffer.from(value.data).toString('hex') : value));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const app = createApp();
  const port = Number(process.env.PORT ?? 4319);
  const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log('HOL · Proof of action · http://localhost:' + actualPort);
    process.send?.({ type: 'hol-demo-ready', port: actualPort });
    console.log('Payment simulation · real context compilation, signatures and verification');
  });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other server or choose a different PORT.` : error.message);
    closeHederaWitness(); if (process.connected) process.disconnect(); process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    closeHederaWitness(); if (process.connected) process.disconnect(); server.close(); server.closeIdleConnections();
  });
}
