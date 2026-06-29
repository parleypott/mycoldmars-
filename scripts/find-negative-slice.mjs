#!/usr/bin/env bun
//
// find-negative-slice.mjs — audit every `.slice(-<expr>)` whose count is NOT a
// numeric literal, and force a human to judge whether that count can be ZERO
// (or NaN / negative / non-integer) — the `slice(-0)` trap.
//
// WHY THIS EXISTS
// "Keep the last N" is almost always written `arr.slice(-N)`. That reads fine
// until N is a runtime value that can be 0:
//
//     const kept = items.slice(-keepCount);     // keepCount === 0  → WHOLE array
//     const win  = history.slice(-cap);          // cap === 0/NaN    → WHOLE array
//
// In JS, `(-0)` is `0`, and `[1,2,3].slice(0)` returns the ENTIRE array — the
// exact OPPOSITE of "keep the last 0". `slice(NaN)` and `slice(-2.5)` collapse
// the same way; a genuinely negative count keeps too many. So a cap that should
// TRIM to N silently passes EVERYTHING through. It is invisible in a quick test
// (every count ≥ 1 behaves perfectly) and the blown-through array then bloats a
// prompt window, defeats a "newest N" cap, or ships an unbounded payload.
//
// This loop has hand-fixed this exact shape ≥3×: the QSS loved-aware variation
// cap (`unloved.slice(-keepUnlovedCount)` with keepUnlovedCount 0), prune-
// variations, and the Gemini chat-window builder (`history.slice(-cap)` with a
// future config-driven cap of 0). No existing gate watches for it — truthy-zero
// looks at `|| 0` defaults, divide-by-length at `/ x.length`, neither sees a
// negative-slice count.
//
// WHAT IT SCANS
// Every `.slice(` immediately followed by `-` and a NON-numeric-literal count
// (an identifier, member access, or parenthesised expression). Literal counts
// — `.slice(-1)`, `.slice(-10)` — are ALWAYS safe and are NOT flagged; the trap
// only exists when the magnitude is computed at runtime.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a negative-slice count can actually be 0 is semantic and usually
// NON-LOCAL:
//   • the count is a module-level CONSTANT ( = 50 )                  (safe)
//   • the count is guarded ( keepCount > 0 ? a.slice(-keepCount) : … ) (safe)
//   • the count is clamped ( Math.max(1, n) ) before the slice         (safe)
//   • a raw param / config value with no guard                         (BUG)
// A pure syntactic classifier can't tell these apart without false-flagging the
// safe ones (which would turn `bun run test` red on healthy code). So — exactly
// like find-divide-by-length.mjs and find-truthy-zero.mjs — this gate LISTS every
// site, cross-references scripts/negative-slice-triage.tsv, and (in --check)
// FAILS only on a site nobody has judged yet. A newly introduced unguarded
// `arr.slice(-cap)` trips the gate the moment it lands; everything already judged
// stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers. If a judged snippet's surrounding text changes
// enough to alter the snippet, it reads as NEW again (re-review), the safe way.
//
// USAGE
//   scripts/find-negative-slice.mjs              # table of every site + verdict
//   scripts/find-negative-slice.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-negative-slice.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-negative-slice.mjs --new        # list ONLY untriaged sites
//   scripts/find-negative-slice.mjs --dump-ledger # emit SAFE stub rows to seed the TSV
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'negative-slice-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `.slice(-x)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-negative-slice\.mjs|negative-slice-triage\.tsv)/;

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

// Normalize a snippet to a stable ledger key: collapse all whitespace away.
function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── The scanner ───────────────────────────────────────────────────────────────
// A `.slice(` whose first argument is a NEGATED non-literal: `(`, ws, `-`, ws,
// then an identifier / member-access / parenthesised expression. The negative
// lookahead `(?![\d.])` excludes numeric literals (`.slice(-1)`, `.slice(-1.5)`,
// `.slice(-.5)`) which are always safe. We then balance-scan the argument so the
// snippet shows the full `-<count>` even with nested parens.
const NEG_SLICE = /\.slice\(\s*-\s*(?=[A-Za-z_$(])/g;
const CTX = 50; // chars of left context to include in the snippet

// From the `(` opened at `openIdx`, return the index just past its matching `)`.
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return Math.min(src.length, openIdx + 40); // unbalanced — clamp
}

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  NEG_SLICE.lastIndex = 0;
  let m;
  while ((m = NEG_SLICE.exec(src)) !== null) {
    // `.slice(` — the `(` is at the index of the last char consumed before the
    // whitespace/`-`. Find it precisely: it's the first `(` after `.slice`.
    const sliceAt = m.index;
    const openIdx = src.indexOf('(', sliceAt);
    const argEnd = matchParen(src, openIdx);
    // Left context clamped at the nearest statement / expression boundary.
    let start = Math.max(0, sliceAt - CTX);
    for (const ch of [';', '{', '}', '\n', '(']) {
      const b = src.lastIndexOf(ch, sliceAt - 1);
      if (b >= start) start = b + 1;
    }
    const snippet = src.slice(start, argEnd).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, sliceAt), snippet, key: normalize(snippet) });
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
  // Flags the negative-slice-by-variable forms. The snippet carries left context
  // (back to the nearest ;{}\n( boundary) so a reviewer sees the assignment.
  expectSites('plain var', 'const k = items.slice(-keepCount);', ['const k = items.slice(-keepCount)']);
  expectSites('member chain', 'const w = a.b.slice(-cfg.cap);', ['const w = a.b.slice(-cfg.cap)']);
  expectSites('spaced minus', 'const w = h.slice(- cap);', ['const w = h.slice(- cap)']);
  expectSites('paren expr', 'const w = h.slice(-(n + 1));', ['const w = h.slice(-(n + 1))']);
  // Does NOT flag the always-safe / out-of-scope forms.
  expectSites('literal 1', 'const last = a.slice(-1);', []);
  expectSites('literal 10', 'const t = a.slice(-10);', []);
  expectSites('literal float', 'const t = a.slice(-1.5);', []);
  expectSites('positive slice', 'const t = a.slice(cap);', []);          // not negated
  expectSites('two-arg positive', 'const t = a.slice(0, n);', []);        // not negated
  expectSites('comment', '// kept = items.slice(-keepCount)\nconst x = 1;', []);
  expectSites('string literal', "const s = 'a.slice(-cap)';", []);

  // Multi-site + line numbers (two real negative-var slices + skips between).
  const fixture = [
    'const a = xs.slice(-cap);',     // line 1 site
    'const b = ys.slice(-2);',       // line 2 NO (literal)
    'const c = zs.slice(start);',    // line 3 NO (not negated)
    'const d = ws.slice(-keep);',    // line 4 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = items.slice( -  keepCount );')[0].key;
  const k2 = scanSource('const g=items.slice(-keepCount);')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (every live site judged SAFE in the ledger), else --check is already red.
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
    console.log(`✗ ${newSites.length} untriaged negative-slice site(s) — judge each (can the count be 0/NaN?), then add a row to scripts/negative-slice-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open negative-slice BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} negative-slice site(s), all triaged SAFE.`);
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
console.log('negative-slice sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
