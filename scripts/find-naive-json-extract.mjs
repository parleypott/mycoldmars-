#!/usr/bin/env bun
//
// find-naive-json-extract.mjs — flag any model-reply JSON extractor that locates
// a brace with `.indexOf('{')` / `.lastIndexOf('}')` (and friends) and then
// `JSON.parse`s the sliced-out substring WITHOUT a string-aware balanced walk.
//
// WHY THIS EXISTS
// The "naive brace matcher" is this loop's single most-repeated PROJECT bug class.
// The shape is always the same: an LLM reply is expected to be JSON, so the code
// grabs from the first `{` (or between first `{` and last `}`) and parses that:
//
//     const start = text.indexOf('{');
//     const parsed = JSON.parse(text.slice(start));        // ← naive
//
// It throws away the WHOLE reply the moment the JSON is wrapped in prose ("Sure!
// here you go: {…}"  or  "{…}\n\nHope that helps!") or a JSON *string value*
// contains a literal `{`/`}`/`[`/`]` (a transcript line like `"she said [inaudible"`,
// a soundbite `"the cost was high }"`). The naive `lastIndexOf('}')` over-grabs
// into a trailing aside; the naive first-`{`-to-end mis-slices; either way
// `JSON.parse` throws and the handler 502s or silently drops every result. This
// exact bug was hand-fixed in translation/src/api-client.js (extractJSON),
// translation/src/sot-hunter.js (parseHunterJSON), api/_lib/model-json.js
// (extractBalancedJSON), and api/qss-arc-extract.js (extractArc) — four divergent
// copies, all now consolidated onto a string-aware matcher. Nothing guards against
// a FIFTH hand-rolled copy landing in a new handler. This does.
//
// THE FIX EVERY SAFE SITE USES
// A string-aware balanced matcher: walk char-by-char from the first bracket,
// track whether you're inside a quoted string (`inStr`) and skip `\`-escaped
// chars, so only STRUCTURAL brackets move the depth counter. That single loop is
// the difference between SAFE and NAIVE, and it leaves a reliable fingerprint —
// an `inStr` / `inString` local — inside the function. So does delegating to one
// of the shared extractors (extractBalancedJSON / extractJSON / parseHunterJSON /
// parseModelObject) or the truncation-repair helper (balanceJson).
//
// HOW IT CLASSIFIES (structural, not semantic → a pure classifier, no ledger)
// Unlike the truthy-zero gate (where BUG-vs-SAFE is a semantic judgment), here the
// distinction is syntactic: a brace-locate-then-JSON.parse function is SAFE iff its
// body contains a string-aware walk or a shared-extractor call, NAIVE otherwise.
// So this gate self-classifies and asserts a clean baseline (0 NAIVE today).
//
// SCOPE MODEL — per FUNCTION BODY, not a fixed char window. The parse can sit far
// from the locator (api-client's string-walk pushes its JSON.parse ~26 lines past
// the indexOf), so a proximity window either misses real sites or bleeds into the
// next function. We split each file into function bodies via a brace-depth walk on
// the comment/string-blanked source, then ask, per body: does it locate a brace
// AND JSON.parse a slice? If so → classify by the string-aware fingerprint.
//
// IN SCOPE:   `.indexOf('{'|'['`)` / `.lastIndexOf('}'|']')` brace locators paired
//             with a `JSON.parse(` in the same function body.
// OUT OF SCOPE (documented, intentional): greedy-regex extraction
//             (`text.match(/\{[\s\S]*\}/)`) — a different shape; and pure field-
//             grabbers that never JSON.parse a slice (nano-banana grabField) — those
//             carry a brace `lastIndexOf` but no JSON.parse, so they're never a
//             candidate here.
//
// USAGE
//   scripts/find-naive-json-extract.mjs             # table of every extractor site
//   scripts/find-naive-json-extract.mjs --check     # exit 1 if any NAIVE site exists
//   scripts/find-naive-json-extract.mjs --self-test # prove the scanner on fixtures
//
// OUTPUT (one line per extractor function): <STATUS>  <file>:<line>  <fn>()  <marker>
//   STATUS = SAFE (string-aware / shared extractor) | NAIVE (raw brace slice → parse)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Source selection ── real authored source only. Skip tests, minified bundles,
// vendored assets, node_modules, and THIS file (its docstring embeds the shapes).
const EXT = /\.(js|mjs|ts|jsx|html)$/;
const SKIP = /(\.test\.|\.spec\.|\.min\.|node_modules|\/assets\/index-|\bdist\b|find-naive-json-extract\.mjs)/;

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
  walk(ROOT, out);
  return out.sort();
}

// ── Brace locators (scanned on RAW source — the quoted `{` survives) ────────────
const LOCATOR = /\.(?:indexOf|lastIndexOf)\(\s*['"][{}\[\]]['"]\s*\)/g;
// The string-aware fingerprint OR a delegation to a hardened shared extractor.
const SAFE_MARK = /\b(?:inStr|inString|in_str|extractBalancedJSON|extractJSON|parseHunterJSON|parseModelObject|balanceJson)\b/;

// ── Function-body splitting (on comment/string-blanked source) ──────────────────
// Match `function name(...) {`, `const name = (...) => {`, `const name = async x => {`.
// Blanked source guarantees every `{`/`}` we walk is STRUCTURAL (string/comment
// braces are spaces), so a plain depth counter finds the matching close exactly.
const FN_START = new RegExp(
  [
    // classic function declarations/expressions (named or anonymous)
    '(?:\\bexport\\s+)?(?:\\bdefault\\s+)?(?:\\basync\\s+)?function\\s*\\*?\\s*([A-Za-z0-9_$]*)\\s*\\([^()]*\\)\\s*\\{',
    // const/let/var arrow with a paren param list
    '(?:\\bexport\\s+)?(?:\\bconst|\\blet|\\bvar)\\s+([A-Za-z0-9_$]+)\\s*=\\s*(?:async\\s*)?\\([^()]*\\)\\s*=>\\s*\\{',
    // const/let/var arrow with a single bare param
    '(?:\\bexport\\s+)?(?:\\bconst|\\blet|\\bvar)\\s+([A-Za-z0-9_$]+)\\s*=\\s*(?:async\\s*)?[A-Za-z0-9_$]+\\s*=>\\s*\\{',
  ].join('|'),
  'g',
);

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

// Return [{name, open, close}] for every function body in `blanked`. `open` is the
// offset of the body's `{`, `close` the offset just past the matching `}`.
function functionBodies(blanked) {
  const bodies = [];
  FN_START.lastIndex = 0;
  let m;
  while ((m = FN_START.exec(blanked)) !== null) {
    const name = m[1] || m[2] || m[3] || '(anon)';
    const open = blanked.indexOf('{', m.index + m[0].length - 1);
    if (open < 0) continue;
    let depth = 0, close = -1;
    for (let i = open; i < blanked.length; i++) {
      const ch = blanked[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { close = i + 1; break; } }
    }
    if (close < 0) continue;
    bodies.push({ name, open, close });
    // Do NOT skip past the body — nested functions inside it should be captured
    // too, so an extractor in an inner callback is attributed to the tightest body.
  }
  return bodies;
}

// The innermost (smallest span) body containing `offset`, or null.
function innermostBody(bodies, offset) {
  let best = null;
  for (const b of bodies) {
    if (offset >= b.open && offset < b.close) {
      if (!best || (b.close - b.open) < (best.close - best.open)) best = b;
    }
  }
  return best;
}

// ── Scan one source → [{line, name, status, marker}] per extractor function ─────
function scanSource(rawSrc) {
  const blanked = stripComments(rawSrc);
  const bodies = functionBodies(blanked);

  // Group brace-locators by the function body that encloses them.
  const byBody = new Map(); // body(open) → {body, locators:[offset]}
  LOCATOR.lastIndex = 0;
  let m;
  while ((m = LOCATOR.exec(rawSrc)) !== null) {
    const body = innermostBody(bodies, m.index);
    const key = body ? body.open : `module`;
    if (!byBody.has(key)) byBody.set(key, { body, locators: [] });
    byBody.get(key).locators.push(m.index);
  }

  const rows = [];
  for (const { body, locators } of byBody.values()) {
    // The region we judge: the function body, or (module-scope fallback) a generous
    // forward window from the first locator so a top-level script extractor is not
    // silently skipped.
    // locators are pushed in ascending source order by the left-to-right regex
    // walk, so locators[0] is the earliest — no spread needed.
    const firstLocator = locators[0];
    let regionText, regionStart;
    if (body) { regionText = blanked.slice(body.open, body.close); regionStart = body.open; }
    else { regionStart = firstLocator; regionText = blanked.slice(regionStart, regionStart + 2500); }

    // A locator only counts as a JSON EXTRACTOR when the region also JSON.parses.
    // (grabField-style field-grabbers carry a brace lastIndexOf but never parse a
    // slice → not a candidate, correctly ignored.)
    if (!/\bJSON\.parse\s*\(/.test(regionText)) continue;

    const safe = SAFE_MARK.test(regionText);
    rows.push({
      line: lineOf(rawSrc, firstLocator),
      name: body ? body.name : '(module)',
      status: safe ? 'SAFE' : 'NAIVE',
      marker: safe ? (regionText.match(SAFE_MARK) || [''])[0] : 'raw brace slice → JSON.parse',
    });
  }
  return rows.sort((a, b) => a.line - b.line);
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  return scanSource(src).map((r) => ({ ...r, rel: relative(ROOT, path) }));
}

function allSites() {
  return sourceFiles().flatMap(scanFile);
}

// ── Self-test ───────────────────────────────────────────────────────────────────
function selfTest() {
  let pass = 0, fail = 0;
  const expect = (label, src, expected) => {
    const got = scanSource(src).map((r) => `${r.status}:${r.name}`);
    const eq = JSON.stringify(got) === JSON.stringify(expected);
    if (eq) pass++;
    else { fail++; console.log(`  ✗ ${label}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
  };

  // NAIVE: raw first-brace slice straight into JSON.parse, no string walk.
  expect('naive first-brace', `
    function extract(text) {
      const start = text.indexOf('{');
      return JSON.parse(text.slice(start));
    }`, ['NAIVE:extract']);

  // NAIVE: first-{ .. last-} slice, still no string awareness.
  expect('naive first-to-last', `
    function grab(t) {
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      return JSON.parse(t.slice(a, b + 1));
    }`, ['NAIVE:grab']);

  // SAFE: string-aware balanced walk in the same body (the canonical fix).
  expect('safe string-aware', `
    function extractJSON(text) {
      const start = text.indexOf('{');
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
      }
    }`, ['SAFE:extractJSON']);

  // SAFE: delegates to a shared hardened extractor (the naive slice is only a
  // fallback that the shared matcher then repairs — arc-extract's real shape).
  expect('safe delegation', `
    function extractArc(text) {
      const firstBrace = text.indexOf('{');
      const raw = text.slice(firstBrace);
      try { return JSON.parse(raw); }
      catch { return extractBalancedJSON(raw); }
    }`, ['SAFE:extractArc']);

  // NOT A CANDIDATE: brace lastIndexOf but no JSON.parse of a slice (field grabber).
  expect('field grabber ignored', `
    function grabField(objBody, key) {
      const closeIdx = objBody.lastIndexOf('}');
      return objBody.slice(0, closeIdx);
    }`, []);

  // NOT A CANDIDATE: a brace locator used for template detection, no parse.
  expect('template check ignored', `
    function hasBrace(s) {
      return s.indexOf('{') !== -1;
    }`, []);

  // Brace inside a STRING/comment must not create a phantom locator+parse pair.
  expect('string-literal brace ignored', `
    function noop(s) {
      const marker = "look a { brace";  // and a } here
      return marker.length;
    }`, []);

  // Two functions in one file, classified independently.
  expect('mixed file', `
    function bad(t) { return JSON.parse(t.slice(t.indexOf('{'))); }
    function good(t) {
      const start = t.indexOf('{');
      let inStr = false;
      return JSON.parse(t.slice(start));
    }`, ['NAIVE:bad', 'SAFE:good']);

  // Live-repo invariant: ZERO NAIVE sites today (the class is fully consolidated).
  const naive = allSites().filter((s) => s.status === 'NAIVE');
  if (naive.length === 0) pass++;
  else {
    fail++;
    console.log(`  ✗ live repo has ${naive.length} NAIVE site(s) — baseline not clean:`);
    for (const s of naive) console.log(`      NAIVE  ${s.rel}:${s.line}  ${s.name}()`);
  }

  console.log(`\nself-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

// ── Main ────────────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
if (args.has('--self-test')) process.exit(selfTest());

const sites = allSites().sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
const naive = sites.filter((s) => s.status === 'NAIVE');

if (args.has('--check')) {
  if (naive.length) {
    console.log(`✗ ${naive.length} naive brace-matcher JSON extractor(s) — route through the string-aware`);
    console.log(`  matcher (import extractBalancedJSON from api/_lib/model-json.js, or add an inStr walk):`);
    for (const s of naive) console.log(`  NAIVE  ${s.rel}:${s.line}  ${s.name}()`);
    process.exit(1);
  }
  console.log(`✓ 0 naive JSON extractors (${sites.length} extractor site(s), all string-aware)`);
  process.exit(0);
}

const order = { NAIVE: 0, SAFE: 1 };
sites.sort((a, b) => (order[a.status] - order[b.status]) || a.rel.localeCompare(b.rel) || a.line - b.line);
for (const s of sites) {
  console.log(`${s.status.padEnd(5)}  ${s.rel}:${s.line}  ${s.name}()  —  ${s.marker}`);
}
console.log(`\n${sites.length} extractor site(s): ${naive.length} NAIVE, ${sites.filter((s) => s.status === 'SAFE').length} SAFE`);
