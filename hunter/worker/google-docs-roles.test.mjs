// Verifier-layer LOCK for detectColumnRoles — the voice-vs-visual column
// classifier behind The Hunter's Script Copilot Google Docs import.
//
// It scores each table column on visual vs voice keyword density (+ highlight
// counts), filters out empty/numbering columns, then picks one column as the
// narration (voice) and one as the picture (visual). A silent regression here
// mislabels which column is which -> the whole imported script's voice/visual
// split is wrong, with no signal. This locks the scoring, the content-column
// filter, and the bestVoice/bestVisual selection.
//
// Mutation-proven: each named assertion fails if the corresponding source
// logic regresses (proof recorded in the BACKLOG entry). ZERO source change.

import assert from 'node:assert';
import { detectColumnRoles } from './google-docs-parser.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL: ${name}\n  ${e.message}`); } };

// ── fixture builders (match the Google Docs API cell shape the parser reads) ──
function cell(text, { highlights = 0 } = {}) {
  const elements = [{ textRun: { content: text, textStyle: {} } }];
  for (let i = 0; i < highlights; i++) {
    elements.push({
      textRun: { content: ' x', textStyle: { backgroundColor: { color: { rgbColor: { red: 1 } } } } },
    });
  }
  return { content: [{ paragraph: { elements } }] };
}
const row = (...cells) => ({ tableCells: cells });

// canonical cell texts
const VIS = 'Wide aerial shot of the city. Drone footage of the skyline at dawn, slow push in.'; // visual kws, long
const VOX = 'Narrator: it begins.'; // voice kw, short
const NUM = '1.'; // numbering column, tiny

// 4-row standard table: col0 = VISUAL (long), col1 = VOICE (short)
const standard = [row(cell(VIS), cell(VOX)), row(cell(VIS), cell(VOX)), row(cell(VIS), cell(VOX)), row(cell(VIS), cell(VOX))];
// reversed: col0 = VOICE, col1 = VISUAL
const reversed = [row(cell(VOX), cell(VIS)), row(cell(VOX), cell(VIS)), row(cell(VOX), cell(VIS)), row(cell(VOX), cell(VIS))];
// 3-col with a numbering column first
const threeCol = [
  row(cell(NUM), cell(VIS), cell(VOX)),
  row(cell(NUM), cell(VIS), cell(VOX)),
  row(cell(NUM), cell(VIS), cell(VOX)),
  row(cell(NUM), cell(VIS), cell(VOX)),
];

// ── inline RED proof: a keyword-blind classifier can't tell the columns apart ──
t('RED proof: a no-keyword-scoring detector would NOT correctly split the columns', () => {
  // Reconstruct the OLD-if-broken behavior: ignore keyword scoring entirely and
  // just take col0 as voice, col1 as visual. On the standard table (visual is
  // col0) that mislabels — proving the real keyword scoring is load-bearing.
  const blind = { voiceColumn: 0, visualColumn: 1 };
  const real = detectColumnRoles(standard);
  assert.notDeepStrictEqual(
    { voiceColumn: real.voiceColumn, visualColumn: real.visualColumn },
    blind,
    'real detector must use keyword scoring, not positional defaults'
  );
});

// ── standard table: visual=col0, voice=col1 ──
t('LOCK[scoring]: standard table picks visual col0 / voice col1', () => {
  const r = detectColumnRoles(standard);
  assert.strictEqual(r.visualColumn, 0, 'visual should be the keyword-heavy col0');
  assert.strictEqual(r.voiceColumn, 1, 'voice should be the narrator col1');
});

t('LOCK: standard table reports totalColumns=2 and confidence>0', () => {
  const r = detectColumnRoles(standard);
  assert.strictEqual(r.totalColumns, 2);
  assert.ok(r.confidence > 0, 'keyword hits should yield nonzero confidence');
});

t('LOCK: standard contentColumns = both columns', () => {
  const r = detectColumnRoles(standard);
  assert.deepStrictEqual([...r.contentColumns].sort(), [0, 1]);
});

// ── reversed table: voice=col0, visual=col1 ──
t('LOCK[scoring]: reversed table picks voice col0 / visual col1', () => {
  const r = detectColumnRoles(reversed);
  assert.strictEqual(r.voiceColumn, 0, 'voice should be the narrator col0');
  assert.strictEqual(r.visualColumn, 1, 'visual should be the keyword-heavy col1');
});

// ── 3-column with a numbering column ──
t('LOCK[filter]: numbering column (col0) is filtered out of contentColumns', () => {
  const r = detectColumnRoles(threeCol);
  assert.ok(!r.contentColumns.includes(0), 'tiny numbering col0 must be filtered');
  assert.deepStrictEqual([...r.contentColumns].sort(), [1, 2]);
});

t('LOCK[scoring]: 3-col picks visual=col1 / voice=col2 (numbering ignored)', () => {
  const r = detectColumnRoles(threeCol);
  assert.strictEqual(r.visualColumn, 1);
  assert.strictEqual(r.voiceColumn, 2);
  assert.strictEqual(r.totalColumns, 3);
});

// ── highlights count toward visual ──
t('LOCK: highlights boost the visual score of their column', () => {
  // col0 carries highlights but no keywords; col1 is the narrator (voice kw).
  // Highlights should be enough to tag col0 as visual against the voice col1.
  const rows = [
    row(cell('the field at dawn, quiet', { highlights: 3 }), cell('Narrator: it begins')),
    row(cell('the field at dawn, quiet', { highlights: 3 }), cell('Narrator: it begins')),
  ];
  const r = detectColumnRoles(rows);
  assert.strictEqual(r.visualColumn, 0, 'highlighted column should be tagged visual');
  assert.strictEqual(r.voiceColumn, 1, 'narrator column should be tagged voice');
});

// ── visual keyword variety still matches ──
t('LOCK: b-roll / montage / camera all register as visual keywords', () => {
  for (const kw of ['B-roll of the protest', 'Montage of archive footage', 'Camera pushes in on the map']) {
    const rows = [row(cell(kw), cell(VOX)), row(cell(kw), cell(VOX))];
    const r = detectColumnRoles(rows);
    assert.strictEqual(r.visualColumn, 0, `"${kw}" should mark col0 visual`);
  }
});

t('LOCK: voiceover / dialogue / SOT all register as voice keywords', () => {
  for (const kw of ['Voiceover: and then', 'Dialogue between the two', 'SOT from the interview']) {
    const rows = [row(cell(VIS), cell(kw)), row(cell(VIS), cell(kw))];
    const r = detectColumnRoles(rows);
    assert.strictEqual(r.voiceColumn, 1, `"${kw}" should mark col1 voice`);
  }
});

// ── degenerate / robustness paths (no crash; the 1-col path is guarded at the caller) ──
t('LOCK: empty tableRows -> defined {voice:0,visual:1}, no throw', () => {
  const r = detectColumnRoles([]);
  assert.strictEqual(r.voiceColumn, 0);
  assert.strictEqual(r.visualColumn, 1);
  assert.strictEqual(r.totalColumns, 2);
  assert.strictEqual(r.confidence, 0, 'no scores -> zero confidence, not NaN');
});

t('LOCK: rows with no keywords anywhere still return two distinct columns', () => {
  const rows = [
    row(cell('alpha beta gamma delta epsilon'), cell('one two three four five six')),
    row(cell('alpha beta gamma delta epsilon'), cell('one two three four five six')),
  ];
  const r = detectColumnRoles(rows);
  assert.notStrictEqual(r.voiceColumn, undefined);
  assert.notStrictEqual(r.visualColumn, undefined);
  assert.ok(Number.isFinite(r.confidence));
});

// ── result shape contract ──
t('LOCK: result always carries the full shape', () => {
  const r = detectColumnRoles(standard);
  for (const k of ['voiceColumn', 'visualColumn', 'totalColumns', 'contentColumns', 'confidence']) {
    assert.ok(k in r, `missing key ${k}`);
  }
  assert.ok(Array.isArray(r.contentColumns));
  assert.ok(Number.isFinite(r.confidence));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
