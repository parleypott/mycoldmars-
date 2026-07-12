// Locks locate(), the pure re-anchoring core of the BERGUNDY reader
// (public/burgundy/index.html). locate decides WHICH occurrence of a
// highlighted quote a reader's margin note lands on when a paragraph has
// repeated text or was republished. Extracted from the shipped HTML at runtime
// so a drift in index.html breaks this test.
//
// Bug fixed + locked here: a quote at index 0 of the searched text with a
// stored non-empty prefix short-circuited the prefix check, because
// `prefix.endsWith(before)` with before='' is always true -> locate returned 0
// and mis-anchored the highlight to the paragraph start instead of the real
// (later) occurrence. The `before && (...)` guard fixes it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function locate\(text, quote, prefix\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract locate() from index.html — did the function signature change?');
const locate = (0, eval)('(' + m[0] + ')');

// The pre-fix form, kept here to prove the test is load-bearing: this is what
// the shipped code did before the `before &&` guard.
function buggyLocate(text, quote, prefix) {
  if (!quote) return -1;
  let idx = -1, from = 0;
  while ((idx = text.indexOf(quote, from)) !== -1) {
    if (!prefix) return idx;
    const before = text.slice(Math.max(0, idx - prefix.length), idx);
    if (before === prefix || prefix.endsWith(before) || before.endsWith(prefix.slice(-12))) return idx;
    from = idx + 1;
  }
  return text.indexOf(quote);
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// 1. empty quote -> -1
eq(locate('anything', '', 'pfx'), -1, 'empty quote returns -1');

// 2. no prefix -> first occurrence
eq(locate('cat and cat', 'cat', ''), 0, 'empty prefix returns first occurrence');

// 3. quote absent -> -1 (falls through to indexOf)
eq(locate('the mat', 'cat', 'on '), -1, 'absent quote returns -1');

// 4. repeated quote with DISTINCT surrounding context: prefix anchors to the
//    SECOND (intended) occurrence, not the first.
{
  const text = 'Morning bells rang over the amber horizon at first light. ' +
               'Evening drums rang over the amber horizon once more.';
  const quote = 'rang over the amber horizon';
  const idx2 = text.lastIndexOf(quote);
  const prefix = text.slice(idx2 - 24, idx2); // stored prefix of the 2nd occurrence
  eq(locate(text, quote, prefix), idx2, 'prefix anchors to the correct repeated occurrence');
}

// 5. THE BUG: quote at index 0, prefix belongs to a LATER occurrence.
//    Fixed locate skips offset 0 and finds the real occurrence; the old form
//    returned 0 because prefix.endsWith('') is always true.
{
  const text = 'cat sat here. then the cat sat there.';
  const quote = 'cat sat';
  const idx2 = text.lastIndexOf(quote);          // = 23
  const prefix = text.slice(Math.max(0, idx2 - 24), idx2);
  ok(idx2 > 0, 'sanity: second occurrence is not at offset 0');
  eq(locate(text, quote, prefix), idx2, 'FIXED: start-of-text occurrence does not hijack a later-anchored quote');
  eq(buggyLocate(text, quote, prefix), 0, 'MUTATION PROOF: pre-fix form mis-anchored to offset 0');
  ok(locate(text, quote, prefix) !== buggyLocate(text, quote, prefix), 'fix genuinely changes the buggy case');
}

// 6. single occurrence with a matching non-empty prefix -> that index.
{
  const text = 'the quick brown fox';
  const quote = 'brown fox';
  const idx = text.indexOf(quote);
  eq(locate(text, quote, text.slice(0, idx)), idx, 'single occurrence with matching prefix');
}

// 7. total prefix mismatch -> documented fallback to first occurrence.
eq(locate('cat and cat', 'cat', 'zzzzzzzz'), 0, 'prefix mismatch falls back to first occurrence');

console.log(`locate-anchor.test.mjs: ${pass} assertions passed`);
