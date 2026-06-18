// Shared helper: strip a run of surrounding "quote" characters that an LLM
// sometimes wraps a short value in (a title, a synopsis, a name) even when
// asked for plain text. Single source of truth so the character class can
// never drift between call sites again.
//
// History: two divergent copies of this strip existed —
// qss-story-title.js (`/^["“”'']+|["“”'']+$/`) and qss-character-card.js
// cleanSynopsis (`/^["'“”]+|["'“”]+$/`). BOTH missed the curly SINGLE quotes
// ‘ (U+2018) and ’ (U+2019), which LLMs emit constantly under smart-quote
// styling — so a title the model returned as ‘Sparkle the Dragon’ kept its
// stray curly quotes and Henry saw them in his Storybook. Same incomplete
// character-class bug class fixed elsewhere in the repo (b-roll \b,
// voice-segmenter, mark-alias). This lib closes it for the quote-strip path.
//
// The full set of wrapping marks an LLM realistically uses:
//   "  straight double            U+0022
//   '  straight single            U+0027
//   `  backtick (code wrap)       U+0060
//   “  curly open double          U+201C
//   ”  curly close double         U+201D
//   ‘  curly open single          U+2018  ← was missing in both copies
//   ’  curly close single         U+2019  ← was missing in both copies

// All quote/wrap characters, as a regex character-class fragment.
export const QUOTE_CHARS = '"\'`“”‘’';

const LEADING = new RegExp(`^[${QUOTE_CHARS}]+`);
const TRAILING = new RegExp(`[${QUOTE_CHARS}]+$`);

// Strip a leading run and a trailing run of wrapping quotes. Only the OUTER
// edges are touched — an apostrophe inside the value ("Henry's Dragon") is
// left alone because it is neither leading nor trailing. Does not trim
// whitespace; callers control that (each existing call site already trims).
export function stripSurroundingQuotes(s) {
  return String(s == null ? '' : s).replace(LEADING, '').replace(TRAILING, '');
}
