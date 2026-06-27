// First coverage for falling-glyphs.js — the ambient falling-glyph effect in the
// Interpreter (translation) UI.
//
// LOAD-BEARING CONTRACT: findSupportRect resolves a resting glyph's support
// button by GEOMETRY, not by a stored array index. The old code stored
// `restingOn = <index into getButtonRects()>` and re-read `rects[index]` every
// frame. getButtonRects() is rebuilt each frame and can change length/order
// (panels toggle, toolbar reflows), so a stale index re-bound the glyph to a
// DIFFERENT button and teleported it onto that button's top. This test pins the
// geometry-based resolver so that regression can't return.
//
// Pure function, no DOM/canvas — runnable under bun/node directly.

import { findSupportRect } from './falling-glyphs.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const rect = (left, right, top) => ({ left, right, top, bottom: top + 40 });

// ── 1. Basic match: glyph over a button, at its top, finds it ──
{
  const rects = [rect(100, 200, 300)];
  const s = findSupportRect(rects, 150, 300);
  ok(s === rects[0], 'glyph centered over button at its top finds that button');
}

// ── 2. THE BUG: array reorders between frames. Geometry must win over index. ──
{
  // Frame A: glyph rests on the button that happens to be at index 0.
  const frameA = [rect(100, 200, 300), rect(400, 500, 600)];
  const support = findSupportRect(frameA, 150, 300);
  eq(support.left, 100, 'frame A: resting on the left button (x=150,top=300)');

  // Frame B: the SAME two buttons come back REORDERED (left button now index 1).
  // A stale-index resolver (rects[0]) would grab the far button at top=600 and
  // teleport the glyph 300px down. Geometry must still pick the left button.
  const frameB = [rect(400, 500, 600), rect(100, 200, 300)];
  const reSupport = findSupportRect(frameB, 150, 300);
  eq(reSupport.left, 100, 'frame B (reordered): still binds to the same physical button');
  eq(reSupport.top, 300, 'frame B: support top unchanged — no vertical teleport');
  // Prove the stale-index path WOULD have been wrong (mutation control).
  eq(frameB[0].top, 600, 'control: index 0 in frame B is the FAR button — what the bug grabbed');
}

// ── 3. Support gone → null (glyph detaches and falls) ──
{
  const rects = [rect(400, 500, 600)]; // the button it rested on is no longer present
  const s = findSupportRect(rects, 150, 300);
  ok(s === null, 'no rect under the glyph → null (detach and fall)');
}

// ── 4. Horizontal edge tolerance (xPad): just past the edge still rests, far past detaches ──
{
  const rects = [rect(100, 200, 300)];
  ok(findSupportRect(rects, 201.5, 300) !== null, 'within xPad past right edge → still resting');
  ok(findSupportRect(rects, 210, 300) === null, 'well past right edge → detaches');
  ok(findSupportRect(rects, 98.5, 300) !== null, 'within xPad past left edge → still resting');
}

// ── 5. Vertical band (yTol): a small top drift follows; a big jump detaches ──
{
  const rects = [rect(100, 200, 304)]; // button moved up 4px — within yTol
  ok(findSupportRect(rects, 150, 300) !== null, 'support drifted within yTol → still found (follows)');
  const jumped = [rect(100, 200, 320)]; // moved 20px — beyond yTol → different surface
  ok(findSupportRect(jumped, 150, 300) === null, 'support jumped beyond yTol → detaches, no teleport');
}

// ── 6. Defensive: non-array / empty / holey input never throws ──
{
  ok(findSupportRect(null, 150, 300) === null, 'null rects → null');
  ok(findSupportRect(undefined, 150, 300) === null, 'undefined rects → null');
  ok(findSupportRect([], 150, 300) === null, 'empty rects → null');
  ok(findSupportRect([null, rect(100, 200, 300)], 150, 300) !== null, 'skips holes, finds real rect');
}

// ── 7. First match wins when multiple stacked candidates qualify ──
{
  const a = rect(100, 300, 300);
  const b = rect(100, 300, 301);
  const s = findSupportRect([a, b], 150, 300);
  ok(s === a, 'first qualifying rect wins (stable pick)');
}

console.log(`falling-glyphs.findSupportRect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
