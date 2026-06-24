// Mutation-locked tests for countWords (api/_lib/count-words.js).
// Run: node api/_lib/count-words.test.mjs  (picked up by scripts/run-tests.mjs)
//
// The whole point of this helper is to NOT fall into the
// `''.split(/\s+/).length === 1` trap. The buggy old idiom is reconstructed
// here so the RED assertions prove the trap was real and that countWords
// closes it.
import { countWords } from './count-words.js';
import assert from 'node:assert/strict';

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

const buggy = (text) => text.split(/\s+/).length;

t('empty / whitespace / non-string → 0 (the bug)', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('\t\n  '), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
  assert.equal(countWords(42), 0);
  assert.equal(countWords({}), 0);
  assert.equal(countWords([]), 0);

  // RED proof: the naive idiom over-counts. Empty → 1; a whitespace-only
  // string is even worse — `'   '.split(/\s+/)` is `['','']`, so → 2.
  assert.equal(buggy(''), 1);
  assert.equal(buggy('   '), 2);
});

t('ordinary text counts whitespace-separated tokens', () => {
  assert.equal(countWords('hello'), 1);
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('the quick brown fox'), 4);
});

t('collapses runs of whitespace and ignores leading/trailing space', () => {
  assert.equal(countWords('  hello   world  '), 2);
  assert.equal(countWords('a\tb\nc'), 3);
  assert.equal(countWords('one  two   three'), 3);

  // RED proof: untrimmed leading space makes the naive idiom over-count by 1.
  assert.equal(buggy(' hello world'), 3);
});

t('non-empty text: countWords matches the trimmed-split count exactly', () => {
  // Parity: for real (non-empty) content the helper is byte-equivalent to the
  // intended `text.trim().split(/\s+/).length` — no behavior change there.
  for (const s of ['a', 'a b', 'lorem ipsum dolor', 'voice line here', 'X.']) {
    assert.equal(countWords(s), s.trim().split(/\s+/).length);
  }
});

t('Hunter single-column beat: empty cell adds 0, not a phantom word', () => {
  // api/gemini.js sums countWords(voice.text) + countWords(visual.text) per
  // beat. A voice-only beat (empty visual cell) must count only its real words.
  const voice = 'she crosses the bridge at dawn';
  const visual = ''; // single-column beat
  assert.equal(countWords(voice) + countWords(visual), 6);

  // RED proof: the old idiom charged a phantom word for the empty cell.
  assert.equal(buggy(voice) + buggy(visual), 7);
});

t('QSS Book View: blank blocks contribute 0 to a scene word count', () => {
  const blocks = ['the queen spoke', '', '   ', 'and left'];
  const n = blocks.reduce((sum, x) => sum + countWords(x), 0);
  assert.equal(n, 5); // 3 + 0 + 0 + 2

  // RED proof: the old idiom inflated the count — '' → 1 and '   ' → 2,
  // so these two blank blocks alone added 3 phantom words (5 → 8).
  const nBuggy = blocks.reduce((sum, x) => sum + buggy(x), 0);
  assert.equal(nBuggy, 8);
});

console.log(`\ncount-words: ${pass} checks passed`);
