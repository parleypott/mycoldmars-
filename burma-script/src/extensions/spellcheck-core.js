// Burma Script Tool — SPELLCHECK CORE (pure logic, NO heavy deps).
//
// Everything here is framework-free and dictionary-free so it unit-tests under bun without pulling
// the ~200KB Hunspell chunk (that lives in spellcheck-engine.js) or the editor graph (marks.js /
// @tiptap). The wiring layer (spellcheck.js) flattens a paragraph into { text, posOf } via
// marks.js inlineTextMap and hands the primitives here; the engine module (spellcheck-engine.js)
// calls loadPersonalDict / addToPersonalDictStore to seed and grow the personal dictionary.
//
// WORD MODEL: a "word" is a maximal run of letters (any Unicode script) plus INTERIOR apostrophes
// (' or ’) and hyphens — "don't", "mother-in-law", "Moharem". Leading/trailing apostrophes and
// hyphens are trimmed off ("dogs'" → "dogs", "—word" never fabricated). The two flattening
// sentinels inlineTextMap emits — '\n' between textblocks and '￼' (U+FFFC) for every inline node
// such as a timecode chip — are NOT word chars, so a walk stops dead at them and can never
// fabricate a word across a chip or a block boundary.

// GLOBAL, cross-episode key. mycoldmars shares ONE ~5MB localStorage budget across the whole .com
// origin, so the wp01_ prefix (matching edit-mode.js's wp01_edit_mode_pref) is mandatory to avoid
// collision. Global (not per-episode) is correct: Johnny's names — Moharem, Lulu, Aswan, Nile
// place-names — should stop flagging in EVERY script once he adds them.
export const PERSONAL_DICT_KEY = 'wp01_spell_dict_v1';

// Load the personal dictionary (array of strings). Defensive: any storage/parse failure → [] so a
// locked-down / private-browsing profile degrades to "nothing added yet" rather than throwing.
export function loadPersonalDict() {
  try {
    const raw = localStorage.getItem(PERSONAL_DICT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((w) => typeof w === 'string' && w) : [];
  } catch {
    return [];
  }
}

// Add a word to the personal dictionary (case-insensitive dedupe), persist, and return the new
// list. Storage failures swallow (return the current best-effort list) — never throw into a click
// handler. The live nspell instance is updated separately by the engine's addToPersonalDict.
export function addToPersonalDictStore(word) {
  const w = String(word == null ? '' : word).trim();
  if (!w) return loadPersonalDict();
  try {
    const cur = loadPersonalDict();
    if (!cur.some((x) => x.toLowerCase() === w.toLowerCase())) cur.push(w);
    localStorage.setItem(PERSONAL_DICT_KEY, JSON.stringify(cur));
    return cur;
  } catch {
    return loadPersonalDict();
  }
}

export function isInPersonalDict(word) {
  const w = String(word == null ? '' : word).toLowerCase();
  if (!w) return false;
  return loadPersonalDict().some((x) => x.toLowerCase() === w);
}

// Gate BEFORE hitting the dictionary: skip words we should never flag or offer a menu for. A word
// with a digit is a timecode/id fragment; a 1-char run is punctuation noise; a run with no letter
// (all apostrophes/hyphens after a bad walk) is not a word.
export function shouldCheck(word) {
  if (!word) return false;
  if (word.length < 2) return false;
  if (/\d/.test(word)) return false;
  if (!/\p{L}/u.test(word)) return false;
  return true;
}

// Word character: any Unicode letter, or an INTERIOR apostrophe/hyphen. NOT '\n' or '￼', so a walk
// naturally terminates at a block boundary or an inline chip.
export function isWordChar(ch) {
  return /\p{L}/u.test(ch) || ch === "'" || ch === '’' || ch === '-';
}

const EDGE_RE = /['’-]/; // apostrophe / right-single-quote / hyphen — trimmed at word edges

// Given a flattened block string and a hint index (the char under the pointer), return the word
// covering it — or the word ending immediately to its LEFT if the hint sits at a word's right edge
// (a right-click at the very end of a word resolves to the position AFTER its last char). Returns
// { lo, hi, word } of INDICES into `text`, or null when the hint is not on/adjacent to a word.
export function walkWord(text, hint) {
  const n = text.length;
  if (n === 0) return null;
  let i = hint;
  if (i > n) i = n;
  if (i < 0) i = 0;
  let start = -1;
  if (i < n && isWordChar(text[i])) start = i;
  else if (i - 1 >= 0 && i - 1 < n && isWordChar(text[i - 1])) start = i - 1;
  if (start < 0) return null;
  let lo = start;
  let hi = start;
  while (lo > 0 && isWordChar(text[lo - 1])) lo--;
  while (hi < n - 1 && isWordChar(text[hi + 1])) hi++;
  // Trim edge apostrophes/hyphens — they only count word-internally.
  while (lo <= hi && EDGE_RE.test(text[lo])) lo++;
  while (hi >= lo && EDGE_RE.test(text[hi])) hi--;
  if (hi < lo) return null;
  return { lo, hi, word: text.slice(lo, hi + 1) };
}

// Map a right-click doc position to the word under it, given the flattened block. `posOf[i]` is the
// doc position of char i; the clicked char is the one that STARTS at pos, or (for a click at a
// word's right edge) the char that ends at pos (posOf === pos - 1). Returns { word, wordFrom,
// wordTo } in DOC positions (wordTo is exclusive), or null. Positions of consecutive text chars are
// contiguous even across mark-split text nodes, so posOf[hi] + 1 is the correct exclusive end.
export function resolveWord(text, posOf, pos) {
  if (!Array.isArray(posOf) || posOf.length !== text.length) return null;
  let idx = posOf.indexOf(pos);
  if (idx < 0) idx = posOf.indexOf(pos - 1);
  if (idx < 0) return null;
  const w = walkWord(text, idx);
  if (!w) return null;
  return { word: w.word, wordFrom: posOf[w.lo], wordTo: posOf[w.hi] + 1 };
}

// THE DECISION. Pure so the "custom vs native-fallback vs no-menu" contract is locked by a test:
//   • misspelled + at least one suggestion → 'custom'  (preventDefault + our flat menu)
//   • misspelled + zero suggestions        → 'native'  (do NOT preventDefault → Chrome native menu)
//   • correctly spelled / in personal dict  → 'none'    (do NOT preventDefault → native, no takeover)
// 'native' and 'none' both mean "return false" at the call site; the split exists for clarity and
// so the never-a-dead-end fallback is provable.
export function spellDecision(misspelled, suggestionCount) {
  if (misspelled && suggestionCount > 0) return 'custom';
  if (misspelled) return 'native';
  return 'none';
}

// THE EARLY GUARD. The ordered set of conditions the contextmenu handler checks BEFORE it ever
// resolves a word — pulled out pure so the selection-emptiness gate (the one thing that keeps the
// bulk-tag / transfer / copy-section / column-scoped ConvertMenu reachable on a non-empty
// right-click) is locked by a test instead of living only in a comment. Returns a reason; ONLY
// 'proceed' means "take over — resolve the word and run spellDecision". Every other value means
// "return false" at the call site (yield to the native / timecode-narrowed / ConvertMenu chain).
// Order matters and mirrors the handler:
//   • read      — ?read share or a non-editable surface: no replace is possible, never take over
//   • selection — a NON-EMPTY selection belongs to ConvertMenu (registered AFTER us); we own ONLY
//                 the empty-selection (caret) right-click. This is the guard whose absence let
//                 spellcheck steal the bulk-convert / column-scope right-click.
//   • chip      — the pointer landed ON a timecode / legacy dchip, which owns its own menu
//   • cold      — the Hunspell chunk isn't warm yet: yield to native this once (caller warms it)
//   • proceed   — take over
export function contextmenuGuard({ readOnly, editable, selectionEmpty, onChip, engineReady }) {
  if (readOnly || !editable) return 'read';
  if (!selectionEmpty) return 'selection';
  if (onChip) return 'chip';
  if (!engineReady) return 'cold';
  return 'proceed';
}

// Build the ONE transaction that swaps [from,to] for `suggestion`, carrying the misspelled word's
// OWN marks (read off its text node) so bold / direction / span runs survive the replace. COLLAB
// SAFETY: if the live text at [from,to] no longer equals the word the menu was built for (a remote
// edit landed between open and pick), return null — never splice a stale range. `state` is the PM
// EditorState (only .doc.textBetween, .doc.nodeAt, .schema.text, .tr.replaceWith are touched), so
// this stays unit-testable with a tiny fake. Exactly one tr, one undo step, one autosave — no
// reactive appendTransaction that could echo-loop under Yjs.
export function buildReplaceTr(state, from, to, expectedWord, suggestion) {
  let cur = null;
  try { cur = state.doc.textBetween(from, to); } catch { return null; }
  if (expectedWord != null && cur !== expectedWord) return null;
  const marks = (state.doc.nodeAt(from) && state.doc.nodeAt(from).marks) || [];
  return state.tr.replaceWith(from, to, state.schema.text(String(suggestion), marks));
}
