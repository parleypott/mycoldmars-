#!/usr/bin/env bun
//
// find-attr-unsafe-escaper.mjs — guard a recurring LIVE-SECURITY class: an HTML
// escaper that entity-encodes `& < >` but NOT quotes, whose output is then
// interpolated straight into a QUOTED HTML ATTRIBUTE value (`foo="${esc(x)}"`).
//
// WHY THIS EXISTS — a class hand-fixed ≥4× with no standing watcher
// A `<`/`>`-only escaper is perfectly safe in TEXT content (`>${esc(x)}<`): the
// only chars that can start a tag are neutralised. But the SAME escaper is
// UNSAFE the moment its result lands inside a double- or single-quoted attribute:
// a `"` in the value closes the attribute early and lets the payload inject new
// attributes (`onerror=…`, `onmouseover=…`) — a stored/reflected XSS breakout
// that never touches a literal `<`. This loop has fixed exactly this several
// times, each a "divergent-WEAKER escaper" that omitted the quote mapping:
//   • The Hunter — hunter/src/main.js escHtml escaped `&<>` but not quotes, used
//     in title=/data- attributes (consolidated onto the quote-safe shared copy).
//   • Interpreter — main.js + dialogs.js local escapers migrated to the shared,
//     quote-safe escaper.
//   • research/app.js — a dead quote-unsafe escapeHtml deleted.
// The fix every time: make the escaper quote-safe (add `"`→`&quot;`, `'`→`&#39;`)
// or route the attribute through a dedicated quote-escaping helper. Nothing
// structurally stops the next hand-rolled `s.replace(/</g,'&lt;')` from being
// dropped into an attribute — a happy-path test with no quote in the data passes,
// and the breakout ships silent. This gate is that watcher.
//
// WHAT IT FLAGS  (a site is flagged iff BOTH, within a single file):
//   1. a locally-defined QUOTE-UNSAFE HTML escaper, recognised in EITHER form:
//      (a) CHAR-MAP form — its body maps `<`→`&lt;` (the HTML-escape signature)
//          but contains NO `"`→`&quot;`/`&#34;`/`&#x22;` mapping; OR
//      (b) DOM ROUND-TRIP form — it sets an element's `.textContent` (or appends
//          a `createTextNode`) and then `return`s that element's `.innerHTML`.
//          This idiom escapes ONLY `& < >` — the HTML spec never quote-escapes a
//          text node's serialization — so it is ALWAYS quote-unsafe, yet carries
//          no literal `&lt;` in its source, so form (a) is blind to it; AND
//   2. a use of that escaper INSIDE a quoted attribute value in a template
//      literal — `<tag attr="…${NAME(…)}…">` or the single-quoted form.
// A quote-SAFE escaper (one that maps `"`) is never flagged, no matter where it
// is used. A quote-UNSAFE escaper used only in TEXT position (`>${NAME(x)}<`)
// is never flagged — that placement is safe, so there is nothing to fix. Only
// the dangerous COMBINATION trips.
//
// The DOM-round-trip coverage was added 2026-07-04 after a REAL breakout shipped
// past the char-map-only gate: translation/src/main.js `esc()` escaped via a
// `textContent`→`innerHTML` round-trip (quotes pass through raw) and fed ~40
// double-quoted attribute contexts. It was invisible to form (a) because its
// body has no `&lt;`. Closing that blind spot is this edit.
//
// WHY IT STARTS GREEN (re-verified 2026-07-04, incl. DOM idiom): every escaper in
// the repo that is used in an attribute context is already quote-safe (commentbank
// escapeHtml/escapeAttr, the QSS escHtml/esc copies, translation escHtml +the now-
// fixed esc.js which delegates to the shared quote-safe escapeHtml, research/clarify
// escAttr — all map `"`). The remaining `<`/`>`-only escapers (cutter `esc`,
// research/md.js `esc`, the XML element-text escapers) are used ONLY in text /
// non-attribute positions, so none are flagged. No live DOM-round-trip escaper is
// interpolated into an attribute. `--check` trips red the moment a NEW quote-unsafe
// escaper of EITHER form is dropped into an attribute.
//
// SCOPE / LIMITATION: classification is FILE-LOCAL — the escaper def and its
// attribute use must be in the same file. Every historical bug was file-local
// (inline copies), so this catches the real class; a cross-file imported unsafe
// escaper is out of scope (and rare — shared escapers are the quote-safe ones).
//
// USAGE
//   scripts/find-attr-unsafe-escaper.mjs             # table of flagged sites (+ escaper inventory with -v)
//   scripts/find-attr-unsafe-escaper.mjs --check     # exit 1 if any flagged site
//   scripts/find-attr-unsafe-escaper.mjs --self-test # prove the classifier on fixtures (mutation proof)
//
// OUTPUT (one line per flagged site): FLAG  <file>:<line>  attr="${<escaper>(…)}"  (escaper is quote-unsafe)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `scripts` is build-time tooling (this scanner + its sibling gates), never
// rendered to a browser — and these gate files carry fixture strings that mimic
// the very shape we hunt, so scanning them would self-trip. The attribute-XSS
// class only matters for shipped web code, so tooling is correctly out of scope.
const SKIP_DIR = /^(node_modules|\.git|dist|build|coverage|\.next|\.vercel|scripts)$/;
const SRC_EXT = /\.(js|mjs|jsx|html)$/;
const SKIP_FILE = /\.min\.|[.-](test|spec)\.|\.test\.|fixture/;

// ── the escape signature ──
// An HTML escaper's body maps `<` to its entity. We accept either the char-class
// form (`.replace(/[&<>"']/g, …)` with a `'<':'&lt;'` map) or the chained form
// (`.replace(/</g, '&lt;')`). Both leave the literal `&lt;` in the source.
const HTML_ESCAPE_SIG = /&lt;/;
// Quote-safe iff the body ALSO neutralises the double quote in some form.
const QUOTE_SAFE_SIG = /&quot;|&#0*34;|&#x0*22;/i;

// ── the DOM round-trip escape signature ──
// The other way people hand-roll an escaper: set an element's text, read its HTML
// back. `el.textContent = str; return el.innerHTML;` (or the createTextNode/
// appendChild variant). The browser serializes a TEXT node escaping only `& < >`
// — never `"`/`'` (quote-escaping happens only when serializing an ATTRIBUTE
// value, which this path never does) — so the result is ALWAYS quote-unsafe.
// Signature: a `.textContent =` assignment (or `createTextNode(`) that is FOLLOWED
// by a `return … .innerHTML`. Requiring the return-of-innerHTML (not a bare
// `.innerHTML` read) excludes render helpers that merely set `.innerHTML` on some
// node as a side effect — those don't produce an escaped string and are never
// interpolated into an attribute. There is no quote-safe variant of this idiom, so
// a match is unconditionally unsafe.
function domRoundTripUnsafe(body) {
  const setText = body.search(/\.textContent\s*=|createTextNode\s*\(/);
  if (setText === -1) return false;
  return /return[^{};]*\.innerHTML/.test(body.slice(setText));
}

// Isolate a function's OWN body from the def site — critical so the quote-safe
// classification never bleeds into a NEIGHBORING function (e.g. a syntax
// highlighter two lines down that happens to mention `&quot;`, which would
// mask a genuinely quote-unsafe escaper). Two shapes:
//   • brace body `function f(){ … }` / `s => { … }` — brace-match from the first
//     `{` that opens the body (a `{` that comes before the statement's `;`);
//   • arrow-EXPRESSION body `const f = s => String(s).replace(…);` — no opening
//     brace before the `;`, so the body is the statement up to that `;`. (A map
//     object `{'&':'&amp;',…}` inside a `.replace` is itself brace-balanced, so
//     brace-matching it still captures the full entity map.)
function bodyOf(src, start) {
  const openIdx = src.indexOf('{', start);
  let semiIdx = src.indexOf(';', start);
  if (semiIdx === -1) semiIdx = src.length;
  if (openIdx === -1 || semiIdx < openIdx) {
    // arrow-expression body: up to the terminating `;` (cap for safety)
    return src.slice(start, Math.min(semiIdx + 1, start + 1000));
  }
  let depth = 0;
  let i = openIdx;
  for (; i < src.length && i < start + 4000; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Pull the escaper functions defined in a source and classify each quote-safe.
// Returns Map<name, { safe:boolean, defLine:number }>.
function findEscapers(src) {
  const out = new Map();
  const DEF = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g;
  let m;
  while ((m = DEF.exec(src))) {
    const name = m[1] || m[2];
    if (!name) continue;
    const body = bodyOf(src, m.index);
    const charMap = HTML_ESCAPE_SIG.test(body);
    const domTrip = domRoundTripUnsafe(body);
    if (!charMap && !domTrip) continue; // not an HTML escaper
    // First definition wins; a real escaper is defined once per file.
    if (!out.has(name)) {
      // char-map form may be quote-safe; the DOM round-trip never is.
      const safe = charMap ? QUOTE_SAFE_SIG.test(body) : false;
      out.set(name, { safe, defLine: lineAt(src, m.index) });
    }
  }
  return out;
}

// Escape a name for use inside a RegExp (identifiers are safe, but be exact).
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Find attribute-context uses of a given escaper name: `attr="…${ NAME( …}…"` or
// the single-quoted form. The prefix `[^"'}$]*` lets the interpolation sit after
// literal attribute text (`class="foo ${NAME(x)}"`) while staying inside the one
// quoted value (it can't cross the closing quote, a `}`, or the `$` of `${`).
function attrUses(src, name) {
  const re = new RegExp('=(["\'])[^"\'}$]*\\$\\{[^}]*\\b' + rx(name) + '\\s*\\(', 'g');
  const hits = [];
  let m;
  while ((m = re.exec(src))) hits.push(lineAt(src, m.index));
  return hits;
}

function lineAt(src, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++;
  return n;
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return []; }
  const escapers = findEscapers(src);
  const flags = [];
  for (const [name, info] of escapers) {
    if (info.safe) continue; // quote-safe escaper — safe anywhere
    for (const line of attrUses(src, name)) {
      flags.push({ path, line, name });
    }
  }
  return flags;
}

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIR.test(name)) walk(full, acc); }
    else if (SRC_EXT.test(name) && !SKIP_FILE.test(name)) acc.push(full);
  }
  return acc;
}

function scanRepo() {
  const flags = [];
  for (const f of walk(ROOT, [])) flags.push(...scanFile(f));
  return flags;
}

// ---- self-test: the mutation proof. A quote-unsafe escaper used in an
// attribute MUST flag; the same escaper in text position, and a quote-SAFE
// escaper in an attribute, MUST NOT.
function selfTest() {
  const UNSAFE_DEF = `function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}`;
  const SAFE_DEF = `function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`;
  // DOM round-trip escaper — the exact shape of the shipped translation esc() bug.
  const DOM_DEF = `function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}`;
  // createTextNode variant of the same idiom.
  const DOM_CTN_DEF = `function esc(s){const d=document.createElement('span');d.appendChild(document.createTextNode(String(s)));return d.innerHTML;}`;
  // A render helper that SETS innerHTML as a side effect (no return of it) — must
  // NOT be mistaken for an escaper even though textContent + innerHTML co-occur.
  const RENDER_DEF = `function paint(s){count.textContent=s.length;host.innerHTML='<b>'+s.length+'</b>';}`;
  const fixtures = [
    // [label, source, shouldFlag]
    ['unsafe escaper in double-quoted attr', `${UNSAFE_DEF}\nconst h=\`<a title="\${esc(x)}">\`;`, true],
    ['unsafe escaper in single-quoted attr', `${UNSAFE_DEF}\nconst h=\`<img alt='\${esc(x)}'>\`;`, true],
    ['unsafe escaper after literal attr text', `${UNSAFE_DEF}\nconst h=\`<div class="c \${esc(x)}">\`;`, true],
    ['unsafe escaper in TEXT position only', `${UNSAFE_DEF}\nconst h=\`<a>\${esc(x)}</a>\`;`, false],
    ['SAFE escaper in attr (has &quot;)', `${SAFE_DEF}\nconst h=\`<a title="\${esc(x)}">\`;`, false],
    ['non-escaper fn in attr', `function fmt(s){return String(s).toUpperCase();}\nconst h=\`<a title="\${fmt(x)}">\`;`, false],
    ['unsafe escaper, no use at all', `${UNSAFE_DEF}\nconst y=1;`, false],
    // DOM round-trip coverage (the iter-#13 blind spot):
    ['DOM round-trip escaper in double-quoted attr', `${DOM_DEF}\nconst h=\`<a title="\${esc(x)}">\`;`, true],
    ['DOM createTextNode escaper in attr', `${DOM_CTN_DEF}\nconst h=\`<a title="\${esc(x)}">\`;`, true],
    ['DOM round-trip escaper in TEXT position only', `${DOM_DEF}\nconst h=\`<a>\${esc(x)}</a>\`;`, false],
    ['render helper (sets innerHTML, no return) in attr', `${RENDER_DEF}\nconst h=\`<a title="\${paint(x)}">\`;`, false],
  ];
  let pass = 0;
  for (const [label, src, want] of fixtures) {
    const got = scanFile.__test ? scanFile.__test(src) : (() => {
      const escapers = findEscapers(src);
      const flags = [];
      for (const [name, info] of escapers) {
        if (info.safe) continue;
        for (const line of attrUses(src, name)) flags.push({ line, name });
      }
      return flags;
    })();
    const flagged = got.length > 0;
    const ok = flagged === want;
    if (ok) pass++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}  (flagged=${flagged}, want=${want})`);
  }
  console.log(`\nself-test: ${pass}/${fixtures.length} ${pass === fixtures.length ? 'PASS' : 'FAIL'}`);
  return pass === fixtures.length;
}

const arg = process.argv[2];
if (arg === '--self-test') {
  process.exit(selfTest() ? 0 : 1);
}

const flags = scanRepo();
if (arg === '--check') {
  if (flags.length) {
    console.error(`find-attr-unsafe-escaper: ${flags.length} quote-unsafe escaper(s) used in an attribute context:\n`);
    for (const f of flags) console.error(`  FLAG  ${relative(ROOT, f.path)}:${f.line}  (escaper "${f.name}" is quote-unsafe)`);
    console.error(`\nFix: make the escaper quote-safe (add "→&quot; and '→&#39;) or route the attribute through a quote-escaping helper.`);
    process.exit(1);
  }
  console.log('find-attr-unsafe-escaper: clean — no quote-unsafe escaper used in an attribute context.');
  process.exit(0);
}

// default: human table
if (!flags.length) {
  console.log('No quote-unsafe escaper is used in an attribute context. (clean)');
} else {
  for (const f of flags) console.log(`FLAG  ${relative(ROOT, f.path)}:${f.line}  attr="…\${${f.name}(…)}…"  (${f.name} is quote-unsafe)`);
}
