// essays player — fmt() playback-clock formatter coverage.
//
// THE BUG (fixed): fmt() rendered MM:SS with no hour carry, so an essay past 1:00:00
// (night-market-paper.mp3 is 1:17:47) displayed "77:47" on the live time / duration /
// resume-pill readouts. Same hour-drop class fixed repeatedly across the repo this week
// (SRT, gemini formatSeconds, format-clock, format-tc, selects-context). This is the
// surviving copy in the legacy-but-live /essays Taiwan/Hong-Kong audio player.
//
// This test EXTRACTS the REAL shipped fmt from essays/index.html at runtime (new Function),
// so it can never drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// Pull the exact shipped fmt() body out of the inline script.
const m = html.match(/function fmt\(s\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not locate fmt() in essays/index.html');
const fmt = new Function('s', m[0].replace(/^function fmt\(s\)\s*\{/, '').replace(/\}\s*$/, ''));

// The OLD, buggy formatter — for the inline RED proof.
const oldFmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  try { assert.equal(got, want, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ---- RED proof: the old formatter drops the hour on the real 1:17:47 essay ----
eq(oldFmt(4667), '77:47', 'RED proof: old fmt drops the hour (1:17:47 → "77:47")');
assert.notEqual(oldFmt(4667), '1:17:47', 'RED proof: old fmt is NOT correct on hour-plus');

// ---- THE FIX: hour carry ----
eq(fmt(4667), '1:17:47', 'night-market-paper 1:17:47 renders with the hour');     // the live essay
eq(fmt(3600), '1:00:00', 'exact one hour boundary');
eq(fmt(3599), '59:59', 'one second under the hour stays MM:SS');
eq(fmt(3661), '1:01:01', 'minutes are zero-padded once the hour appears');
eq(fmt(3725.9), '1:02:05', 'fractional seconds floored, hour carried');
eq(fmt(7325), '2:02:05', 'multi-hour');

// ---- NO REGRESSION: sub-hour is byte-identical to the old formatter ----
for (const s of [333, 333.7, 0.4, 59, 60, 61, 1772, 1733, 26 * 60 + 42, 599, 600]) {
  eq(fmt(s), oldFmt(s), `sub-hour byte-identical to old fmt @ ${s}s`);
}
// The four shorter essays' label durations as second-counts.
eq(fmt(5 * 60 + 33), '5:33', 'hong-kong-died-on-tv 5:33');
eq(fmt(12 * 60 + 15), '12:15', 'island-in-time 12:15');
eq(fmt(28 * 60 + 52), '28:52', 'the-island-that-became-itself 28:52');
eq(fmt(26 * 60 + 42), '26:42', 'night-market 26:42');

// ---- guards unchanged ----
eq(fmt(0), '0:00', 'zero → 0:00');
eq(fmt(NaN), '0:00', 'NaN → 0:00');
eq(fmt(undefined), '0:00', 'undefined → 0:00');
eq(fmt(null), '0:00', 'null → 0:00');

if (fail) { console.error(`fmt: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`fmt: ${pass} passed, 0 failed`);
