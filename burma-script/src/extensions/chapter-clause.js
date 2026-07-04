// Pure chapter-label derivation for the vertical chapter sidebar.
//
// Extracted from chapter-frames.js so it can be unit-tested without
// pulling in tiptap/prosemirror + the DOM. The sidebar renders the
// result as a short, uppercase, letter-spaced VERTICAL tag in a 44px
// gutter — so the output must stay short. The whole contract of this
// function is "give me a SHORT clause": every return path is capped at
// MAX_CLAUSE_LEN characters.

export const MAX_CLAUSE_LEN = 36;

// Cap a string to MAX_CLAUSE_LEN, preferring the last word boundary so
// we don't slice mid-word. A single word longer than the cap is hard-cut.
function capToLength(s) {
  if (s.length <= MAX_CLAUSE_LEN) return s;
  const capped = s.slice(0, MAX_CLAUSE_LEN);
  const lastSpace = capped.lastIndexOf(' ');
  return (lastSpace > 0 ? capped.slice(0, lastSpace) : capped).trim();
}

export function shortChapterClause(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const clause = clean
    .replace(/^CH\b[:\s-]*/i, '')
    .replace(/^[A-Z ]+\b(?=\s+\d+\b)/, (hit) => hit.trim())
    .trim();
  // Primary path: cut at the first sentence break within the cap window.
  // .{1,36}? already guarantees <= MAX_CLAUSE_LEN.
  const cut = clause.match(/^(.{1,36}?)(?:[.:;!?]\s|$)/);
  if (cut?.[1]) return cut[1].trim();
  // Fallback: no early sentence break. Split on a hard delimiter
  // (double space / spaced dash / open paren), then STILL honor the
  // length cap — a long delimiter-less header must not run the vertical
  // label up the whole screen (the "short" contract, previously leaked).
  const rest = clause.split(/\s{2,}|\s[-–—]\s|\s\(/)[0].trim();
  return capToLength(rest);
}
