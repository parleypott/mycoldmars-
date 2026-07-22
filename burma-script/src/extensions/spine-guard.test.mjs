/*
 * spine-guard.test.mjs — the live table-spine guard (table.js wrapBareTopLevelNodes).
 * Johnny: "if I arrow down from a row i can break the table and type here." The gapcursor
 * between rows minted BARE top-level paragraphs; the guard wraps them into full-width rows
 * on the very transaction that creates them.
 *
 * Proves:
 *   1. A bare top-level paragraph (the gap-typing artifact) is wrapped into
 *      tableRow(cols:1) > tableCell(role:full) — every word kept, pairu_ marker minted.
 *   2. An all-rows doc returns null (the appendTransaction loop terminates).
 *   3. Multiple strays (including mid-doc) all wrap in ONE transaction; row order holds.
 *   4. The wrapped doc passes the mirror save-gate schema.
 *
 * Run: bun src/extensions/spine-guard.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { wrapBareTopLevelNodes } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
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
const barePara = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const mkState = (docJson) => EditorState.create({
  schema, doc: docFrom(docJson), selection: TextSelection.near(docFrom(docJson).resolve(0), 1),
});

// ── 1: the gap-typing artifact wraps ────────────────────────────────────────────────────────
ok('a bare top-level paragraph is wrapped into a full-width row (words kept)', () => {
  const state = mkState({ type: 'doc', content: [row('alpha'), barePara('HELLO I SHULDNT BE ABLE TO DO THIS'), row('beta')] });
  const tr = wrapBareTopLevelNodes(state);
  assert.ok(tr, 'guard produced a transaction');
  const doc = state.apply(tr).doc;
  assert.equal(doc.childCount, 3);
  for (let i = 0; i < 3; i++) assert.equal(doc.child(i).type.name, 'tableRow', `child ${i} is a row`);
  const wrapped = doc.child(1);
  assert.equal(wrapped.child(0).attrs.role, 'full');
  assert.equal(wrapped.textContent, 'HELLO I SHULDNT BE ABLE TO DO THIS', 'every word kept');
  assert.ok(String(wrapped.attrs.pairId || '').startsWith('pairu_'), 'keep-me marker minted');
  const reparsed = docFrom(doc.toJSON());
  reparsed.check();
});

// ── 2: clean doc → null (loop terminates) ──────────────────────────────────────────────────
ok('an all-rows doc returns null', () => {
  const state = mkState({ type: 'doc', content: [row('alpha'), row('beta')] });
  assert.equal(wrapBareTopLevelNodes(state), null);
});

// ── 3: multiple strays wrap in one transaction, order preserved ────────────────────────────
ok('multiple strays wrap in one transaction; order holds', () => {
  const state = mkState({ type: 'doc', content: [barePara('one'), row('mid'), barePara('two')] });
  const doc = state.apply(wrapBareTopLevelNodes(state)).doc;
  assert.equal(doc.childCount, 3);
  assert.deepEqual(
    [0, 1, 2].map((i) => doc.child(i).textContent),
    ['one', 'mid', 'two'],
    'order preserved',
  );
  for (let i = 0; i < 3; i++) assert.equal(doc.child(i).type.name, 'tableRow');
  // and the guard is now quiet
  const clean = EditorState.create({ schema, doc });
  assert.equal(wrapBareTopLevelNodes(clean), null, 'idempotent');
});

console.log(`spine-guard.test.mjs: ${pass} assertions passed`);
