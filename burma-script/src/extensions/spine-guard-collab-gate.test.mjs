/*
 * spine-guard-collab-gate.test.mjs — the COLLAB GATE on the table-spine guard
 * (table.js spineGuardSafeHere → addProseMirrorPlugins).
 *
 * INCIDENT 2026-07-07: the spine guard's appendTransaction rewrites the doc whenever a bare
 * top-level node exists. Under Liveblocks/Yjs every y-sync apply is a full-doc change, so the
 * guard re-fired on every remote echo of its own wrap — a dispatch loop that froze the live
 * #burma tab. The hotfix (8111c8d) gates the guard OFF for collab episodes. NOTHING locked
 * that gate: spine-guard.test.mjs only tests wrapBareTopLevelNodes, so a refactor that
 * re-enables the plugin unconditionally would ship green and re-freeze the live doc.
 *
 * Proves (drift-proof, against the LIVE plugin composition):
 *   1. LIVE-CONFIG CONSISTENCY — the shipped BURMA config mounts the spine-guard plugin
 *      IFF its collab flag is off (computed from the config itself, so flipping the flag
 *      later keeps this test honest instead of stale).
 *   2. COLLAB ON → NO GUARD — an explicit collab:true episode composes NO wpTableSpineGuard
 *      plugin, and a y-sync-echo-shaped transaction (full-doc change introducing a bare
 *      top-level paragraph) triggers NO automatic rewrite: zero self-dispatched transactions,
 *      zero loop fuel (COLLAB LOOP LAW, repo CLAUDE.md).
 *   3. COLLAB OFF → GUARD LIVE — the same episode with collab:false composes the guard, and
 *      the same bare-paragraph edit heals into a full-width row mid-apply (the data guard
 *      Johnny asked for still protects solo sessions).
 *   4. NEW LIBRARY PROJECT SHAPE — a config with NO features object (configForProject's
 *      brand-new-project shape) gets the guard (episodeFlag defaults false ⇒ non-collab).
 *   5. INDEPENDENCE — the collab gate never touches the row-drag plugin (user-gesture-driven,
 *      collab-safe): it stays mounted for collab episodes with rowDragReorder on.
 *
 * Run: bun src/extensions/spine-guard-collab-gate.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { TableRow, BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

// Compose the LIVE plugin set exactly the way TipTap does at editor creation: the node's
// addProseMirrorPlugins runs after setEpisode picks the config, so the gate is decided by
// the episode active at mount time — same as the real boot order (main.jsx setEpisode →
// Editor mount).
const composePlugins = (episode) => {
  setEpisode(episode);
  return TableRow.config.addProseMirrorPlugins.call({});
};
const hasSpineGuard = (plugins) =>
  plugins.some((p) => String(p.spec?.key?.key || '').startsWith('wpTableSpineGuard'));
const hasRowDrag = (plugins) =>
  plugins.some((p) => String(p.spec?.key?.key || '').startsWith('wpRowDrag'));

const row = (text) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{
      type: 'noneBlock', attrs: { blockId: 'blk_' + text.slice(0, 4) },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }],
  }],
});

// A y-sync-echo-shaped change: a transaction that makes the doc carry a bare top-level
// paragraph (what the live Burma room carried on incident day). Under Yjs the apply arrives
// as a doc change exactly like this — if the guard is mounted it appendTransactions a wrap;
// if not, the doc keeps the bare node and NOTHING self-dispatches.
const applyBareParagraph = (plugins) => {
  const doc = PMNode.fromJSON(schema, { type: 'doc', content: [row('alpha'), row('beta')] });
  let state = EditorState.create({ schema, doc, selection: TextSelection.near(doc.resolve(0), 1), plugins });
  const stray = schema.nodes.paragraph.create(null, schema.text('typed between rows'));
  const tr = state.tr.insert(0, stray);
  state = state.apply(tr); // appendTransaction (if any) runs INSIDE this apply
  return state.doc;
};

// ── 1: the live BURMA config is self-consistent with the gate ──────────────────────────────
ok('LIVE config: BURMA mounts the spine guard IFF its collab flag is off', () => {
  const plugins = composePlugins(BURMA);
  const collabOn = !!BURMA.features?.collab;
  assert.equal(hasSpineGuard(plugins), !collabOn,
    `BURMA collab=${collabOn} must ${collabOn ? 'EXCLUDE' : 'INCLUDE'} wpTableSpineGuard`);
});

// ── 2: collab ON → no guard plugin, no automatic rewrite, no loop fuel ─────────────────────
ok('collab episode composes NO spine guard; a y-sync-echo bare node triggers NO rewrite', () => {
  const collabEpisode = { ...BURMA, features: { ...(BURMA.features || {}), collab: true } };
  const plugins = composePlugins(collabEpisode);
  assert.equal(hasSpineGuard(plugins), false, 'wpTableSpineGuard must NOT mount under collab');
  const docAfter = applyBareParagraph(plugins);
  // The bare paragraph SURVIVES — proof no appendTransaction fired (zero self-dispatch = the
  // dispatch loop is structurally impossible, not just quiet today).
  assert.equal(docAfter.child(0).type.name, 'paragraph', 'bare node untouched under collab');
  assert.equal(docAfter.child(0).textContent, 'typed between rows');
});

// ── 3: collab OFF → guard mounted, bare node heals mid-apply ───────────────────────────────
ok('non-collab episode composes the guard; the same bare node heals into a full-width row', () => {
  const soloEpisode = { ...BURMA, features: { ...(BURMA.features || {}), collab: false } };
  const plugins = composePlugins(soloEpisode);
  assert.equal(hasSpineGuard(plugins), true, 'wpTableSpineGuard must mount for solo sessions');
  const docAfter = applyBareParagraph(plugins);
  assert.equal(docAfter.childCount, 3);
  for (let i = 0; i < docAfter.childCount; i++) {
    assert.equal(docAfter.child(i).type.name, 'tableRow', `child ${i} is a row after healing`);
  }
  assert.equal(docAfter.child(0).textContent, 'typed between rows', 'every word kept');
  assert.ok(String(docAfter.child(0).attrs.pairId || '').startsWith('pairu_'), 'keep-me marker minted');
});

// ── 4: brand-new library project (no features object) → guard present ──────────────────────
ok('a featureless config (configForProject new-project shape) still gets the guard', () => {
  const { features: _drop, ...bare } = BURMA;
  const plugins = composePlugins(bare);
  assert.equal(hasSpineGuard(plugins), true, 'no features ⇒ non-collab ⇒ guard mounts');
  assert.equal(hasRowDrag(plugins), false, 'no features ⇒ rowDragReorder off ⇒ no drag plugin');
});

// ── 5: the gate is surgical — row drag unaffected by collab ────────────────────────────────
ok('collab gate never touches the row-drag plugin (gesture-driven, collab-safe)', () => {
  const collabEpisode = { ...BURMA, features: { ...(BURMA.features || {}), collab: true, rowDragReorder: true } };
  const plugins = composePlugins(collabEpisode);
  assert.equal(hasRowDrag(plugins), true, 'wpRowDrag stays mounted under collab');
  assert.equal(hasSpineGuard(plugins), false);
});

setEpisode(BURMA); // leave the singleton as the suite found it
console.log(`spine-guard-collab-gate.test.mjs: ${pass} assertions passed`);
