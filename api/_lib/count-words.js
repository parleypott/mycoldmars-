// Count the words in a string — returning 0 for empty, whitespace-only, or
// non-string input.
//
// Why this exists: the naive idiom `text.split(/\s+/).length` has a silent
// off-by-one. Splitting an empty OR whitespace-only string yields a single
// empty token (`''.split(/\s+/)` → `['']`, length 1), so a "word count" built
// that way reports 1 word for content that has none. Summed in a loop, every
// empty field adds a phantom word.
//
// Real impact this fixes:
//  • api/gemini.js (The Hunter — Google-Docs script parser): a two-column
//    voice/visual beat with content in only ONE column counted a phantom word
//    for the empty cell, so the parsed script's wordCount ran high by ~1 per
//    single-column beat.
//  • queen-scarlet-school Book View: a scene's word count summed over its
//    blocks added 1 for every blank block, inflating the auto-advance dwell
//    (dwell = wordCount * 400ms).
//  • research narration/TTS stats: an empty narration reported "1 word".
//
// Splitting on /\s+/ AFTER trimming means runs of any whitespace collapse and
// leading/trailing space never produces empty tokens — the count equals the
// number of whitespace-separated tokens, which is what every caller wants.
export function countWords(text) {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
