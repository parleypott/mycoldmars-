#!/usr/bin/env bun
//
// find-rangeerror-alloc.mjs — audit every `str.repeat(n)` and `new Array(n)` /
// `Array(n)` whose count `n` is a COMPUTED expression, and force a human to
// judge whether `n` can go negative / fractional / NaN / >2^32-1 at runtime.
// When it does, the allocation itself THROWS `RangeError` before anything else
// runs — synchronously crashing the whole render / handler that reached it.
//
// WHY THIS EXISTS
// Both allocators reject an out-of-range count by THROWING, not by clamping:
//   • `'x'.repeat(n)`  → RangeError if n < 0 or n === Infinity
//   • `new Array(n)` / `Array(n)` → RangeError if n < 0, non-integer, or ≥ 2^32
// (`Array.from({length:n})` is the SAFE sibling — it runs ToLength, clamping a
// negative/NaN count to 0 — so this gate deliberately does NOT flag it.)
//
// For a normally-small, always-nonneg count it's invisible: every test with a
// handful of items passes. It bites only when real data drives the count below
// zero or to NaN — exactly the "computed value goes negative under real input"
// failure the loop has fixed again and again (nile `dur()` negative minutes, the
// tight-connection negative-minute label, etc.). No standing gate watched the
// allocation form of it: the divide-by-length / truthy-zero / spread / date /
// json gates are all blind to `repeat`/`Array` RangeError.
//
// WHAT IT SCANS
// Every `.repeat(` call and every `new Array(` / bare `Array(` call whose count
// argument is NOT a plain non-negative integer literal. A char-repeat pad or a
// fixed-size preallocation with a literal (`'-'.repeat(40)`, `new Array(12)`) is
// safe by construction and skipped; a computed count (`n.repeat(k)`,
// `new Array(end - start)`) is surfaced for judgement. `Array.from(...)` is not
// matched (it clamps). `.length`-based preallocation is a computed arg but is
// always a safe nonneg integer — it's surfaced and judged SAFE in the ledger,
// same as any other proven-safe site.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a computed count can actually go out of range is semantic and
// non-local — `Math.max(0, x)` / `arr.length` / a validated clamp are safe; a
// raw `end - start` from user data is not. A pure syntactic classifier can't
// tell these apart without false-flagging the safe ones and turning `bun run
// test` red on healthy code. So — exactly like find-spread-overflow.mjs — this
// gate LISTS every computed-count site, cross-references
// scripts/rangeerror-alloc-triage.tsv, and (in --check) FAILS only on a site
// nobody has judged yet. A newly introduced `new Array(userCount)` trips the
// gate the moment it lands; everything already judged SAFE stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-rangeerror-alloc.mjs              # table of every site + verdict
//   scripts/find-rangeerror-alloc.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-rangeerror-alloc.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-rangeerror-alloc.mjs --new        # list ONLY untriaged sites
//   scripts/find-rangeerror-alloc.mjs --dump-ledger # seed TSV stub rows
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'rangeerror-alloc-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `.repeat(...)` / `new Array(...)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-rangeerror-alloc\.mjs|rangeerror-alloc-triage\.tsv)/;

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

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

import { stripComments } from './lib/strip-comments.mjs';

// Normalize a snippet to a stable ledger key: collapse all whitespace away.
function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── The scanner ───────────────────────────────────────────────────────────────
// Two allocator heads that RangeError on a bad count:
//   `.repeat(`  — String.prototype.repeat
//   `new Array(` / bare `Array(` — the Array constructor (NOT `Array.from(`,
//   which clamps; `\bArray\s*\(` cannot match `Array.from(` because a `.` sits
//   between `Array` and `(`).
// We capture the WHOLE call via a balanced-paren forward scan so the human sees
// exactly which count is passed, and skip sites whose count is a plain
// non-negative integer literal (safe by construction).
const HEAD = /\.repeat\s*\(|\bnew\s+Array\s*\(|\bArray\s*\(/g;
const INT_LITERAL = /^\d+$/;

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  HEAD.lastIndex = 0;
  let m;
  while ((m = HEAD.exec(src)) !== null) {
    const openParen = src.indexOf('(', m.index);
    if (openParen < 0) continue;
    // Balanced-paren forward scan to the matching `)`.
    let depth = 0, end = openParen + 1;
    for (let i = openParen; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const arg = src.slice(openParen + 1, end - 1).trim();
    // Skip the safe-by-construction shapes: empty count (`Array()`), or a plain
    // non-negative integer literal (`repeat(40)`, `new Array(12)`).
    if (arg === '' || INT_LITERAL.test(arg)) continue;
    const snippet = src.slice(m.index, end).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, m.index), snippet, key: normalize(snippet) });
  }
  return rows;
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  return scanSource(src).map((r) => ({ ...r, path, rel: relative(ROOT, path), fileKey: relative(ROOT, path) + '\t' + r.key }));
}

// ── Ledger ──────────────────────────────────────────────────────────────────
// TSV: FILE <TAB> SNIPPET-KEY <TAB> STATUS <TAB> REASON   (# = comment / blank skipped)
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

function allSites() {
  return sourceFiles().flatMap(scanFile);
}

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
  // Flags computed-count allocations. The `.repeat` head captures from `.repeat(`
  // (receiver-less) — the COUNT is what decides RangeError, so that's what the
  // human needs to see; the Array head captures `new Array(`/`Array(` whole.
  expectSites('repeat computed', 'const s = ch.repeat(n);', ['.repeat(n)']);
  expectSites('repeat expr', 'const s = "-".repeat(w - 1);', ['.repeat(w - 1)']);
  expectSites('new Array computed', 'const a = new Array(count);', ['new Array(count)']);
  expectSites('bare Array computed', 'const a = Array(end - start);', ['Array(end - start)']);
  expectSites('repeat nested parens', 'const s = p.repeat(Math.max(0, n));', ['.repeat(Math.max(0, n))']);
  // Does NOT flag the safe-by-construction shapes.
  expectSites('repeat literal', 'const s = "-".repeat(40);', []);
  expectSites('new Array literal', 'const a = new Array(12);', []);
  expectSites('Array empty', 'const a = Array();', []);
  expectSites('Array.from length', 'const a = Array.from({ length: n });', []);
  expectSites('Array.from clamps', 'const a = Array.from({ length: n - 1 }, f);', []);
  expectSites('Array.isArray', 'const b = Array.isArray(x);', []);
  expectSites('property max not array', 'const b = grid.Array;', []);
  expectSites('comment', '// const s = ch.repeat(n)\nconst y = 1;', []);
  expectSites('string literal', "const s = 'x.repeat(n)';", []);
  expectSites('substring not repeat', 'const s = a.repeatable(n);', []);

  // Regex-literal desync guard: a regex whose body holds a quote must NOT blank a
  // following alloc site.
  expectSites('regex-with-quote then site',
    "s = s.replace(/_x$/i, ''); const a = new Array(n);",
    ['new Array(n)']);
  expectSites('divide then site',
    'const k = a / b.length; const s = ch.repeat(w);',
    ['.repeat(w)']);

  // Multi-site + line numbers (two computed allocs + literal/from skips).
  const fixture = [
    'const a = new Array(n);',            // line 1 site
    'const b = "-".repeat(40);',          // line 2 NO (literal)
    'const c = ch.repeat(w - pad);',      // line 3 site
    'const d = Array.from({length: k});', // line 4 NO (from clamps)
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 3]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,3]`); }

  // Two sites on ONE line both captured.
  const oneLine = 'const a = new Array(n), b = ch.repeat(w);';
  const two = scanSource(oneLine).map((r) => r.snippet);
  if (JSON.stringify(two) === JSON.stringify(['new Array(n)', '.repeat(w)'])) pass++;
  else { fail++; console.log(`  ✗ two-on-one-line: got ${JSON.stringify(two)}`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = ch.repeat( n - 1 );')[0].key;
  const k2 = scanSource('const g=ch.repeat(n-1);')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (every live computed-count site judged SAFE in the ledger), else --check
  // is already red.
  const live = classify(allSites(), readLedger());
  const unresolved = live.filter((s) => s.status !== 'SAFE');
  if (unresolved.length === 0) pass++;
  else {
    fail++;
    console.log(`  ✗ live repo has ${unresolved.length} unresolved site(s) (NEW/BUG) — baseline not clean:`);
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
    console.log(`✗ ${newSites.length} untriaged repeat/Array computed-count site(s) — judge each (can the count go negative / NaN / fractional / ≥2^32?), then add a row to scripts/rangeerror-alloc-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open RangeError-alloc BUG(s) in the ledger — clamp the count (Math.max(0, …) / validate) or use Array.from({length}):`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} repeat/Array computed-count site(s), all triaged SAFE.`);
  process.exit(0);
}

if (args.has('--dump-ledger')) {
  for (const s of sites) console.log(`${s.rel}\t${s.key}\tSAFE\t`);
  process.exit(0);
}

if (args.has('--new')) {
  for (const s of newSites) console.log(`NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
  if (!newSites.length) console.log('(no untriaged sites)');
  process.exit(0);
}

// Default: full table.
console.log('repeat/Array computed-count sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
