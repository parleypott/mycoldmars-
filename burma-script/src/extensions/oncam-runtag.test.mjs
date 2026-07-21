/*
 * oncam-runtag.test.mjs — the ONCAM run-identity tag (direction-chip.js RUN_LABEL_KINDS +
 * the generalized findCheckboxMarkRuns kinds parameter).
 *
 * Johnny 2026-07-21: "/oncam should create a little ONCAM tag like SOT and VO."
 * oncam runs render bare bold-italic ink (no box since 2026-07-09), so a decoration-only tag
 * at the head of each contiguous oncam run gives the line its identity cap without touching
 * the saved doc.
 *
 * Proves:
 *   1. RUN_LABEL_KINDS maps oncam → 'ONCAM' (the tag text contract the CSS + widget share).
 *   2. findCheckboxMarkRuns with the label kinds finds one run per CONTIGUOUS oncam stretch —
 *      two oncam runs separated by plain text yield two runs (two tags), never one.
 *   3. An adjacent run of a DIFFERENT kind (sot) never fuses into the oncam run.
 *   4. Default call (no kinds arg) still returns only CHECKBOX kinds (archive) — the
 *      generalization cannot have changed checkbox behavior.
 *
 * Run: bun src/extensions/oncam-runtag.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark, RUN_LABEL_KINDS, findCheckboxMarkRuns } from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

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

const dm = (kind, status) => ({ type: 'directionMark', attrs: { kind, status } });
const row = (inline) => PMNode.fromJSON(schema, {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'noneBlock', attrs: { blockId: 'b1' },
        content: [{ type: 'paragraph', content: inline }],
      }],
    }],
  }],
});

const markType = schema.marks.directionMark;
const labelKinds = Object.keys(RUN_LABEL_KINDS);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

ok('1. RUN_LABEL_KINDS contract', () => {
  assert.equal(RUN_LABEL_KINDS.oncam, 'ONCAM');
});

ok('2. one run per contiguous oncam stretch', () => {
  const doc = row([
    { type: 'text', text: 'JH: ', marks: [dm('oncam', 'static')] },
    { type: 'text', text: '"there\'s just hippos"', marks: [dm('oncam', 'static')] },
    { type: 'text', text: ' — then plain direction — ' },
    { type: 'text', text: 'back on camera', marks: [dm('oncam', 'static')] },
  ]);
  const runs = findCheckboxMarkRuns(doc, markType, labelKinds);
  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => r.kind === 'oncam'));
});

ok('3. adjacent sot run never fuses into the oncam run', () => {
  const doc = row([
    { type: 'text', text: 'on camera line', marks: [dm('oncam', 'static')] },
    { type: 'text', text: 'a sot quote', marks: [dm('sot', 'static')] },
  ]);
  const runs = findCheckboxMarkRuns(doc, markType, [...labelKinds, 'sot']);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((r) => r.kind), ['oncam', 'sot']);
});

ok('4. default call still returns only checkbox kinds', () => {
  const doc = row([
    { type: 'text', text: 'find the tape', marks: [dm('archive', 'needed')] },
    { type: 'text', text: 'on camera', marks: [dm('oncam', 'static')] },
  ]);
  const runs = findCheckboxMarkRuns(doc, markType);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'archive');
});

console.log(`oncam-runtag: ${pass}/4 passed`);
