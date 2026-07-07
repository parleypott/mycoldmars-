// STRUCTURE board — TRIPLE-LOCK on the block-assembly / containment engine.
//
// The single most load-bearing feature of the STRUCTURE board is deciding which
// card lands in which act / normal-frame / loose group. That grouping drives BOTH
// the on-screen Story Outline AND the NLE marker export (order + timecodes). The
// exact same act→normalFrame→loose containment algorithm is hand-copied into THREE
// inline handlers in index.html:
//   1. generateStoryOutline()                 — the live outline panel
//   2. the #outline-copy-btn click handler    — "copy as plaintext script"
//   3. the #outline-export-markers-btn handler — NLE marker CSV export
//
// They are behaviorally identical TODAY, but nothing pinned that. A fix to one
// (e.g. changing containment to card-edge instead of card-center, or the sort key)
// would SILENTLY drift the editor's outline from its exports — the producer sees
// one order on screen and a different order in Premiere. This lock slices all three
// regions VERBATIM from the shipped index.html at runtime and proves:
//   (a) all three produce byte-identical grouping on the same board, and
//   (b) that grouping matches a concrete expected structure (act-first dedup,
//       normal-frames sorted by x, empty frames skipped, loose fallback, y-sort
//       within a block).
// Edit one copy and not the others → this test goes RED. It converts the documented
// divergence hazard into a test-visible one without touching production code.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Each region runs from `const placedCardIds = new Set();` up to (not including)
// the region's own `blocks.forEach(block =>`. Non-greedy, so each match stops at
// the FIRST blocks.forEach after its placedCardIds — there is exactly one per
// region. matchAll yields the three regions in document order.
const RE = /(const placedCardIds = new Set\(\);[\s\S]*?)\n\s*blocks\.forEach\(block =>/g;
const regions = [...html.matchAll(RE)].map(m => m[1]);

assert.equal(regions.length, 3,
  `expected exactly 3 block-assembly copies in index.html, found ${regions.length} ` +
  `(the triplication moved or changed shape — re-verify the copies still match)`);

// Wrap each sliced region as a pure function of (state, cardWidth, cardHeight).
// The region references those three free identifiers and nothing else DOM-bound.
const builders = regions.map((body, i) => {
  try {
    return new Function('state', 'cardWidth', 'cardHeight', `${body}\nreturn blocks;`);
  } catch (e) {
    throw new Error(`region #${i + 1} failed to compile as a pure builder: ${e.message}`);
  }
});

const LABELS = ['generateStoryOutline', 'outline-copy-btn', 'export-markers-btn'];

// Fixed card box so a card's center is deterministic: center = (x+120, y+30).
const cardWidth = () => 240;
const cardHeight = () => 60;

// Synthetic board exercising every branch:
//  - actA (an act) spans a big region; frameC (normal) is NESTED inside actA;
//    frameB (normal) sits well outside actA.
//  - c1 sits inside BOTH actA and frameC → acts run FIRST, so actA claims it
//    (placedCardIds dedup); frameC must NOT re-grab it.
//  - c4 inside actA only.
//  - c2 inside frameB only.
//  - c3 far away → loose.
const state = {
  frames: [
    { id: 'actA',   isAct: true,  x: 0,    y: 0,   width: 1000, height: 2000, title: 'Act I' },
    { id: 'frameB', isAct: false, x: 1200, y: 0,   width: 400,  height: 800,  title: 'Cold Open' },
    { id: 'frameC', isAct: false, x: 100,  y: 100, width: 300,  height: 300,  title: 'Nested' },
  ],
  cards: [
    { id: 'c1', x: 100,  y: 100,  duration: '10' },  // center 220,130  -> actA (also in frameC)
    { id: 'c2', x: 1300, y: 100,  duration: '10' },  // center 1420,130 -> frameB
    { id: 'c3', x: 5000, y: 5000, duration: '10' },  // center 5120,5030 -> loose
    { id: 'c4', x: 200,  y: 500,  duration: '10' },  // center 320,530  -> actA (y past frameC)
  ],
};

// Normalize a blocks[] to just the load-bearing shape: title + card-id order.
const shape = (blocks) => blocks.map(b => ({ title: b.title, ids: b.cards.map(c => c.id) }));

const results = builders.map(fn => shape(fn(state, cardWidth, cardHeight)));

// (a) All three copies agree — the anti-divergence lock.
assert.deepStrictEqual(results[0], results[1],
  `${LABELS[0]} and ${LABELS[1]} grouped the same board DIFFERENTLY — the copies drifted`);
assert.deepStrictEqual(results[1], results[2],
  `${LABELS[1]} and ${LABELS[2]} grouped the same board DIFFERENTLY — the copies drifted`);

// (b) The grouping is the concrete correct one (RED-on-main proof: computed by hand).
//  - Act pushed unconditionally, cards sorted by y: c1(y100) then c4(y500).
//  - normalFrames sorted by x: frameC(x100) first but it's EMPTY (c1/c4 claimed by
//    act) -> skipped; frameB(x1200) -> [c2].
//  - loose: c3.
const expected = [
  { title: 'Act I', ids: ['c1', 'c4'] },
  { title: 'Cold Open', ids: ['c2'] },
  { title: 'Loose Story Elements', ids: ['c3'] },
];
results.forEach((r, i) => {
  assert.deepStrictEqual(r, expected,
    `${LABELS[i]} produced the wrong grouping.\n  got:      ${JSON.stringify(r)}\n  expected: ${JSON.stringify(expected)}`);
});

// Guard the specific invariants a future edit is most likely to break:
//  - act-first dedup: c1 is in actA, NOT in the (nested) frameC group.
const actBlock = results[0].find(b => b.title === 'Act I');
assert.ok(actBlock && actBlock.ids.includes('c1'),
  'act-first dedup broke: a card inside both an act and a nested frame must land in the ACT');
assert.ok(!results[0].some(b => b.title === 'Nested'),
  'empty-frame skip broke: the nested frame claimed no cards and must NOT appear as a group');

console.log('structure block-assembly triple-lock: OK (3 copies agree + match expected grouping)');
