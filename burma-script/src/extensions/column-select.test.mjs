/*
 * column-select.test.mjs — the COLUMN-SCOPED DRAG SELECTION logic (extensions/table.js).
 *
 * Johnny 2026-07-24: "If I click and drag down the LEFT column only, it should select ONLY the
 * left column. Only if I drag it over into the RIGHT column should it select BOTH columns."
 * This spine has NO CellSelection (plain linear TextSelection), so the column scope is a pure
 * gesture-driven DECORATION layer that leaves selection.from/to byte-identical. These tests lock
 * the pure brain of that layer without a DOM (the gesture wiring is verified live).
 *
 * Proves:
 *   1. cellColumnAt — resolves a doc position to its leaf cell's { role, cellIndex, colCount }.
 *   2. columnCrossed — same-lane / full-row stay scoped; the OTHER 2-col lane crosses; a
 *      full-width anchor never scopes.
 *   3. columnScopedCells — a same-column drag yields ONLY that lane's cells across the covered
 *      rows (the shown lane is never in the set); full-width rows in the run join the scope.
 *   4. columnScopeDecorations — one node decoration per scoped cell; empty when role/selection off.
 *   5. ROW-RANGE SURVIVES — collectIntersectingRows over a single-column selection still returns
 *      the WHOLE contiguous rows (delete/transfer/copy stay whole-row by construction).
 *   6. TAG SCOPE — a said-lane bulk tag over a both-column selection span marks ONLY said(+full)
 *      cells; the shown lane is byte-untouched (the "tag the dragged column only" contract).
 *
 * Run: bun src/extensions/column-select.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { BURMA_NODES } from './blocks.js';
import {
  BURMA_TABLE_NODES, cellColumnAt, columnCrossed, columnScopedCells,
  columnScopeDecorations, columnScopeForDrag, columnSelectEnabled, collectIntersectingRows,
} from './table.js';
import { __setReadOnlyForTest } from '../read-mode.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { bulkApplyMarkRange } from './convert-menu.js';
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
  TextAlign.extend({ addKeyboardShortcuts: () => ({}) })
    .configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const para = (text) => ({ type: 'paragraph', attrs: { textAlign: 'left' }, content: text ? [{ type: 'text', text }] : [] });
const cell = (role, blockId, text) => ({
  type: 'tableCell', attrs: { role },
  content: [{ type: 'noneBlock', attrs: { blockId }, content: [para(text)] }],
});
const fullRow = (id, text) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null }, content: [cell('full', id, text)] });
const splitRow = (n, left, right) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'p' + n, bookmarkId: null },
  content: [cell('said', 'L' + n, left), cell('shown', 'R' + n, right)],
});

// First inner text position of each LEAF cell, keyed by role+order, so tests can build selections
// and probe cellColumnAt without hand-counting PM offsets.
function leafCells(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'tableCell') return true;
    let nested = false;
    node.forEach((c) => { if (c.type.name === 'tableRow') nested = true; });
    if (nested) return true;
    // pos = before the cell; +1 cell open, +1 noneBlock open, +1 paragraph open = first text pos.
    out.push({ role: node.attrs.role, pos, inner: pos + 3, from: pos, to: pos + node.nodeSize });
    return false;
  });
  return out;
}

// ── 1. cellColumnAt resolves the leaf cell's column identity ─────────────────────────────────
ok('cellColumnAt reports role / cellIndex / colCount for said, shown, and full cells', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'said one', 'shown one'), fullRow('F', 'full line')] });
  const cells = leafCells(doc);
  const said = cells.find((c) => c.role === 'said');
  const shown = cells.find((c) => c.role === 'shown');
  const full = cells.find((c) => c.role === 'full');

  const a = cellColumnAt(doc, said.inner);
  assert.deepEqual({ role: a.role, cellIndex: a.cellIndex, colCount: a.colCount }, { role: 'said', cellIndex: 0, colCount: 2 });
  const b = cellColumnAt(doc, shown.inner);
  assert.deepEqual({ role: b.role, cellIndex: b.cellIndex, colCount: b.colCount }, { role: 'shown', cellIndex: 1, colCount: 2 });
  const c = cellColumnAt(doc, full.inner);
  assert.deepEqual({ role: c.role, cellIndex: c.cellIndex, colCount: c.colCount }, { role: 'full', cellIndex: 0, colCount: 1 });
});

// ── 2. columnCrossed — the horizontal-cross gate ─────────────────────────────────────────────
ok('columnCrossed: same lane / full row stay scoped; the other 2-col lane crosses', () => {
  const said = { role: 'said', cellIndex: 0, colCount: 2 };
  const shown = { role: 'shown', cellIndex: 1, colCount: 2 };
  const full = { role: 'full', cellIndex: 0, colCount: 1 };
  assert.equal(columnCrossed(said, said), false, 'said→said stays');
  assert.equal(columnCrossed(said, full), false, 'said→full stays (no second column to cross)');
  assert.equal(columnCrossed(said, shown), true, 'said→shown crosses to both columns');
  assert.equal(columnCrossed(shown, said), true, 'shown→said crosses');
  assert.equal(columnCrossed(full, shown), false, 'a full-width anchor never scopes');
  assert.equal(columnCrossed(said, null), false, 'no head → no cross (keep current)');
});

// ── 3. columnScopedCells — single-column drag lights ONLY that lane ───────────────────────────
ok('columnScopedCells: a said-lane drag across rows returns only said cells, never shown', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'aaa', 'bbb'), splitRow(2, 'ccc', 'ddd'), splitRow(3, 'eee', 'fff')] });
  const cells = leafCells(doc);
  const saidCells = cells.filter((c) => c.role === 'said');
  // Drag from inside row1 said down to inside row3 said (a linear span crossing every shown cell).
  const from = saidCells[0].inner;
  const to = saidCells[2].inner;
  const scoped = columnScopedCells(doc, from, to, 'said');
  // Exactly the said cells that fall in the span (rows 1..3): 3 of them, all role said.
  assert.equal(scoped.length, 3, 'three said cells in the vertical run');
  for (const s of scoped) {
    const node = doc.nodeAt(s.from);
    assert.equal(node.type.name, 'tableCell');
    assert.equal(node.attrs.role, 'said', 'no shown cell leaked into the scope');
  }
  // A collapsed selection paints nothing.
  assert.equal(columnScopedCells(doc, from, from, 'said').length, 0);
});

ok('columnScopedCells: a full-width row inside the run joins the scoped lane', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'aaa', 'bbb'), fullRow('F', 'mid full'), splitRow(2, 'ccc', 'ddd')] });
  const cells = leafCells(doc);
  const saidCells = cells.filter((c) => c.role === 'said');
  const from = saidCells[0].inner;
  const to = saidCells[1].inner;
  const scoped = columnScopedCells(doc, from, to, 'said');
  const roles = scoped.map((s) => doc.nodeAt(s.from).attrs.role).sort();
  assert.deepEqual(roles, ['full', 'said', 'said'], 'said cells + the full-width cell, never shown');
});

// ── 4. columnScopeDecorations — one node deco per scoped cell ─────────────────────────────────
ok('columnScopeDecorations: one decoration per scoped cell, empty when off', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'aaa', 'bbb'), splitRow(2, 'ccc', 'ddd')] });
  const cells = leafCells(doc);
  const saidCells = cells.filter((c) => c.role === 'said');
  const sel = TextSelection.create(doc, saidCells[0].inner, saidCells[1].inner);
  const decoSet = columnScopeDecorations(doc, sel, 'said');
  assert.equal(decoSet.find().length, 2, 'two cell decorations');
  // role null → no scope → empty set.
  assert.equal(columnScopeDecorations(doc, sel, null).find().length, 0);
  // collapsed selection → empty set.
  const caret = TextSelection.create(doc, saidCells[0].inner);
  assert.equal(columnScopeDecorations(doc, caret, 'said').find().length, 0);
});

// ── 5. ROW-RANGE SURVIVES — a single-column selection still brackets whole rows ───────────────
ok('collectIntersectingRows over a said-only selection returns the WHOLE contiguous rows', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'aaa', 'bbb'), splitRow(2, 'ccc', 'ddd'), splitRow(3, 'eee', 'fff')] });
  const cells = leafCells(doc);
  const saidCells = cells.filter((c) => c.role === 'said');
  // The single-column drag's endpoints both sit in said cells of rows 1 and 3.
  const rows = collectIntersectingRows(doc, saidCells[0].inner, saidCells[2].inner);
  assert.equal(rows.length, 3, 'all three rows are in range even though only the left column drew');
  for (const r of rows) assert.equal(r.node.type.name, 'tableRow');
});

// ── 6. TAG SCOPE — a said-lane tag over a both-column span marks only said/full cells ─────────
ok('bulkApplyMarkRange(said) tags only the said lane; the shown lane is byte-untouched', () => {
  const doc = docFrom({ type: 'doc', content: [splitRow(1, 'aaa', 'bbb'), splitRow(2, 'ccc', 'ddd')] });
  const state = EditorState.create({ schema, doc });
  const shownBefore = clone(state.doc.child(0).child(1).toJSON());
  // The LINEAR span covers both columns of both rows — but the dragged lane is 'said'.
  const from = 1;
  const to = state.doc.content.size - 1;
  let out = state;
  const did = bulkApplyMarkRange(state, (tr) => { out = state.apply(tr); }, from, to, 'oncam', 'said');
  assert.equal(did, true);
  // Every said cell wears the mark; no shown cell does.
  const markInCell = (cellNode) => {
    let has = false;
    cellNode.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'directionMark')) has = true; return true; });
    return has;
  };
  assert.equal(markInCell(out.doc.child(0).child(0)), true, 'row1 said tagged');
  assert.equal(markInCell(out.doc.child(1).child(0)), true, 'row2 said tagged');
  assert.deepEqual(clone(out.doc.child(0).child(1).toJSON()), shownBefore, 'row1 shown untouched');
  assert.equal(markInCell(out.doc.child(1).child(1)), false, 'row2 shown untouched');
});

// ── 7. columnScopeForDrag — the live-drag engage gate (regression: intra-cell text select) ─────
// The bug: onMouseMove engaged the column scope whenever the head merely stayed in the anchor's
// LANE — it never checked whether the drag had LEFT the anchor cell. So a plain click-drag to
// select a phrase WITHIN one said cell washed the whole cell orange and zeroed the native
// highlight. The gate must return null (native) until the head enters a DIFFERENT same-lane cell.
ok('columnScopeForDrag: a drag still INSIDE the anchor cell stays native (null), not column-scoped', () => {
  const anchor = { role: 'said', cellIndex: 0, colCount: 2, rowPos: 10 };
  // Head is the very same cell (same rowPos + cellIndex) — ordinary intra-cell text selection.
  assert.equal(columnScopeForDrag(anchor, { ...anchor }), null, 'same cell → no scope, native word-level selection survives');
  // Head is null at gesture start too (posAtCoords miss) — but a null head means "keep dragging
  // vertically off the surface", which SHOULD hold the lane once a real drag is underway; that path
  // is only reached after leaving the cell, so the same-cell guard above is what protects the phrase
  // select. A null head therefore keeps the lane:
  assert.equal(columnScopeForDrag(anchor, null), 'said', 'head off-DOM (drag ran past last row) keeps the lane');
});

ok('columnScopeForDrag: head in a DIFFERENT same-lane cell engages the column scope', () => {
  const anchor = { role: 'said', cellIndex: 0, colCount: 2, rowPos: 10 };
  const sameLaneNextRow = { role: 'said', cellIndex: 0, colCount: 2, rowPos: 40 };
  assert.equal(columnScopeForDrag(anchor, sameLaneNextRow), 'said', 'a real multi-row column drag scopes to the lane');
  const fullRowBelow = { role: 'full', cellIndex: 0, colCount: 1, rowPos: 70 };
  assert.equal(columnScopeForDrag(anchor, fullRowBelow), 'said', 'a full-width row in the run joins the lane');
});

ok('columnScopeForDrag: crossing into the other lane, or a non-scoping anchor, returns null', () => {
  const anchor = { role: 'said', cellIndex: 0, colCount: 2, rowPos: 10 };
  const otherLane = { role: 'shown', cellIndex: 1, colCount: 2, rowPos: 40 };
  assert.equal(columnScopeForDrag(anchor, otherLane), null, 'crossed into the shown lane → both columns, native');
  const fullAnchor = { role: 'full', cellIndex: 0, colCount: 1, rowPos: 10 };
  assert.equal(columnScopeForDrag(fullAnchor, { role: 'full', cellIndex: 0, colCount: 1, rowPos: 40 }), null, 'a full-width anchor never scopes');
  assert.equal(columnScopeForDrag(null, otherLane), null, 'no anchor → null');
});

// ── 8. columnSelectEnabled — the ?read / guest-share gate (regression: see-one / copy-both) ────
// The bug: columnSelectPlugin mounted unconditionally, so on a ?read share the gesture engaged and
// painted a single-column highlight while the native TextSelection still spanned both columns —
// Cmd+C copied BOTH columns' text while only one appeared selected. Read pages must keep native
// both-column selection (visible == clipboard).
ok('columnSelectEnabled: false on a read-only share, true in a normal edit session', () => {
  try {
    __setReadOnlyForTest(true);
    assert.equal(columnSelectEnabled(), false, 'read-only share → gesture disabled (native both-column selection)');
    __setReadOnlyForTest(false);
    assert.equal(columnSelectEnabled(), true, 'editable session → gesture enabled');
  } finally {
    __setReadOnlyForTest(false); // never leak read-only into a later test
  }
});

console.log(`column-select.test.mjs: ${pass} assertions passed`);
