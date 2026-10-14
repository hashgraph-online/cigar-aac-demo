#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseJson } from '@cigar-aac/cpb';
import { verifyEvidenceBundle } from './verify.js';

/**
 * Standalone offline verification.
 *
 *   node packages/verifier/src/cli.js <bundle.json> [--json] [--online]
 *
 * Deliberately has no build step and no dependency on a running server: the
 * claim "a third party can check this" is worth nothing if checking it needs
 * the producer's infrastructure.
 *
 * --online is the single exception, and it is opt-in: when the bundle carries a
 * public anchor, it re-reads that message from a Hedera mirror node so the
 * consensus timestamp is confirmed by the network rather than taken from the
 * receipt. Everything else is checked with no network at all.
 */

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantOnline = args.includes('--online');
const path = args.find((a) => !a.startsWith('--'));

if (!path) {
  console.error('usage: node packages/verifier/src/cli.js <evidence-bundle.json> [--json] [--online]');
  process.exit(2);
}

let bundle;
try {
  bundle = parseJson(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`cannot read bundle: ${e.message}`);
  process.exit(2);
}

/**
 * Optionally re-read a public anchor. Uses built-in fetch, so even the online
 * path adds no dependency.
 */
let mirrorRecord = null;
let mirrorNote = null;
const anchor = bundle?.scitt?.hedera ?? null;

if (wantOnline && anchor?.mirror_url) {
  try {
    const res = await fetch(anchor.mirror_url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      mirrorRecord = await res.json();
      mirrorNote = `re-read from ${anchor.mirror_url}`;
    } else {
      mirrorNote = `mirror node returned ${res.status}; anchor not confirmed`;
    }
  } catch (e) {
    mirrorNote = `mirror node unreachable (${e.message}); anchor not confirmed`;
  }
} else if (wantOnline) {
  mirrorNote = 'this bundle carries no public anchor, so --online had nothing to check';
} else if (anchor) {
  mirrorNote = 'pass --online to confirm the public anchor against a mirror node';
}

const result = verifyEvidenceBundle(bundle, { mirrorRecord });

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// Colour, only when stdout is a terminal.
const ESC = String.fromCharCode(27);
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code) => (tty ? `${ESC}[${code}m` : '');
const GREEN = sgr(32);
const RED = sgr(31);
const DIM = sgr(2);
const BOLD = sgr(1);
const OFF = sgr(0);

console.log('');
console.log(`${BOLD}CIGAR + AAC evidence bundle${OFF}  ${DIM}${path}${OFF}`);
if (bundle.scenario) console.log(`${DIM}scenario:${OFF} ${bundle.scenario.title}`);
console.log(
  `${DIM}witness:${OFF} ${anchor
    ? `Hedera ${anchor.network} \u00b7 topic ${anchor.topic_id} \u00b7 sequence ${anchor.sequence_number}`
    : 'local transparency service'}`,
);
if (mirrorNote) console.log(`${DIM}anchor:${OFF}  ${mirrorNote}`);
console.log('');

let lastGroup = null;
for (const c of result.checks) {
  if (c.id !== lastGroup) {
    console.log(`${DIM}--- check ${c.id}${OFF}`);
    lastGroup = c.id;
  }
  console.log(`  [${c.ok ? `${GREEN}PASS${OFF}` : `${RED}FAIL${OFF}`}] ${c.name}`);
  console.log(`         ${DIM}${c.detail}${OFF}`);
  if (!c.ok && c.expected && c.computed) {
    console.log(`         ${RED}expected${OFF} ${c.expected}`);
    console.log(`         ${RED}computed${OFF} ${c.computed}`);
  }
}

console.log('');
console.log(
  `${result.ok ? `${GREEN}${BOLD}PASS${OFF}` : `${RED}${BOLD}FAIL${OFF}`}  ` +
    `${result.summary.passed}/${result.summary.total} checks, ` +
    `${result.summary.records} record(s), log size ${result.summary.log_size}, ` +
    `${result.summary.witnessed ? 'witnessed' : 'self-attested'}`,
);

if (!result.ok) {
  console.log(`${RED}first failure:${OFF} ${result.summary.first_failure.name}`);
  console.log(`              ${result.summary.first_failure.detail}`);
}

console.log('');
console.log(`${BOLD}What this ${result.ok ? 'establishes' : 'would have established'}${OFF}`);
for (const s of result.scope.establishes) console.log(`  + ${s}`);
console.log('');
console.log(`${BOLD}What it does NOT establish${OFF}`);
for (const s of result.scope.doesNotEstablish) console.log(`  - ${s}`);
console.log('');
console.log(`${DIM}${result.scope.note}${OFF}`);
console.log('');

process.exit(result.ok ? 0 : 1);
