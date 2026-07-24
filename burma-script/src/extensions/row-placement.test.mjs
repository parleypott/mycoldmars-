/*
 * row-placement.test.mjs — TRANSFER / COPY SECTION placement-mode decorations (row-placement.js).
 *
 * Placement mode is decoration-only interaction state: it dispatches NOTHING to the doc until the
 * user clicks a gap (COLLAB LOOP LAW). This suite proves the pure pieces:
 *   1. buildPlacementDecorations LIFTS exactly the section rows and paints a GAP widget at every
 *      legal top-level boundary — suppressing the section's own edges + interior.
 *   2. It NEVER mutates the input doc (pure read).
 *   3. A section that no longer resolves (deleted mid-placement) degrades to an EMPTY set, not a
 *      stuck overlay.
 *   4. The whole-doc selection leaves NO gap (a transfer of every row is a no-op by construction).
 *
 * Run: bun src/extensions/row-placement.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_TABLE_NODES, rowFirstBlockId } from './table.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';
import { buildPlacementDecorations } from './row-placement.js';
import { setEpisode } from '../episode-config.js';
import { BURMA } from '../../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false, history: false,
  }),
  Dropcursor, Gapcursor,
  ...BURMA_TABLE_NODES, ...BURMA_NODES, ...BURMA_MARKS, DirectionMark,
]);

const docFrom = (json) => PMNode.fromJSON(schema, json);
const row = (id, text) => ({
  type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
  content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [
    { type: 'noneBlock', attrs: { blockId: id }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  ] }],
});
const fiveRowJson = () => ({ type: 'doc', content: [
  row('r0', 'zero'), row('r1', 'one'), row('r2', 'two'), row('r3', 'three'), row('r4', 'four'),
] });

const refsForIndices = (doc, indices) => indices.map((i) => {
  const node = doc.child(i);
  return { node, blockId: rowFirstBlockId(node), pairId: node.attrs?.pairId || null };
});

// Count decoration kinds by peeking at DecorationSet.find (specs expose type + attrs/widget).
function summarize(set, doc) {
  const decos = set.find(0, doc.content.size);
  let lifts = 0;
  const gapIndices = [];
  for (const d of decos) {
    // Node decorations carry a class attr; widget decorations carry a toDOM in spec.
    const spec = d.spec || {};
    if (spec.key && String(spec.key).startsWith('wp-gap-')) {
      gapIndices.push(Number(String(spec.key).slice('wp-gap-'.length)));
    } else {
      lifts += 1;
    }
  }
  gapIndices.sort((a, b) => a - b);
  return { lifts, gapIndices };
}

// ── 1: lift + gaps ──────────────────────────────────────────────────────────────────────────────
ok('lifts the section rows and paints a gap at every legal boundary', () => {
  const doc = docFrom(fiveRowJson());
  // Section [1,3): rows r1, r2. 5 rows → 6 boundaries [0..5]; suppress [1,2,3] → gaps 0,4,5.
  const set = buildPlacementDecorations(doc, { mode: 'transfer', rowRefs: refsForIndices(doc, [1, 2]) });
  const { lifts, gapIndices } = summarize(set, doc);
  assert.equal(lifts, 2, 'two rows lifted');
  assert.deepEqual(gapIndices, [0, 4, 5], 'gaps only outside the section + its edges');
});

ok('a single-row section suppresses only its own two edges', () => {
  const doc = docFrom(fiveRowJson());
  // Section [2,3): row r2. Suppress gaps 2,3 → gaps 0,1,4,5.
  const set = buildPlacementDecorations(doc, { mode: 'copy', rowRefs: refsForIndices(doc, [2]) });
  const { lifts, gapIndices } = summarize(set, doc);
  assert.equal(lifts, 1, 'one row lifted');
  assert.deepEqual(gapIndices, [0, 1, 4, 5], 'both edges of the single row suppressed');
});

// ── 2: purity ───────────────────────────────────────────────────────────────────────────────────
ok('buildPlacementDecorations never mutates the input doc', () => {
  const doc = docFrom(fiveRowJson());
  const before = clone(doc.toJSON());
  buildPlacementDecorations(doc, { mode: 'transfer', rowRefs: refsForIndices(doc, [0, 1, 2]) });
  assert.deepEqual(doc.toJSON(), before, 'doc JSON unchanged after building decorations');
});

// ── 3: stale section degrades to empty ──────────────────────────────────────────────────────────
ok('a section that no longer resolves degrades to an empty set', () => {
  const doc = docFrom(fiveRowJson());
  // Refs that point at nodes from a DIFFERENT doc (never present here) → nothing resolves.
  const otherDoc = docFrom(fiveRowJson());
  const staleRefs = [{ node: otherDoc.child(1), blockId: 'ghost', pairId: 'pairu_ghost' }];
  const set = buildPlacementDecorations(doc, { mode: 'transfer', rowRefs: staleRefs });
  assert.equal(set, DecorationSet.empty, 'empty decoration set for an unresolvable section');
  // Null/empty session → empty too.
  assert.equal(buildPlacementDecorations(doc, null), DecorationSet.empty, 'null session → empty');
  assert.equal(buildPlacementDecorations(doc, { mode: 'transfer', rowRefs: [] }), DecorationSet.empty, 'no refs → empty');
});

// ── 4: whole-doc selection leaves no gap ────────────────────────────────────────────────────────
ok('selecting every row leaves no legal transfer gap (no-op by construction)', () => {
  const doc = docFrom(fiveRowJson());
  const set = buildPlacementDecorations(doc, { mode: 'transfer', rowRefs: refsForIndices(doc, [0, 1, 2, 3, 4]) });
  const { lifts, gapIndices } = summarize(set, doc);
  assert.equal(lifts, 5, 'all five rows lifted');
  assert.deepEqual(gapIndices, [], 'no gap to move the whole doc into');
});

console.log(`row-placement.test.mjs: ${pass} assertions passed`);
