// Locks the todo day-planner's two load-bearing, previously-ZERO-coverage pure cores:
//
//   computeLanes(blocks)  — the interval-graph lane layout that decides how
//     overlapping time blocks share horizontal space in a day column. It clusters
//     overlapping blocks (connected components), greedily assigns each a lane, and
//     reports lanes.length as `total` so every block in a cluster renders at the
//     same width (Google-Calendar style). A regression here silently mis-renders
//     Johnny's schedule — blocks overlapping on top of each other, or wrong widths.
//
//   minToTimeStr(absMin) — the 12-hour clock formatter behind every block's time
//     label ("6:00a–7:30a"). Classic am/pm + noon/midnight edge cases.
//
// This is a verifier-layer LOCK (no live bug found — both functions are correct):
// it EXTRACTS the real shipped functions from todo/index.html at runtime via
// brace-matching, so it can't drift from a hand-copied mirror, and is mutation-proven
// to go RED if the logic regresses. Same standard as the westchester-geo / walden-frame
// locks (extract-the-shipped-function from inline HTML).
//
// STRUCTURAL FINDING (logged, deliberately NOT changed — see BACKLOG): the merge pass
// in computeLanes (the `while (merged)` loop that fuses clusters sharing an overlap) is
// provably DEAD CODE. Because the blocks are sorted by startMin BEFORE clustering,
// pass-1 already yields connected components: a "bridge" block b that overlaps members
// of two SEPARATE clusters is impossible once sorted (if x and y are in separate,
// non-overlapping clusters with x before y, then x.endMin <= y.startMin; for b to
// overlap both, x.endMin > b.startMin >= y.startMin >= x.endMin — a contradiction). So
// the merge loop never fires on any input. It's harmless (never changes the result), so
// it's left in place — removing working logic from a live tool unattended isn't worth
// the risk. This lock pins the REACHABLE behavior (pass-1 clustering + lane assignment
// + total); the merge pass is intentionally not asserted because no input can reach it.
//
// run: node todo/planner-core.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

// ---- extract a `function NAME(...) { ... }` body by brace-matching ----
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Bind the REAL shipped functions out of the HTML. Both are self-contained — computeLanes
// uses only Map + Array methods, minToTimeStr only String/Math — so a bare sandbox runs
// the exact live code.
const { computeLanes, minToTimeStr } = (() => {
  const body = `
    ${extractFn(HTML, 'computeLanes')}
    ${extractFn(HTML, 'minToTimeStr')}
    return { computeLanes, minToTimeStr };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(body)();
})();

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } }

const blk = (id, startMin, endMin) => ({ id, startMin, endMin });
const lane = (m, id) => (m.get(id) ? m.get(id).lane : undefined);
const total = (m, id) => (m.get(id) ? m.get(id).total : undefined);

// ===================== inline RED proof: a lane assigner that ignores end-times piles =====================
// Reconstruct the lane loop with the classic regression (reuse a lane whenever the
// last block STARTED earlier, ignoring whether it has ENDED) and show two overlapping
// blocks wrongly collapse into the same lane — proving the lane invariant is real.
{
  const badLanes = (blocks) => {
    const map = new Map();
    const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
    const lanes = [];
    for (const b of sorted) {
      let placed = false;
      for (let li = 0; li < lanes.length; li++) {
        const last = lanes[li][lanes[li].length - 1];
        if (last.startMin <= b.startMin) { lanes[li].push(b); map.set(b.id, { lane: li }); placed = true; break; } // BUG: startMin not endMin
      }
      if (!placed) { lanes.push([b]); map.set(b.id, { lane: lanes.length - 1 }); }
    }
    return map;
  };
  const bad = badLanes([blk('a', 0, 60), blk('b', 30, 90)]);
  ok('RED proof: end-time-ignoring lane assigner overlaps a & b in lane 0',
     lane(bad, 'a') === 0 && lane(bad, 'b') === 0);
  // the real function must NOT do that:
  const good = computeLanes([blk('a', 0, 60), blk('b', 30, 90)]);
  ok('RED proof: shipped computeLanes separates a & b into distinct lanes',
     lane(good, 'a') !== lane(good, 'b'));
}

// ===================== empty / null inputs =====================
{
  ok('null -> empty map', computeLanes(null).size === 0);
  ok('[] -> empty map', computeLanes([]).size === 0);
}

// ===================== single block =====================
{
  const m = computeLanes([blk('a', 360, 420)]);
  ok('single block -> lane 0', lane(m, 'a') === 0);
  ok('single block -> total 1', total(m, 'a') === 1);
}

// ===================== two TOUCHING blocks do NOT overlap (strict < / >) =====================
{
  // a ends exactly when b starts -> separate clusters, each full width
  const m = computeLanes([blk('a', 0, 60), blk('b', 60, 120)]);
  ok('touching blocks: a lane 0', lane(m, 'a') === 0);
  ok('touching blocks: b lane 0 (reuses lane, no overlap)', lane(m, 'b') === 0);
  ok('touching blocks: a total 1', total(m, 'a') === 1);
  ok('touching blocks: b total 1', total(m, 'b') === 1);
}

// ===================== two OVERLAPPING blocks => 2 lanes, total 2 =====================
{
  const m = computeLanes([blk('a', 0, 60), blk('b', 30, 90)]);
  ok('overlap: a lane 0', lane(m, 'a') === 0);
  ok('overlap: b lane 1', lane(m, 'b') === 1);
  ok('overlap: a total 2', total(m, 'a') === 2);
  ok('overlap: b total 2', total(m, 'b') === 2);
}

// ===================== input order independence (sorts internally) =====================
{
  const m = computeLanes([blk('b', 30, 90), blk('a', 0, 60)]); // reversed input
  ok('unsorted input: a still lane 0', lane(m, 'a') === 0);
  ok('unsorted input: b still lane 1', lane(m, 'b') === 1);
}

// ===================== three mutually overlapping => 3 lanes, total 3 =====================
{
  const m = computeLanes([blk('a', 0, 90), blk('b', 10, 80), blk('c', 20, 70)]);
  ok('triple overlap: lanes 0,1,2 distinct',
     new Set([lane(m, 'a'), lane(m, 'b'), lane(m, 'c')]).size === 3);
  ok('triple overlap: total 3 for all',
     total(m, 'a') === 3 && total(m, 'b') === 3 && total(m, 'c') === 3);
}

// ===================== transitive chain (A-B, B-C overlap; A-C don't) reuses a lane =====================
{
  // A(0,40) B(30,70) C(60,100): connected component of 3, but only depth-2 anywhere.
  // Lanes: A->0, B->1, C reuses lane 0 (A ended at 40 <= 60). total = 2.
  const m = computeLanes([blk('A', 0, 40), blk('B', 30, 70), blk('C', 60, 100)]);
  ok('chain: A lane 0', lane(m, 'A') === 0);
  ok('chain: B lane 1', lane(m, 'B') === 1);
  ok('chain: C reuses lane 0', lane(m, 'C') === 0);
  ok('chain: all share total 2 (connected component, max depth 2)',
     total(m, 'A') === 2 && total(m, 'B') === 2 && total(m, 'C') === 2);
}

// ===================== two SEPARATE clusters keep independent totals =====================
{
  // a lone early block + a far-apart overlapping pair. Correct: the lone block is total 1,
  // the pair is total 2. (If clustering over-merged, the lone block would inherit total 2.)
  const m = computeLanes([blk('solo', 0, 30), blk('c', 200, 260), blk('d', 230, 290)]);
  ok('separate: solo block total 1', total(m, 'solo') === 1);
  ok('separate: solo block lane 0', lane(m, 'solo') === 0);
  ok('separate: pair total 2', total(m, 'c') === 2 && total(m, 'd') === 2);
  ok('separate: pair lanes 0 & 1', lane(m, 'c') === 0 && lane(m, 'd') === 1);
}

// ===================== minToTimeStr: 12-hour clock + am/pm + noon/midnight =====================
{
  ok('6:00am', minToTimeStr(360) === '6:00a');
  ok('6:15am', minToTimeStr(375) === '6:15a');
  ok('11:30am', minToTimeStr(690) === '11:30a');
  ok('noon -> 12:00p (not 12:00a)', minToTimeStr(720) === '12:00p');
  ok('1:00pm', minToTimeStr(780) === '1:00p');
  ok('11:00pm', minToTimeStr(1380) === '11:00p');
  ok('11:59pm', minToTimeStr(1439) === '11:59p');
  ok('midnight -> 12:00a (not 0:00a)', minToTimeStr(0) === '12:00a');
  ok('minutes zero-padded', minToTimeStr(365) === '6:05a');
}

console.log(`\nplanner-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
