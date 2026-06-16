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

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
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
  addNodeView() {
    return ({ node }) => {
      const dom = el('div', 'wp-trow');
      dom.setAttribute('data-trow', '');
      const paintCols = (n) => dom.setAttribute('data-cols', String(n.childCount || n.attrs.cols || 1));
      paintCols(node);
      const content = el('div', 'wp-trow-cells');
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type.name !== 'tableRow') return false;
          paintCols(updated);
          return true;
        },
      };
    };
  },
});

export const BURMA_TABLE_NODES = [TableRow, TableCell];
