/*
 * delete-row.test.mjs — the row menu's "Delete row" transaction (table.js doDeleteRow),
 * reached by right-clicking the ⊟/⊞ split-merge box in the row's left margin.
 *
 * Proves:
 *   1. Deleting a middle row removes exactly that row; neighbors keep every word.
 *   2. ONE UNDO restores the deleted row byte-exact (words are never truly gone).
 *   3. LAST-ROW GUARD — deleting the doc's only row REPLACES it with a fresh empty
 *      full-width row (never an empty/invalid doc), carrying a pairu_ keep-me marker.
 *   4. MIRROR SCHEMA — the post-delete doc passes PMNode.check() and round-trips
 *      fromJSON→toJSON byte-exact (the save-gate law).
 *   5. Garbage positions (not a row / out of range) return false and change nothing.
 *
 * Run: bun src/extensions/delete-row.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doDeleteRow } from './table.js';
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
    horizontalRule: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const row = (text) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{
      type: 'noneBlock', attrs: { blockId: 'blk_' + text.slice(0, 3) },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }],
  }],
});

function makeState(docJson) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc, plugins: [history()],
    selection: TextSelection.near(doc.resolve(0), 1),
  });
}

// position just before the Nth top-level row
function rowPos(doc, n) {
  let pos = 0;
  for (let i = 0; i < n; i++) pos += doc.child(i).nodeSize;
  return pos;
}

// ── 1+2+4: delete a middle row; neighbors intact; one undo restores ────────────────────────
ok('deleting a middle row removes it cleanly; one undo restores byte-exact', () => {
  const docJson = { type: 'doc', content: [row('alpha words'), row('beta words'), row('gamma words')] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doDeleteRow(state, dispatch, rowPos(state.doc, 1)), true, 'delete returns true');
  assert.equal(state.doc.childCount, 2, 'one row gone');
  assert.equal(state.doc.child(0).textContent, 'alpha words', 'row above intact');
  assert.equal(state.doc.child(1).textContent, 'gamma words', 'row below intact');
  assert.ok(!state.doc.textContent.includes('beta'), 'the deleted row is gone');

  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo brings the row back byte-exact');
});

// ── 3: last-row guard — never an empty doc ─────────────────────────────────────────────────
ok('deleting the only row replaces it with a fresh empty full-width row', () => {
  const docJson = { type: 'doc', content: [row('the last words')] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doDeleteRow(state, dispatch, 0), true);
  assert.equal(state.doc.childCount, 1, 'doc still has one row');
  const fresh = state.doc.child(0);
  assert.equal(fresh.type.name, 'tableRow');
  assert.equal(fresh.child(0).attrs.role, 'full');
  assert.equal(fresh.textContent, '', 'the fresh row is empty — the words are gone as asked');
  assert.ok(typeof fresh.attrs.pairId === 'string' && fresh.attrs.pairId.startsWith('pairu_'),
    'fresh row carries the pairu_ keep-me marker so load-normalizers never cull it');
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
});

// ── 5: garbage positions are inert ─────────────────────────────────────────────────────────
ok('non-row / out-of-range positions return false and change nothing', () => {
  const docJson = { type: 'doc', content: [row('alpha'), row('beta')] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doDeleteRow(state, dispatch, 2), false, 'inside-a-row pos is not a row');
  assert.equal(doDeleteRow(state, dispatch, 10_000), false, 'out of range');
  assert.equal(doDeleteRow(state, dispatch, null), false, 'null pos');
  assert.deepEqual(clone(state.doc.toJSON()), before, 'doc untouched');
});

console.log(`delete-row.test.mjs: ${pass} assertions passed`);
