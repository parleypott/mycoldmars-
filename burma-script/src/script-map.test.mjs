/*
 * script-map.test.mjs — the SCRIPT MAP model contract (script-map.js).
 *
 * Proves:
 *   1. DOMINANT KIND — per-row: most marked-text coverage among VISUAL_KINDS in
 *      the SHOWN lane / full-width cells; brollBlock counts as broll (an empty
 *      one nominally); said-lane chips never count; tie-break priority order.
 *   2. OVERRIDES — pendingViz beats chips; empty shown lane → unplanned;
 *      no shown lane → neutral.
 *   3. CHAPTER GROUPING — front matter (ordinal 0) before the first chapter;
 *      chapters split segments; segments never span a chapter boundary.
 *   4. TIMED-WORD PROPORTIONING — segment timedWords = said/full-lane spoken
 *      words of its rows (the workspaces.js taxonomy).
 *   5. SMOOTHING — a 1-row real-kind island between two same-kind runs is
 *      absorbed; pending/unplanned islands are NEVER absorbed; neutral rows
 *      never merge; smooth:false returns the raw runs.
 *   6. TOTALS — plannedPct (planned words / planned+hazard words), hazard ROW
 *      counts, byKind roll-up, minutes @130.
 *   7. NESTED ROWS (Palau) — a shown lane inside a nested row classifies the
 *      top-level wrapper row.
 *   8. VIEW MATH — segmentPx floors/hairlines, segmentTag text, layoutChapter
 *      tick placement in cumulative minutes.
 *
 * Run: bun src/script-map.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import {
  VISUAL_KINDS, MAP_KIND_TINTS, MAP_KIND_LABELS, rowDominantKind, scanRuns, mapModel,
  segmentPx, segmentTag, layoutChapter,
  PX_PER_WORD, ROW_PX, HAIRLINE_PX, MIN_SEG_PX, MIN_NEUTRAL_PX, TICK_EVERY_MIN,
} from './script-map.js';
import { walkTopRows, WORDS_PER_MINUTE, PENDING_TINT } from './workspaces.js';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import { DirectionMark } from './extensions/direction-chip.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

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

const docFrom = (json) => PMNode.fromJSON(schema, json);
const cell = (blocks, role = 'full') => ({ type: 'tableCell', attrs: { role }, content: blocks });
const row = (blocks) => ({ type: 'tableRow', attrs: { cols: 1, pairId: null }, content: [cell(blocks)] });
const splitRow = (said, shown) => ({
  type: 'tableRow', attrs: { cols: 2, pairId: 'pair_t' },
  content: [cell(said, 'said'), cell(shown, 'shown')],
});
const txt = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const para = (...inline) => ({ type: 'paragraph', content: inline });
const dhl = (kind, text) => txt(text, [{ type: 'directionMark', attrs: { kind, status: 'static' } }]);

const block = (type, id, content, extra) => ({ type, attrs: { blockId: id, ...(extra || {}) }, content });
const vo = (id, text, extra) => block('voBlock', id, [para(txt(text))], { status: 'todo', ...(extra || {}) });
const bin = (id, ...inline) => block('binBlock', id, [para(...inline)]);
const broll = (id, text) => block('brollBlock', id, [para(txt(text))]);
const chapterBlk = (id, title) => block('chapterBlock', id, [para(txt(title))], { genre: 'other' });
const emptyPara = () => ({ type: 'paragraph' });

const firstRowNode = (json) => walkTopRows(docFrom({ type: 'doc', content: [json] }))[0].node;
const kindOf = (rowJson) => rowDominantKind(firstRowNode(rowJson)).kind;

// ── 1. DOMINANT KIND ─────────────────────────────────────────────────────────
ok('coverage: the shown-lane chip with the most marked characters wins', () => {
  const r = splitRow(
    [vo('v1', 'ten words of narration counted in the said lane here')],
    [bin('b1',
      dhl('broll', 'short'),                              // 5 chars of broll
      txt(' — '),
      dhl('archive', 'a much longer archive direction run') // 34 chars of archive
    )],
  );
  assert.equal(kindOf(r), 'archive');
});

ok('brollBlock counts as broll — and an EMPTY one still registers nominally', () => {
  assert.equal(kindOf(splitRow([vo('v1', 'said')], [broll('br1', 'street market, golden hour')])), 'broll');
  assert.equal(kindOf(row([block('brollBlock', 'br2', [emptyPara()])])), 'broll',
    'a planned-but-unwritten broll cartridge is a plan, not a hole');
});

ok('said-lane chips NEVER count toward the visual plan', () => {
  const r = splitRow(
    [bin('s1', dhl('animation', 'an animation note living in the said lane'))],
    [bin('s2', dhl('broll', 'x'))],
  );
  assert.equal(kindOf(r), 'broll', 'the 1-char shown chip beats any amount of said-lane ink');
});

ok('full-width cells count (a full cell is both lanes at once)', () => {
  assert.equal(kindOf(row([bin('f1', dhl('mapdata', 'border overlay 1948'))])), 'mapdata');
});

ok('dead tie breaks by VISUAL_KINDS priority order', () => {
  assert.deepEqual(VISUAL_KINDS, ['broll', 'archive', 'mapdata', 'animation', '3d']);
  const r = splitRow([vo('v', 'said')], [bin('t', dhl('3d', 'abcde'), dhl('broll', 'fghij'))]);
  assert.equal(kindOf(r), 'broll', '5 chars each — earlier VISUAL_KINDS entry wins');
});

// ── 2. OVERRIDES ─────────────────────────────────────────────────────────────
ok('pendingViz outranks any chip coverage in the row', () => {
  const r = splitRow(
    [vo('vp', 'stamped narration', { pendingViz: true })],
    [bin('bp', dhl('broll', 'monastery exteriors at dusk'))],
  );
  assert.equal(kindOf(r), 'pending');
});

ok('a shown lane with no visual coverage → unplanned (empty or untagged prose)', () => {
  assert.equal(kindOf(splitRow([vo('v', 'said words')], [block('binBlock', 'e', [emptyPara()])])), 'unplanned');
  assert.equal(kindOf(splitRow([vo('v', 'said words')], [bin('e2', txt('some untagged prose'))])), 'unplanned');
});

ok('no shown lane at all → neutral (chapter heads, notes, bare VO rows)', () => {
  assert.equal(kindOf(row([chapterBlk('ch', 'The Coup')])), 'neutral');
  assert.equal(kindOf(row([vo('v', 'a full-width narration row with no visual lane')])), 'neutral');
});

// ── 2b. TK IS INVISIBLE TO THE MAP ───────────────────────────────────────────
// TK is a loose-end DRAWER (workspaces.js), never a VISUAL_KIND — the map classifies
// a TK row by its actual picture, exactly as if the TK text weren't there. A bare TK
// in the shown lane is still an unplanned hole; a TK riding alongside a real chip
// stays that chip's kind; a full-width "(TK …)" note with no visual lane is neutral.
ok('TK text never becomes a plan — bare TK in a shown lane is still unplanned', () => {
  assert.equal(kindOf(splitRow([vo('v', 'said words')], [bin('tk1', txt('(TK musician\'s name)'))])), 'unplanned',
    'the parenthetical TK swoop is prose, not a visual plan');
  assert.equal(kindOf(splitRow([vo('v', 'said words')], [bin('tk2', txt('cutaway TK before lock'))])), 'unplanned',
    'a bare TK stray does not fill the hole');
});

ok('TK riding alongside a real chip classifies by the chip, not by TK-ness', () => {
  const r = splitRow(
    [vo('v', 'said words')],
    [bin('tk3', dhl('broll', 'monastery exteriors'), txt(' — score by (TK composer)'))],
  );
  assert.equal(kindOf(r), 'broll', 'the visual content wins; TK adds no coverage of its own');
});

ok('a full-width TK-only note with no visual lane is neutral', () => {
  assert.equal(kindOf(row([bin('tk4', txt('need a stat here TK'))])), 'neutral',
    'TK does not conjure a shown lane');
});

// ── 3 + 4 + 6. CHAPTERS, PROPORTIONING, TOTALS ───────────────────────────────
// 10 words per vo body → clean arithmetic below.
const TEN = 'one two three four five six seven eight nine ten';
const MODEL_DOC = docFrom({
  type: 'doc',
  content: [
    row([bin('setup', txt('author setup notes'))]),                        // 1 front matter · neutral
    row([chapterBlk('chA', 'The Coup')]),                                  // 2 ch1 · neutral
    splitRow([vo('v1', TEN)], [bin('b1', dhl('broll', 'street'))]),        // 3 ch1 · broll 10w
    splitRow([vo('v2', TEN)], [bin('b2', dhl('broll', 'market'))]),        // 4 ch1 · broll 10w
    splitRow([vo('v3', TEN)], [block('binBlock', 'b3', [emptyPara()])]),                       // 5 ch1 · unplanned 10w
    splitRow([vo('v4', TEN, { pendingViz: true })], [block('binBlock', 'b4', [emptyPara()])]), // 6 ch1 · pending 10w
    row([chapterBlk('chB', 'Borderlands')]),                               // 7 ch2 · neutral
    splitRow([vo('v5', TEN)], [bin('b5', dhl('broll', 'trucks'))]),        // 8 ch2 · broll 10w
    { type: 'paragraph' },                                                 // bare stray — not a row
  ],
});

ok('mapModel: front matter + chapter grouping; segments never cross a chapter line', () => {
  const m = mapModel(MODEL_DOC);
  assert.deepEqual(m.chapters.map((c) => [c.ordinal, c.ord, c.title]),
    [[0, '00', 'FRONT MATTER'], [1, '01', 'The Coup'], [2, '02', 'Borderlands']]);
  const kinds = m.chapters.map((c) => c.segments.map((s) => s.kind));
  assert.deepEqual(kinds, [
    ['neutral'],
    ['neutral', 'broll', 'unplanned', 'pending'],
    ['neutral', 'broll'],
  ], 'ch1 broll run does not leak into ch2 broll row');
});

ok('mapModel: segment row ranges + timed words + anchors', () => {
  const m = mapModel(MODEL_DOC);
  const brollSeg = m.chapters[1].segments[1];
  assert.deepEqual(
    { rowStart: brollSeg.rowStart, rowEnd: brollSeg.rowEnd, rowCount: brollSeg.rowCount, timedWords: brollSeg.timedWords, firstBlockId: brollSeg.firstBlockId },
    { rowStart: 3, rowEnd: 4, rowCount: 2, timedWords: 20, firstBlockId: 'v1' },
  );
  assert.equal(m.chapters[1].segments[3].kind, 'pending');
  assert.equal(m.chapters[1].segments[3].timedWords, 10, 'a pending row still carries its said-lane clock');
  assert.equal(m.chapters[1].timedWords, 40);
});

ok('mapModel totals: minutes @130, plannedPct over planned+hazard words, hazard ROW counts, byKind', () => {
  const m = mapModel(MODEL_DOC);
  assert.equal(m.totals.timedWords, 50);
  assert.equal(m.totals.minutes, 50 / WORDS_PER_MINUTE);
  // planned 30w (broll) vs hazard 20w (unplanned 10 + pending 10) → 30/50 = 60%
  assert.equal(m.totals.plannedPct, 60);
  assert.equal(m.totals.pendingCount, 1);
  assert.equal(m.totals.unplannedCount, 1);
  assert.equal(m.totals.byKind.broll.timedWords, 30);
  assert.equal(m.totals.byKind.broll.rows, 3);
  assert.equal(m.totals.byKind.broll.sections, 2, 'one section per chapter');
  assert.equal(m.totals.byKind.neutral.rows, 3);
});

ok('empty doc → no chapters, calm totals (plannedPct 100, nothing pending)', () => {
  const m = mapModel(docFrom({ type: 'doc', content: [{ type: 'paragraph' }] }));
  assert.deepEqual(m.chapters, []);
  assert.equal(m.totals.plannedPct, 100);
  assert.equal(m.totals.pendingCount + m.totals.unplannedCount, 0);
});

// ── 5. SMOOTHING ─────────────────────────────────────────────────────────────
const runRow = (i, kind, words = 0, id = null) => ({ index: i, firstBlockId: id || `r${i}`, kind, timedWords: words });

ok('a 1-row real-kind island between two same-kind runs is absorbed (words kept)', () => {
  const rows = [
    runRow(1, 'broll', 10), runRow(2, 'broll', 10),
    runRow(3, 'archive', 5),                          // the island
    runRow(4, 'broll', 10), runRow(5, 'broll', 10),
  ];
  const runs = scanRuns(rows);
  assert.deepEqual(runs.map((r) => [r.kind, r.rowStart, r.rowEnd, r.timedWords]),
    [['broll', 1, 5, 45]], 'one broll section; the stray archive chip is texture, not a section');
  assert.equal(scanRuns(rows, { smooth: false }).length, 3, 'smooth:false keeps the raw runs');
});

ok('pending and unplanned islands are NEVER smoothed away; neutral never merges', () => {
  const hazard = scanRuns([
    runRow(1, 'broll', 10), runRow(2, 'pending', 10), runRow(3, 'broll', 10),
  ]);
  assert.deepEqual(hazard.map((r) => r.kind), ['broll', 'pending', 'broll'], 'the alarm stays visible');
  const unpl = scanRuns([
    runRow(1, 'broll', 10), runRow(2, 'unplanned', 0), runRow(3, 'broll', 10),
  ]);
  assert.deepEqual(unpl.map((r) => r.kind), ['broll', 'unplanned', 'broll']);
  const island = scanRuns([
    runRow(1, 'neutral', 0), runRow(2, 'archive', 5), runRow(3, 'neutral', 0),
  ]);
  assert.deepEqual(island.map((r) => r.kind), ['neutral', 'archive', 'neutral'],
    'neutral flanks never absorb a real segment');
});

ok('smoothing cascades: absorbing an island can merge the newly adjacent runs', () => {
  const runs = scanRuns([
    runRow(1, 'broll', 10),
    runRow(2, 'archive', 0),   // island 1
    runRow(3, 'broll', 10), runRow(4, 'broll', 0),
    runRow(5, 'mapdata', 0),   // island 2
    runRow(6, 'broll', 10),
  ]);
  assert.deepEqual(runs.map((r) => [r.kind, r.rowStart, r.rowEnd]), [['broll', 1, 6]]);
});

// ── 7. NESTED ROWS (Palau) ───────────────────────────────────────────────────
ok('a shown lane nested inside a wrapper row classifies the TOP-LEVEL row', () => {
  const nested = {
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [cell([
      vo('outer', TEN),
      splitRow([vo('in-said', TEN)], [bin('in-shown', dhl('mapdata', 'reef overlay'))]),
    ])],
  };
  const r = rowDominantKind(firstRowNode(nested));
  assert.equal(r.kind, 'mapdata');
  assert.equal(r.hasShown, true);
});

// ── 8. VIEW MATH ─────────────────────────────────────────────────────────────
ok('segmentPx: word-proportional with floors; zero-word neutral = hairline', () => {
  assert.equal(segmentPx({ kind: 'neutral', timedWords: 0, rowCount: 3 }), HAIRLINE_PX);
  assert.equal(segmentPx({ kind: 'neutral', timedWords: 600, rowCount: 30 }), Math.round(600 * PX_PER_WORD),
    'wordy neutral (unsplit narration) gets real proportional mass');
  assert.equal(segmentPx({ kind: 'neutral', timedWords: 10, rowCount: 1 }), MIN_NEUTRAL_PX);
  assert.equal(segmentPx({ kind: 'broll', timedWords: 0, rowCount: 1 }), MIN_SEG_PX);
  assert.equal(segmentPx({ kind: 'broll', timedWords: 0, rowCount: 10 }), 10 * ROW_PX,
    'a long word-empty visual run still grows with its rows');
  assert.equal(segmentPx({ kind: 'pending', timedWords: 260, rowCount: 2 }), Math.round(260 * PX_PER_WORD));
});

ok('segmentTag: row ranges + minutes only when the clock ticks', () => {
  assert.equal(segmentTag({ rowStart: 171, rowEnd: 191, timedWords: 273 }), 'ROWS 171–191 · 2.1 MIN');
  assert.equal(segmentTag({ rowStart: 7, rowEnd: 7, timedWords: 0 }), 'ROW 7');
});

ok('layoutChapter: cumulative minute ticks land inside word-carrying segments', () => {
  const every = TICK_EVERY_MIN * WORDS_PER_MINUTE; // 260 words
  const chapter = {
    segments: [
      { kind: 'broll', rowStart: 1, rowEnd: 4, rowCount: 4, timedWords: 200, firstBlockId: 'a' },
      { kind: 'neutral', rowStart: 5, rowEnd: 5, rowCount: 1, timedWords: 0, firstBlockId: null },
      { kind: 'archive', rowStart: 6, rowEnd: 9, rowCount: 4, timedWords: 200, firstBlockId: 'b' },
    ],
  };
  const { segs, ticks, colPx } = layoutChapter(chapter, 0);
  assert.equal(segs.length, 3);
  assert.equal(colPx, segs.reduce((n, s) => n + s.px, 0) + segs.length - 1, '1px seams between bars');
  assert.equal(ticks.length, 1, 'one 2-min boundary inside 400 words');
  const arch = segs[2];
  const frac = (every - 200) / 200; // boundary 260w sits 60w into the archive segment
  assert.equal(ticks[0].min, 2);
  assert.equal(ticks[0].y, Math.round(arch.y + frac * arch.px));
  // startWords offsets the boundary hunt — a chapter starting at 250w ticks almost immediately
  const shifted = layoutChapter(chapter, 250);
  assert.equal(shifted.ticks[0].min, 2);
  assert.ok(shifted.ticks[0].y < segs[0].px, 'boundary falls 10 words into the first segment');
});

ok('legend contract: every paintable kind has a label; tints match the chip palette', () => {
  for (const k of [...VISUAL_KINDS, 'pending', 'unplanned', 'neutral']) {
    assert.ok(k in MAP_KIND_LABELS, `label for ${k}`);
  }
  assert.equal(MAP_KIND_TINTS.pending, PENDING_TINT);
  assert.equal(MAP_KIND_TINTS.broll, '#d0873f');
  assert.equal(MAP_KIND_TINTS.animation, '#9184c7');
  assert.equal(MAP_KIND_TINTS['3d'], '#9184c7');
  assert.equal(MAP_KIND_TINTS.mapdata, '#9c5a3c');
  assert.equal(MAP_KIND_TINTS.archive, '#b56b6b');
});

console.log(`script-map: ${pass} passed, 0 failed`);
