// Verifier-layer test for the Burma Essays PWA service worker's RANGE server.
//
// Burma Essays is an offline-first audio PWA (Johnny downloads essays to the
// device and plays them with no connection). The SW rebuilds HTTP Range
// (206 Partial Content) responses from the fully-cached audio blob so the
// browser can seek/scrub while offline. That byte-range math is load-bearing:
// get it wrong and the wrong audio bytes are served for a seek.
//
// The three range forms a browser actually sends when seeking audio:
//   bytes=500-999   → that inclusive window
//   bytes=500-      → from 500 to the end (the common forward-seek case)
//   bytes=-500      → the LAST 500 bytes (a SUFFIX range)
// The suffix form used to be mishandled: an empty start group was read as 0,
// so "give me the last 500 bytes" returned the FIRST 501 — feeding the wrong
// bytes to any client that reads the tail (e.g. ID3v1 metadata at end-of-file).
//
// This EXTRACTS the real shipped computeByteRange from sw.js at runtime
// (slice + new Function) so it can't drift from what deploys. Mutation-proven:
// reverting the suffix branch to the old empty-start-is-0 behavior turns the
// suffix assertions RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

function loadFn(source) {
  const start = source.indexOf('function computeByteRange');
  assert.notEqual(start, -1, 'could not find computeByteRange in sw.js');
  const anchor = source.indexOf('\n}', start);
  assert.notEqual(anchor, -1, 'could not find end of computeByteRange in sw.js');
  const block = source.slice(start, anchor + 2);
  return new Function(`${block}\nreturn computeByteRange;`)();
}

const computeByteRange = loadFn(src);
const SIZE = 1000;
const r = (range, size = SIZE) => computeByteRange(range, size);

let pass = 0;
const eq = (got, exp, msg) => { assert.deepEqual(got, exp, msg); pass++; };

// --- no / unparseable range → whole file ---
eq(r(null), { start: 0, end: 999 }, 'null range → whole file');
eq(r(''), { start: 0, end: 999 }, 'empty range → whole file');
eq(r('bytes=abc'), { start: 0, end: 999 }, 'garbage range → whole file');
eq(r('bytes=zzz'), { start: 0, end: 999 }, 'no dash → whole file');
eq(r('bytes=-'), { start: 0, end: 999 }, 'empty both sides → whole file');

// --- normal closed window (forward path — must be byte-identical to old logic) ---
eq(r('bytes=0-99'), { start: 0, end: 99 }, 'leading window');
eq(r('bytes=500-999'), { start: 500, end: 999 }, 'explicit window');
eq(r('bytes=500-600'), { start: 500, end: 600 }, 'mid window');
eq(r('bytes=0-0'), { start: 0, end: 0 }, 'single first byte');

// --- open-ended forward (the common audio-seek case) ---
eq(r('bytes=0-'), { start: 0, end: 999 }, 'from 0 to end');
eq(r('bytes=500-'), { start: 500, end: 999 }, 'from 500 to end');
eq(r('bytes=999-'), { start: 999, end: 999 }, 'from last byte to end');

// --- SUFFIX range: the LAST N bytes (the bug this fix closes) ---
eq(r('bytes=-500'), { start: 500, end: 999 }, 'suffix: last 500 bytes');
eq(r('bytes=-1'), { start: 999, end: 999 }, 'suffix: last single byte');
eq(r('bytes=-1000'), { start: 0, end: 999 }, 'suffix: last == whole file');
eq(r('bytes=-2000'), { start: 0, end: 999 }, 'suffix larger than file → whole file');

// The load-bearing proof: a suffix request must NOT return the file HEAD.
// (The old code returned { start: 0, end: 500 } for "bytes=-500".)
const suffix = r('bytes=-500');
assert.notEqual(suffix.start, 0, 'suffix range must not start at the file head');
assert.equal(suffix.end, 999, 'suffix range must end at the last byte');
pass += 2;

// --- clamping / degenerate ---
eq(r('bytes=5000-'), { start: 0, end: 999 }, 'start past EOF → clamped whole file');
eq(r('bytes=0-99999'), { start: 0, end: 999 }, 'end past EOF → clamped to last byte');

// --- small file (metadata-tail read, the realistic suffix trigger) ---
eq(computeByteRange('bytes=-128', 4096), { start: 3968, end: 4095 }, 'last 128 bytes of a 4KB file (ID3v1 tail)');

console.log(`sw-range: ${pass} passed, 0 failed`);
