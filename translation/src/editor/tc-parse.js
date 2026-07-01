// Bubble-menu timecode parser — extracted VERBATIM from BubbleMenu.jsx so the
// producer-facing "copy timecode from selection" path can be unit-tested
// headlessly (BubbleMenu.jsx imports preact/hooks at load, so it can't be
// imported in a node/bun test). Behavior-identical to the former inline copy.
//
// WHY THIS EXISTS SEPARATELY FROM timecode-utils.js `parseTimecodeToSeconds`:
// the two are behaviorally identical for every realistic segment timecode
// (HH:MM:SS[.,]f, MM:SS[.f], bare decimal seconds — see tc-parse.test.mjs's
// cross-check block, which proves it over the shared input space). They differ
// on ONE degenerate case ON PURPOSE: an empty/missing input.
//   • parseTimecodeToSeconds("")  → 0
//   • tcToSeconds("")             → NaN
// getSelectionTimecodes() relies on the NaN: it filters candidate marks with
// `isFinite(s)`, so a segment mark carrying an empty `start`/`end` attr is
// SKIPPED rather than folding a bogus 0:00 into the selection's earliest/latest
// range. Swapping in the canonical (0-returning) parser would silently pull the
// range start to 0:00 on such a mark. So the divergence is a contract, not a
// bug — and the cross-check test locks it so neither copy can drift unnoticed.

/**
 * Parse a timecode string (HH:MM:SS, MM:SS, or raw seconds) to seconds.
 * Empty/missing input returns NaN (the skip contract above); unparseable
 * input degrades to NaN via parseFloat.
 */
export function tcToSeconds(tc) {
  if (typeof tc === 'number') return tc;
  if (!tc) return NaN;
  const n = parseFloat(tc);
  // If it doesn't contain ':', it's already seconds
  if (!String(tc).includes(':')) return n;
  const parts = String(tc).replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return n;
}
