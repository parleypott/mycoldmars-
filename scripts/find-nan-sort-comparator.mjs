#!/usr/bin/env bun
//
// find-nan-sort-comparator.mjs — audit every inline-arrow `.sort()` comparator in
// the repo and flag the ones that PARSE A DATE INLINE inside the comparator math,
// the shape that silently scrambles a whole list when one value won't parse.
//
// WHY THIS EXISTS
// `Array.prototype.sort(cmp)` needs cmp to return a real number (<0, 0, >0). The
// canonical correct comparator is a subtraction — and the bool-sort gate treats
// ANY subtraction as OK. But a subtraction of two FRESHLY-PARSED dates hides a
// second footgun the bool gate is blind to:
//
//     rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))   // BUG
//
// `new Date("garbage")` / `new Date(undefined)` is an *Invalid Date*, whose
// valueOf() is NaN. A SINGLE NaN inside a subtraction comparator poisons V8's
// TimSort: the partition pivots on NaN (every compare is false), the order
// becomes inconsistent and platform-dependent, and the ENTIRE list scrambles —
// not just the bad row. It is invisible on clean data and only bites when a
// real row carries a missing / malformed / legacy timestamp, so it ships green
// and corrupts ordering in production. `|| 0` does NOT save you: it guards a
// FALSY value (null/''/undefined → epoch) but a PRESENT-BUT-UNPARSEABLE string
// still yields Invalid Date → NaN.
//
// This is a documented recurring class in this repo, fixed by hand at least four
// times — the Hunter "Recent analyses" feed, the Interpreter library "recent"
// view, the Interpreter trash view, and the Commentbank slack_ts sort. Each fix
// moved the parse OUT of the comparator into a key helper that clamps to a finite
// number (`Number.isFinite(t) ? t : 0`), so the comparator subtracts two numbers
// that can never be NaN. The whole repo is in that safe shape TODAY; this gate
// keeps the next inline `new Date(...) - new Date(...)` from sneaking back in.
//
// WHAT IT FLAGS
//   OK    — the comparator body parses no date inline. Numeric subtraction
//           (`a.size - b.size`), a finite-guarded key helper (`tsOf(b) - tsOf(a)`,
//           `recencyMs(...)`), `.localeCompare(`, a ternary of numbers — every
//           correct shape the repo uses. A date that was parsed to a finite epoch
//           BEFORE the comparator (the documented fix) reads as OK here.
//   NAIVE — the body contains a raw `new Date(` or `Date.parse(` — a date parsed
//           INSIDE the comparator, the NaN-poison shape. Worth a human look; the
//           fix is always "parse to a finite key outside, subtract the keys."
//
// SCOPE (honest, like the sibling gates):
//   • Inline-arrow comparators only. Block-body `((a,b)=>{...})` and named/function
//     -ref comparators are out of scope (too much to classify safely) — surfaced in
//     --verbose as SKIP, never flagged.
//   • DATE parsing only (`new Date(`, `Date.parse(`). Numeric NaN-poison
//     (`parseFloat(x) - parseFloat(y)` on a non-numeric field) is deliberately
//     NOT flagged: numeric coercions in comparators are overwhelmingly correct in
//     this repo and would drown the signal. The date shape is the one that has
//     actually bitten, four times.
//
// USAGE
//   scripts/find-nan-sort-comparator.mjs             # table of every inline comparator
//   scripts/find-nan-sort-comparator.mjs --check     # exit 1 if any NAIVE exists (CI gate)
//   scripts/find-nan-sort-comparator.mjs --self-test # prove the classifier on fixtures
//   scripts/find-nan-sort-comparator.mjs --verbose   # also list SKIP (block/named) sites
//
// OUTPUT (one line per inline comparator, NAIVE first):
//   <NAIVE|OK>  <file>:<line>  =>  <body>

import { relative } from 'node:path';
import {
  ROOT, sourceFiles as collectSourceFiles, buildSkip, SORT_GATE_FILES,
  classifySource as classifySourceCore, classifyFile as classifyFileCore,
} from './sort-comparators.mjs';

// ── Source selection ────────────────────────────────────────────────────────
// Scan surface + paren-balanced extraction now live in the shared core
// (sort-comparators.mjs), unified with find-bool-sort so the two gates can never
// drift on either again. This gate adds only its own self-file skip: its
// docstring + self-test fixtures embed intentional `new Date(...)` comparators
// that would otherwise self-trip it.
const SKIP = buildSkip(SORT_GATE_FILES);
const sourceFiles = () => collectSourceFiles(SKIP);
const classifyFile = (path, opts) => classifyFileCore(path, classifyBody, opts);
const classifySource = (src, opts) => classifySourceCore(src, classifyBody, opts);

// ── The classifier ─────────────────────────────────────────────────────────────
// A date parsed INLINE in the comparator body is the NaN-poison shape. `new Date(`
// and `Date.parse(` both take an arbitrary value and yield Invalid Date / NaN on
// anything unparseable. Anything else (numeric subtraction, a finite-guarded key
// helper called by name, localeCompare) is OK.
const PARSES_DATE_INLINE = /\bnew\s+Date\s*\(|\bDate\s*\.\s*parse\s*\(/;

function classifyBody(body) {
  return PARSES_DATE_INLINE.test(body) ? 'NAIVE' : 'OK';
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const check = (label, body, expect) => {
    const got = classifyBody(body);
    if (got === expect) { pass++; }
    else { fail++; console.log(`  ✗ ${label}: body \`${body}\` → ${got}, expected ${expect}`); }
  };
  // NAIVE — the bug, in its real forms (the four historical fixes).
  check('raw date subtract', 'new Date(b.created_at) - new Date(a.created_at)', 'NAIVE');
  check('raw date `|| 0` (still unsafe on bad strings)', 'new Date(a.updated_at || 0) - new Date(b.updated_at || 0)', 'NAIVE');
  check('Date.parse subtract', 'Date.parse(a.ts) - Date.parse(b.ts)', 'NAIVE');
  check('desc raw date', 'new Date(b.deleted_at) - new Date(a.deleted_at)', 'NAIVE');
  check('new Date getTime', 'new Date(a.x).getTime() - new Date(b.x).getTime()', 'NAIVE');
  // OK — every correct shape the repo actually uses (incl. the documented fixes).
  check('numeric subtract', 'a - b', 'OK');
  check('prop subtract', 'b.size - a.size', 'OK');
  check('finite key helper', 'analysisRecencyMs(b) - analysisRecencyMs(a)', 'OK');
  check('finite key helper 2', 'tsOf(b.created_at) - tsOf(a.created_at)', 'OK');
  check('already-numeric ts field', 'b.tsMs - a.tsMs', 'OK');
  check('localeCompare', 'a.name.localeCompare(b.name)', 'OK');
  check('ternary numbers', 'asc ? a.n - b.n : b.n - a.n', 'OK');
  check('Number coerce (numeric NaN out of scope)', 'Number(a.v) - Number(b.v)', 'OK');

  // Full-source extraction: paren-balanced arg + line numbers + block/named skip.
  const fixture = [
    'const a = rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));', // 1 NAIVE
    'const b = rows.sort((a, b) => b.size - a.size);',                                 // 2 OK
    'const c = rows.sort((a, b) => recencyMs(b) - recencyMs(a));',                     // 3 OK (helper)
    'const d = rows.sort((a, b) => { return new Date(a.x) - new Date(b.x); });',       // 4 block → skipped
    'const e = rows.sort(byDate);',                                                    // 5 named → skipped
    'const f = list.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));',               // 6 NAIVE
  ].join('\n');
  const rows = classifySource(fixture);
  const expectInline = [
    { line: 1, verdict: 'NAIVE' },
    { line: 2, verdict: 'OK' },
    { line: 3, verdict: 'OK' },
    { line: 6, verdict: 'NAIVE' },
  ];
  const inline = rows.map((r) => ({ line: r.line, verdict: r.verdict }));
  const eq = JSON.stringify(inline) === JSON.stringify(expectInline);
  if (eq) { pass++; } else { fail++; console.log(`  ✗ source extraction: got ${JSON.stringify(inline)}, expected ${JSON.stringify(expectInline)}`); }

  // Verbose should surface the two skipped sites as SKIP.
  const skips = classifySource(fixture, { verbose: true }).filter((r) => r.verdict === 'SKIP').length;
  if (skips === 2) { pass++; } else { fail++; console.log(`  ✗ verbose skip count: got ${skips}, expected 2`); }

  // Live-repo invariant: the gate must currently find ZERO naive sites (else the
  // --check baseline is already red and the self-test is lying about a clean tree).
  const liveNaive = sourceFiles().flatMap((f) => classifyFile(f)).filter((r) => r.verdict === 'NAIVE').length;
  if (liveNaive === 0) { pass++; } else { fail++; console.log(`  ✗ live repo has ${liveNaive} NAIVE comparator(s) — baseline not clean`); }

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) {
  process.exit(selfTest());
}

const verbose = args.has('--verbose');
const all = sourceFiles().flatMap((f) => classifyFile(f, { verbose }));
const naive = all.filter((r) => r.verdict === 'NAIVE');

if (args.has('--check')) {
  if (naive.length) {
    console.log(`✗ ${naive.length} inline date-parse sort comparator(s) (NaN-poison risk):`);
    for (const r of naive) console.log(`  ${relative(ROOT, r.path)}:${r.line}  =>  ${r.body}`);
    process.exit(1);
  }
  const inlineCount = all.filter((r) => r.verdict !== 'SKIP').length;
  console.log(`✓ 0 inline date-parse sort comparators (${inlineCount} comparators scanned)`);
  process.exit(0);
}

// Default: table, NAIVE first.
const order = { NAIVE: 0, OK: 1, SKIP: 2 };
all.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.path.localeCompare(b.path) || a.line - b.line);
for (const r of all) {
  console.log(`${r.verdict.padEnd(5)}  ${relative(ROOT, r.path)}:${r.line}  =>  ${r.body}`);
}
const inlineCount = all.filter((r) => r.verdict !== 'SKIP').length;
console.log(`\n${naive.length} NAIVE / ${inlineCount} inline comparators${verbose ? '' : ' (use --verbose for block/named SKIPs)'}`);
