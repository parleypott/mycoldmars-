// Verifier-layer lock for the Interpreter KARAOKE highlight char-mapper —
// wordCharRangeInSegment() in translation/src/edit/media-deck.js.
//
// Karaoke (word-by-word highlight as the video plays) shipped THIS week
// (commits ce329ec, 4bd5dc9) and is actively churned. As the current time
// advances, the deck resolves the active word index, then calls
// wordCharRangeInSegment(spanEls, wordIndex) to turn that index into the
// CHARACTER RANGE to light up. rangeForCharSpan() then paints exactly those
// chars. So this function decides WHICH characters get the highlight — a bug
// here lands the karaoke highlight on the wrong word (the same "off-by-one
// word" class the loop has fixed before in click-to-seek), or drops it
// entirely at a segment's edges.
//
// Its INVERSE (wordIndexFromCharOffset — char offset -> word index, used for
// click-to-seek) is already locked in word-index.test.mjs. This forward
// direction (word index -> char range) had ZERO coverage.
//
// The load-bearing contracts:
//   1. TOKENIZE-ON-NONSPACE — words are `\S+` runs, so multi-space gaps do NOT
//      create empty word tokens (the naive split(' ') bug). wordIndex counts
//      non-whitespace tokens, 0-based.
//   2. CHAR-RANGE — returns {charStart, charEnd} as offsets INTO the joined
//      span text, charEnd exclusive. charStart honors leading whitespace (a
//      word after leading spaces starts at its real offset, not 0).
//   3. JOIN-ACROSS-SPANS — the text is the concatenation of every span's
//      textContent, so a word in a later span carries the earlier spans'
//      length in its offset. (The rendered segment is many <span> chars.)
//   4. CLAMP — wordIndex is clamped into [0, tokens.length-1]: a negative index
//      maps to the first word, an over-length index to the LAST word (so the
//      highlight never vanishes at the ends of a segment).
//   5. EMPTY -> null — no spans / all-empty / whitespace-only text -> null
//      (nothing to highlight), via two distinct guards.
//
// The function is EXTRACTED LIVE (regex + new Function) from media-deck.js so
// this lock can't drift from a hand-copy. spanEls are plain {textContent}
// stand-ins — the function only ever reads el.textContent, no real DOM.
// Mutation proofs at the bottom verify the test has teeth.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('./media-deck.js', import.meta.url), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

// --- extract the real wordCharRangeInSegment() verbatim ---
const fnSrc = src.match(/  function wordCharRangeInSegment\(spanEls, wordIndex\) \{[\s\S]*?\n  \}/);
assert.ok(fnSrc, 'could not find wordCharRangeInSegment() in media-deck.js');
// Sanity: the extracted slice is the tokenizer + clamp, not an over-greedy grab.
ok(/matchAll\(\/\\S\+\/g\)/.test(fnSrc[0]),
  'extracted fn tokenizes on \\S+ (not split(" "))');
ok(/Math\.max\(0, Math\.min\(tokens\.length - 1, wordIndex\)\)/.test(fnSrc[0]),
  'extracted fn clamps wordIndex into [0, tokens.length-1]');

function build(srcOverride) {
  return new Function(`${srcOverride || fnSrc[0]}\nreturn wordCharRangeInSegment;`)();
}
const fn = build();
const spans = (...texts) => texts.map(t => ({ textContent: t }));

// --- 1. TOKENIZE-ON-NONSPACE: a double space does NOT yield an empty token ---
{
  // "hello  world": naive split(' ') would make ["hello","","world"] and put
  // word index 1 on the empty string. \S+ tokens: "hello"@0, "world"@7.
  const r = fn(spans('hello  world'), 1);
  eq(r, { charStart: 7, charEnd: 12 }, 'word 1 of "hello  world" spans the real "world" run, not an empty gap');
}

// --- 2. CHAR-RANGE honors leading whitespace ---
{
  const r = fn(spans('  hi there'), 0);
  eq(r, { charStart: 2, charEnd: 4 }, 'first word after leading spaces starts at its real offset (2), charEnd exclusive');
  const r1 = fn(spans('  hi there'), 1);
  eq(r1, { charStart: 5, charEnd: 10 }, 'second word range is [5,10)');
}

// --- 3. JOIN-ACROSS-SPANS: offsets accumulate over concatenated spans ---
{
  // joined text = "foo bar baz"; the word "baz" lives past two prior spans.
  const r = fn(spans('foo ', 'bar ', 'baz'), 2);
  eq(r, { charStart: 8, charEnd: 11 }, 'word 2 offset carries the length of the earlier spans (joined text)');
}
{
  // a single word split across two spans is still one \S+ token spanning both.
  const r = fn(spans('wor', 'ld'), 0);
  eq(r, { charStart: 0, charEnd: 5 }, 'a word split across spans is one token over the joined text');
}

// --- 4. CLAMP: out-of-range index maps to first / last word, never null ---
{
  const three = spans('a bb ccc');           // tokens: a@0, bb@2, ccc@5
  eq(fn(three, -5), { charStart: 0, charEnd: 1 }, 'negative wordIndex clamps to the FIRST word');
  eq(fn(three, 99), { charStart: 5, charEnd: 8 }, 'over-length wordIndex clamps to the LAST word (highlight never vanishes at the end)');
  eq(fn(three, 1), { charStart: 2, charEnd: 4 }, 'in-range index picks its own word');
}

// --- 5. EMPTY -> null via both guards ---
{
  eq(fn(spans(), 0), null, 'no spans -> null');
  eq(fn(null, 0), null, 'null spanEls -> null (Array.from(null || []))');
  eq(fn(spans('', ''), 0), null, 'all-empty span text -> null (empty-text guard)');
  eq(fn(spans('   \t  '), 0), null, 'whitespace-only text -> null (no \\S+ tokens guard)');
}

// --- mutation proofs: the lock must FAIL if the mapper regresses ---
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}

// (a) drop the CLAMP (use the raw wordIndex) -> over-length index returns null,
//     so the highlight vanishes on the last word of a segment.
mustThrow(() => {
  const bad = build(`function wordCharRangeInSegment(spanEls, wordIndex) {
    const text = Array.from(spanEls || [], el => el.textContent || '').join('');
    if (!text) return null;
    const tokens = Array.from(text.matchAll(/\\S+/g));
    if (tokens.length === 0) return null;
    const match = tokens[wordIndex];
    if (!match || match.index == null) return null;
    return { charStart: match.index, charEnd: match.index + match[0].length };
  }`);
  assert.deepEqual(bad(spans('a bb ccc'), 99), { charStart: 5, charEnd: 8 },
    'an unclamped mapper must NOT still resolve the last word');
}, 'removing the clamp drops the highlight on an over-length index');

// (b) tokenize on split(' ') instead of \S+ -> the double-space case lands on
//     an empty token at the wrong offset.
mustThrow(() => {
  const bad = build(`function wordCharRangeInSegment(spanEls, wordIndex) {
    const text = Array.from(spanEls || [], el => el.textContent || '').join('');
    if (!text) return null;
    const parts = text.split(' ');
    let off = 0, out = null, i = 0;
    for (const p of parts) {
      if (i === Math.max(0, Math.min(parts.length - 1, wordIndex))) { out = { charStart: off, charEnd: off + p.length }; break; }
      off += p.length + 1; i++;
    }
    return out;
  }`);
  assert.deepEqual(bad(spans('hello  world'), 1), { charStart: 7, charEnd: 12 },
    'a split(" ") tokenizer must NOT reproduce the \\S+ range across a double space');
}, 'split(" ") tokenizer mishandles multi-space gaps');

console.log(`word-char-range: ${passed} assertions passed`);
