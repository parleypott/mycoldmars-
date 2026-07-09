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
//   bun scripts/find-untested-cores.mjs --prune   # self-heal: drop STALE ledger entries
//
// Exit code is ALWAYS 0 — this is a census, not a gate. Coverage gaps here are a
// judgment call (much of NONE is un-unit-testable DOM glue), so it never fails CI.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneLedgerText } from './lib/prune-ledger.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
// --prune self-heals the ledger: it deletes STALE entries (file gone OR now
// test-locked), codifying the manual step the ledger _README documents. Safe by
// construction — a stale entry's suppression is already dead weight (see below).
const PRUNE = process.argv.includes('--prune');

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

// Source-EXTRACTION tests: the loop's DOMINANT pattern for DOM/handler-coupled
// modules. Instead of importing the module (impossible — it touches window / edge
// runtime), the suite reads the module's SOURCE with readFileSync and regex-extracts
// a pure function to eval. reef/export.js alone has SIX such suites; qss-explorer,
// nile-flights-state, analyze-render, cutter … are all locked this way. The old
// import-only census flagged every one as an untested "gap" — a false signal that
// costs a loop iteration real budget chasing coverage that already exists (it cost
// THIS iteration exactly that). Detect them by resolving the file path a readFileSync
// call reads, the SAME ABSOLUTE-PATH way imports are resolved (no basename guessing).
//
// Two forms appear in the corpus:
//   readFileSync(new URL('./export.js', import.meta.url), 'utf8')   — relative spec
//   readFileSync(join(APIDIR, 'qss-cast.js'), 'utf8')               — bare filename
// Relative specs resolve exactly (resolveSpec). Bare filenames resolve ONLY when the
// basename is UNIQUE across the source tree — an ambiguous 'db.js' / 'main.js' stays a
// gap (conservative: we never hide a real gap, we only clear proven false positives).
const byBasename = new Map();
for (const f of sourceFiles) {
  let real = f; try { real = realpathSync(f); } catch {}
  const b = basename(real);
  if (!byBasename.has(b)) byBasename.set(b, []);
  byBasename.get(b).push(real);
}
const READ_CALL_RE = /read(?:File|FileSync)\s*\(/g;
const JS_LIT_RE = /['"]([^'"]+\.(?:m?js))['"]/;
const extractedByTests = new Set();
for (const t of testFiles) {
  let src;
  try { src = readFileSync(t, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(READ_CALL_RE)) {
    // The path arg is the FIRST .js/.mjs string literal after `readFileSync(`,
    // whether wrapped in new URL(...) or join(DIR, ...). A fixed window is enough.
    const lit = src.slice(m.index, m.index + 200).match(JS_LIT_RE);
    if (!lit) continue;
    const spec = lit[1];
    let resolved = resolveSpec(t, spec); // handles ./ and ../ relative specs w/ ext
    if (!resolved && !spec.includes('/')) {
      const hits = byBasename.get(basename(spec)); // bare-filename → unique basename only
      if (hits && hits.length === 1) resolved = hits[0];
    }
    if (resolved) extractedByTests.add(resolved);
  }
}

// SELF-TESTED GATE scripts: the loop's shape-scanner gates (scripts/find-*.mjs)
// don't get a co-located *.test.mjs — they carry their OWN fixtures behind a
// `--self-test` CLI mode, and the suite runner (scripts/run-tests.mjs) executes
// that mode on every `bun run test` via its SHELL_GATES + BUN_GATES lists. So a
// gate in those lists IS locked against regression, just through a different
// mechanism than import/extraction. The import-only census was blind to this and
// re-flagged find-inline-gemini-contents / find-naive-body-read (both gates)
// AND sort-comparators.mjs (the shared classifier those gates import + self-test)
// as untested "gaps" EVERY iteration — pure recurring triage waste. Resolve the
// gate list to absolute paths and follow each gate's relative imports one level so
// the shared cores they exercise are covered too. The gate list comes from the SHARED
// discovery (scripts/lib/gate-scripts.mjs) — the SAME source the suite runner reads —
// so a FUTURE gate (any find-*.{mjs,sh} carrying the --self-test/--check contract) is
// auto-recognized here with zero census edit.
const selfTestedByRunner = new Set();
try {
  const { gateBasenames } = await import('./lib/gate-scripts.mjs');
  for (const b of gateBasenames(join(ROOT, 'scripts'))) {
    const gatePath = join(ROOT, 'scripts', b);
    if (!existsSync(gatePath)) continue;
    let real = gatePath; try { real = realpathSync(gatePath); } catch {}
    selfTestedByRunner.add(real);
    // Follow the gate's OWN relative imports one level (catches shared classifiers
    // like sort-comparators.js that the gate imports and its --self-test exercises).
    if (!/\.(mjs|js)$/.test(gatePath)) continue;
    let gateSrc; try { gateSrc = readFileSync(gatePath, 'utf8'); } catch { continue; }
    for (const spec of gateSrc.matchAll(SPEC_RE)) {
      const dep = resolveSpec(gatePath, spec[1]);
      if (dep) selfTestedByRunner.add(dep);
    }
  }
} catch { /* runner unreadable → behave like the pre-self-test census */ }

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
  if (extractedByTests.has(real)) continue; // locked via source-extraction (readFileSync)
  if (selfTestedByRunner.has(real)) continue; // gate script whose --self-test the suite runs
  none.push(relative(ROOT, f));
}
none.sort((a, b) => a.localeCompare(b)); // explicit string comparator (satisfies find-bare-sort gate)

const glue = none.filter((p) => GLUE_HINT.test(p));
const allGaps = none.filter((p) => !GLUE_HINT.test(p));

// ── Triage ledger ──────────────────────────────────────────────────────────
// The GLUE_HINT regex only catches STRUCTURAL glue (mount/gate/editor paths).
// The remaining "gaps" are a mix of genuinely-untested logic AND files a human
// has already judged not-a-gap (canvas render loops, documented stubs, thin
// wrappers whose real logic is imported from a tested module). Without a memory,
// every loop iteration re-opens and re-triages the SAME judged-glue files — this
// iteration burned budget doing exactly that before adding this ledger. So mirror
// the divergence scanner's blessed pattern: persist the judgment. Only UNTRIAGED
// gaps are loud; GLUE/STUB/DELEGATED entries are suppressed to a summary count.
// A path judged GAP stays visible (known, acknowledged, not yet locked).
const LEDGER_PATH = resolve(ROOT, 'scripts', 'untested-cores-ledger.json');
let ledger = {};
try {
  const raw = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  // Corrupt-store guard: only adopt a real object-of-entries; anything else → {}.
  if (raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
    ledger = raw.entries;
  }
} catch { ledger = {}; } // missing / malformed ledger → behave like the pre-ledger census

const SUPPRESS = new Set(['GLUE', 'STUB', 'DELEGATED']);
const ledgerStatus = (p) => (ledger[p] && typeof ledger[p] === 'object' ? ledger[p].status : null);

// Untriaged = a gap with no ledger verdict, OR one explicitly kept visible as GAP.
const gaps = allGaps.filter((p) => !SUPPRESS.has(ledgerStatus(p)));
const suppressed = allGaps.filter((p) => SUPPRESS.has(ledgerStatus(p)));

// Ledger hygiene: an entry is STALE if its file vanished or is no longer a NONE
// (it gained a direct/extraction test) — surface it so the ledger can be pruned.
const noneSet = new Set(none);
const staleLedger = Object.keys(ledger).filter((p) => !noneSet.has(p));

if (PRUNE) {
  if (!staleLedger.length) {
    console.log('Ledger is clean — no stale entries to prune.');
    process.exit(0);
  }
  // Surgically drop each stale entry's line via the pure, mutation-locked helper
  // (preserves the file's one-line-per-entry formatting → minimal diff; refuses
  // rather than corrupt the ledger). See scripts/lib/prune-ledger.mjs.
  let text;
  try { text = readFileSync(LEDGER_PATH, 'utf8'); }
  catch { console.error('Cannot --prune: ledger is missing or malformed.'); process.exit(1); }
  const { next, pruned, ok } = pruneLedgerText(text, staleLedger);
  if (!ok) {
    console.error('Refusing to --prune: surgical removal would not cleanly drop exactly the stale entries. Prune by hand.');
    process.exit(1);
  }
  writeFileSync(LEDGER_PATH, next);
  console.log(`Pruned ${pruned.length} stale ledger entr${pruned.length === 1 ? 'y' : 'ies'} (file gone OR now test-locked):`);
  for (const p of pruned) console.log('  - ' + p);
  process.exit(0);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ gaps, suppressed, glue, staleLedger }, null, 2));
  process.exit(0);
}

const totalLogic = sourceFiles.filter((f) => {
  try { return exportsFunction(readFileSync(f, 'utf8')); } catch { return false; }
}).length;

console.log(`find-untested-cores — coverage census (import + source-EXTRACTION aware)`);
console.log(`  logic modules scanned:        ${totalLogic}`);
console.log(`  directly locked by a test:    ${totalLogic - none.length}`);
console.log(`  UNTRIAGED gaps (look at these):${gaps.length}`);
console.log(`  triaged glue/stub (suppressed):${suppressed.length} (judged not-a-gap in the ledger)`);
console.log(`  NO direct test — likely glue: ${glue.length} (DOM/UI mounts, not unit-testable)`);
console.log('');
if (gaps.length) {
  console.log('UNTRIAGED COVERAGE GAPS (no test imports them AND no ledger verdict — triage these):');
  for (const p of gaps) {
    const kept = ledgerStatus(p) === 'GAP' ? '  [known GAP]' : '';
    console.log('  • ' + p + kept);
  }
} else {
  console.log('No untriaged logic module is missing a direct test. Everything is locked or judged.');
}
if (suppressed.length) {
  console.log('');
  console.log(`Suppressed by ledger (already judged — see scripts/untested-cores-ledger.json):`);
  for (const p of suppressed) console.log(`  · ${p} — ${ledgerStatus(p)}`);
}
if (staleLedger.length) {
  console.log('');
  console.log('⚠ STALE ledger entries (file gone OR now test-locked — run with --prune to drop them):');
  for (const p of staleLedger) console.log('  ! ' + p);
}
console.log('');
console.log('(Run with --json for the machine-readable list. NONE ≠ untested behavior —');
console.log(' many entries are DOM glue or are exercised transitively via a tested handler.)');
process.exit(0);
