/**
 * Build a short margin-note preview label from an interested-bullet's text.
 *
 * The transcript editor renders these labels in the gutter next to each
 * highlighted block, so they must be SHORT — a ~`max`-char teaser, not the
 * whole bullet. We prefer to cut on a word boundary at or before `max`; if
 * there is no usable space in range we hard-cut at `max`.
 *
 * Guards the classic `lastIndexOf(...) || max` trap: lastIndexOf returns -1
 * when no space exists in range (a spaceless CJK transcript — this is an
 * interpreter tool that handles Mandarin/Cantonese — or a long URL/filename),
 * and -1 is TRUTHY, so `-1 || max` keeps -1 and `slice(0, -1)` would emit
 * nearly the WHOLE string + '…' instead of a teaser. A leading space at index
 * 0 is falsy and must also fall back to the hard cut. So: only break on a
 * space found at a position > 0; otherwise hard-cut at `max`.
 */
export function truncateLabel(text, max = 50) {
  const t = typeof text === 'string' ? text : '';
  if (t.length <= max) return t;
  let cut = t.lastIndexOf(' ', max);
  if (cut <= 0) cut = max; // no space in range (or only a leading space) → hard-cut
  return t.slice(0, cut) + '…';
}
