import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static checks on the dashboard source, for bugs that read correctly in
 * review and only show up on screen.
 */

const DIR = import.meta.dirname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.jsx'));

describe('JSX copy', () => {
  it('has no \\uXXXX escape inside a plain JSX attribute string', () => {
    // JSX attribute values in double quotes are NOT JavaScript strings, so
    // escapes are not processed: eyebrow="Evidence · x" rendered the six
    // literal characters, which the eyebrow style upper-cased to "\U00B7".
    // Use the real character, or a JS expression: eyebrow={'Evidence · x'}.
    const offenders = [];
    for (const f of files) {
      readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\b[a-zA-Z]+="[^"{}]*\\u[0-9a-fA-F]{4}[^"{}]*"/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('has no \\uXXXX escape in JSX text children', () => {
    const offenders = [];
    for (const f of files) {
      readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (/>[^<>{}]*\\u[0-9a-fA-F]{4}[^<>{}]*</.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('does not declare React components inside another component’s render', () => {
    // A component defined inside render is a new type every render, so React
    // remounts it and drops focus. The dock's button was one; it is now a
    // render function. Heuristic: an indented `const Name = (...) => (` line.
    const offenders = [];
    for (const f of files) {
      readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (/^\s{2,}const [A-Z][A-Za-z]+ = \([^)]*\) => \(/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
