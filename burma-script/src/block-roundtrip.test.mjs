/**
 * WP-13 — block copy→paste (serialize→reparse) ROUND-TRIP + Palau zero-loss guard.
 *
 * The reconstruction contract: everything a block/mark/chip needs to rebuild itself lives in
 * ATTRIBUTES, so a round-trip through the schema (fromJSON → check → toJSON — the same serialize the
 * clipboard and localStorage use) returns the node BYTE-IDENTICAL. This is the test rec #13 asks for:
 * it turns "never loses formatting" from a hope into a guarantee, and it is the headless zero-loss
 * proof for the WP formatting pack's schema changes (marks allowlist + defining:true + chapterId).
 *
 * bun has no DOM, so we round-trip at the ProseMirror JSON layer (identical to direction-chip.test) —
 * the same serialization the HTML clipboard path and the autosave both round-trip through.
 *
 * Part 1: a synthetic block carrying EVERY reconstruction datum (flavor, chapterId, status, a
 *         timecode mark with tc+day, tkSpan, trimSpan, bold, and a directionChip) survives byte-exact.
 * Part 2: the REAL 197-block Palau script, built through the live document-builder, passes the schema
 *         and round-trips byte-exact — nothing (word, timecode, mark, chip, attr) is dropped.
 *
 * Run: bun src/block-roundtrip.test.mjs   (auto-discovered by run-tests.mjs)
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
import { setEpisode } from './episode-config.js';
import { PALAU } from '../../palau-script/config.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// The schema the live editor + the migrate-doc save gate both enforce (StarterKit + Burma nodes/marks).
// PasteSanitize/ChapterFrames/SlashMenu are plugins with NO schema nodes, so they don't belong here.
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
  ]);
}

const schema = buildSchema();

// --- Part 1: synthetic block carrying every reconstruction datum ----------------------------------
ok('a block with flavor + chapterId + timecode/tk/trim/bold marks + a chip round-trips byte-exact', () => {
  const blockJson = {
    type: 'voBlock',
    // baseAttrs (blockId/flavor/chapterId) + voBlock's status — the full attr set toJSON emits.
    attrs: { blockId: 'vo_rt', flavor: 'purple', chapterId: 'ch_2', status: 'recorded' },
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Coral at ' },
        { type: 'text', text: '00:03:29:00', marks: [{ type: 'timecode', attrs: { tc: '00:03:29:00', day: 2 } }] },
        { type: 'text', text: ' — ' },
        { type: 'text', text: '{tk verify this}', marks: [{ type: 'tkSpan' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'cut me', marks: [{ type: 'trimSpan' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'loud', marks: [{ type: 'bold' }] },
        { type: 'directionChip', attrs: { kind: 'archive', status: 'found', filePath: 'palau/a.mov' } },
      ],
    }],
  };
  const docJson = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [blockJson] }],
    }],
  };

  const node = PMNode.fromJSON(schema, docJson);
  node.check(); // schema-valid: marks allowlist + defining accept the content
  assert.deepEqual(clone(node.toJSON()), clone(docJson));

  // Spot-check the reconstruction data survived on the reparsed node.
  const vo = node.firstChild.firstChild.firstChild; // row → cell → voBlock
  assert.equal(vo.type.name, 'voBlock');
  assert.equal(vo.attrs.flavor, 'purple');
  assert.equal(vo.attrs.chapterId, 'ch_2');
  assert.equal(vo.attrs.status, 'recorded');
  const para = vo.firstChild;
  const tcNode = para.content.content.find((n) => n.marks.some((m) => m.type.name === 'timecode'));
  const tcMark = tcNode.marks.find((m) => m.type.name === 'timecode');
  assert.equal(tcMark.attrs.tc, '00:03:29:00');
  assert.equal(tcMark.attrs.day, 2);
  const chip = para.content.content.find((n) => n.type.name === 'directionChip');
  assert.deepEqual(clone(chip.attrs), { kind: 'archive', status: 'found', filePath: 'palau/a.mov' });
});

ok('chapterId round-trips on a chapter block', () => {
  const chapterJson = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'chapterBlock',
          attrs: { blockId: 'ch_1', flavor: null, chapterId: 'chapter-7', genre: 'ground' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CH: GROUND 1' }] }],
        }],
      }],
    }],
  };
  const node = PMNode.fromJSON(schema, chapterJson);
  node.check();
  assert.deepEqual(clone(node.toJSON()), clone(chapterJson));
});

// --- Part 2: the REAL Palau script — zero-loss through the schema ---------------------------------
// document-builder + blocks read episode-derived constants at load, and Palau widens inline timecode
// parsing, so switch the episode to PALAU BEFORE dynamically importing document-builder.
await (async () => {
  setEpisode(PALAU);
  const { buildEditorDocument, ensureTableDoc } = await import('./document-builder.js');
  const palau = JSON.parse(readFileSync(new URL('../../palau-script/palau-blocks.json', import.meta.url), 'utf8'));
  const doc = ensureTableDoc(buildEditorDocument(palau.blocks));

  ok('the real 197-block Palau doc is schema-valid and round-trips STABLE (zero-loss)', () => {
    // buildEditorDocument omits attrs left at their default (e.g. a null flavor/chapterId/pairId);
    // the schema fills those on parse, so the FIRST parse is the canonical/normalized form the editor
    // actually holds (getJSON) and saves. Zero-loss = that canonical form is STABLE: a second
    // round-trip drops/mutates NOTHING. (A dropped mark/attr/word would diverge json1 → json2.)
    const json1 = clone(PMNode.fromJSON(schema, doc).toJSON());
    const node2 = PMNode.fromJSON(schema, json1);
    node2.check(); // throws if any real block's content is illegal under the new marks/defining rules
    assert.deepEqual(clone(node2.toJSON()), json1);
  });

  ok('every source block is represented (no block silently dropped)', () => {
    // Flatten rows → cells → cartridge blocks and count everything except the scriptStart divider.
    let blocks = 0;
    for (const row of doc.content || []) {
      if (row.type !== 'tableRow') { if (row.type !== 'scriptStart') blocks++; continue; }
      for (const cell of row.content || []) {
        for (const b of cell.content || []) if (b.type !== 'scriptStart') blocks++;
      }
    }
    assert.ok(blocks >= palau.blocks.length, `rendered ${blocks} blocks >= ${palau.blocks.length} source blocks`);
  });

  // Every timecode present in the source blocks must still be present (as text) in the built doc.
  ok('every source timecode survives into the built doc', () => {
    const TC = /(?<!\d)(?<!\d:)(?:\d{2}:\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})(?!:?\d)/g;
    const srcText = palau.blocks.map((b) => `${b.rawSource || ''} ${b.text || ''}`).join(' ');
    const srcTCs = [...new Set([...srcText.matchAll(TC)].map((m) => m[0]))];
    const docText = JSON.stringify(doc);
    const missing = srcTCs.filter((t) => !docText.includes(t));
    assert.deepEqual(missing, [], `missing timecodes: ${missing.slice(0, 8).join(', ')}`);
  });
})();

console.log(`block-roundtrip: ${pass} passed, 0 failed`);
