// Tests for The Hunter's build-corpus-context worker scene labeling
// (build-corpus-context.mjs step2SceneMaterialization).
//
// Headline bug fixed here: build-corpus-context.mjs had its OWN inline
// extractDateFromClipName that built a machine-LOCAL Date from the filename's
// wall-clock, then derived a scene's shoot_day/time via .toISOString() (UTC) but
// its time_of_day via start.getHours() (LOCAL). On a non-UTC machine (Johnny
// edits on Pacific) the two readbacks disagreed: a late-evening clip ("…-2330")
// got shoot_day=NEXT-day / time='06:30' (UTC drift) while time_of_day stayed
// 'night' (local hour) — an internally CONTRADICTORY scene row, with a wrong day.
// This is a surviving DIVERGENT COPY of the timezone fix already locked in
// scene-detection-core.js (commit 2c2dece). The fix routes build-corpus through
// the shared core: extractDateFromClipName (UTC-constructed) + sceneDateLabels
// (toISOString) for day/time, and timeOfDayFromHour(start.getUTCHours()) so all
// three labels agree with the filename's wall-clock on ANY machine.
//
// HONEST ON RED: on a UTC machine (the test runner) old-local and new-UTC are
// extensionally identical, so the RED proofs SIMULATE a non-UTC machine
// arithmetically (reconstruct exactly what each broken readback emits at UTC-7),
// while the shipped path does not drift. Boundary + integration locks are
// machine-independent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractDateFromClipName,
  sceneDateLabels,
  timeOfDayFromHour,
} from './scene-detection-core.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }

// ── timeOfDayFromHour boundary lock ─────────────────────────────────────────
eq(timeOfDayFromHour(0), 'night', 'tod: 0 → night');
eq(timeOfDayFromHour(5), 'night', 'tod: 5 → night (last night hour before dawn)');
eq(timeOfDayFromHour(6), 'dawn', 'tod: 6 → dawn');
eq(timeOfDayFromHour(7), 'dawn', 'tod: 7 → dawn');
eq(timeOfDayFromHour(8), 'morning', 'tod: 8 → morning');
eq(timeOfDayFromHour(11), 'morning', 'tod: 11 → morning');
eq(timeOfDayFromHour(12), 'midday', 'tod: 12 → midday');
eq(timeOfDayFromHour(13), 'midday', 'tod: 13 → midday');
eq(timeOfDayFromHour(14), 'afternoon', 'tod: 14 → afternoon');
eq(timeOfDayFromHour(16), 'afternoon', 'tod: 16 → afternoon');
eq(timeOfDayFromHour(17), 'golden-hour', 'tod: 17 → golden-hour');
eq(timeOfDayFromHour(18), 'golden-hour', 'tod: 18 → golden-hour');
eq(timeOfDayFromHour(19), 'evening', 'tod: 19 → evening');
eq(timeOfDayFromHour(20), 'evening', 'tod: 20 → evening');
eq(timeOfDayFromHour(21), 'night', 'tod: 21 → night');
eq(timeOfDayFromHour(23), 'night', 'tod: 23 → night');

// ── Machine simulation helpers (runner is UTC; simulate offset machines) ─────
const NAME = '20241007-2330-C8757_Proxy.MP4'; // filename wall-clock = Oct 7, 23:30
const PACIFIC = -420; // UTC-7 (DST)

// What scene-detection.mjs / build-corpus WOULD compute for a clip name's labels,
// given a machine UTC offset, under each readback strategy.
function wallMs(name) {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), hour: +m[4] };
}
// OLD build-corpus: local-constructed Date → toISOString() day/time + getHours() tod.
function oldReadbackOnMachine(name, offsetMin) {
  const { ms, hour } = wallMs(name);
  const localInstant = ms - offsetMin * 60_000; // new Date(y,mo,d,h,mi) skew on this machine
  const d = new Date(localInstant);
  const iso = d.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16), tod: timeOfDayFromHour(hour) /* getHours()=filename hour */ };
}
// NAIVE half-fix: UTC-constructed Date (day/time correct) but STILL getHours() for tod.
function naiveFixReadbackOnMachine(name, offsetMin) {
  const { ms } = wallMs(name);
  const d = new Date(ms); // UTC-constructed instant
  const iso = d.toISOString();
  const localHour = Math.floor(((ms + offsetMin * 60_000) % 86_400_000 + 86_400_000) % 86_400_000 / 3_600_000);
  return { day: iso.slice(0, 10), time: iso.slice(11, 16), tod: timeOfDayFromHour(localHour) };
}
// SHIPPED fix: machine-independent (UTC date + sceneDateLabels + getUTCHours()).
function shippedReadback(name) {
  const start = extractDateFromClipName(name);
  const { day, time } = sceneDateLabels(start);
  return { day, time, tod: timeOfDayFromHour(start.getUTCHours()) };
}

// RED-A: old readback on Pacific drifts the DAY/TIME forward while tod stays
// 'night' — the internally contradictory, wrong-day scene row.
const oldPac = oldReadbackOnMachine(NAME, PACIFIC);
eq(oldPac, { day: '2024-10-08', time: '06:30', tod: 'night' },
   'RED-A: old build-corpus on UTC-7 → day/time drift to Oct-8 06:30 but tod still night (contradiction + wrong day)');
ok(oldPac.day !== '2024-10-07',
   'RED-A: old shoot_day is the WRONG calendar day on Pacific');

// RED-B: the trap the getUTCHours() change avoids — UTC date + getHours() would
// instead drift the TIME-OF-DAY (afternoon) while day/time are correct.
const naivePac = naiveFixReadbackOnMachine(NAME, PACIFIC);
eq(naivePac, { day: '2024-10-07', time: '23:30', tod: 'afternoon' },
   'RED-B: UTC-date + getHours() → correct day but tod drifts to afternoon (why getUTCHours is load-bearing)');

// FIX: shipped readback is correct AND internally consistent on every machine.
eq(shippedReadback(NAME), { day: '2024-10-07', time: '23:30', tod: 'night' },
   'FIX: shipped readback → Oct-7 23:30, night — all three labels agree with the filename');
ok(JSON.stringify(shippedReadback(NAME)) !== JSON.stringify(oldPac),
   'RED-A ≠ FIX: old Pacific behavior diverges from the shipped path');
ok(JSON.stringify(shippedReadback(NAME)) !== JSON.stringify(naivePac),
   'RED-B ≠ FIX: naive half-fix diverges from the shipped path');

// A dawn-edge clip: filename 06:05 → dawn, day = filename day, on any machine.
eq(shippedReadback('20241007-0605-C2_Proxy.MP4'), { day: '2024-10-07', time: '06:05', tod: 'dawn' },
   'FIX: 06:05 clip → dawn, correct day');
// Midnight clip (the Tokyo-style previous-day trap on the OTHER side).
eq(shippedReadback('20241007-0000-C3_Proxy.MP4'), { day: '2024-10-07', time: '00:00', tod: 'night' },
   'FIX: 00:00 clip → midnight night, correct day (no previous-day drift)');

// ── Source binding: the divergent inline copies are GONE + shared import wired ─
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'build-corpus-context.mjs'), 'utf8');
// strip line comments so prose mentions don't trip the assertions
const code = src.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok(!/function\s+extractDateFromClipName/.test(code),
   'source: inline extractDateFromClipName is removed (no divergent copy)');
ok(!/function\s+timeOfDayFromHour/.test(code),
   'source: inline timeOfDayFromHour is removed (no divergent copy)');
ok(/from\s+'\.\/scene-detection-core\.js'/.test(code),
   'source: imports the shared scene-detection-core.js');
ok(/getUTCHours\(\)/.test(code) && !/start\.getHours\(\)/.test(code),
   'source: time_of_day reads getUTCHours() (not local getHours())');
ok(/sceneDateLabels\(start\)/.test(code),
   'source: day/time read via shared sceneDateLabels(start)');

console.log(`\nbuild-corpus-time: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
