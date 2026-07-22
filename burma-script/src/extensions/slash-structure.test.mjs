/*
 * slash-structure.test.mjs — the /chapter + /scene slash commands' insert transaction
 * (slash-menu.js doInsertStructureBlock). These are the menu's only BLOCK-LEVEL commands:
 * unlike the inline directionMark kinds they insert a real chapterBlock / sceneBlock,
 * wrapped exactly like document-builder's fullWidthRow, so the result must round-trip the
 * migrate-doc mirror schema + docToBlocks with zero loss.
 *
 * Proves:
 *   1. /chapter — the trigger text is deleted and a fresh EMPTY chapterBlock arrives below
 *      the host row as tableRow(cols:1) > tableCell(role:full) > chapterBlock > paragraph,
 *      with the default genre 'other' (renders as an untagged book-header) and a minted
 *      blockId; the wrapping row carries a pairu_ pairId (Palau's empty-row culler keeps it).
 *   2. /scene — same shape with sceneBlock (no genre attr).
 *   3. ONE TRANSACTION / UNDO — trigger delete + insert land in a single history step; one
 *      undo restores the original doc byte-exact.
 *   4. CURSOR — the selection lands inside the new block's title paragraph.
 *   5. MIRROR SCHEMA + docToBlocks — the post-insert doc passes PMNode.check() against the
 *      exact schema migrate-doc's save gate enforces, round-trips fromJSON→toJSON byte-exact,
 *      and docToBlocks flattens the new node to { type:'chapter', genre:'other' } / 'scene'.
 *   6. EMPTY-HOST REPLACE — typing the trigger on an otherwise-empty line REPLACES that row
 *      instead of stranding an empty block above the new chapter.
 *   7. NESTED DEPTH — inside Palau's nested-row shape (tableRow > tableCell > tableRow) the
 *      new row arrives as a SIBLING of the nested host row, in the same cell (add-rows law).
 *
 * Run: bun src/extensions/slash-structure.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { doInsertStructureBlock, DEFAULT_CHAPTER_GENRE } from './slash-menu.js';
import { buildDecorations } from './chapter-frames.js';
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

// The EXACT schema the live editor + migrate-doc's save gate enforce (see migrate-doc.js
// buildSchema) — the inserted node must be valid here or the autosave read-back gate fires.
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
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});

// Find the "/xxx" trigger text inside the doc and return its {from, to} range — the same
// range the Suggestion plugin hands the item's run().
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

// ── 1+3+4+5: /chapter below a row that keeps its own words ─────────────────────────────────
ok('/chapter inserts an empty chapter row below; trigger removed; undo restores; round-trips', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'Opening narration /chapter')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/chapter');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doInsertStructureBlock(state, dispatch, range, 'chapterBlock'), true, 'insert returns true');

  // Structure: host row keeps its (trigger-stripped) words, chapter row sits below.
  assert.equal(state.doc.childCount, 2, 'doc has host row + chapter row');
  assert.equal(state.doc.child(0).textContent.trim(), 'Opening narration', 'trigger text removed, host words kept');
  const newRow = state.doc.child(1);
  assert.equal(newRow.type.name, 'tableRow');
  assert.equal(newRow.attrs.cols, 1, 'full-width row (fullWidthRow shape)');
  assert.ok(typeof newRow.attrs.pairId === 'string' && newRow.attrs.pairId.startsWith('pairu_'),
    'row carries the user-added pairu_ marker so the Palau culler keeps it while still empty');
  const cell = newRow.child(0);
  assert.equal(cell.type.name, 'tableCell');
  assert.equal(cell.attrs.role, 'full');
  const chapter = cell.child(0);
  assert.equal(chapter.type.name, 'chapterBlock');
  assert.equal(chapter.attrs.genre, DEFAULT_CHAPTER_GENRE, 'fresh chapter is born genre:other (untagged act)');
  assert.equal(DEFAULT_CHAPTER_GENRE, 'other');
  assert.ok(chapter.attrs.blockId, 'blockId minted');
  assert.equal(chapter.childCount, 1);
  assert.equal(chapter.child(0).type.name, 'paragraph');
  assert.equal(chapter.child(0).content.size, 0, 'chapter body = one empty title paragraph');

  // Cursor: inside the new chapter's title paragraph.
  const $from = state.selection.$from;
  let inChapter = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'chapterBlock') inChapter = true;
  assert.ok(inChapter, 'selection sits in the new chapter title');

  // Mirror-schema round-trip: fromJSON → check() → toJSON byte-exact (the save-gate law).
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror schema round-trip byte-exact');

  // docToBlocks: the new node flattens to a chapter block (derived export view).
  const blocks = docToBlocks(state.doc.toJSON());
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'vo');
  assert.equal(blocks[1].type, 'chapter');
  assert.equal(blocks[1].genre, 'other');
  assert.equal(blocks[1].id, chapter.attrs.blockId, 'blockId survives the flatten');

  // ONE undo removes trigger-delete + insert together and restores the doc byte-exact.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'single undo restores the original doc');
});

// ── /section — the Image-11 full header: chapterBlock born with title + subtitle slots ──────
ok('/section inserts a chapter row with TWO paragraphs (title + subtitle); undo restores; round-trips', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'Arriving in Yangon /section')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/section');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doInsertStructureBlock(state, dispatch, range, 'chapterBlock', { withSubtitle: true }), true);
  assert.equal(state.doc.childCount, 2, 'doc has host row + section row');
  assert.equal(state.doc.child(0).textContent.trim(), 'Arriving in Yangon', 'trigger text removed');
  const section = state.doc.child(1).child(0).child(0);
  assert.equal(section.type.name, 'chapterBlock', '/section IS a chapterBlock (frames doctrine styles it)');
  assert.equal(section.attrs.genre, DEFAULT_CHAPTER_GENRE, 'born untagged; reclassifies from the typed title');
  assert.ok(section.attrs.blockId, 'blockId minted');
  assert.equal(section.childCount, 2, 'TWO slots: big serif title + italic subtitle');
  assert.equal(section.child(0).type.name, 'paragraph');
  assert.equal(section.child(0).content.size, 0, 'empty title slot');
  assert.equal(section.child(1).type.name, 'paragraph');
  assert.equal(section.child(1).content.size, 0, 'empty subtitle slot');

  // Cursor lands in the title (first) paragraph, not the subtitle.
  const $from = state.selection.$from;
  let inChapter = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'chapterBlock') inChapter = true;
  assert.ok(inChapter, 'selection sits in the new section header');

  // Mirror-schema round-trip (the save-gate law) + docToBlocks flatten.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror schema round-trip byte-exact');
  const blocks = docToBlocks(state.doc.toJSON());
  assert.equal(blocks[1].type, 'chapter');

  // ONE undo removes trigger-delete + insert together.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'single undo restores the original doc');
});

// ── 2: /scene — same law, sceneBlock shape ──────────────────────────────────────────────────
ok('/scene inserts an empty scene row below; trigger removed; undo restores; round-trips', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'Walking the market /scene')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/scene');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doInsertStructureBlock(state, dispatch, range, 'sceneBlock'), true);
  assert.equal(state.doc.childCount, 2);
  assert.equal(state.doc.child(0).textContent.trim(), 'Walking the market', 'trigger text removed');
  const scene = state.doc.child(1).child(0).child(0);
  assert.equal(scene.type.name, 'sceneBlock');
  assert.ok(scene.attrs.blockId, 'blockId minted');
  assert.equal(scene.child(0).type.name, 'paragraph');
  assert.equal(scene.child(0).content.size, 0, 'scene body = one empty title paragraph');

  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()));

  const blocks = docToBlocks(state.doc.toJSON());
  assert.equal(blocks[1].type, 'scene');

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'single undo restores the original doc');
});

// ── 6: EMPTY-HOST REPLACE — trigger on an otherwise-empty line replaces the row ────────────
ok('typing the trigger on an empty line replaces that row (no stray empty block left above)', () => {
  const docJson = {
    type: 'doc',
    content: [row([vo('vo_1', 'Real words stay')]), row([none('none_1', '/chapter')])],
  };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/chapter');
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doInsertStructureBlock(state, dispatch, range, 'chapterBlock'), true);
  assert.equal(state.doc.childCount, 2, 'still two rows — the empty host row was REPLACED');
  assert.equal(state.doc.child(0).textContent.trim(), 'Real words stay');
  const chapter = state.doc.child(1).child(0).child(0);
  assert.equal(chapter.type.name, 'chapterBlock', 'empty host row became the chapter row');
  assert.equal(chapter.attrs.genre, 'other');

  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'single undo restores the empty host line');
});

// ── 7: NESTED DEPTH — structure inserts surface at the TOP level ────────────────────────────
// (LAW REVERSED 2026-07-07, Johnny's frameless-chapter bug: chapters/scenes are top-level
// structure — the chapter-frames decorator and the outline walk ONLY top-level rows, so a
// chapter born nested rendered as a frameless orphan cartridge. From a nested cursor the new
// row now lands as a sibling of the OUTERMOST row.)
ok('from inside a nested row the new structure row surfaces at the doc top level', () => {
  const nested = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [row([vo('vo_n', 'nested narration /scene')])],
      }],
    }],
  };
  let state = makeState(nested, 6);
  const range = triggerRange(state.doc, '/scene');
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(doInsertStructureBlock(state, dispatch, range, 'sceneBlock'), true);
  assert.equal(state.doc.childCount, 2, 'new row is a TOP-LEVEL sibling of the outermost row');
  assert.equal(state.doc.child(0).textContent.trim(), 'nested narration', 'trigger removed from nested host');
  const newRow = state.doc.child(1);
  assert.equal(newRow.type.name, 'tableRow');
  assert.equal(newRow.child(0).attrs.role, 'full');
  assert.equal(newRow.child(0).child(0).type.name, 'sceneBlock');

  // The result is still schema-valid + byte-exact through the mirror schema.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()));
});

// ── 8: FRESH /chapter GETS ITS FRAME — the buildDecorations contract ────────────────────────
// The frameless-chapter bug's second half: prove an untitled genre:'other' chapter row IS
// decorated wp-chframe + wp-chframe-first the moment it exists at the top level.
ok('a fresh untitled /chapter row receives the chapter-frame decorations', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'words /chapter')])] };
  let state = makeState(docJson, 4);
  const range = triggerRange(state.doc, '/chapter');
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(doInsertStructureBlock(state, dispatch, range, 'chapterBlock'), true);

  const decos = buildDecorations(state.doc);
  const found = decos.find();
  const chapterRowPos = state.doc.child(0).nodeSize; // second top-level row
  const onChapterRow = found.filter((d) => d.from === chapterRowPos);
  assert.ok(onChapterRow.length, 'the new chapter row carries a node decoration');
  const cls = (onChapterRow[0].type && onChapterRow[0].type.attrs && onChapterRow[0].type.attrs.class) || '';
  assert.ok(cls.includes('wp-chframe'), `frame class present (got "${cls}")`);
  assert.ok(cls.includes('wp-chframe-first'), 'the chapter row opens the frame (first)');
});

console.log(`slash-structure.test.mjs: ${pass} assertions passed`);
