#!/usr/bin/env bun
// find-untested-cores.mjs — coverage census for LOGIC modules.
//
// WHY THIS EXISTS (a verifier-layer footgun the loop kept stepping on):
// The recurring "is this core locked?" check was an ad-hoc grep for
// `from '...module.js'` across *.test.mjs. That MISSES dynamic imports —
// `const m = await import('./write-token.js')` — which several real suites use
// (write-token, cloud-sync, read-mode …). So a genuinely-LOCKED security core
// reads as UNTESTED, and a loop iteration burns budget "discovering" coverage
// that already exists (or, worse, writes a duplicate test). This script resolves
// BOTH static and dynamic imports by ABSOLUTE PATH (basename collides — there are
// many db.js / auth.js / main.js) and reports only modules that export real
// FUNCTIONS (pure data modules like an embedded novel string are excluded).
//
// It classifies each logic module as:
//   DIRECT   — some test file imports it (static OR dynamic). It has a dedicated lock.
//   NONE     — no test imports it directly. A genuine coverage gap OR a UI/DOM-mount
//              glue module that isn't unit-testable (the report flags likely-glue).
//
// "DIRECT" is the useful signal: the loop locks cores by importing them and
// asserting. A module run only transitively (a tested handler imports it) is
// exercised but not pinned — still worth a DIRECT lock, so it shows as NONE.
//
// Usage:
//   bun scripts/find-untested-cores.mjs          # human summary
//   bun scripts/find-untested-cores.mjs --json    # machine list of NONE modules
//
// Exit code is ALWAYS 0 — this is a census, not a gate. Coverage gaps here are a
// judgment call (much of NONE is un-unit-testable DOM glue), so it never fails CI.

import { readdirSync, statSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vercel', 'coverage']);
const isTest = (p) => /\.(test|spec)\.(mjs|js|ts)$/.test(p) || /-test\.(mjs|js|ts)$/.test(p);
const isSource = (p) => /\.(mjs|js)$/.test(p) && !isTest(p);

// Walk the tree once, collecting source + test files.
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
}
const allFiles = [];
walk(ROOT, allFiles);
const sourceFiles = allFiles.filter(isSource);
const testFiles = allFiles.filter((p) => /\.(test|spec)\.(mjs|js|ts)$/.test(p) || /-test\.ts$/.test(p));

// A "logic module" exports at least one FUNCTION (declared, arrow, or async).
// Pure-data modules (export const BIG_STRING = "...") are intentionally excluded —
// there is nothing to unit-test.
const EXPORTS_FUNCTION = [
  /export\s+(async\s+)?function\s+/,
  /export\s+const\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /export\s+default\s+(async\s+)?function/,
  /export\s+\{[^}]*\}/, // re-export barrels count as logic surface
];
const exportsFunction = (src) => EXPORTS_FUNCTION.some((re) => re.test(src));

// Resolve an import specifier (relative only) against the importer's dir to an
// absolute real path, trying .js / .mjs / /index.js as ESM would.
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // bare / vendor specifier — not a repo module
  const base = resolve(dirname(fromFile), spec);
  const cands = extname(base)
    ? [base]
    : [base + '.js', base + '.mjs', join(base, 'index.js'), join(base, 'index.mjs')];
  for (const c of cands) {
    if (existsSync(c)) { try { return realpathSync(c); } catch { return c; } }
  }
  return null;
}

// Every module specifier referenced by a test file — static AND dynamic.
//   static:   import ... from 'x'   |   import 'x'   |   export ... from 'x'
//   dynamic:  import('x')            |   await import('x')
const SPEC_RE = /(?:from\s*|import\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
const importedByTests = new Set();
for (const t of testFiles) {
  let src;
  try { src = readFileSync(t, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(SPEC_RE)) {
    const resolved = resolveSpec(t, m[1]);
    if (resolved) importedByTests.add(resolved);
  }
}

// Heuristic: modules that are almost certainly DOM/UI glue (not unit-testable).
// Reported separately so a real NONE gap isn't buried under mount/render shells.
const GLUE_HINT = /(\/mount\.js$|\/gate\.js$|\/auth\.js$|\/command-palette\.js$|\/account-menu\.js$|\/floating-windows\.js$|\/mac-window\.js$|extensions\/|editor\/|copilot\/|tags\/|\/globe\.js$|\/pins\.js$|\/walker\.js$)/;

const none = [];
for (const f of sourceFiles) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  if (!exportsFunction(src)) continue; // pure data / no logic surface
  let real = f;
  try { real = realpathSync(f); } catch {}
  if (importedByTests.has(real)) continue; // DIRECTLY locked by a test (static or dynamic)
  none.push(relative(ROOT, f));
}
none.sort((a, b) => a.localeCompare(b)); // explicit string comparator (satisfies find-bare-sort gate)

const glue = none.filter((p) => GLUE_HINT.test(p));
const gaps = none.filter((p) => !GLUE_HINT.test(p));

if (JSON_OUT) {
  console.log(JSON.stringify({ gaps, glue }, null, 2));
  process.exit(0);
}

const totalLogic = sourceFiles.filter((f) => {
  try { return exportsFunction(readFileSync(f, 'utf8')); } catch { return false; }
}).length;

console.log(`find-untested-cores — coverage census (static + DYNAMIC import aware)`);
console.log(`  logic modules scanned:        ${totalLogic}`);
console.log(`  directly locked by a test:    ${totalLogic - none.length}`);
console.log(`  NO direct test — likely gaps: ${gaps.length}`);
console.log(`  NO direct test — likely glue: ${glue.length} (DOM/UI mounts, not unit-testable)`);
console.log('');
if (gaps.length) {
  console.log('LIKELY COVERAGE GAPS (logic modules no test imports directly):');
  for (const p of gaps) console.log('  • ' + p);
} else {
  console.log('No non-glue logic module is missing a direct test. Codebase is fully locked.');
}
console.log('');
console.log('(Run with --json for the machine-readable list. NONE ≠ untested behavior —');
console.log(' many entries are DOM glue or are exercised transitively via a tested handler.)');
process.exit(0);
