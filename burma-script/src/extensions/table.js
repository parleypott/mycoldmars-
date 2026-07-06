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
import { TextSelection } from '@tiptap/pm/state';
import { episodeFlag } from '../episode-config.js';
import { isReadOnly } from '../read-mode.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Drag-to-reorder is gated by the episode's `rowDragReorder` feature flag (Palau opts in).
// Gating it here keeps Burma's rack — and its existing split/merge grip — byte-for-byte
// untouched: no drag handle is ever mounted, no drag listeners ever attach, on a Burma row.
function isPalauEpisode() {
  return episodeFlag('rowDragReorder');
}

// ---- ROW DRAG-TO-REORDER (PALAU) -----------------------------------------
// A grip on each row's FAR-LEFT gutter (further out than the split/merge spine). Grab it and
// drag a row up or down; on drop the dragged tableRow is MOVED to the new index in a SINGLE
// ProseMirror transaction (delete the row, then insert the very same node object at the target).
// docToBlocks() is order-based, so a reorder is perfectly lossless — same block count, every word
// and timecode preserved. A drop-indicator hairline shows where the row will land.
//
// Module-scoped drag state: which row is in the air, and which row currently owns the indicator.
let draggingRow = null;      // { fromPos } — top-level position just before the dragged row
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

// Move the row at fromPos to sit before/after the row at targetPos — one lossless transaction.
// Only ever reorders TOP-LEVEL rows (depth 0); nested rows (none in practice) are left alone.
function moveRow(view, fromPos, targetPos, dropBefore) {
  if (!view || fromPos == null || targetPos == null) return false;
  const { state } = view;
  if (state.doc.resolve(fromPos).depth !== 0) return false;
  if (state.doc.resolve(targetPos).depth !== 0) return false;
  const source = state.doc.nodeAt(fromPos);
  const target = state.doc.nodeAt(targetPos);
  if (!source || source.type.name !== 'tableRow') return false;
  if (!target || target.type.name !== 'tableRow') return false;
  const size = source.nodeSize;
  const insertPos = dropBefore ? targetPos : targetPos + target.nodeSize;
  // No-op when the drop lands inside the source row's own span (drop onto itself / its own edges).
  if (insertPos >= fromPos && insertPos <= fromPos + size) return false;
  const tr = state.tr;
  tr.delete(fromPos, fromPos + size);
  const mapped = tr.mapping.map(insertPos);
  tr.insert(mapped, source);            // reuse the immutable node → nothing is lost
  view.dispatch(tr.scrollIntoView());
  return true;
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
// tableRow is group:'block' and cells hold block+). So unlike moveRow (top-level only),
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
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === 'function' ? getPos() : getPos;
        if (typeof pos !== 'number') return;
        const cur = editor.state.doc.nodeAt(pos);
        const split = cur && (cur.childCount > 1 || (cur.attrs && cur.attrs.cols > 1));
        if (split) editor.chain().focus().mergeRow(pos).run();
        else editor.chain().focus().splitRow(pos).run();
      });
      spine.appendChild(btn);
      dom.appendChild(spine);

      // ---- ROW DRAG HANDLE (PALAU ONLY) --------------------------------
      // Far-left ⠿ grip. Hidden until row hover; grab to drag the whole row up/down. Kept
      // strictly out of Burma so the split/merge spine is never touched there.
      let handle = null;
      if (isPalauEpisode()) {
        handle = el('div', 'wp-row-drag', { contenteditable: 'false', draggable: 'true', title: 'Drag to reorder row', 'aria-label': 'drag row to reorder' });
        handle.textContent = '⠿';

        handle.addEventListener('mousedown', (e) => { e.stopPropagation(); });
        handle.addEventListener('dragstart', (e) => {
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (pos == null || editor.state.doc.resolve(pos).depth !== 0) { e.preventDefault(); return; }
          draggingRow = { fromPos: pos };
          try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'wp-row');   // Firefox needs data set to drag
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

        dom.addEventListener('dragover', (e) => {
          if (!draggingRow) return;
          e.preventDefault();
          e.stopPropagation();
          try { e.dataTransfer.dropEffect = 'move'; } catch (_err) {}
          const rect = dom.getBoundingClientRect();
          setDropIndicator(dom, (e.clientY - rect.top) < rect.height / 2);
        });
        dom.addEventListener('drop', (e) => {
          if (!draggingRow) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = dom.getBoundingClientRect();
          const dropBefore = (e.clientY - rect.top) < rect.height / 2;
          const targetPos = typeof getPos === 'function' ? getPos() : null;
          const fromPos = draggingRow.fromPos;
          clearDropIndicator();
          dom.classList.remove('wp-trow-dragging');
          draggingRow = null;
          moveRow(editor.view, fromPos, targetPos, dropBefore);
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
