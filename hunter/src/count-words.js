// Count the words in a string — returning 0 for empty, whitespace-only, or
// non-string input. Shared by the Hunter client (xml/script parsing) AND the
// worker's Google-Docs parser so the two can never silently drift.
//
// This is the hunter-bundle twin of api/_lib/count-words.js (the Vercel
// serverless copy). Both deploy contexts keep their own file — the worker and
// client ship in the vite bundle, the API ships in serverless — but their
// behavior is locked identical by count-words.test.mjs.
//
// Why the guard matters: the naive idiom `text.split(/\s+/).length` has a
// silent off-by-one — `''.split(/\s+/)` → `['']`, length 1 — so an empty field
// reports 1 phantom word. The worker's old inline copy used a
// `.filter(w => w.length > 0)` form that handled empty strings but had NO
// non-string guard, so it would THROW on a null/number field the moment a
// caller dropped its `|| ''` coercion. Trimming first + guarding non-strings
// makes the count equal the number of whitespace-separated tokens for every
// input, and 0 for junk — what every caller wants.
export function countWords(text) {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
