/*
 * fc-flag.test.mjs — the fact-check FLAG model (Johnny 2026-07-07): assertions are quiet
 * editable prose; the ONLY click target is the red-square widget at the end of each
 * UNVERIFIED run (findPendingFcRuns drives the decorations); checked claims lose the flag
 * and keep the green wash (status attr). Run: bun src/extensions/fc-flag.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS, findPendingFcRuns } from './marks.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  ...BURMA_TABLE_NODES, ...BURMA_NODES, ...BURMA_MARKS,
]);
const fcType = schema.marks.factCheckSpan;

const doc = (paraContent) => PMNode.fromJSON(schema, {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{ type: 'paragraph', content: paraContent }],
    }],
  }],
});
const fc = (text, status) => ({
  type: 'text', text,
  marks: [{ type: 'factCheckSpan', ...(status ? { attrs: { status } } : {}) }],
});

ok('an unverified assertion yields ONE run spanning its full contiguous text', () => {
  const d = doc([{ type: 'text', text: 'intro ' }, fc('claim about canals'), { type: 'text', text: ' outro' }]);
  const runs = findPendingFcRuns(d, fcType);
  assert.equal(runs.length, 1);
  assert.equal(d.textBetween(runs[0].from, runs[0].to), 'claim about canals');
});

ok('a claim fragmented into multiple text nodes (embedded extra marks) is still ONE run/flag', () => {
  const d = doc([
    { type: 'text', text: 'claim with a ', marks: [{ type: 'factCheckSpan' }] },
    { type: 'text', text: 'bold bit', marks: [{ type: 'factCheckSpan' }, { type: 'bold' }] },
    { type: 'text', text: ' and a tail', marks: [{ type: 'factCheckSpan' }] },
  ]);
  const runs = findPendingFcRuns(d, fcType);
  assert.equal(runs.length, 1, 'fragments merge — one claim, one red square');
  assert.equal(d.textBetween(runs[0].from, runs[0].to), 'claim with a bold bit and a tail');
});

ok('a CHECKED claim yields NO run — the red flag yields to the green ✓', () => {
  const d = doc([fc('verified claim', 'checked')]);
  assert.equal(findPendingFcRuns(d, fcType).length, 0);
});

ok('mixed doc: pending runs found, checked runs skipped, separated claims get separate flags', () => {
  const d = doc([
    fc('first open claim'),
    { type: 'text', text: ' … meanwhile … ' },
    fc('already verified', 'checked'),
    { type: 'text', text: ' and ' },
    fc('second open claim'),
  ]);
  const runs = findPendingFcRuns(d, fcType);
  assert.equal(runs.length, 2);
  assert.equal(d.textBetween(runs[0].from, runs[0].to), 'first open claim');
  assert.equal(d.textBetween(runs[1].from, runs[1].to), 'second open claim');
});

ok('status attr round-trips through JSON (checked survives save/reload; default is pending)', () => {
  const d = doc([fc('verified claim', 'checked'), { type: 'text', text: ' ' }, fc('open claim')]);
  const back = PMNode.fromJSON(schema, d.toJSON());
  const marks = [];
  back.descendants((n) => { if (n.isText) { const m = n.marks.find((x) => x.type === fcType); if (m) marks.push(m.attrs.status); } });
  assert.deepEqual(marks, ['checked', 'pending']);
});

ok('inclusive typing: factCheckSpan is inclusive so end-of-span insertions adopt the mark', () => {
  assert.equal(fcType.spec.inclusive, true);
});

console.log('fc-flag: ' + pass + '/6 passed');
