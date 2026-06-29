#!/usr/bin/env bun
//
// find-unguarded-decode.mjs — audit every `decodeURIComponent(...)` call in the
// repo and force a human to judge whether a MALFORMED-percent input can make it
// throw a URIError that crashes the page (or 500s a handler) UNGUARDED.
//
// WHY THIS EXISTS — a recurring white-screen class with no standing watcher
// `decodeURIComponent('%')` (a lone or truncated `%`, e.g. a hand-typed/shared
// deep-link `#ask/50%` or a tampered cookie) throws a synchronous URIError. When
// the call runs UNGUARDED at load — decoding `location.hash` / `location.search`
// / a route fragment / a cookie value while hydrating the page — the throw
// escapes the init IIFE and the whole tool white-screens. The loop has fixed this
// BY HAND at least three times:
//   • commentbank/index.html  — `#ask/50%` hash → safeDecodeURI() wrapper
//   • queen-scarlet-school/cast/index.html — popstate hash decode → safeDecodeURI()
//   • hunter/index.html (gate) — cookie value decode → try/catch in getCookie
// Same shape every time; nothing watches for the next one. This gate does.
//
// THE TELL THIS GATE KEYS ON
// Every literal `decodeURIComponent(` call site. Whether a given call is a BUG
// depends on TWO non-local facts a pure regex can't settle:
//   • is the argument user-controllable? (location.hash/search, a cookie value,
//     a route/deeplink fragment — vs. a string the app itself just encoded)
//   • is the throw caught? (an enclosing try/catch, or a known-safe wrapper like
//     safeDecodeURI() that already try/catches internally)
// A wrong guess in either direction would either miss the bug or red-flag the
// hardened majority and turn `bun run test` red on healthy code. So — exactly
// like find-wrongtype-json-parse.mjs, find-divide-by-length.mjs and
// find-truthy-zero.mjs — this gate LISTS every decode site, cross-references
// scripts/unguarded-decode-triage.tsv, and (in --check) FAILS only on a site
// nobody has judged yet. A NEW decode call trips the gate the moment it lands;
// everything already judged SAFE stays quiet. The triage reason records WHY each
// is safe (guarded by try/catch / safe wrapper / argument is app-encoded only).
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-unguarded-decode.mjs              # table of every site + verdict
//   scripts/find-unguarded-decode.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-unguarded-decode.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-unguarded-decode.mjs --new        # list ONLY untriaged sites
//   scripts/find-unguarded-decode.mjs --dump-ledger# emit a SAFE stub row per site
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'unguarded-decode-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `decodeURIComponent(...)` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'pinglobe-feedback', 'zanyplans',
  'scripts', 'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-unguarded-decode\.mjs|unguarded-decode-triage\.tsv)/;

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

function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── The scanner ───────────────────────────────────────────────────────────────
// Flag every `decodeURIComponent(` call. Capture a human-readable snippet from
// the nearest statement boundary before the call through the matching close paren.
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  const n = src.length;
  const RE = /decodeURIComponent\s*\(/g;
  let m;
  while ((m = RE.exec(src)) !== null) {
    // Walk to the matching close paren, skipping string/template bodies.
    let i = m.index + m[0].length, depth = 1;
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
      else if (c === ')') depth--;
      if (depth > 0) i++;
    }
    if (depth !== 0) continue; // unbalanced — give up on this call
    // Snippet: from the nearest statement boundary before the call through the
    // closing paren, for human context (so the enclosing try/{ shows when inline).
    let start = Math.max(0, m.index - 60);
    for (const ch of [';', '{', '}', '\n']) {
      const b = src.lastIndexOf(ch, m.index - 1);
      if (b >= start) start = b + 1;
    }
    const end = i + 1; // include the closing paren
    const snippet = src.slice(start, end).replace(/\s+/g, ' ').trim();
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
  // Flags every decode call — guarded or not (guardedness is a ledger judgment).
  expectSites('unguarded hash decode', "const v = decodeURIComponent(location.hash.slice(1));",
    ["const v = decodeURIComponent(location.hash.slice(1))"]);
  expectSites('guarded inline still flagged', "try { return decodeURIComponent(x); } catch { return x; }",
    ["return decodeURIComponent(x)"]);
  expectSites('nested parens', "const v = decodeURIComponent(part.slice(eq + 1));",
    ["const v = decodeURIComponent(part.slice(eq + 1))"]);
  // Does NOT flag encode (no throw) or a commented/string-literal call.
  expectSites('encode not flagged', "const v = encodeURIComponent(x);", []);
  expectSites('comment not flagged', "// const v = decodeURIComponent(raw)\nconst x = 1;", []);
  expectSites('decodeURI is a different fn', "const v = decodeURI(x);", []);

  // Multi-site + line numbers.
  const fixture = [
    "const a = decodeURIComponent(h);",          // line 1 site
    "const b = encodeURIComponent(h);",          // line 2 NO (encode)
    "const c = foo(bar);",                        // line 3 NO
    "const d = decodeURIComponent(s.slice(1));",  // line 4 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource("const g = decodeURIComponent( raw );")[0].key;
  const k2 = scanSource("const g=decodeURIComponent(raw);")[0].key;
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
    console.log(`✗ ${newSites.length} untriaged decodeURIComponent site(s) — judge each (can the argument carry a malformed % from the URL/cookie, and is the throw caught?), then add a row to scripts/unguarded-decode-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open unguarded-decode BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} decodeURIComponent site(s), all triaged SAFE.`);
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
console.log('decodeURIComponent sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
