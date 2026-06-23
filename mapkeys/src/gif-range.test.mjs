// Locks the GIF-export range selector math (gif-range.js). Imports the REAL shipped
// functions. The headline case: selecting the FIRST keyframe as the "to" endpoint must
// resolve to index 0, not silently jump to the last keyframe (the truthy-zero trap the
// old `parseInt(toSel.value,10) || (n-1)` had).

import { resolveFrameIndex, computeGifRange } from './gif-range.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  expected ${B}\n  got      ${A}`); }
};

// ── Inline RED proof: reconstruct the OLD inline "to" resolution and show it breaks ──
function oldToIdx(rawValue, n) {
  return Math.min(n - 1, Math.max(0, parseInt(rawValue, 10) || (n - 1)));
}
// Old code: selecting "0" (first keyframe) as the "to" endpoint → n-1 (the LAST). Bug.
eq(oldToIdx('0', 5), 4, 'RED: old toIdx maps "0" → 4 (last), the bug');
// Fixed resolver: "0" → 0 (correct).
eq(resolveFrameIndex('0', 5, 4), 0, 'fix: resolveFrameIndex("0", n, fallback) → 0, not the fallback');

// ── resolveFrameIndex units ──
eq(resolveFrameIndex('0', 5, 4), 0, 'legit "0" → 0');
eq(resolveFrameIndex('2', 5, 4), 2, 'mid value preserved');
eq(resolveFrameIndex('4', 5, 4), 4, 'last value preserved');
eq(resolveFrameIndex('', 5, 4), 4, 'empty → fallback (last)');
eq(resolveFrameIndex('', 5, 0), 0, 'empty → fallback (first)');
eq(resolveFrameIndex('abc', 5, 3), 3, 'unparseable → fallback');
eq(resolveFrameIndex(null, 5, 2), 2, 'null → fallback');
eq(resolveFrameIndex('9', 5, 0), 4, 'over-range clamped to n-1');
eq(resolveFrameIndex('-3', 5, 4), 0, 'negative clamped to 0');
eq(resolveFrameIndex('0', 1, 0), 0, 'single keyframe → 0');

// ── computeGifRange: the headline fix end-to-end ──
const D = [1, 2, 3, 4]; // 4 keyframes, n=4
// to = K01 (value "0"): the user wants the range to END at the first keyframe.
// OLD behavior: toIdx → n-1=3 → whole animation. FIXED: toIdx → 0.
eq(computeGifRange('0', '0', D), { tStart: 0, tEnd: 0, fromIdx: 0, toIdx: 0 },
  'from K01 to K01 → zero-length window at index 0 (was the whole animation)');
eq(computeGifRange('2', '0', D), { tStart: 0, tEnd: 3, fromIdx: 0, toIdx: 2 },
  'from K03 to K01 → sorted window [0,2], not the later half');

// ── computeGifRange: normal ranges (no-regression) ──
eq(computeGifRange('0', '3', D), { tStart: 0, tEnd: 6, fromIdx: 0, toIdx: 3 }, 'full range [0,3]');
eq(computeGifRange('1', '2', D), { tStart: 1, tEnd: 3, fromIdx: 1, toIdx: 2 }, 'mid range [1,2]');
eq(computeGifRange('3', '1', D), { tStart: 1, tEnd: 6, fromIdx: 1, toIdx: 3 }, 'reversed selection sorted');
eq(computeGifRange('', '', D), { tStart: 0, tEnd: 6, fromIdx: 0, toIdx: 3 }, 'empty both → first..last default');
eq(computeGifRange('', '2', D), { tStart: 0, tEnd: 3, fromIdx: 0, toIdx: 2 }, 'empty from → 0');
eq(computeGifRange('2', '', D), { tStart: 3, tEnd: 6, fromIdx: 2, toIdx: 3 }, 'empty to → last');
eq(computeGifRange('0', '0', []), { tStart: 0, tEnd: 0, fromIdx: 0, toIdx: 0 }, 'no keyframes → zero window');
eq(computeGifRange('0', '0', [5]), { tStart: 0, tEnd: 0, fromIdx: 0, toIdx: 0 }, 'single keyframe → [0,0]');

// ── No-regression: the FROM resolution is byte-identical to the old `|| 0` form ──
// (from fallback is 0, so the old form was never buggy; prove the new resolver matches it.)
function oldFromIdx(rawValue, n) {
  return Math.min(n - 1, Math.max(0, parseInt(rawValue, 10) || 0));
}
for (const v of ['', '0', '1', '2', '3', 'abc', null, '9', '-1']) {
  eq(resolveFrameIndex(v, 4, 0), oldFromIdx(v, 4), `from resolver === old "||0" form for value ${JSON.stringify(v)}`);
}

console.log(`gif-range: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
