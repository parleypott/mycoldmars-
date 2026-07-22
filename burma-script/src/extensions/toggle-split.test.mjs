/*
 * toggle-split.test.mjs — the Option+X one-key column toggle (table.js).
 *
 * Johnny wanted a hotkey so he doesn't reach for the split/merge buttons. optionSplitKeyPlugin
 * binds Option+X (event.code 'KeyX' + altKey) and calls toggleRowSplit, which SPLITS a full row
 * or MERGES a split one based on `cols`. This locks the branch logic and the selection→row
 * resolver so a refactor can't silently make the key split-only, merge-only, or no-op.
 *
 * Proves:
 *   resolveRowPos  — from a caret inside a cell, returns the pos of the OWNING tableRow.
 *   toggleRowSplit — cols:1 caret → SPLIT to cols:2 (said|shown), lossless; cols:2 caret →
 *                    MERGE back to cols:1 (full), lossless; returns false when no row owns the
 *                    selection (never throws, never dispatches).
 *
 * Run: bun src/extensions/toggle-split.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { toggleRowSplit, resolveRowPos, BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

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

// Place the caret inside the FIRST text of the doc (some cell), mimicking a real selection.
const stateWithCaretInDoc = (docJson) => {
  const doc = docFrom(docJson);
  let caret = 1;
  doc.descendants((n, pos) => { if (caret === 1 && n.isText) caret = pos + 1; });
  const sel = TextSelection.create(doc, caret);
  return EditorState.create({ schema, doc, selection: sel, plugins: [history()] });
};

// ── resolveRowPos: a caret inside a cell resolves to the owning tableRow's pos ────────────
ok('resolveRowPos returns the owning tableRow position from a caret inside a cell', () => {
  const state = stateWithCaretInDoc({ type: 'doc', content: [row([vo('a', 'hello world')])] });
  const pos = resolveRowPos(state);
  assert.equal(typeof pos, 'number', 'resolves to a number');
  const node = state.doc.nodeAt(pos);
  assert.equal(node?.type.name, 'tableRow', 'the pos points at a tableRow');
});

// ── SPLIT: caret in a full-width row → toggle splits it to said|shown ─────────────────────
ok('toggleRowSplit splits a cols:1 full row into a cols:2 said|shown row, lossless', () => {
  let state = stateWithCaretInDoc({ type: 'doc', content: [row([vo('a', 'the narration line')])] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(toggleRowSplit(state, dispatch), true, 'toggle returns true on a full row');
  const r = state.doc.child(0);
  assert.equal(r.attrs.cols, 2, 'row is now cols:2');
  assert.deepEqual([r.child(0).attrs.role, r.child(1).attrs.role], ['said', 'shown'], 'said|shown roles');
  // the VO word survives the split (lands in the said lane)
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((x) => x.text).filter(Boolean),
    ['the narration line'], 'no words lost on split');
});

// ── MERGE: caret in a split row → toggle merges it back to full width ─────────────────────
ok('toggleRowSplit merges a cols:2 row back to a cols:1 full row, lossless', () => {
  let state = stateWithCaretInDoc({ type: 'doc', content: [
    pairedRow('p1', [vo('a', 'what was said')], [none('b', 'what was shown')]),
  ] });
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(toggleRowSplit(state, dispatch), true, 'toggle returns true on a split row');
  const r = state.doc.child(0);
  assert.equal(r.attrs.cols, 1, 'row is now cols:1');
  assert.equal(r.child(0).attrs.role, 'full', 'single full cell');
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((x) => x.id), ['a', 'b'], 'both lanes preserved, reading order');
});

// ── ROUND TRIP: split then merge returns to a single full row ────────────────────────────
ok('toggleRowSplit is a true toggle — split then merge round-trips to one full row', () => {
  let state = stateWithCaretInDoc({ type: 'doc', content: [row([vo('a', 'roundtrip line')])] });
  const dispatch = (tr) => { state = state.apply(tr); };
  toggleRowSplit(state, dispatch);
  assert.equal(state.doc.child(0).attrs.cols, 2, 'split first');
  toggleRowSplit(state, dispatch);
  assert.equal(state.doc.child(0).attrs.cols, 1, 'merged back to full');
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((x) => x.text).filter(Boolean),
    ['roundtrip line'], 'word survives the round trip');
});

// ── GUARD: no owning row → returns false, dispatches nothing, never throws ────────────────
ok('toggleRowSplit returns false and dispatches nothing when the selection owns no row', () => {
  // A bare paragraph doc (no table) — resolveRowPos finds no tableRow ancestor.
  const doc = docFrom({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
  const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1), plugins: [history()] });
  let dispatched = false;
  assert.equal(toggleRowSplit(state, () => { dispatched = true; }), false, 'returns false with no row');
  assert.equal(dispatched, false, 'nothing dispatched');
});

console.log(`toggle-split.test.mjs: ${pass} assertions passed`);
