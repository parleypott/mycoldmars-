// Tests for The Hunter's client-side scene grouping (scene-grouping.js).
//
// Headline bug fixed here: extractDateFromClipName built a machine-LOCAL Date
// from the filename's wall-clock, but the scene day/time labels are read back
// with toISOString() (UTC). On a non-UTC machine (Johnny edits on Pacific) a
// late-evening clip ("...-2330") was labeled the NEXT day and every scene time
// shifted by the runner's offset. The fix constructs the Date in UTC so the
// label round-trips the filename's wall-clock on ANY machine.
//
// HONEST ON RED: on a UTC machine (the test runner) the old local-Date and the
// new UTC-Date implementations are extensionally IDENTICAL — so no test run
// here can distinguish them directly. The RED proof therefore SIMULATES a
// non-UTC machine arithmetically (same standard as the qss-worlds 3rd-world
// proofs): it reconstructs exactly what the old local-Date formula emits on a
// machine at UTC-7 / UTC+9 and shows it mislabels, while the shipped function
// does not. The round-trip assertions are machine-independent regression locks.

import {
  SCENE_TEMPORAL_GAP_MINUTES,
  extractDateFromClipName,
  extractCameraId,
  groupIntoScenes,
} from './scene-grouping.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }

// Helper: labels exactly as groupIntoScenes derives them from a timestamp.
const labelOf = (d) => ({ day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) });

// ─────────────────────────────────────────────────────────────────────────
// extractDateFromClipName — the fix + round-trip contract
// ─────────────────────────────────────────────────────────────────────────

eq(extractDateFromClipName(null), null, 'null name → null');
eq(extractDateFromClipName(undefined), null, 'undefined name → null');
eq(extractDateFromClipName('no-timestamp-here'), null, 'no match → null');
eq(extractDateFromClipName('C001_random.mov'), null, 'camera id but no date → null');

// The load-bearing fix: the label round-trips the filename's wall-clock EXACTLY,
// on any machine, for every time-of-day — including the boundary cases the old
// code corrupted on non-UTC machines.
const roundTrips = [
  ['A001_20260317-2330_C001', '2026-03-17', '23:30'], // late evening — old code's worst case
  ['A001_20260317-0000_C001', '2026-03-17', '00:00'], // midnight
  ['A001_20260317-2359_C001', '2026-03-17', '23:59'], // one minute to midnight
  ['A001_20260317-1200_C001', '2026-03-17', '12:00'], // noon
  ['20261231-2330', '2026-12-31', '23:30'],            // year-end late evening
];
for (const [name, day, time] of roundTrips) {
  const d = extractDateFromClipName(name);
  eq(labelOf(d), { day, time }, `round-trip ${name} → ${day} ${time}`);
}

// Exact epoch: the parsed Date is the UTC instant of the encoded wall-clock.
eq(extractDateFromClipName('20260317-2330').getTime(),
   Date.UTC(2026, 2, 17, 23, 30),
   'parsed time === Date.UTC of encoded wall-clock');

// ─────────────────────────────────────────────────────────────────────────
// RED PROOF (machine-independent): simulate the OLD local-Date formula on a
// non-UTC machine and show it mislabels; the shipped function does not.
// ─────────────────────────────────────────────────────────────────────────

// On a machine at UTC+offsetMinutes, `new Date(y,m-1,d,h,min)` produces the
// instant Date.UTC(y,m-1,d,h,min) - offsetMs. This reproduces that arithmetic
// exactly, independent of the test machine's actual timezone.
function oldFormulaLabelOnMachine(name, offsetMinutes) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const localInstant = wall - offsetMinutes * 60_000; // local-construction skew
  return labelOf(new Date(localInstant));
}

// Pacific (UTC-7, DST): a 23:30 clip gets pushed to the NEXT day by the old code.
const oldPacific = oldFormulaLabelOnMachine('20260317-2330', -420);
eq(oldPacific, { day: '2026-03-18', time: '06:30' },
   'RED: old local-Date formula on UTC-7 mislabels 2330 → next day 06:30');
// The shipped (UTC) function labels it correctly regardless of machine.
eq(labelOf(extractDateFromClipName('20260317-2330')), { day: '2026-03-17', time: '23:30' },
   'FIX: shipped function labels 2330 correctly (no day/time drift)');
ok(JSON.stringify(oldPacific) !== JSON.stringify(labelOf(extractDateFromClipName('20260317-2330'))),
   'RED≠FIX: old Pacific behavior diverges from the fix');

// Tokyo (UTC+9): a 00:00 clip gets pushed to the PREVIOUS day by the old code.
const oldTokyo = oldFormulaLabelOnMachine('20260317-0000', 540);
eq(oldTokyo, { day: '2026-03-16', time: '15:00' },
   'RED: old local-Date formula on UTC+9 mislabels 0000 → previous day 15:00');
eq(labelOf(extractDateFromClipName('20260317-0000')), { day: '2026-03-17', time: '00:00' },
   'FIX: shipped function labels midnight correctly on any machine');

// On a UTC machine (offset 0) old and new agree — why the bug was invisible on the Redoubt.
eq(oldFormulaLabelOnMachine('20260317-2330', 0), labelOf(extractDateFromClipName('20260317-2330')),
   'on UTC the old formula and the fix are identical (bug invisible here)');

// ─────────────────────────────────────────────────────────────────────────
// extractCameraId
// ─────────────────────────────────────────────────────────────────────────

eq(extractCameraId('A001_C002_0001.mov'), 'C002', 'camera id from ARRI-style name');
eq(extractCameraId('20260317-2330-C12'), 'C12', 'camera id at end');
eq(extractCameraId('20260317-2330'), null, 'no camera id → null');
eq(extractCameraId(null), null, 'null name → null camera id');
eq(extractCameraId('MVI_1234.mp4'), null, 'no C-number → null');

// ─────────────────────────────────────────────────────────────────────────
// groupIntoScenes — temporal clustering
// ─────────────────────────────────────────────────────────────────────────

const clip = (name, extra = {}) => ({ source_clip_name: name, ...extra });

eq(groupIntoScenes([]), [], 'empty input → []');
eq(groupIntoScenes([clip('no-date-1'), clip('no-date-2')]), [], 'no parseable timestamps → []');

// Two clips 5 min apart → one scene.
{
  const scenes = groupIntoScenes([clip('A_20260317-1000_C001'), clip('A_20260317-1005_C001')]);
  eq(scenes.length, 1, '5-min-apart clips → 1 scene');
  eq(scenes[0].clips.length, 2, 'both clips in the scene');
}

// Gap exactly at the boundary (10 min) → still one scene; 11 min → split.
{
  const ten = groupIntoScenes([clip('A_20260317-1000_C001'), clip('A_20260317-1010_C001')]);
  eq(ten.length, 1, 'gap exactly 10 min → grouped (<=)');
  const eleven = groupIntoScenes([clip('A_20260317-1000_C001'), clip('A_20260317-1011_C001')]);
  eq(eleven.length, 2, 'gap 11 min → split into 2 scenes');
}
ok(SCENE_TEMPORAL_GAP_MINUTES === 10, 'gap constant is 10 minutes');

// Out-of-order input is sorted by timestamp before grouping.
{
  const scenes = groupIntoScenes([
    clip('A_20260317-1200_C001'),
    clip('A_20260317-0900_C001'),
    clip('A_20260317-0902_C001'),
  ]);
  eq(scenes.length, 2, 'out-of-order → 2 scenes (09:0x cluster, then 12:00)');
  eq(scenes[0].time, '09:00', 'first scene starts at the earliest clip');
  eq(scenes[1].time, '12:00', 'second scene is the later cluster');
}

// The downstream effect of the bug: scene.day / scene.time labels reflect the
// encoded wall-clock — machine-independent now.
{
  const scenes = groupIntoScenes([clip('A_20260317-2330_C001')]);
  eq(scenes[0].day, '2026-03-17', 'scene.day matches encoded date (was next-day on Pacific)');
  eq(scenes[0].time, '23:30', 'scene.time matches encoded wall-clock');
}

// Per-day grouping (the real consumer) buckets a late clip under its true day.
{
  const scenes = groupIntoScenes([
    clip('A_20260317-2330_C001'),
    clip('A_20260318-0900_C001'),
  ]);
  const days = [...new Set(scenes.map(s => s.day))].sort();
  eq(days, ['2026-03-17', '2026-03-18'], 'two distinct shoot days, correctly labeled');
}

// Camera dedup + cap at 3.
{
  const scenes = groupIntoScenes([
    clip('A_20260317-1000_C001'),
    clip('A_20260317-1001_C002'),
    clip('A_20260317-1002_C002'), // dup C002
    clip('A_20260317-1003_C003'),
    clip('A_20260317-1004_C004'), // 4th distinct camera — capped out
  ]);
  eq(scenes[0].cameras.length, 3, 'cameras capped at 3');
  eq(scenes[0].cameras, ['C001', 'C002', 'C003'], 'cameras deduped, first three kept');
}

// totalDuration sums positive durations, ignores negative/zero.
{
  const scenes = groupIntoScenes([
    clip('A_20260317-1000_C001', { start_seconds: 0, end_seconds: 10 }),
    clip('A_20260317-1001_C001', { start_seconds: 5, end_seconds: 3 }), // negative → ignored
    clip('A_20260317-1002_C001', { start_seconds: 100, end_seconds: 130 }),
  ]);
  eq(scenes[0].totalDuration, 40, 'totalDuration = 10 + 0 + 30 (negative dropped)');
}

// Metadata aggregation: topEmotion, topShot, avgKeep.
{
  const a = (er, st, ks) => ({ analyses: [{ output_json: { emotional_register: er, shot_type: st, keepability_score: ks } }] });
  const scenes = groupIntoScenes([
    clip('A_20260317-1000_C001', a('tense', 'wide', 4)),
    clip('A_20260317-1001_C001', a('tense', 'closeup', 8)),
    clip('A_20260317-1002_C001', a('calm', 'wide', 0)),
  ]);
  eq(scenes[0].topEmotion, 'tense', 'topEmotion = most frequent register');
  eq(scenes[0].topShot, 'wide', 'topShot = most frequent shot type');
  eq(scenes[0].avgKeep, 4, 'avgKeep = (4+8+0)/3');
}

// avgKeep null when no scores present.
{
  const scenes = groupIntoScenes([clip('A_20260317-1000_C001')]);
  eq(scenes[0].avgKeep, null, 'avgKeep null when no keepability scores');
}

// Label extraction: pull first real sentence from analysis text.
{
  const scenes = groupIntoScenes([clip('A_20260317-1000_C001', {
    analyses: [{ output_text: 'A soldier walks slowly across an empty courtyard at dawn. Then he stops.' }],
  })]);
  eq(scenes[0].label, 'A soldier walks slowly across an empty courtyard at dawn.', 'label = first real sentence');
}

// Label falls back to topEmotion · topShot when analysis is a bare header.
{
  const scenes = groupIntoScenes([clip('A_20260317-1000_C001', {
    analyses: [{ output_text: '## Analysis', output_json: { emotional_register: 'somber', shot_type: 'wide' } }],
  })]);
  eq(scenes[0].label, 'somber · wide', 'label falls back to emotion · shot');
}

// Label falls back to "Scene at HH:MM" with no analysis at all.
{
  const scenes = groupIntoScenes([clip('A_20260317-1430_C001')]);
  eq(scenes[0].label, 'Scene at 14:30', 'label falls back to "Scene at HH:MM"');
}

// Reads sourceClipName (camelCase) too.
{
  const scenes = groupIntoScenes([{ sourceClipName: 'A_20260317-1000_C001' }]);
  eq(scenes.length, 1, 'reads camelCase sourceClipName');
}

// ─────────────────────────────────────────────────────────────────────────

console.log(`scene-grouping: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
