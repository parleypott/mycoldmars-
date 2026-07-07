#!/usr/bin/env bun
//
// find-noinitial-reduce.mjs — audit every `.reduce(callback)` written with NO
// second argument (no initial/seed value), and force a human to judge whether
// the array being reduced can ever be EMPTY — the classic "Reduce of empty
// array with no initial value" TypeError.
//
// WHY THIS EXISTS
// `Array.prototype.reduce(cb)` with no initial value is a hard THROW the moment
// the array is empty:
//
//     [].reduce((a, b) => a + b)
//     // → TypeError: Reduce of empty array with no initial value
//
// That's not a graceful `undefined` or a silent 0 — it's an uncaught exception
// that WHITE-SCREENS the whole tool if it runs during render/boot. And "empty"
// is exactly the state this loop's corrupt-store guards deliberately PRODUCE:
// a legacy/corrupt localStorage value coerced to `[]`, a filtered list that
// happened to match nothing, a freshly-created board with no cards yet, an API
// row set that came back empty. Every one of those is a real runtime path, and
// each turns a no-initial reduce into a crash the happy-path (always ≥1 element)
// never reveals.
//
// The safe form is free: pass the identity/seed as the second argument —
// `.reduce((a, b) => a + b, 0)` returns 0 on `[]` instead of throwing. This gate
// exists so a no-initial reduce can never be introduced on a can-be-empty array
// without a human first proving the array is non-empty.
//
// This is a sibling of the corrupt-store / empty-collection crash class the loop
// has hand-fixed repeatedly (fitBounds `Math.min(...[])` → find-spread-overflow,
// lineCentroid `/ coords.length` → find-divide-by-length, the non-array store
// guards). None of those gates watch `.reduce(cb)`: spread-overflow sees `...`,
// divide-by-length sees `/ x.length`, neither sees a bare reduce. Today the repo
// has ZERO no-initial reduces — this gate LOCKS that clean state so the next one
// to land trips `bun run test` instead of shipping a latent white-screen.
//
// WHAT IT SCANS
// Every `.reduce(` whose argument list contains exactly ONE top-level argument
// (the callback, with no trailing seed). Arg counting is string-aware and
// paren/brace/bracket-balanced, so commas INSIDE the callback's own param list
// (`(acc, cur) =>`), body, nested calls, object/array literals, and string
// literals are NOT miscounted as an argument separator. A `.reduce(cb, seed)`
// — two top-level args — is ALWAYS safe and is never flagged, whatever `seed`'s
// shape (`0`, `''`, `{}`, `[]`, `new LngLatBounds(...)`, an identifier, …).
//
// WHY A LEDGER, NOT A HARD FAIL
// A no-initial reduce on a PROVABLY non-empty array is perfectly correct:
//   • a literal array           `[a, b, c].reduce(f)`                  (safe)
//   • guarded upstream          `if (!xs.length) return; xs.reduce(f)` (safe)
//   • a required, ≥1-length field per the data contract               (safe)
//   • a can-be-empty runtime list with no guard                        (BUG)
// A purely syntactic classifier can't tell these apart without false-flagging
// the safe ones (which would turn `bun run test` red on healthy code). So —
// exactly like find-negative-slice.mjs and find-divide-by-length.mjs — this gate
// LISTS every site, cross-references scripts/noinitial-reduce-triage.tsv, and (in
// --check) FAILS only on a site nobody has judged yet. A newly introduced
// unguarded `list.reduce(f)` trips the gate the moment it lands; everything
// already judged SAFE stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers. If a judged snippet's surrounding text changes
// enough to alter the snippet, it reads as NEW again (re-review), the safe way.
//
// USAGE
//   scripts/find-noinitial-reduce.mjs              # table of every site + verdict
//   scripts/find-noinitial-reduce.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-noinitial-reduce.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-noinitial-reduce.mjs --new        # list ONLY untriaged sites
//   scripts/find-noinitial-reduce.mjs --dump-ledger # emit SAFE stub rows to seed the TSV
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'noinitial-reduce-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `.reduce(...)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
  'palau-script', 'palau2-script', 'scripts-library',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|_source-|find-noinitial-reduce\.mjs|noinitial-reduce-triage\.tsv)/;

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
  return out.sort((a, b) => a.localeCompare(b));
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
// Walk the (comment-stripped) source once, string-aware, so `.reduce(` matches
// only in real code — never inside a '...'/"..."/`...` literal. At each real
// `.reduce(`, balance-scan its argument list (still string- and bracket-aware)
// and count TOP-LEVEL commas: 0 commas ⇒ exactly one argument ⇒ NO initial value
// ⇒ flag it. `.reduce()` with an empty arg list (0 args, invalid JS) is ignored.
const CTX = 56; // chars of left context to include in the snippet

// From `openIdx` (the `(` of `.reduce(`), return { argCount, end } where `end`
// is the index just past the matching `)`. String/template/bracket aware.
function scanArgs(src, openIdx) {
  let depth = 0;
  let commas = 0;
  let sawArg = false; // any non-whitespace at depth 1 → at least one argument
  let quote = null;   // ' " ` when inside a string/template
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }        // skip escaped char
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; sawArg = true; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth > 1) sawArg = true; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        // Closed the reduce() call. args = sawArg ? commas+1 : 0
        return { argCount: sawArg ? commas + 1 : 0, end: i + 1 };
      }
      continue;
    }
    if (depth === 1 && c === ',') { commas++; continue; }
    if (depth === 1 && !/\s/.test(c)) sawArg = true;
    else if (depth > 1) sawArg = true;
  }
  return { argCount: sawArg ? commas + 1 : 0, end: Math.min(src.length, openIdx + 80) }; // unbalanced — clamp
}

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    // Match `.reduce(` starting at a real code position.
    if (c === '.' && src.startsWith('.reduce', i)) {
      let j = i + '.reduce'.length;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] !== '(') continue;
      const { argCount, end } = scanArgs(src, j);
      if (argCount === 1) {
        // Left context clamped to the nearest statement/expression boundary.
        let start = Math.max(0, i - CTX);
        for (const ch of [';', '{', '}', '\n']) {
          const b = src.lastIndexOf(ch, i - 1);
          if (b >= start) start = b + 1;
        }
        const snippet = src.slice(start, end).replace(/\s+/g, ' ').trim();
        rows.push({ line: lineOf(src, i), snippet, key: normalize(snippet) });
      }
      i = end - 1; // skip past this call
    }
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
  // FLAGS the no-initial-value forms (exactly one argument: the callback).
  expectSites('paren params, no seed', 'const t = xs.reduce((a, b) => a + b);', ['const t = xs.reduce((a, b) => a + b)']);
  expectSites('single param, no seed', 'const t = xs.reduce(a => a);', ['const t = xs.reduce(a => a)']);
  expectSites('block body, no seed', 'const t = xs.reduce((a, b) => { return a + b; });', ['const t = xs.reduce((a, b) => { return a + b; })']);
  expectSites('named fn ref, no seed', 'const t = xs.reduce(sum);', ['const t = xs.reduce(sum)']);
  expectSites('nested call in cb, no seed', 'const t = xs.reduce((a, b) => Math.max(a, b));', ['const t = xs.reduce((a, b) => Math.max(a, b))']);
  // Does NOT flag when a SECOND argument (the initial value) is present.
  expectSites('seed 0', 'const t = xs.reduce((a, b) => a + b, 0);', []);
  expectSites('seed empty string', 'const t = xs.reduce((a, b) => a + b, "");', []);
  expectSites('seed object literal w/ commas', 'const t = xs.reduce((m, k) => m, { a: 1, b: 2 });', []);
  expectSites('seed array literal', 'const t = xs.reduce((a, b) => a, []);', []);
  expectSites('seed constructor call', 'const t = ps.reduce((b, p) => b.extend(p), new Bounds(a, a));', []);
  expectSites('seed identifier', 'const t = xs.reduce(fn, acc);', []);
  expectSites('comma inside string seed', "const t = xs.reduce((a, b) => a, ',');", []);
  // Out-of-scope / must-not-match.
  expectSites('in comment', '// xs.reduce((a, b) => a + b)\nconst x = 1;', []);
  expectSites('in string', "const s = 'xs.reduce((a, b) => a + b)';", []);
  expectSites('reduceRight ignored', 'const t = xs.reduceRight((a, b) => a + b);', []); // .reduce( requires the `(` right after
  expectSites('not a method call', 'const reduce = (a) => a;', []);

  // Multi-site + line numbers (two no-seed reduces, seeded/other lines skipped).
  const fixture = [
    'const a = xs.reduce((m, s) => m + s);',   // line 1 site (no seed)
    'const b = ys.reduce((m, s) => m + s, 0);', // line 2 NO (seeded)
    'const c = zs.map(x => x + 1);',            // line 3 NO (not reduce)
    'const d = ws.reduce(pick);',               // line 4 site (no seed)
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource('const g = xs.reduce( (a, b) => a + b );')[0].key;
  const k2 = scanSource('const g=xs.reduce((a,b)=>a+b);')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (every live site — if any — judged SAFE in the ledger), else --check is
  // already red. The repo has no no-initial reduces today, so this holds at 0.
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
    console.log(`✗ ${newSites.length} untriaged no-initial reduce site(s) — judge each (can the array be empty?), then add a seed value or a row to scripts/noinitial-reduce-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open no-initial reduce BUG(s) in the ledger — add an initial value or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} no-initial reduce site(s), all triaged SAFE.`);
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
console.log('no-initial reduce sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
