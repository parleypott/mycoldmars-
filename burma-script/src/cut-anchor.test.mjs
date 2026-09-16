/**
 * cut-anchor.js — the pure decision core behind the cut dock — plus the schema contract for the
 * `cutTc` block attribute (baseAttrs in extensions/blocks.js):
 *   • parseTc / formatTc / normalizeCutTc / activeAnchor / cutDomAttrs / readCut behave as documented
 *   • a block WITH cutTc round-trips byte-exact through the live schema, and a block WITHOUT it
 *     parses unchanged (additive attr, default null) — so every existing doc is untouched.
 *
 * Run: bun src/cut-anchor.test.mjs   (auto-discovered by scripts/run-tests.mjs)
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
import { parseTc, formatTc, normalizeCutTc, activeAnchor, cutDomAttrs, readCut } from './cut-anchor.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

ok('parseTc accepts hh:mm:ss, h:mm:ss, mm:ss, bracketed, fractional, bare seconds', () => {
  assert.equal(parseTc('00:04:44'), 284);
  assert.equal(parseTc('1:02:03'), 3723);
  assert.equal(parseTc('04:44'), 284);
  assert.equal(parseTc('[00:04:44]'), 284);
  assert.equal(parseTc('00:00:01.5'), 1.5);
  assert.equal(parseTc('284'), 284);
  assert.equal(parseTc(284.25), 284.25);
});
ok('parseTc rejects garbage, negatives and out-of-range fields', () => {
  for (const bad of [null, undefined, '', 'abc', '00:61:00', '00:00:60', -1, NaN, '1:2:3:4']) assert.equal(parseTc(bad), null, String(bad));
});
ok('formatTc floors to whole seconds and pads; invalid → empty', () => {
  assert.equal(formatTc(284), '00:04:44');
  assert.equal(formatTc(284.9), '00:04:44');
  assert.equal(formatTc(3723), '01:02:03');
  assert.equal(formatTc(0), '00:00:00');
  for (const bad of [null, -1, NaN, 'x']) assert.equal(formatTc(bad), '');
});
ok('normalizeCutTc rounds to ms and nulls invalid', () => {
  assert.equal(normalizeCutTc('00:04:44'), 284);
  assert.equal(normalizeCutTc(1.23456), 1.235);
  assert.equal(normalizeCutTc('nope'), null);
});
ok('activeAnchor picks the greatest tc <= t; ties → later in document order; before first → null', () => {
  const a = [{ tc: 0, id: 'a' }, { tc: 82, id: 'b' }, { tc: 284, id: 'c' }, { tc: 284, id: 'd' }, { tc: 362, id: 'e' }];
  assert.equal(activeAnchor(a, 0).id, 'a');
  assert.equal(activeAnchor(a, 81.9).id, 'a');
  assert.equal(activeAnchor(a, 82).id, 'b');
  assert.equal(activeAnchor(a, 300).id, 'd');
  assert.equal(activeAnchor(a, 9999).id, 'e');
  assert.equal(activeAnchor([{ tc: 10 }], 5), null);
  assert.equal(activeAnchor([], 5), null);
  assert.equal(activeAnchor(a, NaN), null);
  assert.equal(activeAnchor(a.map((x) => ({ ...x, tc: undefined })), 5), null);
});
ok('cutDomAttrs: seconds + label when anchored, nothing when not', () => {
  assert.deepEqual(cutDomAttrs(284), { 'data-cut-tc': '284', 'data-cut-label': '00:04:44' });
  assert.deepEqual(cutDomAttrs(null), {});
  assert.deepEqual(cutDomAttrs(undefined), {});
  assert.deepEqual(cutDomAttrs(-3), {});
});
ok('readCut only accepts a real url; label/duration optional', () => {
  assert.equal(readCut(null), null);
  assert.equal(readCut({}), null);
  assert.equal(readCut({ cut: { url: '' } }), null);
  assert.equal(readCut({ cut: { url: 42 } }), null);
  assert.deepEqual(readCut({ cut: { url: ' https://x/y.mp4 ' } }), { url: 'https://x/y.mp4', label: '', duration: null });
  assert.deepEqual(readCut({ cut: { url: 'https://x/y.mp4', label: 'L', duration: 2381.5 } }), { url: 'https://x/y.mp4', label: 'L', duration: 2381.5 });
});

// ── schema contract (byte-mirror of migrate-doc.js buildSchema) ──
const schema = getSchema([
  StarterKit.configure({ heading: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, dropcursor: false, gapcursor: false, history: { depth: 100, newGroupDelay: 750 } }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }), Gapcursor,
  ...BURMA_TABLE_NODES, ...BURMA_NODES, ...BURMA_MARKS, DirectionMark,
  TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'], defaultAlignment: 'left' }),
]);
const rowWith = (block) => ({ type: 'doc', content: [{ type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null }, content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [block] }] }] });

ok('a voBlock WITH cutTc round-trips byte-exact and renders data-cut-* attrs', () => {
  const block = { type: 'voBlock', attrs: { blockId: 'vo_1', flavor: null, chapterId: null, pendingViz: null, cutTc: 284, status: 'in-edit' }, content: [{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'Jack is taking us to the pagoda' }] }] };
  const node = PMNode.fromJSON(schema, rowWith(block)); node.check();
  assert.deepEqual(clone(node.toJSON()), clone(rowWith(block)));
  const vo = node.firstChild.firstChild.firstChild; assert.equal(vo.attrs.cutTc, 284);
  const html = schema.nodes.voBlock.spec.toDOM(vo); const attrs = html[1];
  assert.equal(attrs['data-cut-tc'], '284'); assert.equal(attrs['data-cut-label'], '00:04:44');
});
ok('a voBlock WITHOUT cutTc (legacy JSON) parses to cutTc:null and renders no data-cut-* attrs', () => {
  const legacy = { type: 'voBlock', attrs: { blockId: 'vo_2', flavor: null, chapterId: null, pendingViz: null, status: 'todo' }, content: [{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'old line' }] }] };
  const node = PMNode.fromJSON(schema, rowWith(legacy)); node.check();
  const vo = node.firstChild.firstChild.firstChild; assert.equal(vo.attrs.cutTc, null);
  const attrs = schema.nodes.voBlock.spec.toDOM(vo)[1];
  assert.equal('data-cut-tc' in attrs, false); assert.equal('data-cut-label' in attrs, false);
  // and toJSON now carries the default explicitly — the only delta vs the legacy bytes
  const back = clone(node.toJSON()); assert.equal(back.content[0].content[0].content[0].attrs.cutTc, null);
});
ok('every script cartridge node type declares cutTc (so ANCHOR @ PLAYHEAD reaches any box)', () => {
  const names = ['chapterBlock', 'sceneBlock', 'voBlock', 'oncamBlock', 'sotBlock', 'brollBlock', 'noteBlock', 'binBlock'];
  for (const n of names) assert.ok(schema.nodes[n] && 'cutTc' in schema.nodes[n].spec.attrs, n);
  assert.equal('cutTc' in schema.nodes.paragraph.spec.attrs, false, 'paragraph stays anchor-free');
});

console.log(`cut-anchor: ${pass} passed, 0 failed`);
