import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, requireNode, ensurePython, installPython, doctor, npm, python } from './runtime.mjs';

function hashFiles(paths) {
  const hash = createHash('sha256');
  for (const path of paths.sort()) { hash.update(path); hash.update(readFileSync(resolve(root, path))); }
  return hash.digest('hex');
}
function sourceFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (['dist', 'node_modules'].includes(entry.name)) return [];
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}
export function setup({ force = false } = {}) {
  requireNode();
  ensurePython(); // Fail on missing prerequisites before downloading anything.
  const cacheFile = resolve(root, '.demo-setup.json');
  let previous = {};
  if (existsSync(cacheFile)) { try { previous = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { /* Rebuild an invalid non-secret cache. */ } }
  const manifests = ['package.json', 'package-lock.json', ...['apps', 'packages'].flatMap((base) => readdirSync(resolve(root, base)).map((name) => `${base}/${name}/package.json`))];
  const dependencies = hashFiles(manifests) + ':' + process.platform + ':' + process.arch + ':' + process.versions.node.split('.')[0];
  console.log('\nHOL · Proof of action\n');
  if (force || previous.dependencies !== dependencies || !existsSync(resolve(root, 'node_modules/.package-lock.json'))) {
    console.log('[1/4] Installing the locked JavaScript dependencies…');
    npm(['ci', '--no-fund', '--no-audit']);
  } else console.log('[1/4] JavaScript dependencies ready.');
  const native = hashFiles(['requirements.txt']) + ':' + python();
  if (force || previous.native !== native) {
    console.log('[2/4] Installing the pinned CIGAR Python environment…');
    installPython();
  } else console.log('[2/4] Python environment ready.');
  console.log('[3/4] Checking the real CIGAR worker…');
  try { doctor(); } catch (error) {
    if (force || previous.native !== native) throw error;
    installPython(); doctor();
  }
  const dashboard = hashFiles([...sourceFiles('apps/dashboard'), 'package-lock.json']);
  if (force || previous.dashboard !== dashboard || !existsSync(resolve(root, 'apps/dashboard/dist/index.html'))) {
    console.log('[4/4] Building the dashboard…');
    npm(['run', 'build']);
  } else console.log('[4/4] Dashboard ready.');
  writeFileSync(cacheFile, JSON.stringify({ dependencies, native, dashboard }, null, 2) + '\n');
  console.log('\nSetup complete. CIGAR 0.14.0 compiled and verified context successfully.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup({ force: process.argv.includes('--force') }); }
  catch (error) { console.error('\nSetup stopped: ' + error.message); process.exitCode = 1; }
}
