// Burma Script Tool — TABLE SPINE (WP-01 google-docs-style rows).
// SPINE BUILDER #3 approach: a CUSTOM lightweight row/cell node pair — NO prosemirror-tables.
//
// The document becomes a vertical stack of ROWS. Each tableRow holds one-or-more tableCell
// children; each tableCell holds the existing cartridge block content (block+). For the SPINE
// every row is ONE FULL-WIDTH cell wrapping a single cartridge — so the doc renders exactly
// like the old linear rack, but every block now lives inside the row/cell scaffold that the
// split/merge feature will later drive (LEFT = said / RIGHT = shown).
//
// SCHEMA (forward-compatible to 3 columns):
//   tableRow  : group 'block',  content 'tableCell+'   — a full-width band
//   tableCell : (no top-level group) content 'block+'  — wraps cartridge blocks
//
// DESIGN LAW: FLAT. No gridlines, no zebra, no shadow. A row is an invisible band; a SPLIT
// row gets exactly ONE hairline rule between its columns (a single 1px border-left on cells
// 2..n). Full-width rows show NO borders at all — they read identically to the old stack.

import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { episodeFlag } from '../episode-config.js';
import { isReadOnly } from '../read-mode.js';
import { setEditMode } from '../edit-mode.js';

// Row grips (split/merge + drag-reorder) are EDIT gestures, but the session starts in READ mode.
// Rather than sit dead in READ (Johnny: "the row dragger doesn't work, I click it and nothing
// happens"), grabbing a grip ARMS edit mode first — the same auto-arm the timecode right-click
// uses. Returns true once the surface is writable (already-editable, or just flipped). Only the
// URL `?read` SHARE stays truly frozen — a reader has no business reordering the author's script.
function armEditForRowGrip(view) {
  if (isReadOnly()) return false;      // real read-only share → never writable
  if (view.editable) return true;
  try { setEditMode(true); } catch {}  // sticky READ→EDIT flip; Editor calls setEditable synchronously
  return view.editable;
}

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Drag-to-reorder is gated by the episode's `rowDragReorder` feature flag. BOTH current
// episodes ship it (Burma AND Palau opt in via config) — episodes without the flag mount
// no handle and attach no listeners, so their drop behavior stays byte-identical.
function rowDragEnabled() {
  return episodeFlag('rowDragReorder');
}

// ---- ROW DRAG-TO-REORDER (PALAU) -----------------------------------------
// A grip on each row's FAR-LEFT gutter (further out than the split/merge spine). Grab it and
// drag a row up or down; on drop the dragged tableRow is MOVED to the new index in a SINGLE
// ProseMirror transaction (delete the row, then insert the very same node object at the target).
// docToBlocks() is order-based, so a reorder is perfectly lossless — same block count, every word
// and timecode preserved. A drop-indicator hairline shows where the row will land.
//
// OWNERSHIP LAW: the per-row handle only STARTS the gesture; everything after — indicator,
// autoscroll, target math, the drop itself — is owned by ONE editor-level plugin
// (rowDragPlugin below). The first version wired dragover/drop onto each row's own nodeView
// DOM, so the gesture only worked when the pointer happened to be over another row's box;
// everywhere else (chapter-frame margins, page padding, below the last row) the drop bubbled
// to ProseMirror's OWN drop handler, which — with view.dragging null — parsed the dataTransfer
// and INSERTED its literal 'wp-row' text payload into the script while the dragged row stayed
// put. Under collab that junk synced to every teammate instantly and y-undo (own-changes-only)
// couldn't pull it back. No phase of a row drag may ever fall through to PM's paste machinery.
//
// Module-scoped drag state, shared by the handles and the plugin (same module):
let draggingRow = null;      // { node, blockId, pairId } — the row's IDENTITY, never a raw position
let indicatorDom = null;     // the row DOM currently showing a drop line

function clearDropIndicator() {
  if (indicatorDom) {
    indicatorDom.classList.remove('wp-drop-before', 'wp-drop-after');
    indicatorDom = null;
  }
}

function setDropIndicator(dom, before) {
  if (indicatorDom && indicatorDom !== dom) clearDropIndicator();
  indicatorDom = dom;
  dom.classList.toggle('wp-drop-before', before);
  dom.classList.toggle('wp-drop-after', !before);
}

// Move the row at fromPos to sit before/after the row at targetPos — one lossless transaction
// (delete the row, then re-insert the very same immutable node at the mapped target: nothing is
// rebuilt from JSON, so every word, attr and timecode survives and ONE undo restores byte-exact).
// Pure (state, dispatch, ...) -> boolean like doSplitRow/doMergeRow, so it composes and tests
// headlessly. Works at ANY depth as long as both rows share the SAME parent — top-level Burma
// rows, or Palau's nested tableRow > tableCell > tableRow siblings; a cross-parent drop is
// refused rather than guessed at. A refused/no-op move dispatches NOTHING, so failed drags can
// never trigger autosave or cloud-snapshot churn.
export function moveRow(state, dispatch, fromPos, targetPos, dropBefore) {
  if (!state || fromPos == null || targetPos == null) return false;
  const { doc } = state;
  if (fromPos < 0 || targetPos < 0 || fromPos > doc.content.size || targetPos > doc.content.size) return false;
  const source = doc.nodeAt(fromPos);
  const target = doc.nodeAt(targetPos);
  if (!source || source.type.name !== 'tableRow') return false;
  if (!target || target.type.name !== 'tableRow') return false;
  // SAME-PARENT law: a reorder swaps places among siblings. Requiring the identical parent
  // node (and depth) refuses cross-cell / cross-depth drops outright — a row can never be
  // teleported INTO another row's cell by this path.
  const $from = doc.resolve(fromPos);
  const $target = doc.resolve(targetPos);
  if ($from.depth !== $target.depth || $from.parent !== $target.parent) return false;
  const size = source.nodeSize;
  const insertPos = dropBefore ? targetPos : targetPos + target.nodeSize;
  // No-op when the drop lands inside the source row's own span (drop onto itself / its own edges).
  if (insertPos >= fromPos && insertPos <= fromPos + size) return false;
  if (dispatch) {
    const tr = state.tr;
    tr.delete(fromPos, fromPos + size);
    const mapped = tr.mapping.map(insertPos);
    tr.insert(mapped, source);            // reuse the immutable node → nothing is lost
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// A row's first OWN cartridge blockId — its stable identity for re-resolution at drop time.
// Deliberately does NOT descend into a nested tableRow: those ids identify the nested row
// itself, not its wrapper (Palau's saved shape nests said|shown rows inside a full-width
// row's cell, and the wrapper must never answer to its child's identity).
export function rowFirstBlockId(row) {
  if (!row) return null;
  for (let c = 0; c < row.childCount; c++) {
    const cell = row.child(c);
    if (cell.type.name !== 'tableCell') continue;
    for (let b = 0; b < cell.childCount; b++) {
      const blk = cell.child(b);
      if (blk.type.name === 'tableRow') continue;
      if (blk.attrs && blk.attrs.blockId) return blk.attrs.blockId;
    }
  }
  return null;
}

// Re-resolve the dragged row's CURRENT position. Positions captured at dragstart go stale the
// moment anything edits the doc — under collab (Liveblocks + Yjs is ON for Burma and Palau) a
// remote edit mid-drag shifts every position after it, and a raw fromPos drop then moves the
// WRONG row. Identity survives where positions don't: prefer the exact node reference (===,
// PM nodes are immutable and reused across unrelated transactions), then the first-block
// blockId, then the row's pairId. Null when the row is gone (deleted mid-drag) — the drop
// simply becomes a handled no-op.
export function findRowByIdentity(doc, ref) {
  if (!doc || !ref) return null;
  let byIdentity = null;
  let byBlockId = null;
  let byPairId = null;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'tableRow') return true;
    if (byIdentity == null && node === ref.node) byIdentity = pos;
    if (byBlockId == null && ref.blockId && rowFirstBlockId(node) === ref.blockId) byBlockId = pos;
    if (byPairId == null && ref.pairId && node.attrs?.pairId === ref.pairId) byPairId = pos;
    return true;   // keep descending — nested rows are a real saved shape (Palau)
  });
  return byIdentity ?? byBlockId ?? byPairId ?? null;
}

// Map a pointer Y to a drop boundary given the candidate rows' client rects (document order).
// Pure so the dead-zone arithmetic is unit-testable: above a row's midpoint => before that
// row; below the LAST row's midpoint => after the last row. The gaps BETWEEN rows (the 30px
// chapter-frame margins, page padding, the run-out below the final row) therefore always
// resolve to the nearest boundary — no dead zone is left for a drop to escape through.
export function pickRowDropTarget(rects, clientY) {
  if (!Array.isArray(rects) || !rects.length) return null;
  for (let i = 0; i < rects.length; i++) {
    if (clientY < (rects[i].top + rects[i].bottom) / 2) return { index: i, before: true };
  }
  return { index: rects.length - 1, before: false };
}

// Resolve the full drop for a live view: where the dragged row is NOW (identity, not stale
// position), which siblings can take it (same parent only), and which boundary sits under
// the pointer. Candidates are measured through the view's nodeDOM rects, so what the user
// sees is exactly what the math uses.
function findDropTargetForDrag(view, ref, clientY) {
  const fromPos = findRowByIdentity(view.state.doc, ref);
  if (fromPos == null) return null;
  const $from = view.state.doc.resolve(fromPos);
  const parent = $from.parent;
  const rects = [];
  const positions = [];
  let childPos = $from.start($from.depth);
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (child.type.name === 'tableRow') {
      const dom = view.nodeDOM(childPos);
      if (dom && typeof dom.getBoundingClientRect === 'function') {
        const r = dom.getBoundingClientRect();
        rects.push({ top: r.top, bottom: r.bottom });
        positions.push(childPos);
      }
    }
    childPos += child.nodeSize;
  }
  const picked = pickRowDropTarget(rects, clientY);
  if (!picked) return null;
  return { fromPos, targetPos: positions[picked.index], before: picked.before };
}

// ---- the editor-owned drag plugin ----------------------------------------
// Registered via TableRow.addProseMirrorPlugins(), gated by the same rowDragReorder flag as
// the grip: no grip, no gesture, no plugin. Capture-phase listeners on the editor DOM run
// BEFORE Dropcursor's and PM's own bubble-phase handlers; stopPropagation() silences those
// for ROW drags only — text and block drags keep their native indicator and machinery
// completely untouched. So during a row drag exactly ONE indicator shows (our hairline),
// never Dropcursor's red line inviting a corrupting drop into a gap.
const rowDragKey = new PluginKey('wpRowDrag');

// THE ONLY SANCTIONED DRAG INITIATORS inside the editor: the row grip (.wp-row-drag), the block
// cartridge grip (blocks.js's [data-drag-handle] .wp-grip), and a media figure (.wp-image — the
// imageBlock nodeview). Johnny 2026-07-21: "under no circumstances do I want the row to break out
// of the two column experience… I should be able to click anywhere within the cell and drag and
// all it does is highlight." So ANY native dragstart whose target is inside a row but NOT on a
// sanctioned surface is an accident — a selected-text drag, a stray <img> drag, a browser-invented
// drag — and gets preventDefault'd before ProseMirror or the browser can turn it into a
// structure-mutating drop.
//
// .wp-image is safe to sanction (Johnny 2026-07-22, "click and MOVE images easily"): the imageBlock
// is an atom (group:block, draggable:true), so PM arms a NODE drag of the image ALONE — never the
// row. The doc top level is tableRow+, so PM's drop can only land the block inside a cell (block+),
// never as a stray top-level node: the schema keeps the two-column structure intact by construction.
// Pure predicate, exported for the headless suite.
export function dragSourceSanctioned(target) {
  return !!(target && typeof target.closest === 'function'
    && target.closest('.wp-row-drag, [data-drag-handle], .wp-grip, .wp-image'));
}

// Edge autoscroll: dragover fires continuously, so a small per-event nudge near the viewport
// edges lets a row travel the full length of a 260-row doc without dropping the grip.
const AUTOSCROLL_EDGE = 80;
const AUTOSCROLL_STEP = 14;

function rowDragPlugin() {
  return new Plugin({
    key: rowDragKey,
    props: {
      // Belt-and-braces: while a row drag is live, PM's drop path must NEVER parse the
      // dataTransfer (that was the junk-text-insertion bug). The capture listener below
      // normally swallows the drop before PM sees it; if any path still reaches PM's
      // handleDrop, returning true UNCONDITIONALLY — even for a no-op — closes it.
      handleDrop(view, event) {
        if (!draggingRow) return false;
        const ref = draggingRow;
        draggingRow = null;
        clearDropIndicator();
        const t = findDropTargetForDrag(view, ref, event.clientY);
        if (t) moveRow(view.state, view.dispatch, t.fromPos, t.targetPos, t.before);
        return true;
      },
    },
    view(editorView) {
      // FIX 1 (Johnny 2026-07-21, "two broken things"): pointer-down + drag INSIDE any cell must
      // do text selection ONLY. Capture-phase, so it runs BEFORE the grips' own target-phase
      // dragstart listeners (which we exempt via dragSourceSanctioned) and before ProseMirror's
      // bubble-phase dragstart could arm view.dragging with a slice that a drop could then nest
      // somewhere illegal. Belt-and-braces with TableRow's spec draggable:false below — that kills
      // PM's own row-drag arming; this kills the browser's native selected-text/img drag vector.
      const onDragstartCapture = (e) => {
        const t = e.target;
        if (dragSourceSanctioned(t)) return;   // the grips keep their native drags
        if (!(t && typeof t.closest === 'function' && t.closest('[data-trow]'))) return;
        e.preventDefault();
        e.stopPropagation();
      };
      const onDragover = (e) => {
        if (!draggingRow) return;
        e.preventDefault();      // preventDefault on dragover is what makes the drop legal here
        e.stopPropagation();     // capture-phase: Dropcursor + PM bubble handlers never fire
        try { e.dataTransfer.dropEffect = 'move'; } catch (_err) {}
        if (e.clientY < AUTOSCROLL_EDGE) window.scrollBy(0, -AUTOSCROLL_STEP);
        else if (e.clientY > window.innerHeight - AUTOSCROLL_EDGE) window.scrollBy(0, AUTOSCROLL_STEP);
        const t = findDropTargetForDrag(editorView, draggingRow, e.clientY);
        // No indicator when hovering the source row itself (a drop there is a no-op anyway).
        if (!t || t.targetPos === t.fromPos) { clearDropIndicator(); return; }
        const dom = editorView.nodeDOM(t.targetPos);
        if (dom && dom.classList) setDropIndicator(dom, t.before);
        else clearDropIndicator();
      };
      const onDrop = (e) => {
        if (!draggingRow) return;
        e.preventDefault();
        e.stopPropagation();     // PM's drop handler never sees a row drop → no parse path at all
        const ref = draggingRow;
        draggingRow = null;
        clearDropIndicator();
        const t = findDropTargetForDrag(editorView, ref, e.clientY);
        if (t) moveRow(editorView.state, editorView.dispatch, t.fromPos, t.targetPos, t.before);
      };
      editorView.dom.addEventListener('dragstart', onDragstartCapture, true);
      editorView.dom.addEventListener('dragover', onDragover, true);
      editorView.dom.addEventListener('drop', onDrop, true);
      return {
        destroy() {
          editorView.dom.removeEventListener('dragstart', onDragstartCapture, true);
          editorView.dom.removeEventListener('dragover', onDragover, true);
          editorView.dom.removeEventListener('drop', onDrop, true);
          clearDropIndicator();
          draggingRow = null;
        },
      };
    },
  });
}

// ---- SPLIT / MERGE TRANSACTIONS (THE GESTURE) ----------------------------
// The whole point of the table spine: turn a FULL-WIDTH row (what's said AND shown
// jammed into one column) into a TWO-COLUMN row — LEFT keeps every word as "what's
// said" (role:said), RIGHT is a fresh empty "what's shown" lane (role:shown), cursor
// ready. And back again, losslessly. Both are ONE ProseMirror transaction; no word
// is ever destroyed in either direction.
//
// These are pure (state, dispatch) -> boolean ops so they read like native PM commands
// and compose into TipTap's chain. They resolve the row at `rowPos` (the position
// JUST BEFORE the tableRow node), validate its shape, then build the new row content
// and replace the whole row in one tr.replaceWith.

// Build an empty paragraph node from the schema (what the SHOWN lane opens with).
function emptyParagraph(schema) {
  return schema.nodes.paragraph.createAndFill();
}

// SPLIT: cols:1 / one cell role:full  ->  cols:2 / [said(all content), shown(empty)].
// The existing cell KEEPS every block it holds (no word loss) and is relabeled said;
// a brand-new shown cell with one empty paragraph is inserted to its right. Returns
// false (no-op) if the row is already split or isn't a clean full-width row.
export function doSplitRow(state, dispatch, rowPos) {
  const { schema, doc, tr } = { schema: state.schema, doc: state.doc, tr: state.tr };
  const row = doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;
  // Only split a genuine full-width row: exactly one cell.
  if (row.childCount !== 1) return false;
  const cellType = schema.nodes.tableCell;
  const rowType = schema.nodes.tableRow;
  if (!cellType || !rowType) return false;

  const saidCell = row.child(0);
  // LEFT cell: same content, relabeled said. RIGHT cell: empty paragraph, role shown.
  const left = cellType.create({ ...saidCell.attrs, role: 'said' }, saidCell.content);
  const right = cellType.create({ role: 'shown' }, emptyParagraph(schema));
  const newRow = rowType.create({ ...row.attrs, cols: 2 }, [left, right]);

  if (dispatch) {
    tr.replaceWith(rowPos, rowPos + row.nodeSize, newRow);
    // Drop the cursor at the START of the new SHOWN cell so the author can type "what's
    // shown" immediately. The shown cell's first text position is after: row open (+1),
    // the whole LEFT cell (left.nodeSize), the shown cell open (+1), its paragraph open (+1).
    const shownInner = rowPos + 1 + left.nodeSize + 1 + 1;
    try {
      const sel = TextSelection.create(tr.doc, Math.min(shownInner, tr.doc.content.size));
      tr.setSelection(sel);
    } catch {}
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// MERGE: cols:2 / [said, shown]  ->  cols:1 / one cell role:full holding said's blocks
// THEN shown's blocks (reading order: what was said, then what was shown). If the shown
// lane only holds a single empty paragraph it's dropped (nothing to keep); otherwise all
// of its blocks are concatenated onto the said lane so NO words are lost. Returns false
// for a row that isn't a clean 2-cell split.
export function doMergeRow(state, dispatch, rowPos) {
  const { schema, doc, tr } = { schema: state.schema, doc: state.doc, tr: state.tr };
  const row = doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;
  if (row.childCount < 2) return false;
  const cellType = schema.nodes.tableCell;
  const rowType = schema.nodes.tableRow;
  if (!cellType || !rowType) return false;

  // Gather every block from every cell, in column (reading) order: said first, then shown.
  const blocks = [];
  row.forEach((cell) => { cell.forEach((blk) => blocks.push(blk)); });

  // Is the SHOWN lane just an empty paragraph? Then it carries no words — drop it cleanly.
  // We rebuild from the FIRST cell's blocks + any non-empty blocks from later cells.
  const kept = [];
  row.forEach((cell, _offset, cellIndex) => {
    cell.forEach((blk) => {
      const isEmptyPara = blk.type.name === 'paragraph' && blk.content.size === 0;
      // Keep all blocks from the first (said) cell verbatim. From later cells, keep every
      // block that carries content; skip a lone empty placeholder paragraph (no words).
      if (cellIndex === 0) kept.push(blk);
      else if (!isEmptyPara) kept.push(blk);
    });
  });
  const finalBlocks = kept.length ? kept : blocks;

  const fullCell = cellType.create({ role: 'full' }, finalBlocks);
  const newRow = rowType.create({ ...row.attrs, cols: 1 }, [fullCell]);

  if (dispatch) {
    tr.replaceWith(rowPos, rowPos + row.nodeSize, newRow);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// ---- ADD ROWS BELOW (THE ROW TOOL) ---------------------------------------
// A tiny "+" at the bottom edge of every row. Click = ONE empty row below; right-click = a
// small menu to add 1 / 5 / 10 / 20 at once. The inserted rows MATCH the source row's column
// structure — below a 2-column said|shown row you get a fresh empty said|shown pair (cursor
// ready in the said lane); below a full-width row you get a fresh full-width row. One
// ProseMirror transaction per gesture, so undo pulls all N rows back out in one step and
// autosave/backup fire exactly as for any other edit.
//
// pairu_ pairIds — every inserted row is stamped with a `pairu_` (user-added) pairId. Paired
// rows need a pairId anyway for the said|shown blocks to round-trip docToBlocks →
// buildEditorDocument as ONE row; the pairu_ prefix ALSO marks the row as deliberately
// user-added, which document-builder's Palau load-normalizer reads to KEEP a still-empty
// added row instead of culling it as a stray word-less grid band. The row persists until
// the author types into it or deletes it.
let mintCounter = 0;
export function mintUserPairId() {
  mintCounter = (mintCounter + 1) % 1e6;
  return `pairu_${Date.now().toString(36)}_${mintCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Insert `count` empty rows directly below the row at rowPos, cloning its column structure
// (same cell count, same role per cell, one empty paragraph per cell). Pure
// (state, dispatch) -> boolean like doSplitRow/doMergeRow. Count is clamped to 1..50.
//
// DEPTH: rows are usually top-level, but Palau's real saved doc NESTS its said|shown rows
// inside a wrapper row's cell (tableRow > tableCell > tableRow — the schema allows it,
// tableRow is group:'block' and cells hold block+). Like moveRow (same-parent, any depth),
// this inserts the new rows as SIBLINGS of the source row at WHATEVER depth it lives:
// below a nested 2-col row you get a nested 2-col row, inside the same cell. The insert
// is schema-checked; an impossible parent returns false instead of throwing mid-chain.
export function doAddRowsBelow(state, dispatch, rowPos, count = 1) {
  const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
  const { schema, doc, tr } = { schema: state.schema, doc: state.doc, tr: state.tr };
  if (typeof rowPos !== 'number' || rowPos < 0 || rowPos > doc.content.size) return false;
  const row = doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;
  const cellType = schema.nodes.tableCell;
  const rowType = schema.nodes.tableRow;
  if (!cellType || !rowType) return false;

  const roles = [];
  row.forEach((cell) => roles.push(cell.attrs?.role || 'full'));
  if (!roles.length) roles.push('full');

  const rows = [];
  for (let i = 0; i < n; i++) {
    const cells = roles.map((role) => cellType.create({ role }, emptyParagraph(schema)));
    rows.push(rowType.create({ cols: cells.length, pairId: mintUserPairId() }, cells));
  }

  // The parent (doc, or a cell for nested rows) must accept tableRow siblings here.
  const $row = doc.resolve(rowPos);
  const index = $row.index($row.depth);
  if (!$row.parent.canReplaceWith(index + 1, index + 1, rowType)) return false;

  if (dispatch) {
    const insertAt = rowPos + row.nodeSize;
    tr.insert(insertAt, rows);
    // Cursor into the FIRST new row's FIRST cell (the said lane on a split row): row open (+1),
    // cell open (+1), paragraph open (+1).
    try {
      const sel = TextSelection.create(tr.doc, Math.min(insertAt + 3, tr.doc.content.size));
      tr.setSelection(sel);
    } catch {}
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// ---- BOOKMARKS (right-click the ⊟/⊞ box → "Bookmark") ----------------------
// Johnny: "I want to be able to make bookmarks by right clicking on the divider icon … it adds
// a bookmark symbol that when clicked copies the link that will bring someone right to that
// part of the script." A bookmark is a `bookmarkId` attr on the tableRow — additive with a
// null default, exactly the pairId precedent (declared-attr nulls are covered as safe by the
// migration/round-trip suites), so it persists in the saved doc, rides the Yjs room to every
// teammate, and survives reorder/undo like any other attr. The row NodeView paints a ⚑ glyph
// in the left gutter; clicking the glyph copies the deep link. On load, main.jsx reads the
// `?bm=` param and scrolls the matching row into view.
let bmCounter = 0;
export function mintBookmarkId() {
  bmCounter = (bmCounter + 1) % 1e6;
  return `bm_${Date.now().toString(36)}_${bmCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Set (or clear, with null) the bookmark on the row at rowPos. Pure (state, dispatch) ->
// boolean like the other row ops, exported for the headless suite. setNodeMarkup keeps the
// row's content byte-identical — only the attr changes — so undo restores exactly.
export function doSetRowBookmark(state, dispatch, rowPos, bookmarkId) {
  const { doc, tr } = state;
  if (typeof rowPos !== 'number' || rowPos < 0 || rowPos > doc.content.size) return false;
  const row = doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;
  if (dispatch) dispatch(tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, bookmarkId: bookmarkId || null }));
  return true;
}

// Build the shareable deep link for a bookmark from the CURRENT location. The library router
// keeps the project slug in the hash (`…/scripts-library/#burma`) and already strips hash-
// queries (`#burma?backups`), so when a hash exists the `bm` param rides INSIDE it; a plain
// URL gets a normal search param. Any existing `bm` (either side) is replaced, and the rest of
// the URL — including a `?read` share flag — is preserved verbatim, so a bookmark link keeps
// whatever access mode it was minted from. Pure(loc) for the suite.
export function buildBookmarkUrl(bookmarkId, loc) {
  const l = loc || (typeof window !== 'undefined' ? window.location : {});
  const origin = l.origin || '';
  const pathname = l.pathname || '';
  let search = l.search || '';
  let hash = l.hash || '';
  const withParam = (qs, set) => {
    const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
    params.delete('bm');
    if (set) params.set('bm', bookmarkId);
    const s = params.toString();
    return s ? '?' + s : '';
  };
  if (hash) {
    const qi = hash.indexOf('?');
    const base = qi >= 0 ? hash.slice(0, qi) : hash;
    hash = base + withParam(qi >= 0 ? hash.slice(qi) : '', true);
    if (search) search = withParam(search, false); // never carry a duplicate bm in the search
  } else {
    search = withParam(search, true);
  }
  return origin + pathname + search + hash;
}

// Build the canonical READ-ONLY SHARE link for this script. Unlike buildBookmarkUrl (which
// preserves whatever access mode you copied from — so an edit-mode copy stays editable), this
// ALWAYS forces the standalone read door: origin + /burma-script/?read, optionally deep-linking
// to a bookmark with &bm=. Anyone who opens it views the script read-only and has NO path to the
// library. The link IS the capability (exactly like the ?read shares already work) — no backend,
// no per-recipient state. Pure(loc) for the suite.
export function buildShareUrl({ bm } = {}, loc) {
  const l = loc || (typeof window !== 'undefined' ? window.location : {});
  const origin = l.origin || '';
  return origin + '/burma-script/?read' + (bm ? '&bm=' + encodeURIComponent(bm) : '');
}

// Copy any URL to the clipboard + confirm with the shared toast (the label shows in the pill).
// Clipboard access can be denied (permissions / non-secure context) — then say so honestly,
// never a false green.
export function copyShareLink(url, label) {
  const done = () => { try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tc: label } })); } catch {} };
  const fail = () => { try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: 'could not copy — your browser blocked the clipboard' } })); } catch {} };
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  } catch { fail(); }
}

// Copy a bookmark's link. Johnny's rule: sharing applies to bookmarks too — so this hands out a
// READ-ONLY SHARE link (buildShareUrl), not the mode-preserving buildBookmarkUrl. Opening it drops
// the recipient into the read-only view scrolled straight to this bookmark, with no library access.
function copyBookmarkLink(bookmarkId) {
  copyShareLink(buildShareUrl({ bm: bookmarkId }), 'BOOKMARK LINK');
}

// ── INLINE BOOKMARK (Johnny 2026-07-08) ─────────────────────────────────────────────────────
// A tiny clickable BLUE bookmark you can drop ANYWHERE — mid-sentence, mid-cell — via /bookmark.
// It is an inline ATOM: a place-marker that carries only a bookmarkId. Because it is a normal
// inline insert at the caret, it CANNOT disturb the row/cell it lives in (unlike the old row-attr
// bookmark, whose setNodeMarkup re-render is what "destroyed the formatting"). It renders a
// `data-bookmark-id`, so the existing `?bm=` deep-link resolver (main.jsx querySelector on
// [data-bookmark-id]) finds and scrolls to it with zero extra wiring. Click = copy the deep link.
// Alive in read mode + `?read` shares: copying a link is a reading affordance, not a write.
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      bookmarkId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-bookmark-id') || null,
        renderHTML: (attrs) => (attrs.bookmarkId ? { 'data-bookmark-id': attrs.bookmarkId } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-bookmark]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-bookmark': '', class: 'wp-bookmark' }, HTMLAttributes), '⌂'];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('span', 'wp-bookmark', {
        'data-bookmark': '', contenteditable: 'false', role: 'button',
        title: 'Bookmark — click to copy the link to this spot', 'aria-label': 'copy bookmark link',
      });
      if (node.attrs.bookmarkId) dom.setAttribute('data-bookmark-id', node.attrs.bookmarkId);
      // crisp inline SVG ribbon, doctrine blue — never red (red is reserved for fact-check).
      dom.innerHTML =
        '<svg viewBox="0 0 16 16" width="12" height="14" aria-hidden="true">'
        + '<path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" class="wp-bookmark-shape"/>'
        + '</svg>';
      const copyLive = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        const cur = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
        copyBookmarkLink(cur?.attrs?.bookmarkId || node.attrs.bookmarkId);
      };
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        copyLive();
      });
      dom.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault(); e.stopPropagation();
        copyLive();
      });
      return { dom, update: (updated) => updated.type.name === 'bookmark', ignoreMutation: () => true };
    };
  },
});

// /bookmark — drop an inline bookmark at the caret and copy its deep link. Mid-sentence is fine:
// it's a normal inline insert. `range` (the "/bookmark" trigger span) is deleted first when the
// slash menu calls this; a direct call with no range just inserts at the current selection.
export function insertBookmark(editor, range) {
  if (editor.view.editable === false) return false;
  const id = mintBookmarkId();
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  const ok = chain.insertContent({ type: 'bookmark', attrs: { bookmarkId: id } }).run();
  if (ok) copyBookmarkLink(id);
  return ok;
}

// Drop an inline bookmark at the START of the row at rowPos (the row-menu "Bookmark" path). This
// REPLACES the old row-attr bookmark, whose setNodeMarkup re-render disturbed the row Johnny was
// working in. Insert-at-a-position never re-markups the row, so formatting is untouched.
export function insertBookmarkAtRow(editor, rowPos) {
  if (editor.view.editable === false) return false;
  const row = editor.state.doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;
  // first inline position inside the row (start of its first textblock)
  let target = null;
  row.descendants((n, off) => {
    if (target != null) return false;
    if (n.isTextblock) { target = rowPos + 1 + off + 1; return false; }
    return true;
  });
  if (target == null) return false;
  const id = mintBookmarkId();
  const ok = editor.chain().focus().insertContentAt(target, { type: 'bookmark', attrs: { bookmarkId: id } }).run();
  if (ok) copyBookmarkLink(id);
  return ok;
}

// Delete the row at rowPos — one transaction, undoable. LAST-ROW GUARD: if this is the only
// row in its parent (doc, or a cell for nested rows), a bare delete would leave the parent
// empty and schema-invalid — instead the row is REPLACED with a fresh empty full-width row,
// so the writer always keeps a line to type into. SCROLL LAW (see blocks.js scroll-snap fix):
// never scrollIntoView on a delete — the user is acting where they can see; the viewport
// stays put. Pure (state, dispatch, rowPos) -> boolean, exported for the headless suite.
export function doDeleteRow(state, dispatch, rowPos) {
  const { schema, doc, tr } = { schema: state.schema, doc: state.doc, tr: state.tr };
  if (typeof rowPos !== 'number' || rowPos < 0 || rowPos > doc.content.size) return false;
  const row = doc.nodeAt(rowPos);
  if (!row || row.type.name !== 'tableRow') return false;

  const $row = doc.resolve(rowPos);
  if ($row.parent.childCount === 1) {
    const cellType = schema.nodes.tableCell;
    const rowType = schema.nodes.tableRow;
    if (!cellType || !rowType) return false;
    const fresh = rowType.create(
      { cols: 1, pairId: mintUserPairId() },
      cellType.create({ role: 'full' }, emptyParagraph(schema)),
    );
    tr.replaceWith(rowPos, rowPos + row.nodeSize, fresh);
    try { tr.setSelection(TextSelection.create(tr.doc, Math.min(rowPos + 3, tr.doc.content.size))); } catch {}
  } else {
    tr.delete(rowPos, rowPos + row.nodeSize);
  }
  if (dispatch) dispatch(tr);
  return true;
}

// The distinct OUTERMOST tableRows a selection range touches — the unit the bulk row menu
// (extensions/convert-menu.js) both COUNTS ("DELETE 10 ROWS") and DELETES. "Outermost" means a
// top-level row (a direct doc child): Palau nests said|shown rows inside a full-width row's cell,
// and a selection landing in a nested row must resolve to its WRAPPER, never the child — so this
// only ever walks the doc's direct children and never descends. A collapsed caret counts the one
// row it sits in; a span counts every row it overlaps. The [start,end) test is deliberately
// half-open at the row's trailing boundary so a selection ENDING exactly at a row's edge (or a
// caret parked on the boundary between two rows) doesn't over-count the row it never entered.
// Pure (doc, from, to) -> [{ pos, node }] in document order. Exported for the headless suite.
export function collectIntersectingRows(doc, from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const rows = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const start = pos;
    const end = pos + node.nodeSize;
    if (node.type.name === 'tableRow') {
      // Overlap of [lo,hi] with the row's span [start,end]. For a collapsed caret (lo===hi) the
      // half-open test still catches the containing row because start < lo < end there.
      const overlaps = start < hi && end > lo;
      if (overlaps) rows.push({ pos: start, node });
    }
    pos = end;
  }
  return rows;
}

// Delete a set of OUTERMOST rows (positions from collectIntersectingRows) in ONE transaction, so a
// single undo restores every one of them byte-exact. Mirrors doDeleteRow's laws at bulk scale:
//   • LAST-ROWS GUARD — if the set is EVERY top-level row, the doc would be left empty and
//     schema-invalid, so after the deletes a fresh empty full-width row (pairu_ keep-me marker) is
//     inserted, exactly like the single-row guard. The writer always keeps a line to type into.
//   • ONE TRANSACTION — deletes run high→low so each row's captured position stays valid as earlier
//     spans are removed (no position mapping needed); a lone tr means a lone undo step.
//   • COLLAB LOOP LAW — only this user-initiated transaction is dispatched; nothing auto-fires.
//   • SCROLL LAW — like doDeleteRow, NEVER scrollIntoView on a delete: the writer is acting where
//     they can already see, and the deliberate scroll-snap fix (blocks.js) proved a forced scroll
//     here yanks the viewport. The caret is placed sensibly instead so the next keystroke lands
//     where the rows were.
// Rejects (returns false, dispatches nothing) if ANY position isn't a live top-level tableRow, so a
// stale/garbage set can never delete the wrong band. Pure (state, dispatch, rowPositions) -> boolean.
export function doDeleteRows(state, dispatch, rowPositions) {
  const { schema, doc } = state;
  if (!Array.isArray(rowPositions) || rowPositions.length === 0) return false;
  const positions = [...new Set(rowPositions)].sort((a, b) => a - b);
  const rows = [];
  for (const p of positions) {
    if (typeof p !== 'number' || p < 0 || p > doc.content.size) return false;
    const node = doc.nodeAt(p);
    if (!node || node.type.name !== 'tableRow') return false;
    // Top-level only: the position just BEFORE a doc-child resolves at depth 0. A nested Palau row
    // resolves deeper, so this refuses to bulk-delete an inner row through the outermost path.
    if (doc.resolve(p).depth !== 0) return false;
    rows.push({ pos: p, size: node.nodeSize });
  }
  const deletingAll = rows.length === doc.childCount;
  const tr = state.tr;
  if (deletingAll) {
    // Deleting EVERY top-level row would leave a schema-invalid empty doc (content is 'block+',
    // which auto-fills a stray paragraph on a bare delete). REPLACE the whole span with one fresh
    // empty full-width row in a single step instead — same guard doDeleteRow uses for the last row.
    const cellType = schema.nodes.tableCell;
    const rowType = schema.nodes.tableRow;
    if (!cellType || !rowType) return false;
    const fresh = rowType.create(
      { cols: 1, pairId: mintUserPairId() },
      cellType.create({ role: 'full' }, emptyParagraph(schema)),
    );
    tr.replaceWith(0, doc.content.size, fresh);
    try { tr.setSelection(TextSelection.create(tr.doc, Math.min(3, tr.doc.content.size))); } catch {}
    if (dispatch) dispatch(tr);
    return true;
  }
  // High→low so each remaining captured position is untouched by the deletes before it.
  for (let i = rows.length - 1; i >= 0; i--) {
    tr.delete(rows[i].pos, rows[i].pos + rows[i].size);
  }
  {
    // Caret to the top edge of where the first deleted row was — the natural "next line".
    try {
      const caret = Math.min(rows[0].pos, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(caret), 1));
    } catch {}
  }
  if (dispatch) dispatch(tr);
  return true;
}

// TAB CELL-HOP (Johnny: "when im in a table and i hit tab, it should bring me to the next
// row… left column tab brings me to right, right column tab brings me to the left column in
// the row below. shift tab goes the opposite way"). Spreadsheet Tab: caret hops cell → cell
// in DOCUMENT order, which naturally wraps shown → next row's said (and Shift-Tab back).
// SELECTION-ONLY — no doc mutation, so it is structurally collab-safe (no transaction the
// y-sync echo could re-trigger; see the COLLAB LOOP LAW in the repo CLAUDE.md).
// Inside a list item Tab is left alone (indent wins). At the table's very edge the key is
// swallowed (caret stays put) so browser focus never escapes the editor mid-writing.
// Pure (state, dispatch, dir) -> boolean, exported for the headless suite.
export function doCellHop(state, dispatch, dir) {
  const { $from } = state.selection;
  let cellDepth = 0;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem') return false; // list Tab (indent/outdent) wins inside lists
    if (name === 'tableCell') { cellDepth = d; break; }
  }
  if (!cellDepth) return false;

  const curPos = $from.before(cellDepth);
  const cells = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') cells.push(pos);
    return true; // keep descending — nested (Palau) rows contribute their cells in doc order
  });
  const i = cells.indexOf(curPos);
  if (i < 0) return false;
  const target = cells[i + (dir < 0 ? -1 : 1)];
  if (target == null) return true; // edge of the table — swallow the key, stay put

  const tr = state.tr;
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(target + 1), 1));
  } catch {
    return false;
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

// TABLE-SPINE GUARD (Johnny: "if I arrow down from a row i can break the table and type
// here. i shouldnt be able to do that"). The gapcursor between top-level rows lets typing
// mint a BARE paragraph at doc top level — outside every row, invisible to docToBlocks'
// row walk and rendered as the naked mono line in his screenshot. Rather than fighting the
// cursor, we make the state unrepresentable: after any doc change, every non-row top-level
// node is instantly wrapped into a full-width row — the LIVE twin of ensureTableDoc's
// load-time wrap (same shape: tableRow(cols:1) > tableCell(role:full), pairu_ keep-me
// marker). Typing between rows now lands in a real row mid-keystroke; existing strays
// self-heal on the next edit. Pure (state) -> Transaction|null, exported for the suite;
// returns null when the doc is already all-rows, so the appendTransaction loop terminates.
export function wrapBareTopLevelNodes(state) {
  const { doc, schema } = state;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  if (!rowType || !cellType) return null;
  const jobs = [];
  doc.forEach((child, offset) => {
    if (child.type.name === 'tableRow') return;
    // TRAILING-NODE PEACE TREATY (P0 incident 2026-07-07, the "editor freezes on first
    // edit" bug): StarterKit v3 ships a trailingNode plugin that keeps ONE empty paragraph
    // at the doc end (the click-below-to-type target) and RE-APPENDS it whenever it
    // disappears. Wrapping that paragraph into a row deletes it from the top level, the
    // trailing plugin appends a fresh one in the SAME appendTransaction round, we wrap
    // again — an infinite ping-pong that pegged the main thread and killed the tab in
    // every NON-COLLAB project on its first doc-changing transaction (collab sessions
    // were immune only because the guard is gated off there). The empty trailing
    // paragraph is the trailing plugin's contract — leave it bare. The moment it carries
    // ANY content it stops being exempt and wraps like everything else, so no real work
    // can ever live outside the spine. Locked by spine-guard-trailing.test.mjs.
    const isTrailing = offset + child.nodeSize === doc.content.size;
    if (isTrailing && child.type.name === 'paragraph' && child.content.size === 0) return;
    jobs.push({ from: offset, to: offset + child.nodeSize, node: child });
  });
  if (!jobs.length) return null;
  const tr = state.tr;
  // Walk BACKWARDS so earlier positions stay valid as later spans are replaced.
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    const row = rowType.create(
      { cols: 1, pairId: mintUserPairId() },
      cellType.create({ role: 'full' }, j.node),
    );
    tr.replaceWith(j.from, j.to, row);
  }
  return tr;
}

// Walk up from the selection to the owning tableRow; return the pos just before it (what
// doc.nodeAt expects) or null. Module-level twin of addCommands' rowPosFromSelection so the
// Option+X keymap can resolve the current row without going through the command layer.
export function resolveRowPos(state) {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'tableRow') return $from.before(d);
  }
  const node = state.doc.nodeAt($from.pos);
  return node && node.type.name === 'tableRow' ? $from.pos : null;
}

// Which column-divider affordance does a row wear? A SPLIT row (2+ cells) wears the MERGE chip
// on its divider; a FULL-WIDTH row wears the SPLIT chip at its far-right edge. The single truth
// paintDivider (nodeview) reads — exported so the headless suite locks the routing.
export function rowIsSplitNode(n) {
  return !!n && (n.childCount || n.attrs?.cols || 1) > 1;
}

// One key to toggle the current row: SPLIT a full-width row into said|shown, or MERGE a
// two-column row back to full width. `cols` is the source of truth (2 = already split).
// Mirrors exactly what the row split/merge buttons do — no new mutation path.
export function toggleRowSplit(state, dispatch) {
  const pos = resolveRowPos(state);
  if (pos == null) return false;
  const row = state.doc.nodeAt(pos);
  if (!row || row.type.name !== 'tableRow') return false;
  const cols = row.attrs?.cols || row.childCount || 1;
  return cols >= 2 ? doMergeRow(state, dispatch, pos) : doSplitRow(state, dispatch, pos);
}

// Option+X (Alt+X) — split/merge the current column without reaching for the button.
// Bound on event.code === 'KeyX' (the PHYSICAL key), NOT the produced character, because on a
// Mac Option+X emits '≈': a key-value binding would both miss the shortcut AND leak the '≈'
// into the doc. We match the physical X + Alt (and reject Ctrl/Cmd so Emacs/other combos pass
// through), ALWAYS preventDefault so no '≈' is ever inserted, then toggle. Gated on
// view.editable so a read-only share swallows the key but never mutates (editable ≠ write gate).
export function optionSplitKeyPlugin() {
  return new Plugin({
    key: new PluginKey('wpOptionSplit'),
    props: {
      handleKeyDown(view, event) {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyX') return false;
        event.preventDefault();
        if (!view.editable || isReadOnly()) return true;   // swallow the ≈, but never write
        return toggleRowSplit(view.state, view.dispatch);
      },
    },
  });
}

// Exported for spine-guard-trailing.test.mjs — the P0 freeze lock (real plugin + real
// TrailingNode through PM's applyTransaction protocol, no re-implementations).
export function tableSpineGuardPlugin() {
  return new Plugin({
    key: new PluginKey('wpTableSpineGuard'),
    appendTransaction(trs, _oldState, newState) {
      if (!trs.some((t) => t.docChanged)) return null;
      return wrapBareTopLevelNodes(newState);
    },
  });
}

// COLLAB GATE (incident 2026-07-07): the spine guard's appendTransaction rewrites the doc
// whenever a bare top-level node exists — and the live Burma doc carried one. Under
// Liveblocks/Yjs every y-sync apply is a full-doc change, so the guard re-fired on every
// remote echo of its own wrap — a dispatch loop that locked the tab ("#burma not loading
// at all"). Until the wrap is proven loop-free against the y-sync binding, the guard runs
// ONLY in non-collab sessions; collab docs are healed by ensureTableDoc at load instead.
function spineGuardSafeHere() {
  return !episodeFlag('collab');
}

// ---- the right-click ROW menu (on the far-left drag grip) -----------------
// Johnny: right-click the icon in the left margin → a context menu, "Delete row" first.
// No title (menus don't get titles). Same calm floating-menu chrome + keyboard discipline
// as the add-rows / convert menus. NO split/merge entry — that gesture lives on the
// column-divider affordances now (2026-07-21: every old menu/bubble surface for it is gone).
let openRowMenu = null;
function closeOpenRowMenu() {
  if (openRowMenu) { openRowMenu.close(); openRowMenu = null; }
}

function createRowMenu(editor, rowPos, x, y) {
  const row = editor.state.doc.nodeAt(rowPos);
  const bookmarkId = row?.attrs?.bookmarkId || null;
  // STALE-POS GUARD (audit 2026-07-07): rowPos was captured at menu-OPEN; under collab a
  // teammate's edit while the menu sits there shifts every later position, and "Delete row"
  // would then hit the WRONG row. Same cure as row drag: remember the row's IDENTITY and
  // re-resolve its CURRENT position at action time; a row that vanished mid-menu = calm no-op.
  const ref = row ? { node: row, blockId: rowFirstBlockId(row), pairId: row.attrs?.pairId || null } : null;
  const livePos = () => {
    const pos = ref ? findRowByIdentity(editor.state.doc, ref) : null;
    if (pos == null) {
      try {
        window.dispatchEvent(new CustomEvent('wp-toast', {
          detail: { tone: 'error', msg: 'that row just moved or was deleted — nothing changed' },
        }));
      } catch {}
    }
    return pos;
  };
  const items = [
    { label: 'Delete row', danger: true, run: () => { const p = livePos(); if (p != null) doDeleteRow(editor.state, editor.view.dispatch, p); } },
    { label: 'Add row below', run: () => { const p = livePos(); if (p != null) editor.chain().focus().addRowsBelow(p, 1).run(); } },
    // BOOKMARK — one entry, contextual like split/merge. Adding a bookmark also copies its
    // link immediately (the whole point of making one is sharing/jumping to it); the ⚑ glyph
    // the row now shows re-copies on click any time after.
    ...(bookmarkId
      ? [
        { label: 'Copy bookmark link', run: () => copyBookmarkLink(bookmarkId) },
        { label: 'Remove bookmark', run: () => { const p = livePos(); if (p != null) doSetRowBookmark(editor.state, editor.view.dispatch, p, null); } },
      ]
      : [{
        label: 'Bookmark',
        // Insert an INLINE bookmark at the row's start instead of setting a row attr. The old
        // setNodeMarkup path re-rendered the row and disturbed whatever cell Johnny was editing
        // (2026-07-08 report); an inline insert leaves the row's formatting completely untouched.
        run: () => { const p = livePos(); if (p != null) insertBookmarkAtRow(editor, p); },
      }]),
  ];

  let activeIndex = 0;
  const menu = el('div', 'wp-rowmenu wp-convert-menu wp-slash-menu', { contenteditable: 'false', role: 'menu' });

  const buttons = [];
  let onDocDown = null;
  let onKey = null;
  let onScroll = null;

  const close = () => {
    if (!menu.parentNode) return;
    if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onScroll) {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    menu.remove();
  };

  const paintActive = () => buttons.forEach((b, i) => b.classList.toggle('is-active', i === activeIndex));
  const pick = (index) => {
    const item = items[index];
    if (!item) return;
    close();
    item.run();
    editor.view.focus();
  };

  items.forEach((item, index) => {
    const button = el('button', 'wp-convert-item wp-slash-item' + (item.danger ? ' is-danger' : ''), { type: 'button', role: 'menuitem' });
    const label = el('span', 'wp-convert-label');
    label.textContent = item.label;
    button.appendChild(label);
    button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
    button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
    buttons.push(button);
    menu.appendChild(button);
  });

  paintActive();
  document.body.appendChild(menu);

  menu.style.position = 'fixed';
  menu.style.top = `${y}px`;
  menu.style.left = `${x}px`;
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
  if (box.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;

  onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); editor.view.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); activeIndex = 0; paintActive(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); activeIndex = items.length - 1; paintActive(); buttons[items.length - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pick(activeIndex); }
  };
  onDocDown = (e) => { if (!menu.contains(e.target)) close(); };
  onScroll = () => close();

  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  requestAnimationFrame(() => { if (buttons[0]) buttons[0].focus(); });

  return { menu, close };
}

// ---- the right-click "add N rows" menu -----------------------------------
// A single live menu instance, styled by the shared convert/slash menu CSS so it reads
// exactly like the engine's other calm floating menus. Keyboard driven, click-away closed.
const ADD_ROW_CHOICES = [
  { label: 'Add 1 row', count: 1 },
  { label: 'Add 5 rows', count: 5 },
  { label: 'Add 10 rows', count: 10 },
  { label: 'Add 20 rows', count: 20 },
];

let openAddMenu = null;
function closeOpenAddMenu() {
  if (openAddMenu) { openAddMenu.close(); openAddMenu = null; }
}

function createAddRowsMenu(editor, rowPos, x, y) {
  let activeIndex = 0;
  const menu = el('div', 'wp-addrows-menu wp-convert-menu wp-slash-menu', { contenteditable: 'false', role: 'menu' });
  const head = el('div', 'wp-convert-head');
  head.textContent = 'Add rows below';
  menu.appendChild(head);

  const buttons = [];
  let onDocDown = null;
  let onKey = null;
  let onScroll = null;

  const close = () => {
    if (!menu.parentNode) return;
    if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onScroll) {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    menu.remove();
  };

  const paintActive = () => buttons.forEach((b, i) => b.classList.toggle('is-active', i === activeIndex));
  const pick = (index) => {
    const item = ADD_ROW_CHOICES[index];
    if (!item) return;
    close();
    editor.chain().focus().addRowsBelow(rowPos, item.count).run();
  };

  ADD_ROW_CHOICES.forEach((item, index) => {
    const button = el('button', 'wp-convert-item wp-slash-item', { type: 'button', role: 'menuitem' });
    const label = el('span', 'wp-convert-label');
    label.textContent = item.label;
    button.appendChild(label);
    button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
    button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
    buttons.push(button);
    menu.appendChild(button);
  });

  paintActive();
  document.body.appendChild(menu);

  // Fixed-position near the pointer, clamped to the viewport (same discipline as the
  // convert / slash / timecode menus).
  menu.style.position = 'fixed';
  menu.style.top = `${y}px`;
  menu.style.left = `${x}px`;
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
  if (box.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;

  onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); editor.view.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % ADD_ROW_CHOICES.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + ADD_ROW_CHOICES.length) % ADD_ROW_CHOICES.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); activeIndex = 0; paintActive(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); activeIndex = ADD_ROW_CHOICES.length - 1; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pick(activeIndex); }
  };
  onDocDown = (e) => { if (!menu.contains(e.target)) close(); };
  onScroll = () => close();

  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  requestAnimationFrame(() => { if (buttons[0]) buttons[0].focus(); });

  return { menu, close };
}

// Pure geometry for the MERGE chip: its `left` — in the ROW's own coordinate space, the same
// space the absolutely-positioned chip lives in — is the horizontal CENTER of the column divider.
// The divider is the 2nd cell's border-left, so its center sits half a border-width inside that
// cell's left edge. Fed getBoundingClientRect().left deltas (rowLeft, cellLeft) so it is immune to
// the row's own left gutter/padding and to WHICH ancestor is the offsetParent. (The old code summed
// content.offsetLeft + cell.offsetLeft, but cell.offsetLeft is ALREADY measured against .wp-trow —
// adding the row's left inset again pushed the chip one gutter-width to the RIGHT of the line, the
// bug Johnny drew a square over.) Pinned by divider-affordance.test.mjs.
export function dividerChipLeft(rowLeft, cellLeft, borderLeft) {
  return (cellLeft - rowLeft) + (borderLeft || 0) / 2;
}

// --- tableCell — a column slot. Holds block+ (cartridges). The cell owns NO chrome of its
// own; its only job is to be a flex column. The hairline between split columns is painted by
// CSS on cells after the first (.wp-tcell + .wp-tcell { border-left }).
export const TableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,
  // role hints which lane a cell is (said / shown / full) — schema-ready for split/merge.
  addAttributes() {
    return { role: { default: 'full' } };
  },
  parseHTML() { return [{ tag: 'div[data-tcell]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-tcell': '', 'data-role': node.attrs.role || 'full', class: 'wp-tcell',
    }), 0];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', 'wp-tcell');
      dom.setAttribute('data-tcell', '');
      dom.setAttribute('data-role', node.attrs.role || 'full');
      const content = el('div', 'wp-tcell-content');
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== 'tableCell') return false;
          dom.setAttribute('data-role', updated.attrs.role || 'full');
          return true;
        },
      };
    };
  },
});

// --- tableRow — a full-width horizontal band. Content tableCell+ (one cell = full-width;
// two = a split). The row is a flex container; cells flex:1 so a 1-cell row is full-width and
// a 2-cell row splits 50/50. cols attr is advisory (kept in sync for export/telemetry).
export const TableRow = Node.create({
  name: 'tableRow',
  group: 'block',
  content: 'tableCell+',
  // STRUCTURAL LAW (Johnny 2026-07-21): a row may NEVER leave the two-column experience through a
  // drag. spec draggable:true was the unpair vector — ProseMirror arms a native node drag on any
  // mousedown that resolves to a draggable node (row padding, cell gaps, cartridge chrome), and
  // its OWN drop handler will happily nest the dragged tableRow inside another row's cell (the
  // schema allows tableRow in tableCell content — Palau's nested shape), leaving it unpaired and
  // misaligned. draggable:false closes that entire machinery for rows. The ONLY reorder path left
  // is the far-left grip → rowDragPlugin → moveRow, which preserves cols/pairing BY CONSTRUCTION
  // (same-parent boundaries only, immutable-node reinsert).
  draggable: false,
  addAttributes() {
    return {
      cols: { default: 1 },
      pairId: {
        default: null,
        // ProseMirror Node.toJSON() serializes every declared attr, so tableRow now writes
        // `pairId: null` on bare rows. We keep the attr because paired rows need faithful
        // round-trip identity, and the additive null is already covered as safe by the
        // migration/round-trip suites (migrate-doc, document-builder, savedoc-invariant,
        // doc-store, data-loss-round3, write-read-loop).
        parseHTML: (element) => element.getAttribute('data-pair-id') || null,
        renderHTML: (attributes) => (attributes.pairId ? { 'data-pair-id': attributes.pairId } : {}),
      },
      // BOOKMARK — additive null-default attr, same safety posture as pairId above: paired
      // round-trip suites already cover declared-attr nulls, so old docs load unchanged and
      // new saves carry `bookmarkId: null` harmlessly on unbookmarked rows.
      bookmarkId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-bookmark-id') || null,
        renderHTML: (attributes) => (attributes.bookmarkId ? { 'data-bookmark-id': attributes.bookmarkId } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'div[data-trow]' }]; },
  renderHTML({ node }) {
    return ['div', mergeAttributes({
      'data-trow': '', 'data-cols': String(node.attrs.cols || 1), class: 'wp-trow',
    }), 0];
  },
  // The SPLIT / MERGE gesture exposed as native chainable commands. Each resolves the row
  // that owns the current selection (or an explicit rowPos) and runs the one-transaction
  // op above. No word is lost in either direction.
  addCommands() {
    const rowPosFromSelection = (state, explicit) => {
      if (typeof explicit === 'number') return explicit;
      // Walk up the selection's $from depth to the tableRow ancestor; return the pos
      // just before it (what doc.nodeAt expects).
      const $from = state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'tableRow') return $from.before(d);
      }
      // Selection might sit directly at a top-level row boundary.
      const node = state.doc.nodeAt($from.pos);
      if (node && node.type.name === 'tableRow') return $from.pos;
      return null;
    };
    return {
      splitRow: (rowPos) => ({ state, dispatch }) => {
        const pos = rowPosFromSelection(state, rowPos);
        if (pos == null) return false;
        return doSplitRow(state, dispatch, pos);
      },
      mergeRow: (rowPos) => ({ state, dispatch }) => {
        const pos = rowPosFromSelection(state, rowPos);
        if (pos == null) return false;
        return doMergeRow(state, dispatch, pos);
      },
      addRowsBelow: (rowPos, count = 1) => ({ state, dispatch }) => {
        const pos = rowPosFromSelection(state, rowPos);
        if (pos == null) return false;
        return doAddRowsBelow(state, dispatch, pos, count);
      },
    };
  },
  // The editor-owned row-drag plugin ships with the same episode flag as the grip: episodes
  // without rowDragReorder get no plugin at all, keeping Burma's drop behavior byte-identical.
  addKeyboardShortcuts() {
    return {
      Tab: () => doCellHop(this.editor.state, this.editor.view.dispatch, 1),
      'Shift-Tab': () => doCellHop(this.editor.state, this.editor.view.dispatch, -1),
    };
  },
  addProseMirrorPlugins() {
    const plugins = [optionSplitKeyPlugin()];
    if (spineGuardSafeHere()) plugins.push(tableSpineGuardPlugin());
    if (rowDragEnabled()) plugins.push(rowDragPlugin());
    return plugins;
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('div', 'wp-trow');
      dom.setAttribute('data-trow', '');
      const paintCols = (n) => dom.setAttribute('data-cols', String(n.childCount || n.attrs.cols || 1));
      const paintPairId = (n) => {
        if (n.attrs?.pairId) dom.setAttribute('data-pair-id', n.attrs.pairId);
        else dom.removeAttribute('data-pair-id');
      };
      // ---- BOOKMARK GLYPH — a ⚑ in the left gutter, ALWAYS visible while the row carries a
      // bookmarkId (a bookmark marks a place; it must be findable at a glance, not hover-only).
      // Click = copy the deep link. Deliberately alive in read mode AND `?read` shares — copying
      // a link is a reading affordance, not a write. Mounted lazily so unbookmarked rows carry
      // zero extra DOM.
      let bmBtn = null;
      const paintBookmark = (n) => {
        const id = n.attrs?.bookmarkId || null;
        if (id) dom.setAttribute('data-bookmark-id', id);
        else dom.removeAttribute('data-bookmark-id');
        if (id && !bmBtn) {
          bmBtn = el('button', 'wp-row-bm', {
            type: 'button', contenteditable: 'false',
            title: 'Bookmarked — click to copy the link to this spot',
            'aria-label': 'copy bookmark link',
          });
          bmBtn.textContent = '⚑';
          const copyLive = () => {
            // Read the CURRENT attr — the id captured at paint time can go stale across edits.
            const pos = typeof getPos === 'function' ? getPos() : null;
            const cur = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
            copyBookmarkLink(cur?.attrs?.bookmarkId || id);
          };
          bmBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            copyLive();
          });
          // Keyboard path (audit: mousedown-only made a focusable button dead to Enter/Space).
          bmBtn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            e.stopPropagation();
            copyLive();
          });
          dom.appendChild(bmBtn);
        } else if (!id && bmBtn) {
          bmBtn.remove();
          bmBtn = null;
        }
      };
      paintCols(node);
      paintPairId(node);
      paintBookmark(node);

      // ---- MERGE / SPLIT — the COLUMN-DIVIDER affordances (Johnny 2026-07-21) -----
      // The old left-margin ⊞ four-box icon is DEAD; its job lives where the geometry is:
      //   • a SPLIT row reveals a small MERGE chip vertically centered ON the divider line
      //     between the two columns — click = doMergeRow (lossless, one transaction);
      //   • a FULL-WIDTH row reveals a SPLIT chip at the row's far-right edge, dead-center
      //     vertically, where the divider would return — click = doSplitRow.
      // Same small-circle-chip family + row-hover reveal as the "+" add-row button (the
      // interaction precedent). Never mounted in a ?read share; hidden by CSS in sticky READ
      // mode and on workspace-ghosted rows (ghosts are pointer-events:none anyway).
      let mergeWrap = null;
      let splitWrap = null;
      const positionMergeChip = () => {
        // Center the merge chip ON the divider line. The divider is the 2nd cell's border-left, and
        // .wp-tcell:first-child flexes 1.2 vs 1 — so a CSS 50% is WRONG. Measure the cell's left edge
        // and the row's left edge as viewport rects and take the delta (dividerChipLeft): that lands
        // the chip in the row's coordinate space regardless of the row's own left gutter/padding —
        // the failure the offsetLeft sum had. Re-run on mouseenter and on every split so resizes,
        // reflows, and the SIZE knob can never leave it off the line.
        if (!mergeWrap) return;
        const second = content.children && content.children[1];
        if (!second || typeof second.getBoundingClientRect !== 'function') return;
        const rowRect = dom.getBoundingClientRect();
        const cellRect = second.getBoundingClientRect();
        if (!rowRect.width || !cellRect.width) return;   // not laid out yet — keep the CSS fallback
        const border = parseFloat(getComputedStyle(second).borderLeftWidth) || 0;
        mergeWrap.style.left = `${dividerChipLeft(rowRect.left, cellRect.left, border)}px`;
      };
      // Re-measure one frame out, so a freshly-shown 2nd cell (row just became split, or the
      // nodeView mounted) has real layout before we read it. rAF also defers past the synchronous
      // nodeView construction below, where `content` is not yet initialised.
      const scheduleChipMeasure = () => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(positionMergeChip);
        else positionMergeChip();
      };
      const runDividerAction = (e, action) => {
        if (e.button !== 0) return;   // left-click only
        e.preventDefault();
        e.stopPropagation();
        if (!armEditForRowGrip(editor.view)) return;   // READ→EDIT auto-arm (no-op in a ?read share)
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        if (typeof pos !== 'number') return;
        if (action === 'merge') editor.chain().focus().mergeRow(pos).run();
        else editor.chain().focus().splitRow(pos).run();
      };
      if (!isReadOnly()) {
        mergeWrap = el('div', 'wp-row-colmerge', { contenteditable: 'false' });
        const mergeBtn = el('button', 'wp-row-col-btn', {
          type: 'button', contenteditable: 'false',
          title: 'Merge said / shown columns back into one full-width row',
          'aria-label': 'merge columns to one row',
        });
        // One full-width bar: what the row becomes.
        mergeBtn.innerHTML =
          '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">'
          + '<path d="M2.5 6h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
          + '</svg>';
        // Handler on the WRAP, not the button: the wrap carries the generous invisible hit padding,
        // so a click anywhere in that comfortable zone (not just on the tiny visible square) merges.
        mergeWrap.addEventListener('mousedown', (e) => runDividerAction(e, 'merge'));
        mergeWrap.appendChild(mergeBtn);
        dom.appendChild(mergeWrap);

        splitWrap = el('div', 'wp-row-colsplit', { contenteditable: 'false' });
        const splitBtn = el('button', 'wp-row-col-btn', {
          type: 'button', contenteditable: 'false',
          title: 'Split this row into said / shown columns',
          'aria-label': 'split row into two columns',
        });
        // Two columns: the divider returns.
        splitBtn.innerHTML =
          '<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">'
          + '<path d="M6 2.5v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
          + '</svg>';
        splitWrap.addEventListener('mousedown', (e) => runDividerAction(e, 'split'));
        splitWrap.appendChild(splitBtn);
        dom.appendChild(splitWrap);

        dom.addEventListener('mouseenter', positionMergeChip);
      }
      const paintDivider = (n) => {
        if (!mergeWrap) return;
        const split = rowIsSplitNode(n);
        mergeWrap.style.display = split ? '' : 'none';
        splitWrap.style.display = split ? 'none' : '';
        // NIT (queued 2026-07-21): the chip used to place only on mouseenter, so splitting a row
        // while already hovering it left the chip at its stale 50% fallback. Re-measure whenever the
        // row is (or becomes) split — deferred one rAF so the just-shown 2nd cell has layout.
        if (split) scheduleChipMeasure();
      };
      paintDivider(node);

      // ---- ROW DRAG HANDLE (rowDragReorder episodes — Burma + Palau) ---------
      // Far-left grip, in the dead ⊞ spine's old slot. Hidden until row hover; grab to drag
      // the whole row up/down. Never mounted in read-only share mode — a reader gets no
      // reorder affordance. This handle only STARTS the gesture and records the row's
      // IDENTITY; the editor-level rowDragPlugin owns everything after (indicator,
      // autoscroll, drop) — see OWNERSHIP LAW above. Right-click = the ROW menu (Delete row
      // first) — the spine's old contextmenu role rides the grip now that the spine is gone.
      let handle = null;
      if (rowDragEnabled() && !isReadOnly()) {
        handle = el('div', 'wp-row-drag', { contenteditable: 'false', draggable: 'true', title: 'Drag to reorder row', 'aria-label': 'drag row to reorder' });
        // A proper grippy icon (the old ⇕ text glyph was vestigial — unstyled, mid-flow, dead).
        // Three quiet horizontal bars, crisp SVG like the bookmark ribbon; deliberately NOT the
        // block grip's ⠿ dots — two identical grips is how users grabbed the wrong drag before.
        handle.innerHTML =
          '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">'
          + '<path d="M1.5 2.5h9M1.5 6h9M1.5 9.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>'
          + '</svg>';

        // Arm edit BEFORE the browser starts the native drag (mousedown precedes dragstart). The
        // flip is synchronous, so by dragstart view.editable is true and the reorder writes cleanly.
        handle.addEventListener('mousedown', (e) => { e.stopPropagation(); armEditForRowGrip(editor.view); });
        handle.addEventListener('dragstart', (e) => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          const rowNode = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null;
          if (!rowNode || rowNode.type.name !== 'tableRow') { e.preventDefault(); return; }
          // IDENTITY, never position: a position captured here goes stale the moment a collab
          // peer edits mid-drag. The plugin re-resolves this row at drop time by node
          // reference / first-block blockId / pairId (findRowByIdentity).
          draggingRow = { node: rowNode, blockId: rowFirstBlockId(rowNode), pairId: rowNode.attrs?.pairId || null };
          try {
            e.dataTransfer.effectAllowed = 'move';
            // Custom MIME carries the payload; text/plain stays EMPTY on purpose. Firefox
            // needs setData() for the drag to start at all — but an empty text payload means
            // that even if a drop somehow escaped the plugin, PM's parseFromClipboard would
            // yield nothing, so the old junk-'wp-row'-text insertion path stays dead.
            e.dataTransfer.setData('application/x-wp-row', draggingRow.blockId || '');
            e.dataTransfer.setData('text/plain', '');
            e.dataTransfer.setDragImage(dom, 14, 12);
          } catch (_err) {}
          dom.classList.add('wp-trow-dragging');
          e.stopPropagation();   // keep ProseMirror's own drag machinery out of it
        });
        handle.addEventListener('dragend', () => {
          dom.classList.remove('wp-trow-dragging');
          clearDropIndicator();
          draggingRow = null;
        });
        // Right-click the grip → the ROW menu (Delete row first). Never in read-only.
        handle.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isReadOnly()) return;
          const pos = typeof getPos === 'function' ? getPos() : getPos;
          if (typeof pos !== 'number') return;
          closeOpenRowMenu();
          openRowMenu = createRowMenu(editor, pos, e.clientX, e.clientY);
        });

        dom.appendChild(handle);
      }

      // ---- ADD-ROW TOOL (ALL SCRIPTS) ----------------------------------
      // A tiny "+" pinned to the row's bottom edge, revealed on row hover like the drag
      // grip. Left-click = one empty row below (matching this row's column structure);
      // right-click = the add-1/5/10/20 menu. Never mounted in read-only share mode —
      // a reader's browser gets no write affordance at all.
      let addWrap = null;
      if (!isReadOnly()) {
        addWrap = el('div', 'wp-row-add', { contenteditable: 'false' });
        const addBtn = el('button', 'wp-row-add-btn', {
          type: 'button',
          contenteditable: 'false',
          title: 'Add a row below · right-click to add many',
          'aria-label': 'add row below',
        });
        addBtn.textContent = '+';
        addBtn.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;   // left-click only; right-click is the menu's
          e.preventDefault();
          e.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : getPos;
          if (typeof pos !== 'number') return;
          editor.chain().focus().addRowsBelow(pos, 1).run();
        });
        addBtn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : getPos;
          if (typeof pos !== 'number') return;
          closeOpenAddMenu();
          openAddMenu = createAddRowsMenu(editor, pos, e.clientX, e.clientY);
        });
        addWrap.appendChild(addBtn);
        dom.appendChild(addWrap);
      }

      const content = el('div', 'wp-trow-cells');
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        // CLASS flips on the row's OWN dom are chrome paint, never content: the drag system's
        // wp-drop-before/after indicator + wp-trow-dragging classes. Left unignored, every
        // indicator paint read as a real mutation → PM re-rendered the nodeView → the fresh dom
        // wiped the class → the next dragover re-painted it — a teardown/flicker loop on every
        // frame of a row drag. ONLY class, though: Editor.jsx's paintActiveSelectionWrappers
        // raw-writes data-pm-active-selection onto this dom from OUTSIDE PM's update cycle on
        // every selectionUpdate; swallowing those made the DOMObserver flush treat the batch as
        // selection-only and re-sync the native selection from stale state mid-gesture — a
        // cross-row mouse-drag selection deterministically collapsed at the row boundary (and
        // the select→right-click bulk menu died with it). Non-class attr flips MUST reach PM.
        // Pinned by row-ignoremutation.test.mjs in BOTH directions.
        ignoreMutation: (m) => (m.type === 'attributes' && m.target === dom && m.attributeName === 'class')
          || (handle && (handle === m.target || handle.contains(m.target)))
          || (addWrap && (addWrap === m.target || addWrap.contains(m.target)))
          || (mergeWrap && (mergeWrap === m.target || mergeWrap.contains(m.target)))
          || (splitWrap && (splitWrap === m.target || splitWrap.contains(m.target)))
          || (bmBtn && (bmBtn === m.target || bmBtn.contains(m.target))),
        update(updated) {
          if (updated.type.name !== 'tableRow') return false;
          paintCols(updated);
          paintPairId(updated);
          paintBookmark(updated);
          paintDivider(updated);
          return true;
        },
      };
    };
  },
});

export const BURMA_TABLE_NODES = [TableRow, TableCell, Bookmark];
