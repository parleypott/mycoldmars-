// Verifier-layer LOCK for the Burma Essays PWA reader-body renderer.
//
// markup(body, quotes) is the function that builds the reader body innerHTML on
// EVERY essay open: `rb.innerHTML = markup(current.body, highlights.map(h=>h.quote))`.
// It is therefore the PRIMARY XSS-escaping boundary for the essay body (server
// content) + the saved-highlight quotes, AND the range-merge logic that wraps each
// non-overlapping highlight in <mark>. Both esc() (the &<>" entity escaper) and
// markup() were ZERO-coverage. No live bug — esc covers the text-content context
// (no dynamic attributes are built in markup), the range merge is correct, and
// out-of-order discovery is fixed by the sort — so this is a LOCK, not a fix.
//
// The test EXTRACTS the REAL shipped esc + markup from index.html at runtime
// (brace-matched + new Function), so it can never drift from a mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// --- extract a `function NAME(...) { ... }` block by brace-matching from its start ---
function extractFn(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`could not find ${decl}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const escSrc = extractFn(html, 'function esc(');
const markupSrc = extractFn(html, 'function markup(');

// Build markup with the REAL esc in scope (markup references esc).
function buildMarkup(escSource = escSrc, markupSource = markupSrc) {
  // eslint-disable-next-line no-new-func
  return new Function(`${escSource}\n${markupSource}\nreturn markup;`)();
}
const markup = buildMarkup();
const esc = new Function(`${escSrc}\nreturn esc;`)();

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ============================================================
// INLINE RED PROOFS — reconstruct broken variants, show they fail
// ============================================================

// RED proof A: an esc that does NOT escape `<` leaks a live tag through markup.
t('RED PROOF: an unescaped-< esc leaks a live <script> tag (the XSS the lock guards)', () => {
  const badEscSrc = `function esc(s){ return (s||''); }`; // no escaping at all
  const badMarkup = buildMarkup(badEscSrc, markupSrc);
  const evil = 'hello <script>alert(1)</script> world';
  const leaked = badMarkup(evil, []);
  assert.ok(leaked.includes('<script>'), 'precondition: the no-escape variant leaks <script>');
  // The REAL shipped markup neutralizes it.
  const safe = markup(evil, []);
  assert.ok(!safe.includes('<script>'), 'shipped markup must neutralize <script>');
  assert.ok(safe.includes('&lt;script&gt;'), 'shipped markup must entity-escape the tag');
});

// RED proof B: a stitch that drops esc on the <mark> body would render a quote raw.
t('RED PROOF: dropping esc on the marked slice would render a quote raw', () => {
  const body = 'see <b>bold</b> here';
  // Real markup escapes the marked region too.
  const out = markup(body, ['<b>bold</b>']);
  assert.ok(!out.includes('<b>'), 'a hostile quote inside <mark> must be escaped');
  assert.ok(out.includes('<mark>&lt;b&gt;bold&lt;/b&gt;</mark>'), 'marked region entity-escaped');
});

// ============================================================
// esc unit lock
// ============================================================
t('esc: escapes & < > " (text-content set)', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('<x>'), '&lt;x&gt;');
  assert.equal(esc('say "hi"'), 'say &quot;hi&quot;');
});
t('esc: escapes the single quote (harmonized with every other repo escaper)', () => {
  // esc now escapes ' as well. markup() uses text context (where ' is harmless),
  // but the switcher feeds esc(e.id) into a data-id attribute, so the full
  // [&<>"'] set is the contract — no escaper in the repo may be weaker.
  assert.equal(esc("it's"), 'it&#39;s');
});
t('esc: null/undefined/empty -> empty string, no throw', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(''), '');
});
t('esc: ampersand escaped (no double-escape concern — single pass)', () => {
  assert.equal(esc('&amp;'), '&amp;amp;'); // already-escaped text is re-escaped (expected, single pass)
});

// ============================================================
// markup — no-highlights path (the always-called reader-body render)
// ============================================================
t('markup: empty quotes -> whole body escaped, no <mark>', () => {
  const out = markup('plain & <safe> body', []);
  assert.equal(out, 'plain &amp; &lt;safe&gt; body');
  assert.ok(!out.includes('<mark>'));
});
t('markup: empty body + empty quotes -> empty string', () => {
  assert.equal(markup('', []), '');
});
t('markup: hostile body, no quotes -> fully neutralized', () => {
  const out = markup('<img src=x onerror=alert(1)>', []);
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img'));
});

// ============================================================
// markup — single-highlight path
// ============================================================
t('markup: a found quote is wrapped in <mark>, surroundings escaped', () => {
  const out = markup('the quick brown fox', ['quick brown']);
  assert.equal(out, 'the <mark>quick brown</mark> fox');
});
t('markup: quote at start of body', () => {
  assert.equal(markup('hello world', ['hello']), '<mark>hello</mark> world');
});
t('markup: quote at end of body', () => {
  assert.equal(markup('hello world', ['world']), 'hello <mark>world</mark>');
});
t('markup: whole body is the quote', () => {
  assert.equal(markup('all of it', ['all of it']), '<mark>all of it</mark>');
});
t('markup: quote not present -> body escaped, no mark', () => {
  assert.equal(markup('nothing here', ['absent']), 'nothing here');
});

// ============================================================
// markup — multi-highlight + ordering + overlap
// ============================================================
t('markup: two non-adjacent quotes both marked, in document order', () => {
  const out = markup('alpha beta gamma', ['alpha', 'gamma']);
  assert.equal(out, '<mark>alpha</mark> beta <mark>gamma</mark>');
});
t('markup: out-of-order discovery is fixed by the sort', () => {
  // quote order [gamma, alpha] but document order alpha < gamma
  const out = markup('alpha beta gamma', ['gamma', 'alpha']);
  assert.equal(out, '<mark>alpha</mark> beta <mark>gamma</mark>');
});
t('markup: overlapping quotes — first-claimed wins, the overlapper is dropped', () => {
  // "the cat" claims [0,7]; "cat sat" overlaps at its only occurrence -> dropped
  const out = markup('the cat sat', ['the cat', 'cat sat']);
  assert.equal(out, '<mark>the cat</mark> sat');
});
t('markup: a quote appears twice — only the first non-overlapping instance marked', () => {
  const out = markup('cat and cat', ['cat']);
  assert.equal(out, '<mark>cat</mark> and cat');
});
t('markup: second quote finds its non-overlapping later occurrence', () => {
  // "cat" claims [0,3]; "cat" again can't (overlap on first), but a DIFFERENT quote
  // "and cat" matches [4,11] cleanly.
  const out = markup('cat and cat', ['cat', 'and cat']);
  assert.equal(out, '<mark>cat</mark> <mark>and cat</mark>');
});
t('markup: falsy quote entries are skipped (null / empty string)', () => {
  const out = markup('keep this', [null, '', 'this']);
  assert.equal(out, 'keep <mark>this</mark>');
});
t('markup: marked + unmarked regions all escaped', () => {
  const out = markup('a<b & "c" >quote<', ['"c"']);
  // " inside the quote is escaped, surroundings escaped, mark wraps the quote
  assert.ok(out.includes('<mark>&quot;c&quot;</mark>'));
  assert.ok(!out.includes('<b'));
  assert.ok(out.includes('a&lt;b'));
});
t('markup: adjacent quotes (no gap between them) render back-to-back marks', () => {
  const out = markup('abcd', ['ab', 'cd']);
  assert.equal(out, '<mark>ab</mark><mark>cd</mark>');
});

// ============================================================
// SOURCE-BINDING: confirm esc is the &<>" entity escaper used by markup
// ============================================================
t('source binding: esc escapes the full &<>"\' set and markup calls esc', () => {
  assert.ok(/replace\(\/\[&<>"'\]\/g/.test(escSrc), "esc uses the [&<>\"'] char class");
  assert.ok(/esc\(body\.slice/.test(markupSrc), 'markup escapes body slices via esc');
});

console.log(`\nmarkup.test.mjs: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
