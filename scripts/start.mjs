import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './runtime.mjs';
import { setup } from './setup.mjs';

try {
  setup({ force: process.argv.includes('--force') });
  const env = { ...process.env, ...(process.argv.includes('--offline') ? { DEMO_OFFLINE: '1' } : {}) };
  const child = spawn(process.execPath, [resolve(root, 'apps/server/src/index.js')], { cwd: root, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  let exited = false;
  let listening = false;
  let readyPort = Number(env.PORT ?? 4319);
  child.on('message', (message) => { if (message?.type === 'hol-demo-ready') { listening = true; readyPort = message.port; } });
  child.on('error', (error) => { exited = true; console.error('Could not start the demo: ' + error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { exited = true; process.exitCode = process.exitCode || (signal ? 0 : (code ?? 1)); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
  let ready = false;
  const deadline = Date.now() + 30_000;
  while (!exited && Date.now() < deadline) {
    try {
      if (!listening) throw new Error('Waiting for this server to listen');
      const response = await fetch(`http://127.0.0.1:${readyPort}/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      ready = response.ok && health.ok === true && health.demo === 'hol-proof-of-action';
      if (ready) break;
    } catch { /* The child is still starting. */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (ready && !exited) {
    const url = `http://localhost:${readyPort}`;
    console.log(`\nReady: ${url}\nStart with “A payment done right”, then follow Know → Act → Prove → Witness → Verify.\nOpen “How to use this demo” for a short tour and optional Hedera setup.\nPress Ctrl+C to stop.\n`);
    if (!process.argv.includes('--no-open') && process.env.BROWSER !== 'none') {
      const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
      const opened = spawnSync(executable, args, { stdio: 'inherit', timeout: 10_000 });
      if (opened.error || opened.status !== 0) console.log(`Open ${url} in your browser to continue.`);
    }
  } else if (!exited) {
    console.error('The demo did not become healthy within 30 seconds. Check the startup message above or run npm run doctor.');
    child.kill('SIGTERM'); process.exitCode = 1;
  }
} catch (error) { console.error('\nCould not start: ' + error.message); process.exitCode = 1; }
