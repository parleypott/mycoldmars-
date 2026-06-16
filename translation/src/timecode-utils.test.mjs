/**
 * Tests for timecode-utils — the core display formatter + parser used across
 * main.js and sot-hunter.js. Run: node src/timecode-utils.test.mjs
 *
 * Focus: the fractional-carry bug. formatPreciseTimecode rounds the tenths
 * place; when the sub-second part rounds up to a full second (>= .95) the carry
 * must propagate into seconds → minutes → hours, never emit a bare ".10".
 */
import { formatPreciseTimecode, parseTimecodeToSeconds } from './timecode-utils.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const near = (got, want, label, tol = 1e-6) => {
  if (Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${got} want ${want}`); }
};

// ── docstring examples (must keep working) ──
eq(formatPreciseTimecode(105.4),  '1:45.4',     'docstring 105.4');
eq(formatPreciseTimecode(3930.12), '1:05:30.1', 'docstring 3930.12');

// ── basic shapes ──
eq(formatPreciseTimecode(0),     '0:0.0',    'zero');
eq(formatPreciseTimecode(5),     '0:5.0',    'five seconds');
eq(formatPreciseTimecode(65.5),  '1:05.5',   'one min five and a half');
eq(formatPreciseTimecode(3600),  '1:00:00.0','one hour');

// ── guard rails ──
eq(formatPreciseTimecode(-3),       '0:00.0', 'negative clamps');
eq(formatPreciseTimecode(Infinity), '0:00.0', 'infinity clamps');
eq(formatPreciseTimecode(NaN),      '0:00.0', 'NaN clamps');

// ── the carry bug: sub-second rounds up to a whole second ──
eq(formatPreciseTimecode(5.96),    '0:6.0',     'carry: 5.96 -> 6.0 (not 5.10)');
eq(formatPreciseTimecode(59.96),   '1:00.0',    'carry: 59.96 -> 1:00.0 (not 0:59.10)');
eq(formatPreciseTimecode(3599.96), '1:00:00.0', 'carry: 3599.96 across minute+hour (not 59:59.10)');
eq(formatPreciseTimecode(119.95),  '2:00.0',    'carry: 119.95 -> 2:00.0');
// nothing should ever render a ".10" tenths field
for (const t of [5.96, 59.96, 3599.96, 9.95, 0.95, 119.95]) {
  const out = formatPreciseTimecode(t);
  if (/\.10$|\.\d\d/.test(out)) { fail++; console.log(`FAIL no-bad-frac ${t}: ${out}`); }
  else pass++;
}

// ── parser sanity (used for the round trip on display strings) ──
near(parseTimecodeToSeconds('1:45.4'),    105.4,  'parse 1:45.4');
near(parseTimecodeToSeconds('1:05:30.1'), 3930.1, 'parse 1:05:30.1');
near(parseTimecodeToSeconds('00:01:45,400'), 105.4, 'parse SRT comma ms');
near(parseTimecodeToSeconds('105.4'),     105.4,  'parse bare decimal');
near(parseTimecodeToSeconds('2:00'),      120,    'parse M:SS');
near(parseTimecodeToSeconds(''),          0,      'parse empty');

// ── round trip: format then parse should land back within a tenth ──
for (const sec of [0, 5, 65.5, 105.4, 3599.96, 3930.12]) {
  const round = parseTimecodeToSeconds(formatPreciseTimecode(sec));
  if (Math.abs(round - sec) <= 0.05 + 1e-9) pass++;
  else { fail++; console.log(`FAIL round-trip ${sec}: -> "${formatPreciseTimecode(sec)}" -> ${round}`); }
}

console.log(fail === 0
  ? `PASS — all ${pass} timecode cases correct`
  : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
