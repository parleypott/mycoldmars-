/**
 * CHECK-OFF IN A ?read SHARE — the zero-write invariant for workspace row check-off
 * (vector: workspaces-in-read).
 *
 * Enabling WORKSPACES on a ?read share means a teammate opening a read link can enter their
 * craft workspace and CHECK OFF their own rows. That must stay STRUCTURALLY write-incapable:
 * the check is view-local (their own localStorage) and touches NOTHING shared. The load-bearing
 * property is that a toggleCheck transaction carries ZERO document steps — so it is byte-for-byte
 * a no-op on the doc, exactly what lets ProseMirror apply it to a NON-EDITABLE (read-share) view
 * without ever advancing the canonical script.
 *
 * This drives the workspace-filter plugin's reducer directly (state.apply(tr) — the very call
 * view.dispatch makes; `editable:false` gates DOM input, not state.apply), so it proves the
 * check path is safe on a read share without needing a live editable editor:
 *
 *   1. ENTER a workspace, then TOGGLE a member row's check.
 *   2. The resulting doc is .eq() the doc before the toggle — byte-identical.
 *   3. The toggle transaction produced ZERO steps (no doc mutation to persist or echo).
 *   4. The check landed in the plugin's view-local `checked` set AND in the injected store
 *      (the viewer's own browser), never on the doc.
 *   5. Un-toggling clears it (store key removed) — still zero doc steps.
 *
 * Run: bun src/checkoff-in-read.test.mjs   (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { createWorkspaceFilterPlugin, workspaceFilterKey } from './extensions/workspace-filter.js';
import { walkRows, rowIsMember, workspaceRole } from './workspaces.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

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

const cell = (blocks) => ({ type: 'tableCell', attrs: { role: 'full' }, content: blocks });
const row = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell(blocks)] });
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const broll = (id, text) => ({ type: 'brollBlock', attrs: { blockId: id }, content: [para(text)] });
const chapterBlk = (id, title) => ({ type: 'chapterBlock', attrs: { blockId: id, genre: 'other' }, content: [para(title)] });

// A doc with one chapter row and two B-ROLL rows (the craft the teammate checks off).
const doc = PMNode.fromJSON(schema, {
  type: 'doc',
  content: [
    row([chapterBlk('blk_ch1', 'The Crossing')]),
    row([broll('blk_broll1', 'wide of the river at dawn')]),
    row([broll('blk_broll2', 'boats pulling in')]),
  ],
});

// A mock check-off store standing in for the viewer's OWN localStorage (Editor.jsx injects the
// real one). It records saves so we can prove the check is persisted view-locally, not on the doc.
function mockStore() {
  const mem = new Map();
  return {
    saves: [],
    load: (k) => new Set(mem.get(k) || []),
    save: (k, set) => { mem.set(k, [...set]); },
    _mem: mem,
  };
}
// Bind saves recorder around the store.
function recordingStore() {
  const s = mockStore();
  const inner = { load: s.load, save: s.save };
  return {
    saves: s.saves,
    _mem: s._mem,
    load: (k) => inner.load(k),
    save: (k, set) => { s.saves.push({ k, ids: [...set] }); inner.save(k, set); },
  };
}

// The B-ROLL member row's stable identity (firstBlockId) — resolved off walkRows, never hardcoded.
const brollRole = workspaceRole('broll');
const memberId = walkRows(doc).find((r) => rowIsMember(r.node, brollRole))?.firstBlockId;

// Build an EditorState whose only plugin is the workspace filter (bound to a recording store).
function stateWith(store) {
  const plugin = createWorkspaceFilterPlugin(store);
  return EditorState.create({ schema, doc, plugins: [plugin] });
}

ok('a member row resolves a stable check identity (firstBlockId)', () => {
  assert.equal(memberId, 'blk_broll1', 'the first B-ROLL row is the check target');
});

ok('toggleCheck is byte-identical on the doc + zero steps (read-share safe)', () => {
  const store = recordingStore();
  let state = stateWith(store);

  // ENTER the broll workspace (loads the empty check set for this craft).
  state = state.apply(state.tr.setMeta(workspaceFilterKey, { key: 'broll' }));
  const afterEnter = state.doc;
  assert.equal(workspaceFilterKey.getState(state).wsKey, 'broll', 'workspace is active');
  assert.equal((workspaceFilterKey.getState(state).checked || new Set()).size, 0, 'nothing checked yet');

  // TOGGLE the row's check — the exact transaction a read-share viewer's click dispatches.
  const toggleTr = state.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: memberId } });
  assert.equal(toggleTr.steps.length, 0, 'toggleCheck carries ZERO doc steps — nothing to write or echo');
  const checked = state.apply(toggleTr);

  // The doc is byte-for-byte unchanged — the canonical script never moves on a read share.
  assert.ok(checked.doc.eq(afterEnter), 'doc is byte-identical after the check');
  assert.ok(checked.doc.eq(doc), 'doc still equals the original seed');

  // The check landed VIEW-LOCAL: in the plugin state and in the injected (browser-local) store.
  const set = workspaceFilterKey.getState(checked).checked;
  assert.ok(set && set.has(memberId), 'the plugin now marks the row done');
  const lastSave = store.saves[store.saves.length - 1];
  assert.deepEqual(lastSave.ids, [memberId], 'the check was persisted to the viewer’s own store, not the doc');

  // UN-TOGGLE — still zero steps, doc still identical, store key emptied.
  const untoggleTr = checked.tr.setMeta(workspaceFilterKey, { toggleCheck: { id: memberId } });
  assert.equal(untoggleTr.steps.length, 0, 'un-toggle carries ZERO doc steps too');
  const cleared = checked.apply(untoggleTr);
  assert.ok(cleared.doc.eq(doc), 'doc unchanged after un-toggle');
  assert.equal((workspaceFilterKey.getState(cleared).checked || new Set()).size, 0, 'row is un-done');
  assert.deepEqual(store.saves[store.saves.length - 1].ids, [], 'the store persisted the empty set');
});

console.log(`\ncheckoff-in-read.test.mjs — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
