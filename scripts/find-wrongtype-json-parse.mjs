#!/usr/bin/env bun
//
// find-wrongtype-json-parse.mjs — audit every `JSON.parse(... || '[]')` /
// `JSON.parse(... ?? '{}')` TYPED-LITERAL-FALLBACK parse in the repo and force a
// human to judge whether a stored value of the WRONG TYPE can survive the parse
// and crash a downstream array/object use.
//
// WHY THIS EXISTS — the sibling the throw-gate can't see
// find-unguarded-json-parse.sh closes the THROW subclass: a corrupt/truncated
// value makes JSON.parse throw, and an unguarded parse at load white-screens the
// tool. This gate closes the OTHER half of the same vein — the WRONG-TYPE
// subclass, which the loop has fixed BY HAND ~20+ times (every "Array.isArray"
// fix in the backlog): westchester pins/villages/scenarios, burma 'burma:offline'
// /'burma:list', snapshot readIndex, walden SCENES, research SESSIONS, the
// interpreter ls-index, sot-hunter loadFeedback, ...
//
// The shape is always the same and the THROW gate is BLIND to it:
//
//     const v = JSON.parse(localStorage.getItem(KEY) || '[]');   // in try/catch
//     return v;                                                   // ← returns raw
//     // ...later, a consumer does v.map(...) / v.length / for (x of v)
//
// `JSON.parse('{}')`, `JSON.parse('5')`, `JSON.parse('"x"')`, `JSON.parse('null')`
// all SUCCEED — so a try/catch (which the throw gate checks for) does NOTHING
// here. And the `|| '[]'` / `?? []` fallback only guards the MISSING/empty case
// (`getItem` returned null) — it is powerless against a value that is PRESENT but
// the wrong shape (corrupt, hand-edited, quota-truncated to a fragment that still
// parses, synced down from a legacy/cloud format). The parsed wrong-type value
// flows out and the FIRST array op on it throws: `({}).map` is not a function,
// `(5).length` is undefined → `for (… of 5)` is "not iterable", `new Set(5)`
// throws. If that use runs at load (hydrating a cache, restoring saved state,
// reading an index) the tool breaks the same way the throw subclass does.
//
// THE TELL THIS GATE KEYS ON
// A `JSON.parse(...)` whose argument ends in a TYPED-LITERAL fallback —
// `|| '[]'`, `|| '{}'`, `?? []`, `|| 'null'`, `|| '""'`, `|| '0'` and friends.
// That fallback is a DECLARATION of intent: the author expects an array (or
// object/etc.) back. It is exactly the weak guard the loop keeps finding
// insufficient, and it is regex-precise to match — far lower false-positive than
// trying to dataflow-track every anonymous `JSON.parse(getItem(...))`.
//
// WHY A LEDGER, NOT A PURE HEURISTIC
// Whether a typed-fallback parse is a BUG depends on what happens to the result —
// which is non-local:
//   • `return Array.isArray(v) ? v : []`  after the parse           (SAFE)
//   • `(v && typeof v === 'object' && !Array.isArray(v)) ? v : {}`  (SAFE)
//   • the result is only ever read with `obj[key]` property access  (SAFE — a
//     wrong-type value yields undefined, never throws)
//   • `new Set(JSON.parse(...))` INSIDE a try/catch                 (SAFE — a
//     non-iterable throws and is caught to an empty Set)
//   • the raw result is RETURNED or iterated with no type guard and
//     no caller-side try/catch                                       (BUG)
// A pure syntactic classifier can't tell these apart without false-flagging the
// hardened majority (which would turn `bun run test` red on healthy code). So —
// exactly like find-divide-by-length.mjs and find-truthy-zero.mjs — this gate
// LISTS every typed-fallback parse, cross-references
// scripts/wrongtype-json-parse-triage.tsv, and (in --check) FAILS only on a site
// nobody has judged yet. A NEW typed-fallback parse trips the gate the moment it
// lands; everything already judged stays quiet.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-wrongtype-json-parse.mjs              # table of every site + verdict
//   scripts/find-wrongtype-json-parse.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-wrongtype-json-parse.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-wrongtype-json-parse.mjs --new        # list ONLY untriaged sites
//   scripts/find-wrongtype-json-parse.mjs --dump-ledger# emit a SAFE stub row per site
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'wrongtype-json-parse-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified
// bundles, vendored assets, node_modules, and THIS file + its ledger (whose
// docstrings embed example `JSON.parse(... || '[]')` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'pinglobe-feedback', 'zanyplans',
  'scripts', 'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-wrongtype-json-parse\.mjs|wrongtype-json-parse-triage\.tsv)/;

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

// Blank out COMMENTS only (not strings — we need the `'[]'` / `'{}'` fallback
// literal text to survive so the scanner can see it). Overwrites comment chars
// with spaces, preserving every byte offset so line numbers stay exact. A
// `JSON.parse(...)` inside a string literal could in principle be misread, but
// that only INVENTS a site (read as NEW → re-review, the safe way), and string
// literals containing the exact `JSON.parse(... || '[]')` source are vanishingly
// rare outside this file (which is SKIP-listed).
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (j) => { if (src[j] !== '\n') out[j] = ' '; };
  // Blank a template-literal body but recurse into ${...} so a real parse there
  // is still scanned; leave single/double quoted strings INTACT (we need their
  // literal text). We still must skip OVER quoted strings so a `//` or `/*`
  // inside a string isn't mistaken for a comment start.
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

// A typed-literal fallback at the END of a JSON.parse argument: `|| '[]'`,
// `?? '{}'`, `|| []`, `?? null`, `|| '""'`, `|| '0'`, `|| ''` ... The literal can
// be a quoted JSON literal (`'[]'`, `"{}"`, `'null'`, `'0'`, `'""'`) or a bare
// JS literal (`[]`, `{}`, `null`, `0`). Trailing whitespace allowed before the
// closing paren of JSON.parse(...).
const FALLBACK_TAIL = /(\|\||\?\?)\s*(?:'(\[\]|\{\}|null|0|""|)'|"(\[\]|\{\}|null|0|'')"|(\[\]|\{\}|null|0))\s*$/;

// ── The scanner ───────────────────────────────────────────────────────────────
// Find every `JSON.parse(` and capture its full (balanced-paren) argument. Flag
// the call if that argument ENDS in a typed-literal fallback (FALLBACK_TAIL).
function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  const n = src.length;
  const RE = /JSON\s*\.\s*parse\s*\(/g;
  let m;
  while ((m = RE.exec(src)) !== null) {
    const argStart = m.index + m[0].length;
    // Walk to the matching close paren, tracking nested parens and skipping
    // string/template bodies so a `)` inside a string doesn't close us early.
    let i = argStart, depth = 1;
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
    const arg = src.slice(argStart, i);
    if (!FALLBACK_TAIL.test(arg)) continue;
    // Snippet: from the nearest statement boundary before JSON.parse through the
    // closing paren, for human context.
    let start = Math.max(0, m.index - 40);
    for (const ch of [';', '{', '}', '\n', '(']) {
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
  // Flags the typed-fallback forms (nested getItem paren handled by balanced walk).
  expectSites('array fallback', "const v = JSON.parse(localStorage.getItem(K) || '[]');",
    ["const v = JSON.parse(localStorage.getItem(K) || '[]')"]);
  expectSites('object fallback', "const o = JSON.parse(raw || '{}');", ["const o = JSON.parse(raw || '{}')"]);
  expectSites('nullish array', "const v = JSON.parse(raw ?? '[]');", ["const v = JSON.parse(raw ?? '[]')"]);
  expectSites('bare-literal fallback', "const v = JSON.parse(raw || []);", ["const v = JSON.parse(raw || [])"]);
  expectSites('null fallback', "const v = JSON.parse(raw || 'null');", ["const v = JSON.parse(raw || 'null')"]);
  expectSites('new Set wrap', "const s = new Set(JSON.parse(g() || '[]'));", ["JSON.parse(g() || '[]')"]);
  // Does NOT flag parses WITHOUT a typed-literal fallback.
  expectSites('no fallback', "const v = JSON.parse(raw);", []);
  expectSites('non-literal fallback', "const v = JSON.parse(raw || other);", []);
  expectSites('fallback elsewhere', "const v = JSON.parse(getItem(k)) || [];", []); // `|| []` is OUTSIDE the parse
  expectSites('comment', "// const v = JSON.parse(raw || '[]')\nconst x = 1;", []);
  // Stringify clone (JSON.parse(JSON.stringify(x))) has no typed fallback → skip.
  expectSites('stringify clone', "const c = JSON.parse(JSON.stringify(obj));", []);

  // Multi-site + line numbers.
  const fixture = [
    "const a = JSON.parse(s || '[]');",          // line 1 site
    "const b = JSON.parse(s);",                  // line 2 NO (no fallback)
    "const c = JSON.parse(JSON.stringify(x));",  // line 3 NO (stringify clone)
    "const d = JSON.parse(t ?? '{}');",          // line 4 site
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 4]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,4]`); }

  // Normalized key is whitespace-immune (survives reformatting).
  const k1 = scanSource("const g = JSON.parse( raw  ||  '[]' );")[0].key;
  const k2 = scanSource("const g=JSON.parse(raw||'[]');")[0].key;
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
    console.log(`✗ ${newSites.length} untriaged typed-fallback JSON.parse site(s) — judge each (is the wrong-type result guarded before it's iterated?), then add a row to scripts/wrongtype-json-parse-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open wrong-type JSON.parse BUG(s) in the ledger — fix or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} typed-fallback JSON.parse site(s), all triaged SAFE.`);
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
console.log('typed-fallback JSON.parse sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
