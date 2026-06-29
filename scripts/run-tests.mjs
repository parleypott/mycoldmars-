#!/usr/bin/env bun
// run-tests.mjs — the one command that runs the whole mycoldmars test suite.
//
// Why this exists: the repo's tests are hand-rolled assert scripts spread across
// translation/, burma-script/, tools/, api/, and queen-scarlet-school/. They print
// their own "N passed, 0 failed" summaries and (correctly) exit 0/1. But they were
// only ever runnable one file at a time, with mixed runtimes — most run under node,
// but the ones that import a .ts module (ffprobe-meta) crash under node and need bun,
// and parse-test.ts reads a fixture relative to its own directory. So there was no
// single "is the repo green?" command, and running them by hand was error-prone.
//
// This runner runs EVERY suite under bun (which handles .mjs and .ts uniformly),
// from the correct working directory, aggregates by exit code, and exits nonzero if
// any suite fails. Run it with:  bun run test   (or: bun scripts/run-tests.mjs)
//
// Adding a new test: drop a *.test.{mjs,ts,js} or *.spec.{mjs,ts,js} anywhere and it's
// auto-discovered (all run under bun, which handles .ts/.mjs/.js uniformly). For a test
// with a NON-STANDARD name (the burma-script *-test.ts) or a special cwd, add a line to
// EXPLICIT_TESTS below. The auto-glob used to match ONLY *.test.mjs, so a *.test.ts a
// future iteration dropped would have sat on disk, passed by hand, and silently NEVER run
// in `bun run test` — a textbook false-green. The glob below now covers .ts/.js/.spec too
// so the runner can't quietly skip a standard-named suite.
//
// Suites run CONCURRENTLY in a CPU-capped worker pool — each suite is an independent
// `bun <file>` subprocess (they share no state, only the filesystem read-only + their
// own assert output), so the only cost the serial version was paying was per-process
// startup × N. With 250+ suites that startup tax dominated wall-clock; the pool spreads
// it across cores. The contract is unchanged: same discovered set, same per-suite
// pass/fail verdict (exit 0 = pass), same final exit code (0 iff every suite passes).
// Output is collected and printed in sorted order so a run reads identically to before,
// regardless of completion order. Override the pool size with TEST_CONCURRENCY=N.

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '.vercel']);

// A file is an auto-discoverable suite if it's named <something>.{test,spec}.{mjs,ts,js}.
// (Kept deliberately to the two standard conventions — .test. and .spec. — so a random
// helper like burma-script's `parse-test.ts` isn't swept in with the wrong cwd; those
// non-standard names live in EXPLICIT_TESTS instead.)
const AUTO_TEST_RE = /\.(test|spec)\.(mjs|ts|js)$/;

// Recursively find every auto-discoverable suite under the repo (skipping build/dep dirs).
function findAutoTests(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findAutoTests(full));
    else if (AUTO_TEST_RE.test(name)) out.push({ file: full });
  }
  return out;
}

// .ts tests (and any test needing a non-root cwd) are listed explicitly.
// All three burma-script .ts tests run from burma-script/: parse-test.ts reads
// ./sample-script.txt relative to cwd; the other two are cwd-agnostic but live there.
const EXPLICIT_TESTS = [
  { file: join(ROOT, 'burma-script/parse-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/routing-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/roundtrip-test.ts'), cwd: join(ROOT, 'burma-script') },
  { file: join(ROOT, 'burma-script/list-roundtrip-test.ts'), cwd: join(ROOT, 'burma-script') },
  // integrity-check.ts enforces the worklist-unwrap + reorder round-trip law on the real 225-block
  // sample. document-builder.js:51 / Exports.jsx:22 claim that behaviour is "guarded by the
  // worklist-unwrap checks in integrity-check.ts" — wiring it here makes that guard load-bearing
  // instead of aspirational. It exits 0/1 and prints a JSON {ok,...} summary, matching this runner's
  // contract. (audit-integrity.mjs needs a live localhost server, so it stays a manual dev tool.)
  { file: join(ROOT, 'burma-script/integrity-check.ts'), cwd: join(ROOT, 'burma-script') },
];

// Shape-scanner GATES — the standalone audit scripts the loop built to catch whole
// CLASSES of live bug the name-based tooling is structurally blind to (the "1000K"
// rollover flash, the corrupt-localStorage brick-on-load). Each exits 0/1, matching
// this runner's contract. They were standalone .sh scripts that NOTHING ran — so a
// future iteration (or Johnny) re-introducing one of these patterns would sail clean
// through `bun run test`, exactly the aspirational-guard trap the integrity-check
// wiring above exists to kill. Wiring them here makes them load-bearing.
//
// For each gate we run BOTH modes, on purpose:
//   --self-test : proves the gate's own classifier still works. A gate whose --check
//                 silently always-passes (e.g. a regex that stopped matching) is a
//                 false-green — the precise failure this whole runner is paranoid about.
//   --check     : proves the live repo currently has ZERO naive sites (the regression
//                 gate that trips red the moment someone ships a new one).
//
// Scope is deliberate: only OFFLINE, DETERMINISTIC, exit-nonzero-on-finding scanners
// belong here. The divergence scanner is a TRIAGE tool (a new shared-name copy isn't
// inherently a bug — it'd false-RED), and the deploy/route scripts need a live network,
// so all of those stay manual dev tools, out of the offline suite.
const SHELL_GATES = ['find-rollover-formatters.sh', 'find-unguarded-json-parse.sh', 'find-unguarded-date-format.sh', 'find-hour-drop-timecode.sh', 'find-html-parse-errors.sh'].flatMap((s) =>
  ['--self-test', '--check'].map((mode) => ({
    file: join(ROOT, 'scripts', s),
    cmd: 'bash',
    args: [join(ROOT, 'scripts', s), mode],
    label: `scripts/${s} ${mode}`,
  })),
);

// Same dual-mode contract as SHELL_GATES, but these gates are bun scripts (cleaner
// paren-balanced parsing than awk for AST-shaped checks). find-bool-sort-comparator
// flags sort comparators that return a boolean instead of a number (silent wrong order).
// find-truthy-zero flags `<numeric-coercion> || <nonzero-default>` sites where the
// `|| N` could silently eat a legitimate ZERO (the loop's #1 recurring bug class).
// Ledger-backed (scripts/truthy-zero-triage.tsv): --check fails only on an
// UNTRIAGED site, so a newly introduced `parseFloat(x) || 5` trips it on landing.
// find-nan-sort-comparator flags `new Date(x) - new Date(y)` parsed INLINE in a
// sort comparator — the NaN-poison shape the bool gate marks OK (it's a valid
// subtraction) but that scrambles the whole list when one timestamp won't parse.
// find-naive-body-read flags serverless handlers that read a JSON request body
// and access it RAW (no readJsonBody/coerceObjectBody, no inline guard) — the
// null-body→500 crash class the loop fixed ~20+ times. Ledger-backed
// (scripts/naive-body-read-triage.tsv): --check fails only on a NEW unguarded
// handler, so a freshly-added (or missed) one trips the suite immediately.
// find-inline-gemini-contents flags any Gemini caller that builds its chat
// `contents` from an INLINE `history.map(m => ({role, parts}))` instead of the
// shared api/_lib/gemini-chat-contents.js helper — the leading-model-turn→500
// class the loop fixed 5+ times. Ledger-backed
// (scripts/inline-gemini-contents-triage.tsv): --check fails only on a NEW inline
// builder, so the next handler that reintroduces one trips the suite on landing.
// find-divide-by-length flags `<expr> / <arr>.length` sites — the NaN/Infinity
// shape that bit MapKeys lineCentroid, route-geo, and the Hunter keep-rate math.
// Ledger-backed (scripts/divide-by-length-triage.tsv): --check fails only on a
// NEW unguarded divide, so the next one that lands trips the suite on landing.
// find-wrongtype-json-parse flags `JSON.parse(... || '[]')` typed-fallback parses
// — the WRONG-TYPE storage sibling find-unguarded-json-parse.sh (throw class) is
// blind to: a stored '{}'/'5'/'null' parses fine past the try/catch, then crashes
// the first .map/.length/for-of/new Set. The `|| '[]'` only guards MISSING, not
// wrong-shape. This is the ~20×-hand-fixed Array.isArray vein. Ledger-backed
// (scripts/wrongtype-json-parse-triage.tsv): --check fails only on a NEW one.
const BUN_GATES = ['find-bool-sort-comparator.mjs', 'find-truthy-zero.mjs', 'find-nan-sort-comparator.mjs', 'find-naive-body-read.mjs', 'find-inline-gemini-contents.mjs', 'find-divide-by-length.mjs', 'find-wrongtype-json-parse.mjs'].flatMap((s) =>
  ['--self-test', '--check'].map((mode) => ({
    file: join(ROOT, 'scripts', s),
    cmd: 'bun',
    args: [join(ROOT, 'scripts', s), mode],
    label: `scripts/${s} ${mode}`,
  })),
);

// Union of auto-discovered + explicit, de-duped by absolute path so a file that somehow
// matches both lists (e.g. an explicit entry later renamed to a standard suffix) can't
// run twice.
// Dedup key includes args, because a gate lists the SAME script twice (--self-test and
// --check) — keying on `file` alone would silently drop one mode. Auto/explicit suites
// carry no args, so their key stays just the path (unchanged behaviour).
const suiteKey = (t) => t.file + (t.args ? ' ' + t.args.join(' ') : '');
const seenPaths = new Set();
const tests = [...findAutoTests(ROOT), ...EXPLICIT_TESTS, ...SHELL_GATES, ...BUN_GATES]
  .filter((t) => (seenPaths.has(suiteKey(t)) ? false : (seenPaths.add(suiteKey(t)), true)))
  .sort((a, b) => (a.label || relative(ROOT, a.file)).localeCompare(b.label || relative(ROOT, b.file)));

// Pull the most informative one-line summary out of a test's stdout, ignoring the
// MODULE_TYPELESS_PACKAGE_JSON noise node prints for extensionless ES modules.
function summaryLine(stdout) {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/MODULE_TYPELESS|Reparsing as ES module|trace-warnings|performance overhead|add "type": "module"/.test(l));
  const scored = lines.filter((l) => /\bpass|\bfail|\bok\b|✓|✗/i.test(l));
  return (scored.length ? scored[scored.length - 1] : lines[lines.length - 1]) || '(no output)';
}

// Run one suite as an async `bun <file>` subprocess; resolve with its verdict.
// Mirrors the old spawnSync contract exactly: exit code 0 => pass, anything else => fail
// (a spawn error — e.g. bun missing — resolves as a fail too, never rejects).
function runSuite({ file, cwd, cmd, args, label }) {
  return new Promise((resolve) => {
    const rel = label || relative(ROOT, file);
    let stdout = '';
    let stderr = '';
    // Default: run the suite under `bun <file>`. A gate overrides cmd/args to run
    // `bash <script> <mode>` instead — same stdout-scrape + exit-code contract.
    const child = spawn(cmd || 'bun', args || [file], {
      cwd: cwd || ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      resolve({ rel, ok: false, summary: `(spawn error: ${err.message})`, out: stderr || String(err) });
    });
    child.on('close', (code) => {
      resolve({ rel, ok: code === 0, summary: summaryLine(stdout), out: stdout + stderr });
    });
  });
}

// Bounded-concurrency pool: keep up to POOL suites in flight at once, draining a shared
// queue. Pool size defaults to the core count (work is process-startup-bound, so ~cores
// is the sweet spot — more just oversubscribes). TEST_CONCURRENCY overrides.
const POOL = Math.max(1, Number(process.env.TEST_CONCURRENCY) || cpus().length);
console.log(`\n  mycoldmars test suite — ${tests.length} suites (bun, ${POOL}-way parallel)\n`);

const results = new Array(tests.length);
let next = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= tests.length) return;
    results[i] = await runSuite(tests[i]);
  }
}
await Promise.all(Array.from({ length: Math.min(POOL, tests.length) }, worker));

// Print in the SAME sorted order the suites were discovered in, so a run reads identically
// to the old serial runner regardless of which suite finished first.
let failed = 0;
const failures = [];
for (const r of results) {
  console.log(`  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.rel.padEnd(48)} ${r.summary}`);
  if (!r.ok) { failed++; failures.push(r); }
}

if (failed) {
  console.log(`\n\x1b[31m  ${failed}/${tests.length} suite(s) FAILED\x1b[0m`);
  for (const f of failures) {
    console.log(`\n  ── ${f.rel} ──`);
    console.log(f.out.split('\n').map((l) => '  ' + l).join('\n'));
  }
  process.exit(1);
}

console.log(`\n\x1b[32m  all ${tests.length} suites passed\x1b[0m\n`);
process.exit(0);
