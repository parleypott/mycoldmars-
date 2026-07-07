/*
 * image-video.test.mjs — the .mp4-src face of the imageBlock (gif→mp4 optimization).
 * A big dropped GIF is transcoded to a looping mp4 (gif-transcode.js) and the imageBlock's
 * src ends .mp4 — SAME node, SAME attrs, only the rendered element forks. Locked here:
 *
 *   1. isVideoSrc — the img/video fork's single predicate, shared by renderHTML and the
 *      nodeview: case-insensitive .mp4, query-string/hash tolerant, everything else false.
 *   2. renderHTML fork — schema toDOM emits <video autoplay loop muted playsinline
 *      preload=metadata> for an .mp4 src and the classic <img loading=lazy> for a raster
 *      src (asserted on the toDOM array spec — headless, no document needed).
 *   3. ROUND-TRIP unaffected — src is just a string attr: an .mp4-src imageBlock passes
 *      the mirror-schema fromJSON→check→toJSON byte-exact and docToBlocks reads it back
 *      as { type:'image', imageSrc:*.mp4 } (mirrors image-block.test.mjs).
 *   4. pickMediaUploadRoute — video/mp4 ALWAYS rides the signed road (the base64 edge fn
 *      would coerce its Content-Type to png); images still route by size.
 *
 * Run: bun burma-script/src/extensions/image-video.test.mjs  (auto-discovered)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES, isVideoSrc } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { pickMediaUploadRoute, SIGNED_ROUTE_MIN_BYTES } from './image-drop.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);
const { docToBlocks } = await import('../document-builder.js');

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACTLY the editor's extension set (Editor.jsx) = EXACTLY migrate-doc.js's mirror schema.
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

const MP4_URL = 'https://fake-project.supabase.co/storage/v1/object/public/script-images/scripts/burma/image_abc1234-zz9.mp4';
const PNG_URL = 'https://fake-project.supabase.co/storage/v1/object/public/script-images/scripts/burma/image_abc1234-zz9.png';

// ── 1: isVideoSrc — the fork predicate ──────────────────────────────────────────────────
ok('isVideoSrc: .mp4 (any case, with query/hash) true; rasters/garbage false', () => {
  assert.equal(isVideoSrc(MP4_URL), true);
  assert.equal(isVideoSrc('/local/loop.MP4'), true, 'case-insensitive');
  assert.equal(isVideoSrc(MP4_URL + '?token=abc&x=1'), true, 'query-string tolerant');
  assert.equal(isVideoSrc(MP4_URL + '#t=2'), true, 'hash tolerant');
  assert.equal(isVideoSrc('  ' + MP4_URL + '  '), true, 'trims');
  assert.equal(isVideoSrc(PNG_URL), false);
  assert.equal(isVideoSrc('https://x/y.gif'), false);
  // .mp4 must END the path — a query param mentioning mp4 doesn't flip an image.
  assert.equal(isVideoSrc('https://x/y.png?from=loop.mp4'), false);
  assert.equal(isVideoSrc('https://x/y.mp4.png'), false);
  assert.equal(isVideoSrc(''), false);
  assert.equal(isVideoSrc(null), false);
});

// ── 2: renderHTML forks video vs img (asserted on the toDOM array spec) ─────────────────
const imageNode = (src, alt = '') => schema.nodes.imageBlock.create({ blockId: 'image_vid0001', src, alt, kind: 'shot' });
const toDom = (node) => schema.nodes.imageBlock.spec.toDOM(node);

ok('an .mp4 src renders <figure><video autoplay loop muted playsinline preload=metadata>', () => {
  const spec = toDom(imageNode(MP4_URL, 'mapkeys loop'));
  assert.equal(spec[0], 'figure');
  const media = spec[2];
  assert.equal(media[0], 'video', 'video element for an .mp4 src');
  const attrs = media[1];
  assert.equal(attrs.src, MP4_URL);
  // The full gif-parity attribute set — drop any one and the loop stops being a gif:
  // no autoplay = frozen poster; no loop = plays once; no muted = autoplay blocked;
  // no playsinline = iOS fullscreens; preload=metadata = cheap below the fold.
  for (const k of ['autoplay', 'loop', 'muted', 'playsinline']) {
    assert.ok(k in attrs, `<video> carries ${k}`);
  }
  assert.equal(attrs.preload, 'metadata');
  assert.equal(attrs['aria-label'], 'mapkeys loop', 'caption still reaches AT (video has no alt)');
  // Caption face unchanged by the fork.
  assert.equal(spec[3][0], 'figcaption');
});

ok('a raster src still renders the classic <img loading=lazy> (fork untouched for images)', () => {
  const spec = toDom(imageNode(PNG_URL, 'still frame'));
  const media = spec[2];
  assert.equal(media[0], 'img');
  assert.equal(media[1].src, PNG_URL);
  assert.equal(media[1].alt, 'still frame');
  assert.equal(media[1].loading, 'lazy');
  assert.ok(!('autoplay' in media[1]));
});

// ── 3: round-trip unaffected — src is just a string attr ────────────────────────────────
ok('an .mp4-src imageBlock round-trips the mirror schema byte-exact and exports via docToBlocks', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{ type: 'imageBlock', attrs: { blockId: 'image_vid0001', src: MP4_URL, alt: 'mapkeys loop', kind: 'shot' } }],
      }],
    }],
  };
  const json1 = clone(PMNode.fromJSON(schema, doc).toJSON());
  const node2 = PMNode.fromJSON(schema, json1);
  node2.check(); // the save-gate law — an .mp4 src must not make the node illegal anywhere
  assert.deepEqual(clone(node2.toJSON()), json1, 'mirror round-trip byte-exact');

  const back = docToBlocks(clone(json1));
  const img = back.find((b) => b.type === 'image');
  assert.ok(img, 'docToBlocks exports the block');
  assert.equal(img.id, 'image_vid0001');
  assert.equal(img.imageSrc, MP4_URL, 'the .mp4 URL is just a string through persistence');
  assert.equal(img.imageKind, 'shot', 'transcoded reference keeps kind:shot');
});

// ── 4: mp4 always takes the signed road ─────────────────────────────────────────────────
ok('pickMediaUploadRoute: video/mp4 → signed at ANY size; images route by size as before', () => {
  const MB = 1024 * 1024;
  // A 78MB gif typically lands ~4-8MB as mp4 — UNDER the 6MB base64 boundary. The base64
  // edge fn's shared imageStorageMeta would coerce video/mp4 → image/png (mp4 bytes served
  // as png = permanently broken render), so mp4 must take the signed road even when small.
  assert.equal(pickMediaUploadRoute('video/mp4', 4 * MB), 'signed');
  assert.equal(pickMediaUploadRoute('video/mp4', 100), 'signed');
  assert.equal(pickMediaUploadRoute('VIDEO/MP4', 20 * MB), 'signed', 'case-insensitive');
  // Images keep the exact pickUploadRoute boundary.
  assert.equal(pickMediaUploadRoute('image/png', 4 * MB), 'base64');
  assert.equal(pickMediaUploadRoute('image/gif', SIGNED_ROUTE_MIN_BYTES), 'base64');
  assert.equal(pickMediaUploadRoute('image/gif', SIGNED_ROUTE_MIN_BYTES + 1), 'signed');
});

console.log(`image-video.test.mjs: ${pass} assertions passed`);
