// Locks the FCP7 NTSC frame-rate WRITER↔READER round-trip contract — the
// cross-file agreement that hunter/src/xml-writer.js and hunter/src/xml-parser.js
// both document in comments as load-bearing ("the two MUST agree") but that NO
// test actually enforced end to end.
//
// THE GAP THIS CLOSES:
//   xml-parser-fps.test.mjs locks the READER (deriveFps) alone, against a
//   HARDCODED list of NTSC rates. That cannot catch a WRITER-side regression:
//   if isNtscRate ever stopped flagging, say, 59.94, the writer would emit
//   <timebase>60</timebase><ntsc>FALSE</ntsc>; Premiere then reads a flat 60fps
//   and reintroduces the ~0.1%/hour drift the integer-timebase+ntsc convention
//   exists to prevent — yet deriveFps(60, true) still === 59.94, so the
//   reader-only test stays GREEN while the real exported sequence is broken.
//
//   The fix the codebase already shipped lives in TWO functions that must move
//   together: isNtscRate (writer: rate → ntsc flag) and deriveFps (reader:
//   timebase+flag → rate). This test imports BOTH real functions and drives the
//   actual pipeline — Math.round(fps) for the timebase, isNtscRate(fps) for the
//   flag, deriveFps(timebase, flag) for the readback — so a regression on either
//   side goes RED.
//
// It also locks the SECOND divergence the comments warn about: isNtscRate exists
// in hunter/src/xml-writer.js AND translation/src/export/premiere-xml.js, and
// both "write the same FCP7 format and must agree on the <ntsc> flag." This
// extracts both copies from source and asserts they're textually identical, so a
// one-sided edit can't silently split the two exporters.
//
// Run: bun hunter/src/ntsc-roundtrip-contract.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveFps } from './xml-parser.js';
import { isNtscRate } from './xml-writer.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const fails = [];
const eq = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; fails.push(`✗ ${label}\n    got:  ${got}\n    want: ${want}`); }
};
const ok = (label, cond) => eq(label, !!cond, true);

// ── The pipeline under test: what the writer stamps, the reader must reconstruct.
//    writer:  timebase = Math.round(fps);  ntsc = isNtscRate(fps)
//    reader:  rate     = deriveFps(timebase, ntsc)
const roundTrip = (fps) => deriveFps(Math.round(fps), isNtscRate(fps));

// ── Canonical rate table: every rate the Hunter actually exports/imports, with
//    the rate a clean write→read MUST reproduce. NTSC inputs collapse to their
//    fractional canonical; whole-number rates stay whole.
const CASES = [
  // NTSC family — the whole reason this convention exists.
  { in: 23.976, back: 23.976, ntsc: true },
  { in: 29.97,  back: 29.97,  ntsc: true },
  { in: 59.94,  back: 59.94,  ntsc: true },
  // ffprobe rational spellings (24000/1001 = 23.97602...) must still flag NTSC
  // and read back to the canonical literal — the tolerance is what buys this.
  { in: 24000 / 1001, back: 23.976, ntsc: true },
  { in: 30000 / 1001, back: 29.97,  ntsc: true },
  { in: 60000 / 1001, back: 59.94,  ntsc: true },
  // True integer rates — must NOT be flagged NTSC, must read back unchanged.
  { in: 24, back: 24, ntsc: false },
  { in: 25, back: 25, ntsc: false },  // PAL
  { in: 30, back: 30, ntsc: false },
  { in: 50, back: 50, ntsc: false },
  { in: 60, back: 60, ntsc: false },
];

for (const c of CASES) {
  eq(`writer flags ntsc=${c.ntsc} for ${c.in}`, isNtscRate(c.in), c.ntsc);
  eq(`round-trip ${c.in} → ${c.back}`, roundTrip(c.in), c.back);
}

// ── MUTATION PROOF (the gap a reader-only test cannot cover):
//    simulate a writer regression that drops 59.94 from the NTSC set. The reader
//    is untouched, so deriveFps(60, true) still === 59.94 — but the real pipeline
//    now stamps ntsc=FALSE for 59.94 footage, and the round-trip collapses to a
//    flat 60. This test (which drives the writer) catches it; the old one can't.
const brokenIsNtsc = (fps) =>
  (Math.abs(fps - 23.976) < 0.01) || (Math.abs(fps - 29.97) < 0.01); // 59.94 dropped
const brokenRoundTrip = (fps) => deriveFps(Math.round(fps), brokenIsNtsc(fps));
eq('RED proof: dropping 59.94 from writer collapses round-trip to 60', brokenRoundTrip(59.94), 60);
ok('RED proof: real pipeline differs from the broken one on 59.94',
   roundTrip(59.94) !== brokenRoundTrip(59.94));
// And confirm the reader-only check would have MISSED it (stays 59.94 regardless).
eq('RED proof: reader-only test is blind to the writer regression',
   deriveFps(60, true), 59.94);

// ── Cross-file divergence lock: the two isNtscRate copies must stay identical.
//    Extract each function body from source and compare normalized text.
function extractFnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const writerSrc = readFileSync(join(HERE, 'xml-writer.js'), 'utf8');
const interpSrc = readFileSync(
  join(HERE, '..', '..', 'translation', 'src', 'export', 'premiere-xml.js'), 'utf8'
);
const hunterBody = norm(extractFnBody(writerSrc, 'isNtscRate'));
const interpBody = norm(extractFnBody(interpSrc, 'isNtscRate'));
ok('hunter isNtscRate body is non-empty', hunterBody.length > 0);
eq('hunter ↔ interpreter isNtscRate bodies are textually identical', hunterBody, interpBody);

// ── Report ──
if (fail) {
  console.error(`\n${fail} failed:\n` + fails.join('\n'));
  console.error(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed, ${fail} failed`);
