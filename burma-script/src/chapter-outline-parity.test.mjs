/*
 * chapter-outline-parity.test.mjs — the OUTLINE (telemetry) and the REORDER ENGINE (walkChapters)
 * must agree on exactly WHICH rows are chapters. If they diverge, the modular outline can show a
 * draggable "phantom" chapter the engine cannot move (indexOf → -1 → dead drag) and canReorder can
 * miscount (enable modular mode with only one REAL chapter). This suite pins the parity so the two
 * definitions can never drift again.
 *
 * A row opens a CHAPTER only when a chapterBlock is that top-level row's FIRST OWN block — the first
 * block of its first cell, and never a nested-Palau tableRow wrapper. A chapterBlock buried mid-cell
 * or sitting in a split row's SHOWN (second) cell is NOT a chapter. This test builds a doc that puts
 * a chapterBlock in every "phantom" position and asserts:
 *   1. telemetry().outline level-0 chapter set  ==  walkChapters().chapters firstBlockId set  ==  the
 *      real first-own chapters only (phantoms excluded from both).
 *   2. telemetry runs on the plain JSON doc; walkChapters on the parsed PM node — the SAME source
 *      doc, so this proves the two representations classify chapters identically.
 *   3. LOSSLESS: moving the real chapter whose row-range physically contains the phantom rows carries
 *      the phantoms inside it (pure permutation — blockId multiset unchanged, phantom ids preserved).
 *
 * Run: bun src/chapter-outline-parity.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { walkChapters, collectBlockIds, moveChapter } from './extensions/chapter-reorder.js';
import { telemetry } from './Editor.jsx';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

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

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const chapter = (id, text) => ({ type: 'chapterBlock', attrs: { blockId: id, genre: 'other' }, content: [para(text)] });
const vo = (id, text) => ({ type: 'voBlock', attrs: { blockId: id, status: 'todo' }, content: [para(text)] });
const none = (id, text) => ({ type: 'noneBlock', attrs: { blockId: id }, content: [para(text)] });

// A full-width row holding an arbitrary list of blocks in one cell.
const row = (blocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
// A split (cols:2) row: said cell + shown cell.
const pairedRow = (pairId, saidBlocks, shownBlocks) => ({
  type: 'tableRow', attrs: { cols: 2, pairId, bookmarkId: null },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});

// A doc with two REAL chapters (A, B) and a chapterBlock in every phantom position between them.
// All phantom rows fall inside chapter A's range (A heading → B heading), so they ride with A.
const phantomDocJson = () => ({ type: 'doc', content: [
  // FRONT MATTER
  row([none('fm1', 'front matter')]),
  // CHAPTER A (real — chapterBlock is the row's first own block)
  row([chapter('chA', 'Chapter A')]),
  row([vo('a1', 'a body row')]),
  // PHANTOM 1: chapterBlock as the SECOND block in a full cell (not first-own).
  row([vo('p1lead', 'lead block'), chapter('phantomMid', 'Phantom Mid-Cell')]),
  // PHANTOM 2: chapterBlock inside a split row's SHOWN (second) cell (said cell opens with a vo).
  pairedRow('pair_ph', [vo('p2said', 'said side')], [chapter('phantomShown', 'Phantom Shown Cell')]),
  // PHANTOM 3: a nested-Palau wrapper row (first-own block is a nested tableRow → never a chapter).
  { type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [
      pairedRow('pair_nest', [vo('n_said', 'nested said')], [none('n_shown', 'nested shown')]),
    ] }] },
  // CHAPTER B (real)
  row([chapter('chB', 'Chapter B')]),
  row([vo('b1', 'b body row')]),
] });

const REAL_CHAPTER_IDS = ['chA', 'chB'];
const PHANTOM_IDS = ['phantomMid', 'phantomShown'];

// ── 1: telemetry level-0 chapters == walkChapters chapters == the real chapters only ──────────────
ok('telemetry outline and walkChapters agree on the chapter set (phantoms excluded)', () => {
  const json = phantomDocJson();
  const pmDoc = PMNode.fromJSON(schema, json);
  pmDoc.check();

  const tel = telemetry(json);
  const telLevel0 = tel.outline.filter((o) => o.level === 0).map((o) => o.id);
  const engineIds = walkChapters(pmDoc).chapters.map((c) => c.firstBlockId);

  assert.deepEqual(engineIds, REAL_CHAPTER_IDS, 'walkChapters sees exactly the real chapters');
  assert.deepEqual(telLevel0, REAL_CHAPTER_IDS, 'telemetry lists exactly the real chapters at level 0');
  assert.deepEqual(telLevel0, engineIds, 'outline ⇔ engine chapter-set parity');

  // No phantom ever appears as a draggable level-0 chapter.
  for (const p of PHANTOM_IDS) {
    assert.ok(!telLevel0.includes(p), `phantom ${p} is not a level-0 outline chapter`);
  }
  // Ordinals are contiguous and match the engine order (01, 02) — not inflated by phantoms.
  const ords = tel.outline.filter((o) => o.level === 0).map((o) => o.ord);
  assert.deepEqual(ords, ['01', '02'], 'chapter ordinals count only real chapters');

  // canReorder is "> 1 real chapter" — the phantoms must not push a 1-chapter doc into modular mode.
  assert.equal(telLevel0.length, engineIds.length, 'canReorder count matches the engine');
});

// ── 2: the phantom chapterBlocks still exist as CONTENT — they are only reclassified, never dropped ─
ok('phantom chapterBlocks remain in the doc as content (reclassified, not deleted)', () => {
  const pmDoc = PMNode.fromJSON(schema, phantomDocJson());
  const ids = collectBlockIds(pmDoc);
  for (const p of PHANTOM_IDS) assert.ok(ids.includes(p), `phantom block ${p} still present in doc`);
});

// ── 3: LOSSLESS — moving chapter A carries every phantom row inside it, pure permutation ───────────
ok('moving the host chapter carries its phantom rows losslessly (one permutation)', () => {
  const json = phantomDocJson();
  let state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, json), plugins: [history()] });
  const before = clone(state.doc.toJSON());
  const idsBefore = collectBlockIds(state.doc);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Chapter A (index 0) → after chapter B (index 1). array-move to bottom.
  assert.equal(moveChapter(state, dispatch, 0, 1), true, 'move A below B');
  assert.deepEqual(walkChapters(state.doc).chapters.map((c) => c.firstBlockId), ['chB', 'chA'], 'B now first');
  assert.equal(state.doc.childCount, before.content.length, 'top-level row count unchanged');
  assert.deepEqual(collectBlockIds(state.doc), idsBefore, 'blockId multiset unchanged (phantoms rode along)');
  for (const p of PHANTOM_IDS) assert.ok(collectBlockIds(state.doc).includes(p), `phantom ${p} survived the move`);

  // Mirror round-trip: reparse byte-exact (the save-gate law).
  const reparsed = PMNode.fromJSON(schema, state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');
});

// ── 4: collectBlockIds canonical order — explicit lexical comparator (finding-1 pin) ──────────────
ok('collectBlockIds returns a stable lexical-sorted multiset (explicit comparator, not bare sort)', () => {
  const pmDoc = PMNode.fromJSON(schema, phantomDocJson());
  const ids = collectBlockIds(pmDoc);
  const expected = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(ids, expected, 'ids are in canonical lexical order');
  // Two equal multisets in different document order compare equal element-wise (the invariant's basis).
  const shuffledJson = phantomDocJson();
  shuffledJson.content.reverse();
  const shuffled = collectBlockIds(PMNode.fromJSON(schema, shuffledJson));
  assert.deepEqual(shuffled, ids, 'canonical order is document-order-independent');
});

console.log(`chapter-outline-parity.test.mjs: ${pass} assertions passed`);
