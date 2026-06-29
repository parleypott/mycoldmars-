#!/usr/bin/env bun
//
// find-spread-overflow.mjs — audit every `Math.min(...arr)` / `Math.max(...arr)`
// in the repo and force a human to judge whether `arr` can be LARGE enough to
// blow the call-argument limit (→ `RangeError: Maximum call stack size
// exceeded`, which throws and crashes the caller).
//
// WHY THIS EXISTS
// Spreading an array into a function call (`f(...arr)`) passes each element as a
// separate argument. V8 caps that at ~64k–500k args (engine/version dependent);
// past the cap the spread itself THROWS `RangeError` before `f` ever runs. For a
// normally-small array it's invisible — every test with a handful of points
// passes. It bites only when a real user feeds an UNBOUNDED array.
//
// This already happened in production: MapKeys `fitBounds` did
// `Math.max(...lngs)` over a RECORDED GPS track. A short demo track worked; a
// real multi-thousand-point track threw RangeError and crashed the map (fixed
// by replacing the spread with a reduce loop — see mapkeys/src/route-geo.js).
// No standing gate watches for the NEXT one: the divide-by-length / truthy-zero
// / rollover / sort / date / json gates are all blind to spread-overflow.
//
// WHAT IT SCANS
// Every `Math.min(...` / `Math.max(...` whose first argument is a SPREAD. That's
// the concrete, high-signal shape of the incident. (The broader class —
// `String.fromCharCode(...bytes)`, `arr.push(...big)`, any `g(...huge)` — shares
// the failure mode, but scoping to Math.min/max keeps detection sound and covers
// every min/max-over-an-array bbox/extent/range computation, which is exactly
// where unbounded geo/track/sample arrays show up.)
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a spread is a BUG depends on whether the array can actually be large
// AT THAT SITE — semantic and non-local:
//   • the array is a fixed-arity literal / a few corners / N tiers   (safe)
//   • the array is a bounded enum (days, columns, bands)             (safe)
//   • a user-supplied / recorded / .filter()ed array with no cap     (BUG — use a reduce loop)
// A pure syntactic classifier can't tell these apart without false-flagging the
// safe ones, which would turn `bun run test` red on healthy code. So — exactly
// like find-divide-by-length.mjs — this gate LISTS every site, cross-references
// scripts/spread-overflow-triage.tsv, and (in --check) FAILS only on a site
// nobody has judged yet. A newly introduced `Math.max(...userArray)` trips the
// gate the moment it lands; everything already judged SAFE stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers. If a judged snippet's text changes enough to
// alter the snippet, it reads as NEW again (re-review), the safe way.
//
// USAGE
//   scripts/find-spread-overflow.mjs              # table of every site + verdict
//   scripts/find-spread-overflow.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-spread-overflow.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-spread-overflow.mjs --new        # list ONLY untriaged sites
//   scripts/find-spread-overflow.mjs --dump-ledger # seed TSV stub rows
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'spread-overflow-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `Math.max(...arr)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-spread-overflow\.mjs|spread-overflow-triage\.tsv)/;

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
// stops a `Math.max(...x)` inside a docstring or a string literal from polluting
// the ledger. Single/double-quoted strings are blanked whole; TEMPLATE literals
// keep their `${...}` expression contents and blank only the literal text.
//
// REGEX-LITERAL HANDLING (load-bearing for soundness). A naive blanker that
// ignores regex literals DESYNCS catastrophically: a regex whose body holds a
// quote — `.replace(/_Proxy\.MP4$/i, '')`, `/['"]/`, `str.split(/[,;]/)` — makes
// the lexer treat that inner quote as a string opener and run away, blanking
// every byte until the next matching quote far downstream. For a GATE that is a
// silent FALSE NEGATIVE: it would blank — and therefore miss — a real
// `Math.max(...userArray)` that lives past the runaway (this exact desync hid
// the hunter/src/main.js sites in the first cut). So we disambiguate `/` as
// divide-vs-regex using the standard rule: a `/` is DIVISION when the last
// significant code char is a value-ender (ident / `)` / `]` / `}` / `.` / digit),
// else it opens a REGEX literal, which we consume (honoring `\` escapes and
// `[...]` char classes so a `/` inside a class doesn't end it early).
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let lastSig = ''; // last significant (non-ws) CODE char — drives divide-vs-regex
  const blank = (j) => { if (src[j] !== '\n') out[j] = ' '; };
  const DIVIDE_CTX = /[A-Za-z0-9_$)\].]/; // value-enders: `/` after these is division
  const eatQuote = (q) => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === q) { blank(i); i++; return; }
      blank(i); i++;
    }
  };
  const eatRegex = () => {
    blank(i); i++; // opening `/`
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\n') return;       // unterminated — regex can't span a line; bail
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '[') { inClass = true; blank(i); i++; continue; }
      if (c === ']') { inClass = false; blank(i); i++; continue; }
      if (c === '/' && !inClass) { blank(i); i++; break; } // closing `/`
      blank(i); i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) { blank(i); i++; } // flags
  };
  const eatTemplate = () => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === '`') { blank(i); i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
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
        if (i < n) i++;
        continue;
      }
      blank(i); i++;
    }
  };
  while (i < n) {
    const c = src[i], nx = src[i + 1];
    if (c === '"' || c === "'") { eatQuote(c); lastSig = ')'; continue; } // string is a value
    if (c === '`') { eatTemplate(); lastSig = ')'; continue; }
    if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
    if (c === '/' && nx === '*') {
      blank(i); blank(i + 1); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
      if (i < n) { blank(i); blank(i + 1); i += 2; }
      continue;
    }
    if (c === '/') {
      if (DIVIDE_CTX.test(lastSig)) { lastSig = '/'; i++; }   // division — leave intact
      else { eatRegex(); lastSig = ')'; }                     // regex literal — blank it
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}

// Normalize a snippet to a stable ledger key: collapse all whitespace away.
function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── The scanner ───────────────────────────────────────────────────────────────
// `Math.min(` / `Math.max(` whose first non-ws argument is a SPREAD (`...`). We
// capture the WHOLE call via a balanced-paren forward scan so the human sees
// exactly which array is spread (`Math.max(...lngs.map(c => c[0]))`).
const HEAD = /\bMath\s*\.\s*(?:min|max)\s*\(/g;

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  HEAD.lastIndex = 0;
  let m;
  while ((m = HEAD.exec(src)) !== null) {
    const openParen = src.indexOf('(', m.index);
    if (openParen < 0) continue;
    // Require the first non-ws token after `(` to be a spread `...`.
    let k = openParen + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (!(src[k] === '.' && src[k + 1] === '.' && src[k + 2] === '.')) continue;
    // Balanced-paren forward scan to the matching `)`.
    let depth = 0, end = openParen + 1;
    for (let i = openParen; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
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
  // Flags the spread forms (whole balanced call captured).
  expectSites('plain spread', 'const m = Math.max(...xs);', ['Math.max(...xs)']);
  expectSites('min spread', 'const m = Math.min(...ys);', ['Math.min(...ys)']);
  expectSites('mapped spread', 'const m = Math.max(...a.map(p => p[0]));', ['Math.max(...a.map(p => p[0]))']);
  expectSites('nested parens', 'const m = Math.min(...vals.filter(v => f(v)));', ['Math.min(...vals.filter(v => f(v)))']);
  expectSites('spaced', 'const m = Math . max ( ...xs );', ['Math . max ( ...xs )']);
  // Does NOT flag the out-of-scope forms.
  expectSites('no spread', 'const m = Math.max(a, b);', []);
  expectSites('two-arg literal', 'const m = Math.min(0, n);', []);
  expectSites('not math', 'const m = foo.max(...xs);', []);
  expectSites('comment', '// const m = Math.max(...xs)\nconst y = 1;', []);
  expectSites('string literal', "const s = 'Math.max(...xs)';", []);
  // Regex-literal desync guard: a regex whose body holds a quote must NOT blank a
  // following spread site (the false-negative that hid the hunter sites).
  expectSites('regex-with-quote then site',
    "s = s.replace(/_x$/i, ''); const m = Math.max(...xs);",
    ['Math.max(...xs)']);
  expectSites('regex char-class slash then site',
    "t = t.split(/[/,;]/); const m = Math.min(...ys);",
    ['Math.min(...ys)']);
  expectSites('regex with quotes in class then site',
    "const r = /['\"]/g; const m = Math.max(...zs);",
    ['Math.max(...zs)']);
  // A real DIVISION before a spread site stays intact (not mis-eaten as regex).
  expectSites('divide then site',
    'const k = a / b.length; const m = Math.max(...xs);',
    ['Math.max(...xs)']);
  // A spread INSIDE a regex/string is not a site, but code after still scans.
  expectSites('spread inside regex body skipped',
    'r.test(/a.../); const m = Math.min(...ws);',
    ['Math.min(...ws)']);

  // Multi-site + line numbers (two real spreads + one non-spread skip).
  const fixture = [
    'const a = Math.max(...xs);',     // line 1 site
    'const b = Math.max(p, q);',      // line 2 NO (no spread)
    'const c = Math.min(...ys);',     // line 3 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 3]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,3]`); }

  // Two sites on ONE line (render-geometry shape) both captured.
  const oneLine = 'const a = Math.min(...xs), b = Math.max(...xs);';
  const two = scanSource(oneLine).map((r) => r.snippet);
  if (JSON.stringify(two) === JSON.stringify(['Math.min(...xs)', 'Math.max(...xs)'])) pass++;
  else { fail++; console.log(`  ✗ two-on-one-line: got ${JSON.stringify(two)}`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = Math.max( ...lngs );')[0].key;
  const k2 = scanSource('const g=Math.max(...lngs);')[0].key;
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
    console.log(`✗ ${newSites.length} untriaged Math.min/max spread site(s) — judge each (can the array be unbounded/large?), then add a row to scripts/spread-overflow-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open spread-overflow BUG(s) in the ledger — replace the spread with a reduce loop:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} Math.min/max spread site(s), all triaged SAFE.`);
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
console.log('Math.min/max spread sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
