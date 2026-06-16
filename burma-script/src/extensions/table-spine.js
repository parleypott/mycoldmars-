// Burma Script Tool — TABLE SPINE (WP-01 GOOGLE-DOCS-STYLE TABLE).
// SPINE BUILDER #1 · @tiptap/extension-table family.
//
// THE MODEL: the document is no longer a flat list of cartridge nodes — it is ONE
// <table> whose every <tr> is a SCRIPT ROW. A row defaults to a SINGLE full-width <td>
// (one cartridge inside). The schema is already 2-column-ready (a row may hold a LEFT
// cell = what's SAID and a RIGHT cell = what's SHOWN) and 3-column-ready later — but
// SPINE #1 only builds + proves the full-width single-cell case. Split/merge commands
// are a downstream agent's job; the schema we lay down here makes them a small step.
//
// DESIGN LAW (LOCKED): FLAT fig.01 cartridges. The TABLE itself is INVISIBLE chrome —
// NO spreadsheet gridlines, NO zebra, NO box-shadow, NO bevel. Cells are transparent
// padding-0 wrappers; each cartridge keeps its own hairline border + warm cream fill.
// The ONLY rule a split row ever shows is a SINGLE hairline between its two columns.
//
// We configure the four upstream extensions (table / row / cell / header) with our own
// classes + a borderless renderHTML, rather than forking ProseMirror's tableNodes — so
// we inherit the battle-tested table schema (tableRole, colspan/rowspan, colwidth) and
// stay migration-friendly. Trust the framework (Article VIII).

// v3 ships the whole family as NAMED exports from @tiptap/extension-table
// (Table / TableRow / TableCell / TableHeader). We don't use TableKit because we want each
// node reskinned individually with our flat classes + locked behaviour.
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

// The cartridge nodes are group:'block'. A tableCell's content is 'block+', so a cartridge
// drops straight into a cell with zero schema surgery. We widen nothing and narrow nothing —
// the cell just becomes a transparent frame around exactly one cartridge.

// TABLE — the whole script spine. One per document. We turn OFF resizing (Johnny's rows are
// full-width or a clean 2-way split, never hand-dragged column widths) and render a bare
// <table> with our spine class. No <colgroup> widths are forced; CSS owns the 1fr / split.
export const ScriptTable = Table.extend({
  name: 'table',
  // Keep the upstream tableRole + content ('tableRow+'); just reskin + lock behaviour.
  addOptions() {
    return {
      ...this.parent?.(),
      resizable: false,                 // no draggable column borders — not a spreadsheet
      HTMLAttributes: { class: 'wp-script-table' },
      // A cell is full-bleed; we never want the default min-width chrome forcing a scrollbar.
      cellMinWidth: 0,
      lastColumnResizable: false,
    };
  },
  renderHTML({ HTMLAttributes }) {
    // Bare table — NO wrapping scroll div, NO colgroup forced widths. CSS lays out rows.
    return ['table', mergeAttrs(HTMLAttributes, { class: 'wp-script-table' }), ['tbody', 0]];
  },
});

// ROW — one script line. Default: a single full-width cell. Split (later): two cells.
export const ScriptRow = TableRow.extend({
  name: 'tableRow',
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'wp-script-row' } };
  },
  renderHTML({ HTMLAttributes }) {
    return ['tr', mergeAttrs(HTMLAttributes, { class: 'wp-script-row' }), 0];
  },
});

// CELL — the transparent frame around a cartridge. content 'block+' (inherited) so any
// cartridge (chapter/scene/vo/oncam/sot/broll/note/bin/service*) sits inside it untouched.
// We carry a `col` attr ('full' | 'said' | 'shown') so a split row can mark which side a
// cell is — SPINE #1 only ever emits 'full', but the attr is here so downstream split/merge
// is a pure data change, no schema migration.
export const ScriptCell = TableCell.extend({
  name: 'tableCell',
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'wp-script-cell' } };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      col: {
        default: 'full',
        parseHTML: (el) => el.getAttribute('data-col') || 'full',
        renderHTML: (attrs) => (attrs.col ? { 'data-col': attrs.col } : {}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['td', mergeAttrs(HTMLAttributes, { class: 'wp-script-cell' }), 0];
  },
});

// HEADER cell — chapters & scenes are FULL-WIDTH HEADER ROWS (scenes keep header energy).
// We register tableHeader so the schema is complete + future header rows are first-class,
// but SPINE #1 keeps chapter/scene cartridges in ordinary cells (they already render their
// own dark/heading chrome — wrapping them in <th> would double the "header" semantics and
// risk the audit's heading-text extraction). The class hook is here for the split phase.
export const ScriptHeaderCell = TableHeader.extend({
  name: 'tableHeader',
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'wp-script-cell wp-script-cell-head' } };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      col: {
        default: 'full',
        parseHTML: (el) => el.getAttribute('data-col') || 'full',
        renderHTML: (attrs) => (attrs.col ? { 'data-col': attrs.col } : {}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['th', mergeAttrs(HTMLAttributes, { class: 'wp-script-cell wp-script-cell-head' }), 0];
  },
});

// tiny attr-merge so we never clobber the data-* PM threads onto the element.
function mergeAttrs(a, b) {
  const out = { ...(a || {}) };
  for (const k in b) {
    if (k === 'class') out.class = [out.class, b.class].filter(Boolean).join(' ');
    else out[k] = b[k];
  }
  return out;
}

export const TABLE_SPINE_NODES = [ScriptTable, ScriptRow, ScriptCell, ScriptHeaderCell];
