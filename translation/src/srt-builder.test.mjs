// Tests for srt-builder.js — focus on timeToSeconds (the HH:MM:SS hour-drop
// bug) plus formatSRT and a buildSRT integration check.
// Run: node translation/src/srt-builder.test.mjs
import { timeToSeconds, formatSRT, buildSRT } from './srt-builder.js';

let pass = 0, fail = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-6;
function eq(actual, expected, label) {
  const ok = typeof expected === 'number' ? approx(actual, expected) : actual === expected;
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ---- timeToSeconds: the load-bearing bug (HH:MM:SS with no fraction) ----
eq(timeToSeconds('01:02:03'), 3723, 'HH:MM:SS keeps the hour (was the bug: dropped to 00:02:03)');
eq(timeToSeconds('1:00:00'), 3600, 'single-digit hour HH:MM:SS');
eq(timeToSeconds('02:00:00'), 7200, 'two hours');
eq(timeToSeconds('10:20:30'), 37230, 'double-digit hour');

// ---- timeToSeconds: fractional forms still work ----
eq(timeToSeconds('01:02:03.500'), 3723.5, 'HH:MM:SS.mmm');
eq(timeToSeconds('01:02:03,500'), 3723.5, 'HH:MM:SS,mmm (SRT comma)');
eq(timeToSeconds('00:00:01.5'), 1.5, 'tenths pad: .5 -> 500ms');
eq(timeToSeconds('00:00:01.05'), 1.05, 'hundredths pad: .05 -> 50ms');
eq(timeToSeconds('00:00:01.2345'), 1.234, 'over-precise ms truncated to 3 digits');

// ---- timeToSeconds: MM:SS forms ----
eq(timeToSeconds('02:03'), 123, 'MM:SS no fraction');
eq(timeToSeconds('02:03.250'), 123.25, 'MM:SS.mmm');
eq(timeToSeconds('00:30'), 30, 'MM:SS small');

// ---- timeToSeconds: plain seconds + degenerate ----
eq(timeToSeconds('12.5'), 12.5, 'plain float seconds');
eq(timeToSeconds('65'), 65, 'plain int seconds');
eq(timeToSeconds(''), 0, 'empty -> 0');
eq(timeToSeconds(null), 0, 'null -> 0');
eq(timeToSeconds('garbage'), 0, 'non-numeric -> 0');
eq(timeToSeconds('  01:02:03  '), 3723, 'whitespace trimmed');

// ---- formatSRT: standard + carry/cap edges ----
eq(formatSRT(3723), '01:02:03,000', 'formatSRT one-hour-plus');
eq(formatSRT(0), '00:00:00,000', 'formatSRT zero');
eq(formatSRT(1.5), '00:00:01,500', 'formatSRT tenths');
eq(formatSRT(0.9995), '00:00:01,000', 'formatSRT ms-rounds-to-1000 carries into seconds');
eq(formatSRT(59.9995), '00:01:00,000', 'formatSRT carry sec->min');
eq(formatSRT(-5), '00:00:00,000', 'formatSRT negative clamps to 0');
eq(formatSRT(Infinity), '00:00:00,000', 'formatSRT non-finite clamps to 0');
eq(formatSRT(100 * 3600), '99:59:59,999', 'formatSRT >=100h capped to 2-digit hours');

// ---- buildSRT integration: round-trips an HH:MM:SS segment correctly ----
{
  const out = buildSRT(
    [{ number: 1, translated: 'hello world' }],
    [{ number: 1, start: '01:02:03', end: '01:02:05' }]
  );
  eq(out, '1\r\n01:02:03,000 --> 01:02:05,000\r\nhello world\r\n',
     'buildSRT preserves the hour end-to-end (regression for the original bug)');
}

// buildSRT: under-the-cap short cue uses original times; CRLF endings
{
  const out = buildSRT(
    [{ number: 1, translated: 'short line' }],
    [{ number: 1, start: '00:00:00', end: '00:00:02' }]
  );
  eq(out.includes('\r\n'), true, 'buildSRT uses CRLF line endings');
  eq(out.startsWith('1\r\n00:00:00,000 --> 00:00:02,000'), true, 'buildSRT short cue keeps original timing');
}

// ---- buildSRT: maxWords/maxDuration limits must reject non-positive/non-finite ----
// The old `opts.maxWords || 16` form caught undefined/NaN/0 but NOT a negative
// value (truthy), so `-1` sailed through and `Math.ceil(words/-1)` went negative —
// defeating word-based splitting so a long line collapsed into ONE oversized cue.
// posLimit() now degrades any non-positive/non-finite limit to the default.
const cueCount = (srt) => (srt.match(/-->/g) || []).length;
{
  // 30-word line, 2s duration: with maxWords=16 the words term forces 2 chunks
  // (ceil(30/16)=2); the duration term is just ceil(2/5)=1. So a correct limit
  // splits into >=2 cues. A negative maxWords that leaks through yields ceil(30/-1)
  // = -30, Math.max picks the duration term (1), and the whole line stays one cue.
  const longLine = Array.from({ length: 30 }, (_, i) => `w${i + 1}`).join(' ');
  const seg = [{ number: 1, start: '00:00:00', end: '00:00:02' }];
  const tr = [{ number: 1, translated: longLine }];

  const baseline = cueCount(buildSRT(tr, seg, { maxWords: 16, maxDuration: 5 }));
  eq(baseline >= 2, true, 'sanity: maxWords=16 splits the 30-word line into >=2 cues');

  // The load-bearing assertion — a negative limit must behave like the default,
  // not defeat splitting (this goes RED if posLimit reverts to `|| 16`).
  eq(cueCount(buildSRT(tr, seg, { maxWords: -1, maxDuration: 5 })), baseline,
     'negative maxWords falls back to default (does NOT collapse into one oversized cue)');

  // The cases the old `|| default` already handled stay handled.
  eq(cueCount(buildSRT(tr, seg, { maxWords: 0, maxDuration: 5 })), baseline, 'zero maxWords -> default');
  eq(cueCount(buildSRT(tr, seg, { maxWords: NaN, maxDuration: 5 })), baseline, 'NaN maxWords -> default');
  eq(cueCount(buildSRT(tr, seg, { maxWords: undefined, maxDuration: 5 })), baseline, 'missing maxWords -> default');

  // A valid positive limit must still pass through (not get clobbered to the default):
  // maxWords=4 forces more chunks (ceil(30/4)=8) than the default 16 (=2).
  eq(cueCount(buildSRT(tr, seg, { maxWords: 4, maxDuration: 5 })) > baseline, true,
     'valid small maxWords still tightens splitting (limit honored, not defaulted)');
}

console.log(`\nsrt-builder: ${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
