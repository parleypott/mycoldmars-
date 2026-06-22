// Locks fmtShortTimecode — the Interpreter's summary-timecode DISPLAY formatter,
// consolidated from two byte-identical inline copies in main.js (the standalone
// fmtShortTimecode + the inner fmtShort in enrichSummaryWithTimecodes).
//
// Imports the REAL shipped function. Proves:
//   (1) the extraction is byte-identical to the OLD inline logic across a wide
//       battery (the no-regression / equivalence proof — both copies were
//       identical, so this pins that consolidating changed nothing), and
//   (2) the load-bearing display contract (hour-carry, MM:SS, plain seconds,
//       fractional drop, unparseable -> 0:00).
//
// Mutation-proof: break the hour-carry in short-timecode.js
//   (`h > 0 ? ...` -> `false ? ...`) -> the hour-carry + equivalence cases go RED.
//   Drop the HH:MM:SS branch -> the HH:MM:SS cases go RED. Restore -> all GREEN.

import { fmtShortTimecode } from './short-timecode.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => { if (a === b) pass++; else { fail++; console.error(`FAIL: ${msg}\n  expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); } };

// ── Faithful reconstruction of the OLD inline copies (byte-identical to both) ──
// This is the divergent copy the source used to carry twice; the equivalence
// sweep below proves the shipped helper matches it for every input.
function oldInline(tc) {
  let secs;
  if (/^\d+(\.\d+)?$/.test(tc)) { secs = parseFloat(tc); }
  else {
    const m = tc.match(/(\d+):(\d+):(\d+)/);
    if (m) secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
    else { const m2 = tc.match(/(\d+):(\d+)/); secs = m2 ? parseInt(m2[1]) * 60 + parseInt(m2[2]) : 0; }
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ── (1) Equivalence sweep: shipped === old inline for every realistic input ──
const battery = [
  // plain seconds (the seg.start common shape)
  '0', '1', '5', '59', '60', '61', '125', '125.5', '599', '600', '3599',
  '3600', '3661', '7325', '0.0', '0.4', '0.9', '59.95', '3599.99', '90061',
  // HH:MM:SS
  '00:00:00', '0:00:00', '01:02:03', '1:05:30', '00:58:58', '12:05:09',
  '02:02:01', '99:00:00',
  // MM:SS
  '0:00', '5:30', '12:05', '59:59', '75:30', '120:05', '00:09',
  // fractional-second timecode forms (the parser ignores the fraction)
  '00:58:58.16', '1:23.456', '12:05.5',
  // unparseable / empty -> 0
  '', 'garbage', 'abc:def', '—', 'n/a',
];
for (const tc of battery) {
  eq(fmtShortTimecode(tc), oldInline(tc), `equivalence: fmtShortTimecode(${JSON.stringify(tc)}) === old inline`);
}

// ── (2) Load-bearing display contract (explicit known outputs) ──
// hour-carry on hour-plus inputs (the class that harbored real bugs this week)
eq(fmtShortTimecode('3661'), '1:01:01', 'plain seconds hour-carry');
eq(fmtShortTimecode('7325'), '2:02:05', 'plain seconds multi-hour');
eq(fmtShortTimecode('01:02:03'), '1:02:03', 'HH:MM:SS keeps the hour');
eq(fmtShortTimecode('99:00:00'), '99:00:00', 'large hour preserved');
// hour-less -> M:SS (no leading 0: prefix)
eq(fmtShortTimecode('600'), '10:00', 'sub-hour plain seconds -> M:SS');
eq(fmtShortTimecode('5:30'), '5:30', 'MM:SS preserved');
eq(fmtShortTimecode('0:00'), '0:00', 'zero MM:SS');
eq(fmtShortTimecode('0'), '0:00', 'zero seconds -> 0:00');
// fractional seconds dropped (floored) for the short display
eq(fmtShortTimecode('125.9'), '2:05', 'fractional second floored');
eq(fmtShortTimecode('00:58:58.16'), '58:58', 'HH:MM:SS.mmm -> minutes/seconds (sub-hour after parse)');
eq(fmtShortTimecode('1:23.456'), '1:23', 'MM:SS.mmm fraction dropped');
// the boundary at exactly one hour
eq(fmtShortTimecode('3600'), '1:00:00', 'exactly one hour carries');
eq(fmtShortTimecode('3599'), '59:59', 'one second under an hour stays M:SS');
// minutes/seconds zero-padded once an hour appears; minutes NOT padded otherwise
eq(fmtShortTimecode('3665'), '1:01:05', 'mm and ss zero-padded with hour');
eq(fmtShortTimecode('65'), '1:05', 'minutes not padded without an hour');
// unparseable / empty -> 0:00 (never throws on a string)
eq(fmtShortTimecode(''), '0:00', 'empty -> 0:00');
eq(fmtShortTimecode('garbage'), '0:00', 'garbage -> 0:00');

console.log(`\nshort-timecode: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
