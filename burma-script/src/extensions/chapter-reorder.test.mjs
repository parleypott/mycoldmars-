/*
 * chapter-reorder.test.mjs — the CHAPTER REORDER ("modular mode") transaction engine
 * (chapter-reorder.js moveChapter + walkChapters), the load-bearing data-integrity piece.
 *
 * WHY THIS SUITE EXISTS: reordering a whole chapter moves a RANGE of top-level rows, not one row.
 * The move MUST be a pure permutation of the EXISTING row nodes (cut the chapter's contiguous
 * range, re-insert the SAME node instances) so that NO block/pairId/blockId/nested-row can be lost
 * by construction, and ONE undo restores byte-exact. Burma+Palau sync over Liveblocks+Yjs, so a
 * lossy or multi-transaction reorder would corrupt every teammate's doc instantly.
 *
 * Proves:
 *   1. walkChapters reads chapters + front matter correctly (ordinals, ranges, firstBlockId).
 *   2. PERMUTATION LOSSLESS — every from→to combination (up, down, to-top, to-bottom, adjacent):
 *      blockId multiset unchanged, row count unchanged, front matter fixed, target ordering
 *      correct, docToBlocks round-trips, mirror check() + fromJSON→toJSON byte-exact.
 *   3. ONE TRANSACTION / UNDO — one undo restores the exact original doc JSON.
 *   4. NO-OP / EDGE — same position, out-of-range, single chapter, zero chapters → false, nothing
 *      dispatched.
 *   5. NESTED PALAU ROWS travel with their parent chapter; SPLIT rows keep cols/pairId.
 *   6. EMPTY chapter (heading row only) and FRONT MATTER present both handled.
 *   7. BOOKMARK/anchor (bookmarkId on a moved row, keyed by blockId) survives the move.
 *   8. assertReorderInvariant catches a tampered permutation.
 *
 * Run: bun src/extensions/chapter-reorder.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import {
  moveChapter, walkChapters, collectBlockIds, assertReorderInvariant, chapterIndexByBlockId,
} from './chapter-reorder.js';
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
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null, ...(attrs || {}) },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const pairedRow = (pairId, saidBlocks, shownBlocks, attrs) => ({
  type: 'tableRow', attrs: { cols: 2, pairId, bookmarkId: null, ...(attrs || {}) },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});
const chapter = (id, text, genre = 'other') => ({
  type: 'chapterBlock', attrs: { blockId: id, genre },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const sot = (id, text) => ({
  type: 'sotBlock',
  attrs: {
    blockId: id, timecode: '01:02:03:04', tcOut: '01:02:59:00', day: 2,
    ambiguous: false, speaker: 'U AUNG', done: true, rawTimecode: '01:02:03:04',
  },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const makeState = (docJson) => EditorState.create({
  schema, doc: docFrom(docJson), plugins: [history()],
});

// Chapter-start blockId order in the current doc (what a reorder permutes).
const chapterOrder = (doc) => walkChapters(doc).chapters.map((c) => c.firstBlockId);

// A canonical 3-chapter doc with front matter, one multi-row chapter, one split row, one empty
// chapter (heading only), and a nested Palau chapter — the full zoo in one fixture.
const zooDocJson = () => ({ type: 'doc', content: [
  // FRONT MATTER — two rows before any chapter; must never move.
  row([none('fm1', 'front matter one')]),
  row([none('fm2', 'front matter two')]),
  // CHAPTER 1 — heading + two body rows (one a SPLIT row).
  row([chapter('ch1', 'Chapter One')]),
  row([vo('c1a', 'narration a')]),
  pairedRow('pair_c1', [vo('c1s', 'said words')], [none('c1sh', 'shown words')]),
  // CHAPTER 2 — heading ONLY (empty chapter).
  row([chapter('ch2', 'Chapter Two')]),
  // CHAPTER 3 — heading + a nested-Palau wrapper row + a plain row.
  row([chapter('ch3', 'Chapter Three')]),
  { type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [
      pairedRow('pair_n', [sot('c3ns', 'nested said')], [none('c3nn', 'nested shown')]),
    ] }] },
  row([sot('c3a', 'the minister answers')]),
] });

// ── 1: walkChapters ───────────────────────────────────────────────────────────────────────────
ok('walkChapters reads chapters, ranges, ordinals, front matter', () => {
  const doc = docFrom(zooDocJson());
  const { chapters, frontMatterCount, rowCount } = walkChapters(doc);
  assert.equal(rowCount, 9, 'nine top-level rows');
  assert.equal(frontMatterCount, 2, 'two front-matter rows before chapter 1');
  assert.equal(chapters.length, 3, 'three chapters');
  assert.deepEqual(chapters.map((c) => c.firstBlockId), ['ch1', 'ch2', 'ch3']);
  assert.deepEqual(chapters.map((c) => c.ordinal), ['01', '02', '03']);
  assert.deepEqual(chapters.map((c) => c.title), ['Chapter One', 'Chapter Two', 'Chapter Three']);
  // Ranges: ch1 rows [2,5), ch2 [5,6) (empty — heading only), ch3 [6,9).
  assert.deepEqual(chapters.map((c) => [c.startIndex, c.endIndex]), [[2, 5], [5, 6], [6, 9]]);
  assert.deepEqual(chapters.map((c) => c.rowCount), [3, 1, 3]);
  assert.equal(chapterIndexByBlockId(doc, 'ch3'), 2, 'blockId→index resolves');
  assert.equal(chapterIndexByBlockId(doc, 'nope'), -1, 'unknown blockId → -1');
});

// ── 2+3: every from→to permutation is lossless, mirror-checked, one-undo byte-exact ─────────────
// Runs a move on a FRESH state each time and asserts the full integrity contract.
function checkMove(fromIdx, toIdx, expectedOrder) {
  const docJson = zooDocJson();
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const blocksBefore = docToBlocks(before);
  const idsBefore = collectBlockIds(state.doc);
  const { frontMatterCount } = walkChapters(state.doc);
  const dispatch = (tr) => { state = state.apply(tr); };

  assert.equal(moveChapter(state, dispatch, fromIdx, toIdx), true, `move ${fromIdx}→${toIdx} returns true`);

  // Chapter ordering is exactly the array-move result.
  assert.deepEqual(chapterOrder(state.doc), expectedOrder, `order after ${fromIdx}→${toIdx}`);
  // Row count + blockId multiset unchanged (pure permutation).
  assert.equal(state.doc.childCount, 9, 'row count unchanged');
  assert.deepEqual(collectBlockIds(state.doc), idsBefore, 'blockId multiset unchanged');
  // Front matter unmoved, byte-identical.
  for (let i = 0; i < frontMatterCount; i++) {
    assert.ok(docFrom(before).child(i).eq(state.doc.child(i)), `front-matter row ${i} unmoved`);
  }
  // docToBlocks: same blocks, each byte-equal (only order changed).
  const blocksAfter = docToBlocks(state.doc.toJSON());
  const byId = (bs) => Object.fromEntries(bs.map((b) => [b.id, b]));
  assert.deepEqual(byId(blocksAfter), byId(blocksBefore), 'each block byte-equal before/after');
  // Mirror round-trip (the save-gate law).
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');
  // ONE undo restores byte-exact.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, `one undo restores original (${fromIdx}→${toIdx})`);
}

ok('every from→to permutation is lossless + one-undo byte-exact', () => {
  // 3 chapters [ch1,ch2,ch3]. array-move expected orderings:
  checkMove(0, 1, ['ch2', 'ch1', 'ch3']); // ch1 down one (adjacent)
  checkMove(0, 2, ['ch2', 'ch3', 'ch1']); // ch1 to bottom
  checkMove(1, 0, ['ch2', 'ch1', 'ch3']); // ch2 to top
  checkMove(1, 2, ['ch1', 'ch3', 'ch2']); // ch2 to bottom
  checkMove(2, 0, ['ch3', 'ch1', 'ch2']); // ch3 to top
  checkMove(2, 1, ['ch1', 'ch3', 'ch2']); // ch3 up one (adjacent)
});

// The nested Palau wrapper row and the split row travel INSIDE their chapter, byte-identical.
ok('nested Palau row + split row travel with their chapter, byte-exact', () => {
  const docJson = zooDocJson();
  let state = makeState(docJson);
  // Capture chapter 3's nested wrapper row (index 7) and chapter 1's split row (index 4) before.
  const nestedBefore = clone(state.doc.child(7).toJSON());
  const splitBefore = clone(state.doc.child(4).toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  // Move ch3 to the top → [ch3, ch1, ch2].
  assert.equal(moveChapter(state, dispatch, 2, 0), true);
  assert.deepEqual(chapterOrder(state.doc), ['ch3', 'ch1', 'ch2']);
  // ch3 now starts at index 2 (after 2 front-matter rows): heading, nested wrapper, plain row.
  const nestedAfter = clone(state.doc.child(3).toJSON());
  assert.deepEqual(nestedAfter, nestedBefore, 'nested Palau wrapper row byte-identical after move');
  assert.equal(state.doc.child(3).child(0).child(0).type.name, 'tableRow', 'nested row still nested inside its cell');
  // The split row rode inside ch1, still cols:2 + pairId.
  const { chapters } = walkChapters(state.doc);
  const c1 = chapters.find((c) => c.firstBlockId === 'ch1');
  const splitRow = state.doc.child(c1.startIndex + 2);
  assert.deepEqual(clone(splitRow.toJSON()), splitBefore, 'split row byte-identical, cols/pairId intact');
});

// ── 4: no-op / edge cases dispatch NOTHING ──────────────────────────────────────────────────────
ok('no-op + out-of-range + single/zero chapter dispatch nothing', () => {
  let state = makeState(zooDocJson());
  let dispatched = 0;
  const dispatch = () => { dispatched++; };
  assert.equal(moveChapter(state, dispatch, 1, 1), false, 'same index → no-op');
  assert.equal(moveChapter(state, dispatch, 0, 9), false, 'to out of range → refused');
  assert.equal(moveChapter(state, dispatch, 5, 0), false, 'from out of range → refused');
  assert.equal(moveChapter(state, dispatch, -1, 0), false, 'negative from → refused');
  assert.equal(moveChapter(state, dispatch, 0, 1.5), false, 'non-integer → refused');
  assert.equal(dispatched, 0, 'nothing dispatched for any refused/no-op move');

  // Single chapter → nothing to reorder.
  const single = makeState({ type: 'doc', content: [
    row([chapter('only', 'Solo')]), row([vo('b', 'body')]),
  ] });
  assert.equal(moveChapter(single, dispatch, 0, 0), false, 'single chapter → false');
  assert.equal(walkChapters(single.doc).chapters.length, 1);

  // Zero chapters (front matter only) → no chapters, disabled.
  const zero = makeState({ type: 'doc', content: [row([none('x', 'no chapters here')])] });
  const wz = walkChapters(zero.doc);
  assert.equal(wz.chapters.length, 0, 'zero chapters');
  assert.equal(wz.frontMatterCount, 1, 'every row is front matter when there are no chapters');
  assert.equal(moveChapter(zero, dispatch, 0, 1), false, 'zero chapters → false');
  assert.equal(dispatched, 0, 'still nothing dispatched');
});

// ── 5: no front matter (chapter 0 at row 0) still works ──────────────────────────────────────────
ok('chapters with no front matter reorder correctly', () => {
  const docJson = { type: 'doc', content: [
    row([chapter('a', 'A')]), row([vo('ab', 'a body')]),
    row([chapter('b', 'B')]), row([vo('bb', 'b body')]),
    row([chapter('c', 'C')]),
  ] };
  let state = makeState(docJson);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(walkChapters(state.doc).frontMatterCount, 0, 'no front matter');
  assert.equal(moveChapter(state, dispatch, 2, 0), true);
  assert.deepEqual(chapterOrder(state.doc), ['c', 'a', 'b']);
  assert.deepEqual(docToBlocks(state.doc.toJSON()).map((b) => b.id), ['c', 'a', 'ab', 'b', 'bb']);
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'undo restores');
});

// ── 6: empty chapter (heading only) moves as one row ─────────────────────────────────────────────
ok('an empty chapter (heading row only) moves cleanly', () => {
  let state = makeState(zooDocJson());
  const dispatch = (tr) => { state = state.apply(tr); };
  // ch2 is empty (heading only). Move it to the top.
  assert.equal(moveChapter(state, dispatch, 1, 0), true);
  assert.deepEqual(chapterOrder(state.doc), ['ch2', 'ch1', 'ch3']);
  // ch2 is one row, now the first chapter row (after front matter, index 2).
  const { chapters } = walkChapters(state.doc);
  assert.equal(chapters[0].rowCount, 1, 'moved empty chapter still one row');
  assert.equal(chapters[0].startIndex, 2, 'sits right after front matter');
});

// ── 7: bookmark/anchor on a moved row survives (keyed by blockId) ────────────────────────────────
ok('a bookmarked row survives a chapter move (bookmarkId + blockId preserved)', () => {
  const docJson = zooDocJson();
  // Put a bookmark on chapter 3's plain SOT row (last row).
  docJson.content[8].attrs.bookmarkId = 'bm_deep_1';
  let state = makeState(docJson);
  const dispatch = (tr) => { state = state.apply(tr); };
  assert.equal(moveChapter(state, dispatch, 2, 0), true, 'move ch3 to top');
  // Find the row carrying blockId c3a anywhere in the doc; its bookmarkId must still be there.
  let found = null;
  state.doc.descendants((node) => {
    if (node.type.name === 'tableRow' && node.attrs?.bookmarkId === 'bm_deep_1') found = node;
    return true;
  });
  assert.ok(found, 'bookmarked row still present with its bookmarkId');
  // And the SOT block it anchors (c3a) still resolves by blockId.
  assert.ok(collectBlockIds(state.doc).includes('c3a'), 'anchored blockId c3a still resolves post-move');
});

// ── 8: assertReorderInvariant catches a tampered permutation ─────────────────────────────────────
ok('assertReorderInvariant throws on a non-permutation', () => {
  const good = docFrom(zooDocJson());
  // A doc missing one block is NOT a permutation.
  const tamperedJson = zooDocJson();
  tamperedJson.content.splice(3, 1);           // drop a body row (loses blockId c1a)
  const tampered = docFrom(tamperedJson);
  assert.throws(() => assertReorderInvariant(good, tampered, 2), /multiset changed|row count changed/);
  // A genuine permutation (built via moveChapter) passes the invariant.
  let s2 = makeState(zooDocJson());
  const b2 = s2.doc;
  moveChapter(s2, (tr) => { s2 = s2.apply(tr); }, 0, 2);
  assert.equal(assertReorderInvariant(b2, s2.doc, 2), true, 'a real permutation passes the invariant');
});

console.log(`chapter-reorder.test.mjs: ${pass} assertions passed`);
