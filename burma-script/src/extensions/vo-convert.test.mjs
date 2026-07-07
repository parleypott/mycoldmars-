/*
 * vo-convert.test.mjs — the /vo slash command's conversion transaction
 * (slash-menu.js doConvertBlockToVo). Unlike the structure inserts, /vo RETYPES the
 * block the cursor lives in to voBlock — the writer's words stay put, the block picks
 * up the VO corner tag. Data-loss law: only the plain prose carts convert (VO_CONVERTIBLE);
 * structure / producer-data blocks are left untouched, but the "/vo" trigger text is
 * ALWAYS removed so it can never land in the script.
 *
 * Proves:
 *   1. /vo on a noneBlock host — trigger deleted, block retypes to voBlock, words kept,
 *      blockId preserved, status born 'todo'.
 *   2. ONE TRANSACTION / UNDO — delete + retype in a single history step; one undo
 *      restores the original doc byte-exact.
 *   3. MIRROR SCHEMA + docToBlocks — the converted doc passes PMNode.check() against the
 *      save-gate schema, round-trips fromJSON→toJSON byte-exact, and docToBlocks flattens
 *      the block to { type:'vo', voStatus:'todo' } with the words intact.
 *   4. NON-CONVERTIBLE HOST (chapter) — the chapter keeps its type; the trigger text is
 *      still removed.
 *   5. ALREADY-VO HOST — no-op conversion: block stays voBlock with its attrs untouched,
 *      trigger removed.
 *   6. A pre-id block (blockId null) gets a blockId minted on conversion.
 *
 * Run: bun src/extensions/vo-convert.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doConvertBlockToVo, VO_CONVERTIBLE } from './slash-menu.js';
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
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const chapter = (id, title) => ({
  type: 'chapterBlock', attrs: { blockId: id, genre: 'other' },
  content: [{ type: 'paragraph', content: title ? [{ type: 'text', text: title }] : [] }],
});

function triggerRange(doc, trigger) {
  let range = null;
  doc.descendants((node, pos) => {
    if (range || !node.isText) return;
    const at = node.text.indexOf(trigger);
    if (at >= 0) range = { from: pos + at, to: pos + at + trigger.length };
  });
  if (!range) throw new Error(`trigger ${trigger} not found in doc`);
  return range;
}

function makeState(docJson, cursorAt) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc, plugins: [history()],
    selection: TextSelection.near(doc.resolve(cursorAt), 1),
  });
}

// ── 1+2+3: /vo on a noneBlock — retype, keep words, undo restores, round-trips ────────────
ok('/vo retypes a noneBlock to voBlock; trigger removed; words + blockId kept; undo restores', () => {
  const docJson = { type: 'doc', content: [row([none('blk_a', 'Long before there was a Burma /vo')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/vo');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doConvertBlockToVo(state, dispatch, range), true, 'convert returns true');

  const block = state.doc.child(0).child(0).child(0);
  assert.equal(block.type.name, 'voBlock', 'host retyped to voBlock');
  assert.equal(block.attrs.blockId, 'blk_a', 'blockId preserved (autosave/recovery key stable)');
  assert.equal(block.attrs.status, 'todo', 'VO born unrecorded');
  assert.equal(block.textContent.trim(), 'Long before there was a Burma', 'trigger removed, words kept');

  // Mirror-schema round-trip (the save-gate law) + blocks export.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');
  const blocks = docToBlocks(state.doc.toJSON());
  const voOut = blocks.find((b) => b.type === 'vo');
  assert.ok(voOut, 'docToBlocks exports the block as type:vo');
  assert.equal(voOut.voStatus, 'todo');
  assert.ok(voOut.text.includes('Long before there was a Burma'), 'words survive the export');

  // ONE undo restores the pre-/vo doc byte-exact (delete + retype = one history step).
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo restores the original doc');
});

// ── 4: non-convertible host — chapter keeps its type, trigger still removed ───────────────
ok('/vo inside a chapter leaves the chapter alone but still removes the trigger', () => {
  const docJson = { type: 'doc', content: [row([chapter('blk_ch', 'GROUND 1 /vo')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/vo');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doConvertBlockToVo(state, dispatch, range), true);
  const block = state.doc.child(0).child(0).child(0);
  assert.equal(block.type.name, 'chapterBlock', 'chapter NOT retyped');
  assert.equal(block.textContent.trim(), 'GROUND 1', 'trigger text removed anyway');
});

// ── 5: already-VO host — no-op conversion, attrs untouched ────────────────────────────────
ok('/vo inside a voBlock is a no-op conversion (attrs untouched, trigger removed)', () => {
  const docJson = { type: 'doc', content: [row([{ ...vo('blk_v', 'Narration line /vo'), attrs: { blockId: 'blk_v', status: 'recorded' } }])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/vo');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doConvertBlockToVo(state, dispatch, range), true);
  const block = state.doc.child(0).child(0).child(0);
  assert.equal(block.type.name, 'voBlock');
  assert.equal(block.attrs.status, 'recorded', 'existing REC state untouched');
  assert.equal(block.textContent.trim(), 'Narration line');
});

// ── 6: blockId minted for a pre-id host ────────────────────────────────────────────────────
ok('/vo mints a blockId when the host has none', () => {
  const docJson = { type: 'doc', content: [row([{ type: 'noneBlock', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'words /vo' }] }] }])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/vo');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doConvertBlockToVo(state, dispatch, range), true);
  const block = state.doc.child(0).child(0).child(0);
  assert.equal(block.type.name, 'voBlock');
  assert.ok(typeof block.attrs.blockId === 'string' && block.attrs.blockId.startsWith('blk_'), 'blockId minted');
});

// ── guard: the convertible set stays the tight prose-cart list ─────────────────────────────
ok('VO_CONVERTIBLE is the tight prose-cart set (no structure / producer-data blocks)', () => {
  assert.deepEqual(VO_CONVERTIBLE, ['noneBlock', 'binBlock', 'oncamBlock', 'montageBlock']);
});

console.log(`vo-convert.test.mjs: ${pass} assertions passed`);
