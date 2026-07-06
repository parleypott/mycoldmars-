#!/usr/bin/env bun
//
// find-unguarded-boot-localstorage.mjs — audit every bare `localStorage` access
// in the repo and force a human to judge whether a STORAGE-BLOCKED browser can
// make it throw a SecurityError that WHITE-SCREENS the page at boot.
//
// WHY THIS EXISTS — the single most-repeated PROJECT brick this week (hand-fixed
// at least 8 times: nile-flights, essays player, laserspace, walden-3d studio,
// walden 2d, westchester, burma-essays, hakka+night-market) had no standing
// watcher. In a storage-blocked browser — iOS Safari "Block All Cookies",
// Gmail/Slack/Instagram in-app webviews, Firefox "Never remember history" — the
// mere ACT of touching `localStorage` throws a synchronous SecurityError. The
// value is irrelevant; `localStorage.getItem('x')` throws before it returns
// anything. When that call is reached during a page's SYNCHRONOUS boot — a
// top-level `const x = localStorage.getItem(...)`, an init IIFE, or a function
// CALLED at load — and the throw is NOT caught, it escapes the boot script and
// the whole tool renders blank. Every fix was the same shape: wrap the access
// (or a `safeLsGet()` helper) in try/catch so a blocked store degrades to a
// default instead of bricking. Same class every time; nothing watched for the
// next one. This gate does.
//
// THE TELL THIS GATE KEYS ON
// The load-bearing property of a brick is NOT "runs at boot" (hard to prove with
// a call graph) but "is NOT lexically inside a try block". A guarded access can
// NEVER brick — no matter when it runs — so it is provably safe. An UNGUARDED
// access is a POTENTIAL brick; whether it actually white-screens depends on ONE
// non-local fact a pure regex can't settle: is it reached during synchronous
// boot, or only later from a user-triggered handler (a throw-on-click, lower
// severity)? So — exactly like find-unguarded-decode.mjs and its siblings — the
// scanner flags every UNGUARDED site (bare `localStorage` not inside any
// enclosing `try {`), cross-references scripts/unguarded-boot-localstorage-triage.tsv,
// and (in --check) FAILS only on a site nobody has judged yet. A NEW unguarded
// access trips the gate the moment it lands; everything already judged stays
// quiet. The triage reason records WHY each is safe (deferred to a handler /
// node-only script / already behind a safe wrapper) — or flags it BUG.
//
// Guarded accesses (anywhere inside a try) are NOT flagged at all — they can't
// brick, so listing them would just be noise. `globalThis.localStorage` /
// `window.localStorage.` (preceded by a dot) are also skipped: those are the
// serverless/api optional-chaining polyfill guards, not browser-boot reads.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-unguarded-boot-localstorage.mjs              # table of every unguarded site + verdict
//   scripts/find-unguarded-boot-localstorage.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-unguarded-boot-localstorage.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-unguarded-boot-localstorage.mjs --new        # list ONLY untriaged sites
//   scripts/find-unguarded-boot-localstorage.mjs --dump-ledger# emit a SAFE stub row per site
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged can't-brick-boot, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'unguarded-boot-localstorage-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `localStorage` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'pinglobe-feedback', 'zanyplans',
  'scripts', 'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\/assets\/manual-steps|\bdist\b|find-unguarded-boot-localstorage\.mjs|unguarded-boot-localstorage-triage\.tsv)/;

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

function normalize(s) {
  return s.replace(/\s+/g, '');
}

// ── Script-region extraction ──────────────────────────────────────────────────
// For .html, only the inline <script> bodies are JS — running the JS lexer /
// brace counter over the surrounding HTML (or a <style>{...} block) would desync.
// Return [{ code, offset }] where offset is the region's start index in the full
// file (so line numbers map back to the file, not the region). For .js/.ts/.mjs/
// .jsx the whole file is one region at offset 0.
function scriptRegions(path, src) {
  if (!path.endsWith('.html')) return [{ code: src, offset: 0 }];
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (/\bsrc\s*=/.test(m[1])) continue; // external script, no inline body
    const bodyOffset = m.index + m[0].indexOf('>', 0) + 1;
    out.push({ code: m[2], offset: bodyOffset });
  }
  return out;
}

// ── The scanner ───────────────────────────────────────────────────────────────
// Blank strings/comments/regex (offset-preserving) so braces/keywords inside them
// don't corrupt the brace stack, then walk the region tracking a stack of brace
// scopes. Each `{` records whether it opened a `try` block. A bare `localStorage`
// token (not preceded by `.` or an identifier char) is UNGUARDED — and therefore
// flagged — iff NO enclosing scope on the stack is a try.
function scanRegion(rawCode, fileOffset, fullSrc) {
  const code = stripComments(rawCode);
  const rows = [];
  const n = code.length;
  const stack = []; // booleans: did this brace open a try block?
  for (let i = 0; i < n; i++) {
    const c = code[i];
    if (c === '{') {
      // Look back past whitespace for the `try` keyword immediately before `{`.
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const isTry = j >= 2 && code.slice(j - 2, j + 1) === 'try' && !/[\w$]/.test(code[j - 3] || '');
      stack.push(isTry);
    } else if (c === '}') {
      stack.pop();
    } else if (
      code.startsWith('localStorage', i) &&
      !/[.\w$]/.test(code[i - 1] || '') &&
      !/[\w$]/.test(code[i + 12] || '')
    ) {
      if (!stack.includes(true)) {
        const abs = fileOffset + i;
        // Snippet from the nearest statement boundary before the token through the
        // end of the access expression (a short readable window), from the RAW src.
        let start = Math.max(0, i - 40);
        for (const ch of [';', '{', '}', '\n']) {
          const b = code.lastIndexOf(ch, i - 1);
          if (b >= start) start = b + 1;
        }
        let end = i + 12;
        // extend through a simple .method(...) or [..] access + close paren for context
        while (end < n && end < i + 120 && code[end] !== ';' && code[end] !== '\n' && code[end] !== '{' && code[end] !== '}') end++;
        const snippet = rawCode.slice(start, end).replace(/\s+/g, ' ').trim();
        rows.push({ line: lineOf(fullSrc, abs), snippet, key: normalize(snippet) });
      }
      i += 11;
    }
  }
  return rows;
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  const rel = relative(ROOT, path);
  const rows = [];
  for (const { code, offset } of scriptRegions(path, src)) {
    for (const r of scanRegion(code, offset, src)) {
      rows.push({ ...r, path, rel, fileKey: rel + '\t' + r.key });
    }
  }
  return rows;
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
  const expectSnippets = (label, src, expected) => {
    const got = scanRegion(src, 0, src).map((r) => r.snippet);
    const eq = JSON.stringify(got) === JSON.stringify(expected);
    if (eq) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
  };
  // Unguarded top-level read → flagged.
  expectSnippets('top-level read flagged',
    "const v = localStorage.getItem('k');",
    ["const v = localStorage.getItem('k')"]);
  // Inside a try (any ancestor) → NOT flagged.
  expectSnippets('try-wrapped not flagged',
    "try { const v = localStorage.getItem('k'); } catch { }",
    []);
  // Nested try (grandparent try still guards) → NOT flagged.
  expectSnippets('nested-under-try not flagged',
    "try { function f(){ return localStorage.getItem('k'); } } catch {}",
    []);
  // Unguarded inside a plain (non-try) function → flagged (it's the boot-called-fn class).
  expectSnippets('unguarded fn body flagged',
    "function boot(){ return localStorage.getItem('k'); }",
    ["return localStorage.getItem('k')"]);
  // `localStorage` inside a comment / string → NOT flagged.
  expectSnippets('comment not flagged', "// localStorage.getItem('k')\nconst x=1;", []);
  expectSnippets('string not flagged', "const s = 'localStorage.getItem';", []);
  // Preceded by a dot (globalThis/window polyfill) → NOT flagged.
  expectSnippets('dotted access not flagged', "const v = globalThis.localStorage.getItem('k');", []);
  // A longer identifier that merely CONTAINS localStorage → NOT flagged.
  expectSnippets('substring ident not flagged', "const v = myLocalStorageShim.get('k');", []);
  expectSnippets('trailing ident not flagged', "const v = localStorageShim;", []);
  // setItem / removeItem / bracket access all count.
  expectSnippets('setItem flagged', "localStorage.setItem('k', v);", ["localStorage.setItem('k', v)"]);
  expectSnippets('bracket access flagged', "const v = localStorage['k'];", ["const v = localStorage['k']"]);
  // try guarding only a SIBLING scope does NOT protect a later unguarded access.
  expectSnippets('sibling try does not guard later',
    "try { foo(); }\nconst v = localStorage.getItem('k');",
    ["const v = localStorage.getItem('k')"]);
  // A brace inside a string/regex must not corrupt the try stack.
  expectSnippets('regex brace does not desync stack',
    "try { r = /[{]/; }\nlocalStorage.getItem('k');",
    ["localStorage.getItem('k')"]);

  // HTML: only inline <script> bodies scanned; <style>{...} ignored; line maps to file.
  const html = [
    "<style>.a{color:red}</style>",   // line 1 — braces here must be ignored
    "<script>",                        // line 2
    "const v = localStorage.getItem('k');", // line 3 — the site
    "</script>",                       // line 4
  ].join('\n');
  {
    const regions = scriptRegions('x.html', html);
    const rows = regions.flatMap((r) => scanRegion(r.code, r.offset, html));
    const okLine = rows.length === 1 && rows[0].line === 3;
    if (okLine) pass++;
    else { fail++; console.log(`  ✗ html line map: got ${JSON.stringify(rows.map((r) => r.line))}, expected [3]`); }
  }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanRegion("const g = localStorage.getItem( 'k' );", 0, "").map((r) => r.key)[0];
  const k2 = scanRegion("const g=localStorage.getItem('k');", 0, "").map((r) => r.key)[0];
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: every live UNGUARDED site must be judged in the ledger
  // (zero NEW/BUG), else --check is already red.
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
    console.log(`✗ ${newSites.length} untriaged UNGUARDED localStorage site(s) — judge each (is it reached during synchronous boot → BUG, needs a try/catch or safeLsGet wrapper; or only from a user handler / node-only → SAFE), then add a row to scripts/unguarded-boot-localstorage-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open unguarded-boot-localStorage BUG(s) in the ledger — guard or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} unguarded localStorage site(s), all triaged SAFE.`);
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
console.log('UNGUARDED localStorage sites  [SAFE=ledger-judged can\'t-brick-boot · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} unguarded site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
