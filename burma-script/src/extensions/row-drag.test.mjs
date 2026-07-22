/*
 * row-drag.test.mjs — the row drag-to-reorder gesture's transaction core (table.js moveRow)
 * and the editor-ownership helpers the rowDragPlugin leans on (findRowByIdentity,
 * rowFirstBlockId, pickRowDropTarget), plus the docToBlocks nested-row backstop.
 *
 * WHY THIS SUITE EXISTS: the old row drag was per-row DOM listeners with no editor-level
 * owner. Drops in the dead zones (chapter-frame margins, page padding, below the last row)
 * fell through to ProseMirror's own drop handler, which parsed the dataTransfer and inserted
 * the literal text 'wp-row' into the script — instant, collab-synced corruption teammates
 * couldn't undo. The rebuilt gesture re-resolves the dragged row by IDENTITY at drop time
 * (collab-safe) and maps every pointer Y to a real row boundary (no dead zones). moveRow had
 * ZERO test coverage before this file.
 *
 * Proves:
 *   1. REORDER LOSSLESS — moveRow on top-level rows: docToBlocks before/after are the SAME
 *      blocks in the new order, byte-equal per block; the result passes the mirror-schema
 *      PMNode.check() and fromJSON→toJSON byte-exact (the save-gate law).
 *   2. ONE TRANSACTION / UNDO — one undo restores the exact original doc JSON.
 *   3. NO-OP DROPS — onto self / own edges return false and dispatch NOTHING (failed drags
 *      must never trigger autosave or snapshot churn).
 *   4. NESTED ROWS — same-parent nested-row reorder works (Palau's saved
 *      tableRow > tableCell > tableRow shape); a cross-parent drop is refused.
 *   5. COLLAB STALENESS — an unrelated edit lands between dragstart and drop; re-resolution
 *      by node identity and by first-block blockId both find the RIGHT row.
 *   6. pickRowDropTarget — pure boundary math: first-row-before, last-row-after, the gaps
 *      between chapter frames map to the adjacent boundary, empty list is null.
 *   7. NESTED-ROW EXPORT BACKSTOP — a tableCell-nested tableRow exports its blocks
 *      first-class through docToBlocks (types + SOT timecode/speaker attrs intact), instead
 *      of collapsing to ONE type:'bin' block as before.
 *
 * Run: bun src/extensions/row-drag.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { moveRow, findRowByIdentity, rowFirstBlockId, pickRowDropTarget, dragSourceSanctioned, BURMA_TABLE_NODES } from './table.js';
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

// Top-level position just before doc.child(index) (what doc.nodeAt / moveRow expect).
const rowPos = (doc, index) => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
};

const makeState = (docJson) => EditorState.create({
  schema, doc: docFrom(docJson), plugins: [history()],
});

// ── 1+2: reorder is lossless, mirror-checked, and one undo restores byte-exact ────────────
ok('moveRow reorders top-level rows losslessly (same blocks, new order, byte-equal)', () => {
  const docJson = { type: 'doc', content: [
    row([sot('blk_a', 'the general speaks')]),
    row([vo('blk_b', 'narration over the delta')]),
    row([none('blk_c', 'a plain line')]),
  ] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const blocksBefore = docToBlocks(before);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Drag row A (the SOT) to AFTER row C — the doc becomes B, C, A.
  assert.equal(moveRow(state, dispatch, rowPos(state.doc, 0), rowPos(state.doc, 2), false), true, 'move returns true');
  const blocksAfter = docToBlocks(state.doc.toJSON());
  assert.deepEqual(blocksAfter.map((b) => b.id), ['blk_b', 'blk_c', 'blk_a'], 'new order is B, C, A');
  // Same blocks byte-equal — every word, type, SOT timecode/speaker/done attr survives.
  const byId = (blocks) => Object.fromEntries(blocks.map((b) => [b.id, b]));
  assert.deepEqual(byId(blocksAfter), byId(blocksBefore), 'each block byte-equal before/after the move');

  // Mirror-schema round-trip (the save-gate law): check() + fromJSON→toJSON byte-exact.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');

  // ONE undo restores the pre-drag doc byte-exact (delete + insert = one history step).
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo restores the original doc');
});

ok('moveRow dropBefore=true inserts before the target row', () => {
  const docJson = { type: 'doc', content: [
    row([vo('blk_a', 'first')]), row([vo('blk_b', 'second')]), row([vo('blk_c', 'third')]),
  ] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  // Drag row C to BEFORE row A.
  assert.equal(moveRow(state, dispatch, rowPos(state.doc, 2), rowPos(state.doc, 0), true), true);
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((b) => b.id), ['blk_c', 'blk_a', 'blk_b']);
});

// ── 3: no-op drops return false and dispatch NOTHING ───────────────────────────────────────
ok('no-op drops (self, own edges) return false without dispatching', () => {
  const docJson = { type: 'doc', content: [
    row([vo('blk_a', 'first')]), row([vo('blk_b', 'second')]), row([vo('blk_c', 'third')]),
  ] };
  const state = makeState(docJson);
  let dispatched = 0;
  const dispatch = () => { dispatched++; };
  const p0 = rowPos(state.doc, 0), p1 = rowPos(state.doc, 1);
  assert.equal(moveRow(state, dispatch, p1, p1, true), false, 'drop onto self (before) is a no-op');
  assert.equal(moveRow(state, dispatch, p1, p1, false), false, 'drop onto self (after) is a no-op');
  assert.equal(moveRow(state, dispatch, p1, p0, false), false, 'drop just above own top edge is a no-op');
  assert.equal(moveRow(state, dispatch, p0, p1, true), false, 'drop just below own bottom edge is a no-op');
  assert.equal(moveRow(state, dispatch, p0, 1, true), false, 'non-row target position refused');
  assert.equal(moveRow(state, dispatch, null, p1, true), false, 'null fromPos refused');
  assert.equal(dispatched, 0, 'NOTHING dispatched — failed drags never trigger autosave/snapshots');
});

// ── 4: nested rows — same-parent reorder works, cross-parent refused (Palau shape) ─────────
ok('nested same-parent rows reorder; a cross-parent drop is refused', () => {
  const inner1 = pairedRow('pair_n1', [vo('blk_n1', 'nested said one')], [none('blk_n1s', 'nested shown one')]);
  const inner2 = pairedRow('pair_n2', [vo('blk_n2', 'nested said two')], [none('blk_n2s', 'nested shown two')]);
  const wrapper = {
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [inner1, inner2] }],
  };
  const docJson = { type: 'doc', content: [wrapper, row([vo('blk_top', 'a top-level row')])] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Positions: wrapper open (+1), cell open (+1) → just before inner1; inner2 follows it.
  const inner1Pos = 2;
  assert.equal(state.doc.nodeAt(inner1Pos)?.type.name, 'tableRow', 'sanity: inner1Pos resolves the nested row');
  const inner2Pos = inner1Pos + state.doc.nodeAt(inner1Pos).nodeSize;
  assert.equal(state.doc.nodeAt(inner2Pos)?.type.name, 'tableRow', 'sanity: inner2Pos resolves the sibling');

  // CROSS-PARENT: nested row onto the top-level row → refused, nothing dispatched.
  let dispatched = 0;
  const countDispatch = () => { dispatched++; };
  assert.equal(moveRow(state, countDispatch, inner1Pos, rowPos(state.doc, 1), true), false, 'cross-parent drop refused');
  assert.equal(moveRow(state, countDispatch, rowPos(state.doc, 1), inner1Pos, true), false, 'reverse cross-parent drop refused');
  assert.equal(dispatched, 0, 'refused cross-parent drops dispatch nothing');

  // SAME-PARENT: inner1 after inner2 — the nested siblings swap, losslessly.
  const before = clone(state.doc.toJSON());
  assert.equal(moveRow(state, dispatch, inner1Pos, inner2Pos, false), true, 'nested same-parent move works');
  const cell = state.doc.child(0).child(0);
  assert.deepEqual([cell.child(0).attrs.pairId, cell.child(1).attrs.pairId], ['pair_n2', 'pair_n1'], 'nested order swapped');
  state.doc.check();
  // Words survive and one undo restores the nested shape byte-exact.
  assert.ok(JSON.stringify(state.doc.toJSON()).includes('nested said one'), 'nested words intact');
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo restores the nested doc');
});

// ── 5: collab staleness — re-resolve the dragged row by identity after a remote edit ───────
ok('findRowByIdentity survives an unrelated edit between dragstart and drop', () => {
  const docJson = { type: 'doc', content: [
    row([sot('blk_a', 'the general speaks')]),
    row([vo('blk_b', 'narration')]),
    row([none('blk_c', 'plain')]),
  ] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };

  // dragstart captures IDENTITY of row A (node ref + first-block blockId + pairId).
  const draggedNode = state.doc.child(0);
  const ref = { node: draggedNode, blockId: rowFirstBlockId(draggedNode), pairId: draggedNode.attrs.pairId || null };
  assert.equal(ref.blockId, 'blk_a', 'sanity: identity carries the first-block blockId');

  // A "remote collaborator" inserts a row at the doc top mid-drag → every position shifts.
  const remoteRow = docFrom({ type: 'doc', content: [row([vo('blk_remote', 'remote insert')])] }).child(0);
  state = state.apply(state.tr.insert(0, remoteRow));

  // (a) Node-identity path: PM reuses untouched nodes across unrelated transactions.
  const resolved = findRowByIdentity(state.doc, ref);
  assert.equal(resolved, rowPos(state.doc, 1), 'identity re-resolution finds row A at its SHIFTED position');

  // (b) blockId path: break node identity (a Yjs remote sync rebuilds nodes wholesale).
  const staleRef = { node: docFrom(docJson).child(0), blockId: 'blk_a', pairId: null };
  assert.equal(findRowByIdentity(state.doc, staleRef), rowPos(state.doc, 1), 'blockId fallback finds the row when node identity is gone');

  // (c) pairId path: a paired row with no blockIds anywhere still re-resolves.
  const pairedJson = { type: 'doc', content: [
    row([vo('blk_x', 'x')]),
    pairedRow('pair_only', [{ type: 'paragraph', content: [{ type: 'text', text: 'said words' }] }],
      [{ type: 'paragraph', content: [{ type: 'text', text: 'shown words' }] }]),
  ] };
  const pairedDoc = docFrom(pairedJson);
  assert.equal(findRowByIdentity(pairedDoc, { node: null, blockId: null, pairId: 'pair_only' }),
    rowPos(pairedDoc, 1), 'pairId fallback finds the row');

  // (d) the row was deleted mid-drag → null, the drop becomes a handled no-op.
  assert.equal(findRowByIdentity(state.doc, { node: null, blockId: 'blk_gone', pairId: null }), null, 'a vanished row resolves to null');

  // And the drop itself, driven through the re-resolved position, moves the RIGHT row.
  assert.equal(moveRow(state, dispatch, resolved, rowPos(state.doc, 3), false), true, 'stale-drag drop still moves');
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((b) => b.id),
    ['blk_remote', 'blk_b', 'blk_c', 'blk_a'], 'the DRAGGED row moved — not whichever row inherited its old position');
});

// ── rowFirstBlockId: own blocks only, never a nested row's ─────────────────────────────────
ok('rowFirstBlockId reads the row\'s OWN first block and skips nested rows', () => {
  const plain = docFrom({ type: 'doc', content: [row([sot('blk_own', 'words')])] }).child(0);
  assert.equal(rowFirstBlockId(plain), 'blk_own', 'direct block id found');
  const wrapper = docFrom({ type: 'doc', content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [
      pairedRow('pair_in', [vo('blk_inner', 'inner')], [{ type: 'paragraph' }]),
    ] }],
  }] }).child(0);
  assert.equal(rowFirstBlockId(wrapper), null, 'wrapper does NOT answer to its nested row\'s blockId');
});

// ── 6: pickRowDropTarget — pure boundary math, no dead zones ───────────────────────────────
ok('pickRowDropTarget maps every pointer Y to a real boundary', () => {
  // Three rows with 30px chapter-frame-style gaps between them.
  const rects = [
    { top: 0, bottom: 100 },
    { top: 130, bottom: 230 },
    { top: 260, bottom: 360 },
  ];
  assert.deepEqual(pickRowDropTarget(rects, 10), { index: 0, before: true }, 'above the first midpoint → before first row');
  assert.deepEqual(pickRowDropTarget(rects, 500), { index: 2, before: false }, 'below the last midpoint → after last row');
  assert.deepEqual(pickRowDropTarget(rects, 115), { index: 1, before: true }, 'the GAP between rows 0 and 1 → the adjacent boundary (no dead zone)');
  assert.deepEqual(pickRowDropTarget(rects, 245), { index: 2, before: true }, 'the GAP between rows 1 and 2 → the adjacent boundary');
  assert.deepEqual(pickRowDropTarget(rects, 80), { index: 1, before: true }, 'lower half of a row → the boundary below it');
  assert.deepEqual(pickRowDropTarget(rects, 300), { index: 2, before: true }, 'upper half of the last row → before it');
  assert.equal(pickRowDropTarget([], 50), null, 'no candidate rows → null (handled no-op)');
  assert.equal(pickRowDropTarget(null, 50), null, 'null input → null');
  // A tall 2-col row changes nothing about the math — midpoints are midpoints.
  const twoCol = [{ top: 0, bottom: 400 }, { top: 410, bottom: 470 }];
  assert.deepEqual(pickRowDropTarget(twoCol, 190), { index: 0, before: true }, 'tall split row, upper half → before it');
  assert.deepEqual(pickRowDropTarget(twoCol, 210), { index: 1, before: true }, 'tall split row, lower half → after it');
});

// ── 7: docToBlocks nested-row backstop — nested rows export first-class, never one bin ──────
ok('a tableCell-nested tableRow exports its blocks with types + SOT attrs intact', () => {
  const nested = pairedRow('pair_nested', [sot('blk_ns', 'the minister answers')], [none('blk_nn', 'archive of the port')]);
  const docJson = { type: 'doc', content: [
    row([vo('blk_lead', 'lead narration')]),
    { type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [nested] }] },
  ] };
  // Schema-legal (tableCell holds block+, tableRow is group block) — check() proves it,
  // which is exactly why PM's native block drag could mint this shape in a live doc.
  docFrom(docJson).check();

  const blocks = docToBlocks(docJson);
  assert.deepEqual(blocks.map((b) => b.id), ['blk_lead', 'blk_ns', 'blk_nn'], 'nested blocks export individually, in reading order');
  assert.ok(!blocks.some((b) => b.type === 'bin' && /minister/.test(b.text || '')), 'nested row NOT collapsed to a bin block');
  const sotOut = blocks.find((b) => b.id === 'blk_ns');
  assert.equal(sotOut.type, 'sot', 'nested SOT keeps its type');
  assert.equal(sotOut.timecode.tc, '01:02:03:04', 'nested SOT timecode survives');
  assert.equal(sotOut.timecode.tcOut, '01:02:59:00', 'nested SOT out-code survives');
  assert.equal(sotOut.speaker, 'U AUNG', 'nested SOT speaker survives');
  assert.equal(sotOut.done, true, 'nested SOT done flag survives');
  assert.deepEqual([sotOut.lane, sotOut.pairId], ['said', 'pair_nested'], 'nested pairing (lane + pairId) survives');
});


// ── 8: ROW-DRAG SAFETY (editor-ergonomics 2026-07-21, "two broken things") ─────────────────
// The unpair vector is closed at the SPEC: tableRow is not draggable, so ProseMirror can never
// arm a native node drag from a mousedown inside a row (padding, cell gaps, chrome) — the drag
// that used to pull a row out of the two-column structure and nest it inside another row's cell.
ok('tableRow spec is draggable:false — PM native row drags are structurally dead', () => {
  assert.equal(schema.nodes.tableRow.spec.draggable, false);
});

// Only the grips and a media figure may start a native drag; anything else inside a row is an
// accident the capture guard preventDefault's. The predicate is the guard's single truth.
// A `closest(sel)` mock that reports which of the target's ancestor-classes are present.
const targetWithin = (...classes) => ({
  closest: (sel) => (sel.split(',').some((s) => classes.includes(s.trim())) ? {} : null),
});
ok('dragSourceSanctioned: grips + image figure yes, cell/text targets no', () => {
  assert.equal(dragSourceSanctioned(targetWithin('.wp-row-drag')), true);
  assert.equal(dragSourceSanctioned(targetWithin('[data-drag-handle]')), true);
  assert.equal(dragSourceSanctioned(targetWithin('.wp-grip')), true);
  // The imageBlock nodeview: an atom node drag (moves the image alone), now sanctioned.
  assert.equal(dragSourceSanctioned(targetWithin('.wp-image')), true);
  // Bare cell interior / selected text — still an accident, still blocked (row stays paired).
  assert.equal(dragSourceSanctioned(targetWithin('.wp-cell')), false);
  assert.equal(dragSourceSanctioned(targetWithin()), false);
  assert.equal(dragSourceSanctioned(null), false);
  assert.equal(dragSourceSanctioned({}), false);            // no .closest at all
});

// The grip → moveRow path preserves the row byte-exact: a SPLIT (paired) row reorders with its
// cols/pairId/cells untouched — the two-column structure survives by construction.
ok('reordering a split row preserves the row node byte-exact (cols + pairId + both cells)', () => {
  const docJson = { type: 'doc', content: [
    row([none('r1', 'first')]),
    pairedRow('pair_keep', [vo('s1', 'said words')], [none('sh1', 'shown words')]),
    row([none('r3', 'third')]),
  ] };
  const state = makeState(docJson);
  const movedBefore = clone(state.doc.child(1).toJSON());
  let out = state;
  const did = moveRow(state, (tr) => { out = state.apply(tr); }, rowPos(state.doc, 1), rowPos(state.doc, 0), true);
  assert.equal(did, true);
  const movedAfter = clone(out.doc.child(0).toJSON());
  assert.deepEqual(movedAfter, movedBefore, 'split row byte-identical after reorder');
  assert.equal(out.doc.child(0).attrs.cols, 2);
  assert.equal(out.doc.child(0).attrs.pairId, 'pair_keep');
});

// Illegal drop targets are refused outright: a position that is not a tableRow (a cell interior,
// a block, a text position) can never become a drop target — moveRow validates the node type.
ok('moveRow refuses non-row drop targets (cell interior, block, text pos)', () => {
  const docJson = { type: 'doc', content: [row([none('a1', 'alpha')]), row([none('b1', 'beta')])] };
  const state = makeState(docJson);
  const from = rowPos(state.doc, 0);
  let dispatched = false;
  // walk INTO row 2: +1 = cell pos, +2 = block pos, +3 = paragraph pos — none is a tableRow
  for (const offset of [1, 2, 3]) {
    const did = moveRow(state, () => { dispatched = true; }, from, rowPos(state.doc, 1) + offset, true);
    assert.equal(did, false, `offset ${offset} must be refused`);
  }
  assert.equal(dispatched, false, 'refused drops dispatch NOTHING');
});

console.log(`row-drag.test.mjs: ${pass} assertions passed`);
