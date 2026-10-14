import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { root, requireNode } from './runtime.mjs';
requireNode();
const children = [
  spawn(process.execPath, [resolve(root, 'apps/server/src/index.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js')], { cwd: resolve(root, 'apps/dashboard'), stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; process.exitCode = code; for (const child of children) child.kill('SIGTERM'); }
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code ?? 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
