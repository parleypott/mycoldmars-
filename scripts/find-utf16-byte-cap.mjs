#!/usr/bin/env bun
//
// find-utf16-byte-cap.mjs — audit every place a BYTE-denominated cap is compared
// against a JS string's `.length`, and force a human to judge whether that string
// can hold NON-ASCII text — the "UTF-16 code units masquerading as bytes" trap.
//
// WHY THIS EXISTS
// A size cap that means BYTES is routinely written against `str.length`:
//
//     const MAX_BYTES = 256 * 1024;               // "256 KB" storage/wire cap
//     if (JSON.stringify(state).length > MAX_BYTES) reject();   // ← BUG
//
// `String.prototype.length` counts UTF-16 CODE UNITS, not bytes. For ASCII the
// two coincide, so every test with English text passes — the cap looks correct.
// But a Burmese, Chinese, or emoji-bearing payload encodes to 2–4 UTF-8 bytes per
// code unit (and astral chars are 2 code units for 4 bytes), so a `.length`-based
// "256 KB" cap actually admits up to ~3× that many real bytes. The blob then blows
// the localStorage quota, the DB column, or the wire budget the cap was supposed to
// protect — a silent UNDER-enforcement that only bites non-Latin content.
//
// The correct measure is REAL bytes:
//     Buffer.byteLength(s, 'utf8')          // server / Node
//     new TextEncoder().encode(s).length     // browser / isomorphic
//     new Blob([s]).size                      // browser
//     s.length * 2                            // localStorage quota (stores UTF-16)
//
// This loop has hand-fixed this exact shape ≥4×: Westchester House Hunter state-sync
// (1 MB cap counted UTF-16 chars), Nile-flights state (256 KB), the Interpreter
// snapshot vault (4 MB localStorage cap on transcripts), and commentbank-ask's
// public corpus cost cap. Each fix swapped `.length` for a byte measure. No gate
// watched for the class, so the fifth reintroduction would land unseen.
//
// BASE64 IS SAFE (and common here). A base64 data-URL string is pure ASCII, so its
// `.length` (chars) EQUALS its byte length — `dataBase64.length > MAX_REF_BYTES` is
// correct, and the loop's image endpoints lean on it heavily (often with a `* 1.4`
// slack factor for the base64→binary ratio). Flagging those would turn `bun run
// test` red on healthy code, so — like find-negative-slice / find-truthy-zero /
// find-divide-by-length — this gate LISTS every byte-cap `.length` comparison,
// cross-references scripts/utf16-byte-cap-triage.tsv, and (in --check) FAILS only on
// a site nobody has judged yet. Whether a given string can hold non-ASCII is a
// SEMANTIC, often NON-LOCAL question (is `body` a base64 blob or a JSON state
// string?), which a pure syntactic classifier can't answer without false-flagging.
//
// The ledger key is (file, normalized-snippet) — NOT file:line — so it survives
// edits that shift line numbers.
//
// USAGE
//   scripts/find-utf16-byte-cap.mjs              # table of every site + verdict
//   scripts/find-utf16-byte-cap.mjs --check      # exit 1 if any NEW (untriaged) site
//   scripts/find-utf16-byte-cap.mjs --self-test  # prove the scanner on fixtures
//   scripts/find-utf16-byte-cap.mjs --new        # list ONLY untriaged sites
//   scripts/find-utf16-byte-cap.mjs --dump-ledger # emit SAFE stub rows to seed the TSV
//
// OUTPUT (one line per site): <STATUS>  <file>:<line>  =>  <snippet>
//   STATUS = SAFE (ledger: judged a non-bug, with reason) | BUG (ledger: open)
//          | NEW (not in ledger — judge it, then add a row to the .tsv)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'utf16-byte-cap-triage.tsv');

// ── Source selection ── real authored source only. Skip tests, minified bundles,
// vendored assets, node_modules, and THIS file + its ledger (whose docstrings embed
// example `.length > MAX_BYTES` shapes).
const SCAN_DIRS = [
  'public', 'translation', 'hunter', 'mapkeys', 'eez', 'api', 'burma-script',
  'animatedcrazy', 'newpress-deck', 'pinglobe', 'zanyplans', 'scripts',
  'democracy', 'todo', 'queen-scarlet-school', 'commentbank', 'cutter',
  'research', 'borders', 'border-guesser', 'growth', 'views-growth',
  'night-market', 'hakka', 'bounce', 'prawn', 'flight', 'trippy', 'palau',
  'taiwan', 'modern-middle-east', 'fascism', 'flyingmoney', 'shared',
];
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-utf16-byte-cap\.mjs|utf16-byte-cap-triage\.tsv)/;

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

// ── The scanner ───────────────────────────────────────────────────────────────
// A byte-cap comparison is a `<`, `<=`, `>`, `>=` where EXACTLY ONE side ends in
// `.length` and the OTHER side names a byte budget. "Names a byte budget" =
//   • an identifier with BYTE(S) in it            (MAX_BYTES, WHISPER_MAX_BYTES…)
//   • a byte-size literal: N * 1024 [ * 1024 ]     (optionally with a * 1.x slack)
// We scan every comparison operator, grab a bounded clause each side, and keep the
// site iff one side is `…​.length` and the other is a byte budget. The byte cap may
// sit on either side (`x.length > MAX_BYTES` or `MAX_BYTES < x.length`).
const CMP = /(<=|>=|<|>)/g;
// A byte budget token on one side of the comparison.
const BYTES_IDENT = /[A-Za-z_$][\w$]*byte[\w$]*/i;      // MAX_BYTES, byteCap, sizeInBytes…
const BYTES_LITERAL = /\b\d+(?:\.\d+)?\s*\*\s*1024(?:\s*\*\s*1024)?(?:\s*\*\s*\d+(?:\.\d+)?)?/; // N*1024 [ *1024 ] [ *slack ]
const LEN_OPERAND = /\.length\s*$/;                     // this side ends in `.length`

// Grab the operand text immediately adjacent to a comparator, clamped at the
// nearest boundary so we don't swallow a whole line.
function leftOperand(src, opIdx) {
  let start = opIdx;
  for (let i = opIdx - 1; i >= 0 && opIdx - i < 80; i--) {
    const c = src[i];
    if (c === ';' || c === '{' || c === '}' || c === '\n' || c === '(' ||
        c === '&' || c === '|' || c === ',' || c === '?' || c === ':' ||
        c === '=' || c === '<' || c === '>') { start = i + 1; break; }
    start = i;
  }
  return { text: src.slice(start, opIdx), start };
}
function rightOperand(src, opEnd) {
  let end = opEnd;
  for (let i = opEnd; i < src.length && i - opEnd < 80; i++) {
    const c = src[i];
    if (c === ';' || c === '{' || c === '}' || c === '\n' || c === ')' ||
        c === '&' || c === '|' || c === ',' || c === '?' || c === ':') { end = i; break; }
    end = i + 1;
  }
  return { text: src.slice(opEnd, end), end };
}

function isByteBudget(s) {
  return BYTES_IDENT.test(s) || BYTES_LITERAL.test(s);
}
function isLengthOperand(s) {
  return LEN_OPERAND.test(s);
}

function scanSource(rawSrc) {
  const src = stripComments(rawSrc);
  const rows = [];
  CMP.lastIndex = 0;
  let m;
  while ((m = CMP.exec(src)) !== null) {
    const op = m[0];
    const opIdx = m.index;
    // Skip `<<`, `>>`, `<=`-inside, arrows `=>`, generics-ish `<T>` — require the
    // char before/after not be part of a compound operator we don't want.
    const prev = src[opIdx - 1];
    const nextAfter = src[opIdx + op.length];
    if (prev === '<' || prev === '>' || prev === '=') continue;      // <<, >>, ==, =>, <=/>= handled by CMP alt
    if ((op === '<' || op === '>') && (nextAfter === '<' || nextAfter === '>' || nextAfter === '=')) continue;
    const L = leftOperand(src, opIdx);
    const R = rightOperand(src, opIdx + op.length);
    const lenLeft = isLengthOperand(L.text.trimEnd());
    const lenRight = isLengthOperand(R.text.trimEnd());
    if (lenLeft === lenRight) continue;                              // need exactly one `.length` side
    const capSide = lenLeft ? R.text : L.text;
    if (!isByteBudget(capSide)) continue;
    // Build a readable snippet spanning both operands.
    const snippet = src.slice(L.start, R.end).replace(/\s+/g, ' ').trim();
    rows.push({ line: lineOf(src, opIdx), snippet, key: normalize(snippet) });
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
  // Flags the byte-cap-vs-.length comparison in both operand orders.
  expectSites('ident cap right', 'if (json.length > MAX_BYTES) reject();', ['json.length > MAX_BYTES']);
  expectSites('ident cap left', 'if (MAX_BYTES < s.length) reject();', ['MAX_BYTES < s.length']);
  expectSites('literal byte cap', 'if (blob.length > 256 * 1024) reject();', ['blob.length > 256 * 1024']);
  expectSites('mb literal', 'if (state.length >= 1024 * 1024) drop();', ['state.length >= 1024 * 1024']);
  expectSites('base64 slack still flags', 'if (dataBase64.length > MAX_REF_BYTES * 1.4) skip();', ['dataBase64.length > MAX_REF_BYTES * 1.4']);
  // Does NOT flag non-byte comparisons.
  expectSites('count cap', 'if (items.length > MAX_ITEMS) trim();', []);        // cap isn't byte-denominated
  expectSites('plain small literal', 'if (a.length > 10) go();', []);           // 10 is not a byte budget
  expectSites('both sides length', 'if (a.length > b.length) go();', []);       // no cap operand
  expectSites('byte var no length', 'if (mediaSizeBytes > MAX_BYTES) reject();', []); // neither side is `.length`
  expectSites('shift op', 'const x = n >> 1024 * 1024;', []);                   // `>>` not a comparison
  expectSites('comment', '// if (json.length > MAX_BYTES) reject()\nconst x=1;', []);

  // Multi-site + line numbers.
  const fixture = [
    'if (json.length > MAX_BYTES) a();',       // line 1 site
    'if (n.length > 5) b();',                  // line 2 NO (small literal)
    'if (blob.length >= 512 * 1024) c();',     // line 3 site
    'if (x > y) d();',                         // line 4 NO
  ].join('\n');
  const rows = scanSource(fixture);
  const okLines = JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([1, 3]);
  if (okLines) pass++;
  else { fail++; console.log(`  ✗ multi-site lines: got ${JSON.stringify(rows.map((r) => r.line))}, expected [1,3]`); }

  // Normalized key is whitespace-immune.
  const k1 = scanSource('if ( json.length  >  MAX_BYTES ) x();')[0].key;
  const k2 = scanSource('if(json.length>MAX_BYTES)x();')[0].key;
  if (k1 === k2) pass++;
  else { fail++; console.log(`  ✗ key not whitespace-immune: ${k1} !== ${k2}`); }

  // Live-repo invariant: the gate must currently classify ZERO sites as NEW or BUG.
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
    console.log(`✗ ${newSites.length} untriaged byte-cap site(s) — judge each (can the measured string hold NON-ASCII? if so it must use Buffer.byteLength / TextEncoder / *2, not .length), then add a row to scripts/utf16-byte-cap-triage.tsv:`);
    for (const s of newSites) console.log(`  NEW  ${s.rel}:${s.line}  =>  ${s.snippet}`);
    process.exit(1);
  }
  if (bugSites.length) {
    console.log(`✗ ${bugSites.length} open UTF-16 byte-cap BUG(s) in the ledger — fix (use real byte measure) or re-triage:`);
    for (const s of bugSites) console.log(`  BUG  ${s.rel}:${s.line}  =>  ${s.snippet}  (${s.reason})`);
    process.exit(1);
  }
  console.log(`✓ ${sites.length} byte-cap site(s), all triaged SAFE.`);
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
console.log('byte-cap .length sites  [SAFE=ledger-judged non-bug · BUG=open · NEW=untriaged]');
let nSafe = 0, nBug = 0, nNew = 0;
for (const s of sites) {
  if (s.status === 'SAFE') nSafe++;
  else if (s.status === 'BUG') nBug++;
  else nNew++;
  console.log(`  ${s.status.padEnd(4)}  ${s.rel}:${s.line}  =>  ${s.snippet}`);
}
console.log(`\n→ ${sites.length} site(s): ${nSafe} SAFE, ${nBug} BUG, ${nNew} NEW.`);
