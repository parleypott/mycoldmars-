// Locks the floating-PIP position parser against the truthy-zero trap.
//
// Bug: the save path was `parseFloat(styleVal) || fallback`, so a coordinate of
// exactly 0 (PIP dragged flush to the screen's left/bottom edge) persisted as
// the default instead of 0, and the window jumped inward on reload. The restore
// path already accepts 0, so only the save path was broken.
//
// Run: bun translation/src/edit/deck-position.test.mjs  (auto-discovered by `bun run test`)
import { parseDeckCoord, clampDeckPosition } from './deck-position.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const eqPos = (got, want, msg) => {
  if (got && got.left === want.left && got.bottom === want.bottom) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// ── Inline RED proof: the OLD `parseFloat || fallback` form drops a real 0 ──
const oldParse = (v, fb) => parseFloat(v) || fb;
eq(oldParse('0px', 16), 16, 'RED-proof: old form turns left:0 into the 16 default');
eq(oldParse('0px', 86), 86, 'RED-proof: old form turns bottom:0 into the 86 default');
// …while the fixed parser preserves it:
eq(parseDeckCoord('0px', 16), 0, 'THE FIX: left:0 round-trips as 0, not 16');
eq(parseDeckCoord('0px', 86), 0, 'THE FIX: bottom:0 round-trips as 0, not 86');

// ── The edge cases the PIP can actually reach (clamped to >= 0 on drag) ──
eq(parseDeckCoord('0', 16), 0, 'bare "0" → 0');
eq(parseDeckCoord('0.0px', 16), 0, '"0.0px" → 0');

// ── Real fallback cases: an UNSET / non-numeric style should use the default ──
eq(parseDeckCoord('', 16), 16, 'empty style → fallback (never set)');
eq(parseDeckCoord('auto', 16), 16, '"auto" → fallback (the CSS the deck uses for right)');
eq(parseDeckCoord(undefined, 16), 16, 'undefined → fallback');
eq(parseDeckCoord(null, 86), 86, 'null → fallback');
eq(parseDeckCoord('not-a-number', 86), 86, 'garbage → fallback');
eq(parseDeckCoord('NaNpx', 16), 16, '"NaNpx" → fallback');

// ── Normal non-zero positions pass through, ignoring the px suffix ──
eq(parseDeckCoord('16px', 16), 16, '"16px" → 16');
eq(parseDeckCoord('240px', 16), 240, '"240px" → 240');
eq(parseDeckCoord('86px', 86), 86, '"86px" → 86');
eq(parseDeckCoord('123.5px', 16), 123.5, 'fractional px preserved');
eq(parseDeckCoord('1024px', 16), 1024, 'large value preserved');

// ── A negative value (shouldn't normally occur, but must NOT fall back) ──
eq(parseDeckCoord('-5px', 16), -5, 'negative finite value preserved (not fallback)');

// ════════════════════════════════════════════════════════════════════════
// clampDeckPosition — restore-on-mount must keep the PIP on the CURRENT screen
//
// Bug: the restore path applied the SAVED {left,bottom} raw. A position saved on
// a wide desk monitor (left:1800) reloads off-screen on a laptop (innerWidth:1280),
// stranding the PIP out of reach. The live drag handler clamps; restore did not.
// ════════════════════════════════════════════════════════════════════════
const VIEWPORT = { width: 1280, height: 800 };
const FRAME = { width: 360, height: 200 }; // maxLeft = 920, maxBottom = 600

// ── Inline RED proof: the OLD raw-apply form leaves the PIP off-screen ──
const oldRestore = (saved) => ({ left: saved.left, bottom: saved.bottom });
eqPos(oldRestore({ left: 1800, bottom: 80 }), { left: 1800, bottom: 80 },
  'RED-proof: old form keeps left:1800 (off the right edge of a 1280 viewport)');
eqPos(oldRestore({ left: 100, bottom: 1000 }), { left: 100, bottom: 1000 },
  'RED-proof: old form keeps bottom:1000 (above the top of an 800 viewport)');

// ── THE FIX: an off-screen saved position is pulled back to the far edge ──
eqPos(clampDeckPosition({ left: 1800, bottom: 80 }, VIEWPORT, FRAME), { left: 920, bottom: 80 },
  'too-far-right left clamps to viewport.width - frame.width (920)');
eqPos(clampDeckPosition({ left: 100, bottom: 1000 }, VIEWPORT, FRAME), { left: 100, bottom: 600 },
  'too-high bottom clamps to viewport.height - frame.height (600)');
eqPos(clampDeckPosition({ left: 5000, bottom: 5000 }, VIEWPORT, FRAME), { left: 920, bottom: 600 },
  'both axes way off → both clamp to their far edge');

// ── A position already on-screen passes through untouched ──
eqPos(clampDeckPosition({ left: 100, bottom: 80 }, VIEWPORT, FRAME), { left: 100, bottom: 80 },
  'in-viewport position is preserved exactly');
eqPos(clampDeckPosition({ left: 920, bottom: 600 }, VIEWPORT, FRAME), { left: 920, bottom: 600 },
  'exactly at the far edge stays put (boundary)');
eqPos(clampDeckPosition({ left: 0, bottom: 0 }, VIEWPORT, FRAME), { left: 0, bottom: 0 },
  'flush to the near edge (0/0) round-trips — the earlier truthy-zero fix is preserved');

// ── Near-edge floor: a stale/negative coordinate is pulled to 0, never beyond ──
eqPos(clampDeckPosition({ left: -50, bottom: -10 }, VIEWPORT, FRAME), { left: 0, bottom: 0 },
  'negative coords floor at 0 (the near edge)');

// ── No-regression: when the frame is not yet measured (size 0), DON'T clamp the
//    far edge — a previously on-screen position must not get yanked to 0. ──
eqPos(clampDeckPosition({ left: 1800, bottom: 80 }, VIEWPORT, { width: 0, height: 0 }),
  { left: 1800, bottom: 80 },
  'unmeasured frame → far edge free (saved value preserved, floored only)');
eqPos(clampDeckPosition({ left: 1800, bottom: 80 }, { width: 0, height: 0 }, FRAME),
  { left: 1800, bottom: 80 },
  'unmeasured viewport → far edge free (saved value preserved)');

// ── Garbage saved values degrade to the near edge, never NaN ──
eqPos(clampDeckPosition({ left: NaN, bottom: undefined }, VIEWPORT, FRAME), { left: 0, bottom: 0 },
  'non-finite saved coords → 0, not NaN');
eqPos(clampDeckPosition(null, VIEWPORT, FRAME), { left: 0, bottom: 0 },
  'null saved → 0/0 (no crash)');

if (fail) { console.error(`\ndeck-position: ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`deck-position: ${pass}/${pass} passed`);
