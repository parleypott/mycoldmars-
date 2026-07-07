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

// The two INPUT MASKS, run on every keystroke in the card inspector. They format
// what the editor types and STORE the result verbatim as card.source / card.duration
// — the same card.duration parseDuration reads back for the runtime total and every
// exported NLE marker In/Out/Duration. So the mask output IS the producer input;
// a grouping drift here silently corrupts the stored value under Johnny's feet.
// Their bodies carry regex literals with `{2}` (a bare `}`), so a naive non-greedy
// `}` match truncates early — anchor each on its real `return padded.replace(...)`.
const formatTimecode = (() => {
  const m = html.match(/function formatTimecode\(value\)\s*\{[\s\S]*?return padded\.replace\([\s\S]*?\);\s*\}/);
  assert.ok(m, 'could not find formatTimecode() in index.html');
  return new Function(`${m[0]}\nreturn formatTimecode;`)();
})();

const formatDurationInput = (() => {
  const m = html.match(/function formatDurationInput\(value\)\s*\{[\s\S]*?\$1:\$2:\$3'\);\s*\}\s*\}/);
  assert.ok(m, 'could not find formatDurationInput() in index.html');
  return new Function(`${m[0]}\nreturn formatDurationInput;`)();
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

/* ───────────────────────── formatTimecode (source-TC mask) ───────────────────────── */

// Empty typing clears the field (never renders "00:00:00:00" onto an empty input).
assert.equal(formatTimecode(''), '');
assert.equal(formatTimecode('abc'), '');            // non-digits stripped to nothing
// Right-to-left fill into HH:MM:SS:FF, zero-padded to 8 digits. Mutation: shrink the
// padStart(8) and a short entry stops matching the 4-group regex → returns unformatted.
assert.equal(formatTimecode('1'), '00:00:00:01');
assert.equal(formatTimecode('12'), '00:00:00:12');
assert.equal(formatTimecode('123456'), '00:12:34:56');
assert.equal(formatTimecode('12345678'), '12:34:56:78');
// Overflow keeps the LAST 8 digits (slice(-8)), matching the on-screen mask.
assert.equal(formatTimecode('123456789'), '23:45:67:89');
// Idempotent on an already-formatted value (re-typing / paste round-trips clean).
assert.equal(formatTimecode('01:02:03:04'), '01:02:03:04');
// Non-digits interspersed are stripped, not positional.
assert.equal(formatTimecode('ab12cd'), '00:00:00:12');

/* ───────────────────────── formatDurationInput (duration mask) ───────────────────────── */

// Empty clears. Non-digits strip to nothing.
assert.equal(formatDurationInput(''), '');
assert.equal(formatDurationInput('xx'), '');
// ≤4 digits → MM:SS. Mutation: change padStart(4)→(3) or the /(\d{2})(\d{2})/ groups
// and "130" stops matching → the raw string leaks into card.duration.
assert.equal(formatDurationInput('5'), '00:05');
assert.equal(formatDurationInput('130'), '01:30');
assert.equal(formatDurationInput('1234'), '12:34');
// ≥5 digits → HH:MM:SS. Mutation: drop the `> 4` branch and an hour-long clip's
// duration mis-groups.
assert.equal(formatDurationInput('12345'), '01:23:45');
assert.equal(formatDurationInput('123456'), '12:34:56');
// Overflow keeps the LAST 6 digits (slice(-6)).
assert.equal(formatDurationInput('1234567'), '23:45:67');
// Non-digits stripped.
assert.equal(formatDurationInput('a5b'), '00:05');

/* ─────────────────── mask → parseDuration ROUND-TRIP (the pipeline contract) ─────────────────── */
// What the mask STORES must be what parseDuration reads back in whole seconds — this
// is the seam that keeps the runtime total and every exported marker Duration honest.
// Locked so a future mask refactor can't drift the stored string away from what the
// base-60 parser expects.
assert.equal(parseDuration(formatDurationInput('5')), 5);        // 00:05
assert.equal(parseDuration(formatDurationInput('130')), 90);     // 01:30
assert.equal(parseDuration(formatDurationInput('500')), 300);    // 05:00 = 5 min
assert.equal(parseDuration(formatDurationInput('1234')), 754);   // 12:34 = 12*60+34
assert.equal(parseDuration(formatDurationInput('12345')), 5025); // 01:23:45
assert.equal(parseDuration(formatDurationInput('130000')), 46800); // 13:00:00 = 13*3600

console.log('duration-timecode.test.mjs — all assertions passed');
