// Burma Script Tool — CHAPTER REORDER ("modular mode").
//
// The OUTLINE view can flip into a modular mode where each chapter carries a drag grip; dragging
// a chapter up or down reorders it and the change lands in the actual script body. This file is
// the LOAD-BEARING piece: the pure transaction engine. The outline UI (main.jsx) only decides
// WHICH chapter moves WHERE and calls moveChapter — all doc mutation lives here.
//
// ── SAFETY DOCTRINE (Johnny: "very important it doesn't break") ────────────────────────────────
// A reorder is a PURE PERMUTATION of the EXISTING top-level tableRow nodes. We cut a chapter's
// contiguous top-level row-node range and re-insert those SAME immutable node instances at the
// target boundary — mirroring table.js moveRow (delete + insert the same node), generalized from
// one row to a RANGE of rows. We NEVER rebuild, reserialize, or re-derive a row or a block. Because
// the node instances travel untouched, nothing carried by a row can be lost BY CONSTRUCTION:
//   · every block's blockId survives (blocks are never re-created)
//   · a split row's cols/pairId + both cells survive (the row node is the same object)
//   · a Palau nested tableRow > tableCell > tableRow travels INSIDE its parent top-level row —
//     it is never addressed independently, so it can never be orphaned or reparented
//   · bookmarkId / anchors keyed on blockId still resolve (blockId is preserved)
// The whole move is ONE ProseMirror transaction → ONE undo restores byte-exact.
//
// ── DOC MODEL ──────────────────────────────────────────────────────────────────────────────────
// The doc is a flat sequence of top-level tableRow nodes. A CHAPTER = a row whose first own block
// is a chapterBlock, PLUS every following top-level row until the next chapterBlock row (or doc
// end). Rows before the first chapterBlock row = FRONT MATTER — it never moves.
//
// ── COLLAB ─────────────────────────────────────────────────────────────────────────────────────
// Burma + Palau run Liveblocks + Yjs. A reorder is a LEGITIMATE user-initiated edit (fine to sync),
// but it must be ONE transaction dispatched on the user's drop — this file dispatches NOTHING on
// its own (no appendTransaction, no normalizer). walkChapters is read-only. A refused / no-op move
// dispatches nothing, so a mis-drag can never churn autosave or the cloud snapshot.

// A top-level row's first OWN block — the block that decides whether the row opens a chapter.
// Deliberately does NOT descend into a nested tableRow (Palau nests said|shown rows inside a
// full-width row's cell; the wrapper is classified by its own first block, never its child row's).
function firstOwnBlockOfRow(row) {
  if (!row || row.type?.name !== 'tableRow') return null;
  const cell = row.firstChild;
  if (!cell || cell.type?.name !== 'tableCell') return null;
  const block = cell.firstChild;
  if (!block || block.type?.name === 'tableRow') return null;   // nested-row wrapper → not a chapter
  return block;
}

function rowIsChapterStart(row) {
  const block = firstOwnBlockOfRow(row);
  return !!(block && block.type?.name === 'chapterBlock');
}

// A row's first own block's blockId — the chapter's stable identity for re-resolution and for
// matching an outline entry (outline keys chapters by the chapterBlock's blockId).
function rowFirstOwnBlockId(row) {
  const block = firstOwnBlockOfRow(row);
  return block?.attrs?.blockId || null;
}

// The chapter title = the first paragraph's text of the chapterBlock (mirrors telemetry()'s outline
// title derivation closely enough for a drag label; the real outline title still comes from
// telemetry, this is only a convenience for engine callers/tests).
function chapterTitleOf(row) {
  const block = firstOwnBlockOfRow(row);
  if (!block) return '';
  const para = (block.content?.content || []).find((c) => c.type?.name === 'paragraph') || block;
  return (para.textContent || '').replace(/\s+/g, ' ').trim();
}

// ── walkChapters — the structural read of the doc ────────────────────────────────────────────────
// Returns, in document order, one entry per chapter:
//   { ordinal, title, startIndex, endIndex, rowCount, firstBlockId }
// where startIndex is the TOP-LEVEL row index of the chapterBlock row and endIndex is EXCLUSIVE
// (the next chapter's start, or the top-level row count). Also returns frontMatterCount = the row
// index of the first chapter (rows [0, frontMatterCount) are front matter and never move). Pure
// read; dispatches nothing. Exported for the outline UI and the headless suite.
export function walkChapters(doc) {
  const chapters = [];
  if (!doc) return { chapters, frontMatterCount: 0, rowCount: 0 };
  const rowCount = doc.childCount;
  let frontMatterCount = rowCount;   // if there are no chapters, everything is front matter

  // First pass: find every chapter-start row index.
  const starts = [];
  for (let i = 0; i < rowCount; i++) {
    if (rowIsChapterStart(doc.child(i))) starts.push(i);
  }
  if (starts.length) frontMatterCount = starts[0];

  for (let c = 0; c < starts.length; c++) {
    const startIndex = starts[c];
    const endIndex = c + 1 < starts.length ? starts[c + 1] : rowCount;
    const row = doc.child(startIndex);
    chapters.push({
      ordinal: String(c + 1).padStart(2, '0'),
      title: chapterTitleOf(row),
      startIndex,
      endIndex,
      rowCount: endIndex - startIndex,
      firstBlockId: rowFirstOwnBlockId(row),
    });
  }
  return { chapters, frontMatterCount, rowCount };
}

// Top-level document position just before doc.child(index) (what tr.delete / tr.insert expect).
// index === doc.childCount → the very end of the doc.
function posOfChildIndex(doc, index) {
  let pos = 0;
  for (let i = 0; i < index && i < doc.childCount; i++) pos += doc.child(i).nodeSize;
  return pos;
}

// The multiset of every blockId in a doc (dev invariant + tests). Sorted into a canonical order so
// two equal multisets compare equal element-wise regardless of original document order — the sort is
// an equality-key ordering ONLY, never rendered, so any deterministic total order works. blockIds
// are opaque STRINGS; the comparator is explicit lexical (never a bare .sort(), which would coerce
// and mislead a reader into thinking numeric order was intended — it isn't).
export function collectBlockIds(doc) {
  const ids = [];
  doc.descendants((node) => {
    const id = node.attrs?.blockId;
    if (id) ids.push(id);
    return true;
  });
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Dev-only invariant the engine asserts against its own output: the reorder is a pure permutation
// — same blockId multiset, same top-level row count, and the front-matter rows are byte-identical
// (unmoved). Throws in dev if violated (a loud failure beats a silent data-loss sync). Exported so
// the headless suite can assert it directly too.
export function assertReorderInvariant(beforeDoc, afterDoc, frontMatterCount) {
  const before = collectBlockIds(beforeDoc);
  const after = collectBlockIds(afterDoc);
  if (!sameMultiset(before, after)) {
    throw new Error(`chapter-reorder: blockId multiset changed (${before.length} → ${after.length}) — NOT a pure permutation`);
  }
  if (beforeDoc.childCount !== afterDoc.childCount) {
    throw new Error(`chapter-reorder: top-level row count changed (${beforeDoc.childCount} → ${afterDoc.childCount})`);
  }
  for (let i = 0; i < frontMatterCount; i++) {
    if (!beforeDoc.child(i).eq(afterDoc.child(i))) {
      throw new Error(`chapter-reorder: front-matter row ${i} moved/changed — front matter must stay put`);
    }
  }
  return true;
}

// Is dev? (Vite injects import.meta.env.DEV; guard for the plain-node test runtime.)
function isDev() {
  try { return !!(import.meta && import.meta.env && import.meta.env.DEV); } catch { return false; }
}

// ── moveChapter — the one transaction ────────────────────────────────────────────────────────────
// Move the chapter at fromChapterIndex to sit at toChapterIndex in the chapter ordering (standard
// array-move semantics: remove from fromChapterIndex, re-insert so it lands at toChapterIndex of
// the resulting list). Front matter is fixed; other chapters keep their relative order.
//
// Implemented as a PERMUTATION applied as delete-then-insert of the SAME node instances (mirrors
// table.js moveRow, generalized to a row RANGE):
//   1. cut the moving chapter's contiguous top-level row range [posStart, posEnd)
//   2. re-insert those SAME row nodes at the mapped target boundary
// Nothing is rebuilt from JSON, so every block/pairId/blockId/nested-row survives by construction
// and ONE undo restores byte-exact.
//
// Signature mirrors the other pure ops in the codebase: (state, dispatch, ...) -> boolean. Pass a
// dispatch to apply; pass none to probe legality. A no-op (same position, or an out-of-range index)
// returns false and dispatches NOTHING — a mis-drag never churns autosave or the cloud snapshot.
export function moveChapter(state, dispatch, fromChapterIndex, toChapterIndex) {
  if (!state) return false;
  const { doc } = state;
  const { chapters, frontMatterCount } = walkChapters(doc);
  const n = chapters.length;
  if (n < 2) return false;                                   // nothing to reorder
  if (!Number.isInteger(fromChapterIndex) || !Number.isInteger(toChapterIndex)) return false;
  if (fromChapterIndex < 0 || fromChapterIndex >= n) return false;
  if (toChapterIndex < 0 || toChapterIndex >= n) return false;
  if (fromChapterIndex === toChapterIndex) return false;     // no-op → dispatch nothing

  const from = chapters[fromChapterIndex];

  // The moving chapter's contiguous top-level row range (the SAME node instances travel).
  const movingNodes = [];
  for (let i = from.startIndex; i < from.endIndex; i++) movingNodes.push(doc.child(i));
  const posStart = posOfChildIndex(doc, from.startIndex);
  const posEnd = posOfChildIndex(doc, from.endIndex);

  // Where does it land? Remove the moving chapter from the list, then the target index selects the
  // chapter it should sit BEFORE in the reduced list (or the doc end when it lands last).
  const reduced = chapters.filter((_, i) => i !== fromChapterIndex);
  let insertChildIndex;
  if (toChapterIndex < reduced.length) insertChildIndex = reduced[toChapterIndex].startIndex;
  else insertChildIndex = doc.childCount;                    // lands after every remaining chapter
  const insertPos = posOfChildIndex(doc, insertChildIndex);

  // The anchor is always a DIFFERENT chapter (fromChapterIndex was removed), so insertPos is never
  // inside the deleted range. A landing exactly at the moving chapter's own start would be a no-op;
  // array-move with from !== to never produces that, but guard defensively.
  if (insertPos === posStart) return false;

  if (dispatch) {
    const tr = state.tr;
    tr.delete(posStart, posEnd);
    const mapped = tr.mapping.map(insertPos);
    tr.insert(mapped, movingNodes);                          // reuse the immutable nodes → lossless
    // Keep the moved chapter's heading in view after the move.
    tr.scrollIntoView();
    if (isDev()) {
      try { assertReorderInvariant(doc, tr.doc, frontMatterCount); }
      catch (err) { console.error(err); throw err; }         // dev: fail loud, never sync bad data
    }
    dispatch(tr);
  }
  return true;
}

// Convenience for the outline UI: resolve a chapter's index from its firstBlockId (the outline
// keys level-0 entries by the chapterBlock's blockId). Returns -1 if not found.
export function chapterIndexByBlockId(doc, blockId) {
  if (!blockId) return -1;
  const { chapters } = walkChapters(doc);
  return chapters.findIndex((c) => c.firstBlockId === blockId);
}
