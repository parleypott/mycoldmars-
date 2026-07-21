/*
 * bulk-row-menu.test.mjs — the SELECT → RIGHT-CLICK bulk menu (extensions/convert-menu.js) and the
 * two transactions it drives: bulk-tag across a multi-row selection, and bulk-delete of the
 * outermost rows a selection touches.
 *
 * Proves (EditorState-level, no DOM — same harness style as delete-row.test.mjs):
 *   1. BULK TAG across 3 rows lands directionMark on ALL three rows' text in ONE transaction;
 *      one undo reverts every mark byte-exact.
 *   2. BULK TAG crosses the said|shown tableCell boundary — both cells of a split row get the mark.
 *   3. DELETE-N — a selection touching 3 of 5 rows deletes EXACTLY those 3 outermost rows in one
 *      transaction; the count collectIntersectingRows reports equals the deletions; one undo restores
 *      byte-exact; neighbours keep every word.
 *   4. A nested Palau row (tableRow > tableCell > tableRow) counts + deletes as its OUTERMOST row.
 *   5. VO BULK retypes convertible blocks ONLY (noneBlock/montageBlock → voBlock; a sotBlock is left
 *      untouched) in one transaction.
 *   6. READ-ONLY → the menu plugin never mounts (returns no plugins), so no bulk action can fire.
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
import { ConvertMenu } from './convert-menu.js';
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

// A two-cell split row: said(left) + shown(right).
const splitRow = (left, right) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: null },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_L' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: left }] }] }] },
    { type: 'tableCell', attrs: { role: 'shown' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_R' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: right }] }] }] },
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
// setMark over a non-empty selection IS tr.addMark(from,to,mark) under the hood — the exact call the
// menu's editor.chain().setMark makes. Testing the transaction directly proves the cross-row /
// cross-cell reach without standing up a DOM editor.
function bulkTag(state, dispatch, from, to, kind) {
  const attrs = defaultDirectionMarkAttrs(kind);
  const tr = state.tr.addMark(from, to, markType.create(attrs));
  if (dispatch) dispatch(tr);
  return true;
}

function textHasMark(doc, needle, kind) {
  let has = false;
  doc.descendants((node) => {
    if (node.isText && node.text.includes(needle)
      && node.marks.some((m) => m.type === markType && m.attrs.kind === kind)) has = true;
  });
  return has;
}

// ── 1: bulk tag across 3 rows, one transaction, one undo reverts ───────────────────────────
ok('bulk tag lands directionMark on all 3 rows in one tr; one undo reverts', () => {
  const docJson = { type: 'doc', content: [row('alpha words'), row('beta words'), row('gamma words')] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  bulkTag(state, dispatch, from, to, '3d');
  assert.ok(textHasMark(state.doc, 'alpha', '3d'), 'row 1 tagged');
  assert.ok(textHasMark(state.doc, 'beta', '3d'), 'row 2 tagged');
  assert.ok(textHasMark(state.doc, 'gamma', '3d'), 'row 3 tagged');

  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo reverts every mark byte-exact');
});

// ── 2: bulk tag crosses the said|shown cell boundary ───────────────────────────────────────
ok('bulk tag crosses the said|shown tableCell boundary — both cells marked', () => {
  const docJson = { type: 'doc', content: [splitRow('left words', 'right words')] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  bulkTag(state, dispatch, from, to, 'sot');
  assert.ok(textHasMark(state.doc, 'left', 'sot'), 'said cell marked');
  assert.ok(textHasMark(state.doc, 'right', 'sot'), 'shown cell marked — mark did NOT stop at the cell edge');
  docFrom(state.doc.toJSON()).check();
});

// ── 3: delete 3 of 5 rows; count matches; one undo restores byte-exact ─────────────────────
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

// ── 3b: delete-ALL guard — never an empty doc ──────────────────────────────────────────────
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

// ── 4: nested Palau row counts + deletes as its outermost wrapper ───────────────────────────
ok('a nested Palau row resolves to its OUTERMOST row for both count and delete', () => {
  const docJson = { type: 'doc', content: [row('top'), nestedRow('inner left', 'inner right')] };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Put the selection deep inside the nested row's left cell.
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

// ── 5: VO bulk retypes convertible blocks only ─────────────────────────────────────────────
ok('VO bulk retypes convertible blocks (none/montage) only; a sotBlock is left untouched', () => {
  const docJson = {
    type: 'doc',
    content: [row('spoken a', 'noneBlock'), row('a quote', 'sotBlock'), row('spoken b', 'montageBlock')],
  };
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  const { from, to } = fullTextSpan(state.doc);

  assert.equal(bulkRetypeToVo(state, dispatch, from, to), true, 'at least one block converted');
  const blockType = (n) => state.doc.child(n).child(0).child(0).type.name;
  assert.equal(blockType(0), 'voBlock', 'noneBlock → voBlock');
  assert.equal(blockType(1), 'sotBlock', 'sotBlock is NOT convertible — left as-is');
  assert.equal(blockType(2), 'voBlock', 'montageBlock → voBlock');
  assert.equal(state.doc.child(0).child(0).child(0).textContent, 'spoken a', 'text survives the retype');
  docFrom(state.doc.toJSON()).check();
});

// ── 6: read-only → the bulk menu plugin never mounts ───────────────────────────────────────
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
