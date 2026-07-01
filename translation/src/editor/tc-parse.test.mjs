// Locks tcToSeconds — the bubble-menu timecode parser behind the producer-facing
// "copy timecode from selection" range in the Interpreter editor. Two jobs:
//   1. Mutation-lock the parse math (HH:MM:SS[.,]f / MM:SS[.f] / bare seconds).
//   2. Cross-check the SHARED input space against the canonical
//      parseTimecodeToSeconds, and lock the ONE intentional divergence (empty
//      input → NaN vs 0) that getSelectionTimecodes' isFinite() skip relies on.
// Run: node translation/src/editor/tc-parse.test.mjs

import { tcToSeconds } from './tc-parse.js';
import { parseTimecodeToSeconds } from '../timecode-utils.js';

let pass = 0, fail = 0;
const APPROX = 1e-9;
function eq(got, want, msg) {
  const ok = (Number.isNaN(got) && Number.isNaN(want)) ||
    (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < APPROX) ||
    got === want;
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got=${got} want=${want}`); }
}

// --- Parse math (mutation-locked) ---------------------------------------
eq(tcToSeconds('1:05:30.1'), 3930.1, 'HH:MM:SS.f');       // catches *3600 drop
eq(tcToSeconds('1:02:03'), 3723, 'HH:MM:SS no frac');
eq(tcToSeconds('5:30.1'), 330.1, 'MM:SS.f');              // catches *60 drop
eq(tcToSeconds('2:03'), 123, 'MM:SS');
eq(tcToSeconds('105.4'), 105.4, 'bare decimal seconds');
eq(tcToSeconds('00:01:45,400'), 105.4, 'SRT comma millis (HH:MM:SS,mmm)');
eq(tcToSeconds('00:00:05,040'), 5.04, 'SRT comma millis, leading-zero frame');
eq(tcToSeconds('90:00'), 5400, 'MM:SS over 60 minutes');  // 90 min, not clamped
eq(tcToSeconds(3723.5), 3723.5, 'numeric passthrough');

// Load-bearing: the hour component must actually multiply by 3600, and the
// minute by 60 — a leading-MM:SS regression (dropping the hour term) would
// turn "1:05:30.1" into 330.1. Guard that explicitly.
eq(tcToSeconds('1:05:30.1') - tcToSeconds('5:30.1'), 3600, 'hour term = 3600s');

// --- The intentional empty→NaN skip contract ----------------------------
// getSelectionTimecodes() does `if (isFinite(s) && s < earliest)`, so a mark
// with an empty start/end attr must yield NON-finite (skipped), NOT 0.
if (Number.isNaN(tcToSeconds('')) && !Number.isFinite(tcToSeconds(''))) pass++;
else { fail++; console.error('FAIL: empty input must be NaN (skip contract), got ' + tcToSeconds('')); }
if (Number.isNaN(tcToSeconds(null)) && Number.isNaN(tcToSeconds(undefined))) pass++;
else { fail++; console.error('FAIL: null/undefined must be NaN (skip contract)'); }
// And the canonical parser must differ here (documents WHY the copy exists).
if (parseTimecodeToSeconds('') === 0 && !Number.isFinite(tcToSeconds(''))) pass++;
else { fail++; console.error('FAIL: divergence contract broken — canonical("") should be 0, tc("") should be non-finite'); }

// --- Cross-check: identical to canonical over the SHARED input space -----
// Every realistic segment timecode must parse to the SAME seconds through both
// parsers. If a future edit makes either drift, this block goes red.
const shared = [
  '1:05:30.1', '5:30.1', '00:01:45,400', '105.4', '1:02:03', '0:00.0',
  '00:00:05,040', '1:2:3.5', '01:02:03.456', '12:34', '2:03', '00:01:45,4',
  '0:59.96', '1:05:30', '90:00', '01:02:03,999',
];
for (const tc of shared) {
  eq(tcToSeconds(tc), parseTimecodeToSeconds(tc), `cross-check "${tc}" matches canonical`);
}

console.log(`tc-parse: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
