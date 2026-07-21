/*
 * pending-viz.test.mjs — the /pending PENDING VISUAL PLAN contract.
 *
 * The flag is a block ATTR (blocks.js baseAttrs `pendingViz`, WP-13 — reconstruction data in
 * attributes, never decorations), painted by pure CSS (styles.css :has([data-pending-viz])):
 * NOTHING dispatches automatically, so it is collab-safe by construction.
 *
 * Proves:
 *   1. ROUND-TRIP — pendingViz survives doc → docToBlocks → buildEditorDocument; an
 *      UNSTAMPED doc's blocks array stays byte-identical (no pendingViz key ever emitted).
 *   2. MIRROR SCHEMA — a stamped doc passes PMNode.check() + fromJSON→toJSON byte-exact
 *      (the migrate-doc save-gate law).
 *   3. /pending STAMPS every cartridge block in the host CELL, removes the trigger text,
 *      and lands as ONE undo step (single undo restores the original doc byte-exact).
 *   4. TOGGLE — re-running /pending on a pending cell clears every stamp (back to null,
 *      indistinguishable from never-stamped).
 *   5. SPLIT-ROW SCOPE — the stamp reaches ONLY the caret's cell; the sibling lane is untouched.
 *   6. BARE CELL PARAGRAPH — a "+"-added row's bare paragraph is wrapped into a stamped
 *      noneBlock (the retypeHostToVo case-(b) shape), so the flag always has an attr home.
 *   7. CLEAR-ON-VISUAL — maybeClearPendingForKind clears the cell for every visual kind
 *      (PENDING_CLEARING_KINDS: animation/3d/broll/mapdata/archive/direction) and does
 *      NOTHING for factcheck (byte-identical doc — the fact-check is not a visual plan).
 *
 * Run: bun src/extensions/pending-viz.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  doTogglePendingViz, maybeClearPendingForKind, PENDING_CLEARING_KINDS,
} from './slash-menu.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks, buildEditorDocument } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// The EXACT schema the live editor + migrate-doc's save gate enforce (see slash-structure.test.mjs).
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
const splitRow = (saidBlocks, shownBlocks) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'pair_t' },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});
const vo = (id, text, extra) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo', ...(extra || {}) },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const oncam = (id, text, extra) => ({
  type: 'oncamBlock', attrs: { blockId: id, ...(extra || {}) },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

function findText(doc, needle) {
  let range = null;
  doc.descendants((node, pos) => {
    if (range || !node.isText) return;
    const at = node.text.indexOf(needle);
    if (at >= 0) range = { from: pos + at, to: pos + at + needle.length };
  });
  if (!range) throw new Error(`text ${needle} not found in doc`);
  return range;
}

function makeState(docJson, cursorAt) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc, plugins: [history()],
    selection: TextSelection.near(doc.resolve(cursorAt), 1),
  });
}

// Collect every {typeName, pendingViz} of cartridge blocks in reading order.
function pendingMap(doc) {
  const out = [];
  doc.descendants((node) => {
    if (node.type.spec.attrs && 'pendingViz' in node.type.spec.attrs) {
      out.push({ type: node.type.name, pendingViz: node.attrs.pendingViz });
    }
  });
  return out;
}

// ── 1. ROUND-TRIP — attr survives doc→blocks→doc; unstamped stays byte-identical ─────────
ok('pendingViz round-trips docToBlocks → buildEditorDocument; unstamped docs emit no key', () => {
  const stamped = { type: 'doc', content: [row([vo('vo_1', 'Narration words', { pendingViz: true })])] };
  const blocks = docToBlocks(clone(stamped));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].pendingViz, true, 'docToBlocks emits pendingViz:true for a stamped block');

  // buildEditorDocument restores the attr onto the rebuilt node.
  const rebuilt = buildEditorDocument(blocks);
  let restored = null;
  const walk = (n) => {
    if (n?.type === 'voBlock') restored = n;
    (n?.content || []).forEach(walk);
  };
  walk(rebuilt);
  assert.ok(restored, 'voBlock survives the rebuild');
  assert.equal(restored.attrs.pendingViz, true, 'buildEditorDocument restores pendingViz');

  // UNSTAMPED: no pendingViz key anywhere in the derived blocks (byte-stable contract).
  const plain = { type: 'doc', content: [row([vo('vo_1', 'Narration words')])] };
  const plainBlocks = docToBlocks(clone(plain));
  assert.ok(!('pendingViz' in plainBlocks[0]), 'unstamped block carries NO pendingViz key');
});

// ── 2. MIRROR SCHEMA — the save-gate law ─────────────────────────────────────────────────
ok('a stamped doc passes the mirror schema check + fromJSON→toJSON byte-exact', () => {
  const stamped = docFrom({
    type: 'doc',
    content: [row([vo('vo_1', 'Narration', { pendingViz: true }), oncam('oc_1', 'Beat', { pendingViz: true })])],
  });
  stamped.check();
  const reparsed = docFrom(stamped.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(stamped.toJSON()), 'byte-exact through the mirror schema');
});

// ── 3. /pending stamps EVERY block in the host cell — ONE transaction, ONE undo ──────────
ok('/pending stamps all cell blocks + removes the trigger; a SINGLE undo restores the doc', () => {
  const docJson = {
    type: 'doc',
    content: [row([vo('vo_1', 'Narration /pending'), oncam('oc_1', 'Walking beat')])],
  };
  let state = makeState(docJson, 4);
  const range = findText(state.doc, '/pending');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doTogglePendingViz(state, dispatch, range), true, 'stamp returns true');
  assert.equal(state.doc.textContent.includes('/pending'), false, 'trigger text removed');
  assert.deepEqual(pendingMap(state.doc), [
    { type: 'voBlock', pendingViz: true },
    { type: 'oncamBlock', pendingViz: true },
  ], 'EVERY cartridge block in the host cell is stamped');

  // ONE-TRANSACTION LAW: trigger delete + stamp land in a single history step.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'single undo restores the original doc byte-exact');
});

// ── 4. TOGGLE — re-running /pending on a pending cell clears every stamp ─────────────────
ok('re-running /pending on a pending cell toggles it off (cleared to null)', () => {
  const docJson = {
    type: 'doc',
    content: [row([
      vo('vo_1', 'Narration words', { pendingViz: true }),
      oncam('oc_1', 'Walking beat', { pendingViz: true }),
    ])],
  };
  let state = makeState(docJson, 4);
  const at = findText(state.doc, 'Narration').from;
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doTogglePendingViz(state, dispatch, { from: at, to: at }), true, 'toggle returns true');
  assert.deepEqual(pendingMap(state.doc), [
    { type: 'voBlock', pendingViz: null },
    { type: 'oncamBlock', pendingViz: null },
  ], 'toggle clears every stamp to null (indistinguishable from never-stamped)');
});

// ── 5. SPLIT-ROW SCOPE — only the caret's cell is stamped ────────────────────────────────
ok('in a said|shown split, /pending stamps only the cell hosting the caret', () => {
  const docJson = {
    type: 'doc',
    content: [splitRow([vo('vo_said', 'What is said')], [oncam('oc_shown', 'Whats shown /pending')])],
  };
  let state = makeState(docJson, 4);
  const range = findText(state.doc, '/pending');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doTogglePendingViz(state, dispatch, range), true);
  assert.deepEqual(pendingMap(state.doc), [
    { type: 'voBlock', pendingViz: null },
    { type: 'oncamBlock', pendingViz: true },
  ], 'shown cell stamped, said cell untouched');
});

// ── 6. BARE CELL PARAGRAPH — wrapped into a stamped noneBlock ────────────────────────────
ok('a bare cell paragraph is wrapped into a stamped noneBlock (attr home minted)', () => {
  const docJson = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: 'pairu_x' },
      content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [para('Bare words /pending')] }],
    }],
  };
  let state = makeState(docJson, 3);
  const range = findText(state.doc, '/pending');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doTogglePendingViz(state, dispatch, range), true);
  const cell = state.doc.child(0).child(0);
  assert.equal(cell.child(0).type.name, 'noneBlock', 'bare paragraph wrapped into a chrome-less noneBlock');
  assert.equal(cell.child(0).attrs.pendingViz, true, 'wrapper born stamped');
  assert.ok(cell.child(0).attrs.blockId, 'blockId minted');
  assert.equal(cell.textContent.trim(), 'Bare words', 'words kept, trigger removed');

  // Still schema-valid + byte-exact through the mirror schema.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()));
});

// ── 7. CLEAR-ON-VISUAL — visual kinds clear, factcheck does NOT ──────────────────────────
ok('PENDING_CLEARING_KINDS is exactly the six visual kinds', () => {
  assert.deepEqual(PENDING_CLEARING_KINDS, ['animation', '3d', 'broll', 'mapdata', 'archive', 'direction']);
});

ok('every visual kind clears the host cell; factcheck/oncam/sot leave it byte-identical', () => {
  const stampedJson = {
    type: 'doc',
    content: [row([vo('vo_1', 'Narration here', { pendingViz: true }), oncam('oc_1', 'Beat', { pendingViz: true })])],
  };

  for (const kind of PENDING_CLEARING_KINDS) {
    let state = makeState(stampedJson, 4);
    const pos = findText(state.doc, 'Narration').from;
    const tr = state.tr;
    assert.equal(maybeClearPendingForKind(tr, kind, pos), true, `${kind} clears`);
    state = state.apply(tr);
    assert.deepEqual(pendingMap(state.doc), [
      { type: 'voBlock', pendingViz: null },
      { type: 'oncamBlock', pendingViz: null },
    ], `${kind} clears the WHOLE cell in the same transaction`);
  }

  for (const kind of ['factcheck', 'oncam', 'sot']) {
    const state = makeState(stampedJson, 4);
    const before = clone(state.doc.toJSON());
    const pos = findText(state.doc, 'Narration').from;
    const tr = state.tr;
    assert.equal(maybeClearPendingForKind(tr, kind, pos), false, `${kind} must NOT clear`);
    assert.equal(tr.docChanged, false, `${kind} leaves the doc untouched`);
    assert.deepEqual(clone(state.apply(tr).doc.toJSON()), before, `${kind}: doc byte-identical`);
  }
});

console.log(`pending-viz.test.mjs: ${pass} assertions passed`);
