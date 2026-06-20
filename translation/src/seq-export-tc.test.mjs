// Lock the Sacred-Selects sequence export's timecode->seconds conversion.
//
// The soundbite-sequence JSON export (the payload Johnny downloads for the
// Premiere extension) turns each soundbite's start/end timecode into the
// inSec/outSec that decide where every clip lands on the Premiere timeline.
// That conversion used to be a DIVERGENT inline `tcToSec` in main.js's click
// handler (zero coverage, threw on a null timecode). It now routes through the
// hardened, anchored, null-safe timeToSeconds shared with the SRT export.
//
// This suite locks that consolidation three ways:
//   1. timeToSeconds is NUMERICALLY IDENTICAL to the old inline tcToSec on
//      every documented soundbite timecode format (so the export is byte-
//      identical for real pastes — zero regression).
//   2. timeToSeconds is strictly SAFER (a null/empty timecode -> 0, where the
//      old inline copy threw — an unhandled crash in the export handler).
//   3. SOURCE-BINDING: the divergent inline tcToSec is gone from main.js and
//      timeToSeconds is imported + wired into inSec/outSec.
//
// Run: bun translation/src/seq-export-tc.test.mjs

import { timeToSeconds } from './srt-builder.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ ' + name); }
}
function eqNum(name, a, b) { ok(name, Math.abs(a - b) < 1e-9); }

// ---- the OLD inline tcToSec, reconstructed verbatim from main.js git history ----
// (kept here ONLY as the equivalence oracle — proves the new path matches it.)
function oldTcToSec(tc) {
  const parts = tc.replace(',', '.').split(':');
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  return parseFloat(parts[0]) || 0;
}

// ---- inline RED proof: the old copy throws on a null/undefined timecode ----
// (a soundbite with no start would crash the whole export handler under the old
//  inline parser; timeToSeconds returns 0 instead.)
let oldThrewOnNull = false;
try { oldTcToSec(null); } catch { oldThrewOnNull = true; }
ok('RED proof: old inline tcToSec THREW on null', oldThrewOnNull);
ok('RED proof: timeToSeconds(null) is safe -> 0', timeToSeconds(null) === 0);

// ---- 1. numeric equivalence on every documented format ----
// HH:MM:SS / MM:SS / plain-seconds, with dot OR comma fractions — the exact
// shapes parseSoundbites stores from the F1-F4 paste formats.
const documented = [
  '00:00:01', '01:02:03', '10:00:00', '99:59:59', '0:00:00',
  '00:58:58.16',            // F4 dot-fraction (frames-as-fraction convention)
  '00:00:05,250',           // comma-decimal (transcription service)
  '1:23.456', '12:05.5', '00:00:00.0',
  '02:30', '12:30.5',       // MM:SS
  '5', '12.5', '7.0', '0',  // plain seconds
];
for (const tc of documented) {
  eqNum(`equiv "${tc}"`, timeToSeconds(tc), oldTcToSec(tc));
}

// spot-check a couple of concrete values so the test isn't purely self-referential
eqNum('01:02:03 -> 3723s', timeToSeconds('01:02:03'), 3723);
eqNum('00:58:58.16 -> 3538.16s', timeToSeconds('00:58:58.16'), 3538.16);
eqNum('00:00:05,250 -> 5.25s (comma)', timeToSeconds('00:00:05,250'), 5.25);
eqNum('plain "12.5" -> 12.5s', timeToSeconds('12.5'), 12.5);

// ---- 2. null-safety the old copy lacked ----
ok('timeToSeconds("") -> 0', timeToSeconds('') === 0);
ok('timeToSeconds(undefined) -> 0', timeToSeconds(undefined) === 0);
ok('timeToSeconds("garbage") -> 0', timeToSeconds('garbage') === 0);

// ---- 3. end-to-end: an exported payload's inSec/outSec match the old parser ----
// mirror exactly what the handler does: inSec: timeToSeconds(b.start), outSec: timeToSeconds(b.end)
const bites = [
  { start: '00:00:01',     end: '00:00:05'    },
  { start: '01:02:03',     end: '01:02:08.5'  },
  { start: '00:58:58.16',  end: '00:59:02,250'},
];
for (const b of bites) {
  eqNum(`payload inSec ${b.start}`, timeToSeconds(b.start), oldTcToSec(b.start));
  eqNum(`payload outSec ${b.end}`, timeToSeconds(b.end), oldTcToSec(b.end));
}

// ---- SOURCE-BINDING: the divergent inline copy is gone, timeToSeconds is wired ----
const main = readFileSync(join(HERE, 'main.js'), 'utf8');
// strip line comments so a comment mentioning "tcToSec" can't pass/fail this
const mainNoComments = main.replace(/\/\/[^\n]*/g, '');
ok('source: inline `const tcToSec =` is GONE from main.js',
   !/const\s+tcToSec\s*=/.test(mainNoComments));
ok('source: timeToSeconds imported from srt-builder',
   /import\s*\{[^}]*\btimeToSeconds\b[^}]*\}\s*from\s*['"]\.\/srt-builder\.js['"]/.test(mainNoComments));
ok('source: inSec wired to timeToSeconds(b.start)',
   /inSec:\s*timeToSeconds\(b\.start\)/.test(mainNoComments));
ok('source: outSec wired to timeToSeconds(b.end)',
   /outSec:\s*timeToSeconds\(b\.end\)/.test(mainNoComments));

console.log(`\nseq-export-tc: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
