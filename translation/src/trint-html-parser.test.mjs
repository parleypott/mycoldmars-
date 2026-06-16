/**
 * Tests for trint-html-parser — the Trint "Interactive transcripts (.html)"
 * import front door (Hyperaudio Lite markup). Run: node src/trint-html-parser.test.mjs
 *
 * Headline bug: splitIntoSubGroups was supposed to fold a tiny trailing group
 * (<=2 words) back into the previous group so a long utterance never ships an
 * orphan 1-2 word micro-segment. But the loop's `isLast` branch ALWAYS flushes
 * the final group into `groups`, leaving the post-loop `current`-based merge
 * (which checked `current.length > 0`) permanently dead — `current` is always
 * empty by then. So the merge never ran and orphan micro-segments shipped into
 * the producer-facing transcript. The fix runs the merge on `groups` instead.
 *
 * The other cases lock in the surrounding (already-correct) behavior so the
 * merge fix can't regress grouping at the 5-word target or the +3 hard cap.
 */
import { splitIntoSubGroups, cleanText, msToSec } from './trint-html-parser.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};

// Build N words. `punctAt` is a set of 0-based indices whose word ends in a comma.
const makeWords = (n, punctAt = new Set()) =>
  Array.from({ length: n }, (_, i) => ({
    text: `w${i}${punctAt.has(i) ? ',' : ''}`,
    startSec: i,
    durSec: 0.4,
  }));
const sizes = (groups) => groups.map(g => g.length);
const allWords = (groups) => groups.flatMap(g => g.map(w => w.text));

// ── Headline: no orphan 1-word tail (9 words, no punctuation) ──────────────────
{
  // i=7 hits TARGET_WORDS+3 (8) → flush 8-word group; w8 alone is the tail.
  // Buggy behavior: groups = [8, 1] (orphan!). Fixed: tail folds back → [9].
  const groups = splitIntoSubGroups(makeWords(9));
  const last = groups[groups.length - 1].length;
  ok(last > 2, 'no orphan: final group must not be a 1-word micro-segment');
  eq(sizes(groups).join(','), '9', '9 no-punct words fold into a single group');
}

// ── Headline: no orphan 2-word tail (7 words, comma after word index 4) ────────
{
  // i=4 is atTarget(5) && hasPunct → flush [w0..w4]; w5,w6 are a 2-word tail.
  // Buggy: groups = [5, 2] (orphan). Fixed: 2-word tail folds back → [7].
  const groups = splitIntoSubGroups(makeWords(7, new Set([4])));
  const last = groups[groups.length - 1].length;
  ok(last > 2, 'no orphan: 2-word tail must fold into the previous group');
  eq(sizes(groups).join(','), '7', '5+2 collapses to one 7-word group');
}

// ── No words are ever lost or duplicated by the merge ──────────────────────────
{
  const input = makeWords(9);
  const groups = splitIntoSubGroups(input);
  eq(allWords(groups).join(' '), input.map(w => w.text).join(' '),
     'every word survives the split+merge in order');
}
{
  const input = makeWords(7, new Set([4]));
  const groups = splitIntoSubGroups(input);
  eq(allWords(groups).join(' '), input.map(w => w.text).join(' '),
     'punctuated split: all words preserved in order');
}

// ── A healthy non-tiny final group is left intact (no over-merging) ────────────
{
  // Commas at 4 and 9 → [w0..w4](5), [w5..w9](5), [w10,w11,w12](3 tail).
  // 3 > 2, so the tail is NOT merged — it stays its own group.
  const groups = splitIntoSubGroups(makeWords(13, new Set([4, 9])));
  eq(sizes(groups).join(','), '5,5,3', '3-word tail is healthy, stays its own group');
}

// ── Single short group: nothing to merge into, returned as-is ──────────────────
{
  // 2 words, no break: one group of 2. groups.length === 1 → no merge target.
  const groups = splitIntoSubGroups(makeWords(2));
  eq(sizes(groups).join(','), '2', 'a lone tiny group is returned as-is (no previous to merge into)');
}

// ── The +3 hard cap still fires for run-on speech with no punctuation ──────────
{
  // 16 words, no punct: caps at 8 (TARGET+3), so 8 + 8 → [8, 8].
  const groups = splitIntoSubGroups(makeWords(16));
  eq(sizes(groups).join(','), '8,8', 'no-punctuation run-ons still cap at TARGET_WORDS+3');
}

// ── helper sanity: cleanText collapses whitespace; msToSec parses ms → s ───────
eq(cleanText('  Okay,   friends  '), 'Okay, friends', 'cleanText collapses internal+edge whitespace');
eq(cleanText(null), '', 'cleanText null → empty string');
eq(msToSec('1130'), 1.13, 'msToSec 1130 → 1.13s');
eq(msToSec('350'), 0.35, 'msToSec 350 → 0.35s');
eq(msToSec(null), 0, 'msToSec null → 0 (degrades safely)');
eq(msToSec('not-a-number'), 0, 'msToSec garbage → 0');

console.log(`\ntrint-html-parser: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
