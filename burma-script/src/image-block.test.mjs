/**
 * IMAGE BLOCK (ADDITIVE) — schema-trap regression guard.
 *
 * The engine gained an `image` block type (schema.ts) + `imageBlock` TipTap atom node
 * (extensions/blocks.js → BURMA_NODES, which feeds BOTH the live editor schema in Editor.jsx AND
 * the migrate-doc.js mirror schema — the three lockstep places). This test proves:
 *
 *   1. ROUND-TRIP: an image block survives build → schema parse (fromJSON + check) → serialize
 *      (toJSON) → parse again WITHOUT LOSS — the same serialization localStorage/cloud/save
 *      read-back use. If the node were registered in the editor but missing from the mirror
 *      schema (the Editor.jsx ~352 trap), this fromJSON would throw / silently drop it.
 *   2. BLOCKS ROUND-TRIP: docToBlocks reads the imageBlock back to { type:'image', imageSrc,
 *      imageAlt, imageKind } with a stable id — the persistence/export contract.
 *   3. CULL-SAFE: normalizePalauTableDoc (normalizeTableRows flag ON) must NOT drop an image row
 *      as an "empty" (word-less) row — an image is visible content with no text nodes.
 *   4. INERT: the real Burma + Palau block seeds emit ZERO imageBlock nodes — the addition
 *      changes nothing for existing episodes.
 *
 * Run: bun burma-script/src/image-block.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { PALAU2 } from '../../palau2-script/config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACTLY the editor's extension set (Editor.jsx) = EXACTLY migrate-doc.js's mirror schema.
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

// Palau2 is the episode that actually carries image blocks (and runs the normalizeTableRows
// culler this test guards). Set it BEFORE importing document-builder (episode-derived regexes).
setEpisode(PALAU2);
const { buildEditorDocument, ensureTableDoc, docToBlocks } = await import('./document-builder.js');

const IMAGE_BLOCK = {
  id: 'image_test_1',
  type: 'image',
  imageSrc: '/palau2/img/palau2-005-003.png',
  imageAlt: 'Inspo: JH peering over the 3d water map',
  imageKind: 'inspo',
};
const SOT_BLOCK = {
  id: 'sot_test_1',
  type: 'sot',
  speaker: 'TOMMY',
  text: 'life on Earth depends on the quality and life of the ocean',
  timecode: { day: 1, tc: '00:27:04:17', ambiguous: false, raw: 'DAY 1 00:27:04:17' },
};

// ---- 1 + 2: build → schema → serialize → parse → blocks, without loss --------------------------
const doc = ensureTableDoc(buildEditorDocument([SOT_BLOCK, IMAGE_BLOCK]));

ok('buildEditorDocument emits an imageBlock atom with src/alt/kind attrs', () => {
  const rows = doc.content.filter((r) => r.type === 'tableRow');
  const blocks = rows.flatMap((r) => r.content.flatMap((c) => c.content));
  const img = blocks.find((b) => b.type === 'imageBlock');
  assert.ok(img, 'imageBlock present');
  assert.equal(img.attrs.blockId, 'image_test_1');
  assert.equal(img.attrs.src, '/palau2/img/palau2-005-003.png');
  assert.equal(img.attrs.alt, 'Inspo: JH peering over the 3d water map');
  assert.equal(img.attrs.kind, 'inspo');
});

ok('image doc round-trips through the mirror schema (fromJSON → check → toJSON) STABLE', () => {
  const json1 = clone(PMNode.fromJSON(schema, doc).toJSON());
  const node2 = PMNode.fromJSON(schema, json1);
  node2.check(); // throws if imageBlock is illegal anywhere (row/cell content, attrs)
  assert.deepEqual(clone(node2.toJSON()), json1);
  assert.ok(JSON.stringify(json1).includes('"imageBlock"'), 'image survived serialization');
});

ok('docToBlocks reads the image back as { type:"image", imageSrc, imageAlt, imageKind } (stable id)', () => {
  const back = docToBlocks(clone(PMNode.fromJSON(schema, doc).toJSON()));
  const img = back.find((b) => b.type === 'image');
  assert.ok(img, 'image block came back');
  assert.equal(img.id, 'image_test_1');
  assert.equal(img.imageSrc, '/palau2/img/palau2-005-003.png');
  assert.equal(img.imageAlt, 'Inspo: JH peering over the 3d water map');
  assert.equal(img.imageKind, 'inspo');
  // The SOT rode along untouched.
  const sot = back.find((b) => b.type === 'sot');
  assert.equal(sot.id, 'sot_test_1');
  assert.equal(sot.timecode.tc, '00:27:04:17');
});

// ---- 3: the normalizeTableRows culler must never drop an image row -----------------------------
ok('normalizeTableRows (ensureTableDoc under palau2) keeps a word-less image row', () => {
  const normalized = ensureTableDoc(clone(doc)); // runs normalizePalauTableDoc (flag ON for palau2)
  const kinds = normalized.content
    .filter((r) => r.type === 'tableRow')
    .flatMap((r) => r.content.flatMap((c) => c.content.map((b) => b.type)));
  assert.ok(kinds.includes('imageBlock'), 'image row survived the empty-row cull');
});

// ---- paired (said|shown) image keeps its lane -----------------------------------------------
ok('a paired shown-lane image renders in the shown cell and round-trips lane/pairId', () => {
  const paired = ensureTableDoc(buildEditorDocument([
    { ...SOT_BLOCK, lane: 'said', width: 'half', pairId: 'pair_img_1' },
    { ...IMAGE_BLOCK, lane: 'shown', width: 'half', pairId: 'pair_img_1' },
  ]));
  const row = paired.content.find((r) => r.type === 'tableRow' && r.attrs?.cols === 2);
  assert.ok(row, 'paired row built');
  const shown = row.content.find((c) => c.attrs?.role === 'shown');
  assert.equal(shown.content[0].type, 'imageBlock');
  const back = docToBlocks(clone(PMNode.fromJSON(schema, paired).toJSON()));
  const img = back.find((b) => b.type === 'image');
  assert.equal(img.lane, 'shown');
  assert.equal(img.pairId, 'pair_img_1');
});

// ---- 4: INERT for Burma + Palau ------------------------------------------------------------------
ok('Burma + Palau seeds emit ZERO imageBlock nodes (addition is inert for them)', () => {
  const palau = JSON.parse(readFileSync(new URL('../../palau-script/palau-blocks.json', import.meta.url), 'utf8'));
  assert.ok(!palau.blocks.some((b) => b.type === 'image'), 'palau blocks carry no image type');
  const palauDoc = ensureTableDoc(buildEditorDocument(palau.blocks));
  assert.ok(!JSON.stringify(palauDoc).includes('"imageBlock"'), 'palau doc has no imageBlock');
  const burma = JSON.parse(readFileSync(new URL('../sample-blocks.json', import.meta.url), 'utf8'));
  const burmaBlocks = Array.isArray(burma) ? burma : (burma.blocks || []);
  assert.ok(!burmaBlocks.some((b) => b.type === 'image'), 'burma blocks carry no image type');
  const burmaDoc = ensureTableDoc(buildEditorDocument(burmaBlocks));
  assert.ok(!JSON.stringify(burmaDoc).includes('"imageBlock"'), 'burma doc has no imageBlock');
});

console.log(`image-block: ${pass} passed, 0 failed`);
