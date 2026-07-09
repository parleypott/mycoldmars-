// TWIN-LOCK: extractCameraId lives in TWO module trees that cannot share an
// import (the client bundle in hunter/src/ runs in the browser via Vite; the
// worker in hunter/worker/ runs on Johnny's Mac against Supabase), so the parser
// is hand-copied across:
//   • hunter/src/scene-grouping.js          (client scene grouping, live)
//   • hunter/worker/scene-detection-core.js (worker scene detection, on the Mac)
//
// This function pulls the camera id out of a clip filename
// ("20241007-1332-C8757_Proxy.MP4" → the camera that shot it) so scene detection
// can group clips by camera. The two copies INTENTIONALLY DIVERGE IN RETURN TYPE:
//   • client returns a STRING  — 'C' + digits   ("C8757")
//   • worker returns a NUMBER  — parseInt(digits) (8757)
// Each is self-consistent inside its own context (the client only compares its
// own recomputed ids for the live UI; the worker only compares its own ids before
// persisting scene rows), so there is NO live crash today. But it is a real latent
// footgun, flagged in the backlog (Hunter extractCameraId type divergence): any
// future code that cross-references a WORKER-persisted camera id (a number) against
// a CLIENT-recomputed one (a string) — or merges them into one display — mismatches
// "C8757" vs 8757. Worse, the worker's parseInt DROPS the 'C' and any leading zero,
// so two genuinely distinct cameras "C8757" and "C08757" COLLIDE to 8757 in the
// worker while the client keeps them distinct.
//
// Harmonizing the type is an ATTENDED call (a change could break whichever consumer
// depends on the current form, and the worker path can't be driven headless to
// verify), so this file does NOT unify them — it PINS BOTH CURRENT CONTRACTS so the
// divergence can never silently drift further or be half-"fixed". It asserts:
//   1. SHARED MATCH LOGIC — both copies match the same C(\d+) at the same positions
//      and both return null on the same non-matches. Change the regex in one and
//      forget the other → RED (the derive-fps failure mode, commit e0f918e).
//   2. THE CLIENT STRING CONTRACT — 'C' + digits, leading zeros preserved.
//   3. THE WORKER NUMBER CONTRACT — a parsed number, leading zeros dropped.
//      Harmonize either copy to the other's type and the matching block goes RED,
//      forcing the attended decision instead of a silent, unverified swap.
//   4. THE COLLISION the type divergence causes — documented + locked so a future
//      reader sees exactly why it matters (worker collides C8757/C08757; client
//      does not).

import { extractCameraId as fromClient } from './scene-grouping.js';
import { extractCameraId as fromWorker } from '../worker/scene-detection-core.js';

let pass = 0, fail = 0;
const fails = [];
const check = (cond, msg) => { if (cond) pass++; else { fail++; fails.push('✗ ' + msg); } };

// (filename, digits captured by C(\d+) | null when no match)
const CASES = [
  ['20241007-1332-C8757_Proxy.MP4', '8757'],
  ['C8757',                          '8757'],
  ['C08757',                         '08757'], // leading zero — worker will drop it
  ['C007',                           '007'],   // all-but-one leading zeros
  ['xC12y',                          '12'],    // pattern mid-string
  ['C0',                             '0'],
  ['nope',                           null],
  ['ABCD1234',                       null],    // no 'C' immediately before digits
  [' ',                              null],
  ['',                               null],
  [null,                             null],
  [undefined,                        null],
];

for (const [name, digits] of CASES) {
  let cr, wr;
  try { cr = fromClient(name); } catch (e) { cr = 'THREW:' + (e && e.name); }
  try { wr = fromWorker(name); } catch (e) { wr = 'THREW:' + (e && e.name); }

  if (digits === null) {
    // 1. SHARED MATCH LOGIC — both null on the same non-matches.
    check(cr === null, `client should return null on ${JSON.stringify(name)}, got ${JSON.stringify(cr)}`);
    check(wr === null, `worker should return null on ${JSON.stringify(name)}, got ${JSON.stringify(wr)}`);
    continue;
  }

  // 2. CLIENT STRING CONTRACT — 'C' + digits, verbatim (leading zeros preserved).
  check(cr === 'C' + digits,
    `client string contract broke on ${JSON.stringify(name)}: expected ${JSON.stringify('C' + digits)}, got ${JSON.stringify(cr)}`);
  check(typeof cr === 'string',
    `client must return a STRING on ${JSON.stringify(name)}, got ${typeof cr}`);

  // 3. WORKER NUMBER CONTRACT — parseInt(digits) (leading zeros dropped).
  check(wr === parseInt(digits, 10),
    `worker number contract broke on ${JSON.stringify(name)}: expected ${parseInt(digits, 10)}, got ${JSON.stringify(wr)}`);
  check(typeof wr === 'number',
    `worker must return a NUMBER on ${JSON.stringify(name)}, got ${typeof wr}`);

  // The divergence itself: on any real filename the two copies must NOT be equal
  // (string vs number). If they ever become === here, someone harmonized one copy
  // without the attended sign-off — go RED so it's a decision, not a silent drift.
  check(cr !== wr,
    `client and worker unexpectedly AGREE on ${JSON.stringify(name)} (${JSON.stringify(cr)} === ${JSON.stringify(wr)}) — ` +
    `if you meant to unify the camera-id type, do it deliberately across BOTH copies + their consumers and update this lock`);
}

// 4. THE COLLISION the type divergence causes — locked as documentation.
// C8757 and C08757 are distinct cameras; the worker's parseInt merges them.
check(fromWorker('C8757') === fromWorker('C08757'),
  'worker parseInt should COLLIDE C8757/C08757 to the same number (documenting the divergence hazard)');
check(fromClient('C8757') !== fromClient('C08757'),
  'client string form should keep C8757/C08757 DISTINCT (documenting the divergence hazard)');

// Guard the lock from silently degrading to "both copies happen to be absent".
if (typeof fromClient === 'function' && typeof fromWorker === 'function') pass++;
else { fail++; fails.push('✗ one or more extractCameraId copies failed to import'); }

if (fail) {
  console.error(`\ncamera-id-twin-lock: ${pass} passed, ${fail} FAILED\n`);
  console.error(fails.join('\n') + '\n');
  process.exit(1);
}
console.log(`camera-id-twin-lock: ${pass} passed — both extractCameraId copies pinned to their (divergent) contracts`);
