// Burma Script Tool — MASTER ROW NUMBERS (always-on, decoration-only margin numbers).
//
// Every TOP-LEVEL row wears a tiny mono number in the left margin — quiet chrome for
// "look at row 141" conversations and the WORKSPACES views (workspaces.js sections
// speak in these indices). Numbers are dynamic: insert/delete/reorder a row and
// everything below renumbers on the next paint.
//
// HOW: a node decoration per top-level tableRow adding {'data-rownum': n} to the row's
// DOM; styles.css renders it via ::before content: attr(data-rownum), absolutely
// positioned into the gutter so layout never shifts. Nested rows (Palau's said|shown
// pairs inside a wrapper cell) get NO decoration — walkTopRows never descends — so the
// CSS, keyed on [data-rownum] presence, leaves them unnumbered.
//
// SINGLE SOURCE OF TRUTH: the enumeration is workspaces.js walkTopRows — the exact walk
// walkRows/scanWorkspace index by — so the margin number and a workspace section's
// startIndex can never disagree (row-numbers.test.mjs pins the 1:1 match).
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING (chapter-focus.js is the template) —
// it only recomputes a DecorationSet from the doc. Remote y-sync transactions rebuild
// the set (pure compute, O(top-level rows)); selection-only transactions reuse the
// previous set untouched. No auto-dispatch path exists, so it cannot echo.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { walkTopRows } from '../workspaces.js';

export const rowNumbersKey = new PluginKey('wpRowNumbers');

// Exported for the headless suite — the decoration set a doc should carry. The spec
// carries the numeric index so tests (and future consumers) can read it without
// poking at prosemirror-view internals; the DOM contract is the data-rownum attr.
export function buildRowNumberDecorations(doc) {
  const decos = walkTopRows(doc).map(({ index, pos, node }) =>
    Decoration.node(pos, pos + node.nodeSize, { 'data-rownum': String(index) }, { rownum: index }));
  return DecorationSet.create(doc, decos);
}

export const RowNumbers = Extension.create({
  name: 'rowNumbers',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: rowNumbersKey,
      state: {
        init: (_config, state) => buildRowNumberDecorations(state.doc),
        apply(tr, prev) {
          // Numbers depend on global row ORDER, so any doc change rebuilds (cheap:
          // O(top-level rows), no descent). Unchanged docs keep the same set object —
          // PM sees identical decorations and touches no DOM.
          if (!tr.docChanged) return prev;
          return buildRowNumberDecorations(tr.doc);
        },
      },
      props: {
        decorations(state) {
          return rowNumbersKey.getState(state) || DecorationSet.empty;
        },
      },
    })];
  },
});
