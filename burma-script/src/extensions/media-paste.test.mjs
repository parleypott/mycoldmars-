/*
 * media-paste.test.mjs — CLIPBOARD MEDIA PASTE → NEW ROWS (image-drop.js).
 *
 * Johnny: "copy images gifs/videos and paste them and have them properly copy into new rows."
 * A paste inserts each media item as its own FULL-WIDTH row at the caret (the same
 * tableRow(cols:1) > tableCell(role:'full') > block shape /chapter builds), with an attr-driven
 * uploading placeholder that the upload promise swaps to the final src.
 *
 * Proves:
 *   1. pickMediaFiles — png/jpeg/webp/gif images AND mp4/webm/mov videos pass; HEIC + non-media
 *      are rejected (mirrors the server SIGNABLE_MIMES set).
 *   2. buildMediaRowNode — the row shape: tableRow(cols:1, pairu_) > tableCell(role:'full') >
 *      imageBlock{ uploading:true, src:'' }; round-trips the migrate-doc mirror schema + docToBlocks
 *      (imageUploading emitted only while unresolved).
 *   3. insertPlaceholderRows — two items land as consecutive rows AFTER the caret's outermost row,
 *      in clipboard order; ONE undo removes the whole paste; the result round-trips the mirror schema.
 *   4. swapMediaBlock — the upload resolution swaps the block found BY blockId (src in, uploading
 *      off); a sibling placeholder is untouched; a missing id is a no-op; the landed video-src doc
 *      round-trips byte-exact. A collaborator-deleted block (missing id) aborts cleanly.
 *   5. NON-MEDIA PASTE PASSTHROUGH (CRITICAL) — a text / HTML / ProseMirror-slice paste carries no
 *      file, so handlePaste returns false and never dispatches: the sacred writing-tool paste path
 *      is untouched.
 *   6. READ-ONLY / NON-EDITABLE — a media paste into a non-editable surface is swallowed with NO
 *      doc mutation.
 *
 * Run: bun src/extensions/media-paste.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  pickMediaFiles, buildMediaRowNode, insertPlaceholderRows, swapMediaBlock,
  findImageBlockPos, buildImageDropPlugin, SUPPORTED_VIDEO_MIMES,
} from './image-drop.js';
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

// The EXACT schema the live editor + migrate-doc's save gate enforce.
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
const vo = (id, text) => ({
  type: 'voBlock', attrs: { blockId: id, status: 'todo' },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
function makeState(docJson, cursorAt) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc, plugins: [history()],
    selection: TextSelection.near(doc.resolve(cursorAt), 1),
  });
}
// A minimal ProseMirror-view stand-in: dispatch mutates state in place, matching the real view's
// read-your-writes so insertPlaceholderRows + swapMediaBlock can be driven headlessly.
function makeView(state, editable = true) {
  return {
    state,
    editable,
    isDestroyed: false,
    dispatch(tr) { this.state = this.state.apply(tr); },
  };
}

// ── 1: pickMediaFiles — images ∪ videos pass; HEIC + non-media rejected ─────────────────────
ok('pickMediaFiles keeps png/jpeg/webp/gif + mp4/webm/mov; rejects HEIC and non-media', () => {
  const files = [
    { name: 'a.png', size: 10, type: 'image/png' },
    { name: 'b.jpg', size: 10, type: 'image/jpeg' },
    { name: 'c.webp', size: 10, type: 'image/webp' },
    { name: 'd.gif', size: 10, type: 'image/gif' },
    { name: 'e.mp4', size: 10, type: 'video/mp4' },
    { name: 'f.webm', size: 10, type: 'video/webm' },
    { name: 'g.mov', size: 10, type: 'video/quicktime' },
    { name: 'h.heic', size: 10, type: 'image/heic' },
    { name: 'i.pdf', size: 10, type: 'application/pdf' },
  ];
  const { media, rejected } = pickMediaFiles(files);
  assert.equal(media.length, 7, 'four images + three videos pass');
  assert.equal(rejected.length, 2, 'HEIC + PDF rejected');
  assert.deepEqual([...SUPPORTED_VIDEO_MIMES].sort(), ['video/mp4', 'video/quicktime', 'video/webm']);
  assert.deepEqual(pickMediaFiles(null), { media: [], rejected: [] });
});

// ── 2: buildMediaRowNode — full-width uploading row shape + round-trip ───────────────────────
ok('buildMediaRowNode is a full-width uploading imageBlock row that round-trips', () => {
  const id = 'image_paste01';
  const rowNode = buildMediaRowNode(schema, { id, alt: '', kind: 'shot' });
  assert.equal(rowNode.type.name, 'tableRow');
  assert.equal(rowNode.attrs.cols, 1, 'full-width row');
  assert.ok(String(rowNode.attrs.pairId).startsWith('pairu_'), 'user-added pairId keeps the Palau culler off it');
  const cell = rowNode.child(0);
  assert.equal(cell.type.name, 'tableCell');
  assert.equal(cell.attrs.role, 'full');
  const img = cell.child(0);
  assert.equal(img.type.name, 'imageBlock');
  assert.equal(img.attrs.blockId, id);
  assert.equal(img.attrs.uploading, true, 'born uploading');
  assert.equal(img.attrs.src, '', 'no bytes in the doc yet');
  assert.equal(img.attrs.uploadError, null);

  // Mirror-schema round-trip (the save-gate law) + docToBlocks flatten.
  const doc = { type: 'doc', content: [rowNode.toJSON()] };
  const node = docFrom(doc);
  node.check();
  assert.deepEqual(clone(docFrom(node.toJSON()).toJSON()), clone(node.toJSON()), 'mirror round-trip byte-exact');
  const b = docToBlocks(node.toJSON()).find((x) => x.type === 'image');
  assert.ok(b, 'docToBlocks exports the block');
  assert.equal(b.imageUploading, true, 'uploading state survives the flatten while unresolved');
  assert.equal(b.imageSrc, '');
});

// ── 3: insertPlaceholderRows — consecutive rows in clipboard order; one undo removes them ───
ok('insertPlaceholderRows lands two rows after the outermost row, in order; one undo restores', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'narration')])] };
  const state = makeState(docJson, 4);
  const before = clone(state.doc.toJSON());
  const view = makeView(state);

  const okInsert = insertPlaceholderRows(view, [
    { id: 'image_p1', alt: '', kind: 'shot' },
    { id: 'image_p2', alt: '', kind: 'shot' },
  ]);
  assert.equal(okInsert, true);
  assert.equal(view.state.doc.childCount, 3, 'host row + 2 media rows');
  assert.equal(view.state.doc.child(0).textContent.trim(), 'narration', 'host row untouched');
  const b1 = view.state.doc.child(1).child(0).child(0);
  const b2 = view.state.doc.child(2).child(0).child(0);
  assert.equal(b1.attrs.blockId, 'image_p1', 'clipboard order preserved (item 1 first)');
  assert.equal(b2.attrs.blockId, 'image_p2', 'item 2 second');
  assert.equal(b1.attrs.uploading, true);

  const reparsed = docFrom(view.state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(view.state.doc.toJSON()), 'mirror round-trip byte-exact');

  // ONE undo removes both placeholder rows (single history step).
  undo(view.state, (tr) => view.dispatch(tr));
  assert.deepEqual(clone(view.state.doc.toJSON()), before, 'single undo restores the pre-paste doc');
});

// ── 4: swapMediaBlock — resolution swaps by blockId; sibling untouched; missing id no-op ────
ok('swapMediaBlock swaps the matching block by id; sibling placeholder untouched; final doc round-trips', () => {
  const docJson = { type: 'doc', content: [row([vo('vo_1', 'narration')])] };
  const view = makeView(makeState(docJson, 4));
  insertPlaceholderRows(view, [
    { id: 'image_p1', alt: '', kind: 'shot' },
    { id: 'image_p2', alt: '', kind: 'shot' },
  ]);

  const VIDEO_URL = 'https://cdn.test/storage/v1/object/public/script-images/scripts/burma/image_p1.mp4';
  assert.equal(swapMediaBlock(view, 'image_p1', { uploading: false, uploadError: null, src: VIDEO_URL }), true);
  const swapped = view.state.doc.child(1).child(0).child(0);
  assert.equal(swapped.attrs.uploading, false, 'resolved: uploading cleared');
  assert.equal(swapped.attrs.src, VIDEO_URL, 'final video src swapped in');
  const sibling = view.state.doc.child(2).child(0).child(0);
  assert.equal(sibling.attrs.uploading, true, 'the other placeholder is untouched');

  // A block a collaborator deleted (missing id) → false, no throw, no mutation.
  const sizeBefore = view.state.doc.content.size;
  assert.equal(swapMediaBlock(view, 'image_gone', { src: 'x' }), false, 'missing id aborts');
  assert.equal(view.state.doc.content.size, sizeBefore, 'no mutation on a missing id');
  assert.equal(findImageBlockPos(view.state, 'image_p1') != null, true, 'landed block still locatable by id');

  // The landed video-src doc round-trips byte-exact (src is just a string through persistence).
  const rp = docFrom(view.state.doc.toJSON());
  rp.check();
  assert.deepEqual(clone(rp.toJSON()), clone(view.state.doc.toJSON()), 'landed doc mirror round-trip byte-exact');
});

// ── 5: NON-MEDIA PASTE PASSTHROUGH (CRITICAL) — text / html / PM-slice untouched ────────────
ok('handlePaste returns false and never dispatches for a non-media paste', () => {
  const plugin = buildImageDropPlugin();
  const handlePaste = plugin.props.handlePaste;
  let dispatched = 0;
  const view = { state: makeState({ type: 'doc', content: [row([vo('vo_1', 'x')])] }, 4), editable: true, dispatch() { dispatched += 1; } };

  const textEvent = { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/plain' }], getData: () => 'hello world' }, preventDefault() {} };
  const htmlEvent = { clipboardData: { files: [], items: [{ kind: 'string', type: 'text/html' }], getData: () => '<b>bold</b>' }, preventDefault() {} };
  // A ProseMirror internal slice paste carries text/html + the PM slice type — both are STRING items.
  const pmSliceEvent = { clipboardData: { files: [], items: [{ kind: 'string', type: 'application/x-prosemirror' }, { kind: 'string', type: 'text/html' }], getData: () => '' }, preventDefault() {} };

  for (const ev of [textEvent, htmlEvent, pmSliceEvent]) {
    assert.equal(handlePaste(view, ev), false, 'a non-media paste falls through (returns false)');
  }
  assert.equal(dispatched, 0, 'a non-media paste NEVER dispatches — the writing paste path is sacred');
});

// ── 6: READ-ONLY / NON-EDITABLE — a media paste is swallowed with no doc mutation ───────────
ok('a media paste into a non-editable surface is swallowed, never mutates the doc', () => {
  const plugin = buildImageDropPlugin();
  const handlePaste = plugin.props.handlePaste;
  let dispatched = 0;
  const view = {
    state: makeState({ type: 'doc', content: [row([vo('vo_1', 'x')])] }, 4),
    editable: false, // non-editable surface (a ?read share, or edit mode not armed)
    dispatch() { dispatched += 1; },
  };
  const mediaEvent = {
    clipboardData: { files: [{ name: 's.png', size: 100, type: 'image/png' }], items: [] },
    preventDefault() {},
  };
  assert.equal(handlePaste(view, mediaEvent), true, 'swallowed (handled) so nothing navigates the tab');
  assert.equal(dispatched, 0, 'NO transaction dispatched into a non-editable surface');
});

console.log(`media-paste.test.mjs: ${pass} assertions passed`);
