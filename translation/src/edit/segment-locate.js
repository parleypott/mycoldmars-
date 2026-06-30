// Pure segment-locating cores for the media deck (the Trint-style editor player
// in Johnny's most-used tool). Extracted VERBATIM from media-deck.js so the two
// correctness-critical, previously-zero-coverage behaviors are unit-testable
// headlessly:
//
//   • findSegmentAt — the binary search that decides WHICH transcript line
//     highlights as the video plays. A `<=` vs `<` slip, or losing the endSec
//     gap-check, silently highlights the wrong line (or highlights through
//     silence) while Johnny listens, with no error.
//   • highlightTimeSpan — resolves a saved highlight (spanning 1..N segment
//     numbers) to the {start, end} time span used to draw the waveform region.
//
// This also consolidates what were THREE inline copies of the segment
// start/end resolution (`typeof s.startSec === 'number' ? s.startSec : parse…`)
// into one shared resolver, so they can't drift.

import { parseTimecodeToSeconds } from '../timecode-utils.js';

// Resolve a segment's start/end to decimal seconds. Prefers a precomputed
// numeric *Sec field; falls back to parsing the timecode string (which returns
// 0 — never NaN — for a missing/unparseable timecode).
export function resolveSegStart(s) {
  return typeof s.startSec === 'number' ? s.startSec : parseTimecodeToSeconds(s.start);
}
export function resolveSegEnd(s) {
  return typeof s.endSec === 'number' ? s.endSec : parseTimecodeToSeconds(s.end);
}

// Build the memoizable {number, startSec, endSec} lookup index from the
// segments array (ordered by start time).
export function buildSegIndex(segments) {
  return (segments || []).map(s => ({
    number: s.number,
    startSec: resolveSegStart(s),
    endSec: resolveSegEnd(s),
  }));
}

// Binary search for the segment containing playback time t. Segments are ordered
// by start time; find the LAST one whose startSec <= t, then confirm t is still
// inside it (t < endSec). Returns null in the gap between segments (silence) and
// when t precedes the first segment.
export function findSegmentAt(segIndex, t) {
  let lo = 0, hi = segIndex.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segIndex[mid];
    if (s.startSec <= t) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (found < 0) return null;
  const s = segIndex[found];
  return (t < s.endSec) ? s : null;
}

// Resolve a saved highlight (spanning 1..N segment numbers) to a {start, end}
// time span by looking its numbers up in the segments list. Returns null when
// no referenced segment resolves to a finite, positive-width span.
export function highlightTimeSpan(h, segments) {
  const nums = h.segment_numbers || h.segmentNumbers || [];
  if (!nums.length) return null;
  let start = Infinity, end = -Infinity;
  for (const n of nums) {
    const s = (segments || []).find(seg => seg.number === n);
    if (!s) continue;
    const ss = resolveSegStart(s);
    const ee = resolveSegEnd(s);
    if (isFinite(ss) && ss < start) start = ss;
    if (isFinite(ee) && ee > end)   end   = ee;
  }
  if (!isFinite(start) || !isFinite(end) || end <= start) return null;
  return { start, end };
}

// ── Word-karaoke cores (the per-word highlight that lights up as the video
// plays). Extracted VERBATIM from media-deck.js so the two previously-zero-
// coverage, correctness-critical behaviors are unit-testable headlessly, and so
// the membership filter can't drift between its two callers (the RAF highlight
// loop AND click-to-seek).

// Which timed words belong to a segment: those whose [start,end] sits inside the
// segment's [segStart,segEnd] window, with a small ±0.05s tolerance so a word
// whose timing brushes the boundary isn't dropped. Non-array input -> []; words
// missing numeric start/end are skipped. Used by BOTH the highlight loop and
// click-to-seek, so a single shared copy keeps them aligned.
export function wordTimingsInSegment(wordTimings, segStart, segEnd) {
  if (!Array.isArray(wordTimings)) return [];
  return wordTimings.filter(w =>
    typeof w.start === 'number' && typeof w.end === 'number' &&
    w.start >= segStart - 0.05 && w.end <= segEnd + 0.05
  );
}

// Which word (within a segment's word list, in document order) is active at
// currentTime: the LAST word whose [start, end+grace] window contains the time.
// A small end grace (default 40ms) keeps a word lit through the tiny gap before
// the next one starts; taking the LAST match favors the later word when padded
// windows overlap. Returns -1 when the time falls in a gap before/after/between
// words (the caller keeps the prior word lit, or clears).
export function activeWordIndex(wordsInSeg, currentTime, grace = 0.04) {
  let activeIndex = -1;
  const words = wordsInSeg || [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.start <= currentTime && currentTime <= word.end + grace) {
      activeIndex = i;
    }
  }
  return activeIndex;
}
