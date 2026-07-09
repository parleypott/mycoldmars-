#!/usr/bin/env bun
//
// find-negative-modulo.mjs — audit every `( … - … ) % <collection-size>` whose
// numerator SUBTRACTS without adding the modulus back — the negative-modulo
// backward-index trap.
//
// WHY THIS EXISTS
// Circular indexing forward is safe: `next = (i + 1) % len`. Going BACKWARD is
// the footgun, because JavaScript's `%` is a REMAINDER, not a modulo — it keeps
// the sign of the dividend:
//
//     (0 - 1) % 5   ===  -1        // NOT 4
//     prev = arr[(i - 1) % len];   // i === 0  → arr[-1] → undefined
//
// So a "previous slide / prev question / wrap to the end" handler that writes
// `(i - 1) % len` silently returns `undefined` (or a blank / crash) at the ONE
// boundary that matters — the first element wrapping to the last. The correct
// form always adds the modulus back before the `%`:
//
//     prev = arr[(i - 1 + len) % len];   // i === 0 → arr[4]   ✓
//     prev = arr[(i + len - 1) % len];   // equivalent          ✓
//
// It is invisible in a quick test (every index ≥ 1 behaves perfectly) and only
// bites at the wrap boundary — exactly the case a carousel / quiz / player /
// gallery reaches when the user clicks "back" on the first item. No existing gate
// watches for it: truthy-zero looks at `|| 0` defaults, divide-by-length at
// `/ x.length`, negative-slice at `.slice(-n)`; none sees a signed remainder.
//
// WHAT IT SCANS
// A `%` whose LEFT operand is a PARENTHESISED GROUP (not a function call) whose
// top-level expression contains a binary subtraction, and whose RIGHT operand
// (the modulus) LOOKS LIKE A COLLECTION SIZE — a `.length` access or an
// identifier in the size vocabulary (…length / …count / len / size / total / N /
// frames / items / cards / slides / steps / stops / slots / pages / panels).
// A numerator that already ADDS the modulus operand back (`… + len …`, the
// canonical compensator) is treated as SAFE and NOT flagged.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a flagged site is a real bug is semantic and often NON-LOCAL:
//   • the index is proven ≥ the subtrahend before the `%`                 (safe)
//   • the value is used somewhere the sign can't reach arr[-1]            (safe)
//   • it really is an unguarded backward wrap                            (BUG)
// A pure syntactic classifier can't tell these apart without false-flagging the
// safe ones (which would turn `bun run test` red on healthy code). So — exactly
// like find-negative-slice.mjs / find-divide-by-length.mjs / find-truthy-zero.mjs
// — this gate LISTS every site, cross-references scripts/negative-modulo-triage.tsv,
// and (in --check) FAILS only on a site nobody has judged yet. A newly introduced
// `(i - 1) % len` trips the gate the moment it lands; everything already judged
// stays quiet. The repo is currently CLEAN (zero sites), so the ledger is empty
// and --check is green until the first one ships.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-negative-modulo.mjs              # table of every site + verdict
//   scripts/find-negative-modulo.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-negative-modulo.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-negative-modulo.mjs --new        # list ONLY untriaged sites
//   scripts/find-negative-modulo.mjs --dump-ledger # emit SAFE stub rows to seed the TSV
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'negative-modulo-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified bundles,
// vendored assets, node_modules, and THIS file + its ledger (whose docstrings
// embed example `( i - 1 ) % len` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-negative-modulo\.mjs|negative-modulo-triage\.tsv)/;

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
// A collection-size modulus: a `.length` access or an identifier in the size
// vocabulary. Kept high-signal on purpose — a parity check `(a - b) % 2` or a
// hash `(x - y) % PRIME` is NOT circular indexing and must not be flagged.
const SIZE_WORD = /(?:length|count|size|total|frames|items|cards|slides|steps|stops|slots|pages|panels)$/i;
function isSizeModulus(tok) {
  if (!tok) return false;
  if (/\.length$/.test(tok)) return true;                 // arr.length, this.frames.length
  const bare = tok.replace(/^.*\./, '');                  // a.b.count → count
  if (bare === 'len' || bare === 'n' || bare === 'N') return true;
  return SIZE_WORD.test(bare);
}

// Does `inner` (a parenthesised numerator) contain a BINARY subtraction at any
// depth? A binary minus is a `-` preceded (ignoring ws) by an identifier char,
// `)`, or `]` — i.e. an operand, not a unary sign.
function hasBinarySub(inner) {
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '-') continue;
    let j = i - 1;
    while (j >= 0 && /\s/.test(inner[j])) j--;
    if (j >= 0 && /[A-Za-z0-9_$)\]]/.test(inner[j])) return true;
  }
  return false;
}

// Is the numerator already COMPENSATED — does it add the modulus operand back
// INSIDE the group (`(i - 1 + len) % len`, `(i + len - 1) % len`)? Best-effort
// textual: the modulus token appears immediately adjacent to a `+` in the numerator.
function isCompensated(inner, modTok) {
  const flat = inner.replace(/\s+/g, '');
  const m = modTok.replace(/\s+/g, '');
  return flat.includes('+' + m) || flat.includes(m + '+');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The canonical safe DOUBLE-MOD idiom wraps the remainder and re-mods:
//   ((i - 1) % len + len) % len
// Here the `%` we matched is the INNER one; the compensation is the trailing
// `+ len ) % len` AFTER the modulus operand, not inside the numerator group. If
// the text right after the modulus is exactly `+ <modTok> ) % <modTok>`, this is
// that idiom → SAFE. (A bare trailing `+ len` with NO outer `%` is NOT accepted —
// that shape is itself out-of-range for non-boundary indices, so it stays flagged.)
function isDoubleModWrapped(src, afterModIdx, modTok) {
  const m = escapeRe(modTok);
  const re = new RegExp(`^\\s*\\+\\s*${m}\\s*\\)\\s*%\\s*${m}`);
  return re.test(src.slice(afterModIdx));
}

// From the `(` opened at openIdx, return the index just past its matching `)`.
function matchParenFwd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// Given the index of a `)`, return the index of its matching `(` (backward scan).
function matchParenBack(src, closeIdx) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const c = src[i];
    if (c === ')') depth++;
    else if (c === '(') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Read the modulus operand starting at index i (first non-ws char after `%`).
// Accepts an identifier chain (`arr.length`, `this.items`) — the only shapes the
// size vocabulary cares about. Returns { tok, end } or null.
function readOperand(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  const m = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i));
  if (!m) return null;
  return { tok: m[0], end: i + m[0].length };
}

const CTX = 60; // chars of left context to include in the snippet

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  for (let k = 0; k < src.length; k++) {
    if (src[k] !== '%') continue;
    if (src[k + 1] === '=' || src[k - 1] === '%' || src[k + 1] === '%') continue; // %=, %%

    // LEFT operand must be a parenthesised GROUP: skip ws back to a `)`.
    let j = k - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0 || src[j] !== ')') continue;
    const openIdx = matchParenBack(src, j);
    if (openIdx < 0) continue;
    // Reject a function CALL `foo(...)` — the `(` preceded by an identifier char.
    let b = openIdx - 1;
    while (b >= 0 && /\s/.test(src[b])) b--;
    if (b >= 0 && /[A-Za-z0-9_$\].]/.test(src[b])) continue;

    const inner = src.slice(openIdx + 1, j);
    if (!hasBinarySub(inner)) continue;

    // RIGHT operand: the modulus. Must look like a collection size.
    const rhs = readOperand(src, k + 1);
    if (!rhs || !isSizeModulus(rhs.tok)) continue;
    if (isCompensated(inner, rhs.tok)) continue;                 // `(i - 1 + len) % len` → safe
    if (isDoubleModWrapped(src, rhs.end, rhs.tok)) continue;     // `((i-1) % len + len) % len` → safe

    // Snippet: from a left boundary back to the nearest statement edge, through
    // the modulus operand, so a reviewer sees the whole `(… - …) % size`.
    let start = Math.max(0, openIdx - CTX);
    for (const ch of [';', '{', '}', '\n']) {
      const bd = src.lastIndexOf(ch, openIdx - 1);
      if (bd >= start) start = bd + 1;
    }
    const snippet = src.slice(start, rhs.end).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, openIdx), snippet, key: normalize(snippet) });
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
  // Flags the uncompensated backward-wrap forms.
  expectSites('prev via .length', 'const p = arr[(i - 1) % arr.length];', ['const p = arr[(i - 1) % arr.length']);
  expectSites('prev via len', 'idx = (idx - 1) % len;', ['idx = (idx - 1) % len']);
  expectSites('word size', 'const q = (cur - 1) % slides.length;', ['const q = (cur - 1) % slides.length']);
  expectSites('count modulus', 'const s = (n - step) % count;', ['const s = (n - step) % count']);
  expectSites('member size', 'const s = (i - 1) % this.items.length;', ['const s = (i - 1) % this.items.length']);
  // Does NOT flag the compensated / out-of-scope forms.
  expectSites('compensated +len', 'const p = (i - 1 + len) % len;', []);
  expectSites('compensated len last', 'const p = (i + len - 1) % len;', []);
  expectSites('compensated .length', 'const p = (i - 1 + arr.length) % arr.length;', []);
  // The canonical double-mod idiom `((i - 1) % len + len) % len` is SAFE — the
  // real live shape the border games use. The inner `%` must NOT be flagged.
  expectSites('double-mod len', 'const o = ((i - 1) % len + len) % len;', []);
  expectSites('double-mod .length', 'const o = ((p - t) % eligible.length + eligible.length) % eligible.length;', []);
  // But a bare trailing `+ len` with NO outer `%` is out-of-range for non-boundary
  // indices, so it stays FLAGGED (not masked as compensated).
  expectSites('bare +len no outer mod', 'const o = (i - 1) % len + len;', ['const o = (i - 1) % len']);
  expectSites('forward wrap', 'const nx = (i + 1) % len;', []);              // no subtraction
  expectSites('plain modulo', 'const nx = i % len;', []);                    // no parens/sub
  expectSites('parity check', 'const even = (a - b) % 2;', []);              // numeric modulus, not a size
  expectSites('non-size ident', 'const r = (a - b) % PRIME;', []);          // modulus not a size word
  expectSites('function call', 'const r = foo(a - b) % len;', []);           // call, not a group
  expectSites('modassign', 'x %= (a - b);', []);                             // %=, not a modulo read
  expectSites('comment', '// prev = (i - 1) % len\nconst x = 1;', []);
  expectSites('string literal', "const s = '(i - 1) % len';", []);

  // Multi-site + line numbers (two real traps, skips between).
  const fixture = [
    'a = (i - 1) % xs.length;',       // line 1 site
    'b = (i + 1) % xs.length;',       // line 2 NO (forward)
    'c = i % ys.length;',             // line 3 NO (no sub/group)
    'd = (j - 1 + len) % len;',       // line 4 NO (compensated)
    'e = (k - 2) % slots;',           // line 5 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 5]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,5]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = a[(i - 1) % a.length];')[0].key;
  const k2 = scanSource('const g=a[(i-1)%a.length];')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (the repo is clean; every future site is judged in the ledger), else
  // --check is already red.
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
    console.log(`✗ ${newSites.length} untriaged negative-modulo site(s) — judge each (can the numerator go negative before the %?), then add a row to scripts/negative-modulo-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open negative-modulo BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} negative-modulo site(s), all triaged SAFE.`);
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
console.log('negative-modulo sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
