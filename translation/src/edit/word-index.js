// Map a character offset within a segment's rendered text to the index of
// the word the click landed on. Pure + DOM-free so it can be unit-tested.
//
// Used by media-deck.js's click-to-seek: the editor finds the character
// offset where the click landed (via caretRangeFromPoint, or a proportional
// fallback), then this picks which word — and the caller looks up that word's
// start time and seeks the player there.
//
// The clicked word is the LAST whitespace-delimited token whose start index
// is at or before the offset. This is correct for the dominant case (a click
// inside a word's body) AND for a click on a word's leading edge:
//
//   text = "alpha beta gamma"   (word starts at 0, 6, 11)
//   offset 3  (inside "alpha")  -> starts<=3  = {0}        -> word 0
//   offset 8  (inside "beta")   -> starts<=8  = {0,6}      -> word 1
//   offset 6  (leading 'b')     -> starts<=6  = {0,6}      -> word 1
//   offset 0  (before any word) -> starts<=0  = {0}        -> word 0
//
// The previous implementation counted tokens that had *begun* before the
// offset and indexed by that count directly, which overshot a word's body
// click to the FOLLOWING word (an off-by-one on nearly every real click).
export function wordIndexFromCharOffset(text, offset, wordCount) {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  const s = String(text ?? '');
  const o = Math.max(0, Math.min(s.length, Number.isFinite(offset) ? Math.floor(offset) : 0));

  // Count whitespace-delimited tokens whose START index is <= the offset.
  let begun = 0;
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index <= o) begun++;
    else break; // matches arrive left-to-right; no later start can be <= o
  }

  // The clicked word is the last begun token; a click before the first word
  // (begun === 0) maps to word 0.
  const idx = begun === 0 ? 0 : begun - 1;
  return Math.max(0, Math.min(wordCount - 1, idx));
}
