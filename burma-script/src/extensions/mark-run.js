// Burma Script Tool — contiguous mark-run resolver.
//
// WHY THIS EXISTS: a {tk …} / {fc …} span that contains an embedded broadcast timecode is
// SPLIT by ProseMirror into multiple adjacent text nodes — the timecode fragment carries an
// extra `timecode` mark, so it's a separate text node — yet every fragment still carries the
// span mark. Example (the document-builder headline case):
//   "{tk the exact time was 02:02:01:07 here}"
//   -> ["tk the exact time was " | "02:02:01:07" | " here"]   (all three carry tkSpan)
//
// marks.js openWorkshop used to walk the block's children and keep ONLY the single fragment
// under the click (`if (cFrom <= pos && pos <= cTo) { from = cFrom; to = cTo; }`, last-write-
// wins). So clicking the part AFTER the timecode captured just " here" — the Workshop got
// truncated text and a too-narrow [from,to], and writing the model's completion back replaced
// only that fragment, shattering the span. Same fragmentation class as the nodeText export bug.
//
// contiguousMarkRun expands across ALL adjacent fragments that carry the mark, so the Workshop
// always receives the WHOLE {tk}/{fc} ask regardless of where inside it the user clicked.

/**
 * Given the ordered inline fragments of a block (each { from, to, hasMark } in ProseMirror
 * positions, where consecutive text nodes satisfy fragment.from === prev.to) and a click
 * position `pos`, return the [from, to] of the maximal CONTIGUOUS run of mark-bearing
 * fragments that contains `pos`.
 *
 * Returns { from: pos, to: pos } when no mark-bearing fragment contains `pos` (a click on
 * unmarked prose, an empty block, or a gap) — so the caller falls back to a zero-width range.
 */
export function contiguousMarkRun(fragments, pos) {
  if (!Array.isArray(fragments) || fragments.length === 0) return { from: pos, to: pos };

  // Find the mark-bearing fragment that contains the click. Boundary positions (pos === a
  // fragment's to === the next fragment's from) can match two fragments; prefer the marked one.
  let idx = -1;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    if (f && f.hasMark && f.from <= pos && pos <= f.to) { idx = i; break; }
  }
  if (idx === -1) return { from: pos, to: pos };

  let from = fragments[idx].from;
  let to = fragments[idx].to;

  // Expand left across contiguous marked fragments.
  for (let i = idx - 1; i >= 0; i--) {
    const f = fragments[i];
    if (f && f.hasMark && f.to === from) from = f.from;
    else break;
  }
  // Expand right across contiguous marked fragments.
  for (let i = idx + 1; i < fragments.length; i++) {
    const f = fragments[i];
    if (f && f.hasMark && f.from === to) to = f.to;
    else break;
  }

  return { from, to };
}
