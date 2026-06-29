#!/usr/bin/env bun
//
// find-truthy-zero.mjs — audit every `<numeric-coercion> || <nonzero-default>`
// in the repo and force a human to judge whether the `|| default` silently EATS
// a legitimate ZERO.
//
// WHY THIS EXISTS
// The truthy-zero trap is the single most recurring PROJECT bug class this loop
// has fixed — by a wide margin. The shape is always the same:
//
//     const gap = parseFloat(hdr) || 0.5;     // a tight-assembly gap of 0 → 0.5
//     const start = Number(seg.start) || ...;  // a 0-second clip start → blanked
//     const n = parseInt(el.value, 10) || 12;  // an explicit "0" → 12
//
// `||` treats 0 as falsy, so any field whose ZERO is a real, meaningful value
// (a gap, a start timecode, an offset, a level, a count-from-zero, a score) gets
// silently replaced by the default. It is invisible in a quick test (every
// NON-zero input behaves perfectly) and it has bitten cutter timecodes, the
// SacredSequencer + Interpreter gap export (×3), Walden setbacks, the Hunter CSV
// "0" segment + keepability-0 cell, and more. No existing gate looks for it: the
// rollover/json/date/sort gates are all blind to it.
//
// WHAT IT SCANS
// Only the HIGH-SIGNAL numeric-intent forms — a value that is unambiguously a
// NUMBER being defaulted with `||`:
//   • parseFloat(...) || N      • parseInt(...) || N      • Number(...) || N
//   • <expr>.value ... || N     (a DOM input value — always a numeric field here)
//   • +<expr> || N              (unary-plus coercion: `const w = +el.wFt || 8`)
// defaulted to a NON-ZERO literal (`|| 0` is harmless — 0-or-0 is still 0 — and
// is never flagged). String/array defaults (`|| ''`, `|| []`) are out of scope.
// The unary-plus form is matched ONLY in genuine unary position (the `+` directly
// follows `= , ( [ : ?`), so binary addition (`a + b || 5`) and `++`/`+=` are not
// mistaken for a coercion.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a `|| N` is a BUG depends on whether 0 is a legitimate value for THAT
// field — which is semantic, not syntactic. `parseInt(sides) || 8` is fine (a
// 0-sided polygon is nonsense, and it's Math.max(3,…)-clamped anyway); `parseFloat
// (gap) || 0.5` is a bug (a 0 gap is real). A pure classifier can't tell them
// apart without false-flagging the safe ones, which would turn `bun run test` red
// on healthy code. So this gate uses the same proven design as the divergence
// scanner: it lists every site, cross-references scripts/truthy-zero-triage.tsv,
// and (in --check) FAILS only on a site nobody has judged yet. A newly introduced
// `parseFloat(x) || 5` trips the gate the moment it lands; everything already
// judged stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers. If a previously-judged snippet's surrounding
// changes enough to alter the snippet text, it reads as NEW again (re-review),
// which is the safe direction.
//
// USAGE
//   scripts/find-truthy-zero.mjs              # table of every site + its ledger verdict
//   scripts/find-truthy-zero.mjs --check      # exit 1 if any NEW (untriaged) site exists
//   scripts/find-truthy-zero.mjs --self-test  # prove the scanner/classifier on fixtures
//   scripts/find-truthy-zero.mjs --new        # list ONLY untriaged sites
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug) | BUG (ledger: open, fix it)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'truthy-zero-triage.tsv');

// ── Source selection ── same posture as the other gates: real authored source
// only. Skip tests, minified bundles, vendored assets, node_modules, and THIS
// file + its ledger (whose docstrings embed example `|| N` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-truthy-zero\.mjs|truthy-zero-triage\.tsv)/;

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

// ── The scanner ───────────────────────────────────────────────────────────────
// Find every `|| <nonzero-number>` whose left side is a numeric coercion, and
// capture a normalized snippet from the coercion keyword through the default.

// A `||` followed by a numeric literal default (allow a leading +/- and decimals,
// but NOT a bare 0 / 0.0 — defaulting to zero can't eat a meaningful zero).
const OR_NUM = /\|\|\s*(-?\d+(?:\.\d+)?)/g;
// The numeric-intent left side we care about, searched in the window before `||`.
// The final alternative matches a unary-plus coercion (`+ident`) — but ONLY when
// the `+` sits in unary position (immediately after `= , ( [ : ?`, optional
// spaces), so binary `a + b`, `++`, and `+=` never trip it.
const COERCE = /(parseFloat\s*\(|parseInt\s*\(|Number\s*\(|\.value\b|(?<=[=,(\[:?]\s*)\+(?=[a-zA-Z_$]))/g;
const WINDOW = 90; // chars to look back from `||` for a coercion keyword

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

import { stripComments } from './lib/strip-comments.mjs';

// Last index of any coercion keyword within `window`, or -1.
function lastCoerce(window) {
  COERCE.lastIndex = 0;
  let pos = -1, m;
  while ((m = COERCE.exec(window)) !== null) pos = m.index;
  return pos;
}

// Normalize a snippet to a stable ledger key: collapse all whitespace away.
function normalize(s) {
  return s.replace(/\s+/g, '');
}

// Scan one source string → [{line, snippet, key}] for each truthy-zero site.
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  OR_NUM.lastIndex = 0;
  let m;
  while ((m = OR_NUM.exec(src)) !== null) {
    const orAt = m.index;
    const def = m[1];
    if (parseFloat(def) === 0) continue; // `|| 0` is harmless
    // Look back up to WINDOW chars, but never PAST a statement boundary (`;{}`) —
    // otherwise a `|| N` on one line could grab an unrelated coercion from the
    // PREVIOUS statement and misreport it. (No newline clamp: a coercion's own
    // arg list can span lines, e.g. `parseInt(\n  x\n) || 3`.)
    let windowStart = Math.max(0, orAt - WINDOW);
    for (const ch of [';', '{', '}']) {
      const b = src.lastIndexOf(ch, orAt - 1);
      if (b >= windowStart) windowStart = b + 1;
    }
    const window = src.slice(windowStart, orAt);
    const cPos = lastCoerce(window);
    if (cPos < 0) continue; // left side is not a numeric coercion → out of scope
    // Snippet: from the coercion keyword through the numeric default.
    const rawStart = windowStart + cPos;
    const rawEnd = orAt + m[0].length;
    const snippet = src.slice(rawStart, rawEnd).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, orAt), snippet, key: normalize(snippet) });
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
  // Flags the numeric-coercion forms with a nonzero default. The captured snippet
  // begins at the coercion keyword NEAREST the `||` (the one directly governing the
  // defaulted value) — so `parseInt(el.value,10)` keys off the inner `.value`.
  expectSites('parseFloat gap', 'const g = parseFloat(hdr) || 0.5;', ['parseFloat(hdr) || 0.5']);
  expectSites('parseInt default', 'const n = parseInt(el.value, 10) || 12;', ['.value, 10) || 12']);
  expectSites('Number coerce', 'const s = Number(seg.start) || 1;', ['Number(seg.start) || 1']);
  expectSites('.value form', 'const fps = $("#seq-fps").value || 23.976;', ['.value || 23.976']);
  // Unary-plus coercion form (the walden-3d `+el.wFt || 8` shape).
  expectSites('unary-plus coerce', 'const w = +el.wFt || 8;', ['+el.wFt || 8']);
  expectSites('unary-plus after comma', 'const w=+el.wFt||8,l=+el.lFt||8;', ['+el.wFt||8', '+el.lFt||8']);
  expectSites('unary-plus after paren', 'box(+x || 3);', ['+x || 3']);
  // Does NOT mistake binary `+`, `++`, or `+=` for a unary coercion.
  expectSites('binary plus not coerce', 'const x = a + b || 5;', []);
  expectSites('postfix incr not coerce', 'const x = i++ || 5;', []);
  expectSites('unary-plus || 0 harmless', 'const r = +el.rot || 0;', []);
  // Does NOT flag the harmless / out-of-scope forms.
  expectSites('|| 0 harmless', 'const x = parseFloat(v) || 0;', []);
  expectSites('|| 0.0 harmless', 'const x = Number(v) || 0.0;', []);
  expectSites('string default', "const s = el.value || '';", []);
  expectSites('array default', 'const a = JSON.parse(v) || [];', []);
  expectSites('non-coercion left', 'const a = count || 5;', []); // bare identifier — out of scope (too noisy)
  expectSites('object default', 'const o = Number(v) || fallback;', []); // default not a numeric literal

  // Multi-site + line numbers.
  const fixture = [
    'const a = parseInt(x) || 3;',  // line 1 site
    'const b = foo || 9;',          // line 2 NO (bare ident)
    'const c = Number(y) || 0;',    // line 3 NO (|| 0)
    'const d = parseFloat(z) || 1.5;', // line 4 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = parseFloat( hdr )  ||  0.5;')[0].key;
  const k2 = scanSource('const g=parseFloat(hdr)||0.5;')[0].key;
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
    console.log(`✗ ${newSites.length} untriaged truthy-zero site(s) — judge each, then add a row to scripts/truthy-zero-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    console.log(`\n(A site is a BUG if 0 is a legitimate value for that field — then fix it and record status BUG→SAFE after the fix. Otherwise record SAFE with a one-line reason.)`);
    process.exit(1);
  }
  console.log(`✓ 0 untriaged truthy-zero sites (${sites.length} judged: ${sites.filter((s) => s.status === 'SAFE').length} SAFE, ${bugSites.length} open BUG)`);
  process.exit(bugSites.length ? 1 : 0);
}

if (args.has('--emit-ledger')) {
  // Print TSV rows for every NEW site (status SAFE, blank reason) to seed the
  // ledger. Pipe to the .tsv, then fill in each reason by hand.
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
console.log(`\n${sites.length} site(s): ${newSites.length} NEW, ${bugSites.length} BUG, ${sites.filter((s) => s.status === 'SAFE').length} SAFE`);
