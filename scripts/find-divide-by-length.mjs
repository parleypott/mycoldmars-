#!/usr/bin/env bun
//
// find-divide-by-length.mjs — audit every `<expr> / <something>.length` in the
// repo and force a human to judge whether the divisor can be ZERO (→ NaN /
// Infinity that then poisons a render, a sort, a percent bar, or a centroid).
//
// WHY THIS EXISTS
// Divide-by-`.length` is a recurring PROJECT bug vein this loop keeps fixing by
// hand. The shape is always the same — a mean / centroid / percentage computed
// over an array that is normally non-empty but isn't GUARANTEED to be:
//
//     const c = pts.reduce((a,p)=>[a[0]+p[0],a[1]+p[1]],[0,0]).map(v=>v/pts.length);
//     bar.style.width = `${(done / items.length) * 100}%`;
//     const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
//
// When the array is empty, `x / 0` is `NaN` (or `Infinity`), and NaN spreads
// silently: a NaN centroid drops a marker at 0,0; a NaN width collapses a bar; a
// NaN feeds a comparator and scrambles a whole sort. It is invisible in a quick
// test (every NON-empty input behaves perfectly). It has bitten MapKeys
// lineCentroid (empty-coords → NaN centroid, fixed this very week), route-geo,
// and the Hunter gemini keep-rate math. No existing gate looks for it: the
// rollover / truthy-zero / sort / date / json gates are all blind to it.
//
// WHAT IT SCANS
// Every `/ <identifier-chain>.length` — a division whose DIVISOR is an array (or
// string) length. That's the high-signal shape: the numerator can be anything,
// but a `.length` denominator is the thing that can silently be 0.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a divide-by-length is a BUG depends on whether the array can actually
// be empty AT THAT SITE — which is semantic and usually NON-LOCAL:
//   • guarded by an early `if (arr.length === 0) return …;`   (safe)
//   • guarded by a `arr.length ? sum/arr.length : 0` ternary   (safe)
//   • the array is a module-level CONSTANT literal, never empty (safe)
//   • the divide runs INSIDE a `for`/`forEach` over that array  (safe — body
//     never executes when empty)
//   • a freshly `.filter()`ed / user-supplied array with no guard (BUG)
// A pure syntactic classifier can't tell these apart without false-flagging the
// safe ones, which would turn `bun run test` red on healthy code. So — exactly
// like find-truthy-zero.mjs — this gate LISTS every site, cross-references
// scripts/divide-by-length-triage.tsv, and (in --check) FAILS only on a site
// nobody has judged yet. A newly introduced unguarded `sum / arr.length` trips
// the gate the moment it lands; everything already judged stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers. If a judged snippet's surrounding text changes
// enough to alter the snippet, it reads as NEW again (re-review), the safe way.
//
// USAGE
//   scripts/find-divide-by-length.mjs              # table of every site + verdict
//   scripts/find-divide-by-length.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-divide-by-length.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-divide-by-length.mjs --new        # list ONLY untriaged sites
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'divide-by-length-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `/ x.length` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-divide-by-length\.mjs|divide-by-length-triage\.tsv)/;

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

// Blank out comments AND non-code string text by overwriting their characters
// with spaces — preserves every byte offset so line numbers stay exact, but
// stops a `/ x.length` inside a docstring or a string literal from polluting the
// ledger. Single/double-quoted strings are blanked whole; TEMPLATE literals keep
// their `${...}` expression contents (a real divide can live in a template, e.g.
// `` `${(done / items.length) * 100}%` ``) and blank only the literal text.
// Pragmatic, not a full lexer — a `/` inside a regex literal could be misread as
// a divide, which can only INVENT a site (read as NEW → re-review, the safe way).
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (j) => { if (src[j] !== '\n') out[j] = ' '; };
  // Blank a single/double-quoted string body starting at the opening quote `i`.
  const eatQuote = (q) => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === q) { blank(i); i++; return; }
      blank(i); i++;
    }
  };
  // Blank a template literal starting at the backtick `i`, but recurse into
  // `${...}` so real code there is still scanned.
  const eatTemplate = () => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === '`') { blank(i); i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2; // step INTO the expression — leave its chars intact
        let depth = 1;
        while (i < n && depth > 0) {
          const c = src[i], nx = src[i + 1];
          if (c === '"' || c === "'") { eatQuote(c); continue; }
          if (c === '`') { eatTemplate(); continue; }
          if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
          if (c === '/' && nx === '*') { blank(i); blank(i + 1); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; } if (i < n) { blank(i); blank(i + 1); i += 2; } continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          if (depth > 0) i++;
        }
        if (i < n) i++; // consume the closing `}`
        continue;
      }
      blank(i); i++;
    }
  };
  while (i < n) {
    const c = src[i], nx = src[i + 1];
    if (c === '"' || c === "'") { eatQuote(c); continue; }
    if (c === '`') { eatTemplate(); continue; }
    if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
    if (c === '/' && nx === '*') {
      blank(i); blank(i + 1); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
      if (i < n) { blank(i); blank(i + 1); i += 2; }
      continue;
    }
    i++;
  }
  return out.join('');
}

// Normalize a snippet to a stable ledger key: collapse all whitespace away.
function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── The scanner ───────────────────────────────────────────────────────────────
// A division by an identifier-chain `.length`: a `/` (NOT `/=`, NOT `//`, NOT
// `*/`) followed by an identifier chain that ends in `.length`. The chain may be
// dotted/bracketed/optional-chained (`a.b.length`, `this.foo.length`,
// `arr?.length`). We capture a short window before the `/` for human context.
const DIV_LEN = /\/\s*([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)\??\.length\b/g;
const CTX = 60; // chars of left context to include in the snippet

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  DIV_LEN.lastIndex = 0;
  let m;
  while ((m = DIV_LEN.exec(src)) !== null) {
    const slashAt = m.index;
    // Exclude `/=` (the regex requires `/` then ws/ident, so `/=` already can't
    // match) and a closing `*/` mis-seen as a divide (comments are stripped, so
    // the char before a real divide `/` is never `*` from a block-comment end).
    // Left context: back up to CTX chars, clamped at the nearest statement /
    // expression boundary so we don't grab an unrelated prior statement.
    let start = Math.max(0, slashAt - CTX);
    for (const ch of [';', '{', '}', '\n']) {
      const b = src.lastIndexOf(ch, slashAt - 1);
      if (b >= start) start = b + 1;
    }
    const end = slashAt + m[0].length;
    const snippet = src.slice(start, end).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, slashAt), snippet, key: normalize(snippet) });
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
  // Flags the divide-by-length forms (the snippet runs from the nearest boundary
  // through `.length`).
  expectSites('mean', 'const avg = sum / scores.length;', ['const avg = sum / scores.length']);
  expectSites('percent', 'w = (done / items.length) * 100;', ['w = (done / items.length']);
  expectSites('dotted chain', 'const c = total / this.foo.bar.length;', ['const c = total / this.foo.bar.length']);
  expectSites('optional chain', 'const c = a / arr?.length;', ['const c = a / arr?.length']);
  // Does NOT flag the out-of-scope forms.
  expectSites('not .length', 'const x = a / b;', []);
  expectSites('divide-assign', 'x /= items.length;', []); // `/=` is not a divide-by we scan
  expectSites('length not divisor', 'const n = arr.length / 2;', []); // .length is the DIVIDEND, not divisor
  expectSites('comment', '// avg = sum / scores.length\nconst x = 1;', []);
  expectSites('string literal', "const s = 'a / b.length';", []);

  // Multi-site + line numbers (two real divides + one .length-as-dividend skip).
  const fixture = [
    'const a = s / xs.length;',     // line 1 site
    'const b = foo / bar;',         // line 2 NO (no .length)
    'const c = arr.length / k;',    // line 3 NO (.length is dividend)
    'const d = t / pts.length;',    // line 4 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = sum  /  scores.length ;')[0].key;
  const k2 = scanSource('const g=sum/scores.length;')[0].key;
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
    console.log(`✗ ${newSites.length} untriaged divide-by-length site(s) — judge each (can the divisor be 0?), then add a row to scripts/divide-by-length-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open divide-by-length BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} divide-by-length site(s), all triaged SAFE.`);
  process.exit(0);
}

if (args.has('--dump-ledger')) {
  // Emit a `file<TAB>key<TAB>SAFE<TAB>` stub row per site for seeding the TSV.
  for (const s of sites) console.log(`${s.rel}\t${s.key}\tSAFE\t`);
  process.exit(0);
}

if (args.has('--new')) {
  for (const s of newSites) console.log(`NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
  if (!newSites.length) console.log('(no untriaged sites)');
  process.exit(0);
}

// Default: full table.
console.log('divide-by-length sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
