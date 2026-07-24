/*
 * row-transfer.test.mjs — the TRANSFER / COPY SECTION engine (row-transfer.js).
 *
 * WHY THIS SUITE EXISTS: "transfer this section" moves a contiguous band of top-level rows from
 * position A to position B in ONE transaction (chapter-reorder's pure-permutation doctrine, applied
 * to an arbitrary selection-derived row range). "copy this section" duplicates it with FRESH ids.
 * Burma + Palau sync over Liveblocks + Yjs, so a lossy or multi-transaction move would corrupt every
 * teammate's doc instantly; a copy that duplicated blockIds would break every blockId-keyed anchor.
 *
 * Proves:
 *   1. posOfChildIndex / childIndexOfPos round-trip; resolveRowRange finds the contiguous range.
 *   2. TRANSFER is a pure permutation — blockId multiset unchanged, row count unchanged, sibling
 *      order correct, docToBlocks round-trips, ONE undo restores byte-exact.
 *   3. TRANSFER preserves a two-column paired row (cols/pairId + both cells) and a bookmarkId, and
 *      lands rows as TOP-LEVEL siblings (never nested in a cell — the mini-two-column bug can't form).
 *   4. TRANSFER illegal targets (inside the range, at the range's own edges) → false, no dispatch.
 *   5. COPY duplicates at the gap, origin untouched, row count grows by the section length, every
 *      cloned blockId is NEW + globally unique, pairId re-minted, bookmarkId dropped.
 *   6. Move to top (index 0) and bottom (childCount) both land correctly.
 *   7. Probe mode (no dispatch) never mutates.
 *
 * Run: bun src/extensions/row-transfer.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_TABLE_NODES, collectIntersectingRows, rowFirstBlockId } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { collectBlockIds } from './chapter-reorder.js';
import {
  moveRowRange, copyRowRange, resolveRowRange, posOfChildIndex, childIndexOfPos,
  isLegalTransferTarget, cloneWithFreshIds,
} from './row-transfer.js';
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
const row = (blocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const pairedRow = (pairId, saidBlocks, shownBlocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 2, pairId, bookmarkId: null, ...(attrs || {}) },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const makeState = (docJson) => EditorState.create({ schema, doc: docFrom(docJson), plugins: [history()] });

// A 6-row fixture: two-column paired row + a bookmarked row in the middle band.
const sixRowJson = () => ({ type: 'doc', content: [
  row([none('r0', 'row zero')]),                                              // 0
  row([vo('r1', 'row one')]),                                                 // 1
  pairedRow('pair_2', [vo('r2s', 'said two')], [none('r2sh', 'shown two')]), // 2
  row([none('r3', 'row three')], { bookmarkId: 'bm_x' }),                    // 3
  row([none('r4', 'row four')]),                                             // 4
  row([none('r5', 'row five')]),                                            // 5
] });

// Top-level row-order fingerprint = the first-block id of each top-level row.
const rowOrder = (doc) => {
  const ids = [];
  doc.forEach((n) => { if (n.type.name === 'tableRow') ids.push(rowFirstBlockId(n)); });
  return ids;
};

// Build the identity rowRefs for a set of top-level child indices, EXACTLY as convert-menu.js does
// at menu-open (node ref + first-block id + pairId).
const refsForIndices = (doc, indices) => indices.map((i) => {
  const node = doc.child(i);
  return { node, blockId: rowFirstBlockId(node), pairId: node.attrs?.pairId || null };
});

// ── 1: position helpers + resolveRowRange ───────────────────────────────────────────────────────
ok('posOfChildIndex / childIndexOfPos round-trip on every boundary', () => {
  const doc = docFrom(sixRowJson());
  for (let i = 0; i <= doc.childCount; i++) {
    const pos = posOfChildIndex(doc, i);
    assert.equal(childIndexOfPos(doc, pos), i, `boundary ${i} round-trips`);
  }
  // A mid-node position is NOT a boundary.
  assert.equal(childIndexOfPos(doc, 1), null, 'position 1 is inside row 0, not a boundary');
});

ok('resolveRowRange resolves a contiguous section from identity refs', () => {
  const doc = docFrom(sixRowJson());
  const refs = refsForIndices(doc, [1, 2, 3]);
  const range = resolveRowRange(doc, refs);
  assert.equal(range.startIndex, 1);
  assert.equal(range.endIndex, 4);
  assert.equal(range.movingNodes.length, 3);
  assert.deepEqual(range.movingNodes.map((n) => rowFirstBlockId(n)), ['r1', 'r2s', 'r3']);
  // A single collapsed caret's row (via collectIntersectingRows) resolves to one row.
  const single = collectIntersectingRows(doc, posOfChildIndex(doc, 4) + 2, posOfChildIndex(doc, 4) + 2);
  const singleRefs = single.map(({ node }) => ({ node, blockId: rowFirstBlockId(node), pairId: node.attrs?.pairId || null }));
  const r2 = resolveRowRange(doc, singleRefs);
  assert.equal(r2.startIndex, 4);
  assert.equal(r2.endIndex, 5);
});

ok('isLegalTransferTarget refuses the range interior + own edges, allows outside gaps', () => {
  const doc = docFrom(sixRowJson());
  // Section [1,4): gaps 1,2,3,4 are illegal (edges + interior); 0,5,6 are legal.
  for (const g of [1, 2, 3, 4]) assert.equal(isLegalTransferTarget(doc, 1, 4, g), false, `gap ${g} illegal`);
  for (const g of [0, 5, 6]) assert.equal(isLegalTransferTarget(doc, 1, 4, g), true, `gap ${g} legal`);
  assert.equal(isLegalTransferTarget(doc, 1, 4, 7), false, 'out-of-range gap illegal');
});

// ── 2+3: TRANSFER — pure permutation, lossless, sibling order, paired-row + bookmark preserved ──
ok('TRANSFER moves a 3-row section to a later gap losslessly (one undo restores)', () => {
  let state = makeState(sixRowJson());
  const before = clone(state.doc.toJSON());
  const idsBefore = collectBlockIds(state.doc);
  const blocksBefore = docToBlocks(before);
  const refs = refsForIndices(state.doc, [1, 2, 3]);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Move [r1, paired, r3] to gap 5 (between r4 and r5).
  assert.equal(moveRowRange(state, dispatch, refs, 5), true, 'transfer returns true');

  assert.deepEqual(rowOrder(state.doc), ['r0', 'r4', 'r1', 'r2s', 'r3', 'r5'], 'sibling order after move');
  assert.equal(state.doc.childCount, 6, 'row count unchanged');
  assert.deepEqual(collectBlockIds(state.doc), idsBefore, 'blockId multiset unchanged (pure permutation)');

  // The paired row survives intact: cols 2, same pairId, both cells with roles.
  const movedPaired = state.doc.child(3);
  assert.equal(movedPaired.attrs.cols, 2, 'moved paired row still 2 cols');
  assert.equal(movedPaired.attrs.pairId, 'pair_2', 'pairId preserved by permutation');
  assert.equal(movedPaired.childCount, 2, 'both cells present');
  assert.deepEqual([movedPaired.child(0).attrs.role, movedPaired.child(1).attrs.role], ['said', 'shown']);
  // The bookmark rides along on r3.
  assert.equal(state.doc.child(4).attrs.bookmarkId, 'bm_x', 'bookmarkId preserved');

  // No nested two-column: every moved row is a DIRECT doc child (depth-0), never inside a cell.
  for (let i = 0; i < state.doc.childCount; i++) {
    assert.equal(state.doc.resolve(posOfChildIndex(state.doc, i)).depth, 0, `row ${i} is top-level`);
  }
  // docToBlocks round-trips to the same block multiset (order-based lossless).
  const blocksAfter = docToBlocks(state.doc.toJSON());
  assert.equal(blocksAfter.length, blocksBefore.length, 'same block count through document-builder');

  // ONE undo restores byte-exact (history is per-state; run the move on a fresh state, then undo).
  let s2 = makeState(sixRowJson());
  const refs2 = refsForIndices(s2.doc, [1, 2, 3]);
  s2 = s2.apply((() => { let t; moveRowRange(s2, (tr) => { t = tr; }, refs2, 5); return t; })());
  let restored = null;
  undo(s2, (tr) => { restored = s2.apply(tr); });
  assert.deepEqual(restored.doc.toJSON(), before, 'one undo restores the exact original doc');
});

ok('TRANSFER to the very top (gap 0) and very bottom (gap childCount) both land', () => {
  // To top.
  let s = makeState(sixRowJson());
  let refs = refsForIndices(s.doc, [3, 4]);
  s = s.apply((() => { let t; moveRowRange(s, (tr) => { t = tr; }, refs, 0); return t; })());
  assert.deepEqual(rowOrder(s.doc), ['r3', 'r4', 'r0', 'r1', 'r2s', 'r5'], 'section jumps to top');
  // To bottom.
  let s2 = makeState(sixRowJson());
  let refs2 = refsForIndices(s2.doc, [0, 1]);
  s2 = s2.apply((() => { let t; moveRowRange(s2, (tr) => { t = tr; }, refs2, 6); return t; })());
  assert.deepEqual(rowOrder(s2.doc), ['r2s', 'r3', 'r4', 'r5', 'r0', 'r1'], 'section jumps to bottom');
});

ok('TRANSFER refuses illegal / no-op targets (no dispatch)', () => {
  const state = makeState(sixRowJson());
  const refs = refsForIndices(state.doc, [1, 2, 3]);
  let dispatched = false;
  const dispatch = () => { dispatched = true; };
  // Inside the range.
  assert.equal(moveRowRange(state, dispatch, refs, 2), false, 'gap inside range refused');
  // At the range's own start (no-op) and end (no-op).
  assert.equal(moveRowRange(state, dispatch, refs, 1), false, 'own start refused');
  assert.equal(moveRowRange(state, dispatch, refs, 4), false, 'own end refused');
  assert.equal(dispatched, false, 'nothing dispatched for any illegal target');
  // Empty refs.
  assert.equal(moveRowRange(state, dispatch, [], 0), false, 'empty refs refused');
});

// ── 4: probe mode ───────────────────────────────────────────────────────────────────────────────
ok('probe mode (no dispatch) reports legality without mutating', () => {
  const state = makeState(sixRowJson());
  const before = clone(state.doc.toJSON());
  const refs = refsForIndices(state.doc, [1, 2]);
  assert.equal(moveRowRange(state, null, refs, 5), true, 'legal move probes true');
  assert.equal(copyRowRange(state, null, refs, 5), true, 'copy probes true');
  assert.deepEqual(state.doc.toJSON(), before, 'doc untouched by probes');
});

// ── 5: COPY — duplicate with fresh ids, origin untouched ────────────────────────────────────────
ok('COPY duplicates a section at the gap with FRESH unique ids, origin intact', () => {
  let state = makeState(sixRowJson());
  const idsBefore = collectBlockIds(state.doc);
  const refs = refsForIndices(state.doc, [1, 2, 3]);
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(copyRowRange(state, dispatch, refs, 5), true, 'copy returns true');

  // Row count grew by the section length (3).
  assert.equal(state.doc.childCount, 9, 'row count grew by 3');
  // Origin band untouched: indices 1,2,3 are still the originals.
  assert.deepEqual(rowOrder(state.doc).slice(0, 5), ['r0', 'r1', 'r2s', 'r3', 'r4'], 'origin rows unchanged');
  assert.equal(state.doc.child(2).attrs.pairId, 'pair_2', 'origin paired row untouched');
  assert.equal(state.doc.child(3).attrs.bookmarkId, 'bm_x', 'origin bookmark untouched');

  // The clones sit at indices 5,6,7 (gap 5, between original r4 and r5).
  const clones = [state.doc.child(5), state.doc.child(6), state.doc.child(7)];
  const cloneIds = collectBlockIds(state.doc).filter((id) => !idsBefore.includes(id));
  // Exactly 4 fresh block ids (r1 clone, paired said+shown = 2, r3 clone) — every original block minted anew.
  const origBlockCount = idsBefore.length;
  const afterIds = collectBlockIds(state.doc);
  assert.equal(afterIds.length, origBlockCount + 4, 'four new block ids (r1, said, shown, r3 clones)');
  // No duplicate ids anywhere.
  assert.equal(new Set(afterIds).size, afterIds.length, 'all block ids globally unique after copy');
  // Cloned paired row: fresh pairId (not the original), both cells present.
  const clonedPaired = clones[1];
  assert.equal(clonedPaired.attrs.cols, 2, 'clone still 2 cols');
  assert.notEqual(clonedPaired.attrs.pairId, 'pair_2', 'clone pairId re-minted');
  assert.ok(clonedPaired.attrs.pairId && clonedPaired.attrs.pairId.startsWith('pairu_'), 'clone pairId is a user-mint');
  // Cloned bookmarked row: bookmarkId dropped (a bookmark marks ONE place).
  assert.equal(clones[2].attrs.bookmarkId, null, 'clone bookmarkId dropped');
  // Cloned prose survives (content copied, not blanked).
  assert.equal(clones[0].textContent, 'row one', 'clone keeps its text');
  assert.equal(clonedPaired.child(0).textContent, 'said two', 'clone keeps said text');
});

ok('cloneWithFreshIds re-mints ids recursively and shares text nodes', () => {
  const doc = docFrom(sixRowJson());
  const paired = doc.child(2);
  const c = cloneWithFreshIds(paired);
  assert.notEqual(c.attrs.pairId, paired.attrs.pairId, 'row pairId re-minted');
  // Every block inside carries a new blockId.
  const origIds = [];
  paired.descendants((n) => { if (n.attrs?.blockId) origIds.push(n.attrs.blockId); return true; });
  const newIds = [];
  c.descendants((n) => { if (n.attrs?.blockId) newIds.push(n.attrs.blockId); return true; });
  assert.equal(newIds.length, origIds.length, 'same number of blocks');
  for (const id of newIds) assert.ok(!origIds.includes(id), 'no cloned blockId collides with an original');
});

console.log(`row-transfer.test.mjs: ${pass} assertions passed`);
