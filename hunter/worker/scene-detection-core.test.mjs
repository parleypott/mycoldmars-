// Tests for The Hunter's scene-detection worker cores (scene-detection-core.js).
//
// Headline bug fixed here: extractDateFromClipName built a machine-LOCAL Date
// from the filename's wall-clock, but every readback in scene-detection.mjs uses
// .toISOString() (UTC) for the scene day/time labels and the per-day buckets. On
// a non-UTC machine (Johnny edits on Pacific) a late-evening clip ("…-2330") was
// labeled the NEXT day and every time shifted by the runner's offset — and clips
// from two different shoot days collapsed into ONE wrong day bucket. The fix
// constructs the Date in UTC so the label round-trips the filename's wall-clock
// on ANY machine. This is the worker copy of the client fix already locked by
// hunter/src/scene-grouping.test.mjs (commit 6c3b06a).
//
// HONEST ON RED: on a UTC machine (the test runner) the old local-Date and the
// new UTC-Date implementations are extensionally IDENTICAL — so no direct run
// here distinguishes them. The RED proof therefore SIMULATES a non-UTC machine
// arithmetically (it reconstructs exactly what the old local-Date formula emits
// at UTC-7 / UTC+9 and shows it mislabels), while the shipped function does not.
// The round-trip assertions are machine-independent regression locks.

import {
  cosineSim,
  parseEmbedding,
  extractDateFromClipName,
  extractCameraId,
  sceneDateLabels,
} from './scene-detection-core.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }
function approx(a, b, msg, tol = 1e-9) { if (Math.abs(a - b) <= tol) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ~${b}\n    got      ${a}`); } }

// Labels exactly as scene-detection.mjs derives them from a timestamp.
const labelOf = (d) => sceneDateLabels(d);

// ─────────────────────────────────────────────────────────────────────────
// extractDateFromClipName — the fix + round-trip contract
// ─────────────────────────────────────────────────────────────────────────

eq(extractDateFromClipName(null), null, 'null name → null');
eq(extractDateFromClipName(undefined), null, 'undefined name → null');
eq(extractDateFromClipName('no-timestamp-here'), null, 'no match → null');
eq(extractDateFromClipName('C8757_Proxy.MP4'), null, 'camera id but no date → null');

// Exact epoch: the parsed Date is the UTC instant of the encoded wall-clock.
eq(extractDateFromClipName('20241007-2330-C8757_Proxy.MP4').getTime(),
   Date.UTC(2024, 9, 7, 23, 30),
   'parsed time === Date.UTC of encoded wall-clock');

// The load-bearing fix: the label round-trips the filename's wall-clock EXACTLY,
// on any machine, for every time-of-day — including the boundaries the old code
// corrupted on non-UTC machines.
const roundTrips = [
  ['20241007-2330-C8757_Proxy.MP4', '2024-10-07', '23:30'], // late evening — old code's worst case
  ['20241007-0000-C8757_Proxy.MP4', '2024-10-07', '00:00'], // midnight
  ['20241007-2359-C8757_Proxy.MP4', '2024-10-07', '23:59'], // one minute to midnight
  ['20241007-1332-C8757_Proxy.MP4', '2024-10-07', '13:32'], // afternoon
  ['20241231-2330-C1_Proxy.MP4',    '2024-12-31', '23:30'], // year-end late evening
];
for (const [name, day, time] of roundTrips) {
  eq(labelOf(extractDateFromClipName(name)), { day, time }, `round-trip ${name} → ${day} ${time}`);
}

// ─────────────────────────────────────────────────────────────────────────
// RED PROOF (machine-independent): simulate the OLD local-Date formula on a
// non-UTC machine and show it mislabels; the shipped function does not.
// On a machine at UTC+offsetMinutes, `new Date(y,m-1,d,h,min)` produces the
// instant Date.UTC(y,m-1,d,h,min) - offsetMs. This reproduces that arithmetic
// exactly, independent of the test machine's actual timezone.
// ─────────────────────────────────────────────────────────────────────────

function oldFormulaLabelOnMachine(name, offsetMinutes) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const localInstant = wall - offsetMinutes * 60_000; // local-construction skew
  return labelOf(new Date(localInstant));
}

// Pacific (UTC-7, DST): a 23:30 clip gets pushed to the NEXT day by the old code.
const oldPacific = oldFormulaLabelOnMachine('20241007-2330-C8757_Proxy.MP4', -420);
eq(oldPacific, { day: '2024-10-08', time: '06:30' },
   'RED: old local-Date formula on UTC-7 mislabels 2330 → next day 06:30');
eq(labelOf(extractDateFromClipName('20241007-2330-C8757_Proxy.MP4')), { day: '2024-10-07', time: '23:30' },
   'FIX: shipped function labels 2330 correctly (no day/time drift)');
ok(JSON.stringify(oldPacific) !== JSON.stringify(labelOf(extractDateFromClipName('20241007-2330-C8757_Proxy.MP4'))),
   'RED≠FIX: old Pacific behavior diverges from the fix');

// Tokyo (UTC+9): a 00:00 clip gets pushed to the PREVIOUS day by the old code.
const oldTokyo = oldFormulaLabelOnMachine('20241007-0000-C1_Proxy.MP4', 540);
eq(oldTokyo, { day: '2024-10-06', time: '15:00' },
   'RED: old local-Date formula on UTC+9 mislabels 0000 → previous day 15:00');
eq(labelOf(extractDateFromClipName('20241007-0000-C1_Proxy.MP4')), { day: '2024-10-07', time: '00:00' },
   'FIX: shipped function labels midnight correctly on any machine');

// The day-bucket COLLAPSE the bug caused: an evening clip (Oct 7 23:30) and a
// next-morning clip (Oct 8 09:00) belong to DIFFERENT shoot-day buckets. Under
// the old Pacific behavior both bucket to "2024-10-08" — the Oct 7 evening clip
// is swallowed into Oct 8. The fix keeps them distinct on any machine.
const evening = '20241007-2330-C8757_Proxy.MP4';
const morning = '20241008-0900-C8757_Proxy.MP4';
ok(oldFormulaLabelOnMachine(evening, -420).day === oldFormulaLabelOnMachine(morning, -420).day,
   'RED: old Pacific collapses Oct-7-evening + Oct-8-morning into one day bucket');
ok(labelOf(extractDateFromClipName(evening)).day !== labelOf(extractDateFromClipName(morning)).day,
   'FIX: the two clips stay in distinct day buckets on any machine');

// On a UTC machine (offset 0) old and new agree — why the bug was invisible on the Redoubt.
eq(oldFormulaLabelOnMachine(evening, 0), labelOf(extractDateFromClipName(evening)),
   'on UTC the old formula and the fix are identical (bug invisible here)');

// ─────────────────────────────────────────────────────────────────────────
// extractCameraId — worker contract: returns a NUMBER (no "C" prefix), or null
// ─────────────────────────────────────────────────────────────────────────

eq(extractCameraId('20241007-1332-C8757_Proxy.MP4'), 8757, 'camera number from clip name');
eq(extractCameraId('20241007-2330-C12'), 12, 'camera number at end');
eq(extractCameraId('20241007-2330'), null, 'no C-number → null');
eq(extractCameraId(null), null, 'null name → null');
eq(extractCameraId('MVI_1234.mp4'), null, 'no C-number → null');

// ─────────────────────────────────────────────────────────────────────────
// sceneDateLabels — degenerate inputs never throw
// ─────────────────────────────────────────────────────────────────────────

eq(sceneDateLabels(new Date(Date.UTC(2024, 9, 7, 23, 30))), { day: '2024-10-07', time: '23:30' }, 'labels a valid Date');
eq(sceneDateLabels(new Date('not a date')), { day: null, time: null }, 'invalid Date → null labels');
eq(sceneDateLabels(null), { day: null, time: null }, 'null → null labels');
eq(sceneDateLabels('2024-10-07'), { day: null, time: null }, 'string → null labels (not a Date)');

// ─────────────────────────────────────────────────────────────────────────
// cosineSim
// ─────────────────────────────────────────────────────────────────────────

approx(cosineSim([1, 0], [1, 0]), 1, 'identical vectors → 1');
approx(cosineSim([1, 0], [0, 1]), 0, 'orthogonal vectors → 0');
approx(cosineSim([1, 0], [-1, 0]), -1, 'opposite vectors → -1');
approx(cosineSim([0, 0], [1, 1]), 0, 'zero vector → 0 (no NaN)');
approx(cosineSim([1, 2, 3], [2, 4, 6]), 1, 'parallel vectors → 1');

// ─────────────────────────────────────────────────────────────────────────
// parseEmbedding
// ─────────────────────────────────────────────────────────────────────────

eq(parseEmbedding([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3], 'array passes through');
eq(parseEmbedding('[0.1,0.2,0.3]'), [0.1, 0.2, 0.3], 'JSON-array string parses');
eq(parseEmbedding('(0.5, 0.25)'), [0.5, 0.25], 'paren/bracket-stripped CSV string parses');
eq(parseEmbedding(null), null, 'null → null');
eq(parseEmbedding(42), null, 'number → null');

// ─────────────────────────────────────────────────────────────────────────

console.log(`scene-detection-core: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
