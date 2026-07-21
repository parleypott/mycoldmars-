/*
 * bulk-row-menu.test.mjs — the SELECT → RIGHT-CLICK bulk menu (extensions/convert-menu.js) and the
 * transactions it drives: bulk-tag across a multi-row selection (LANE-SCOPED to the clicked column),
 * bulk-VO retype (also lane-scoped), and bulk-delete of the outermost rows a selection touches.
 *
 * Proves (EditorState-level, no DOM — same harness style as delete-row.test.mjs):
 *   1a. BULK TAG with a SAID click lands directionMark ONLY on said-cell text across every split
 *       row; the shown-cell text is left byte-untouched (no mark); one undo reverts byte-exact.
 *   1b. Same with a SHOWN click — only shown cells marked, said cells untouched.
 *   2.  A full-width (single-lane) row in the selection ALWAYS takes the tag under either lane click.
 *   3.  A FULL-cell click (or an unresolved lane) has no column preference → whole selection tagged,
 *       both said and shown — the documented full-width-click choice / pre-scope back-compat.
 *   4.  BULK TAG across 3 full-width rows lands the mark on all three in ONE transaction (one undo).
 *   5.  DELETE-N — a selection touching 3 of 5 rows deletes EXACTLY those 3 outermost rows in one
 *       transaction; the count collectIntersectingRows reports equals the deletions; one undo
 *       restores byte-exact; neighbours keep every word.
 *   6.  A nested Palau row (tableRow > tableCell > tableRow) counts + deletes as its OUTERMOST row,
 *       AND a said-click scopes the tag to the INNER said cell only (recursion-safe lane scoping).
 *   7.  VO BULK with a SAID click retypes said-lane + full-width convertible blocks only (shown-lane
 *       and non-convertible sotBlock left untouched) in one transaction.
 *   8.  READ-ONLY → the menu plugin never mounts (returns no plugins), so no bulk action can fire.
 *
 * NOTE (pendingViz): the pending-visual-plan clear-on-tag lives on the workspaces branch, NOT on
 * this base (origin/main has no pendingViz). When lane scoping lands on workspaces, that clear must
 * be scoped to the SAME laneCellRanges the tag used — see the return notes. No test for it here.
 *
 * Run: bun src/extensions/bulk-row-menu.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { collectIntersectingRows, doDeleteRows } from './table.js';
import { bulkRetypeToVo } from './slash-menu.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark, defaultDirectionMarkAttrs } from './direction-chip.js';
import { ConvertMenu, bulkApplyMarkRange } from './convert-menu.js';
import { __setReadOnlyForTest } from '../read-mode.js';
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

// A single-cell (role:full) row wrapping one block of one paragraph of `text`.
const row = (text, blockType = 'noneBlock') => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{
      type: blockType, attrs: { blockId: 'blk_' + text.slice(0, 4).replace(/\s/g, '') },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }],
  }],
});

// A two-cell split row: said(left) + shown(right), each a noneBlock of its text.
const splitRow = (left, right) => splitTypedRow(left, 'noneBlock', right, 'noneBlock');

// A two-cell split row with explicit block types per lane (for VO scoping tests).
const splitTypedRow = (left, leftType, right, rightType) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: null },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: leftType, attrs: { blockId: 'blk_L_' + left.slice(0, 3).replace(/\s/g, '') }, content: [{ type: 'paragraph', content: [{ type: 'text', text: left }] }] }] },
    { type: 'tableCell', attrs: { role: 'shown' }, content: [{ type: rightType, attrs: { blockId: 'blk_R_' + right.slice(0, 3).replace(/\s/g, '') }, content: [{ type: 'paragraph', content: [{ type: 'text', text: right }] }] }] },
  ],
});

// A full-width wrapper row whose single cell NESTS two said|shown rows (Palau's saved shape).
const nestedRow = (left, right) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: 'pairu_wrap' },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{
      type: 'tableRow', attrs: { cols: 2, pairId: 'pairu_inner' },
      content: [
        { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_nL' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: left }] }] }] },
        { type: 'tableCell', attrs: { role: 'shown' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_nR' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: right }] }] }] },
      ],
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

// Position just before the Nth top-level row.
function rowPos(doc, n) {
  let pos = 0;
  for (let i = 0; i < n; i++) pos += doc.child(i).nodeSize;
  return pos;
}
// A position comfortably INSIDE the Nth top-level row's first text run.
function insideRow(doc, n) { return rowPos(doc, n) + 4; }

// The whole doc's text span [firstTextPos, lastTextPos] — used to select across every row.
function fullTextSpan(doc) {
  const spans = [];
  doc.descendants((node, pos) => { if (node.isText) spans.push([pos, pos + node.nodeSize]); });
  return { from: spans[0][0], to: spans[spans.length - 1][1] };
}

const markType = schema.marks.directionMark;

// Does the text node carrying `needle` carry a directionMark of `kind`?
function textHasMark(doc, needle, kind) {
  let has = false;
  doc.descendants((node) => {
    if (node.isText && node.text.includes(needle)
      && node.marks.some((m) => m.type === markType && m.attrs.kind === kind)) has = true;
  });
  return has;
}

// The marks array of the text node carrying `needle` (byte-untouched proof for the OTHER lane).
function marksOf(doc, needle) {
  let marks = null;
  doc.descendants((node) => {
    if (marks === null && node.isText && node.text.includes(needle)) marks = node.marks;
  });
  return marks || [];
}

// ── 1a: SAID click tags said cells only; shown cells byte-untouched; one undo reverts ──────────
ok('SAID click lays directionMark only on said cells; shown text untouched; one undo reverts', () => {
  const docJson = { type: 'doc', content: [
    splitRow('said one', 'shown one'),
    splitRow('said two', 'shown two'),
    splitRow('said three', 'shown three'),
  ] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  assert.equal(bulkApplyMarkRange(state, dispatch, from, to, '3d', 'said'), true);
  assert.ok(textHasMark(state.doc, 'said one', '3d'), 'said row 1 tagged');
  assert.ok(textHasMark(state.doc, 'said two', '3d'), 'said row 2 tagged');
  assert.ok(textHasMark(state.doc, 'said three', '3d'), 'said row 3 tagged');
  assert.ok(!textHasMark(state.doc, 'shown one', '3d'), 'shown row 1 NOT tagged');
  assert.ok(!textHasMark(state.doc, 'shown two', '3d'), 'shown row 2 NOT tagged');
  assert.ok(!textHasMark(state.doc, 'shown three', '3d'), 'shown row 3 NOT tagged');
  assert.deepEqual(marksOf(state.doc, 'shown one'), [], 'shown text carries NO marks — byte-untouched');

  docFrom(state.doc.toJSON()).check();
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo reverts the said-lane marks byte-exact');
});

// ── 1b: SHOWN click tags shown cells only; said cells byte-untouched ──────────────────────────
ok('SHOWN click lays directionMark only on shown cells; said text untouched', () => {
  const docJson = { type: 'doc', content: [
    splitRow('said one', 'shown one'),
    splitRow('said two', 'shown two'),
  ] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  assert.equal(bulkApplyMarkRange(state, dispatch, from, to, 'sot', 'shown'), true);
  assert.ok(textHasMark(state.doc, 'shown one', 'sot'), 'shown row 1 tagged');
  assert.ok(textHasMark(state.doc, 'shown two', 'sot'), 'shown row 2 tagged');
  assert.ok(!textHasMark(state.doc, 'said one', 'sot'), 'said row 1 NOT tagged');
  assert.deepEqual(marksOf(state.doc, 'said two'), [], 'said text carries NO marks — byte-untouched');
  docFrom(state.doc.toJSON()).check();
});

// ── 2: a full-width (single-lane) row always takes the tag under either lane click ────────────
ok('a full-width row in the selection is tagged under BOTH a said click and a shown click', () => {
  const docJson = { type: 'doc', content: [
    splitRow('said x', 'shown x'),
    row('full width line'),
  ] };
  // SAID click
  let state = makeState(docJson);
  let dispatch = (tr) => { state = state.apply(tr); };
  let span = fullTextSpan(state.doc);
  bulkApplyMarkRange(state, dispatch, span.from, span.to, 'oncam', 'said');
  assert.ok(textHasMark(state.doc, 'full width line', 'oncam'), 'full-width row tagged on said click');
  assert.ok(textHasMark(state.doc, 'said x', 'oncam'), 'said cell tagged');
  assert.ok(!textHasMark(state.doc, 'shown x', 'oncam'), 'shown cell not tagged');

  // SHOWN click — the same full-width row still takes it.
  state = makeState(docJson);
  dispatch = (tr) => { state = state.apply(tr); };
  span = fullTextSpan(state.doc);
  bulkApplyMarkRange(state, dispatch, span.from, span.to, 'oncam', 'shown');
  assert.ok(textHasMark(state.doc, 'full width line', 'oncam'), 'full-width row tagged on shown click');
  assert.ok(textHasMark(state.doc, 'shown x', 'oncam'), 'shown cell tagged');
  assert.ok(!textHasMark(state.doc, 'said x', 'oncam'), 'said cell not tagged');
  docFrom(state.doc.toJSON()).check();
});

// ── 3: a FULL-cell click (or unresolved lane) tags the WHOLE selection — both lanes ───────────
ok('a full-cell click (and a null/unresolved lane) tags both said and shown — the whole selection', () => {
  const docJson = { type: 'doc', content: [splitRow('said y', 'shown y')] };

  // clickedRole === 'full' → no lane preference → whole selection.
  let state = makeState(docJson);
  let dispatch = (tr) => { state = state.apply(tr); };
  let span = fullTextSpan(state.doc);
  bulkApplyMarkRange(state, dispatch, span.from, span.to, 'archive', 'full');
  assert.ok(textHasMark(state.doc, 'said y', 'archive'), 'said cell tagged on full click');
  assert.ok(textHasMark(state.doc, 'shown y', 'archive'), 'shown cell tagged on full click');

  // clickedRole omitted (unresolved posAtCoords) → same whole-selection back-compat.
  state = makeState(docJson);
  dispatch = (tr) => { state = state.apply(tr); };
  span = fullTextSpan(state.doc);
  bulkApplyMarkRange(state, dispatch, span.from, span.to, 'archive');
  assert.ok(textHasMark(state.doc, 'said y', 'archive'), 'said cell tagged with no clickedRole');
  assert.ok(textHasMark(state.doc, 'shown y', 'archive'), 'shown cell tagged with no clickedRole');
  docFrom(state.doc.toJSON()).check();
});

// ── 4: bulk tag across 3 full-width rows, one transaction, one undo reverts ────────────────────
ok('bulk tag lands directionMark on all 3 full-width rows in one tr; one undo reverts', () => {
  const docJson = { type: 'doc', content: [row('alpha words'), row('beta words'), row('gamma words')] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  bulkApplyMarkRange(state, dispatch, from, to, '3d', 'said');
  assert.ok(textHasMark(state.doc, 'alpha', '3d'), 'row 1 tagged');
  assert.ok(textHasMark(state.doc, 'beta', '3d'), 'row 2 tagged');
  assert.ok(textHasMark(state.doc, 'gamma', '3d'), 'row 3 tagged');

  docFrom(state.doc.toJSON()).check();
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo reverts every mark byte-exact');
});

// ── 5: delete 3 of 5 rows; count matches; one undo restores byte-exact ─────────────────────
ok('delete-N removes exactly the touched outermost rows; count matches; one undo restores', () => {
  const docJson = { type: 'doc', content: [row('r0'), row('r1'), row('r2'), row('r3'), row('r4')] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  // Selection from inside row 1 to inside row 3 → touches rows 1,2,3 (not 0 or 4).
  const from = insideRow(state.doc, 1);
  const to = insideRow(state.doc, 3);
  const rows = collectIntersectingRows(state.doc, from, to);
  assert.equal(rows.length, 3, 'exactly 3 outermost rows intersect the selection');

  const label = `DELETE ${rows.length} ROW${rows.length === 1 ? '' : 'S'}`;
  assert.equal(label, 'DELETE 3 ROWS', 'the menu label reflects the true count');

  assert.equal(doDeleteRows(state, dispatch, rows.map((r) => r.pos)), true);
  assert.equal(state.doc.childCount, 2, 'only rows 0 and 4 remain');
  assert.equal(state.doc.child(0).textContent, 'r0', 'row above the range intact');
  assert.equal(state.doc.child(1).textContent, 'r4', 'row below the range intact');
  assert.ok(!state.doc.textContent.includes('r1'), 'r1 gone');
  assert.ok(!state.doc.textContent.includes('r2'), 'r2 gone');
  assert.ok(!state.doc.textContent.includes('r3'), 'r3 gone');

  docFrom(state.doc.toJSON()).check();
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo brings all 3 rows back byte-exact');
});

// ── 5b: delete-ALL guard — never an empty doc ──────────────────────────────────────────────
ok('deleting every touched row when the selection spans the whole doc leaves one fresh empty row', () => {
  const docJson = { type: 'doc', content: [row('only a'), row('only b')] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);
  const rows = collectIntersectingRows(state.doc, from, to);
  assert.equal(rows.length, 2, 'both rows intersect');

  assert.equal(doDeleteRows(state, dispatch, rows.map((r) => r.pos)), true);
  assert.equal(state.doc.childCount, 1, 'exactly one row remains');
  const fresh = state.doc.child(0);
  assert.equal(fresh.type.name, 'tableRow');
  assert.equal(fresh.textContent, '', 'the surviving row is a fresh empty line');
  assert.ok(String(fresh.attrs.pairId || '').startsWith('pairu_'), 'fresh row carries the keep-me marker');
  docFrom(state.doc.toJSON()).check();
});

// ── 6: nested Palau row — deletes as its wrapper AND scopes the tag to its inner said cell ─────
ok('a nested Palau row deletes as its OUTERMOST wrapper, and a said click scopes to its inner said cell', () => {
  const docJson = { type: 'doc', content: [row('top'), nestedRow('inner left', 'inner right')] };

  // LANE SCOPING through the wrapper cell: said click marks 'inner left' only, not 'inner right'.
  let state = makeState(docJson);
  let dispatch = (tr) => { state = state.apply(tr); };
  const { from: sFrom, to: sTo } = fullTextSpan(state.doc);
  bulkApplyMarkRange(state, dispatch, sFrom, sTo, 'sot', 'said');
  assert.ok(textHasMark(state.doc, 'inner left', 'sot'), 'inner said cell tagged through the wrapper');
  assert.ok(!textHasMark(state.doc, 'inner right', 'sot'), 'inner shown cell NOT tagged — wrapper is transparent, leaf role wins');
  assert.ok(textHasMark(state.doc, 'top', 'sot'), 'the sibling full-width row still takes the tag');
  docFrom(state.doc.toJSON()).check();

  // Count + delete still resolves to the outermost wrapper row.
  state = makeState(docJson);
  dispatch = (tr) => { state = state.apply(tr); };
  const wrapperPos = rowPos(state.doc, 1);
  const from = wrapperPos + 6; // well inside the nested structure
  const rows = collectIntersectingRows(state.doc, from, from);
  assert.equal(rows.length, 1, 'the nested selection counts as ONE outermost row');
  assert.equal(rows[0].pos, wrapperPos, 'and that row is the top-level wrapper, not the inner row');

  assert.equal(doDeleteRows(state, dispatch, [rows[0].pos]), true);
  assert.equal(state.doc.childCount, 1, 'the whole wrapper row is gone');
  assert.equal(state.doc.child(0).textContent, 'top', 'the other top-level row is untouched');
  assert.ok(!state.doc.textContent.includes('inner'), 'the nested content went with its wrapper');
  docFrom(state.doc.toJSON()).check();
});

// ── 7: VO bulk with a SAID click retypes said-lane + full convertible blocks only ─────────────
ok('VO bulk (said click) retypes said-lane + full convertible blocks only; shown lane + sot untouched', () => {
  const docJson = {
    type: 'doc',
    content: [
      splitTypedRow('say a', 'noneBlock', 'show a', 'noneBlock'),
      row('full a', 'montageBlock'),
      splitTypedRow('say b', 'sotBlock', 'show b', 'noneBlock'),
    ],
  };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  assert.equal(bulkRetypeToVo(state, dispatch, from, to, 'said'), true, 'at least one block converted');
  // Row 0: said noneBlock → voBlock, shown noneBlock stays.
  assert.equal(state.doc.child(0).child(0).child(0).type.name, 'voBlock', 'said noneBlock → voBlock');
  assert.equal(state.doc.child(0).child(1).child(0).type.name, 'noneBlock', 'shown noneBlock left as-is (wrong lane)');
  // Row 1: full-width montageBlock → voBlock (full always in scope).
  assert.equal(state.doc.child(1).child(0).child(0).type.name, 'voBlock', 'full-width montageBlock → voBlock');
  // Row 2: said sotBlock is not convertible; shown noneBlock is the wrong lane.
  assert.equal(state.doc.child(2).child(0).child(0).type.name, 'sotBlock', 'said sotBlock is not convertible — untouched');
  assert.equal(state.doc.child(2).child(1).child(0).type.name, 'noneBlock', 'shown noneBlock left as-is (wrong lane)');
  assert.equal(state.doc.child(0).child(0).child(0).textContent, 'say a', 'text survives the retype');
  docFrom(state.doc.toJSON()).check();
});

// ── 7b: VO bulk unscoped (no click role) still converts every lane's convertible blocks ────────
ok('VO bulk with no clickedRole converts convertible blocks in every lane (back-compat)', () => {
  const docJson = {
    type: 'doc',
    content: [splitTypedRow('say a', 'noneBlock', 'show a', 'montageBlock')],
  };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  assert.equal(bulkRetypeToVo(state, dispatch, from, to), true, 'converted');
  assert.equal(state.doc.child(0).child(0).child(0).type.name, 'voBlock', 'said noneBlock → voBlock');
  assert.equal(state.doc.child(0).child(1).child(0).type.name, 'voBlock', 'shown montageBlock → voBlock');
  docFrom(state.doc.toJSON()).check();
});

// ── 8: read-only → the bulk menu plugin never mounts ───────────────────────────────────────
ok('read-only session mounts NO convert-menu plugin, so no bulk action can fire', () => {
  __setReadOnlyForTest(true);
  try {
    const plugins = ConvertMenu.config.addProseMirrorPlugins.call({ editor: null });
    assert.deepEqual(plugins, [], 'read-only → zero plugins');
  } finally {
    __setReadOnlyForTest(false);
  }
  const live = ConvertMenu.config.addProseMirrorPlugins.call({ editor: null });
  assert.equal(live.length, 1, 'edit mode → the contextmenu plugin mounts');
});

console.log(`bulk-row-menu.test.mjs: ${pass} assertions passed`);
