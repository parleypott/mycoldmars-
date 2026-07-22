/*
 * spine-guard-trailing.test.mjs — THE P0 FREEZE LOCK (2026-07-07 #2, "editor freezes on
 * first edit"). StarterKit v3's TrailingNode plugin keeps ONE empty paragraph at the doc end
 * and re-appends it whenever it disappears. The table-spine guard wrapped that paragraph
 * into a row; TrailingNode appended a fresh one in the same appendTransaction round; the
 * guard wrapped again — an INFINITE ping-pong inside ProseMirror's applyTransaction that
 * pegged the main thread and killed the tab in every NON-COLLAB project on its first
 * doc-changing transaction (collab was immune only because the guard is gated off there).
 *
 * The fix: wrapBareTopLevelNodes exempts a single EMPTY trailing paragraph (the trailing
 * plugin's contract); the moment it carries content it wraps like everything else.
 *
 * This suite drives the REAL shipped plugins — tableSpineGuardPlugin + the REAL TrailingNode
 * from @tiptap/extensions — through PM's REAL applyTransaction protocol (the loop arena).
 * No DOM, no view: appendTransaction runs headless. A watchdog isn't needed — before the fix
 * this test simply never terminates, which run-tests.mjs reports as a hang/timeout.
 *
 * Run: bun src/extensions/spine-guard-trailing.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { TrailingNode } from '@tiptap/extensions';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES, tableSpineGuardPlugin, wrapBareTopLevelNodes } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { setEpisode } from '../episode-config.js';

// Non-collab library-project shape — the configuration that froze live.
setEpisode({ id: 'freeze-lock-test', features: {}, storage: {} });

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  ...BURMA_TABLE_NODES, ...BURMA_NODES, ...BURMA_MARKS,
]);

const row = (text) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  }],
});
const mkDoc = (...content) => PMNode.fromJSON(schema, { type: 'doc', content });

// The REAL TrailingNode ProseMirror plugin, extracted the way tiptap composes it.
function trailingNodePlugin() {
  const ext = TrailingNode.configure();
  const plugins = ext.config.addProseMirrorPlugins.call({
    editor: { schema, options: {} },
    options: { ...TrailingNode.options, node: 'paragraph', notAfter: [] },
    type: undefined,
    name: 'trailingNode',
    storage: {},
  });
  assert.equal(plugins.length, 1, 'TrailingNode contributes exactly one plugin');
  return plugins[0];
}

ok('fixpoint: an all-rows doc with an empty trailing paragraph gets NO wrap (guard yields)', () => {
  const state = EditorState.create({ schema, doc: mkDoc(row('first'), { type: 'paragraph' }) });
  assert.equal(wrapBareTopLevelNodes(state), null, 'empty trailing paragraph is the trailing plugin\'s turf');
});

ok('a CONTENTFUL trailing paragraph still wraps into the spine (no work escapes the rack)', () => {
  const state = EditorState.create({ schema, doc: mkDoc(row('first'), { type: 'paragraph', content: [{ type: 'text', text: 'typed below' }] }) });
  const tr = wrapBareTopLevelNodes(state);
  assert.ok(tr, 'contentful bare paragraph must be wrapped');
  const next = state.apply(tr);
  assert.equal(next.doc.lastChild.type.name, 'tableRow');
  assert.ok(next.doc.textContent.includes('typed below'));
});

ok('a bare paragraph in the MIDDLE still wraps (the exemption is trailing-only)', () => {
  const state = EditorState.create({
    schema,
    doc: mkDoc(row('first'), { type: 'paragraph' }, row('last')),
  });
  const tr = wrapBareTopLevelNodes(state);
  assert.ok(tr, 'middle bare paragraph is not exempt even when empty');
});

ok('THE LOOP ARENA: real spine guard + real TrailingNode converge through applyTransaction', () => {
  // Before the fix this line never returns: guard wraps the trailing paragraph, TrailingNode
  // re-appends it, forever. PM's applyTransaction runs the full appendTransaction protocol.
  const state = EditorState.create({
    schema,
    doc: mkDoc(row('the junta counts its peoples'), row('')),
    plugins: [tableSpineGuardPlugin(), trailingNodePlugin()],
  });
  const { state: next } = state.applyTransaction(state.tr.insertText('x', 5));
  // Converged: content intact, spine intact, exactly one bare empty trailing paragraph.
  assert.ok(next.doc.textContent.includes('x'));
  const kids = [];
  next.doc.forEach((child) => kids.push(child.type.name));
  assert.ok(kids.slice(0, -1).every((k) => k === 'tableRow'), 'all real content lives in rows');
  assert.equal(kids[kids.length - 1], 'paragraph', 'TrailingNode keeps its one empty paragraph');
  // And a SECOND edit stays convergent (steady state, not a one-round fluke).
  const { state: again } = next.applyTransaction(next.tr.insertText('y', 6));
  assert.ok(again.doc.textContent.includes('y'));
});

console.log('spine-guard-trailing: ' + pass + '/4 passed');
