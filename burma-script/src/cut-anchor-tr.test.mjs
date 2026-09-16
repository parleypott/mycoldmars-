/**
 * ANCHOR @ PLAYHEAD write path (CutDock.jsx anchorTrFor) on a bare ProseMirror EditorState with the live
 * save-gate schema: caret inside a cartridge → that cartridge's cutTc is stamped and nothing else changes;
 * caret in a cell paragraph outside any cartridge → null (no transaction); invalid time → null.
 *
 * Run: bun src/cut-anchor-tr.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import TextAlign from '@tiptap/extension-text-align';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { anchorTrFor } from './CutDock.jsx';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const schema = getSchema([
  StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, dropcursor: false, gapcursor: false, history: { depth: 100, newGroupDelay: 750 } }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }), Gapcursor,
  ...BURMA_TABLE_NODES, ...BURMA_NODES, ...BURMA_MARKS, DirectionMark,
  TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
]);
const p = (text) => ({ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text }] });
const docJson = { type: 'doc', content: [
  { type: 'tableRow', attrs: { cols: 2, pairId: 'pair_1', bookmarkId: null }, content: [
    { type: 'tableCell', attrs: { role: 'said' }, content: [{ type: 'voBlock', attrs: { blockId: 'vo_a', flavor: null, chapterId: null, pendingViz: null, cutTc: null, status: 'todo' }, content: [p('Jack takes us deep into the countryside')] }] },
    { type: 'tableCell', attrs: { role: 'shown' }, content: [p('driving b-roll')] },
  ] },
] };
const doc = PMNode.fromJSON(schema, docJson); doc.check();
const stateAt = (pos) => EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
// positions: find the text nodes
let voTextPos = -1, shownTextPos = -1;
doc.descendants((node, pos) => { if (node.isText && /Jack takes/.test(node.text)) voTextPos = pos + 3; if (node.isText && /driving/.test(node.text)) shownTextPos = pos + 2; });

ok('caret inside a voBlock → that block gets cutTc, doc otherwise identical', () => {
  const r = anchorTrFor(stateAt(voTextPos), 1836.4);
  assert.ok(r && r.tr, 'transaction produced'); assert.equal(r.tc, 1836.4);
  const next = stateAt(voTextPos).apply(r.tr);
  const vo = next.doc.firstChild.firstChild.firstChild;
  assert.equal(vo.type.name, 'voBlock'); assert.equal(vo.attrs.cutTc, 1836.4); assert.equal(vo.attrs.blockId, 'vo_a'); assert.equal(vo.attrs.status, 'todo');
  assert.equal(next.doc.textContent, doc.textContent, 'text untouched');
  const before = JSON.parse(JSON.stringify(doc.toJSON())); const after = JSON.parse(JSON.stringify(next.doc.toJSON()));
  before.content[0].content[0].content[0].attrs.cutTc = 1836.4; assert.deepEqual(after, before, 'only cutTc changed');
});
ok('caret in a plain cell paragraph (no cartridge) → null', () => {
  assert.equal(anchorTrFor(stateAt(shownTextPos), 10), null);
});
ok('invalid time → null; null state → null', () => {
  assert.equal(anchorTrFor(stateAt(voTextPos), NaN), null);
  assert.equal(anchorTrFor(stateAt(voTextPos), -5), null);
  assert.equal(anchorTrFor(null, 5), null);
});
ok('re-stamping overwrites the previous anchor', () => {
  const s1 = stateAt(voTextPos).apply(anchorTrFor(stateAt(voTextPos), 100).tr);
  const s2 = EditorState.create({ doc: s1.doc, selection: TextSelection.create(s1.doc, voTextPos) });
  const s3 = s2.apply(anchorTrFor(s2, 250).tr);
  assert.equal(s3.doc.firstChild.firstChild.firstChild.attrs.cutTc, 250);
});
console.log(`cut-anchor-tr: ${pass} passed, 0 failed`);
