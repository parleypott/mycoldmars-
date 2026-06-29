#!/usr/bin/env bun
//
// find-tz-date-drift.mjs — audit every LOCAL multi-arg `new Date(y, m, d, …)`
// construction that co-occurs with a `.toISOString()` read in the SAME file, and
// force a human to judge whether the wall-clock date drifts a calendar day on a
// non-UTC machine.
//
// WHY THIS EXISTS
// The timezone day-drift bug is the single most-repeated PROJECT class in this
// loop's backlog (~20 mentions) and has been hand-fixed at least four separate
// times — yet NO standing gate watches for the next one. The shape is always:
//
//     const d = new Date(year, month - 1, day);   // LOCAL wall-clock construct
//     ...
//     const dayLabel = d.toISOString().slice(0, 10); // UTC read → off-by-one day
//
// `new Date(y, m, d, …)` interprets its components in the machine's LOCAL zone,
// but `.toISOString()` emits UTC. On any machine west of UTC (the whole US — where
// Johnny edits) a date built at local midnight is the PREVIOUS calendar day in
// UTC, so the derived day/scene label silently drifts by one. It is invisible in a
// quick test (the dev usually runs on the same machine that produced the data) and
// it has bitten The Hunter's scene-day labels, build-corpus scene labels, the
// scene-detection worker, and extractDateFromClipName. The canonical FIX is always
// to construct with `Date.UTC(…)` so the wall-clock components round-trip through
// `.toISOString()` identically on every machine.
//
// WHAT IT SCANS
// A SITE is a `new Date(…)` whose argument list has 2+ top-level args (the
// component / wall-clock constructor — NOT `new Date()` for now, NOT `new Date(ms)`
// or `new Date(isoString)` which are zone-correct), where the FIRST arg is not
// itself a `Date.UTC(` call (that's the already-fixed form). A site is only
// reported if its file ALSO contains a `.toISOString(` call — that co-occurrence is
// the construct-LOCAL / read-UTC smell that warrants a human look. A file that
// builds local dates and reads them back with LOCAL getters (getFullYear/getMonth/
// getDate) is internally consistent and never touches toISOString, so it is out of
// scope by design (no noise from the many legitimate local-only date subsystems).
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether the co-occurrence is a BUG depends on whether the SAME date flows from
// the local constructor INTO toISOString — which is semantic, not syntactic. prawn
// and nile-flights both build local timeline/schedule dates AND stamp a separate
// `new Date().toISOString()` "now"/booking marker; the two never meet, so both are
// SAFE. A pure classifier can't tell "same date round-trips" from "two unrelated
// date subsystems" without false-flagging healthy code and turning `bun run test`
// red. So this gate uses the same proven design as the other ledger gates: it lists
// every site, cross-references scripts/tz-date-drift-triage.tsv, and (in --check)
// FAILS only on a site nobody has judged yet. A newly introduced local-construct +
// toISOString pairing trips the gate the moment it lands; everything judged stays
// quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-tz-date-drift.mjs              # table of every site + its verdict
//   scripts/find-tz-date-drift.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-tz-date-drift.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-tz-date-drift.mjs --new        # list ONLY untriaged sites
//   scripts/find-tz-date-drift.mjs --emit-ledger# seed TSV rows for NEW sites
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug) | BUG (ledger: open, fix it)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'tz-date-drift-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified bundles,
// vendored assets, node_modules, and THIS file + its ledger (whose docstrings embed
// example `new Date(…)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'palau', 'trippy',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-tz-date-drift\.mjs|tz-date-drift-triage\.tsv)/;

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

// ── Comment stripper ── overwrite ONLY comment chars with spaces, preserving every
// byte offset so line numbers stay exact. String-aware solely to avoid treating a
// `//` inside a string as a comment — it does NOT blank string BODIES. (An earlier
// body-blanking version desynced on a stray apostrophe in prawn's HTML text and
// silently ATE real `new Date(` code two lines later — a false-negative far worse
// than the rare cost of flagging a `new Date(a,b)` written literally inside a string,
// which is simply a one-time SAFE ledger entry.) Pragmatic, not a full lexer.
function stripComments(src) {
  const out = src.split('');
  let inStr = null, prev = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      prev = c === '\\' && prev === '\\' ? '' : c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; prev = c; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
      i--; prev = ''; continue;
    }
    if (c === '/' && n === '*') {
      out[i] = ' '; out[i + 1] = ' '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < src.length) { out[i] = ' '; out[i + 1] = ' '; i++; }
      prev = ''; continue;
    }
    prev = c;
  }
  return out.join('');
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

function normalize(s) {
  return s.replace(/\s+/g, '');
}

// From the index of the '(' that opens a call, return [argString, endIndexOfClose]
// by walking balanced parens. Returns null if unbalanced (truncated source).
function readParenArgs(src, openParen) {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return [src.slice(openParen + 1, i), i];
    }
  }
  return null;
}

// Split an argument string at TOP-LEVEL commas only (ignore commas nested inside
// (), [], {}). Returns the trimmed top-level args.
function topLevelArgs(argStr) {
  const args = [];
  let depth = 0, start = 0;
  for (let i = 0; i < argStr.length; i++) {
    const c = argStr[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { args.push(argStr.slice(start, i)); start = i + 1; }
  }
  args.push(argStr.slice(start));
  return args.map((a) => a.trim()).filter((a, idx) => !(idx === args.length - 1 && a === '' && args.length === 1));
}

const NEW_DATE = /new\s+Date\s*\(/g;

// Scan one source string → [{line, snippet, key}] for each LOCAL multi-arg
// `new Date(...)` site, GATED on the file containing `.toISOString(`.
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  // File-level gate: no UTC read anywhere → the local-construct can't drift through
  // toISOString in this file. Out of scope by design.
  if (!/\.toISOString\s*\(/.test(src)) return [];

  const rows = [];
  NEW_DATE.lastIndex = 0;
  let m;
  while ((m = NEW_DATE.exec(src)) !== null) {
    const openParen = src.indexOf('(', m.index + 'new'.length);
    if (openParen < 0) continue;
    const parsed = readParenArgs(src, openParen);
    if (!parsed) continue;
    const [argStr, closeIdx] = parsed;
    const args = topLevelArgs(argStr);
    // Local wall-clock constructor = 2+ top-level args. (0 args = now; 1 arg = ms
    // epoch or ISO string — both zone-correct.)
    if (args.length < 2) continue;
    // Already-fixed UTC form: first arg is a Date.UTC(...) call.
    if (/^Date\s*\.\s*UTC\s*\(/.test(args[0])) continue;
    const snippet = src.slice(m.index, closeIdx + 1).replace(/\s+/g, ' ').trim();
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
  // Flags the LOCAL multi-arg constructor when the file also has toISOString.
  expectSites('local 3-arg + toISO',
    'const d = new Date(year, month - 1, day);\nconst s = d.toISOString();',
    ['new Date(year, month - 1, day)']);
  expectSites('local 5-arg + toISO',
    'const d = new Date(Y, M-1, D, h, m);\nlog(new Date().toISOString());',
    ['new Date(Y, M-1, D, h, m)', 'new Date()']
      .filter((x) => x !== 'new Date()')); // only the multi-arg one is a site
  // Does NOT flag the already-fixed UTC form.
  expectSites('Date.UTC fixed',
    'const d = new Date(Date.UTC(y, m, d));\nconst s = d.toISOString();',
    []);
  // Does NOT flag single-arg / now constructors.
  expectSites('new Date(ms) single-arg',
    'const d = new Date(x.getTime());\nconst s = d.toISOString();',
    []);
  expectSites('new Date() now',
    'const d = new Date();\nconst s = d.toISOString();',
    []);
  expectSites('new Date(iso) single-arg',
    'const d = new Date(updatedAt);\nconst s = d.toISOString();',
    []);
  // File-level gate: local construct but NO toISOString anywhere → out of scope.
  expectSites('local construct, no toISO (local-only subsystem)',
    'const d = new Date(year, month-1, day);\nconst k = d.getFullYear();',
    []);
  // Nested commas inside Date.UTC don't fool the arg counter.
  expectSites('Date.UTC nested commas',
    'const d = new Date(Date.UTC(a, b-1, c, h, m));\nx.toISOString();',
    []);
  // A `//` inside a string must NOT be treated as a comment (would otherwise blank
  // the rest of the line and hide a following site). The stripper stays in sync.
  expectSites('slashes-in-string keep sync',
    'const u = "http://x"; const d = new Date(y, m, day);\nx.toISOString();',
    ['new Date(y, m, day)']);

  // Line numbers across a multi-site file.
  const fixture = [
    'const a = new Date(y, m, d);',          // line 1 site
    'const b = new Date(ms);',               // line 2 NO (single arg)
    'const c = new Date(Date.UTC(y, m, d));',// line 3 NO (Date.UTC)
    'const e = new Date(Y, M, D, h);',       // line 4 site
    'foo.toISOString();',                    // line 5 (gate satisfied)
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune.
  const k1 = scanSource('const d = new Date( y , m , d ); x.toISOString();')[0].key;
  const k2 = scanSource('const d=new Date(y,m,d);x.toISOString();')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or BUG
  // (every live site judged SAFE in the ledger), else --check is already red.
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
    console.log(`✗ ${newSites.length} untriaged tz-date-drift site(s) — judge each, then add a row to scripts/tz-date-drift-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    console.log(`\n(A site is a BUG if the LOCAL-constructed date flows INTO .toISOString() for a calendar-day label/key — then fix it with Date.UTC(…) and record SAFE. If the local date is read back with LOCAL getters and toISOString is a separate "now"/instant stamp, record SAFE with a one-line reason.)`);
    process.exit(1);
  }
  console.log(`✓ 0 untriaged tz-date-drift sites (${sites.length} judged: ${sites.filter((s) => s.status === 'SAFE').length} SAFE, ${bugSites.length} open BUG)`);
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
console.log(`\n${sites.length} site(s): ${newSites.length} NEW, ${bugSites.length} BUG, ${sites.filter((s) => s.status === 'SAFE').length} SAFE`);
