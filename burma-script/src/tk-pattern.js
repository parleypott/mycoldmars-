// Burma Script Tool — the TK PATTERN (single source of truth).
//
// Johnny: "Anytime I just put TK alone in text I want it to turn a little red — no
// slash needed. And it swoops in everything in parentheses around it… And the whole
// row gets added to a workspace simply called TK."
//
// TWO detectors, ONE module, TWO consumers that must NEVER drift:
//   • extensions/tk-detect.js — the decoration-only paint (subtle red on the spans)
//   • workspaces.js           — the TK workspace membership predicate (row gathers)
// tk-detect.test.mjs pins both imports to THIS file so the paint and the workspace
// can never disagree about what "a TK" is.
//
// THE PATTERN — case-sensitive, upper only ("ATKINS"/"TKO"/lowercase "tk" never match):
//   (a) PARENTHETICAL — an opening paren whose content begins with TK swoops the WHOLE
//       '(TK …)' including both parens: "(TK musician's name)". Runs to the first ')'.
//   (b) BARE — \bTK\b standing alone, skipped when it sits inside a matched
//       parenthetical (the paren already swooped it — no double-paint).
//
// TEXTBLOCK COORDINATES: marks split text nodes, so a parenthetical can span several
// inline fragments. Detection therefore runs over a per-TEXTBLOCK positional string
// (textblockPositionalText): every doc position inside the block is exactly one char —
// text chars verbatim, non-text inline leaves (footnote atoms, chips) padded with
// U+FFFC so a range's string offsets map 1:1 onto block-relative doc offsets.
// This module is PM-schema-free — it only reads node.forEach/isText/text/nodeSize.

// The two regex SOURCES — consumers must build from these, never restate them.
export const TK_PAREN_SRC = String.raw`\(TK\b[^)]*\)`;
export const TK_BARE_SRC = String.raw`\bTK\b`;

/**
 * All TK ranges in a plain string, sorted by position.
 * Returns [{ from, to, kind: 'paren' | 'bare' }] in string offsets (to exclusive).
 * Bare hits inside a matched parenthetical are dropped (the paren owns them).
 */
export function findTkRanges(text) {
  const s = String(text || '');
  if (!s.includes('TK')) return []; // cheap fast-path for the common no-TK block
  const ranges = [];
  let m;
  const parenRe = new RegExp(TK_PAREN_SRC, 'g'); // no 'i' — case-sensitive by decree
  while ((m = parenRe.exec(s))) {
    ranges.push({ from: m.index, to: m.index + m[0].length, kind: 'paren' });
  }
  const bareRe = new RegExp(TK_BARE_SRC, 'g');
  while ((m = bareRe.exec(s))) {
    const from = m.index;
    const to = from + m[0].length;
    if (ranges.some((r) => from >= r.from && to <= r.to)) continue; // inside a paren swoop
    ranges.push({ from, to, kind: 'bare' });
  }
  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

/** Does this plain string carry the TK pattern at all? */
export function textHasTk(text) {
  return findTkRanges(text).length > 0;
}

// Placeholder for non-text inline leaves in the positional string (the object
// replacement character — never types, never collides with prose).
export const INLINE_LEAF_CHAR = '￼';

/**
 * The positional string of a TEXTBLOCK node: one char per doc position inside the
 * block, so findTkRanges offsets ARE block-relative offsets (add blockStart = pos + 1
 * for absolute doc positions). Text nodes contribute their text; any other inline
 * child contributes U+FFFC padding for its full nodeSize.
 */
export function textblockPositionalText(node) {
  let s = '';
  node.forEach((child) => {
    if (child.isText) s += child.text;
    else s += INLINE_LEAF_CHAR.repeat(child.nodeSize);
  });
  return s;
}

/**
 * The WORKSPACE membership probe for one textblock: does its positional text carry
 * the TK pattern? (Same coordinates as the paint — a "TK" glued together across a
 * block boundary or an atom is NOT a TK, in either surface.)
 */
export function textblockHasTk(node) {
  return textHasTk(textblockPositionalText(node));
}
