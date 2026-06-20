// commentbank-core.test.mjs
//
// First coverage for The Commentbank (commentbank/index.html, live + in vite.config.js, ZERO
// coverage) — Johnny's real YouTube-comment tool: browse/filter the comment corpus, then "stylize"
// a comment into a branded YouTube-comment HTML embed he COPIES into videos/decks. Locks the four
// load-bearing, self-contained PURE cores:
//
//   - avatarForHandle(handle)  — the deterministic letter-avatar: maps a commenter handle to a
//                                STABLE {bg,fg,letter}. Same handle MUST always get the same color
//                                (a re-render can't reshuffle a commenter's avatar), the index must
//                                stay in-palette for ANY handle (the Math.abs guard — same class as
//                                the border-guesser daily-index abs guard), and the letter is the
//                                first non-@ char uppercased. Stable-color contract, same family as
//                                the workshop themeColor lock.
//   - escapeHtml(s)            — the XSS escaper for every text interpolation in the embed markup
//                                (handle, time) Johnny copies out. THE security boundary.
//   - escapeAttr(s)            — the XSS escaper for attribute values (avatar url, sentiment, id).
//   - syntaxHighlight(code)    — colorizes the generated embed-code preview; rides on escapeHtml
//                                running FIRST, so a hostile comment can't inject a live tag into
//                                the code block. Locks that escape-first invariant.
//
// No live bug found — all four are correct — so this is a verifier-layer LOCK (same standard as the
// workshop-format / westchester-geo / border-guesser locks), NOT a fix. The functions + HSL_PALETTE
// are EXTRACTED from the shipped index.html at runtime (quote-aware brace match + new Function) — no
// hand-copied mirror, so the lock can't drift from the live tool. Mutation-proven: real source
// mutations of index.html each go RED, restore -> GREEN byte-identical.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- balanced-delimiter matcher, aware of strings, comments, AND regex literals (these functions
//     contain a regex like /[&<>"']/ whose quote chars would fool a naive string-only matcher) ---
function sliceBalanced(src, fromIdx, open, close) {
  let depth = 0, i = fromIdx;
  const isRegexStart = (j) => {
    // a `/` is a regex (not division) if the previous significant char permits an expression
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    return k < 0 || '(,=:[!&|?{};+-*%~^<>'.includes(src[k]) || /[a-z]/.test(src[k]) === false;
  };
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { // string literal
      const q = c; i++;
      for (; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) break; }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === '/' && isRegexStart(i)) { // regex literal — skip to the closing unescaped /, respecting [...] classes
      i++; let inClass = false;
      for (; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
      }
      continue;
    }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  throw new Error('unbalanced');
}

function extractArray(name) {
  const m = HTML.match(new RegExp(`const\\s+${name}\\s*=\\s*`));
  if (!m) throw new Error(`array ${name} not found`);
  const at = HTML.indexOf('[', m.index + m[0].length);
  return new Function(`return (${sliceBalanced(HTML, at, '[', ']')});`)();
}

function extractFnSource(name) {
  const m = HTML.match(new RegExp(`function\\s+${name}\\s*\\(`));
  if (!m) throw new Error(`function ${name} not found`);
  const braceAt = HTML.indexOf('{', m.index);
  const body = sliceBalanced(HTML, braceAt, '{', '}');
  return `function ${name}${HTML.slice(m.index + `function ${name}`.length, braceAt)}${body}`;
}

// === extract the real shipped data + functions ===
const HSL_PALETTE = extractArray('HSL_PALETTE');

const escapeHtml = new Function(`${extractFnSource('escapeHtml')}\nreturn escapeHtml;`)();
const escapeAttr = new Function(`${extractFnSource('escapeAttr')}\nreturn escapeAttr;`)();
// avatarForHandle closes over HSL_PALETTE — inject it.
const avatarForHandle = new Function('HSL_PALETTE',
  `${extractFnSource('avatarForHandle')}\nreturn avatarForHandle;`)(HSL_PALETTE);
// syntaxHighlight closes over escapeHtml — provide it.
const syntaxHighlight = new Function('escapeHtml',
  `${extractFnSource('syntaxHighlight')}\nreturn syntaxHighlight;`)(escapeHtml);

// sanity on the extraction itself
ok(Array.isArray(HSL_PALETTE) && HSL_PALETTE.length === 12, `extracted HSL_PALETTE (${HSL_PALETTE.length} entries)`);
ok(typeof avatarForHandle === 'function' && typeof escapeHtml === 'function'
   && typeof escapeAttr === 'function' && typeof syntaxHighlight === 'function', 'extracted functions callable');
const PALETTE_BGS = new Set(HSL_PALETTE.map(p => p[0]));
const PALETTE_FGS = new Set(HSL_PALETTE.map(p => p[1]));

// ============================================================================================
// RED PROOFS — reconstruct broken variants and assert they violate contracts the real code holds
// ============================================================================================
// (1) an avatarForHandle WITHOUT Math.abs throws / mis-indexes on a negative-hash handle. 'commenter'
//     hashes to a negative int32, so a raw `hash % len` yields a NEGATIVE index -> HSL_PALETTE[-8] is
//     undefined -> reading .bg throws. The real (abs-guarded) fn returns a valid in-palette color.
const noAbsAvatar = (handle) => {
  const h = (handle || '?').replace(/^@/, '');
  let hash = 0;
  for (const ch of h) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const idx = hash % HSL_PALETTE.length; // bug: no Math.abs -> can be negative
  return { bg: HSL_PALETTE[idx][0], fg: HSL_PALETTE[idx][1], letter: h[0]?.toUpperCase() || '?' };
};
let noAbsThrew = false;
try { noAbsAvatar('commenter'); } catch { noAbsThrew = true; }
ok(noAbsThrew, "RED-proof: a Math.abs-less avatarForHandle throws on a negative-hash handle ('commenter')");
ok(PALETTE_BGS.has(avatarForHandle('commenter').bg),
   'real avatarForHandle returns an in-palette color for the negative-hash handle');

// (2) an escapeHtml that drops the double-quote leaves an attribute-breakout quote intact.
const noQuoteEscape = (s) => (s || '').replace(/[&<>']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;' }[m]));
ok(noQuoteEscape('a"b').includes('"') && !escapeHtml('a"b').includes('"'),
   'RED-proof: dropping the " from escapeHtml leaves a raw attribute-breakout quote');

// (3) a syntaxHighlight that skips escapeHtml lets a raw <script> survive into the code block.
const noEscapeHighlight = (code) => code
  .replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="tag">$2</span>');
ok(noEscapeHighlight('<script>x</script>').includes('<script')
   && !syntaxHighlight('<script>x</script>').includes('<script'),
   'RED-proof: a syntaxHighlight that skips escapeHtml lets a raw <script> through');

// ============================================================================================
// avatarForHandle — the stable-color contract
// ============================================================================================
// determinism: same handle -> identical avatar, every call
{
  const a = avatarForHandle('@johnny');
  const b = avatarForHandle('@johnny');
  eq(a.bg, b.bg, 'same handle -> same bg (deterministic)');
  eq(a.fg, b.fg, 'same handle -> same fg');
  eq(a.letter, b.letter, 'same handle -> same letter');
}
// @ is stripped before hashing AND before the letter: '@foo' === 'foo'
{
  const at = avatarForHandle('@foo');
  const bare = avatarForHandle('foo');
  eq(at.bg, bare.bg, '@-prefixed handle hashes the same as the bare handle');
  eq(at.letter, 'F', "letter is the first non-@ char, uppercased ('@foo' -> 'F')");
}
// color is ALWAYS in the palette + fg pairs with its bg, for a wide range of handles incl. adversarial
for (const h of ['a', 'Z', '@x', 'commenter', 'youtube_fan', 'critic', '日本語ユーザー',
                 '🔥fire🔥', 'A'.repeat(500), '___', '12345', 'MixedCase']) {
  const av = avatarForHandle(h);
  ok(PALETTE_BGS.has(av.bg), `avatarForHandle(${JSON.stringify(h.slice(0, 12))}) bg is in the palette`);
  ok(PALETTE_FGS.has(av.fg), `avatarForHandle(${JSON.stringify(h.slice(0, 12))}) fg is in the palette`);
  // index is a valid integer in [0, len) — the Math.abs guard means it's never negative/NaN
  const pairIdx = HSL_PALETTE.findIndex(p => p[0] === av.bg && p[1] === av.fg);
  ok(pairIdx >= 0, `avatarForHandle(${JSON.stringify(h.slice(0, 12))}) returns a real {bg,fg} PAIR from the palette`);
}
// letter cases
eq(avatarForHandle('alice').letter, 'A', 'letter uppercases a lowercase first char');
eq(avatarForHandle('').letter, '?', "empty handle -> '?' letter (handle||'?' guard)");
eq(avatarForHandle(null).letter, '?', "null handle -> '?' letter");
eq(avatarForHandle(undefined).letter, '?', "undefined handle -> '?' letter");
eq(avatarForHandle('@').letter, '?', "'@' alone strips to '' -> '?' letter (no crash on h[0])");
ok(PALETTE_BGS.has(avatarForHandle('@').bg), "'@' alone still yields an in-palette color (no throw)");
eq(avatarForHandle('7eleven').letter, '7', 'a leading digit is kept as the letter');
// distinctness — not every handle collapses to one color (the hash actually spreads)
{
  const colors = new Set(['alex', 'mara', 'zoe', 'sam', 'commenter', 'critic'].map(h => avatarForHandle(h).bg));
  ok(colors.size >= 3, `distinct handles spread across the palette (got ${colors.size} distinct bgs)`);
}

// ============================================================================================
// escapeHtml — the XSS boundary for text interpolations
// ============================================================================================
eq(escapeHtml('&'), '&amp;', 'ampersand -> &amp;');
eq(escapeHtml('<'), '&lt;', 'lt -> &lt;');
eq(escapeHtml('>'), '&gt;', 'gt -> &gt;');
eq(escapeHtml('"'), '&quot;', 'double quote -> &quot;');
eq(escapeHtml("'"), '&#39;', 'single quote -> &#39;');
eq(escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d', 'mixed entities all escaped');
// per-char replace -> a literal & becomes &amp; once; the emitted &amp; is NOT re-scanned
eq(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry', 'no double-escape of the ampersand');
// the canonical XSS payload is neutralized: no raw < and the attribute-breakout quote is gone
{
  const out = escapeHtml('<script>alert("x")</script>');
  ok(!out.includes('<script'), 'escapeHtml neutralizes <script> (no raw <)');
  ok(!out.includes('"'), 'escapeHtml removes the attribute-breakout quote');
}
eq(escapeHtml(''), '', 'empty string -> empty');
eq(escapeHtml(null), '', 'null -> empty (s||"" guard)');
eq(escapeHtml(undefined), '', 'undefined -> empty');
eq(escapeHtml('plain text'), 'plain text', 'safe text passes through unchanged');

// ============================================================================================
// escapeAttr — the XSS boundary for attribute values
// ============================================================================================
eq(escapeAttr('&'), '&amp;', 'attr: ampersand -> &amp;');
eq(escapeAttr('"'), '&quot;', 'attr: double quote -> &quot; (attribute-breakout guard)');
eq(escapeAttr("'"), '&#39;', 'attr: single quote -> &#39;');
eq(escapeAttr('<'), '&lt;', 'attr: lt -> &lt;');
eq(escapeAttr('>'), '&gt;', 'attr: gt -> &gt;');
// the attribute-breakout attack: a url value can't escape a double-quoted attr
{
  const evil = 'x" onerror="alert(1)';
  const out = escapeAttr(evil);
  ok(!out.includes('"'), 'escapeAttr defangs the attribute-breakout quote');
  ok(out.includes('&quot;'), 'escapeAttr encodes the quote as &quot;');
}
eq(escapeAttr(null), '', 'attr: null -> empty');
eq(escapeAttr(''), '', 'attr: empty -> empty');

// ============================================================================================
// syntaxHighlight — colorizes the embed-code preview; the escape-FIRST security invariant
// ============================================================================================
// a hostile comment baked into the code can't inject a live tag (escapeHtml runs first)
{
  const out = syntaxHighlight('<img src=x onerror=alert(1)>');
  ok(!out.includes('<img'), 'syntaxHighlight escapes a hostile <img> (no raw <img)');
  ok(out.includes('&lt;'), 'syntaxHighlight escapes the < to &lt; before highlighting');
}
{
  const out = syntaxHighlight('<script>alert(1)</script>');
  ok(!out.includes('<script'), 'syntaxHighlight escapes <script> (no live script tag)');
}
// the only raw '<' in the output are the highlighter's own <span ...> wrappers
{
  const out = syntaxHighlight('<p class="x">hi</p>');
  const rawLt = out.match(/<(?!\/?span\b)/g) || [];
  eq(rawLt.length, 0, 'every raw < in the output belongs to a <span> wrapper (user < all escaped)');
  ok(out.includes('<span class="tag">p</span>') || out.includes('class="tag">p<'),
     'a tag name is wrapped in a .tag span');
}
// highlights an attribute name=value pair
ok(syntaxHighlight('<a href="u">').includes('class="attr"'), 'an attribute name gets a .attr span');
// a <mark> highlight is wrapped (the one allowed rich tag)
ok(syntaxHighlight('<mark>x</mark>').includes('class="mark"'), 'a <mark> pair gets a .mark span wrapper');
// plain prose with no markup is just escaped, unchanged otherwise
eq(syntaxHighlight('just words'), 'just words', 'plain prose passes through (escaped, no spans)');

// ============================================================================================
console.log(`commentbank-core: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
