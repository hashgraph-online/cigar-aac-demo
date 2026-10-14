import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The AAIF brief sets a design constraint on this codebase, not just a wish:
 *
 *   "Test the seam without merging the specifications or expanding either
 *    layer beyond its core purpose."
 *
 * and, on the verifier specifically:
 *
 *   "an independent verifier checks the record without needing CIGAR internals."
 *
 * A comment claiming independence is worth nothing. These tests make the
 * boundary a build failure if anyone crosses it.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const pkgPath = (name) => join(ROOT, 'packages', name, 'package.json');
const readPkg = (name) => JSON.parse(readFileSync(pkgPath(name), 'utf8'));

function sourceFiles(pkg) {
  const dir = join(ROOT, 'packages', pkg, 'src');
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const importsOf = (pkg) =>
  sourceFiles(pkg).flatMap((f) => {
    const src = readFileSync(f, 'utf8');
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => ({ file: f, spec: m[1] }));
  });

/** Every workspace package reachable from `start` through declared deps. */
function transitiveWorkspaceDeps(start, seen = new Set()) {
  const pkg = readPkg(start);
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (!dep.startsWith('@cigar-aac/')) continue;
    const name = dep.replace('@cigar-aac/', '');
    if (seen.has(name)) continue;
    seen.add(name);
    transitiveWorkspaceDeps(name, seen);
  }
  return seen;
}

describe('the verifier is independent of the CIGAR runtime', () => {
  it('does not declare a dependency on @cigar-aac/cigar', () => {
    expect(Object.keys(readPkg('verifier').dependencies)).not.toContain('@cigar-aac/cigar');
  });

  it('has no CIGAR runtime import in any source file', () => {
    const offenders = importsOf('verifier').filter((i) => i.spec.includes('/cigar'));
    expect(offenders).toEqual([]);
  });

  it('cannot reach the CIGAR runtime transitively either', () => {
    // The check that actually matters: an indirect path would be just as bad.
    const reachable = transitiveWorkspaceDeps('verifier');
    expect([...reachable].sort()).toEqual(['aac', 'cll', 'cose', 'cpb', 'scitt']);
    expect(reachable.has('cigar')).toBe(false);
  });

  it('depends only on the record, digest, signature, log and witness layers', () => {
    expect(Object.keys(readPkg('verifier').dependencies).sort()).toEqual([
      '@cigar-aac/aac',
      '@cigar-aac/cll',
      '@cigar-aac/cose',
      '@cigar-aac/cpb',
      '@cigar-aac/scitt',
    ]);
  });
});

describe('the record format does not know about the runtime', () => {
  it('@cigar-aac/aac does not depend on @cigar-aac/cigar', () => {
    // A capsule knows about typed digest references. It must not know what a
    // ContextBundle is, or the two specifications have merged.
    expect(Object.keys(readPkg('aac').dependencies)).not.toContain('@cigar-aac/cigar');
    expect(importsOf('aac').filter((i) => i.spec.includes('/cigar'))).toEqual([]);
  });

  it('carries no CIGAR vocabulary in its source', () => {
    const banned = ['ContextBundle', 'SelectionManifest', 'context_bundle', 'selection_manifest'];
    for (const file of sourceFiles('aac')) {
      const src = readFileSync(file, 'utf8');
      // Comments may discuss CIGAR; code must not name its structures.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const token of banned) {
        expect(code, `${file} references CIGAR structure "${token}"`).not.toContain(token);
      }
    }
  });
});

describe('the runtime does not know it will be sealed', () => {
  it('@cigar-aac/cigar does not depend on @cigar-aac/aac', () => {
    // CIGAR produces artifacts. It must not reach into the record format, or
    // the runtime layer has expanded beyond its core purpose.
    expect(Object.keys(readPkg('cigar').dependencies)).not.toContain('@cigar-aac/aac');
    expect(importsOf('cigar').filter((i) => i.spec.includes('/aac'))).toEqual([]);
  });

  it('crosses into the record format only through the CPB typed-ref boundary', () => {
    const external = importsOf('cigar')
      .map((i) => i.spec)
      .filter((s) => s.startsWith('@cigar-aac/'));
    expect([...new Set(external)].sort()).toEqual(['@cigar-aac/cose', '@cigar-aac/cpb']);
  });
});

describe('the layer graph has no cycles', () => {
  it('each package depends only on layers below it', () => {
    const ALLOWED = {
      cpb: [],
      // cose is independent of cpb: COSE signs bytes and does not care how
      // those bytes were canonicalized.
      cose: [],
      cll: ['cpb', 'cose'],
      scitt: ['cpb', 'cose', 'cll'],
      aac: ['cpb', 'cose'],
      cigar: ['cpb', 'cose'],
      verifier: ['cpb', 'cose', 'cll', 'scitt', 'aac'],
    };
    for (const [pkg, allowed] of Object.entries(ALLOWED)) {
      const declared = Object.keys(readPkg(pkg).dependencies ?? {})
        .filter((d) => d.startsWith('@cigar-aac/'))
        .map((d) => d.replace('@cigar-aac/', ''))
        .sort();
      expect(declared, `${pkg} dependencies`).toEqual([...allowed].sort());
    }
  });

  it('uses no cross-package deep imports', () => {
    // Deep imports would let a caller bypass a package's public surface, and
    // the boundary tests above would stop being meaningful.
    for (const pkg of ['cpb', 'cose', 'cll', 'scitt', 'aac', 'cigar', 'verifier']) {
      const deep = importsOf(pkg).filter((i) => /^@cigar-aac\/[a-z]+\//.test(i.spec));
      expect(deep, `${pkg} has deep imports`).toEqual([]);
    }
  });

  it('keeps the Hedera SDK out of every library package', () => {
    // The public-anchor witness is real network I/O, so it lives at the edge in
    // apps/server. If it ever creeps into packages/*, the verifier stops being
    // runnable offline with no dependencies - which is the whole claim.
    for (const pkg of ['cpb', 'cose', 'cll', 'scitt', 'aac', 'cigar', 'verifier']) {
      const deps = Object.keys(readPkg(pkg).dependencies ?? {});
      expect(deps, `${pkg} depends on the Hedera SDK`).not.toContain('@hiero-ledger/sdk');
      const imports = importsOf(pkg).map((i) => i.spec);
      expect(imports.filter((i) => i.includes('hiero-ledger')), `${pkg} imports the Hedera SDK`).toEqual([]);
    }
  });

  it('lets the Hedera witness logic stay pure: node builtins only', () => {
    // packages/scitt carries the anchor construction and verification. It must
    // perform no I/O, so that a verifier with no SDK and no network can still
    // check that a receipt names the statement it claims.
    const specs = importsOf('scitt')
      .map((i) => i.spec)
      .filter((sp) => !sp.startsWith('.') && !sp.startsWith('@cigar-aac/'));
    expect([...new Set(specs)].sort()).toEqual(['node:crypto']);
  });

  it('pulls in no third-party runtime dependency for the crypto path', () => {
    // Every primitive is implemented against the spec and cross-checked by
    // known-answer tests, so there is nothing to audit but this repo.
    for (const pkg of ['cpb', 'cose', 'cll', 'scitt', 'aac', 'cigar', 'verifier']) {
      const external = Object.keys(readPkg(pkg).dependencies ?? {}).filter(
        (d) => !d.startsWith('@cigar-aac/'),
      );
      expect(external, `${pkg} has third-party dependencies`).toEqual([]);
    }
    const nodeBuiltinsOnly = importsOf('cose')
      .map((i) => i.spec)
      .filter((s) => !s.startsWith('.') && !s.startsWith('@cigar-aac/'));
    expect([...new Set(nodeBuiltinsOnly)]).toEqual(['node:crypto']);
  });
});
