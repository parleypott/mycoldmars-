#!/usr/bin/env bun
//
// find-stateful-global-regex.mjs — audit every `.test()` / `.exec()` call whose
// receiver is a MODULE-LEVEL regex carrying the `g` (or `y`) flag, and force a
// human to judge whether its `lastIndex` is managed — the stateful-global-regex
// trap.
//
// WHY THIS EXISTS — a recurring class the burma team fixed by hand, never gated
// A `RegExp` with the `g` (global) or `y` (sticky) flag keeps a MUTABLE cursor,
// `.lastIndex`, that BOTH `.test()` and `.exec()` advance on every call and read
// on the next. That is fine for a FRESH regex (a function-local `const re = /x/g`
// is reborn each call, cursor at 0). It is a live bug for a MODULE-LEVEL /g const
// reused across calls:
//
//     const HAS_TC = /\d{2}:\d{2}/g;                 // module scope — ONE instance
//     function looksLikeTimecode(s) {
//       return HAS_TC.test(s);                        // 1st call true, cursor advances
//     }                                               // 2nd call on SAME string: FALSE
//
// `.test()` on a persistent /g regex returns TRUE, FALSE, TRUE, FALSE… for the
// same input as the cursor walks past the match and wraps — an intermittent,
// input-order-dependent wrong answer that no quick test catches (the first call
// always passes). `.exec()` in a `while` drain is the CORRECT idiom (it walks to
// null and self-resets), but a single `.exec()`, or a drain that `break`s early,
// strands the cursor for the next caller.
//
// The fix every time is one of: use a NON-global twin for `.test()` (burma's
// `TC` global for matchAll + `TC_HAS` non-global for routing), reset
// `re.lastIndex = 0` immediately before the call, or move the literal
// function-local. The burma/parser code does all three correctly — but nothing
// watches for the next module-level /g regex someone points `.test()` at. This does.
//
// THE TELL THIS GATE KEYS ON
// A `NAME.test(` or `NAME.exec(` where NAME is declared at MODULE LEVEL (column 0
// or `export const`, i.e. NOT indented inside a function body) as a regex bearing
// the `g` or `y` flag — either a literal `const NAME = /…/g` or a constructor
// `const NAME = new RegExp(…, 'ig')`. A function-local regex (indented decl) is
// reborn per call and is NOT flagged. A non-global module regex (`/…/` with no
// g/y) has no lastIndex cursor and is NOT flagged. `.match()`, `.matchAll()`,
// `.replace()`, `.split()` do NOT read/strand lastIndex the harmful way and are
// NOT flagged.
//
// WHY A LEDGER, NOT A HEURISTIC
// Whether a flagged site is a BUG is NON-LOCAL: it depends on whether a
// `NAME.lastIndex = 0` reset precedes it, whether an `.exec()` sits in a
// drain-to-null loop, or whether the string is single-use. A pure syntactic
// classifier can't settle that without false-flagging the (many) correctly-managed
// sites and turning `bun run test` red on healthy code. So — exactly like
// find-negative-slice.mjs, find-divide-by-length.mjs and the other ledger gates —
// this LISTS every site, cross-references scripts/stateful-global-regex-triage.tsv,
// and (in --check) FAILS only on a site nobody has judged yet. A newly introduced
// `MODULE_G_RE.test(x)` trips the gate the moment it lands; everything already
// judged SAFE stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-stateful-global-regex.mjs              # table of every site + verdict
//   scripts/find-stateful-global-regex.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-stateful-global-regex.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-stateful-global-regex.mjs --new        # list ONLY untriaged sites
//   scripts/find-stateful-global-regex.mjs --dump-ledger # emit SAFE stub rows to seed the TSV
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'stateful-global-regex-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `NAME.test(` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'palau-script', 'palau2-script', 'animatedcrazy', 'newpress-deck', 'pinglobe',
  'zanyplans', 'scripts', 'democracy', 'todo', 'queen-scarlet-school',
  'commentbank', 'cutter', 'research', 'borders', 'border-guesser', 'growth',
  'views-growth', 'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy',
  'palau', 'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-stateful-global-regex\.mjs|stateful-global-regex-triage\.tsv)/;

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

// ── Regex-literal flag lexer ────────────────────────────────────────────────
// Given source and the index of a `/` that OPENS a regex literal, walk to the
// matching closing `/` (respecting `\` escapes and `[...]` char classes, inside
// which `/` is literal), then read the trailing `[a-z]*` flags. Returns the flag
// string, or null if this `/` doesn't close as a regex literal on the same line.
function readRegexLiteralFlags(src, slashIdx) {
  let i = slashIdx + 1;
  let inClass = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }       // escape — skip next char
    if (c === '\n') return null;             // regex literals don't span lines
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '/') break;                    // closing delimiter
  }
  if (i >= src.length || src[i] !== '/') return null;
  let j = i + 1, flags = '';
  while (j < src.length && /[a-z]/.test(src[j])) flags += src[j++];
  return flags;
}

// ── Collect module-level global/sticky regex names in a file ────────────────
// Module-level = the declaration line begins at COLUMN 0 with `const ` or
// `export const ` (function-local decls are indented). Handles both the literal
// form (`const NAME = /…/gi`) and the constructor form
// (`const NAME = new RegExp(…, 'ig')`). Only names whose flags include `g` or `y`
// (the two lastIndex-bearing flags) are returned.
const DECL_RE = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/;
// Constructor flags = the LAST comma-preceded quoted string of ONLY valid regex
// flag chars (dgimsuvy) sitting right before the closing `)`. Keying on the flag
// CHARSET (not `[a-z]*`) means a pattern arg like `new RegExp('gray')` — no comma
// before it, and 'r'/'a' aren't flag chars — is never mistaken for flags, while a
// pattern that itself contains `)`/`,` (burma's DAY_LOCAL_G template) no longer
// hides the trailing `, 'ig')`. Matched globally; the last hit wins.
const NEWREGEXP_FLAGS = /,\s*(['"`])([dgimsuvy]{1,7})\1\s*\)/g;

function moduleGlobalRegexNames(src) {
  const names = new Set();
  const lines = src.split('\n');
  for (const line of lines) {
    // must be a top-level (column-0) const declaration
    if (!/^(?:export\s+)?const\s/.test(line)) continue;
    const m = DECL_RE.exec(line);
    if (!m) continue;
    const name = m[1];
    const rest = line.slice(m[0].length);
    if (rest.startsWith('/')) {
      const flags = readRegexLiteralFlags(rest, 0);
      if (flags && /[gy]/.test(flags)) names.add(name);
    } else if (/^new\s+RegExp\b/.test(rest)) {
      NEWREGEXP_FLAGS.lastIndex = 0;
      let nm, flags = null;
      while ((nm = NEWREGEXP_FLAGS.exec(rest)) !== null) flags = nm[2]; // last wins
      if (flags && /[gy]/.test(flags)) names.add(name);
    }
  }
  return names;
}

// ── The scanner ─────────────────────────────────────────────────────────────
// For each module-level global-regex NAME, every `NAME.test(` / `NAME.exec(`
// call is a site. Snippet carries left context back to the nearest boundary so a
// reviewer sees whether a `.lastIndex = 0` reset or a `while(` drain surrounds it.
const CTX = 60;

function scanSource(rawSrc) {
  // Declarations are read from RAW source: the shared stripComments() blanks
  // regex LITERALS (along with strings/comments) to keep its own scanners from
  // matching inside them, which would erase the `/…/g` we need to read flags
  // from. Usages are scanned in the STRIPPED source so a `RE.test(` sitting in a
  // comment or string body is not counted. stripComments preserves newlines, so
  // line numbers line up with the raw file.
  const names = moduleGlobalRegexNames(rawSrc);
  const src = stripComments(rawSrc);
  const rows = [];
  for (const name of names) {
    const useRe = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.\\s*(test|exec)\\s*\\(', 'g');
    let m;
    while ((m = useRe.exec(src)) !== null) {
      const at = m.index;
      let start = Math.max(0, at - CTX);
      for (const ch of [';', '{', '}', '\n', '(']) {
        const b = src.lastIndexOf(ch, at - 1);
        if (b >= start) start = b + 1;
      }
      const snippet = src.slice(start, at + m[0].length).replace(/\s+/g, ' ').trim();
      rows.push({ line: lineOf(src, at), snippet, key: normalize(snippet) });
    }
  }
  return rows.sort((a, b) => a.line - b.line);
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
  // FLAGS: module-level /g (or /y) regex used with .test() / .exec().
  expectSites('literal g + test', 'const RE = /x/g;\nif (RE.test(s)) {}', ['RE.test(']);
  expectSites('literal gi + exec', 'const RE = /x/gi;\nRE.exec(s);', ['RE.exec(']);
  expectSites('sticky y + test', 'const RE = /x/y;\nRE.test(s);', ['RE.test(']);
  expectSites('constructor ig + exec', "const RE = new RegExp('x', 'ig');\nRE.exec(s);", ['RE.exec(']);
  // Constructor whose PATTERN arg itself contains `)`/`,` (burma DAY_LOCAL_G shape)
  // must still see the trailing 'ig' flags.
  expectSites('constructor paren-pattern', "const RE = new RegExp(`\\\\bDAY([${C}])\\\\b`, 'ig');\nRE.exec(s);", ['RE.exec(']);
  // A pattern arg that LOOKS like flags (all-letter, single arg) is not flags.
  expectSites('constructor pattern-not-flags', "const RE = new RegExp('gray');\nRE.test(s);", []);
  expectSites('while-drain still flagged', 'const RE = /x/g;\nwhile (RE.exec(s)) {}', ['RE.exec(']);
  // DOES NOT FLAG: non-global module regex (no lastIndex cursor).
  expectSites('non-global test', 'const RE = /x/;\nRE.test(s);', []);
  expectSites('non-global i test', 'const RE = /x/i;\nRE.test(s);', []);
  // DOES NOT FLAG: function-local (indented) decl — reborn each call.
  expectSites('function-local g', 'function f(s) {\n  const re = /x/g;\n  return re.test(s);\n}', []);
  // DOES NOT FLAG: safe consumers that don't strand lastIndex.
  expectSites('match consumer', 'const RE = /x/g;\nconst o = s.match(RE);', []);
  expectSites('matchAll consumer', 'const RE = /x/g;\nconst o = [...s.matchAll(RE)];', []);
  expectSites('replace consumer', 'const RE = /x/g;\nconst o = s.replace(RE, "y");', []);
  // DOES NOT FLAG: constructor with no global flag.
  expectSites('constructor no-g', "const RE = new RegExp('x', 'i');\nRE.test(s);", []);
  expectSites('constructor no-flags', "const RE = new RegExp('x');\nRE.test(s);", []);
  // Comment / string bodies never match.
  expectSites('comment', '// const RE = /x/g; RE.test(s)\nconst y = 1;', []);
  expectSites('string body', "const s = 'RE.test(x)'; const q = 2;", []);
  // Name-boundary: OTHER.test must not match RE.
  expectSites('name boundary', 'const RE = /x/g;\nconst OTHERRE = /y/;\nOTHERRE.test(s);', []);

  // Multi-site + line numbers (two flagged sites, skips between).
  const fixture = [
    'const A = /x/g;',           // 1
    'const B = /y/;',            // 2  non-global
    'A.test(s);',                // 3  site
    'const o = s.match(A);',     // 4  safe consumer
    'B.test(s);',                // 5  non-global receiver
    'A.exec(s);',                // 6  site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([3, 6]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [3,6]`); }

  // Normalized key is whitespace-immune.
  const k1 = scanSource('const RE = /x/g;\nRE . test ( s );')[0].key;
  const k2 = scanSource('const RE=/x/g;\nRE.test(s);')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or
  // BUG (every live site judged in the ledger), else --check is already red.
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
    console.log(`✗ ${newSites.length} untriaged stateful-global-regex site(s) — judge each (is lastIndex managed / a drain loop?), then add a row to scripts/stateful-global-regex-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open stateful-global-regex BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} stateful-global-regex site(s), all triaged SAFE.`);
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
console.log('stateful-global-regex sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
