// Tests for deriveFps — the FCP7 <rate> (integer timebase + ntsc flag) → true
// frame rate mapping in hunter/src/xml-parser.js, used to convert clip frame
// positions to seconds on selects ingest.
//
// REAL BUG fixed: a 59.94fps sequence is stored in FCP7 XML as timebase=60 +
// ntsc=TRUE, but deriveFps only mapped 24→23.976 and 30→29.97 and returned the
// raw 60 for 60+NTSC. Every imported 59.94 clip's frame→seconds conversion was
// then inflated ~0.1% (~3.6s/hour drift) — the exact inverse of the xml-writer
// NTSC fix, and a round-trip-agreement break between the two files.
//
// Run: bun hunter/src/xml-parser-fps.test.mjs

import { deriveFps } from './xml-parser.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    got:  ${got}\n    want: ${want}`); }
};

// --- THE FIX: 60 + NTSC → 59.94 (was the raw 60) ---
eq('60 + ntsc → 59.94', deriveFps(60, true), 59.94);

// --- inline RED proof: the OLD derivation returned the raw timebase for 60+NTSC ---
const oldDerive = (timebase, ntsc) =>
  ntsc ? (timebase === 24 ? 23.976 : timebase === 30 ? 29.97 : timebase) : timebase;
eq('RED proof: old code mis-returned 60 for 60+ntsc', oldDerive(60, true), 60);
eq('RED proof: new code differs from old on 60+ntsc', deriveFps(60, true) !== oldDerive(60, true), true);

// --- the other NTSC family members still map correctly (no regression) ---
eq('24 + ntsc → 23.976', deriveFps(24, true), 23.976);
eq('30 + ntsc → 29.97', deriveFps(30, true), 29.97);

// --- round-trip agreement with the writer's canonical isNtscRate set ---
// xml-writer emits ntsc=TRUE for exactly {23.976, 29.97, 59.94}; deriveFps must
// reproduce those same literals from the timebase the writer rounded them to.
const NTSC_RATES = [23.976, 29.97, 59.94];
for (const rate of NTSC_RATES) {
  const timebase = Math.round(rate);            // writer does Math.round(fps)
  eq(`round-trip ${rate}: timebase ${timebase} + ntsc → ${rate}`, deriveFps(timebase, true), rate);
}

// --- non-NTSC (progressive / PAL) passes the integer timebase straight through ---
eq('24 progressive → 24', deriveFps(24, false), 24);
eq('25 PAL → 25', deriveFps(25, false), 25);
eq('30 true → 30', deriveFps(30, false), 30);
eq('50 PAL → 50', deriveFps(50, false), 50);
eq('60 true progressive → 60', deriveFps(60, false), 60);

// --- unknown/odd timebases pass through even when flagged ntsc (degrade safe) ---
eq('48 + ntsc → 48 (no canonical NTSC 48 in writer set)', deriveFps(48, true), 48);
eq('23 + ntsc → 23 passthrough', deriveFps(23, true), 23);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
