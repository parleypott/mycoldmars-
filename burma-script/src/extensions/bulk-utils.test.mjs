/*
 * bulk-utils.test.mjs — the bulk menu's UTILITY ROW transactions (extensions/convert-menu.js):
 * the folded-in BubbleMenu survivors. TK/FC span toggling must keep the bubble's exact set/unset
 * semantics (setMark with default attrs preserving sibling marks / unsetMark strip), now applied
 * through the SAME laneCellRanges scoping as the role tags; alignment must be an exact port of
 * TextAlign's setTextAlign write (the `textAlign` paragraph attr).
 *
 * Proves:
 *   1. TK SET — a partially-marked (or unmarked) selection gains tkSpan across every character of
 *      the lane-scoped range, sibling marks (bold) preserved; one undo restores byte-exact.
 *   2. TK UNSET PARITY — when the whole lane-scoped range already wears tkSpan, the same click
 *      STRIPS it (the bubble's isActive → clearSpan path); one undo restores.
 *   3. FC DEFAULT ATTRS — a set factCheckSpan run carries status:'pending' (markType.create()
 *      default), byte-identical to what the bubble's setMark stored.
 *   4. LANE SCOPING — a said-lane click marks only said(+full) cells across split rows; the shown
 *      lane is left byte-untouched (role-tag parity, bulk-row-menu case 1a's law).
 *   5. ALIGN PORT — bulkSetTextAlignRange('center') stamps textAlign:'center' on every paragraph
 *      in the range (across cells and blocks), nothing outside it; undo restores; re-applying the
 *      SAME alignment is a calm no-op (returns false, dispatches nothing — no autosave churn).
 *   6. ACTIVE PAINT — rangesFullyMarked and rangeAlignActive report full coverage only (partial
 *      coverage = inactive), the bubble's isActive coverage rule.
 *   7. READ-ONLY — the ConvertMenu plugin never mounts read-only (no bulk surface at all) — this
 *      is locked by bulk-row-menu.test.mjs case 8; here we lock that the pure ops never dispatch
 *      on an empty/collapsed range.
 *
 * Run: bun src/extensions/bulk-utils.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import {
  bulkToggleSpanRange, bulkSetTextAlignRange, rangesFullyMarked, rangeAlignActive,
} from './convert-menu.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// The live editor's schema INCLUDING TextAlign's paragraph attr (Editor.jsx lockstep).
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
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

const para = (content) => ({ type: 'paragraph', attrs: { textAlign: 'left' }, content });
const row = (text, marks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{
      type: 'noneBlock', attrs: { blockId: 'blk_' + text.slice(0, 4).replace(/\s/g, '') },
      content: [para([{ type: 'text', text, ...(marks ? { marks } : {}) }])],
    }],
  }],
});
const splitRow = (left, right) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: null, bookmarkId: null },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_L' + left.slice(0, 3).replace(/\s/g, '') }, content: [para([{ type: 'text', text: left }])] }] },
    { type: 'tableCell', attrs: { role: 'shown' }, content: [{ type: 'noneBlock', attrs: { blockId: 'blk_R' + right.slice(0, 3).replace(/\s/g, '') }, content: [para([{ type: 'text', text: right }])] }] },
  ],
});

function makeState(docJson) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc, plugins: [history()],
    selection: TextSelection.near(doc.resolve(0), 1),
  });
}
const apply = (state, fn) => {
  let out = state;
  const dispatch = (tr) => { out = state.apply(tr); };
  const did = fn(dispatch);
  return { did, state: out };
};

// Collect all text-with-marks in doc as [{ text, markNames }].
function textRuns(doc) {
  const runs = [];
  doc.descendants((n) => {
    if (n.isText) runs.push({ text: n.text, marks: n.marks.map((m) => m.type.name).sort() });
    return true;
  });
  return runs;
}

// ── 1. TK SET preserves sibling marks, covers the whole range ────────────────────────────────
ok('TK set covers the range and preserves sibling bold', () => {
  const state = makeState({ type: 'doc', content: [row('plain and bold words', [{ type: 'bold' }])] });
  const before = clone(state.doc.toJSON());
  const from = 4, to = state.doc.content.size - 4;
  const r = apply(state, (d) => bulkToggleSpanRange(state, d, from, to, 'tkSpan', 'full'));
  assert.equal(r.did, true);
  const marked = textRuns(r.state.doc).filter((t) => t.marks.includes('tkSpan'));
  assert.ok(marked.length > 0, 'tkSpan landed');
  for (const m of marked) assert.ok(m.marks.includes('bold'), 'sibling bold preserved under tkSpan');
  // one undo restores byte-exact
  let un = r.state;
  undo(un, (tr) => { un = un.apply(tr); });
  assert.deepEqual(clone(un.doc.toJSON()), before);
});

// ── 2. UNSET PARITY — full coverage → the same click strips the span ─────────────────────────
ok('TK unset parity: fully-covered range strips on toggle', () => {
  const state = makeState({ type: 'doc', content: [row('tk covered words')] });
  const from = 4, to = state.doc.content.size - 4;
  const set = apply(state, (d) => bulkToggleSpanRange(state, d, from, to, 'tkSpan', 'full'));
  const covered = set.state;
  const strip = apply(covered, (d) => bulkToggleSpanRange(covered, d, from, to, 'tkSpan', 'full'));
  assert.equal(strip.did, true);
  assert.equal(textRuns(strip.state.doc).some((t) => t.marks.includes('tkSpan')), false, 'span stripped');
});

// ── 3. FC lands with default status:'pending' (setMark parity) ───────────────────────────────
ok('FC set stores default attrs (status pending) like the bubble did', () => {
  const state = makeState({ type: 'doc', content: [row('check this claim')] });
  const from = 4, to = state.doc.content.size - 4;
  const r = apply(state, (d) => bulkToggleSpanRange(state, d, from, to, 'factCheckSpan', 'full'));
  assert.equal(r.did, true);
  let attrs = null;
  r.state.doc.descendants((n) => {
    if (n.isText) { const m = n.marks.find((mk) => mk.type.name === 'factCheckSpan'); if (m) attrs = m.attrs; }
    return true;
  });
  assert.deepEqual(attrs, { status: 'pending' });
});

// ── 4. LANE SCOPING — said click marks only the said lane across a split row ─────────────────
ok('TK said-lane click leaves the shown lane byte-untouched', () => {
  const state = makeState({ type: 'doc', content: [splitRow('said words here', 'shown words here')] });
  const shownBefore = clone(state.doc.child(0).child(1).toJSON());
  const r = apply(state, (d) => bulkToggleSpanRange(state, d, 1, state.doc.content.size - 1, 'tkSpan', 'said'));
  assert.equal(r.did, true);
  const saidCell = r.state.doc.child(0).child(0);
  const shownCell = r.state.doc.child(0).child(1);
  let saidHas = false;
  saidCell.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'tkSpan')) saidHas = true; return true; });
  assert.equal(saidHas, true, 'said lane took the span');
  assert.deepEqual(clone(shownCell.toJSON()), shownBefore, 'shown lane untouched');
});

// ── 5. ALIGN PORT — center stamps every paragraph in range; same-align re-apply = no-op ──────
ok('align center stamps paragraphs in range only; re-apply no-ops; undo restores', () => {
  const state = makeState({ type: 'doc', content: [row('first line'), row('second line'), row('third line')] });
  const before = clone(state.doc.toJSON());
  // range covering rows 1+2 only
  const row3Start = state.doc.child(0).nodeSize + state.doc.child(1).nodeSize;
  const r = apply(state, (d) => bulkSetTextAlignRange(state, d, 1, row3Start - 1, 'center'));
  assert.equal(r.did, true);
  const aligns = [];
  r.state.doc.descendants((n) => { if (n.type.name === 'paragraph') aligns.push(n.attrs.textAlign); return true; });
  assert.deepEqual(aligns, ['center', 'center', 'left']);
  // calm no-op when nothing would change
  const again = apply(r.state, (d) => bulkSetTextAlignRange(r.state, d, 1, row3Start - 1, 'center'));
  assert.equal(again.did, false, 'same-alignment re-apply dispatches nothing');
  // undo restores byte-exact
  let un = r.state;
  undo(un, (tr) => { un = un.apply(tr); });
  assert.deepEqual(clone(un.doc.toJSON()), before);
});

// ── 6. ACTIVE PAINT — full-coverage rule only ────────────────────────────────────────────────
ok('rangesFullyMarked/rangeAlignActive use the full-coverage isActive rule', () => {
  const state = makeState({ type: 'doc', content: [row('half marked words')] });
  const from = 4, to = state.doc.content.size - 4;
  const mid = Math.floor((from + to) / 2);
  const half = apply(state, (d) => bulkToggleSpanRange(state, d, from, mid, 'tkSpan', 'full'));
  const tk = schema.marks.tkSpan;
  assert.equal(rangesFullyMarked(half.state.doc, [[from, to]], tk), false, 'partial coverage = inactive');
  assert.equal(rangesFullyMarked(half.state.doc, [[from, mid]], tk), true, 'full coverage = active');
  assert.equal(rangeAlignActive(state.doc, from, to, 'left'), true, 'default left is active');
  assert.equal(rangeAlignActive(state.doc, from, to, 'center'), false);
});

// ── 7. Collapsed range: span refuses (never mark an empty selection); align keeps the bubble's
//       caret behavior (setTextAlign at a caret aligns the host paragraph) ─────────────────────
ok('collapsed range: span refused, align aligns the host paragraph (bubble parity)', () => {
  const state = makeState({ type: 'doc', content: [row('words')] });
  const r1 = apply(state, (d) => bulkToggleSpanRange(state, d, 4, 4, 'tkSpan', 'full'));
  assert.equal(r1.did, false);
  const r2 = apply(state, (d) => bulkSetTextAlignRange(state, d, 4, 4, 'center'));
  assert.equal(r2.did, true);
  let align = null;
  r2.state.doc.descendants((n) => { if (n.type.name === 'paragraph') align = n.attrs.textAlign; return true; });
  assert.equal(align, 'center');
});

console.log(`bulk-utils.test.mjs: ${pass} assertions passed`);
