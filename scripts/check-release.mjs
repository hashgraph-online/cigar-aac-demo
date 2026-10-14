import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './runtime.mjs';

const required = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md', 'SECURITY.md', 'README.md', 'docs/HEDERA-SETUP.md', 'docs/STANDARDS.md', 'docs/RELEASE-READINESS.md', '.github/workflows/ci.yml'];
const errors = [];
for (const file of required) if (!existsSync(resolve(root, file))) errors.push(`Missing ${file}`);
const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
if (listed.status !== 0) errors.push('Source publication checks require a Git checkout; run them in the repository before publishing.');
const paths = [...new Set((listed.stdout ?? '').split('\0').filter(Boolean))];
const forbidden = /^(?:\.claude\/|\.codex\/|\.venv\/|node_modules\/|artifacts\/|test-results\/|playwright-report\/|\.demo-setup\.json$|CIGAR_AAC_AAIF_3_Page_Brief\.pdf$)|(?:^|\/)\.env(?:\..*)?$/;
let checked = 0;
for (const path of paths) {
  if (path === '.env.example') continue; // Never inspect local environment files.
  if (forbidden.test(path)) { errors.push(`Excluded local file is in the publication set: ${path}`); continue; }
  if (!/\.(?:js|jsx|mjs|json|md|txt|ya?ml|py|html|css|svg)$/.test(path) || !existsSync(resolve(root, path))) continue;
  const source = readFileSync(resolve(root, path), 'utf8'); checked += 1;
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /HEDERA_PRIVATE_KEY\s*=\s*["']?(?:0x)?[a-fA-F0-9]{64,}/,
  ];
  if (patterns.some((pattern) => pattern.test(source))) errors.push(`Possible credential material in ${path}; inspect locally before publication.`);
}
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json')));
if (pkg.license !== 'Apache-2.0' || !pkg.private) errors.push('The repository needs Apache-2.0 metadata and an npm publication guard.');
const requirements = readFileSync(resolve(root, 'requirements.txt'), 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
if (requirements.some((line) => !/^[\w-]+==[\w.+-]+$/.test(line))) errors.push('Python dependencies must use exact version pins.');
const app = readFileSync(resolve(root, 'apps/dashboard/src/App.jsx'), 'utf8');
const html = readFileSync(resolve(root, 'apps/dashboard/index.html'), 'utf8');
if (/HOL X AAIF/.test(app + html)) errors.push('Remove the old co-brand from the active interface.');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Release source checks passed: ${checked} text files checked; local environments, credentials, generated evidence and the background PDF excluded. Fixed signing seeds remain documented public fixtures.`);
