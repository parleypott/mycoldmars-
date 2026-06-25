// Mutation-proven lock on tileToCount — the pure tiling helper that replaced
// three `while (list.length < N) list = list.concat(pool)` infinite-loop
// landmines in zanyplans (grid-collage, floating-windows, main blinds mode).
//
// Hand-rolled assert style to match the repo runner (bun <file>, no node:test).
//
// The load-bearing guarantees:
//   1. An EMPTY/invalid pool returns [] and NEVER hangs (the whole point).
//   2. For a non-empty pool the output is byte-identical to the old inline
//      form: index i maps to pool[i % pool.length].

import { tileToCount } from './tile.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${g}\n  want: ${w}`); }
};

// The OLD inline form, reconstructed — but BOUNDED so the RED proof can show it
// never terminates on an empty pool WITHOUT actually hanging this test process.
// Returns null when it fails to terminate within the cap (i.e. the landmine).
function legacyTileBounded(pool, count, cap = 100000) {
  let items = [...pool];
  let iters = 0;
  while (items.length < count) {
    items = items.concat(pool);
    if (++iters > cap) return null; // never terminates — the bug
  }
  return items.slice(0, count);
}

// ── RED proof: the old while-concat form HANGS on an empty pool ──────────────
eq(legacyTileBounded([], 10), null, 'RED: legacy while-concat never terminates on empty pool (count 10)');
eq(legacyTileBounded([], 20), null, 'RED: legacy while-concat never terminates on empty pool (count 20)');

// ── The fix: empty pool returns [] immediately, no hang ──────────────────────
eq(tileToCount([], 10), [], 'empty pool -> [] (no infinite loop)');
eq(tileToCount([], 20), [], 'empty pool -> [] (no infinite loop)');

// ── Non-array / nullish pool degrades to [] (no throw, no hang) ──────────────
eq(tileToCount(null, 10), [], 'null pool -> []');
eq(tileToCount(undefined, 10), [], 'undefined pool -> []');
eq(tileToCount('nope', 10), [], 'string pool -> []');
eq(tileToCount({}, 10), [], 'object pool -> []');

// ── count <= 0 / invalid -> [] ───────────────────────────────────────────────
eq(tileToCount(['a', 'b'], 0), [], 'count 0 -> []');
eq(tileToCount(['a', 'b'], -3), [], 'negative count -> []');
eq(tileToCount(['a', 'b'], NaN), [], 'NaN count -> []');

// ── Trim, tile, single-element ───────────────────────────────────────────────
eq(tileToCount(['a', 'b', 'c', 'd', 'e'], 3), ['a', 'b', 'c'], 'pool longer than count is trimmed');
eq(tileToCount(['a', 'b', 'c'], 10), ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a'], 'short pool tiles cyclically (i % len)');
eq(tileToCount(['x'], 4), ['x', 'x', 'x', 'x'], 'single-element pool fills every slot');

// ── Byte-identical to the legacy form for every real cell count + pool size ──
for (const count of [10, 20]) { // 10 = blinds/collage, 20 = floating windows
  for (const len of [1, 2, 3, 5, 7, 9, 12, 25, 40]) {
    const pool = Array.from({ length: len }, (_, i) => `m${i}`);
    eq(tileToCount(pool, count), legacyTileBounded(pool, count), `byte-identical to legacy: pool len=${len}, count=${count}`);
  }
}

console.log(`\ntile: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
