// Locks the embedded selects-analysis text contract — specifically the hour-drop
// fix: an hour-plus source/timeline range must render H:MM:SS (e.g. "1:05:30"),
// NOT the old inline-formatter "65:30". This is the text that gets embedded and
// cross-referenced in The Hunter's editorial corpus, so a wrong timecode is real
// (if low-frequency) signal pollution on Johnny's hour-long interview footage.
//
// Run: node hunter/worker/selects-context.test.mjs   (auto-discovered by `bun run test`)

import assert from 'node:assert';
import { buildSelectsAnalysisContext } from './selects-context.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); }
}

// The OLD inline formatter buildSelectsAnalysisContext used to call — reconstructed
// here as the RED baseline. It drops the hour on anything >= 3600s.
const oldFmt = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const baseUnit = {
  sequenceName: 'Burma — Act 2',
  sourceClipName: '260317-04-104-JERRY',
  startSeconds: 3930,    // 1:05:30 — an hour-plus source in-point (the bug case)
  endSeconds: 3990,      // 1:06:30
  timelineStart: 7325,   // 2:02:05 — multi-hour timeline position
  timelineEnd: 7385,     // 2:03:05
  trackLabel: 'V1',
};

// ---- inline RED proof: the old formatter would drop the hour in the embedded text ----
test('RED proof: old inline formatter dropped the hour', () => {
  // The old text would have carried "65:30" / "122:05" — assert that's what oldFmt yields,
  // i.e. the bug was real for these in-range hour-plus values.
  assert.strictEqual(oldFmt(3930), '65:30', 'old formatter drops hour on 3930s');
  assert.strictEqual(oldFmt(7325), '122:05', 'old formatter drops hour on 7325s');
  // ...and assert the NEW builder does NOT contain those broken stamps.
  const text = buildSelectsAnalysisContext(baseUnit, null);
  assert.ok(!text.includes('65:30'), 'fixed builder must not emit the hour-dropped "65:30"');
  assert.ok(!text.includes('122:05'), 'fixed builder must not emit the hour-dropped "122:05"');
});

// ---- the fix: hour-plus ranges carry the hour ----
test('hour-plus source range renders H:MM:SS', () => {
  const text = buildSelectsAnalysisContext(baseUnit, null);
  assert.ok(text.includes('Source range: 1:05:30 – 1:06:30'),
    `source range must carry the hour, got:\n${text}`);
});

test('multi-hour timeline position renders H:MM:SS', () => {
  const text = buildSelectsAnalysisContext(baseUnit, null);
  assert.ok(text.includes('Timeline position: 2:02:05 – 2:03:05'),
    `timeline position must carry the hour, got:\n${text}`);
});

// ---- no regression: sub-hour output byte-identical to the old inline formatter ----
test('sub-hour clip is byte-identical to the old inline formatter', () => {
  const subHour = {
    ...baseUnit,
    startSeconds: 330,    // 5:30
    endSeconds: 390,      // 6:30
    timelineStart: 75,    // 1:15
    timelineEnd: 135,     // 2:15
  };
  const text = buildSelectsAnalysisContext(subHour, null);
  // Old inline output for these values, sub-hour: identical to formatClipTime sub-hour.
  assert.ok(text.includes(`Source range: ${oldFmt(330)} – ${oldFmt(390)}`),
    'sub-hour source range must match old formatter exactly');
  assert.ok(text.includes(`Timeline position: ${oldFmt(75)} – ${oldFmt(135)}`),
    'sub-hour timeline position must match old formatter exactly');
  assert.ok(text.includes('Source range: 5:30 – 6:30'));
  assert.ok(text.includes('Timeline position: 1:15 – 2:15'));
});

// ---- exact-hour boundary (3600s) is the first value that diverges from the old code ----
test('exact-hour boundary renders 1:00:00', () => {
  const text = buildSelectsAnalysisContext({ ...baseUnit, startSeconds: 3600, endSeconds: 3661 }, null);
  assert.ok(text.includes('Source range: 1:00:00 – 1:01:01'), `got:\n${text}`);
});

// ---- structural contract preserved (the rest of the embedded text is unchanged) ----
test('cross-reference block present with rawMatch', () => {
  const text = buildSelectsAnalysisContext(baseUnit, { id: 'raw-77', start_seconds: 3900, end_seconds: 4200 });
  assert.ok(text.includes('CROSS-REFERENCE: This clip matches raw corpus unit raw-77.'));
  assert.ok(text.includes('Usage:'));
  assert.ok(!text.includes('No raw footage match found'));
});

test('no-match block present without rawMatch', () => {
  const text = buildSelectsAnalysisContext(baseUnit, null);
  assert.ok(text.includes('No raw footage match found for this source clip.'));
  assert.ok(!text.includes('CROSS-REFERENCE'));
});

test('sequence name, source clip, and track label embedded', () => {
  const text = buildSelectsAnalysisContext(baseUnit, null);
  assert.ok(text.includes('Sequence: "Burma — Act 2"'));
  assert.ok(text.includes('Source clip: 260317-04-104-JERRY'));
  assert.ok(text.includes('Track: V1'));
  assert.ok(text.startsWith('EDITORIAL DECISION — Selects Tier\n'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
