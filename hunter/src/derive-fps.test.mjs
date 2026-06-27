// Lock for deriveFps — the shared NTSC frame-rate derivation used by BOTH FCP7
// parsers (hunter/src/xml-parser.js in-browser + hunter/worker/selects-parse-core.js
// at ingest). This module exists to kill a divergent-weaker copy: the worker's
// inline derivation handled 24→23.976 and 30→29.97 but FELL THROUGH on timebase 60,
// reading 59.94p footage as a flat 60fps and inflating every ingested source
// timecode ~0.1%. The 60→59.94 case below is the load-bearing guard.
//
// Run: bun hunter/src/derive-fps.test.mjs   (also picked up by `bun run test`)

import { deriveFps } from './derive-fps.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n   got:  ${got}\n   want: ${want}`); }
}

// ── NTSC fractional rates (the real editorial rates) ──
eq('24 + ntsc → 23.976', deriveFps(24, true), 23.976);
eq('30 + ntsc → 29.97',  deriveFps(30, true), 29.97);
// THE load-bearing case — the historical worker bug. Neuter the `case 60` line in
// derive-fps.js and this assertion goes RED (and the worker re-inflates 60p corpus).
eq('60 + ntsc → 59.94 (the divergence the worker was missing)', deriveFps(60, true), 59.94);

// ── Non-NTSC: integer timebase passes straight through ──
eq('24 non-ntsc → 24', deriveFps(24, false), 24);
eq('25 (PAL) non-ntsc → 25', deriveFps(25, false), 25);
eq('30 non-ntsc → 30', deriveFps(30, false), 30);
eq('60 non-ntsc → 60', deriveFps(60, false), 60);

// ── Unknown timebase: pass through unchanged (don't guess a fractional rate) ──
eq('48 + ntsc → 48 (no canonical mapping, unchanged)', deriveFps(48, true), 48);
eq('25 + ntsc → 25 (PAL is never NTSC; unchanged)', deriveFps(25, true), 25);

// ── Round-trip contract with the writer's isNtscRate bands (|fps - x| < 0.01) ──
// Each derived NTSC rate must land inside the writer's tolerance window so a
// write→read of an NTSC sequence preserves its rate.
for (const [tb, want] of [[24, 23.976], [30, 29.97], [60, 59.94]]) {
  const f = deriveFps(tb, true);
  eq(`derived ${tb}+ntsc within isNtscRate band of ${want}`, Math.abs(f - want) < 0.01, true);
}

console.log(`\nderive-fps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
