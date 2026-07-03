// Locks the direction-arrow screen geometry PinGlobe draws after a WRONG guess
// (pinglobe/src/arrow-geom.js, used by confirmGuess() in main.js).
//
// After a miss the game shows a small arrow next to the guess pin pointing toward
// the correct country (in SCREEN space via mapbox project()). Two things must hold
// or the hint silently lies to the player:
//   1. the SVG rotation (arrowAngleDeg) points the arrow AT the target, and
//   2. the marker offset (arrowOffsetPx) nudges the arrow TOWARD the target.
// The arrow SVG points UP at 0deg (north on screen) and screen y grows DOWNWARD,
// so the angle is clockwise-from-up: atan2(dx, -dy). This is the exact
// "point the right way around the globe" class the loop fixed once in the flight
// animation — locking it here keeps a future refactor from flipping a sign blind.
//
// run: node pinglobe/src/arrow-geom.test.mjs   (or: bun run test)

import { arrowAngleDeg, arrowOffsetPx } from './arrow-geom.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---------------- arrowAngleDeg: cardinal directions ----------------
ok('target due north (above) → 0deg',   near(arrowAngleDeg(0, -100), 0));
ok('target due east (right) → 90deg',   near(arrowAngleDeg(100, 0), 90));
ok('target due south (below) → ±180',   near(Math.abs(arrowAngleDeg(0, 100)), 180));
ok('target due west (left) → -90deg',   near(arrowAngleDeg(-100, 0), -90));
ok('north-east target → 45deg',         near(arrowAngleDeg(50, -50), 45));
ok('north-east stays in (0,90)',        (() => { const a = arrowAngleDeg(50, -50); return a > 0 && a < 90; })());

// ---------------- arrowOffsetPx: nudge toward the target ----------------
ok('north offset points up (y<0)',      (() => { const o = arrowOffsetPx(0, 30); return Math.abs(o.x) < 1e-9 && near(o.y, -30); })());
ok('east offset points right (x>0)',    (() => { const o = arrowOffsetPx(90, 30); return near(o.x, 30) && Math.abs(o.y) < 1e-9; })());
ok('offset magnitude == offsetDist',    [0, 37, 90, 133, 180, -44, -170]
    .every(deg => { const o = arrowOffsetPx(deg, 30); return near(Math.hypot(o.x, o.y), 30); }));

// ---------------- end-to-end: offset is parallel to & toward the delta ----------------
// For any screen delta, arrowOffsetPx(arrowAngleDeg(dx,dy)) must be a positive
// multiple of (dx,dy): dot>0 (toward target) and cross≈0 (parallel). Flipping the
// atan2 args or an offset sign breaks one of these — the load-bearing lock.
ok('offset points toward the target', [[10, -3], [-8, -8], [5, 12], [-20, 4], [1, 1], [-1, -1]]
    .every(([dx, dy]) => {
      const o = arrowOffsetPx(arrowAngleDeg(dx, dy), 30);
      const dot = o.x * dx + o.y * dy;      // >0  => same general direction
      const cross = o.x * dy - o.y * dx;    // ~0  => parallel
      return dot > 0 && Math.abs(cross) < 1e-9;
    }));

console.log(`\narrow-geom: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
