/*
 * cell-hop.test.mjs — Tab / Shift-Tab cell navigation (table.js doCellHop).
 * Johnny: "if im in left column tab brings me to right and if im in right column tab brings
 * me to the left column in the row below. shift tab goes the opposite way."
 *
 * Proves:
 *   1. Tab in a said cell → caret lands in the SAME row's shown cell.
 *   2. Tab in a shown cell → caret lands in the NEXT row's said cell.
 *   3. Shift-Tab walks the exact reverse.
 *   4. Tab at the LAST cell is swallowed (returns true, caret stays) — focus never escapes.
 *   5. Inside a list item the hop declines (returns false) so list indent wins.
 *   6. SELECTION-ONLY — the doc is byte-identical after a hop (collab-loop law).
 *
 * Run: bun src/extensions/cell-hop.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doCellHop } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const cell = (role, text) => ({
  type: 'tableCell', attrs: { role },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const splitRow = (a, b) => ({ type: 'tableRow', attrs: { cols: 2, pairId: null }, content: [cell('said', a), cell('shown', b)] });

const DOC = {
  type: 'doc',
  content: [splitRow('r1 said', 'r1 shown'), splitRow('r2 said', 'r2 shown')],
};

// caret inside the cell whose text starts with `label`
function stateInCell(label) {
  const doc = docFrom(DOC);
  let at = null;
  doc.descendants((n, pos) => { if (at == null && n.isText && n.text.startsWith(label)) at = pos + 1; });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
}

// which cell's text the selection currently sits in
function cellTextAt(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'tableCell') return $from.node(d).textContent;
  return null;
}

ok('Tab: said → same row shown', () => {
  let state = stateInCell('r1 said');
  const before = clone(state.doc.toJSON());
  assert.equal(doCellHop(state, (tr) => { state = state.apply(tr); }, 1), true);
  assert.equal(cellTextAt(state), 'r1 shown');
  assert.deepEqual(clone(state.doc.toJSON()), before, 'selection-only — doc untouched');
});

ok('Tab: shown → NEXT row said', () => {
  let state = stateInCell('r1 shown');
  assert.equal(doCellHop(state, (tr) => { state = state.apply(tr); }, 1), true);
  assert.equal(cellTextAt(state), 'r2 said');
});

ok('Shift-Tab walks the reverse', () => {
  let state = stateInCell('r2 said');
  assert.equal(doCellHop(state, (tr) => { state = state.apply(tr); }, -1), true);
  assert.equal(cellTextAt(state), 'r1 shown');
  assert.equal(doCellHop(state, (tr) => { state = state.apply(tr); }, -1), true);
  assert.equal(cellTextAt(state), 'r1 said');
});

ok('Tab at the last cell is swallowed — caret stays, focus never escapes', () => {
  let state = stateInCell('r2 shown');
  const before = state.selection.from;
  assert.equal(doCellHop(state, (tr) => { state = state.apply(tr); }, 1), true, 'handled (swallowed)');
  assert.equal(state.selection.from, before, 'caret unmoved');
});

ok('inside a list item the hop declines (list indent wins)', () => {
  const doc = docFrom({
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bullet words' }] }] }],
        }],
      }],
    }],
  });
  let at = null;
  doc.descendants((n, pos) => { if (at == null && n.isText) at = pos + 1; });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, at) });
  assert.equal(doCellHop(state, () => {}, 1), false);
});

console.log(`cell-hop.test.mjs: ${pass} assertions passed`);
