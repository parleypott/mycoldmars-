/*
 * celltag-caps.test.mjs — the per-CELL ONCAM / SOT identity caps (direction-chip.js
 * findLabelCellKinds + RUN_LABEL_KINDS + the generalized findCheckboxMarkRuns kinds parameter).
 *
 * Johnny 2026-07-21: "SOT and ONCAM tags shouldn't be inline — they should be just like the VO
 * tag which sits frozen in the upper left of a cell." The tags used to ride inline at each
 * contiguous run's head, so a run beginning mid-sentence jammed the cap into the middle of the
 * line. Now they collapse to ONE cap per kind, pinned at the cell's upper-left, decoration-only.
 *
 * Proves:
 *   1. RUN_LABEL_KINDS maps oncam → 'ONCAM' and sot → 'SOT' (the cap-text contract).
 *   2. One cap per kind per CELL regardless of run count — two separate oncam runs in one cell
 *      collapse to a SINGLE oncam cap.
 *   3. A cell holding BOTH kinds yields two caps, ordered oncam-then-sot.
 *   4. Cross-cell isolation — an oncam run in the SAID cell does not cap the SHOWN cell.
 *   5. Nested Palau rows — a run in the INNER leaf cell caps the leaf, never the wrapper cell.
 *   6. Default findCheckboxMarkRuns (no kinds arg) still returns only CHECKBOX kinds (archive) —
 *      the run-scan generalization cannot have changed archive-checkbox behavior.
 *
 * Run: bun src/extensions/celltag-caps.test.mjs  (auto-discovered by scripts/run-tests.mjs)
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
import {
  DirectionMark, RUN_LABEL_KINDS, findCheckboxMarkRuns, findLabelCellKinds,
} from './direction-chip.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
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
const cell = (role, inline) => ({
  type: 'tableCell', attrs: { role },
  content: [{
    type: 'noneBlock', attrs: { blockId: `b-${role}` },
    content: [{ type: 'paragraph', content: inline }],
  }],
});
// A single full-width row wrapping one cell of inline content.
const row = (inline) => PMNode.fromJSON(schema, {
  type: 'doc',
  content: [{ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell('full', inline)] }],
});

const markType = schema.marks.directionMark;

// Collect tableCell positions (the pos BEFORE each cell) in document order.
const cellPositions = (doc) => {
  const out = [];
  doc.descendants((node, pos) => { if (node.type.name === 'tableCell') out.push(pos); });
  return out;
};

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

ok('1. RUN_LABEL_KINDS contract', () => {
  assert.equal(RUN_LABEL_KINDS.oncam, 'ONCAM');
  assert.equal(RUN_LABEL_KINDS.sot, 'SOT');
});

ok('2. one cap per kind per cell regardless of run count', () => {
  // Two SEPARATE oncam runs (split by plain text) in a single cell → still ONE oncam cap.
  const doc = row([
    { type: 'text', text: 'JH: ', marks: [dm('oncam', 'static')] },
    { type: 'text', text: '"there\'s just hippos"', marks: [dm('oncam', 'static')] },
    { type: 'text', text: ' — then plain direction — ' },
    { type: 'text', text: 'back on camera', marks: [dm('oncam', 'static')] },
  ]);
  const caps = findLabelCellKinds(doc, markType);
  assert.equal(caps.length, 1);
  assert.deepEqual(caps[0].kinds, ['oncam']);
});

ok('3. both-kinds cell shows two caps, oncam then sot', () => {
  const doc = row([
    { type: 'text', text: 'on camera line', marks: [dm('oncam', 'static')] },
    { type: 'text', text: ' and ' },
    { type: 'text', text: 'a sot quote', marks: [dm('sot', 'static')] },
  ]);
  const caps = findLabelCellKinds(doc, markType);
  assert.equal(caps.length, 1);
  assert.deepEqual(caps[0].kinds, ['oncam', 'sot']);
});

ok('4. cross-cell isolation — oncam in SAID never caps SHOWN', () => {
  const doc = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 2, pairId: null },
      content: [
        cell('said', [{ type: 'text', text: 'on camera', marks: [dm('oncam', 'static')] }]),
        cell('shown', [{ type: 'text', text: 'plain shown direction' }]),
      ],
    }],
  });
  const caps = findLabelCellKinds(doc, markType);
  assert.equal(caps.length, 1);
  assert.deepEqual(caps[0].kinds, ['oncam']);
  // The cap belongs to the FIRST (said) cell, not the shown cell.
  const [saidPos] = cellPositions(doc);
  assert.equal(caps[0].cellPos, saidPos);
});

ok('5. nested Palau rows — run caps the INNER leaf cell, not the wrapper', () => {
  const doc = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' }, // wrapper cell
        content: [{
          type: 'tableRow', attrs: { cols: 1, pairId: null },
          content: [cell('full', [{ type: 'text', text: 'inner on camera', marks: [dm('oncam', 'static')] }])],
        }],
      }],
    }],
  });
  const caps = findLabelCellKinds(doc, markType);
  assert.equal(caps.length, 1);
  assert.deepEqual(caps[0].kinds, ['oncam']);
  // Two cells exist: [wrapper, leaf] in document order. The cap must target the LEAF (deeper pos).
  const positions = cellPositions(doc);
  assert.equal(positions.length, 2);
  const leafPos = Math.max(...positions);
  assert.equal(caps[0].cellPos, leafPos);
});

ok('6. default findCheckboxMarkRuns still returns only checkbox kinds', () => {
  const doc = row([
    { type: 'text', text: 'find the tape', marks: [dm('archive', 'needed')] },
    { type: 'text', text: 'on camera', marks: [dm('oncam', 'static')] },
  ]);
  const runs = findCheckboxMarkRuns(doc, markType);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, 'archive');
});

console.log(`celltag-caps: ${pass}/6 passed`);
