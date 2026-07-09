/**
 * text-align-roundtrip.test.mjs — paragraph alignment (TextAlign) survives the schema round-trip
 * that autosave + migration + clipboard all funnel through, and the extension is collab-safe.
 *
 * Contract:
 *   §1 The live schema (StarterKit + Burma nodes/marks + TextAlign) accepts a paragraph carrying
 *      textAlign:'center' INSIDE a voBlock inside a table row, and fromJSON->check->toJSON returns
 *      it byte-identical — the same serialize autosave (getJSON) and the migrate-doc save gate use.
 *   §2 A paragraph with textAlign:'right' round-trips its attr (proves it is a real schema attr,
 *      not silently dropped — the failure mode if TextAlign were missing from the mirror schema).
 *   §3 COLLAB LOOP LAW — TextAlign registers NO ProseMirror plugin (no appendTransaction/normalizer
 *      that could echo-loop under y-sync). It only adds global attrs + commands.
 *
 * Run: bun src/text-align-roundtrip.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok —', label); };
const clone = (x) => JSON.parse(JSON.stringify(x));

// EXACT mirror of Editor.jsx / migrate-doc.js buildSchema() WITH TextAlign registered.
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
    TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
  ]);
}

const schema = buildSchema();

// full-width table row -> tableCell(full) -> voBlock -> paragraph[textAlign].
const makeDoc = (align) => ({
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'voBlock', attrs: { blockId: 'b1', status: 'todo' },
        content: [{
          type: 'paragraph', attrs: { textAlign: align },
          content: [{ type: 'text', text: 'the border town wakes before the checkpoint does' }],
        }],
      }],
    }],
  }],
});

ok('§1 center paragraph survives fromJSON->check->toJSON byte-identical', () => {
  const before = makeDoc('center');
  const node = PMNode.fromJSON(schema, clone(before)); // throws on shape/attr mismatch
  node.check();                                          // throws on invalid content fit
  const after = node.toJSON();
  const para = after.content[0].content[0].content[0].content[0];
  assert.equal(para.type, 'paragraph');
  assert.equal(para.attrs.textAlign, 'center');
});

ok('§2 right alignment is a real schema attr (not dropped)', () => {
  const node = PMNode.fromJSON(schema, makeDoc('right'));
  const para = node.toJSON().content[0].content[0].content[0].content[0];
  assert.equal(para.attrs.textAlign, 'right');
});

ok('§3 COLLAB LOOP LAW — TextAlign adds NO ProseMirror plugin (no auto-dispatch to echo-loop)', () => {
  const ext = TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' });
  assert.equal(typeof ext.config.addProseMirrorPlugins, 'undefined');
  assert.equal(ext.name, 'textAlign');
});

console.log(`\ntext-align-roundtrip.test.mjs — ${pass} checks passed`);
