// Burma Script Tool — TRANSFER / COPY SECTION (whole-row node MOVE, position A → position B).
//
// Johnny (2026-07-24, chosen over a native cut/paste): select ~10 rows spanning BOTH columns,
// right-click → "transfer this section" (or "copy this section"), enter PLACEMENT MODE (the
// selected rows lift, every gap between rows glows), click a gap and the whole SECTION lands
// there. Transfer MOVES the rows (origin gap closes); copy DUPLICATES them (origin untouched,
// duplicates carry FRESH ids). This file is the LOAD-BEARING piece: the pure transaction engine.
// The right-click menu (convert-menu.js) and the placement overlay (row-placement.js) only decide
// WHICH rows move WHERE and call moveRowRange / copyRowRange — all doc mutation lives here.
//
// ── WHY THIS SHAPE ELIMINATES THE "MINI TWO-COLUMN NESTED IN A CELL" BUG BY CONSTRUCTION ─────────
// There is NO slice fitted into a cell. The moving unit is always whole top-level tableRow nodes
// (doc.child(i)), and the doc top level is `tableRow+`, so the insert can only land at a top-level
// boundary — a said|shown row can never be nested inside another row's cell. Same guarantee the
// SAME-PARENT law in moveRow (table.js) and dragSourceSanctioned enforce for row drags.
//
// ── SAFETY DOCTRINE (copied verbatim from chapter-reorder.js moveChapter) ────────────────────────
// TRANSFER is a PURE PERMUTATION of the EXISTING top-level tableRow nodes: cut the section's
// contiguous top-level row-node range and re-insert those SAME immutable node instances at the
// target boundary. We NEVER rebuild, reserialize, or re-derive a row or a block, so nothing carried
// by a row can be lost BY CONSTRUCTION (every blockId, cols/pairId + both cells of a split row,
// nested Palau rows, bookmarkId anchors). The whole move is ONE ProseMirror transaction → ONE undo
// restores byte-exact. Dev-asserted with assertReorderInvariant (it IS a permutation).
//
// COPY is the one real divergence: you CANNOT insert the same node instances (they carry blockIds;
// duplicating them creates DUPLICATE blockIds, breaking collectBlockIds uniqueness + any
// bookmarkId/anchor keyed on blockId). Copy DEEP-CLONES each moving row with FRESH ids — a new
// blockId per block (the canonical 'blk_' minter) and a fresh pairId per row (mintUserPairId), and
// DROPS any bookmarkId (a bookmark marks ONE place, never two). Origin is untouched (no delete).
// One tr, one insert, one undo. assertReorderInvariant does NOT apply; copy's invariant is
// after.rowCount === before.rowCount + moving.length AND every cloned blockId is new/unique.
//
// ── COLLAB (repo CLAUDE.md COLLAB LOOP LAW) ──────────────────────────────────────────────────────
// Burma + Palau run Liveblocks + Yjs. A transfer/copy is a LEGITIMATE user-initiated edit, but it
// must be ONE transaction dispatched on the user's gap-click. This file dispatches NOTHING on its
// own (no appendTransaction, no normalizer). Placement mode is EPHEMERAL decoration state
// (row-placement.js) that never mutates the doc. Rows are re-resolved by IDENTITY at click time
// (findRowByIdentity) so a remote edit that shifted positions while placement mode was open still
// moves the right band to the right gap. A refused / no-op call dispatches nothing.

import { Fragment } from '@tiptap/pm/model';
import { findRowByIdentity, mintUserPairId } from './table.js';
import { assertReorderInvariant } from './chapter-reorder.js';

// Canonical block-id minter — byte-identical to slash-menu.js mintBlockId / blocks.js so a cloned
// block's id is indistinguishable from a freshly-typed one.
function mintBlockId() {
  return 'blk_' + Math.random().toString(36).slice(2, 9);
}

// Top-level document position just before doc.child(index) (what tr.delete / tr.insert expect).
// index === doc.childCount → the very end of the doc. Mirrors chapter-reorder.js posOfChildIndex —
// TOP-LEVEL ONLY, which is exactly right: every insert target is a top-level row boundary.
export function posOfChildIndex(doc, index) {
  let pos = 0;
  for (let i = 0; i < index && i < doc.childCount; i++) pos += doc.child(i).nodeSize;
  return pos;
}

// The top-level child index whose leading boundary is exactly `pos` (the inverse of
// posOfChildIndex). Returns doc.childCount when pos is the doc end, or null when pos is not a
// top-level boundary (mid-node) — the depth-0 gate the whole row family enforces.
export function childIndexOfPos(doc, pos) {
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += doc.child(i).nodeSize;
  }
  if (cursor === pos) return doc.childCount; // doc-end boundary
  return null;
}

// Is dev? (Vite injects import.meta.env.DEV; guard for the plain-node test runtime.)
function isDev() {
  try { return !!(import.meta && import.meta.env && import.meta.env.DEV); } catch { return false; }
}

// ── resolveRowRange — rowRefs (identity triples) → the CONTIGUOUS top-level range they cover ──────
// Each ref is re-resolved to its CURRENT position via findRowByIdentity (collab-safe: a remote edit
// that shifted positions while placement mode was open still finds the right rows). Refs that
// vanished (deleted remotely) are dropped. The surviving rows' top-level child indices define the
// section as the CONTIGUOUS span [startIndex, endIndex) from the lowest to the highest resolved
// index — so the moving unit is always a clean top-level row range (moveChapter's shape). Returns
// null when nothing resolves. `movingNodes` are the SAME immutable node instances (transfer reuses
// them; copy clones from them).
export function resolveRowRange(doc, rowRefs) {
  if (!doc || !Array.isArray(rowRefs) || !rowRefs.length) return null;
  const indices = [];
  for (const ref of rowRefs) {
    const pos = findRowByIdentity(doc, ref);
    if (pos == null) continue;
    if (doc.resolve(pos).depth !== 0) continue;     // top-level rows only (depth-0 gate)
    const idx = childIndexOfPos(doc, pos);
    if (idx == null || idx >= doc.childCount) continue;
    if (doc.child(idx).type.name !== 'tableRow') continue;
    indices.push(idx);
  }
  if (!indices.length) return null;
  // min/max WITHOUT a spread: a section can span the whole doc (hundreds of rows), and
  // Math.min(...bigArray) risks a call-stack overflow on very large arrays (the repo's
  // spread-overflow gate). A plain fold is O(n) and unbounded-safe.
  let startIndex = indices[0];
  let endIndex = indices[0];
  for (const i of indices) { if (i < startIndex) startIndex = i; if (i > endIndex) endIndex = i; }
  endIndex += 1;                                     // exclusive
  const movingNodes = [];
  for (let i = startIndex; i < endIndex; i++) movingNodes.push(doc.child(i));
  return { startIndex, endIndex, movingNodes };
}

// A landing gap is legal for TRANSFER when it is a real top-level boundary that is NOT the section's
// own edges and NOT strictly inside the section (both would be a no-op or a nonsense self-nest).
// insertChildIndex ∈ [0, doc.childCount], refused when it falls in [startIndex, endIndex].
export function isLegalTransferTarget(doc, startIndex, endIndex, insertChildIndex) {
  if (!Number.isInteger(insertChildIndex)) return false;
  if (insertChildIndex < 0 || insertChildIndex > doc.childCount) return false;
  if (insertChildIndex >= startIndex && insertChildIndex <= endIndex) return false;
  return true;
}

// ── moveRowRange — TRANSFER (the one transaction) ────────────────────────────────────────────────
// Move the section covered by rowRefs so it sits at the top-level gap `insertChildIndex`. Pure
// (state, dispatch, rowRefs, insertChildIndex) -> boolean like every other row op — pass a dispatch
// to apply, pass none to probe legality. A refused / no-op returns false and dispatches NOTHING.
// The delete+insert core is lifted verbatim from moveChapter (cut the contiguous range, map the
// insert position past the delete, re-insert the SAME node instances).
export function moveRowRange(state, dispatch, rowRefs, insertChildIndex) {
  if (!state) return false;
  const { doc } = state;
  const range = resolveRowRange(doc, rowRefs);
  if (!range) return false;
  const { startIndex, endIndex, movingNodes } = range;
  if (!isLegalTransferTarget(doc, startIndex, endIndex, insertChildIndex)) return false;

  const posStart = posOfChildIndex(doc, startIndex);
  const posEnd = posOfChildIndex(doc, endIndex);
  const insertPos = posOfChildIndex(doc, insertChildIndex);

  if (dispatch) {
    const tr = state.tr;
    tr.delete(posStart, posEnd);
    const mapped = tr.mapping.map(insertPos);
    tr.insert(mapped, movingNodes);              // reuse the immutable nodes → lossless permutation
    tr.scrollIntoView();
    if (isDev()) {
      // frontMatterCount 0: a section move has no fixed front matter — we only assert the pure-
      // permutation core (same blockId multiset, same top-level row count).
      try { assertReorderInvariant(doc, tr.doc, 0); }
      catch (err) { console.error(err); throw err; }
    }
    dispatch(tr);
  }
  return true;
}

// Deep-clone a node re-minting every id it carries, so a duplicated section collides with nothing:
//   · blockId  → fresh 'blk_' id on every block that has one (chapterBlock included → a NEW chapter)
//   · pairId   → fresh pairu_ id on every row (top-level AND nested Palau rows)
//   · bookmarkId → dropped (a bookmark marks ONE spot; a copy must not answer to the original's link)
// Text nodes are immutable and carry no ids, so they are shared as-is (PM reuses text nodes freely).
// Marks ride untouched (a directionMark / timecode chip is content, not identity).
export function cloneWithFreshIds(node) {
  if (node.isText) return node;
  const kids = [];
  node.content.forEach((child) => kids.push(cloneWithFreshIds(child)));
  const attrs = { ...node.attrs };
  if (attrs.blockId) attrs.blockId = mintBlockId();
  if (attrs.pairId) attrs.pairId = mintUserPairId();
  if ('bookmarkId' in attrs && attrs.bookmarkId) attrs.bookmarkId = null;
  return node.type.create(attrs, Fragment.fromArray(kids), node.marks);
}

// ── copyRowRange — COPY (the one transaction) ────────────────────────────────────────────────────
// Duplicate the section covered by rowRefs at the top-level gap `insertChildIndex`, origin
// untouched. Clones carry FRESH ids (cloneWithFreshIds). Any real top-level boundary is a legal
// target (a copy never no-ops), including — unlike transfer — a gap adjacent to the origin; only a
// non-boundary / out-of-range index is refused. One tr, one insert, one undo.
export function copyRowRange(state, dispatch, rowRefs, insertChildIndex) {
  if (!state) return false;
  const { doc } = state;
  const range = resolveRowRange(doc, rowRefs);
  if (!range) return false;
  if (!Number.isInteger(insertChildIndex) || insertChildIndex < 0 || insertChildIndex > doc.childCount) return false;

  const clones = range.movingNodes.map((n) => cloneWithFreshIds(n));
  const insertPos = posOfChildIndex(doc, insertChildIndex);

  if (dispatch) {
    const tr = state.tr;
    tr.insert(insertPos, clones);
    tr.scrollIntoView();
    if (isDev()) {
      const grew = tr.doc.childCount === doc.childCount + clones.length;
      if (!grew) { const err = new Error('row-transfer(copy): row count did not grow by the cloned count'); console.error(err); throw err; }
    }
    dispatch(tr);
  }
  return true;
}
