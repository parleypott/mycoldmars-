// Verifier-layer test for the ASCENT page's SHIPPED LANDMARK DATA + shape wiring
// (public/ascent/src/landmarks.js). Sibling to hike-data-contract.test.mjs — that one locks the
// GPX hike geodata; this one locks the LANDMARK LADDERS and the shape↔ASPECT↔drawLandmark wiring,
// a separate surface no other test touches (app.js is an IIFE with no exported cores).
//
// WHY: window.LANDMARKS is the "how tall is our climb vs the Eiffel Tower" ladder that renders on
// the poster. The renderer (public/ascent/src/app.js) trusts it blindly and does REAL AXIS MATH on it:
//   • `Math.max(...window.LANDMARKS.map(l => l.h))`  → highestLandmark → VIEW.height.yMax (line ~129/139)
//   • `window.LANDMARKS.filter(l => l.h > TOTAL_GAIN)` → numGoals → whether the goals zone exists (~130)
//   • each landmark drawn via `window.drawLandmark(ctx, l.shape, …, pxH…)`, sized by
//     `window.landmarkAspect(l.shape)` (falls back to 0.4 for an UNKNOWN shape)
// So a single bad ladder entry is not cosmetic:
//   - a NaN / missing `h` → `Math.max(…NaN…)` = NaN → yMax = NaN → the ENTIRE height axis collapses
//     (every sy() maps to NaN, the poster paints nothing).
//   - a typo'd `shape` ("efiel") → no ASPECT entry (aspect silently 0.4) AND no drawLandmark switch
//     case → the pictogram renders as a FEATURELESS DEFAULT BOX instead of its silhouette. Invisible
//     in a code review of the data line; obvious only when you look at the live poster.
//   - a ladder entry out of ascending order → the visual "ladder" (short→tall) breaks.
// The distance ladder (window.DIST_LANDMARKS, drawn on the mileage view) has the same exposure on `d`.
//
// This is a data-contract regression gate (same category as the hikes lock, the Lauterbrunnen
// trip-data lock, the quiz-bank and bounce-level locks): pure validators check the invariants the
// renderer actually depends on, run against BOTH the LIVE shipped data (must be clean) AND crafted
// bad fixtures (each must be caught). The shape-wiring check DRIVES the real window.drawLandmark
// through a recording mock ctx and asserts each shipped shape hits a real pictogram path (beginPath/
// rect/arc), not the fall-through default box — so it can't drift from a hand-mirrored case list.
//
// It loads landmarks.js in a vm sandbox with a stub `window`, so the contract tracks the REAL
// shipped globals and can't drift from a copy.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

// --- load the shipped module: it assigns window.LANDMARKS / window.DIST_LANDMARKS /
//     window.landmarkAspect / window.drawLandmark and closes over a module-scope ASPECT map. ---
const src = readFileSync(new URL('./src/landmarks.js', import.meta.url), 'utf8');
const sandbox = { window: {}, Math };
// expose the module-scope ASPECT map so we can check KEY MEMBERSHIP directly — landmarkAspect()
// returns `ASPECT[shape] || 0.4`, so a legit explicit 0.4 (e.g. "empire") is indistinguishable
// from a missing entry by return value alone. Introspecting the real map's own keys is exact.
vm.runInNewContext(src + '\n;window.__ASPECT = ASPECT;', sandbox, { filename: 'landmarks.js' });
const { LANDMARKS, DIST_LANDMARKS, landmarkAspect, drawLandmark, __ASPECT: ASPECT } = sandbox.window;
assert.ok(ASPECT && typeof ASPECT === 'object', 'ASPECT map must be introspectable');

assert.ok(typeof landmarkAspect === 'function', 'window.landmarkAspect must be a function');
assert.ok(typeof drawLandmark === 'function', 'window.drawLandmark must be a function');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// A recording canvas 2D context: enough of the API for drawLandmark, and it tracks whether ANY real
// path primitive was used. drawLandmark's fall-through default draws ONLY a fillRect (no beginPath/
// rect/arc), while every real shape case uses at least one of beginPath/rect/arc — so `usedPath`
// distinguishes "rendered a pictogram" from "fell through to the default box".
function recordingCtx() {
  const c = {
    usedPath: false, ops: 0,
    save() {}, restore() {},
    beginPath() { this.usedPath = true; this.ops++; },
    rect() { this.usedPath = true; this.ops++; },
    arc() { this.usedPath = true; this.ops++; },
    moveTo() { this.ops++; }, lineTo() { this.ops++; }, closePath() {},
    quadraticCurveTo() { this.ops++; }, fill() { this.ops++; }, stroke() { this.ops++; },
    fillRect() { this.ops++; },
  };
  // absorb any property writes (fillStyle/strokeStyle/lineWidth/lineJoin/lineCap/globalAlpha)
  return c;
}

// Does the REAL drawLandmark render an actual pictogram for this shape (vs the featureless default)?
function rendersPictogram(shape) {
  const ctx = recordingCtx();
  drawLandmark(ctx, shape, 100, 200, 120, '#000', 400); // cx, baseY, pxH, color, maxW
  return ctx.usedPath && ctx.ops > 0;
}

// ---- validator for a height/dist ladder (returns [] === valid) ----
// `key` is 'h' (climb ladder) or 'd' (distance ladder); `checkShape` only for the height ladder.
function validateLadder(list, key, { checkShape } = {}) {
  const problems = [];
  if (!Array.isArray(list)) return [`${key}-ladder is not an array`];
  if (list.length === 0) problems.push(`${key}-ladder is empty`);
  let prev = -Infinity;
  list.forEach((l, i) => {
    const tag = `${key}-ladder[${i}] ${l && l.name ? `"${l.name}"` : ''}`.trim();
    if (!l || typeof l !== 'object') { problems.push(`${tag}: not an object`); return; }
    if (typeof l.name !== 'string' || l.name.trim() === '') problems.push(`${tag}: name missing/blank`);
    // the load-bearing number: feeds Math.max(...map) → yMax. NaN/missing here nukes the whole axis.
    if (!isNum(l[key]) || l[key] <= 0) problems.push(`${tag}: ${key} not a finite >0 number (${l[key]})`);
    // ladder must ascend (short → tall / near → far) — the visual metaphor depends on it
    else if (l[key] <= prev) problems.push(`${tag}: ${key}=${l[key]} not > previous ${prev} (ladder out of order)`);
    if (isNum(l[key])) prev = l[key];
    if (checkShape) {
      if (typeof l.shape !== 'string' || l.shape.trim() === '') problems.push(`${tag}: shape missing/blank`);
      else {
        // shape must have an explicit ASPECT entry (else aspect silently = the 0.4 fallback → wrong
        // silhouette proportions) AND a real drawLandmark case (else the default featureless box).
        // Check ASPECT by KEY MEMBERSHIP (an explicit 0.4 like "empire" is legit; a MISSING key isn't).
        if (!Object.prototype.hasOwnProperty.call(ASPECT, l.shape)) {
          problems.push(`${tag}: shape "${l.shape}" missing an ASPECT entry (renders at fallback aspect)`);
        } else if (!isNum(ASPECT[l.shape]) || ASPECT[l.shape] <= 0) {
          problems.push(`${tag}: shape "${l.shape}" has a non-finite/<=0 ASPECT (${ASPECT[l.shape]})`);
        }
        if (!rendersPictogram(l.shape)) problems.push(`${tag}: shape "${l.shape}" hits drawLandmark's default box (no pictogram case)`);
      }
    }
  });
  return problems;
}

// ============ THE LIVE CONTRACT: shipped ladders must be clean ============
const liveH = validateLadder(LANDMARKS, 'h', { checkShape: true });
assert.deepEqual(liveH, [], `shipped window.LANDMARKS violates the height-ladder contract:\n  ${liveH.join('\n  ')}`);
const liveD = validateLadder(DIST_LANDMARKS, 'd');
assert.deepEqual(liveD, [], `shipped window.DIST_LANDMARKS violates the distance-ladder contract:\n  ${liveD.join('\n  ')}`);

// sanity: we actually loaded real ladders, not empty structures that pass vacuously
assert.ok(LANDMARKS.length >= 6, `expected a real height ladder, got ${LANDMARKS.length}`);
assert.ok(DIST_LANDMARKS.length >= 4, `expected a real distance ladder, got ${DIST_LANDMARKS.length}`);
// and that Math.max over the ladder — the exact axis read in app.js — is a real finite number
assert.ok(Number.isFinite(Math.max(...LANDMARKS.map((l) => l.h))), 'Math.max over LANDMARKS.h must be finite (this IS the yMax axis read)');

// ============ MUTATION PROOF: each invariant must actually bite ============
const goodH = () => [
  { name: 'Statue of Liberty', h: 93, shape: 'liberty' },
  { name: 'Eiffel Tower', h: 330, shape: 'eiffel' },
  { name: 'Burj Khalifa', h: 828, shape: 'burj' },
];
assert.deepEqual(validateLadder(goodH(), 'h', { checkShape: true }), [], 'a well-formed height ladder is accepted');

// NaN height — the axis-nuking case (Math.max(...NaN) === NaN → yMax NaN → blank poster)
{ const L = goodH(); L[1].h = NaN;
  assert.ok(validateLadder(L, 'h', { checkShape: true }).some(p => /h not a finite/.test(p)), 'a NaN height is caught'); }

// missing height
{ const L = goodH(); delete L[1].h;
  assert.ok(validateLadder(L, 'h', { checkShape: true }).some(p => /h not a finite/.test(p)), 'a missing height is caught'); }

// ladder out of ascending order
{ const L = goodH(); L[2].h = 100; // 93, 330, 100 → descends
  assert.ok(validateLadder(L, 'h', { checkShape: true }).some(p => /out of order/.test(p)), 'an out-of-order ladder is caught'); }

// typo'd shape → no ASPECT entry AND no drawLandmark case (the featureless-box case)
{ const L = goodH(); L[1].shape = 'efiel';
  const probs = validateLadder(L, 'h', { checkShape: true });
  assert.ok(probs.some(p => /missing an ASPECT entry/.test(p)), 'an unknown shape (missing ASPECT) is caught');
  assert.ok(probs.some(p => /default box/.test(p)), 'an unknown shape (drawLandmark default) is caught'); }

// blank name
{ const L = goodH(); L[0].name = '   ';
  assert.ok(validateLadder(L, 'h', { checkShape: true }).some(p => /name missing/.test(p)), 'a blank landmark name is caught'); }

// distance ladder: zero / negative distance
{ const D = [{ name: 'Track lap', d: 400 }, { name: 'bad', d: 0 }];
  assert.ok(validateLadder(D, 'd').some(p => /d not a finite/.test(p)), 'a zero distance is caught'); }

// distance ladder out of order
{ const D = [{ name: '5K', d: 5000 }, { name: '1mi', d: 1609 }];
  assert.ok(validateLadder(D, 'd').some(p => /out of order/.test(p)), 'an out-of-order distance ladder is caught'); }

// empty ladder
assert.ok(validateLadder([], 'h').some(p => /empty/.test(p)), 'an empty ladder is caught');

// the recording-ctx default-detector must actually work: every shipped shape renders a pictogram,
// a bogus one hits the default box
assert.ok(LANDMARKS.every((l) => rendersPictogram(l.shape)), 'every shipped shape renders a real pictogram');
assert.ok(!rendersPictogram('definitely-not-a-shape'), 'a bogus shape falls through to the default box');

const shapes = [...new Set(LANDMARKS.map((l) => l.shape))];
console.log(`ok — ASCENT landmark-data contract: ${LANDMARKS.length} height landmarks (${shapes.length} shapes, all wired), ${DIST_LANDMARKS.length} distance landmarks, both ladders ascending, Math.max axis read finite`);
