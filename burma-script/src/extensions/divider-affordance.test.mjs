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
import { doMergeRow, doSplitRow, rowIsSplitNode, dividerChipLeft, BURMA_TABLE_NODES } from './table.js';
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

// ── 4. EMPTY-SHOWN-PARA DROP — the branch every split→merge actually hits ─────────────────────
// doSplitRow ALWAYS opens the shown lane as a lone empty paragraph, so the overwhelmingly
// common merge is "fold a just-split row back". doMergeRow drops that empty placeholder so the
// merged full-width cell holds ONLY the said blocks — no trailing empty paragraph junk that
// would otherwise accumulate one blank line per split→merge cycle. The words()-based asserts
// above CANNOT see this (an empty para contributes zero words), so pin it on BLOCK COUNT.
const cellBlockTypes = (state) => {
  const cell = state.doc.child(0).child(0);
  return [...Array(cell.childCount)].map((_, i) => cell.child(i).type.name);
};
ok('merge drops a lone empty shown paragraph — merged full cell keeps only the said block', () => {
  // Real round-trip: full → split (shown becomes an empty para) → merge back.
  const state = makeState({ type: 'doc', content: [fullRow([none('f', 'all the words stay')])] });
  let s1 = state; doSplitRow(state, (tr) => { s1 = state.apply(tr); }, 0);
  let s2 = s1; doMergeRow(s1, (tr) => { s2 = s1.apply(tr); }, 0);
  assert.deepEqual(cellBlockTypes(s2), ['noneBlock'], 'exactly the said block — empty shown para dropped');
  assert.equal(words(s2.doc), 'all the words stay', 'no words lost by the drop');

  // Hand-built split row whose shown lane is a bare empty paragraph → same drop.
  const built = makeState({ type: 'doc', content: [splitRow([none('s', 'said words')], [{ type: 'paragraph' }])] });
  let m = built; doMergeRow(built, (tr) => { m = built.apply(tr); }, 0);
  assert.deepEqual(cellBlockTypes(m), ['noneBlock'], 'lone empty shown para dropped in a direct merge');
});
ok('merge KEEPS a shown lane that carries content (drop is empty-only, never a word-eater)', () => {
  // Multi-block shown lane with real content — every block survives, in reading order.
  const state = makeState({ type: 'doc', content: [splitRow([none('s', 'the said')], [none('v', 'the shown'), none('w', 'more shown')])] });
  let m = state; doMergeRow(state, (tr) => { m = state.apply(tr); }, 0);
  assert.deepEqual(cellBlockTypes(m), ['noneBlock', 'noneBlock', 'noneBlock'], 'said + both shown blocks kept');
  assert.equal(words(m.doc), 'the said the shown more shown', 'reading order preserved, zero loss');
});
// MUTATION ORACLE — a keep-all merge (the branch neutered) leaves the empty para behind, so
// the split→merge round-trip yields TWO blocks. Proves the assertions above are load-bearing:
// they go RED the moment doMergeRow stops dropping the empty shown placeholder.
ok('oracle: a keep-all merge would leak the empty para (childCount 2) — drop is what makes it 1', () => {
  const state = makeState({ type: 'doc', content: [fullRow([none('f', 'words')])] });
  let s1 = state; doSplitRow(state, (tr) => { s1 = state.apply(tr); }, 0);
  const row = s1.doc.child(0);
  // Rebuild what a NO-DROP merge would produce: every block from every cell, verbatim.
  const allBlocks = [];
  row.forEach((cell) => cell.forEach((blk) => allBlocks.push(blk)));
  assert.equal(allBlocks.length, 2, 'said block + the empty shown para — the leak the drop prevents');
  assert.equal(allBlocks[1].type.name, 'paragraph', 'the second is the empty shown placeholder');
  assert.equal(allBlocks[1].content.size, 0, 'and it is genuinely empty (zero words)');
});

// ── 5. CHIP GEOMETRY — the merge chip's `left` is the divider CENTER in the row's coord space ──
// dividerChipLeft(rowLeft, cellLeft, borderLeft) is fed getBoundingClientRect().left values, so it
// is immune to the row's own left gutter/padding. The regression this pins: the old code summed
// content.offsetLeft + cell.offsetLeft, double-counting the row inset and pushing the chip one
// gutter-width RIGHT of the line (Johnny's ~40px offset).
ok('dividerChipLeft: no gutter → divider center is the cell edge + half the border', () => {
  // row border-box at viewport x=100, 2nd cell edge at x=633, 1.5px divider.
  assert.equal(dividerChipLeft(100, 633, 1.5), 533 + 0.75);
});
ok('dividerChipLeft: a 40px row gutter shifts BOTH rects equally — result is unchanged (no double-count)', () => {
  // The gutter moves the row's own left edge and the cell edge by the same 40px; the delta holds.
  const noGutter = dividerChipLeft(100, 633, 1.5);
  const gutter40 = dividerChipLeft(140, 673, 1.5);
  assert.equal(gutter40, noGutter, 'chip lands on the line regardless of the row inset');
});
ok('dividerChipLeft: missing border width defaults to 0', () => {
  assert.equal(dividerChipLeft(0, 500, undefined), 500);
  assert.equal(dividerChipLeft(0, 500, 0), 500);
});

console.log(`divider-affordance.test.mjs: ${pass} assertions passed`);
