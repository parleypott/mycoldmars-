/*
 * row-ops.test.mjs — the three producer-facing row transforms in table.js that had ZERO
 * direct coverage: doMergeRow, doAddRowsBelow, doDeleteRow. These are the delete / merge /
 * add-rows-below operations the writer fires from the left-margin row menu and the "+" tool
 * in the Burma/Palau Script editor — the tool Johnny and his editors are collaboratively
 * editing RIGHT NOW. Their tested sibling doSplitRow was already locked; these three were not,
 * so a future refactor could silently (a) lose SHOWN-lane words on a merge, (b) drop the
 * one-transaction/one-undo contract on add-rows, or (c) break the last-row guard and leave the
 * doc schema-invalid — none caught until a teammate's script corrupted mid-session.
 *
 * Every assertion here is mutation-proven load-bearing: neutering the guard it protects turns
 * it RED (verified against the shipped table.js — see the loop journal for the RED runs).
 *
 * Proves:
 *   MERGE  — a cols:2 said|shown row collapses to ONE cols:1 role:full row holding said's
 *            blocks THEN shown's blocks in reading order, byte-equal, NO words lost; an empty
 *            SHOWN placeholder paragraph is dropped (no phantom bin block); a < 2-cell row is
 *            refused; the result passes the mirror-schema check.
 *   ADD    — doAddRowsBelow inserts exactly N sibling rows below, cloning the source row's
 *            column structure (full below full, said|shown below a split row); count clamps to
 *            1..50; the whole insert is ONE transaction (one undo pulls all N back out).
 *   DELETE — a middle row deletes cleanly keeping sibling order; the LAST row in its parent is
 *            REPLACED with a fresh empty full-width row (parent never left empty / invalid),
 *            and the doc still passes check().
 *
 * Run: bun src/extensions/row-ops.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doMergeRow, doAddRowsBelow, doDeleteRow, BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks } from '../document-builder.js';
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
const row = (blocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const pairedRow = (pairId, saidBlocks, shownBlocks) => ({
  type: 'tableRow', attrs: { cols: 2, pairId },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const sot = (id, text) => ({
  type: 'sotBlock',
  attrs: {
    blockId: id, timecode: '01:02:03:04', tcOut: '01:02:59:00', day: 2,
    ambiguous: false, speaker: 'U AUNG', done: true, rawTimecode: '01:02:03:04',
  },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const emptyPara = { type: 'paragraph' };

const rowPos = (doc, index) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
};
const makeState = (docJson) => EditorState.create({
  schema, doc: docFrom(docJson), plugins: [history()],
});

// ── MERGE: both lanes carry content — nothing is lost, reading order said→shown ──────────
ok('doMergeRow collapses said|shown to one full row, said blocks THEN shown blocks, lossless', () => {
  let state = makeState({ type: 'doc', content: [
    pairedRow('p1', [vo('a', 'what the general said'), sot('a2', 'a second said line')], [none('b', 'what was shown')]),
  ] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doMergeRow(state, dispatch, rowPos(state.doc, 0)), true, 'merge returns true');

  const merged = state.doc.child(0);
  assert.equal(merged.attrs.cols, 1, 'row collapses to cols:1');
  assert.equal(merged.childCount, 1, 'one cell');
  assert.equal(merged.child(0).attrs.role, 'full', 'cell role becomes full');

  const blocks = docToBlocks(state.doc.toJSON());
  // Load-bearing: SHOWN-lane block "b" MUST survive, in reading order after the said blocks.
  assert.deepEqual(blocks.map((x) => x.id), ['a', 'a2', 'b'], 'said blocks then shown block, in reading order');
  assert.deepEqual(blocks.map((x) => x.text), ['what the general said', 'a second said line', 'what was shown'], 'every word preserved');
  // SOT attrs survive the merge (byte-level integrity of the moved block).
  const sotOut = blocks.find((x) => x.id === 'a2');
  assert.equal(sotOut.type, 'sot', 'merged SOT keeps its type');
  assert.equal(sotOut.timecode.tc, '01:02:03:04', 'merged SOT timecode survives');

  docFrom(state.doc.toJSON()).check(); // mirror-schema valid
});

// ── MERGE: empty SHOWN placeholder is dropped — no phantom bin block ──────────────────────
ok('doMergeRow drops an empty SHOWN placeholder paragraph (no phantom block)', () => {
  let state = makeState({ type: 'doc', content: [
    pairedRow('p2', [vo('a', 'said only, nothing shown')], [emptyPara]),
  ] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doMergeRow(state, dispatch, rowPos(state.doc, 0)), true, 'merge returns true');
  const blocks = docToBlocks(state.doc.toJSON());
  assert.deepEqual(blocks.map((x) => x.id), ['a'], 'only the said block remains — empty shown para dropped');
  assert.ok(!blocks.some((x) => x.type === 'bin'), 'no phantom bin block leaked from the empty placeholder');
});

// ── MERGE: a row that is not a clean multi-cell split is refused ──────────────────────────
ok('doMergeRow refuses a single-cell (already-full) row', () => {
  let state = makeState({ type: 'doc', content: [row([vo('a', 'plain full row')])] });
  let dispatched = false;
  const dispatch = () => { dispatched = true; };
  assert.equal(doMergeRow(state, dispatch, rowPos(state.doc, 0)), false, 'returns false on a 1-cell row');
  assert.equal(dispatched, false, 'a refused merge dispatches nothing');
});

// ── ADD: N rows below, cloning column structure, in ONE undoable transaction ─────────────
ok('doAddRowsBelow inserts N sibling rows below in one transaction (one undo removes all N)', () => {
  let state = makeState({ type: 'doc', content: [row([vo('a', 'line one')]), row([vo('b', 'line two')])] });
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doAddRowsBelow(state, dispatch, rowPos(state.doc, 0), 3), true, 'add returns true');
  assert.equal(state.doc.childCount, 5, 'three rows inserted below row 0 (2 -> 5)');
  // The three new rows land BETWEEN the two originals (below row 0), not at the end.
  assert.equal(state.doc.child(4).child(0).child(0).textContent, 'line two', 'original row 1 stays last');

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'ONE undo pulls all three rows back out — single transaction');
});

ok('doAddRowsBelow clones the source row column structure (paired below paired)', () => {
  let state = makeState({ type: 'doc', content: [pairedRow('p3', [vo('a', 'said')], [none('b', 'shown')])] });
  const dispatch = (tr) => { state = state.apply(tr); };
  doAddRowsBelow(state, dispatch, rowPos(state.doc, 0), 1);
  const added = state.doc.child(1);
  assert.equal(added.attrs.cols, 2, 'new row below a split row is itself a 2-column row');
  assert.deepEqual([added.child(0).attrs.role, added.child(1).attrs.role], ['said', 'shown'], 'said|shown roles cloned');
});

ok('doAddRowsBelow clamps count to 1..50', () => {
  let state = makeState({ type: 'doc', content: [row([vo('a', 'x')])] });
  const dispatch = (tr) => { state = state.apply(tr); };
  doAddRowsBelow(state, dispatch, rowPos(state.doc, 0), 999);
  assert.equal(state.doc.childCount - 1, 50, '999 clamps to 50 added rows');
  // 0 / negative / NaN clamp UP to the 1 minimum (never a silent no-op that eats the click).
  let s2 = makeState({ type: 'doc', content: [row([vo('a', 'x')])] });
  const d2 = (tr) => { s2 = s2.apply(tr); };
  doAddRowsBelow(s2, d2, rowPos(s2.doc, 0), 0);
  assert.equal(s2.doc.childCount - 1, 1, '0 clamps to 1 added row');
});

// ── DELETE: a middle row goes cleanly, siblings keep order ───────────────────────────────
ok('doDeleteRow removes a middle row keeping sibling order', () => {
  let state = makeState({ type: 'doc', content: [
    row([vo('a', 'one')]), row([vo('b', 'two')]), row([vo('c', 'three')]),
  ] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doDeleteRow(state, dispatch, rowPos(state.doc, 1)), true, 'delete returns true');
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((x) => x.id), ['a', 'c'], 'middle row gone, order kept');
});

// ── DELETE: last row in a parent is REPLACED, never left empty (schema guard) ─────────────
ok('doDeleteRow replaces the LAST row with a fresh empty full row (never leaves an empty/invalid doc)', () => {
  let state = makeState({ type: 'doc', content: [row([vo('a', 'the only line')])] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doDeleteRow(state, dispatch, rowPos(state.doc, 0)), true, 'delete returns true');
  assert.equal(state.doc.childCount, 1, 'doc still has exactly one row (not emptied)');
  const fresh = state.doc.child(0);
  assert.equal(fresh.attrs.cols, 1, 'the replacement is a full-width row');
  assert.equal(fresh.child(0).attrs.role, 'full', 'replacement cell role is full');
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((x) => x.id), [], 'the old block is gone (empty replacement)');
  docFrom(state.doc.toJSON()).check(); // MUST stay schema-valid — the whole point of the guard
});

console.log(`row-ops.test.mjs: ${pass} assertions passed`);
