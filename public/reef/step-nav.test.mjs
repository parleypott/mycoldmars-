// Verifier-layer test for the reef player's FLICKER-LOOP NAVIGATOR — step().
//
// reef/index.html is a satellite coral-reef flicker loop with a pause-to-cull
// feature. Playback advances one frame per tick via `step(1)`, and culling a
// frame calls `step(1)` to move off the just-killed frame. step() is THE core
// advance: it walks `order` (the frame play-order) from the current cursor
// `pos`, skipping any frame whose `ready[i]` is false (a not-yet-preloaded OR a
// just-killed frame — killCurrent sets ready[curIdx]=false), and displays the
// first ready one. The load-bearing contracts, none of which were covered:
//
//   1. SKIP-NOT-READY — never displays a frame with ready[i] === false. That is
//      what keeps a black (unloaded) or a deleted frame from flashing on screen.
//   2. WRAP-AROUND — the cursor is modular; stepping past the end continues from
//      the start. The `+ order.length` term is what keeps dir=-1 from indexing a
//      negative position.
//   3. FINDS-THE-LAST-ONE — the loop runs EXACTLY order.length times, so if the
//      only ready frame is the current one, a full lap still lands on it (it is
//      visited last). A bound of order.length-1 would wrongly return -1 here.
//   4. NO-INFINITE-LOOP / RETURN -1 — if NOTHING is ready, step() terminates
//      after one lap and returns -1 without displaying anything (the flicker
//      loop simply holds, rather than spinning forever or showing garbage).
//   5. NAVIGATE-VIA-ORDER — the displayed value is order[pos], not pos itself, so
//      a non-identity play-order is honored.
//
// step() is EXTRACTED LIVE from index.html (regex + new Function) and run against
// injected order/ready/pos with a display spy, so this lock can't drift from a
// hand-copy. Mutation proofs at the bottom verify the test has teeth.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };

// --- extract the real step() verbatim ---
const stepSrc = html.match(/function step\(dir\) \{[\s\S]*?\n\}/);
assert.ok(stepSrc, 'could not find step() in reef/index.html');
// Sanity: the extracted slice is exactly the navigator, not an over-greedy grab.
ok(/for \(let n = 0; n < order\.length; n\+\+\)/.test(stepSrc[0]),
  'extracted step() contains the bounded lap loop');
ok(/pos = \(pos \+ dir \+ order\.length\) % order\.length/.test(stepSrc[0]),
  'extracted step() contains the wrap-around cursor math');

// Build a harness that runs the REAL step body over injected closure state.
// `pos` is a mutable let the extracted step() closes over and advances, exactly
// as it does at module scope; getPos() reads it back so we can assert the cursor.
function makeStep(order, ready, startPos, srcOverride) {
  const shown = [];
  const display = (i) => { shown.push(i); };
  const factory = new Function('order', 'ready', 'display', 'startPos', `
    let pos = startPos;
    ${srcOverride || stepSrc[0]}
    return { step, getPos: () => pos };
  `);
  const { step, getPos } = factory(order, ready, display, startPos);
  return { step, getPos, shown };
}

const allReady = (n) => Array(n).fill(true);
const ident = (n) => [...Array(n).keys()];

// --- 1. SKIP-NOT-READY: a not-ready frame between two ready ones is skipped ---
{
  const ready = [true, false, true, true];   // index 1 is not ready (killed/loading)
  const h = makeStep(ident(4), ready, 0);     // cursor at 0
  const got = h.step(1);
  eq(got, 2, 'step(1) from 0 skips not-ready index 1 and lands on 2');
  eq(h.shown.length, 1, 'exactly one frame displayed');
  eq(h.shown[0], 2, 'displayed the ready frame, never the not-ready one');
}

// consecutive not-ready run is skipped in one call
{
  const ready = [true, false, false, false, true];
  const h = makeStep(ident(5), ready, 0);
  eq(h.step(1), 4, 'step(1) skips a whole run of not-ready frames to the next ready one');
}

// --- 2. WRAP-AROUND forward and backward ---
{
  const h = makeStep(ident(3), allReady(3), 2);  // at the last frame
  eq(h.step(1), 0, 'step(1) from the last frame wraps to the first');
  eq(h.getPos(), 0, 'cursor wrapped to 0');
}
{
  const h = makeStep(ident(3), allReady(3), 0);  // at the first frame
  eq(h.step(-1), 2, 'step(-1) from the first frame wraps to the last (no negative index)');
  eq(h.getPos(), 2, 'cursor wrapped to 2, not to -1');
}

// --- 3. FINDS-THE-LAST-ONE: current frame is the ONLY ready one ---
{
  const ready = [false, false, true, false];   // only index 2 is ready
  const h = makeStep(ident(4), ready, 2);        // cursor already on the only ready frame
  const got = h.step(1);
  eq(got, 2, 'a full lap lands back on the sole ready frame (bound is order.length, not -1)');
  eq(h.shown[0], 2, 'the sole ready frame is displayed');
  eq(h.getPos(), 2, 'cursor returns to the sole ready frame after the lap');
}

// --- 4. NO-INFINITE-LOOP / RETURN -1: nothing is ready ---
{
  const h = makeStep(ident(4), [false, false, false, false], 0);
  const got = h.step(1);   // must terminate (test itself hanging = failure)
  eq(got, -1, 'step() returns -1 when no frame is ready');
  eq(h.shown.length, 0, 'nothing is displayed when no frame is ready');
}

// --- 5. NAVIGATE-VIA-ORDER: a non-identity play-order is honored ---
{
  // order maps play-position -> frame index. pos walks order, not raw indices.
  const order = [3, 1, 2, 0];                 // shuffled play order
  const ready = [true, true, true, true];      // (indexed by FRAME index)
  const h = makeStep(order, ready, 0);          // pos 0 -> frame order[0]=3
  eq(h.step(1), 1, 'step advances the cursor and displays order[pos] (pos 1 -> frame 1)');
  eq(h.step(1), 2, 'next step -> order[2] = frame 2');
}

// --- mutation proofs: the lock must FAIL if the navigator regresses ---
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}

// (a) drop the ready[i] check -> displays the not-ready frame immediately
mustThrow(() => {
  const bad = `function step(dir) {
    for (let n = 0; n < order.length; n++) {
      pos = (pos + dir + order.length) % order.length;
      const i = order[pos];
      { display(i); return i; }
    }
    return -1;
  }`;
  const h = makeStep(ident(4), [true, false, true, true], 0, bad);
  const got = h.step(1);
  assert.equal(got, 2, 'a check-less step must NOT still land on the ready frame 2');
}, 'removing the ready[i] guard displays the not-ready frame');

// (b) shrink the loop bound to order.length-1 -> sole-current-ready case misses
mustThrow(() => {
  const bad = `function step(dir) {
    for (let n = 0; n < order.length - 1; n++) {
      pos = (pos + dir + order.length) % order.length;
      const i = order[pos];
      if (ready[i]) { display(i); return i; }
    }
    return -1;
  }`;
  const h = makeStep(ident(4), [false, false, true, false], 2, bad);
  assert.equal(h.step(1), 2, 'a short-by-one lap must NOT still find the sole ready frame');
}, 'a loop bound of order.length-1 misses the sole ready (current) frame');

// (c) drop the + order.length wrap term -> dir=-1 indexes a negative position
mustThrow(() => {
  const bad = `function step(dir) {
    for (let n = 0; n < order.length; n++) {
      pos = (pos + dir) % order.length;
      const i = order[pos];
      if (ready[i]) { display(i); return i; }
    }
    return -1;
  }`;
  const h = makeStep(ident(3), allReady(3), 0, bad);
  const got = h.step(-1);           // pos becomes -1 % 3 = -1 -> order[-1] = undefined
  assert.equal(got, 2, 'without the +order.length term, step(-1) must NOT reach frame 2');
}, 'removing the +order.length wrap term breaks backward stepping');

console.log(`reef step-nav: ${passed} assertions passed`);
