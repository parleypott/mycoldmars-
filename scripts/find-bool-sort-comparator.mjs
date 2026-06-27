#!/usr/bin/env bun
//
// find-bool-sort-comparator.mjs — audit every inline-arrow `.sort()` comparator in
// the repo and flag the ones that return a BOOLEAN instead of a number.
//
// WHY THIS EXISTS
// `Array.prototype.sort(cmp)` requires cmp to return a NUMBER: <0, 0, or >0. The
// classic JS footgun is writing the comparator as a bare relational expression:
//
//     items.sort((a, b) => a.score > b.score)      // BUG — returns true/false
//
// A boolean coerces to 1 (true) or 0 (false), so the engine NEVER sees a negative
// value. V8's TimSort then orders inconsistently: small arrays may look "sorted" by
// luck, but past ~10 elements the order is silently wrong and platform-dependent.
// It is invisible in a quick test and corrupts exactly the kind of ranked, ordered,
// user-facing lists this repo is full of (library sort, leaderboard, score ranking,
// timeline, recents). The whole repo's sorts are numeric TODAY — this keeps the next
// one from shipping the boolean form unnoticed.
//
// The divergence scanner is BLIND to this (comparators are anonymous arrows, no
// shared name), and no other gate looks at sort order. This codifies the by-hand
// "is every comparator numeric?" sweep into a free, every-iteration regression gate.
//
// WHAT IT FLAGS
//   OK      — the arrow body is numeric: a subtraction (`a - b`), a ternary that
//             yields numbers (`cond ? 1 : -1`), `.localeCompare(`, `.compare(`, or a
//             numeric coercion (`Number(`/`parseInt`/`parseFloat`). The forms every
//             correct comparator in this repo already uses.
//   BOOLEAN — the arrow body is a bare relational/equality comparison (`>`,`<`,`>=`,
//             `<=`,`==`,`===`,`!=`,`!==`) with NONE of the OK signals. A comparator
//             that returns true/false — the bug. Worth a human look, almost always real.
//   (block-body comparators `.sort((a,b)=>{...})` and named/function-ref comparators
//    are OUT OF SCOPE — too much to classify safely in a linter; reported in --verbose
//    only, never flagged. The inline arrow is by far the most common shape and the
//    one the bug actually appears in.)
//
// It is a HEURISTIC, not a parser: an exotic-but-correct comparator it can't read
// (e.g. one returning a helper call) reads as OK (we only flag CLEAR booleans), so
// false BOOLEANs are very unlikely. A clever bug hidden in a block body is missed
// (out of scope, documented above) — same honest-scope tradeoff as the other gates.
//
// USAGE
//   scripts/find-bool-sort-comparator.mjs             # table of every inline comparator
//   scripts/find-bool-sort-comparator.mjs --check     # exit 1 if any BOOLEAN exists (CI gate)
//   scripts/find-bool-sort-comparator.mjs --self-test # prove the classifier on fixtures
//   scripts/find-bool-sort-comparator.mjs --verbose   # also list SKIP (block/named) sites
//
// OUTPUT (one line per inline comparator, BOOLEAN first):
//   <BOOLEAN|OK>  <file>:<line>  =>  <body>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Source selection ────────────────────────────────────────────────────────
// Same posture as the other gates: real authored source only. Skip tests (a gate
// that flagged its own fixtures would be useless), minified files, vendored bundles,
// and node_modules.
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
];
const EXT = /\.(js|mjs|ts|html)$/;
// Skip tests/minified/vendored — and THIS file: its docstring + self-test fixtures
// embed intentional boolean comparators that would otherwise self-trip the gate.
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-bool-sort-comparator\.mjs)/;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out);
    } else if (EXT.test(name) && !SKIP.test(p)) {
      out.push(p);
    }
  }
}

function sourceFiles() {
  const out = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), out);
  return out.sort();
}

// ── The classifier ───────────────────────────────────────────────────────────
// Pull the full parenthesised argument of every `.sort(` call (paren-balanced so
// nested calls like Math.abs(...) stay intact), then read the arrow body.

// Find each `.sort(` and return {body, index} for its balanced argument list.
function* sortCalls(src) {
  const re = /\.sort\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // position of the '('
    let depth = 0, i = open, inStr = null, prev = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
      } else if (c === '"' || c === "'" || c === '`') {
        inStr = c;
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      prev = c === '\\' && prev === '\\' ? '' : c;
    }
    if (depth === 0) {
      yield { arg: src.slice(open + 1, i), index: m.index };
    }
  }
}

// Given the inside of `.sort( ... )`, return the arrow body string, or a marker:
//   { kind: 'arrow', body }  — inline arrow expression: classify it
//   { kind: 'block' }        — arrow with a { } block body: out of scope
//   { kind: 'named' }        — no `=>` at top level (function ref / fn expr): out of scope
function comparatorBody(arg) {
  // Locate the FIRST top-level `=>` (skip ones nested inside parens, e.g. a default).
  let depth = 0, inStr = null, prev = '';
  for (let i = 0; i < arg.length - 1; i++) {
    const c = arg[i];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c; continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=' && arg[i + 1] === '>') {
      const body = arg.slice(i + 2).trim();
      if (body.startsWith('{')) return { kind: 'block' };
      return { kind: 'arrow', body };
    }
    prev = c;
  }
  return { kind: 'named' };
}

const OK_SIGNALS = [
  /\blocaleCompare\s*\(/,
  /\.compare\s*\(/,
  /\bNumber\s*\(/,
  /\bparse(Int|Float)\s*\(/,
  /\?/,             // a ternary — yields the numbers in its branches
];
// Subtraction used as a binary operator (the canonical correct comparator). Require a
// space-or-token on the left so a unary minus (`-a`) or arrow (`=>`) doesn't count.
const HAS_SUBTRACT = /[\w$\])]\s*-\s*[\w$([!+\-]/;
// A bare relational / equality comparison — the boolean-returning shape.
const HAS_RELATIONAL = /(<=?|>=?|===?|!==?)/;

function classifyBody(body) {
  // A relational op that isn't softened by an OK signal → boolean comparator.
  if (!HAS_RELATIONAL.test(body)) return 'OK';
  if (HAS_SUBTRACT.test(body)) return 'OK';
  for (const sig of OK_SIGNALS) if (sig.test(body)) return 'OK';
  return 'BOOLEAN';
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

// Classify one file's source string → [{verdict, line, body}] for inline arrows,
// plus skipped sites when verbose.
function classifySource(src, { verbose = false } = {}) {
  const rows = [];
  for (const { arg, index } of sortCalls(src)) {
    const cb = comparatorBody(arg);
    if (cb.kind === 'arrow') {
      rows.push({ verdict: classifyBody(cb.body), line: lineOf(src, index), body: cb.body.replace(/\s+/g, ' ').slice(0, 70) });
    } else if (verbose) {
      rows.push({ verdict: 'SKIP', line: lineOf(src, index), body: `(${cb.kind})` });
    }
  }
  return rows;
}

function classifyFile(path, opts) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  return classifySource(src, opts).map((r) => ({ ...r, path }));
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const check = (label, body, expect) => {
    const got = classifyBody(body);
    if (got === expect) { pass++; }
    else { fail++; console.log(`  ✗ ${label}: body \`${body}\` → ${got}, expected ${expect}`); }
  };
  // BOOLEAN — the bug, in its common forms.
  check('bare gt', 'a > b', 'BOOLEAN');
  check('prop gt', 'a.score > b.score', 'BOOLEAN');
  check('prop lt', 'a.name < b.name', 'BOOLEAN');
  check('gte', 'a.x >= b.x', 'BOOLEAN');
  check('strict-eq', 'a.id === b.id', 'BOOLEAN');
  check('nested-prop gt', 'a.s.total > b.s.total', 'BOOLEAN');
  // OK — every correct shape the repo actually uses.
  check('subtract', 'a - b', 'OK');
  check('prop subtract', 'b.length - a.length', 'OK');
  check('desc subtract', 'b.score.total - a.score.total', 'OK');
  check('abs subtract', 'Math.abs(b.delta) - Math.abs(a.delta)', 'OK');
  check('localeCompare', 'a.name.localeCompare(b.name)', 'OK');
  check('ternary', 'lowerIsBetter ? a - b : b - a', 'OK');
  check('coalesce subtract', '(counts[b] || 0) - (counts[a] || 0)', 'OK');
  check('tiebreak', 'a[1] - b[1] || a[0].name.localeCompare(b[0].name)', 'OK');
  check('Number coerce', 'Number(a.v) - Number(b.v)', 'OK');
  check('relational inside ternary returns num', 'a.x > b.x ? 1 : -1', 'OK');

  // Full-source extraction: paren-balanced arg + line numbers + block/named skip.
  const fixture = [
    'const a = list.sort((a, b) => a.score > b.score);',          // line 1 BOOLEAN
    'const b = list.sort((a, b) => b.size - a.size);',            // line 2 OK
    'const c = rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));', // line 3 OK (nested parens)
    'const d = rows.sort((a, b) => { return a.x - b.x; });',      // line 4 block → skipped
    'const e = rows.sort(byName);',                               // line 5 named → skipped
    'const f = rows.sort((a, b) => a.t < b.t);',                  // line 6 BOOLEAN
  ].join('\n');
  const rows = classifySource(fixture);
  const expectInline = [
    { line: 1, verdict: 'BOOLEAN' },
    { line: 2, verdict: 'OK' },
    { line: 3, verdict: 'OK' },
    { line: 6, verdict: 'BOOLEAN' },
  ];
  const inline = rows.map((r) => ({ line: r.line, verdict: r.verdict }));
  const eq = JSON.stringify(inline) === JSON.stringify(expectInline);
  if (eq) { pass++; } else { fail++; console.log(`  ✗ source extraction: got ${JSON.stringify(inline)}, expected ${JSON.stringify(expectInline)}`); }

  // Verbose should surface the two skipped sites as SKIP.
  const skips = classifySource(fixture, { verbose: true }).filter((r) => r.verdict === 'SKIP').length;
  if (skips === 2) { pass++; } else { fail++; console.log(`  ✗ verbose skip count: got ${skips}, expected 2`); }

  // Live-repo invariant: the gate must currently find ZERO booleans (else the
  // --check baseline is already red and the self-test is lying about a clean tree).
  const liveBool = sourceFiles().flatMap((f) => classifyFile(f)).filter((r) => r.verdict === 'BOOLEAN').length;
  if (liveBool === 0) { pass++; } else { fail++; console.log(`  ✗ live repo has ${liveBool} BOOLEAN comparator(s) — baseline not clean`); }

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
const bool = all.filter((r) => r.verdict === 'BOOLEAN');

if (args.has('--check')) {
  if (bool.length) {
    console.log(`✗ ${bool.length} BOOLEAN sort comparator(s):`);
    for (const r of bool) console.log(`  ${relative(ROOT, r.path)}:${r.line}  =>  ${r.body}`);
    process.exit(1);
  }
  const inlineCount = all.filter((r) => r.verdict !== 'SKIP').length;
  console.log(`✓ 0 BOOLEAN sort comparators (${inlineCount} numeric)`);
  process.exit(0);
}

// Default: table, BOOLEAN first.
const order = { BOOLEAN: 0, OK: 1, SKIP: 2 };
all.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.path.localeCompare(b.path) || a.line - b.line);
for (const r of all) {
  console.log(`${r.verdict.padEnd(7)}  ${relative(ROOT, r.path)}:${r.line}  =>  ${r.body}`);
}
const inlineCount = all.filter((r) => r.verdict !== 'SKIP').length;
console.log(`\n${bool.length} BOOLEAN / ${inlineCount} inline comparators${verbose ? '' : ' (use --verbose for block/named SKIPs)'}`);
