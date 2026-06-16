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

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
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
    return { cols: { default: 1 } };
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
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = el('div', 'wp-trow');
      dom.setAttribute('data-trow', '');
      const paintCols = (n) => dom.setAttribute('data-cols', String(n.childCount || n.attrs.cols || 1));
      paintCols(node);

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
        btn.title = split ? 'Merge columns back to one full-width row' : 'Split into said / shown columns';
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

      const content = el('div', 'wp-trow-cells');
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        ignoreMutation: (m) => spine.contains(m.target),
        update(updated) {
          if (updated.type.name !== 'tableRow') return false;
          paintCols(updated);
          paintBtn(updated);
          return true;
        },
      };
    };
  },
});

export const BURMA_TABLE_NODES = [TableRow, TableCell];
