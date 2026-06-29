#!/usr/bin/env bun
//
// find-dynamic-regex.mjs — audit every `new RegExp(<dynamic pattern>)` in the
// repo and force a human to judge whether the interpolated/concatenated value
// is regex-ESCAPED (or a controlled constant) before it's baked into a pattern.
//
// WHY THIS EXISTS — a recurring class with no standing watcher
// A `new RegExp(...)` whose pattern is built by string concatenation or template
// interpolation carries TWO live failure modes when the spliced-in value can
// hold regex metacharacters:
//   • CORRECTNESS / CRASH — an unescaped `.`, `+`, `*`, `(`, `[`, `\` in the value
//     changes what the pattern matches, or makes `new RegExp` THROW SyntaxError
//     on an unbalanced `(`/`[` and crash the caller.
//   • INJECTION / ReDoS — when the value is user- or cookie-controlled, an
//     attacker picks the metachars (the classic cookie-regex shape
//     `new RegExp('(?:^|; )' + name + '=([^;]*)')` the loop migrated off of in
//     research/app.js, translation/src/gate.js, and QSS library/cast/write —
//     hunter/index.html is the last un-migrated copy, backlog low-pri).
// The fix every time is the same: wrap the value in escapeRegExp(...) (or prove
// it's a controlled literal/constant). Nothing watches for the next one. This does.
//
// THE TELL THIS GATE KEYS ON
// A `new RegExp(` whose FIRST argument is DYNAMIC — it contains a `${...}`
// template interpolation, or a `+` concatenation outside of string literals.
// A fully-static literal pattern (`new RegExp('\\d+')`, `new RegExp("[a-z]")`)
// is NOT flagged: nothing is spliced in, so there's nothing to escape. A bare
// identifier first arg (`new RegExp(CORE, flags)`) is also NOT flagged — that's
// the precompiled-constant shape, a different (lower-metachar-risk) pattern; this
// gate targets the CONSTRUCTED-pattern class where a value is interpolated.
//
// Whether a flagged site is a BUG depends on a non-local fact a pure regex can't
// settle: is the spliced value escaped / a controlled constant, or can it carry
// attacker/data metacharacters? So — exactly like find-unguarded-decode.mjs,
// find-truthy-zero.mjs and the other ledger gates — this LISTS every dynamic
// site, cross-references scripts/dynamic-regex-triage.tsv, and (in --check)
// FAILS only on a site nobody has judged yet. A new constructed RegExp trips the
// gate the moment it lands; everything already judged SAFE stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-dynamic-regex.mjs              # table of every dynamic site + verdict
//   scripts/find-dynamic-regex.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-dynamic-regex.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-dynamic-regex.mjs --new        # list ONLY untriaged sites
//   scripts/find-dynamic-regex.mjs --dump-ledger# emit a SAFE stub row per site
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: escaped / controlled, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'dynamic-regex-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `new RegExp(...)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'pinglobe-feedback', 'zanyplans',
  'scripts', 'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-dynamic-regex\.mjs|dynamic-regex-triage\.tsv)/;

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

// Blank out COMMENTS only (overwrite comment chars with spaces, preserving every
// byte offset so line numbers stay exact). String/template bodies are skipped-over
// (not blanked) so a `//` inside a string isn't misread as a comment start.
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (j) => { if (src[j] !== '\n') out[j] = ' '; };
  const eatQuoteSkip = (q) => {
    i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === q) { i++; return; }
      i++;
    }
  };
  const eatTemplate = () => {
    i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = src[i], nx = src[i + 1];
          if (c === '"' || c === "'") { eatQuoteSkip(c); continue; }
          if (c === '`') { eatTemplate(); continue; }
          if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
          if (c === '/' && nx === '*') { blank(i); blank(i + 1); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; } if (i < n) { blank(i); blank(i + 1); i += 2; } continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          if (depth > 0) i++;
        }
        if (i < n) i++;
        continue;
      }
      i++;
    }
  };
  while (i < n) {
    const c = src[i], nx = src[i + 1];
    if (c === '"' || c === "'") { eatQuoteSkip(c); continue; }
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

function normalize(s) {
  return s.replace(/\s+/g, '');
}

// Walk from `i` (just inside an open paren) to the matching close paren, skipping
// string/template bodies. Returns the index OF the close paren, or -1 if unbalanced.
function matchCloseParen(src, i) {
  const n = src.length;
  let depth = 1;
  while (i < n && depth > 0) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '`') { i++; break; } i++; }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// Extract the RAW first argument of a call whose open paren is at `i-1` (i points
// just past it). Stops at a top-level `,` or top-level `)`. Preserves `${...}`
// interiors (the dynamic tell) by collecting string/template bytes verbatim.
function firstArg(src, i) {
  const n = src.length;
  let depth = 0; // nesting of ()[]{} INSIDE the arg
  let arg = '';
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c; arg += c; i++;
      while (i < n) { arg += src[i]; if (src[i] === '\\') { arg += src[i + 1] ?? ''; i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    if (c === '`') {
      arg += c; i++;
      while (i < n) { arg += src[i]; if (src[i] === '\\') { arg += src[i + 1] ?? ''; i += 2; continue; } if (src[i] === '`') { i++; break; } i++; }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; arg += c; i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break; // top-level close paren ends the arg
      depth--; arg += c; i++; continue;
    }
    if (c === ',' && depth === 0) break; // top-level comma ends the first arg
    arg += c; i++;
  }
  return arg;
}

// Remove single/double-quoted literals AND whole backtick templates from a code
// fragment, so a `+` (or `${`) that lives INSIDE a string literal isn't mistaken
// for code. Returns the literal-free skeleton.
function stripLiterals(s) {
  let out = '', i = 0; const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < n) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; } continue; }
    if (c === '`') { i++; while (i < n) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === '`') { i++; break; } i++; } continue; }
    out += c; i++;
  }
  return out;
}

// A first arg is DYNAMIC if it interpolates (`${`) or concatenates (`+` outside
// string literals). Static literals and bare identifiers are not.
function isDynamicArg(arg) {
  if (arg.includes('${')) return true;        // template interpolation
  if (stripLiterals(arg).includes('+')) return true; // string concatenation
  return false;
}

// ── The scanner ───────────────────────────────────────────────────────────────
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  const n = src.length;
  const RE = /new\s+RegExp\s*\(/g;
  let m;
  while ((m = RE.exec(src)) !== null) {
    const openIdx = m.index + m[0].length; // just past `(`
    const arg = firstArg(src, openIdx);
    if (!isDynamicArg(arg)) continue;
    const close = matchCloseParen(src, openIdx);
    if (close === -1) continue; // unbalanced — give up on this call
    // Snippet: from the nearest statement boundary before the call through the
    // closing paren, for human context.
    let start = Math.max(0, m.index - 60);
    for (const ch of [';', '{', '}', '\n', '(']) {
      const b = src.lastIndexOf(ch, m.index - 1);
      if (b >= start) start = b + 1;
    }
    const snippet = src.slice(start, close + 1).replace(/\s+/g, ' ').trim();
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
  // Flags dynamic patterns — escaped or not (escapedness is a ledger judgment).
  expectSites('template interp flagged', "const re = new RegExp(`\\\\b${name}\\\\b`, 'i');",
    ["const re = new RegExp(`\\\\b${name}\\\\b`, 'i')"]);
  expectSites('concat flagged', "const re = new RegExp('(?:^|; )' + name + '=([^;]*)');",
    ["const re = new RegExp('(?:^|; )' + name + '=([^;]*)')"]);
  expectSites('escaped interp still flagged', "const re = new RegExp(`\\\\b${escapeRegExp(t)}\\\\b`);",
    ["const re = new RegExp(`\\\\b${escapeRegExp(t)}\\\\b`)"]);
  // Does NOT flag static literals, bare identifiers, or a `+`/`${` inside a string.
  expectSites('static single-quote literal not flagged', "const re = new RegExp('\\\\d+');", []);
  expectSites('static double-quote literal not flagged', 'const re = new RegExp("[a-z]+");', []);
  expectSites('static template (no interp) not flagged', "const re = new RegExp(`\\\\d+`);", []);
  expectSites('bare identifier first arg not flagged', "const re = new RegExp(CORE, flags);", []);
  expectSites('plus inside string literal not flagged', "const re = new RegExp('a+b', 'g');", []);
  expectSites('RegExp literal (not constructor) not flagged', "const re = /\\\\d+/g;", []);

  // Line numbers across a multi-site fixture.
  const fixture = [
    "const a = new RegExp(`x${y}z`);",            // line 1 site (interp)
    "const b = new RegExp('static');",            // line 2 NO (literal)
    "const c = foo(bar);",                         // line 3 NO
    "const d = new RegExp('a' + z + 'b');",        // line 4 site (concat)
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource("const g = new RegExp( `\\\\b${x}\\\\b` );")[0].key;
  const k2 = scanSource("const g=new RegExp(`\\\\b${x}\\\\b`);")[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (every live site judged SAFE/escaped in the ledger), else --check is red.
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
    console.log(`✗ ${newSites.length} untriaged dynamic new RegExp() site(s) — judge each (is the interpolated/concatenated value regex-escaped or a controlled constant?), then add a row to scripts/dynamic-regex-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open dynamic-regex BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} dynamic new RegExp() site(s), all triaged SAFE.`);
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
console.log('dynamic new RegExp() sites  [SAFE=ledger: escaped/controlled · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
