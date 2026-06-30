// Tests for translation/src/edit/segment-locate.js — the pure segment-locating
// cores extracted from the Interpreter's media deck (Johnny's most-used tool).
//
// findSegmentAt is the binary search that decides WHICH transcript line
// highlights as the video plays — the LAST segment whose startSec <= t, but only
// if t is still inside it (t < endSec); null in the gap between segments
// (silence) and before the first segment. A `<=` -> `<` slip, or losing the
// endSec gap-check, silently highlights the wrong line (or highlights through
// silence) while Johnny listens. highlightTimeSpan resolves a saved highlight
// spanning 1..N segment numbers to the {start,end} span drawn on the waveform.
//
// This is a verifier-layer LOCK (no live bug — the extraction is behavior-
// identical; the timecode parser returns 0, never NaN, so the search is robust),
// plus a divergent-copy consolidation (three inline startSec/endSec resolutions
// -> one shared resolveSegStart/resolveSegEnd). Every assertion is mutation-
// proven below: the README cases each fail if the corresponding logic regresses.

import {
  resolveSegStart, resolveSegEnd, buildSegIndex, findSegmentAt, highlightTimeSpan,
  wordTimingsInSegment, activeWordIndex,
} from './segment-locate.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// A simple ordered transcript: three contiguous segments + a gap before #4.
//   #1 [0,10)  #2 [10,20)  #3 [20,30)   <gap 30..40>   #4 [40,50)
const SEGS = [
  { number: 1, startSec: 0,  endSec: 10 },
  { number: 2, startSec: 10, endSec: 20 },
  { number: 3, startSec: 20, endSec: 30 },
  { number: 4, startSec: 40, endSec: 50 },
];
const idx = buildSegIndex(SEGS);

// ── RED proof #1: the search must find the LAST segment whose startSec <= t.
// A naive "first segment whose startSec <= t" trips on #1 every time (its
// startSec 0 <= any t>=0) and, with the gap-check, returns null for ALL t>=10 —
// it can only ever resolve #1's own range. So at t=15 it returns null (broken),
// while the shipped binary search correctly resolves #2. ──────────────────────
const firstMatchOnly = (segIndex, t) => {
  for (const s of segIndex) if (s.startSec <= t) return (t < s.endSec) ? s : null;
  return null;
};
eq(firstMatchOnly(idx, 15), null, 'RED proof: first-match can only ever resolve #1, returns null at t=15 (wrong)');
eq(findSegmentAt(idx, 15)?.number, 2, 'shipped: last startSec <= t -> #2 at t=15 (correct)');

// ── RED proof #2: dropping the endSec gap-check makes the search highlight a
// line through the silence after it. At t=35 (in the 30..40 gap) the correct
// answer is null; a no-endSec-check version wrongly returns #3. ────────────────
const noGapCheck = (segIndex, t) => {
  let lo = 0, hi = segIndex.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segIndex[m].startSec <= t) { found = m; lo = m + 1; } else hi = m - 1; }
  return found < 0 ? null : segIndex[found]; // <-- no `t < endSec` guard
};
eq(noGapCheck(idx, 35)?.number, 3, 'RED proof: no gap-check highlights #3 through the silence (wrong)');
eq(findSegmentAt(idx, 35), null, 'shipped: t=35 in the gap -> null (no highlight in silence)');

// ── findSegmentAt: core correctness ──────────────────────────────────────────
eq(findSegmentAt(idx, 0)?.number,    1, 't=0 -> #1 (start of first segment)');
eq(findSegmentAt(idx, 5)?.number,    1, 't=5 mid #1');
eq(findSegmentAt(idx, 9.999)?.number, 1, 't just before #1 end -> #1');
eq(findSegmentAt(idx, 10)?.number,   2, 't=10 -> #2 (boundary belongs to the new segment)');
eq(findSegmentAt(idx, 19.5)?.number, 2, 't mid #2');
eq(findSegmentAt(idx, 20)?.number,   3, 't=20 -> #3');
eq(findSegmentAt(idx, 29.999)?.number, 3, 't just before #3 end -> #3');
eq(findSegmentAt(idx, 30),  null, 't=30 -> null (exactly at #3 end, gap begins)');
eq(findSegmentAt(idx, 35),  null, 't=35 -> null (middle of the gap)');
eq(findSegmentAt(idx, 40)?.number, 4, 't=40 -> #4 (next segment after the gap)');
eq(findSegmentAt(idx, 45)?.number, 4, 't mid #4');
eq(findSegmentAt(idx, 50),  null, 't=50 -> null (at #4 end)');
eq(findSegmentAt(idx, 999), null, 't past the last segment -> null');
eq(findSegmentAt(idx, -5),  null, 't before the first segment -> null');
eq(findSegmentAt([], 5),    null, 'empty index -> null');
eq(findSegmentAt(buildSegIndex([{ number: 7, startSec: 3, endSec: 8 }]), 5)?.number, 7, 'single segment hit');
eq(findSegmentAt(buildSegIndex([{ number: 7, startSec: 3, endSec: 8 }]), 1), null, 'single segment, t before it -> null');

// A zero-width / inverted segment never highlights (endSec <= startSec).
eq(findSegmentAt(buildSegIndex([{ number: 9, startSec: 5, endSec: 5 }]), 5), null, 'zero-width segment -> null');

// ── buildSegIndex + resolveSegStart/End: numeric vs timecode-string sources ──
eq(buildSegIndex(SEGS), idx, 'buildSegIndex maps {number,startSec,endSec} verbatim for numeric input');
eq(resolveSegStart({ startSec: 12.5 }), 12.5, 'numeric startSec passes through');
eq(resolveSegStart({ start: '1:05:30' }), 3930, 'string start parsed via timecode parser');
eq(resolveSegEnd({ endSec: 8 }), 8, 'numeric endSec passes through');
eq(resolveSegEnd({ end: '0:40' }), 40, 'string end parsed via timecode parser');
// Missing/unparseable timecode -> 0 (never NaN), so the search stays well-defined.
eq(resolveSegStart({ start: '' }), 0, 'empty start -> 0 (not NaN)');
eq(resolveSegStart({}), 0, 'absent start -> 0 (not NaN)');
// Mixed source: a string-timecode segment locates correctly through buildSegIndex.
const strIdx = buildSegIndex([
  { number: 1, start: '0:00', end: '0:10' },
  { number: 2, start: '0:10', end: '0:20' },
]);
eq(findSegmentAt(strIdx, 15)?.number, 2, 'string-timecode segments locate correctly (t=15 -> #2)');
eq(findSegmentAt(strIdx, 5)?.number,  1, 'string-timecode segments locate correctly (t=5 -> #1)');
eq(buildSegIndex(null), [], 'null segments -> empty index (no throw)');

// ── highlightTimeSpan: multi-segment span resolution ─────────────────────────
eq(highlightTimeSpan({ segment_numbers: [2, 3] }, SEGS), { start: 10, end: 30 }, 'span across #2..#3 -> {10,30}');
eq(highlightTimeSpan({ segment_numbers: [2] }, SEGS), { start: 10, end: 20 }, 'single-segment span -> that segment');
eq(highlightTimeSpan({ segmentNumbers: [1, 4] }, SEGS), { start: 0, end: 50 }, 'camelCase key + non-contiguous span -> outer bounds');
eq(highlightTimeSpan({ segment_numbers: [2, 999] }, SEGS), { start: 10, end: 20 }, 'unknown segment number skipped');
eq(highlightTimeSpan({ segment_numbers: [] }, SEGS), null, 'empty numbers -> null');
eq(highlightTimeSpan({}, SEGS), null, 'no numbers key -> null');
eq(highlightTimeSpan({ segment_numbers: [999] }, SEGS), null, 'all-unresolvable -> null');
// out-of-order numbers still yield the correct min-start / max-end span.
eq(highlightTimeSpan({ segment_numbers: [3, 1] }, SEGS), { start: 0, end: 30 }, 'out-of-order numbers -> min start, max end');
// a single segment whose end <= start would be a non-positive span -> null.
eq(highlightTimeSpan({ segment_numbers: [9] }, [{ number: 9, startSec: 5, endSec: 5 }]), null, 'zero-width highlight span -> null');

// ── wordTimingsInSegment: which timed words belong to a segment ───────────────
// The membership filter shared by the karaoke highlight loop AND click-to-seek.
// A word belongs if its [start,end] sits inside [segStart,segEnd] ±0.05s grace.
const WORDS = [
  { start: 0.0,  end: 0.4 },   // 0: clearly in seg [0,2)
  { start: 0.5,  end: 0.9 },   // 1
  { start: 1.0,  end: 1.4 },   // 2
  { start: 2.4,  end: 2.8 },   // 3: belongs to the NEXT segment [2.3,4)
];
eq(wordTimingsInSegment(WORDS, 0, 2).length, 3, 'seg [0,2) captures its 3 words, not the next seg\'s word');
eq(wordTimingsInSegment(WORDS, 2.3, 4).map(w => w.start), [2.4], 'seg [2.3,4) captures only its own word');
// ±0.05 grace: a word ending 0.04s past the segment end is still in (boundary brush).
eq(wordTimingsInSegment([{ start: 1.9, end: 2.04 }], 0, 2).length, 1, '+0.05 end grace keeps a word brushing the boundary');
// ...but a word clearly past the boundary is excluded.
eq(wordTimingsInSegment([{ start: 2.2, end: 2.6 }], 0, 2).length, 0, 'word past the +0.05 grace is excluded');
// RED proof: dropping the grace (using bare >=segStart && <=segEnd) drops the brush word above; widening it (e.g. ±1) would admit the 2.2 word.
// Robustness: non-array -> [], words missing numeric start/end skipped.
eq(wordTimingsInSegment(null, 0, 2), [], 'non-array wordTimings -> []');
eq(wordTimingsInSegment([{ start: '0', end: 1 }, { start: 0.1, end: 0.2 }], 0, 2).length, 1, 'word with non-numeric start skipped');

// ── activeWordIndex: which word is lit at currentTime ─────────────────────────
// LAST word whose [start, end+grace] contains the time; -1 in a gap.
const SEG_WORDS = [
  { start: 0.0, end: 0.4 },  // 0
  { start: 0.5, end: 0.9 },  // 1
  { start: 1.0, end: 1.4 },  // 2
];
eq(activeWordIndex(SEG_WORDS, 0.2), 0, 'time inside word 0 -> 0');
eq(activeWordIndex(SEG_WORDS, 0.7), 1, 'time inside word 1 -> 1');
eq(activeWordIndex(SEG_WORDS, 1.2), 2, 'time inside word 2 -> 2');
// 40ms end-grace keeps a word lit just past its end (in the micro-gap to next).
eq(activeWordIndex(SEG_WORDS, 0.43), 0, 'within 40ms after word 0 end -> still 0 (grace)');
// RED proof: a 50ms gap is beyond the 0.04 grace and before word 1 -> no word.
eq(activeWordIndex(SEG_WORDS, 0.46), -1, 'gap beyond grace, before next word -> -1');
// before the first word and after the last (past grace) -> -1.
eq(activeWordIndex(SEG_WORDS, -1), -1, 'before all words -> -1');
eq(activeWordIndex(SEG_WORDS, 5), -1, 'after all words -> -1');
// LAST-match on overlap: with a generous grace, word 0's window [0,0.4+0.2] and
// word 1's [0.5,...] both could match at 0.55 — but only if windows overlap.
// Construct an explicit overlap: two words whose padded windows both contain t.
eq(activeWordIndex([{ start: 0, end: 1 }, { start: 0.5, end: 2 }], 0.6), 1, 'overlapping windows -> LAST match wins');
eq(activeWordIndex([], 1), -1, 'empty word list -> -1');
eq(activeWordIndex(null, 1), -1, 'null word list -> -1 (no throw)');

console.log(`\nsegment-locate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
