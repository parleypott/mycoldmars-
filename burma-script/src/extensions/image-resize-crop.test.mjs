/*
 * image-resize-crop.test.mjs — the RESIZE (width) + CROP ({x,y,w,h}) faces of imageBlock.
 *
 * DOM (handles, drag, crop editor) is not unit-testable in this repo (no jsdom) — the pure
 * DECISIONS behind it are. Locked here:
 *   1. clampImageWidth — [IMAGE_MIN_WIDTH..max], rounds, NaN -> null.
 *   2. isValidCrop — numbers, positive w/h, in-frame, full-frame no-op rejected.
 *   3. blocks.js isValidCrop == document-builder imageCropShapeOk (lockstep contract).
 *   4. ROUND-TRIP: width+crop survive the mirror schema (fromJSON->check->toJSON) byte-exact.
 *   5. BLOCKS ROUND-TRIP: {imageWidth,imageCrop} -> node attrs -> back, and ABSENT stays absent.
 *   6. additive — an invalid stored crop is coerced to null on the way in.
 *
 * Run: bun src/extensions/image-resize-crop.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES, clampImageWidth, isValidCrop, IMAGE_MIN_WIDTH } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

let pass = 0, fail = 0;
const ok = (label, fn) => { try { fn(); pass++; console.log('  ✓ ' + label); } catch (e) { fail++; console.error('  ✗ ' + label + ' — ' + e.message); } };
const clone = (x) => JSON.parse(JSON.stringify(x));

function buildSchema() {
  return getSchema([
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
}
const schema = buildSchema();

setEpisode(BURMA);
const { buildEditorDocument, ensureTableDoc, docToBlocks } = await import('../document-builder.js');

// ── 1: clampImageWidth ──────────────────────────────────────────────────────────────────
ok('clampImageWidth clamps to [MIN..max], rounds, NaN -> null', () => {
  assert.equal(clampImageWidth(500, 640), 500);
  assert.equal(clampImageWidth(50, 640), IMAGE_MIN_WIDTH, 'below min floors to MIN');
  assert.equal(clampImageWidth(9999, 640), 640, 'above max caps to max');
  assert.equal(clampImageWidth(300.7, 640), 301, 'rounds');
  assert.equal(clampImageWidth('nope', 640), null, 'NaN -> null');
  assert.equal(clampImageWidth(500, 0), Math.min(500, 640), 'bad max -> 640 default');
});

// ── 2: isValidCrop ──────────────────────────────────────────────────────────────────────
ok('isValidCrop accepts a real rect, rejects garbage / out-of-frame / full-frame no-op', () => {
  assert.equal(isValidCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }), true);
  assert.equal(isValidCrop(null), false);
  assert.equal(isValidCrop({ x: 0, y: 0, w: 1, h: 1 }), false, 'full-frame = no crop');
  assert.equal(isValidCrop({ x: 0.5, y: 0, w: 0.6, h: 0.5 }), false, 'x+w > 1 out of frame');
  assert.equal(isValidCrop({ x: 0.1, y: 0.1, w: 0, h: 0.5 }), false, 'zero width');
  assert.equal(isValidCrop({ x: -0.1, y: 0, w: 0.5, h: 0.5 }), false, 'negative x');
  assert.equal(isValidCrop({ x: 0.1, y: 0.1, w: '0.5', h: 0.5 }), false, 'non-number');
});

// ── 3: TWIN-LOCK — document-builder's inline guard MUST behave identically to blocks.isValidCrop ──
// The two copies are hand-kept in sync (document-builder inlines its own because it must pull in NO
// TipTap deps). They gate the SAME crop object on BOTH sides of Johnny's live save round-trip: the
// editor persists a crop iff isValidCrop passes; the document-builder blocks<->node conversion keeps
// it iff imageCropShapeOk passes. If one copy is tightened/loosened and the other isn't, a crop the
// editor accepts could be silently dropped on rebuild (or a rejected one resurrected) — an image's
// crop vanishing on save with no error. The old test only checked the function NAME existed, so a
// body drift would sail through. This slices imageCropShapeOk VERBATIM from source, reconstructs it
// as a pure fn, and asserts byte-for-byte agreement with isValidCrop across a boundary-heavy battery.
// Mutation-proof: change either copy's threshold (e.g. 1.0001 -> 1.5) and the agreement asserts go RED.
function extractDocBuilderCropGuard() {
  const src = readFileSync(new URL('../document-builder.js', import.meta.url), 'utf8');
  const m = src.match(/function imageCropShapeOk\(c\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, 'document-builder ships imageCropShapeOk');
  // Reconstruct the (dep-free) declaration in an isolated scope and hand back the fn.
  return new Function(m[0] + '\nreturn imageCropShapeOk;')();
}

ok('document-builder imageCropShapeOk == blocks.isValidCrop on a boundary-heavy battery', () => {
  const imageCropShapeOk = extractDocBuilderCropGuard();
  const CASES = [
    // normal
    { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
    { x: 0, y: 0, w: 0.6, h: 0.6 },
    // rejects
    null, undefined, 0, '', 'nope', [], { x: 0.1 },
    { x: 0, y: 0, w: 1, h: 1 },                              // full-frame no-op
    { x: 0.00005, y: 0.00005, w: 0.99995, h: 0.99995 },     // within the no-op tolerance
    { x: 0.5, y: 0, w: 0.6, h: 0.5 },                       // x+w out of frame
    { x: 0, y: 0.5, w: 0.5, h: 0.6 },                       // y+h out of frame
    { x: 0.1, y: 0.1, w: 0, h: 0.5 },                       // zero width
    { x: 0.1, y: 0.1, w: 0.5, h: -0.2 },                    // negative height
    { x: -0.1, y: 0, w: 0.5, h: 0.5 },                      // negative x
    { x: 0.1, y: 0.1, w: '0.5', h: 0.5 },                   // non-number
    { x: NaN, y: 0.1, w: 0.5, h: 0.5 },                     // NaN
    { x: Infinity, y: 0, w: 0.5, h: 0.5 },                  // Infinity
    // frame-edge tolerance boundaries (the load-bearing 1.0001 / 0.9999 / 0.0001 constants)
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },                     // exactly at frame edge → keep
    { x: 0.5, y: 0.5, w: 0.5001, h: 0.5 },                  // just over the 1.0001 slack → reject
    { x: 0.0001, y: 0.0001, w: 0.9999, h: 0.9999 },         // right on the no-op corner → reject
  ];
  for (const c of CASES) {
    const a = isValidCrop(c);
    const b = imageCropShapeOk(c);
    assert.equal(b, a, `crop guards disagree on ${JSON.stringify(c)}: blocks=${a} docbuilder=${b}`);
  }
  // Pin the actual contract too (not merely "they agree" — two identically-broken copies would agree).
  assert.equal(isValidCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }), true, 'a real rect is valid');
  assert.equal(isValidCrop({ x: 0, y: 0, w: 1, h: 1 }), false, 'full-frame reads as no crop');
  assert.equal(imageCropShapeOk({ x: 0.5, y: 0, w: 0.6, h: 0.5 }), false, 'out-of-frame dropped');
});

const IMG = {
  id: 'img_rc_1', type: 'image',
  imageSrc: '/img/x.png', imageAlt: 'cropped + shrunk', imageKind: 'shot',
  imageWidth: 320, imageCrop: { x: 0.1, y: 0.15, w: 0.6, h: 0.5 },
};
const PLAIN = { id: 'img_rc_2', type: 'image', imageSrc: '/img/y.png', imageAlt: '', imageKind: 'inspo' };

const imgAtoms = (doc) => doc.content.filter((r) => r.type === 'tableRow')
  .flatMap((r) => r.content.flatMap((c) => c.content)).filter((b) => b.type === 'imageBlock');

// ── 4: attrs on the node + mirror-schema round-trip ───────────────────────────────────────
ok('buildEditorDocument puts width+crop on the imageBlock atom', () => {
  const doc = ensureTableDoc(buildEditorDocument([IMG]));
  const img = imgAtoms(doc)[0];
  assert.equal(img.attrs.width, 320);
  assert.deepEqual(img.attrs.crop, { x: 0.1, y: 0.15, w: 0.6, h: 0.5 });
});

ok('width+crop survive fromJSON -> check -> toJSON byte-exact', () => {
  const doc = ensureTableDoc(buildEditorDocument([IMG]));
  const json1 = clone(PMNode.fromJSON(schema, doc).toJSON());
  const node2 = PMNode.fromJSON(schema, json1);
  node2.check();
  assert.deepEqual(clone(node2.toJSON()), json1);
  assert.ok(JSON.stringify(json1).includes('"width":320'));
  assert.ok(JSON.stringify(json1).includes('"crop"'));
});

// ── 5: blocks round-trip + absent-stays-absent ────────────────────────────────────────────
ok('docToBlocks reads width+crop back; a plain image emits NEITHER key', () => {
  const doc = ensureTableDoc(buildEditorDocument([IMG, PLAIN]));
  const back = docToBlocks(clone(PMNode.fromJSON(schema, doc).toJSON()));
  const a = back.find((b) => b.id === 'img_rc_1');
  assert.equal(a.imageWidth, 320);
  assert.deepEqual(a.imageCrop, { x: 0.1, y: 0.15, w: 0.6, h: 0.5 });
  const b = back.find((x) => x.id === 'img_rc_2');
  assert.ok(!('imageWidth' in b), 'no imageWidth key on an unresized image');
  assert.ok(!('imageCrop' in b), 'no imageCrop key on an uncropped image');
});

// ── 6: an out-of-frame stored crop is coerced to null on the way in (guard is load-bearing) ──
ok('an out-of-frame stored crop is dropped to null on the way in', () => {
  const doc = ensureTableDoc(buildEditorDocument([{ ...PLAIN, imageCrop: { x: 0.9, y: 0, w: 0.5, h: 0.5 } }]));
  const img = imgAtoms(doc)[0];
  assert.equal(img.attrs.crop, null, 'invalid crop coerced to null, never persisted');
});

if (fail) { console.error(`image-resize-crop.test.mjs: ${fail} FAILED, ${pass} passed`); process.exit(1); }
console.log(`image-resize-crop.test.mjs: ${pass} passed, 0 failed`);
