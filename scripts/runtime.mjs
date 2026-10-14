import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const venvPython = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
export const python = () => process.env.CIGAR_PYTHON || venvPython;
export function requireNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 12) || major === 24 || major >= 26)) throw new Error('Install Node.js 24 LTS (or a supported Node.js 22.12+) from https://nodejs.org, then run npm start again.');
}
export function command(executable, args, { capture = false, env = process.env, timeout = 900_000 } = {}) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', timeout });
  if (result.error || result.status !== 0) {
    if (capture && result.stdout) process.stderr.write(result.stdout);
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${executable} failed${result.error ? ': ' + result.error.message : ' (exit ' + result.status + ')'}`);
  }
  return result.stdout;
}
export function npm(args) {
  if (!process.env.npm_execpath) throw new Error('Run this setup through npm start or npm run setup.');
  return command(process.execPath, [process.env.npm_execpath, ...args]);
}
function version(executable, prefix = []) {
  const result = spawnSync(executable, [...prefix, '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 && result.stdout.trim() === '3.14';
}
export function ensurePython() {
  const target = python();
  if (process.env.CIGAR_PYTHON && !isAbsolute(target)) throw new Error('CIGAR_PYTHON must be an absolute path to a Python 3.14 virtual-environment interpreter.');
  if (existsSync(target)) {
    if (!version(target)) throw new Error(`${target} must use Python 3.14. Rename an incompatible .venv and rerun npm start, or set CIGAR_PYTHON to a Python 3.14 environment.`);
    return target;
  }
  if (process.env.CIGAR_PYTHON) throw new Error('CIGAR_PYTHON does not exist. Point it to an existing Python 3.14 virtual environment.');
  const candidates = process.platform === 'win32'
    ? [['py', ['-3.14']], ['python3.14', []], ['python', []]]
    : [['python3.14', []], ['python3', []], ['python', []]];
  const match = candidates.find(([executable, prefix]) => version(executable, prefix));
  if (!match) throw new Error('Python 3.14 was not found. Install Python 3.14 from https://www.python.org/downloads/ with pip/venv, then run npm start again. No Rust compiler is required.');
  command(match[0], [...match[1], '-m', 'venv', resolve(root, '.venv')]);
  return target;
}
export function installPython() {
  const executable = ensurePython();
  command(executable, ['-m', 'pip', 'install', '--only-binary=:all:', '-r', resolve(root, 'requirements.txt')], { env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
  return executable;
}
export function doctor() {
  const report = JSON.parse(command(python(), ['-m', 'cigar_sdk.local_cli', 'doctor', '--json'], { capture: true, timeout: 30_000 }));
  if (report.status !== 'ready' || !report.compile_verified || report.capabilities?.package_version !== '0.14.0' || report.worker_capabilities?.core_version !== '0.14.0') throw new Error('CIGAR 0.14.0 did not pass its native compile/verify check. Run npm run setup:cigar.');
  return report;
}
