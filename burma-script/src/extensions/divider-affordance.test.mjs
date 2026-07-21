/*
 * divider-affordance.test.mjs — the column-divider merge/split affordances (editor-ergonomics
 * 2026-07-21). The old left-margin ⊞ spine is dead; a SPLIT row wears a MERGE chip on its divider
 * and a FULL-WIDTH row wears a SPLIT chip at its far-right edge, and clicking one dispatches the
 * SAME lossless doMergeRow/doSplitRow transactions the spine used (no new mutation path).
 *
 * Proves:
 *   1. ROUTING — rowIsSplitNode (paintDivider's single truth) says split rows get MERGE, full
 *      rows get SPLIT, for cols-attr'd rows AND childCount-shaped rows (attrs advisory law).
 *   2. AFFORDANCE → TRANSACTION — the chip's action on a split row (doMergeRow) yields the
 *      full-width row losslessly (said then shown, reading order); on a full row (doSplitRow)
 *      yields said|shown with every word kept in said; both are one undo back to byte-exact.
 *   3. TOGGLE CYCLE — split → merge → split preserves the words through the whole cycle (the
 *      round-trip law the existing toggle-split suite locks, re-proven through the chip path).
 *
 * Run: bun src/extensions/divider-affordance.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doMergeRow, doSplitRow, rowIsSplitNode, BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
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
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const fullRow = (blocks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const splitRow = (saidBlocks, shownBlocks) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'pair_x' },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});
const makeState = (docJson) => {
  const doc = docFrom(docJson);
  return EditorState.create({ schema, doc, plugins: [history()], selection: TextSelection.near(doc.resolve(0), 1) });
};
const words = (doc) => {
  const out = [];
  doc.descendants((n) => { if (n.isText) out.push(n.text); return true; });
  return out.join(' ');
};

// ── 1. ROUTING — which chip a row wears ──────────────────────────────────────────────────────
ok('rowIsSplitNode routes split→MERGE, full→SPLIT (attrs AND childCount shapes)', () => {
  const s = makeState({ type: 'doc', content: [fullRow([none('a', 'alpha')]), splitRow([none('b', 'beta')], [none('c', 'gamma')])] });
  assert.equal(rowIsSplitNode(s.doc.child(0)), false, 'full-width row → split chip');
  assert.equal(rowIsSplitNode(s.doc.child(1)), true, 'split row → merge chip');
  assert.equal(rowIsSplitNode(null), false);
  // childCount is the primary truth (cols attr is advisory)
  assert.equal(rowIsSplitNode({ childCount: 2, attrs: { cols: 1 } }), true);
  assert.equal(rowIsSplitNode({ childCount: 0, attrs: { cols: 2 } }), true);
});

// ── 2. AFFORDANCE → TRANSACTION — the chips dispatch the existing lossless ops ───────────────
ok('merge chip: doMergeRow folds said then shown into one full-width row; one undo restores', () => {
  const state = makeState({ type: 'doc', content: [splitRow([none('s', 'what was said')], [none('v', 'what was shown')])] });
  const before = clone(state.doc.toJSON());
  let out = state;
  const did = doMergeRow(state, (tr) => { out = state.apply(tr); }, 0);
  assert.equal(did, true);
  const row = out.doc.child(0);
  assert.equal(row.childCount, 1);
  assert.equal(row.attrs.cols, 1);
  assert.equal(row.child(0).attrs.role, 'full');
  assert.equal(words(out.doc), 'what was said what was shown', 'reading order: said then shown, zero loss');
  let un = out;
  undo(un, (tr) => { un = un.apply(tr); });
  assert.deepEqual(clone(un.doc.toJSON()), before);
});

ok('split chip: doSplitRow keeps every word in said, opens an empty shown lane', () => {
  const state = makeState({ type: 'doc', content: [fullRow([none('f', 'all the words stay')])] });
  let out = state;
  const did = doSplitRow(state, (tr) => { out = state.apply(tr); }, 0);
  assert.equal(did, true);
  const row = out.doc.child(0);
  assert.equal(row.childCount, 2);
  assert.equal(row.attrs.cols, 2);
  assert.equal(row.child(0).attrs.role, 'said');
  assert.equal(row.child(1).attrs.role, 'shown');
  assert.equal(words(out.doc), 'all the words stay');
});

// ── 3. TOGGLE CYCLE through the chip path ────────────────────────────────────────────────────
ok('split → merge → split keeps the words through the whole cycle', () => {
  const state = makeState({ type: 'doc', content: [fullRow([none('c', 'cycle words survive')])] });
  let s1 = state;
  doSplitRow(state, (tr) => { s1 = state.apply(tr); }, 0);
  let s2 = s1;
  doMergeRow(s1, (tr) => { s2 = s1.apply(tr); }, 0);
  let s3 = s2;
  doSplitRow(s2, (tr) => { s3 = s2.apply(tr); }, 0);
  assert.equal(words(s3.doc), 'cycle words survive');
  assert.equal(rowIsSplitNode(s3.doc.child(0)), true);
});

console.log(`divider-affordance.test.mjs: ${pass} assertions passed`);
