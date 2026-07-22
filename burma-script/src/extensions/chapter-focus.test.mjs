/*
 * chapter-focus.test.mjs — locks buildFocusDecorations (chapter-focus.js), the decoration core
 * behind the ⛶ full-screen chapter focus. Rows OUTSIDE the focused chapter's run get a
 * `wp-focus-out` node decoration (CSS hides them); the focused chapter's own row + its body
 * rows carry nothing. The contract:
 *
 *   1. OFF — focusId null/undefined → EMPTY decoration set (normal full-script view).
 *   2. STALE ID DEGRADES SAFE — a focusId not present in the doc → EMPTY set. Deleting the
 *      focused chapter mid-focus must show EVERYTHING, never a blank page hidden behind a
 *      stale id.
 *   3. RUN BOUNDARIES — focusing chapter A hides: rows BEFORE the first chapter, chapter B's
 *      row and B's body rows; it does NOT hide A's row or A's body rows (scenes included).
 *   4. TRAILING BARE NODE — the top-level trailing paragraph (TrailingNode's contract) belongs
 *      to whatever run is open: hidden when the LAST chapter isn't the focus, visible when it is.
 *
 * Run: bun src/extensions/chapter-focus.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { buildFocusDecorations, rowChapterStartId, focusRunRange } from './chapter-focus.js';
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
const row = (blocks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
const chapter = (id) => ({
  type: 'chapterBlock', attrs: { blockId: id, genre: 'other' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chapter ' + id }] }],
});
const scene = (id) => ({
  type: 'sceneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Scene ' + id }] }],
});
const vo = (id) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'vo ' + id }] }],
});

// The canonical fixture: [pre-script row] [ch A] [A scene] [A body] [ch B] [B body] [bare ¶].
const DOC = {
  type: 'doc',
  content: [
    row([vo('pre')]),
    row([chapter('chA')]),
    row([scene('scA1')]),
    row([vo('bodyA')]),
    row([chapter('chB')]),
    row([vo('bodyB')]),
    { type: 'paragraph' }, // the trailing-node peace-treaty paragraph
  ],
};

// Returns, per TOP-LEVEL child index, whether a wp-focus-out decoration covers that child.
function hiddenByIndex(doc, focusId) {
  const set = buildFocusDecorations(doc, focusId);
  const spans = set.find().map((d) => [d.from, d.to]);
  const out = [];
  doc.forEach((child, pos, index) => {
    out[index] = spans.some(([from, to]) => from === pos && to === pos + child.nodeSize);
  });
  return out;
}

ok('§1 no focus → empty set', () => {
  const doc = docFrom(DOC);
  assert.equal(buildFocusDecorations(doc, null).find().length, 0);
  assert.equal(buildFocusDecorations(doc, undefined).find().length, 0);
});

ok('§2 stale/unknown focusId → empty set (everything stays visible)', () => {
  const doc = docFrom(DOC);
  assert.equal(buildFocusDecorations(doc, 'ch_deleted').find().length, 0);
});

ok('§3 focusing chA hides pre-script + chB run, keeps chA row/scene/body', () => {
  const doc = docFrom(DOC);
  const hidden = hiddenByIndex(doc, 'chA');
  assert.deepEqual(hidden, [
    true,   // pre-script row — outside every chapter
    false,  // chA row
    false,  // chA scene (scenes live INSIDE the chapter run)
    false,  // chA body
    true,   // chB row
    true,   // chB body
    true,   // trailing ¶ — belongs to chB's (open) run
  ]);
});

ok('§3/§4 focusing chB hides everything above it, keeps its run + trailing ¶', () => {
  const doc = docFrom(DOC);
  const hidden = hiddenByIndex(doc, 'chB');
  assert.deepEqual(hidden, [true, true, true, true, false, false, false]);
});

ok('rowChapterStartId = chapter-frames run model (FIRST block of first cell only)', () => {
  const doc = docFrom(DOC);
  assert.equal(rowChapterStartId(doc.child(1)), 'chA');
  assert.equal(rowChapterStartId(doc.child(0)), null);
  assert.equal(rowChapterStartId(doc.child(2)), null); // a scene does NOT start a run
  // a chapter that is NOT the first block does not open a run — same as the frames
  const mixed = docFrom({ type: 'doc', content: [row([vo('x'), chapter('chX')])] });
  assert.equal(rowChapterStartId(mixed.child(0)), null);
});

ok('focusRunRange covers exactly the focused run (drives the Mod-A fence)', () => {
  const doc = docFrom(DOC);
  const range = focusRunRange(doc, 'chA');
  // run = children 1..3 (chapter, scene, body) — from child(1) start to child(3) end
  let starts = [];
  doc.forEach((child, pos) => starts.push([pos, pos + child.nodeSize]));
  assert.deepEqual(range, { from: starts[1][0], to: starts[3][1] });
  assert.equal(focusRunRange(doc, 'ch_gone'), null);
  assert.equal(focusRunRange(doc, null), null);
});

console.log(`chapter-focus: ${pass} sections green`);
