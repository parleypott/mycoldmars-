// Locks the floating-PIP position parser against the truthy-zero trap.
//
// Bug: the save path was `parseFloat(styleVal) || fallback`, so a coordinate of
// exactly 0 (PIP dragged flush to the screen's left/bottom edge) persisted as
// the default instead of 0, and the window jumped inward on reload. The restore
// path already accepts 0, so only the save path was broken.
//
// Run: bun translation/src/edit/deck-position.test.mjs  (auto-discovered by `bun run test`)
import { parseDeckCoord } from './deck-position.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
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

if (fail) { console.error(`\ndeck-position: ${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`deck-position: ${pass}/${pass} passed`);
