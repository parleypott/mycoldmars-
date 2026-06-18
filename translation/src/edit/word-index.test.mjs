// Tests for wordIndexFromCharOffset — the offset→word-index mapping behind
// the interpreter editor's click-to-seek.
//
// RED proof: the OLD implementation (reconstructed below) counted tokens that
// had *begun* before the offset and indexed by that count directly, so a click
// inside a word's body returned the NEXT word — an off-by-one on nearly every
// real click. The cases marked "(old: WRONG)" fail against oldIdx and pass
// against the shipped wordIndexFromCharOffset.
//
// Mutation proof: revert word-index.js to `idx = begun` (drop the `- 1`) and
// every body/leading-edge case below goes RED.

import { wordIndexFromCharOffset } from './word-index.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); }
}

// ── reconstruction of the OLD buggy logic, for the inline RED proof ──────────
function oldIdx(text, offset, wordCount) {
  const len = text.length;
  const upTo = text.slice(0, Math.max(0, Math.min(len, offset)));
  const wordsBefore = (upTo.match(/\S+/g) || []).length;
  return Math.max(0, Math.min(wordCount - 1, wordsBefore));
}

const TXT = 'alpha beta gamma'; // word starts: alpha@0, beta@6, gamma@11

// ── inline RED proof: the old logic overshoots a word-body click ─────────────
t('RED proof: old logic returns the NEXT word on a body click', () => {
  assert.equal(oldIdx(TXT, 3, 3), 1);  // clicked "alpha" (word 0) → old says 1
  assert.equal(oldIdx(TXT, 8, 3), 2);  // clicked "beta"  (word 1) → old says 2
  // the fixed function gets them right:
  assert.equal(wordIndexFromCharOffset(TXT, 3, 3), 0);
  assert.equal(wordIndexFromCharOffset(TXT, 8, 3), 1);
});

// ── body clicks map to the clicked word (the core fix) ───────────────────────
t('body of word 0 → word 0 (old: WRONG)', () => {
  for (const o of [1, 2, 3, 4, 5]) assert.equal(wordIndexFromCharOffset(TXT, o, 3), 0);
});
t('body of word 1 → word 1 (old: WRONG)', () => {
  for (const o of [7, 8, 9, 10]) assert.equal(wordIndexFromCharOffset(TXT, o, 3), 1);
});
t('body of word 2 → word 2 (old: WRONG)', () => {
  for (const o of [12, 13, 14, 15, 16]) assert.equal(wordIndexFromCharOffset(TXT, o, 3), 2);
});

// ── leading-edge clicks (caret placed before the first glyph of a word) ──────
t('leading edge of word 1 (offset 6) → word 1', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 6, 3), 1);
});
t('leading edge of word 2 (offset 11) → word 2', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 11, 3), 2);
});

// ── boundaries ───────────────────────────────────────────────────────────────
t('offset 0 (before any word) → word 0', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 0, 3), 0);
});
t('offset past end → last word (clamped)', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 999, 3), 2);
});
t('leading whitespace: click in the gap before word 0 → word 0', () => {
  const s = '   alpha beta'; // alpha@3, beta@9
  assert.equal(wordIndexFromCharOffset(s, 0, 2), 0);
  assert.equal(wordIndexFromCharOffset(s, 2, 2), 0);
  assert.equal(wordIndexFromCharOffset(s, 5, 2), 0); // body of alpha
  assert.equal(wordIndexFromCharOffset(s, 10, 2), 1); // body of beta
});
t('multiple spaces between words still map correctly', () => {
  const s = 'one    two'; // one@0, two@7
  assert.equal(wordIndexFromCharOffset(s, 2, 2), 0); // body of one
  assert.equal(wordIndexFromCharOffset(s, 8, 2), 1); // body of two
  assert.equal(wordIndexFromCharOffset(s, 7, 2), 1); // leading edge of two
});
t('trailing whitespace: offset at end → last word', () => {
  const s = 'solo     ';
  assert.equal(wordIndexFromCharOffset(s, s.length, 1), 0);
});

// ── never out of range ───────────────────────────────────────────────────────
t('index never exceeds wordCount-1 (clamp holds when text has more tokens)', () => {
  // 5 text tokens but only 2 timed words → must clamp to 1
  const s = 'a b c d e';
  for (let o = 0; o <= s.length; o++) {
    const i = wordIndexFromCharOffset(s, o, 2);
    assert.ok(i >= 0 && i <= 1, `offset ${o} → ${i} out of [0,1]`);
  }
});
t('single-word segment always → 0', () => {
  for (const o of [0, 1, 2, 3]) assert.equal(wordIndexFromCharOffset('hello', o, 1), 0);
});

// ── degenerate / defensive inputs ────────────────────────────────────────────
t('empty text → 0', () => {
  assert.equal(wordIndexFromCharOffset('', 0, 3), 0);
  assert.equal(wordIndexFromCharOffset('', 5, 3), 0);
});
t('wordCount 0 / negative / NaN → 0 (no throw, no -1 index)', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 8, 0), 0);
  assert.equal(wordIndexFromCharOffset(TXT, 8, -3), 0);
  assert.equal(wordIndexFromCharOffset(TXT, 8, NaN), 0);
});
t('non-finite / negative offset defensively treated as 0 → word 0', () => {
  assert.equal(wordIndexFromCharOffset(TXT, NaN, 3), 0);
  assert.equal(wordIndexFromCharOffset(TXT, -5, 3), 0);
  assert.equal(wordIndexFromCharOffset(TXT, Infinity, 3), 0); // non-finite → 0, never a stray seek
});
t('null / undefined text → 0, no throw', () => {
  assert.equal(wordIndexFromCharOffset(null, 0, 3), 0);
  assert.equal(wordIndexFromCharOffset(undefined, 2, 3), 0);
});
t('fractional offset floored', () => {
  assert.equal(wordIndexFromCharOffset(TXT, 3.9, 3), 0); // still inside word 0
  assert.equal(wordIndexFromCharOffset(TXT, 8.2, 3), 1);
});

console.log(`\nword-index: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
