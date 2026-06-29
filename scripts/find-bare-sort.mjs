#!/usr/bin/env bun
//
// find-bare-sort.mjs — audit every bare `.sort()` (a sort call with NO comparator)
// and force a human to judge whether it is sorting NUMBERS lexicographically.
//
// WHY THIS EXISTS
// `Array.prototype.sort()` with no comparator coerces every element to a STRING
// and orders by UTF-16 code units. On numbers that is silently, classically wrong:
//
//     [1, 10, 2, 21, 3].sort()        // → [1, 10, 2, 21, 3]  (string order!)
//     ['2026-06-1', '2026-06-18'].sort()   // OK — fixed-width ISO sorts right
//
// It "works" on small same-width data and on genuinely string keys, so it ships
// unnoticed and corrupts exactly the ordered, user-facing lists this repo is full
// of (day groupings, timeline buckets, ranked keys). Whether a given bare sort is
// a BUG depends on what the receiver holds — ISO dates / fixed-width-prefixed keys
// / route strings sort fine; raw numbers do not — which is SEMANTIC, not syntactic.
//
// THE BLIND SPOT THIS CLOSES
// The two existing sort gates — find-bool-sort-comparator.mjs and
// find-nan-sort-comparator.mjs — only ever inspect the BODY of an inline-arrow
// comparator. A sort with NO comparator has no body, so BOTH are structurally
// blind to it. A one-off sweep (obs 5256, 2026-06-29) inventoried ~15 bare sorts
// and judged them by hand, but built nothing — so the next bare-numeric-sort has
// nothing watching for it. This gate is that watcher, and it shares the SAME
// `.sort(` extractor (sort-comparators.mjs → sortCalls) as its two siblings, so
// the three can never drift on what counts as a sort call.
//
// WHY A LEDGER, NOT A HEURISTIC
// A pure classifier cannot know if a receiver holds numbers (`days.sort()` could
// be ISO strings or raw day-numbers). So this uses the proven find-truthy-zero
// design: list every bare sort, cross-reference scripts/bare-sort-triage.tsv, and
// in --check FAIL only on a site nobody has judged yet. A newly introduced bare
// `nums.sort()` trips the gate the moment it lands; everything already judged
// SAFE stays quiet. The ledger key is (file, normalized-receiver) — not file:line
// — so it survives edits that shift line numbers; if the receiver text itself
// changes it reads as NEW again (re-review), the safe direction.
//
// SCOPE
//   • Flags `x.sort()` / `x.sort( )` — empty argument list only.
//   • A sort WITH any argument (`x.sort(cmp)`, `x.sort((a,b)=>…)`) is OUT OF SCOPE
//     here — that's the two comparator gates' job.
//   • `.toSorted()` is not matched (no `.sort(` substring) — same honest scope.
//
// USAGE
//   scripts/find-bare-sort.mjs              # table of every bare sort + its verdict
//   scripts/find-bare-sort.mjs --check      # exit 1 if any NEW (untriaged) bare sort
//   scripts/find-bare-sort.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-bare-sort.mjs --new        # list ONLY untriaged sites
//   scripts/find-bare-sort.mjs --emit-ledger # TSV seed rows (status SAFE) for NEW sites
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <receiver>.sort()
//   STATUS = SAFE (ledger: judged a non-bug) | BUG (ledger: open, fix it)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ROOT, sourceFiles as collectSourceFiles, buildSkip, SORT_GATE_FILES, sortCalls, lineOf, stripComments,
} from './sort-comparators.mjs';

const LEDGER = join(ROOT, 'scripts', 'bare-sort-triage.tsv');

// Skip the shared base set + the whole sort-gate family (this gate's own file +
// ledger + the sibling comparator gates), whose docstrings/fixtures embed `.sort`
// examples that would otherwise self-trip the gate.
const SKIP = buildSkip(SORT_GATE_FILES);
const sourceFiles = () => collectSourceFiles(SKIP);

// ── Receiver capture ──────────────────────────────────────────────────────────
// Given the index of `.sort` (the dot), walk BACKWARD over a balanced receiver
// expression so chained / parenthesised receivers stay intact:
//   Object.entries(byDay).sort()   → "Object.entries(byDay)"
//   foo.map(x => x).slice().sort() → "foo.map(x => x).slice()"
//   const days = keys.sort()       → "keys"
// Stops at a depth-0 boundary (an opening bracket that began an enclosing call,
// whitespace, or an operator/separator), which is where the receiver expression
// begins.
function captureReceiver(src, dotIdx) {
  let i = dotIdx - 1;
  while (i >= 0 && /\s/.test(src[i])) i--; // skip space between receiver and `.sort`
  const end = i + 1;
  let depth = 0;
  for (; i >= 0; i--) {
    const c = src[i];
    if (c === ')' || c === ']' || c === '}') { depth++; continue; }
    if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) break; // an unmatched open = the receiver starts after it
      depth--; continue;
    }
    if (depth === 0 && /[\s;,=&|!?:+\-*/%<>~^]/.test(c)) break; // operator / separator boundary
  }
  return src.slice(i + 1, end).trim();
}

const normalize = (s) => s.replace(/\s+/g, '');

// Scan one source string → [{line, receiver, snippet, key}] for each BARE sort.
// Comments are blanked first (offset-preserving) so a `.sort()` written in a
// docstring is never mistaken for a real call. A `.sort()` inside a *string
// literal* is NOT stripped (a correct JS string/template/regex lexer is not
// worth its fragility — a naive one mis-tracks template apostrophes and blanks
// real code) — but that's astronomically rare in authored source, and if one
// ever appears it simply reads as a NEW site to triage SAFE once. Same
// honest-scope tradeoff the comparator gates make.
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  for (const { arg, index } of sortCalls(src)) {
    if (arg.trim() !== '') continue; // has a comparator → not our scope
    const receiver = captureReceiver(src, index) || '(?)';
    const snippet = `${receiver}.sort()`.replace(/\s+/g, ' ').slice(0, 80);
    rows.push({ line: lineOf(src, index), receiver, snippet, key: normalize(receiver) });
  }
  return rows;
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  const rel = relative(ROOT, path);
  return scanSource(src).map((r) => ({ ...r, path, rel, fileKey: rel + '\t' + r.key }));
}

// ── Ledger ──────────────────────────────────────────────────────────────────
// TSV: FILE <TAB> RECEIVER-KEY <TAB> STATUS <TAB> REASON   (# = comment / blank skipped)
function readLedger() {
  let txt;
  try { txt = readFileSync(LEDGER, 'utf8'); } catch { return new Map(); }
  const map = new Map();
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [file, key, status, ...reason] = line.split('\t');
    if (!file || !key || !status) continue;
    map.set(file + '\t' + key, { status: status.trim().toUpperCase(), reason: reason.join('\t').trim() });
  }
  return map;
}

const allSites = () => sourceFiles().flatMap(scanFile);

function classify(sites, ledger) {
  return sites.map((s) => {
    const hit = ledger.get(s.fileKey);
    return { ...s, status: hit ? hit.status : 'NEW', reason: hit ? hit.reason : '' };
  });
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const expectSites = (label, src, expected) => {
    const got = scanSource(src).map((r) => r.snippet);
    const eq = JSON.stringify(got) === JSON.stringify(expected);
    if (eq) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
  };
  // Bare sorts — flagged, with the receiver captured (balanced, chain-aware).
  expectSites('bare ident', 'const d = keys.sort();', ['keys.sort()']);
  expectSites('bare with space', 'keys.sort( );', ['keys.sort()']);
  expectSites('chained map', 'const a = foo.map(x => x).sort();', ['foo.map(x => x).sort()']);
  expectSites('entries', 'for (const e of Object.entries(byDay).sort()) {}', ['Object.entries(byDay).sort()']);
  expectSites('slice chain', 'const k = ids.slice().sort().join();', ['ids.slice().sort()']);
  expectSites('inside call arg', 'render(rows.sort());', ['rows.sort()']);
  // NOT flagged — a sort WITH a comparator (the two comparator gates' job).
  expectSites('arrow comparator', 'list.sort((a, b) => a - b);', []);
  expectSites('bool comparator', 'list.sort((a, b) => a > b);', []);
  expectSites('named comparator', 'list.sort(byName);', []);
  expectSites('comparator with parens', 'list.sort((a, b) => Math.abs(a) - Math.abs(b));', []);
  // A real comparator whose ARG contains a string with ".sort()" text: the OUTER
  // sort is correctly skipped (has a comparator). The string-internal ".sort()"
  // is surfaced as a (bare) site — documented out-of-scope edge, ledger-absorbed.
  // This pins the behavior so a future "fix" that strips strings (and regresses
  // by mis-tracking template apostrophes) is caught.
  expectSites('string-internal sort surfaced', `list.sort((a, b) => a.localeCompare(b, "x.sort()"));`, ['"x.sort()']);
  // Comments are stripped, so a `.sort()` in a docstring is NOT surfaced.
  expectSites('comment sort ignored', 'const x = 1; // call arr.sort() here\nq.sort();', ['q.sort()']);

  // Multi-site + line numbers.
  const fixture = [
    'const a = nums.sort();',                 // line 1 site
    'const b = list.sort((a,b) => a-b);',     // line 2 NO (comparator)
    'const c = days.sort();',                 // line 3 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 3]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,3]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = Object.entries( byDay ) .sort();')[0].key;
  const k2 = scanSource('const g=Object.entries(byDay).sort();')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: every live bare sort must be judged SAFE in the ledger,
  // else --check is already red and this self-test would be lying about a clean tree.
  const live = classify(allSites(), readLedger());
  const unresolved = live.filter((s) => s.status !== 'SAFE');
  if (unresolved.length === 0) pass++;
  else {
    fail++;
    console.log(`  ✗ live repo has ${unresolved.length} unresolved bare sort(s) (NEW/BUG) — baseline not clean:`);
    for (const s of unresolved) console.log(`      ${s.status}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
  }

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) process.exit(selfTest());

const ledger = readLedger();
const sites = classify(allSites(), ledger).sort(
  (a, b) => a.rel.localeCompare(b.rel) || a.line - b.line,
);
const newSites = sites.filter((s) => s.status === 'NEW');
const bugSites = sites.filter((s) => s.status === 'BUG');

if (args.has('--check')) {
  if (newSites.length) {
    console.log(`✗ ${newSites.length} untriaged bare sort(s) — judge each, then add a row to scripts/bare-sort-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    console.log(`\n(A site is a BUG if the receiver holds NUMBERS — a no-comparator sort orders them lexicographically. Fixed-width keys / ISO dates / strings are SAFE. Fix bugs, then record SAFE with a one-line reason.)`);
    process.exit(1);
  }
  console.log(`✓ 0 untriaged bare sorts (${sites.length} judged: ${sites.filter((s) => s.status === 'SAFE').length} SAFE, ${bugSites.length} open BUG)`);
  process.exit(bugSites.length ? 1 : 0);
}

if (args.has('--emit-ledger')) {
  for (const s of newSites) console.log(`${s.rel}\t${s.key}\tSAFE\t`);
  process.exit(0);
}

if (args.has('--new')) {
  if (!newSites.length) { console.log('No untriaged sites.'); process.exit(0); }
  for (const s of newSites) console.log(`NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
  process.exit(0);
}

// Default: full table.
const order = { BUG: 0, NEW: 1, SAFE: 2 };
sites.sort((a, b) => (order[a.status] - order[b.status]) || a.rel.localeCompare(b.rel) || a.line - b.line);
for (const s of sites) {
  console.log(`${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n${sites.length} bare sort(s): ${newSites.length} NEW, ${bugSites.length} BUG, ${sites.filter((s) => s.status === 'SAFE').length} SAFE`);
