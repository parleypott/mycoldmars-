/*
 * undo-viewport-guard.test.mjs — the collab Cmd+Z viewport fix (undo-viewport-guard.js).
 *
 * THE BUG: in a collab session Cmd+Z is Y.UndoManager, and @tiptap/y-tiptap applies every undo
 * as a FULL-DOC replace + best-effort selection restore + scrollIntoView. When the restore
 * silently fails (stored relative positions resolve null AND the top-level textContent fallback
 * misses — guaranteed when the undo reverts text in the row being edited), ProseMirror maps the
 * old selection through the whole-doc ReplaceStep to the DOC END and the viewport scrolls to
 * the bottom of the entire script. The guard's appendTransaction snaps a mis-restored caret
 * back to the undone-change site (diffStart) with a SELECTION-ONLY appended transaction.
 *
 * Proves:
 *   1. PURE HELPER — correctedUndoSelectionPos: null on no-op undo, null when the head sits in
 *      the diff region (± slack, incl. a legitimate edit at the true doc end), diffStart when
 *      the head is a doc-end mapping artifact.
 *   2. DOC-END BRANCH (deterministic, _typeChanged's exact failed-restore shape: full-doc
 *      replace, y-sync undo meta, NO setSelection) — without the guard the caret lands at the
 *      doc end; with it the appended tr snaps the caret to the change site, carries
 *      scrollIntoView, and has ZERO steps (docChanged === false).
 *   3. GUARD INERT — a sane restore (selection already at the change site) appends nothing;
 *      remote-teammate dispatches (isChangeOrigin without isUndoRedoOperation) append nothing.
 *   4. REAL PATH — full ySyncPlugin + yUndoPlugin + stub view: seed a Y.Doc the way
 *      seedRoomIfEmpty does, type in row two, delete the row (deleteBlock-shaped tr), then
 *      y-tiptap undo(). The caret ends inside the restored row's diff region — never at the
 *      doc end, never in a neighbouring row's text.
 *   5. DATA-LOSS LAWS — the guard is byte-invisible: post-undo doc JSON and encoded Y.Doc state
 *      are identical with the guard installed vs not (zero new Yjs items); the post-undo doc
 *      passes PMNode.check() against the mirror schema and flattens through docToBlocks with
 *      the words intact.
 *
 * Run: bun src/extensions/undo-viewport-guard.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode, Slice } from '@tiptap/pm/model';
import { EditorState, TextSelection, Selection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import * as Y from 'yjs';
import {
  prosemirrorJSONToYDoc,
  initProseMirrorDoc,
  ySyncPlugin,
  ySyncPluginKey,
  yUndoPlugin,
  yUndoPluginKey,
  undo as yUndo,
} from '@tiptap/y-tiptap';
import { correctedUndoSelectionPos, undoViewportGuardPlugin } from './undo-viewport-guard.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { docToBlocks } from '../document-builder.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// Same schema the collab editor runs (undo lives in plugins we control per-test, so the
// StarterKit history config is irrelevant here — getSchema only extracts node/mark specs).
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const row = (blocks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const threeRows = (rowTwoText) => ({
  type: 'doc',
  content: [
    row([none('blk_1', 'one one one')]),
    row([none('blk_2', rowTwoText)]),
    row([none('blk_3', 'three three three')]),
  ],
});

function findTextPos(doc, needle) {
  let found = null;
  doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return;
    const at = node.text.indexOf(needle);
    if (at >= 0) found = pos + at;
  });
  if (found === null) throw new Error('needle not found: ' + needle);
  return found;
}

function findRowRange(doc, needle) {
  let range = null;
  doc.descendants((node, pos) => {
    if (range || node.type.name !== 'tableRow') return false;
    if (node.textContent.includes(needle)) range = { from: pos, to: pos + node.nodeSize };
    return false; // rows are top-level; never descend
  });
  if (!range) throw new Error('row not found: ' + needle);
  return range;
}

// The diff region (in post-undo coordinates) between the pre-undo and post-undo docs — the
// yardstick the guard itself judges against, recomputed independently here.
function diffRegion(oldDoc, newDoc) {
  const start = oldDoc.content.findDiffStart(newDoc.content);
  const end = oldDoc.content.findDiffEnd(newDoc.content);
  return { start, end: Math.max(start ?? 0, end ? end.b : (start ?? 0)) };
}

// ── 1: the pure helper ─────────────────────────────────────────────────────────────────────
ok('correctedUndoSelectionPos — no-op undo (identical docs) → null', () => {
  const doc = docFrom(threeRows('two two two'));
  assert.equal(correctedUndoSelectionPos(doc, doc, 4), null);
});

ok('correctedUndoSelectionPos — head inside the diff region (± slack) → null', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const newDoc = docFrom(threeRows('two two two'));
  const at = findTextPos(newDoc, 'two two two');
  // The diff is the single reverted 'X' at at+11; heads at and slack-adjacent to it are sane.
  for (const head of [at + 9, at + 10, at + 11, at + 12, at + 13]) {
    assert.equal(correctedUndoSelectionPos(oldDoc, newDoc, head), null, `head ${head} is sane`);
  }
});

ok('correctedUndoSelectionPos — doc-end artifact with a mid-doc diff → diffStart', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const newDoc = docFrom(threeRows('two two two'));
  const { start } = diffRegion(oldDoc, newDoc);
  const artifact = newDoc.content.size - 2; // where the whole-doc ReplaceStep mapping dumps it
  assert.equal(correctedUndoSelectionPos(oldDoc, newDoc, artifact), start);
  // …and far BEFORE the region is just as wrong (milder misplacement, same correction).
  assert.equal(correctedUndoSelectionPos(oldDoc, newDoc, 1), start);
});

ok('correctedUndoSelectionPos — diff AT the doc end + head at the doc end → null (legit)', () => {
  const oldDoc = docFrom(threeRows('two two two'));
  const oldWithTail = docFrom({
    type: 'doc',
    content: [...clone(threeRows('two two two')).content],
  });
  // Undo reverts typing inside the LAST row: diff region touches the doc end, so a head near
  // the end is the RIGHT restore and must not be "corrected".
  const newDoc = docFrom({
    type: 'doc',
    content: [
      ...clone(threeRows('two two two')).content.slice(0, 2),
      row([none('blk_3', 'three three threeX')]),
    ],
  });
  assert.equal(correctedUndoSelectionPos(oldWithTail, newDoc, newDoc.content.size - 2), null);
  assert.ok(oldDoc, 'baseline built');
});

// ── 2: the doc-end branch, deterministic (_typeChanged's failed-restore shape) ─────────────
// A y-sync undo dispatch is: full-doc replace + meta {isChangeOrigin, isUndoRedoOperation} +
// addToHistory:false + scrollIntoView, and — in the failure mode — NO setSelection. Build that
// exact transaction and prove the guard's appended tr fixes the selection without touching
// the doc.
function undoShapedTr(state, newDocNode) {
  return state.tr
    .replace(0, state.doc.content.size, new Slice(newDocNode.content, 0, 0))
    .setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: true })
    .setMeta('addToHistory', false)
    .scrollIntoView();
}

ok('doc-end branch — WITHOUT the guard the caret maps to the doc end (the bug)', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const state = EditorState.create({
    schema, doc: oldDoc, plugins: [],
    selection: TextSelection.near(oldDoc.resolve(findTextPos(oldDoc, 'twoX') + 3), 1),
  });
  const newDoc = docFrom(threeRows('two two two'));
  const { state: after } = state.applyTransaction(undoShapedTr(state, newDoc));
  const { end } = diffRegion(oldDoc, after.doc);
  assert.ok(after.selection.head > end + 2, 'caret mapped far past the change site');
  assert.ok(after.selection.head >= after.doc.content.size - 6, 'caret is at the doc END');
});

ok('doc-end branch — WITH the guard the appended tr snaps the caret to the change site', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const state = EditorState.create({
    schema, doc: oldDoc, plugins: [undoViewportGuardPlugin()],
    selection: TextSelection.near(oldDoc.resolve(findTextPos(oldDoc, 'twoX') + 3), 1),
  });
  const newDoc = docFrom(threeRows('two two two'));
  const { state: after, transactions } = state.applyTransaction(undoShapedTr(state, newDoc));

  assert.equal(transactions.length, 2, 'exactly one appended transaction');
  const appended = transactions[1];
  // DATA-LOSS LAW — the correction is selection-only: zero steps, doc untouched.
  assert.equal(appended.docChanged, false, 'appended tr never changes the doc');
  assert.equal(appended.steps.length, 0, 'appended tr carries zero steps');
  assert.equal(appended.scrolledIntoView, true, 'the view scrolls to the CORRECTED caret');
  assert.equal(appended.getMeta('addToHistory'), false, 'correction never enters any history');

  const { start, end } = diffRegion(oldDoc, after.doc);
  assert.ok(
    after.selection.head >= start - 2 && after.selection.head <= end + 2,
    `caret ${after.selection.head} sits in the diff region [${start}, ${end}]`
  );
  assert.ok(after.selection.head < after.doc.content.size - 6, 'caret is NOT at the doc end');
  assert.deepEqual(clone(after.doc.toJSON()), clone(newDoc.toJSON()), 'doc is exactly the undone doc');
});

// ── 3: guard inert when it should be ───────────────────────────────────────────────────────
ok('guard inert — a sane restore (selection set at the change site) appends nothing', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const state = EditorState.create({
    schema, doc: oldDoc, plugins: [undoViewportGuardPlugin()],
    selection: TextSelection.near(oldDoc.resolve(findTextPos(oldDoc, 'twoX')), 1),
  });
  const newDoc = docFrom(threeRows('two two two'));
  let tr = undoShapedTr(state, newDoc);
  // Mimic a SUCCESSFUL restoreRelativeSelection: caret placed at the change site.
  const at = findTextPos(tr.doc, 'two two two');
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(at + 11), 1));
  const { state: after, transactions } = state.applyTransaction(tr);
  assert.equal(transactions.length, 1, 'no appended transaction');
  assert.equal(after.selection.head, at + 11, 'restored selection untouched');
});

ok('guard inert — remote-teammate dispatch (no isUndoRedoOperation) appends nothing', () => {
  const oldDoc = docFrom(threeRows('two two twoX'));
  const state = EditorState.create({
    schema, doc: oldDoc, plugins: [undoViewportGuardPlugin()],
    selection: TextSelection.near(oldDoc.resolve(findTextPos(oldDoc, 'twoX') + 3), 1),
  });
  const newDoc = docFrom(threeRows('two two two'));
  const tr = state.tr
    .replace(0, state.doc.content.size, new Slice(newDoc.content, 0, 0))
    .setMeta(ySyncPluginKey, { isChangeOrigin: true }) // remote update, NOT an undo
    .setMeta('addToHistory', false);
  const { transactions } = state.applyTransaction(tr);
  assert.equal(transactions.length, 1, 'remote changes never move the local caret');
});

// ── 4+5: the REAL path — ySyncPlugin + yUndoPlugin + stub view, guard on vs off ────────────
// Mirrors the live wiring: Y.Doc seeded the way seedRoomIfEmpty seeds a room, the y-sync binding
// dispatching into a stub view whose dispatch applies the tr and runs the plugin views — exactly
// what EditorView does, synchronously, inside the binding's mutex.
// Seed encoded ONCE (prosemirrorJSONToYDoc mints a random clientID per call) so the two
// harness runs share byte-identical seed items and the guard-vs-no-guard Y state compares.
const SEED_UPDATE = Y.encodeStateAsUpdate(
  prosemirrorJSONToYDoc(schema, threeRows('two two two'), 'default')
);

function makeCollabHarness({ withGuard }) {
  const yDoc = new Y.Doc();
  yDoc.clientID = 424242; // pinned so local edits are byte-comparable across harness runs
  Y.applyUpdate(yDoc, SEED_UPDATE);
  const fragment = yDoc.getXmlFragment('default');
  const { doc, mapping } = initProseMirrorDoc(fragment, schema);
  const syncPlugin = ySyncPlugin(fragment, { mapping });
  const undoPlugin = yUndoPlugin();
  const plugins = [syncPlugin, undoPlugin];
  if (withGuard) plugins.push(undoViewportGuardPlugin());
  let state = EditorState.create({ schema, doc, plugins });
  const rounds = []; // every dispatch round's transaction group, for the zero-steps law
  let pluginViews = [];
  const view = {
    get state() { return state; },
    hasFocus: () => false, // headless: also keeps y-tiptap's own scrollIntoView arm cold
    _root: null,
    dispatch(tr) {
      const res = state.applyTransaction(tr);
      state = res.state;
      rounds.push(res.transactions);
      for (const pv of pluginViews) pv && pv.update && pv.update(view);
    },
  };
  pluginViews = [syncPlugin.spec.view(view), undoPlugin.spec.view(view)];
  return { view, yDoc, rounds, get state() { return state; } };
}

function runRealUndoScenario({ withGuard }) {
  const h = makeCollabHarness({ withGuard });

  // Cursor into row two, then type — capture group 1.
  const at = findTextPos(h.state.doc, 'two two two');
  h.view.dispatch(h.state.tr.setSelection(TextSelection.near(h.state.doc.resolve(at + 11), 1)));
  h.view.dispatch(h.state.tr.insertText('X'));
  assert.ok(h.state.doc.textContent.includes('two two twoX'), 'typed into row two');

  // Force a NEW capture group (stands in for Y.UndoManager's 500ms captureTimeout elapsing).
  yUndoPluginKey.getState(h.state).undoManager.stopCapturing();

  // Delete row two, deleteBlock-shaped: delete + explicit Selection.near, NO scrollIntoView.
  const range = findRowRange(h.state.doc, 'twoX');
  let tr = h.state.tr.delete(range.from, range.to);
  tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(range.from, tr.doc.content.size - 1)), 1));
  h.view.dispatch(tr);
  assert.equal(h.state.doc.childCount, 2, 'row two deleted');

  // The undo. Y.UndoManager mutates the Y.Doc; the binding dispatches the full-doc replace
  // into our stub view; the guard (when installed) appends its correction in the same round.
  const preUndoDoc = h.state.doc;
  yUndo(h.state);
  const undoRound = h.rounds[h.rounds.length - 1];
  return { h, preUndoDoc, undoRound };
}

ok('REAL PATH — undo restores the row and the caret lands in the diff region, not the doc end', () => {
  const { h, preUndoDoc, undoRound } = runRealUndoScenario({ withGuard: true });

  // The undo really ran and restored the deleted row (with the typed X — group 2 only).
  assert.equal(h.state.doc.childCount, 3, 'undo restored the deleted row');
  assert.ok(h.state.doc.textContent.includes('two two twoX'), 'restored row kept the typed text');

  // THE FIX: caret inside the restored-change diff region…
  const { start, end } = diffRegion(preUndoDoc, h.state.doc);
  assert.ok(start !== null, 'undo produced a real diff');
  assert.ok(
    h.state.selection.head >= start - 2 && h.state.selection.head <= end + 2,
    `caret ${h.state.selection.head} in diff region [${start}, ${end}]`
  );
  // …never at the doc end (the reported bug)…
  assert.ok(h.state.selection.head < h.state.doc.content.size - 4, 'caret NOT at the doc end');
  // …and never inside a neighbouring row's text (the milder misplacement the repro surfaced).
  const threeStart = findTextPos(h.state.doc, 'three three three');
  assert.ok(
    !(h.state.selection.head >= threeStart && h.state.selection.head <= threeStart + 17),
    'caret NOT inside row three'
  );

  // The guard actually FIRED (this pins y-tiptap 3.0.6: its restore misplaces the caret into
  // row three on this exact scenario — probe-verified head=43 without the guard). If a future
  // y-tiptap upgrade makes the restore succeed, this assertion is the signal that the guard has
  // gone inert on this path and can be re-evaluated.
  assert.equal(undoRound.length, 2, 'guard appended its correction to the undo round');

  // ONE-TRANSACTION/DATA-LOSS LAW on the undo round: any guard-appended tr is selection-only.
  for (const t of undoRound.slice(1)) {
    assert.equal(t.docChanged, false, 'appended trs never change the doc');
    assert.equal(t.steps.length, 0, 'appended trs carry zero steps');
  }
});

ok('REAL PATH — the guard is byte-invisible: doc JSON + Y.Doc state identical with vs without', () => {
  const withGuard = runRealUndoScenario({ withGuard: true });
  const without = runRealUndoScenario({ withGuard: false });

  // Same post-undo ProseMirror doc, byte for byte.
  assert.deepEqual(
    clone(withGuard.h.state.doc.toJSON()),
    clone(without.h.state.doc.toJSON()),
    'guard changes NOTHING about the doc'
  );
  // Same encoded Y.Doc state (pinned clientID) — the guard's selection-only tr produced ZERO
  // new Yjs items when it flowed back through the sync plugin's view update.
  assert.deepEqual(
    Array.from(Y.encodeStateAsUpdate(withGuard.h.yDoc)),
    Array.from(Y.encodeStateAsUpdate(without.h.yDoc)),
    'guard adds zero Yjs items'
  );
});

ok('REAL PATH — post-undo doc passes the mirror-schema gate and docToBlocks round-trip', () => {
  const { h } = runRealUndoScenario({ withGuard: true });
  // Mirror-schema law: the doc the undo left behind re-parses and checks clean.
  const reparsed = docFrom(h.state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(h.state.doc.toJSON()), 'mirror round-trip byte-exact');
  // Blocks export: all three rows flatten with their words intact.
  const blocks = docToBlocks(h.state.doc.toJSON());
  const texts = blocks.map((b) => b.text || '');
  assert.ok(texts.some((t) => t.includes('one one one')), 'row one exported');
  assert.ok(texts.some((t) => t.includes('two two twoX')), 'restored row two exported');
  assert.ok(texts.some((t) => t.includes('three three three')), 'row three exported');
});

console.log(`undo-viewport-guard.test.mjs: ${pass} assertions passed`);
