/*
 * image-drop.test.mjs — the drag/paste-an-image pipeline (extensions/image-drop.js):
 * placeholder decoration while the upload is in flight → ONE transaction inserting an
 * imageBlock whose src is the returned CDN URL. The extension adds NO schema (the
 * imageBlock node already lives in BURMA_NODES), so this test drives the exported pure
 * pieces + the REAL production plugin mounted on a bare headless EditorState.
 *
 * Proves:
 *   1. pickImageFiles — only png/jpeg/webp pass; HEIC (macOS Photos) and non-images are
 *      rejected client-side (the server would coerce HEIC's Content-Type without
 *      transcoding → a permanently broken render in every doc revision).
 *   2. SHOWN-CELL DROP — resolveDropPos refines a raw coordinate pos to a legal point
 *      INSIDE a cols:2 row's shown cell; the inserted image passes PMNode.check() against
 *      the mirror schema, round-trips fromJSON→toJSON byte-exact, and docToBlocks exports
 *      { type:'image', imageSrc:<url>, lane:'shown', pairId } with the minted stable id
 *      (the DATA-LOSS-LAW round-trip).
 *   3. ONE TRANSACTION / UNDO — insert + placeholder-clear ride a single history step;
 *      one undo restores the pre-drop doc byte-exact. Placeholder add/remove are
 *      meta-only (docChanged false → no history step, no autosave, no collab payload).
 *   4. POSITION MAPPING — an unrelated edit ABOVE the placeholder between drop and upload
 *      completion shifts the mapped position; the insert still lands in the same shown cell.
 *   5. PLACEHOLDER DELETED → insertImageTr returns null (ABORT, never clamp); doc unchanged.
 *   6. BYTES-NEVER-IN-THE-DOC — data:/blob: srcs are refused; no such src can ever be
 *      inserted (localStorage quota / script_doc_revisions / Yjs-room blowup guard).
 *
 * Run: bun src/extensions/image-drop.test.mjs  (auto-discovered by scripts/run-tests.mjs)
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
  pickImageFiles, mintImageBlockId, altFromFilename, isSafeImageSrc,
  resolveDropPos, addPlaceholderTr, removePlaceholderTr, findPlaceholderPos,
  insertImageTr, buildImageDropPlugin, SUPPORTED_IMAGE_MIMES,
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

// EXACTLY the editor's extension set (Editor.jsx) = EXACTLY migrate-doc.js's mirror schema.
// ImageDrop itself is deliberately ABSENT from getSchema — it adds no schema; its plugin is
// mounted on the EditorState below (the same split the live editor has).
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
const none = (id, text) => ({
  type: 'noneBlock', attrs: { blockId: id },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const fullRow = (blocks) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: blocks }],
});
// A split said|shown row — the drop target the feature exists for.
const pairedRow = (pairId, saidBlocks, shownBlocks) => ({
  type: 'tableRow', attrs: { cols: 2, pairId },
  content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: saidBlocks },
    { type: 'tableCell', attrs: { role: 'shown' }, content: shownBlocks },
  ],
});

const BASE_DOC = {
  type: 'doc',
  content: [
    fullRow([none('blk_top', 'a full-width line above the split')]),
    pairedRow('pair_img_1',
      [none('blk_said', 'the words we say')],
      [{ type: 'paragraph', content: [{ type: 'text', text: 'shown notes' }] }]),
  ],
};

function makeState(docJson) {
  const doc = docFrom(docJson);
  return EditorState.create({
    schema, doc,
    plugins: [history(), buildImageDropPlugin()],
    selection: TextSelection.near(doc.resolve(0), 1),
  });
}

// A raw position INSIDE the shown cell's paragraph text (what posAtCoords would hand us
// for a drop over the right column).
function posInsideShownCell(doc) {
  let found = null;
  doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name === 'tableCell' && node.attrs.role === 'shown') { found = pos + 2; return false; }
    return true;
  });
  if (found == null) throw new Error('no shown cell in doc');
  return found;
}

// Where did the image land? → the role of the tableCell that directly contains it.
function imageParentRole(doc) {
  let role = null;
  doc.descendants((node, pos) => {
    if (node.type.name === 'imageBlock') {
      const $pos = doc.resolve(pos);
      role = $pos.parent.type.name === 'tableCell' ? $pos.parent.attrs.role : `NOT-A-CELL:${$pos.parent.type.name}`;
    }
    return true;
  });
  return role;
}

const CDN_URL = 'https://fake-project.supabase.co/storage/v1/object/public/script-images/scripts/burma/image_abc1234-zz9.png';

// ── 1: pickImageFiles — supported-mime filter (HEIC + non-images rejected) ────────────────
ok('pickImageFiles keeps png/jpeg/webp, rejects HEIC and non-images', () => {
  const f = (name, type) => ({ name, type });
  const files = [
    f('frame.png', 'image/png'), f('still.jpg', 'image/jpeg'), f('grade.webp', 'image/webp'),
    f('photo.heic', 'image/heic'), f('notes.pdf', 'application/pdf'), f('cut.mov', 'video/quicktime'),
    f('mystery', ''),
  ];
  const { images, rejected } = pickImageFiles(files);
  assert.deepEqual(images.map((x) => x.name), ['frame.png', 'still.jpg', 'grade.webp']);
  assert.deepEqual(rejected.map((x) => x.name), ['photo.heic', 'notes.pdf', 'cut.mov', 'mystery']);
  // image/jpg (the non-canonical spelling browsers sometimes report) is accepted too —
  // the server normalizes it to image/jpeg.
  assert.ok(SUPPORTED_IMAGE_MIMES.has('image/jpg'));
  assert.deepEqual(pickImageFiles(null), { images: [], rejected: [] });
});

ok('altFromFilename strips the extension; mintImageBlockId mints the image_ shape', () => {
  assert.equal(altFromFilename('reef-flyover.v2.png'), 'reef-flyover.v2');
  assert.equal(altFromFilename(''), '');
  assert.match(mintImageBlockId(), /^image_[a-z0-9]{7}$/);
});

// ── 2+3: the full drop → placeholder → upload-done → insert pipeline ──────────────────────
ok('drop into the SHOWN cell: legal insert, mirror-schema check, docToBlocks lane/pairId, ONE undo', () => {
  let state = makeState(BASE_DOC);
  const before = clone(state.doc.toJSON());
  const dispatch = (tr) => { state = state.apply(tr); };

  // Drop gesture: raw coordinate pos inside the shown cell, refined by dropPoint.
  const rawPos = posInsideShownCell(state.doc);
  const pos = resolveDropPos(state, rawPos);
  assert.ok(typeof pos === 'number', 'dropPoint found a legal insertion point');

  // Placeholder while the upload is in flight — meta-only, NEVER a doc change.
  const id = mintImageBlockId();
  const phTr = addPlaceholderTr(state, pos, id);
  assert.equal(phTr.docChanged, false, 'placeholder add is decoration-only (no history step, no autosave)');
  dispatch(phTr);
  assert.equal(findPlaceholderPos(state, id), pos, 'placeholder holds the drop point');
  assert.deepEqual(clone(state.doc.toJSON()), before, 'doc bytes untouched while uploading');

  // Upload completes → the ONE transaction.
  const tr = insertImageTr(state, id, { src: CDN_URL, alt: 'reef-flyover', kind: 'shot' });
  assert.ok(tr, 'insert transaction built');
  dispatch(tr);

  assert.equal(imageParentRole(state.doc), 'shown', 'image landed INSIDE the shown cell');
  assert.equal(findPlaceholderPos(state, id), null, 'placeholder cleared in the same transaction');

  // DATA-LOSS LAW: mirror-schema check + byte-exact serialize round-trip.
  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check();
  assert.deepEqual(clone(reparsed.toJSON()), clone(state.doc.toJSON()), 'mirror round-trip byte-exact');

  // Persistence/export contract: docToBlocks reads the image back with lane + pairId.
  const blocks = docToBlocks(clone(state.doc.toJSON()));
  const img = blocks.find((b) => b.type === 'image');
  assert.ok(img, 'docToBlocks exports the image');
  assert.equal(img.id, id, 'the minted blockId is the stable persisted id');
  assert.equal(img.imageSrc, CDN_URL);
  assert.equal(img.imageAlt, 'reef-flyover');
  assert.equal(img.imageKind, 'shot');
  assert.equal(img.lane, 'shown');
  assert.equal(img.pairId, 'pair_img_1');

  // ONE-TRANSACTION LAW: a single undo removes the image byte-exact.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'one undo restores the pre-drop doc byte-exact');
});

// ── 4: position mapping — an edit ABOVE the placeholder shifts it, insert still lands right ──
ok('an unrelated edit above the placeholder during upload: mapped insert still hits the shown cell', () => {
  let state = makeState(BASE_DOC);
  const dispatch = (tr) => { state = state.apply(tr); };

  const pos = resolveDropPos(state, posInsideShownCell(state.doc));
  const id = mintImageBlockId();
  dispatch(addPlaceholderTr(state, pos, id));

  // Johnny keeps typing in the TOP row while the bytes travel — every position below shifts.
  const typed = ' — and more words land up here';
  dispatch(state.tr.insertText(typed, 5));
  const afterTyping = clone(state.doc.toJSON());
  const mapped = findPlaceholderPos(state, id);
  assert.equal(mapped, pos + typed.length, 'placeholder mapped through the concurrent edit');

  const tr = insertImageTr(state, id, { src: CDN_URL, alt: 'late arrival', kind: 'shot' });
  assert.ok(tr, 'insert still possible');
  dispatch(tr);
  assert.equal(imageParentRole(state.doc), 'shown', 'image landed in the SAME shown cell despite the shift');

  // Undo pops ONLY the image (its own step); the typing survives.
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), afterTyping, 'undo removes just the image, keeps the typing');
});

// ── 5: placeholder deleted (row removed / undo) → ABORT, never clamp ───────────────────────
ok('placeholder deleted before the upload lands → insert aborts, doc unchanged', () => {
  let state = makeState(BASE_DOC);
  const dispatch = (tr) => { state = state.apply(tr); };

  const pos = resolveDropPos(state, posInsideShownCell(state.doc));
  const id = mintImageBlockId();
  dispatch(addPlaceholderTr(state, pos, id));

  // Delete the whole split row (placeholder position is inside the deleted range).
  let rowPos = null, rowNode = null;
  state.doc.descendants((node, p) => {
    if (rowNode) return false;
    if (node.type.name === 'tableRow' && node.attrs.cols === 2) { rowPos = p; rowNode = node; }
    return true;
  });
  dispatch(state.tr.delete(rowPos, rowPos + rowNode.nodeSize));
  const afterDelete = clone(state.doc.toJSON());

  assert.equal(findPlaceholderPos(state, id), null, 'placeholder died with its row');
  assert.equal(insertImageTr(state, id, { src: CDN_URL, alt: 'x', kind: 'shot' }), null, 'insert ABORTS');
  assert.deepEqual(clone(state.doc.toJSON()), afterDelete, 'doc untouched by the aborted insert');
  // The failure-path cleanup transaction is a harmless meta-only no-op.
  const rm = removePlaceholderTr(state, id);
  assert.equal(rm.docChanged, false);
});

// ── 6: bytes can never enter the doc — data:/blob: srcs are structurally refused ───────────
ok('data:/blob:/garbage srcs are refused; only http(s)/root-relative pass', () => {
  assert.equal(isSafeImageSrc(CDN_URL), true);
  assert.equal(isSafeImageSrc('/palau2/img/palau2-005-003.png'), true, 'existing bundled shape stays legal');
  assert.equal(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo='), false);
  assert.equal(isSafeImageSrc('blob:https://mycoldmars.com/uuid'), false);
  assert.equal(isSafeImageSrc('javascript:alert(1)'), false);
  assert.equal(isSafeImageSrc('//evil.example/x.png'), false);
  assert.equal(isSafeImageSrc(''), false);

  // And insertImageTr enforces it: a live placeholder + a data: URL still refuses to insert.
  let state = makeState(BASE_DOC);
  const dispatch = (tr) => { state = state.apply(tr); };
  const pos = resolveDropPos(state, posInsideShownCell(state.doc));
  const id = mintImageBlockId();
  dispatch(addPlaceholderTr(state, pos, id));
  const before = clone(state.doc.toJSON());
  assert.equal(insertImageTr(state, id, { src: 'data:image/png;base64,AAAA', alt: 'x', kind: 'shot' }), null);
  assert.equal(insertImageTr(state, id, { src: 'blob:https://x/y', alt: 'x', kind: 'shot' }), null);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'no byte-src ever entered the doc');
  assert.ok(!JSON.stringify(state.doc.toJSON()).includes('data:'), 'serialized doc carries no data: src');
});

// ── multi-file drop: sequential placeholders at one point keep their drop order ────────────
ok('two files dropped at the same point insert in drop order, each its own undo step', () => {
  let state = makeState(BASE_DOC);
  const dispatch = (tr) => { state = state.apply(tr); };
  const before = clone(state.doc.toJSON());

  const pos = resolveDropPos(state, posInsideShownCell(state.doc));
  const idA = 'image_aaaaaaa';
  const idB = 'image_bbbbbbb';
  dispatch(addPlaceholderTr(state, pos, idA));
  dispatch(addPlaceholderTr(state, pos, idB));

  // Uploads complete in order; B's placeholder maps to AFTER A's landed node (widget side ≥ 0).
  dispatch(insertImageTr(state, idA, { src: CDN_URL, alt: 'first', kind: 'shot' }));
  dispatch(insertImageTr(state, idB, { src: CDN_URL, alt: 'second', kind: 'shot' }));

  const alts = [];
  state.doc.descendants((node) => { if (node.type.name === 'imageBlock') alts.push(node.attrs.alt); return true; });
  assert.deepEqual(alts, ['first', 'second'], 'drop order preserved');

  // Each insert was its own transaction → two undos peel them off back to the start.
  undo(state, dispatch);
  undo(state, dispatch);
  assert.deepEqual(clone(state.doc.toJSON()), before, 'two undos restore the pre-drop doc');
});

// ── drop between rows (gap drop): dropPoint still finds a legal full-width point ───────────
ok('a drop on the gap between rows resolves to a legal point and passes the save-gate check', () => {
  let state = makeState(BASE_DOC);
  const dispatch = (tr) => { state = state.apply(tr); };

  // Position 0 / a row boundary: dropPoint must hand back somewhere an imageBlock is legal.
  const firstRowEnd = state.doc.child(0).nodeSize; // boundary between row 1 and row 2
  const pos = resolveDropPos(state, firstRowEnd);
  assert.ok(typeof pos === 'number', 'gap drop resolves');

  const id = mintImageBlockId();
  dispatch(addPlaceholderTr(state, pos, id));
  dispatch(insertImageTr(state, id, { src: CDN_URL, alt: 'gap drop', kind: 'shot' }));

  const reparsed = docFrom(state.doc.toJSON());
  reparsed.check(); // the save-gate law — an illegal placement would throw here
  const img = docToBlocks(clone(state.doc.toJSON())).find((b) => b.type === 'image');
  assert.ok(img, 'gap-dropped image persists through docToBlocks');
});

console.log(`image-drop.test.mjs: ${pass} assertions passed`);
