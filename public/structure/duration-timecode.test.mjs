// Verifier-layer first coverage for the STRUCTURE board's duration/timecode MATH —
// the live producer-facing numbers, distinct from the CSV escaper (csv-field.test.mjs).
//
// THREE pure cores, all extracted from the shipped index.html at runtime (regex +
// new Function) so the test can't drift from a hand-mirrored copy:
//
//   parseDuration(str)        — a card's `duration` string -> whole seconds. Feeds
//                               BOTH the runtime-total label (updateRuntimeLabel) and
//                               the NLE marker In/Out/Duration columns (export handler).
//   secondsToTimecode(secs)   — seconds -> "HH:MM:SS:00", the In/Out/Duration column
//                               values the editor drops onto the Premiere/Resolve/FCP
//                               timeline. An hour-drop here mis-places every marker.
//   formatDuration(secs)      — seconds -> the "runtime" chip ("MM:SS" under an hour,
//                               "HH:MM:SS" once it crosses one).
//
// Mutation-proven: neuter the base-60 accumulate, the hour term, or the negative
// clamp and the load-bearing assertions turn RED (verified by hand before commit).

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// Each function body contains template literals with `${...}` braces, so a naive
// non-greedy `}` match truncates early. Anchor each on its real terminator.
const parseDuration = (() => {
  const m = html.match(/function parseDuration\(str\)\{[\s\S]*?return secs;\s*\}/);
  assert.ok(m, 'could not find parseDuration() in index.html');
  return new Function(`${m[0]}\nreturn parseDuration;`)();
})();

const secondsToTimecode = (() => {
  const m = html.match(/function secondsToTimecode\(totalSeconds\)\s*\{[\s\S]*?return `[\s\S]*?`;\s*\}/);
  assert.ok(m, 'could not find secondsToTimecode() in index.html');
  return new Function(`${m[0]}\nreturn secondsToTimecode;`)();
})();

const formatDuration = (() => {
  const m = html.match(/function formatDuration\(secs\)\{[\s\S]*?padStart\(2,'0'\)\}`;\s*\}/);
  assert.ok(m, 'could not find formatDuration() in index.html');
  return new Function(`${m[0]}\nreturn formatDuration;`)();
})();

/* ───────────────────────── parseDuration ───────────────────────── */

// Empty / garbage -> 0 (never NaN; the runtime total sums these).
assert.equal(parseDuration(''), 0);
assert.equal(parseDuration(null), 0);
assert.equal(parseDuration(undefined), 0);
assert.equal(parseDuration('   '), 0);
assert.equal(parseDuration('abc'), 0);

// Pure digits are raw SECONDS (the /^\d+$/ branch).
assert.equal(parseDuration('45'), 45);
assert.equal(parseDuration('007'), 7);
assert.equal(parseDuration('0'), 0);

// Colon form is BASE-60 accumulate — the load-bearing contract. "01:30" is 1 min
// 30 s = 90 s, NOT 130. Mutation: change `secs*60+p` to `secs+p` and this goes RED.
assert.equal(parseDuration('01:30'), 90);
assert.equal(parseDuration('1:00'), 60);
assert.equal(parseDuration('02:00'), 120);
assert.equal(parseDuration('01:00:00'), 3600);   // HH:MM:SS
assert.equal(parseDuration('01:12:34'), 4354);   // 1*3600 + 12*60 + 34
assert.equal(parseDuration('00:00'), 0);

// The input mask can emit an out-of-range field ("00:90" when the user types "90");
// base-60 accumulate still yields the correct 90 s. Locked so a future "clamp parts
// to <60" refactor can't silently change the runtime total under Johnny's feet.
assert.equal(parseDuration('00:90'), 90);

// Non-numeric parts are filtered, not NaN-poisoned.
assert.equal(parseDuration('1:xx:30'), 90); // [1, 30] -> 1*60+30

/* ───────────────────────── secondsToTimecode ───────────────────────── */

// Zero -> all-zero, frames field always :00.
assert.equal(secondsToTimecode(0), '00:00:00:00');
// Sub-minute.
assert.equal(secondsToTimecode(10), '00:00:10:00');
// Minutes + seconds.
assert.equal(secondsToTimecode(90), '00:01:30:00');
// The HOUR must survive — an hour-plus assembly is normal for a full doc. Mutation:
// drop the `Math.floor(totalSeconds/3600)` hour term and this goes RED.
assert.equal(secondsToTimecode(3600), '01:00:00:00');
assert.equal(secondsToTimecode(3661), '01:01:01:00');
assert.equal(secondsToTimecode(7325), '02:02:05:00');
// Two-digit zero-padding on every field.
assert.equal(secondsToTimecode(5), '00:00:05:00');
// Fractional seconds floor (cumulativeSeconds is integer here, but be safe).
assert.equal(secondsToTimecode(10.9), '00:00:10:00');

/* ───────────────────────── formatDuration ───────────────────────── */

// Under an hour -> MM:SS (no hour field).
assert.equal(formatDuration(0), '00:00');
assert.equal(formatDuration(9), '00:09');
assert.equal(formatDuration(90), '01:30');
assert.equal(formatDuration(3599), '59:59');
// At/over an hour -> HH:MM:SS.
assert.equal(formatDuration(3600), '01:00:00');
assert.equal(formatDuration(3661), '01:01:01');
// Negative / NaN clamp to 0 (Math.max(0, round(secs||0))). Mutation: drop the
// Math.max(0,...) and the negative case renders garbage.
assert.equal(formatDuration(-5), '00:00');
assert.equal(formatDuration(NaN), '00:00');
// Rounds to the nearest whole second.
assert.equal(formatDuration(89.6), '01:30');

console.log('duration-timecode.test.mjs — all assertions passed');
