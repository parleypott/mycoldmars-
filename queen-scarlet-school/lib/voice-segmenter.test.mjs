/**
 * Tests for segmentByVoice — the multi-voice TTS attributor in QSS (Henry's
 * story editor). It decides which character voice reads each line of dialogue
 * when a story is read aloud. A misattribution = the wrong character's voice
 * speaks a line — confusing for a kid listening to their own story.
 *
 * Run: node lib/voice-segmenter.test.mjs   (from queen-scarlet-school/)
 *
 * Headline bug (fixed): Patterns A and B matched character names with no word
 * boundary, so a mapped name like "Ann" matched as a SUBSTRING of "Joann" and
 * stole that line's voice. The fix wraps the name alternation in \b…\b.
 */
// Single source of truth lives in public/ (served at /queen-scarlet-school/lib/).
import pkg from '../../public/queen-scarlet-school/lib/voice-segmenter.js';
const { segmentByVoice } = pkg;

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

// Helper: return the voice assigned to the segment that contains `needle`.
function voiceOf(segments, needle) {
  const s = segments.find(seg => seg.text.includes(needle));
  return s ? s.voice : null;
}
// Helper: reconstruct text from segments (must always equal the input).
function rebuilt(segments) {
  return segments.map(s => s.text).join('');
}

const NARR = 'matilda';

// ── 1. Lossless reconstruction is the load-bearing invariant ───────────────
{
  const text = 'Queen Scarlet said, "Hello there." Then she left.';
  const segs = segmentByVoice(text, { 'queen scarlet': 'scarletVoice' }, NARR);
  eq(rebuilt(segs), text, 'reconstruct: A-pattern text preserved exactly');
  // charStart/charEnd must index the original text correctly.
  ok(segs.every(s => text.slice(s.charStart, s.charEnd) === s.text),
     'charStart/charEnd slice back to segment text');
}

// ── 2. Pattern A — Name verb, "quote" ──────────────────────────────────────
{
  const segs = segmentByVoice('Scarlet whispered, "Run."', { 'scarlet': 'V1' }, NARR);
  eq(voiceOf(segs, 'Run.'), 'V1', 'A: quote attributed to speaker voice');
  eq(voiceOf(segs, 'whispered'), NARR, 'A: the said-bookkeeping stays narrator');
}

// ── 3. Pattern B — "quote," verb Name ──────────────────────────────────────
{
  const segs = segmentByVoice('"Run!" shouted Scarlet.', { 'scarlet': 'V1' }, NARR);
  eq(voiceOf(segs, 'Run!'), 'V1', 'B: trailing-attribution quote gets speaker voice');
}

// ── 4. Pattern C — Name: bare line ─────────────────────────────────────────
{
  const segs = segmentByVoice('Scarlet: I will not.', { 'scarlet': 'V1' }, NARR);
  eq(voiceOf(segs, 'I will not.'), 'V1', 'C: colon bare-line attributed to speaker');
}

// ── 5. THE BUG — a mapped name must NOT match as a substring of a bigger word.
//   All three of these were misattributed by the old (boundary-less) regexes;
//   each was confirmed to read as the wrong voice before the \b fix.
{
  // Pattern A, leading substring: "ann" sits inside "Joann". Joann is speaking.
  const segs = segmentByVoice('Joann said, "Mine."', { 'ann': 'annVoice' }, NARR);
  eq(voiceOf(segs, 'Mine.'), NARR,
     'BUG-A: "ann" must not match inside "Joann" (quote stays narrator)');
  ok(!segs.some(s => s.voice === 'annVoice'),
     'BUG-A: Ann voice never used when only "Joann" appears');
}
{
  // Pattern B, trailing prefix: "said Annie" — "ann" is the start of "Annie".
  const segs = segmentByVoice('"Hi there," said Annie.', { 'ann': 'annVoice' }, NARR);
  eq(voiceOf(segs, 'Hi there'), NARR,
     'BUG-B: "ann" must not match the start of trailing "Annie"');
  ok(!segs.some(s => s.voice === 'annVoice'),
     'BUG-B: Ann voice never used when only "Annie" appears');
}
{
  // Pattern A, suffix: "anne" sits inside "Marianne". Marianne is speaking.
  const segs = segmentByVoice('Marianne said, "Go."', { 'anne': 'anneVoice' }, NARR);
  eq(voiceOf(segs, 'Go.'), NARR,
     'BUG-C: "anne" must not match the end of "Marianne"');
}

// ── 6. Genuine match still works after the \b fix (no over-correction) ──────
{
  const segs = segmentByVoice('Ann said, "Here."', { 'ann': 'annVoice' }, NARR);
  eq(voiceOf(segs, 'Here.'), 'annVoice', 'NO-REGRESS: real "Ann" still attributed');
}
{
  // Multi-word name with internal space still matches across the \b wrap.
  const segs = segmentByVoice('Queen Scarlet said, "Now."', { 'queen scarlet': 'QS' }, NARR);
  eq(voiceOf(segs, 'Now.'), 'QS', 'NO-REGRESS: multi-word name matches with \\b');
}

// ── 7. Longest-name-wins when names overlap (Queen Scarlet vs Scarlet) ──────
{
  const map = { 'queen scarlet': 'QS', 'scarlet': 'S' };
  const segs = segmentByVoice('Queen Scarlet said, "Mine."', map, NARR);
  eq(voiceOf(segs, 'Mine.'), 'QS', 'OVERLAP: longer name wins over its suffix');
}

// ── 8. No names mapped → single narrator segment ───────────────────────────
{
  const text = 'Scarlet said, "Hi."';
  const segs = segmentByVoice(text, {}, NARR);
  eq(segs, [{ text, voice: NARR, charStart: 0, charEnd: text.length }],
     'EMPTY-MAP: whole text is one narrator segment');
}

// ── 9. Smart quotes normalize but indices stay aligned to the original ──────
{
  const text = 'Scarlet said, “Curly quotes.”';
  const segs = segmentByVoice(text, { 'scarlet': 'V1' }, NARR);
  eq(rebuilt(segs), text, 'SMART-QUOTES: original text (with curly quotes) preserved');
  ok(segs.every(s => text.slice(s.charStart, s.charEnd) === s.text),
     'SMART-QUOTES: indices still slice the original correctly');
  eq(voiceOf(segs, 'Curly quotes.'), 'V1', 'SMART-QUOTES: quote still attributed');
}

// ── 10. Multiple speakers in one block, coalescing narrator gaps ────────────
{
  const text = 'Ann said, "One." Bob said, "Two."';
  const map = { 'ann': 'A', 'bob': 'B' };
  const segs = segmentByVoice(text, map, NARR);
  eq(rebuilt(segs), text, 'MULTI: text preserved');
  eq(voiceOf(segs, 'One.'), 'A', 'MULTI: first quote → Ann');
  eq(voiceOf(segs, 'Two.'), 'B', 'MULTI: second quote → Bob');
}

// ── 11. Empty / falsy input ────────────────────────────────────────────────
{
  eq(segmentByVoice('', { 'ann': 'A' }, NARR), [], 'EMPTY: empty text → []');
  eq(segmentByVoice(null, { 'ann': 'A' }, NARR), [], 'NULL: null text → []');
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`\nvoice-segmenter: ${pass} passed, ${fail} failed (${pass + fail} total)`);
if (fails.length) { console.log('\n' + fails.join('\n')); process.exit(1); }
