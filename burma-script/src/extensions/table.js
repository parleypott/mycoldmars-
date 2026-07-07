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
      editorView.dom.addEventListener('dragover', onDragover, true);
      editorView.dom.addEventListener('drop', onDrop, true);
      return {
        destroy() {
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
    if (child.type.name !== 'tableRow') jobs.push({ from: offset, to: offset + child.nodeSize, node: child });
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

function tableSpineGuardPlugin() {
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

// ---- the right-click ROW menu (on the ⊟/⊞ split-merge box) ----------------
// Johnny: right-click the little box icon in the left margin → a context menu, "Delete row"
// first. No title (menus don't get titles). Items are contextual: the split/merge entry
// mirrors whatever the icon's left-click would do. Same calm floating-menu chrome +
// keyboard discipline as the add-rows / convert menus.
let openRowMenu = null;
function closeOpenRowMenu() {
  if (openRowMenu) { openRowMenu.close(); openRowMenu = null; }
}

function createRowMenu(editor, rowPos, x, y) {
  const row = editor.state.doc.nodeAt(rowPos);
  const isSplit = !!row && ((row.childCount || row.attrs?.cols || 1) > 1);
  const items = [
    { label: 'Delete row', danger: true, run: () => doDeleteRow(editor.state, editor.view.dispatch, rowPos) },
    { label: 'Add row below', run: () => editor.chain().focus().addRowsBelow(rowPos, 1).run() },
    isSplit
      ? { label: 'Merge columns to one row', run: () => editor.chain().focus().mergeRow(rowPos).run() }
      : { label: 'Split into two columns', run: () => editor.chain().focus().splitRow(rowPos).run() },
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
  draggable: true,
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
  addProseMirrorPlugins() {
    const plugins = [];
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
      paintCols(node);
      paintPairId(node);

      // ---- ROW SPINE: the split / merge affordance ------------------------
      // A flat grip on the row's left margin. A FULL-WIDTH row shows ⊟ "split"; a
      // SPLIT row shows ⊞ "merge". One orange accent on hover, no shadow, no box.
      const spine = el('div', 'wp-row-spine');
      spine.setAttribute('contenteditable', 'false');
      const btn = el('button', 'wp-row-split', { type: 'button', contenteditable: 'false' });
      const paintBtn = (n) => {
        const split = (n.childCount || n.attrs.cols || 1) > 1;
        btn.textContent = split ? '⊞' : '⊟';
        btn.className = split ? 'wp-row-split is-merge' : 'wp-row-split is-split';
        btn.title = split ? 'Merge columns back to one full-width row' : 'Split into two columns';
        btn.setAttribute('aria-label', split ? 'merge row' : 'split row');
      };
      paintBtn(node);
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;   // left-click only; right-click opens the row menu
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        if (typeof pos !== 'number') return;
        const cur = editor.state.doc.nodeAt(pos);
        const split = cur && (cur.childCount > 1 || (cur.attrs && cur.attrs.cols > 1));
        if (split) editor.chain().focus().mergeRow(pos).run();
        else editor.chain().focus().splitRow(pos).run();
      });
      // Right-click the box → the ROW menu (Delete row first). Never in read-only.
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isReadOnly()) return;
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        if (typeof pos !== 'number') return;
        closeOpenRowMenu();
        openRowMenu = createRowMenu(editor, pos, e.clientX, e.clientY);
      });
      spine.appendChild(btn);
      dom.appendChild(spine);

      // ---- ROW DRAG HANDLE (rowDragReorder episodes — Burma + Palau) ---------
      // Far-left ⇕ grip. Hidden until row hover; grab to drag the whole row up/down. Never
      // mounted in read-only share mode — a reader gets no reorder affordance. The glyph is
      // deliberately NOT ⠿ — that's the block grip's glyph, and two identical grips made
      // users grab PM's native BLOCK drag when they meant to move a row. This handle only
      // STARTS the gesture and records the row's IDENTITY; the editor-level rowDragPlugin
      // owns everything after (indicator, autoscroll, drop) — see OWNERSHIP LAW above.
      let handle = null;
      if (rowDragEnabled() && !isReadOnly()) {
        handle = el('div', 'wp-row-drag', { contenteditable: 'false', draggable: 'true', title: 'Drag to reorder row', 'aria-label': 'drag row to reorder' });
        handle.textContent = '⇕';

        handle.addEventListener('mousedown', (e) => { e.stopPropagation(); });
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
        ignoreMutation: (m) => spine.contains(m.target)
          || (handle && (handle === m.target || handle.contains(m.target)))
          || (addWrap && (addWrap === m.target || addWrap.contains(m.target))),
        update(updated) {
          if (updated.type.name !== 'tableRow') return false;
          paintCols(updated);
          paintPairId(updated);
          paintBtn(updated);
          return true;
        },
      };
    };
  },
});

export const BURMA_TABLE_NODES = [TableRow, TableCell];
