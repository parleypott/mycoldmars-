// Human Element production-plan calendar (public/humanelement-cal/) — EIGHTH coverage.
//
// Completes the stub-episode resilience story that pickNextCut (SEVENTH coverage)
// started. Iteration #13 killed the CRASH an episode-with-no-pubCut caused, but two
// COSMETIC breaks survived in the SAME scenario — an episode added with no phases /
// only `pre` phases (a Season-2 stub or placeholder in a plan Johnny actively edits):
//
//   1. buildCards: `Math.round(doneN / ep.phases.length * 100)` → 0/0 → NaN → the
//      card's progress bar rendered `width:NaN%` (a visibly broken bar). Now routed
//      through pctComplete(doneN, total), which returns 0 when total === 0.
//   2. buildGantt: `Math.min(...dated.map(...))` on an empty `dated` → Infinity, and
//      `Math.max(pubMs, ...[])` with pubMs=-Infinity → -Infinity, so the bar got
//      `width: <negative>%` (broken/invisible). Now routed through episodeSpan(),
//      which returns null for a stub so the caller SKIPS the bar (the pub-cut ◆
//      marker is still drawn separately).
//
// Matching the sibling pick-next-cut / month-bar-cols / pct-timeline tests, we SLICE
// the real pctComplete + episodeSpan source straight out of index.html (no hand-copy
// that can drift) and prove:
//   • byte-identical behavior for every NON-stub input (zero regression), and
//   • the stub input yields 0 / null instead of NaN / Infinity, and
//   • mutation self-check: the OLD inline forms produce NaN / a non-finite span on the
//     stub, so the guards are load-bearing, not cosmetic.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};
const eq = (a, b, msg) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ── slice the two real helpers out of index.html ──────────────────────────────
const PCT_SRC = html.match(/function pctComplete\([\s\S]*?\n}/);
const SPAN_SRC = html.match(/function episodeSpan\([\s\S]*?\n}/);
assert.ok(PCT_SRC, 'sliced pctComplete from index.html');
assert.ok(SPAN_SRC, 'sliced episodeSpan from index.html');
const pctComplete = new Function(`${PCT_SRC[0]}\nreturn pctComplete;`)();
const episodeSpan = new Function(`${SPAN_SRC[0]}\nreturn episodeSpan;`)();

// ── pctComplete ───────────────────────────────────────────────────────────────
eq(pctComplete(0, 5), 0, 'no phases done → 0%');
eq(pctComplete(5, 5), 100, 'all phases done → 100%');
eq(pctComplete(1, 3), 33, '1 of 3 → 33% (rounded)');
eq(pctComplete(2, 3), 67, '2 of 3 → 67% (rounded)');
// THE FIX: a stub episode with zero phases reads 0, not NaN.
eq(pctComplete(0, 0), 0, 'STUB: zero phases → 0%, never NaN');
ok(!Number.isNaN(pctComplete(0, 0)), 'STUB: result is a real number, not NaN');

// ── episodeSpan ─────────────────────────────────────────────────────────────
// Byte-identical to the old spanS/spanE for a normal episode with dated phases.
{
  const starts = [1000, 3000, 2000], ends = [1500, 3500, 2500], pub = 9000;
  const span = episodeSpan(starts, ends, pub);
  eq(span, { s: 1000, e: 9000 }, 'normal: s = min(starts), e = max(pub, ...ends)');
}
{
  // pub-cut BEFORE the last dated end → e stays the later dated end (max wins).
  const span = episodeSpan([1000], [8000], 5000);
  eq(span, { s: 1000, e: 8000 }, 'normal: later dated end beats an earlier pub-cut');
}
{
  // no pub-cut (pubMs = -Infinity, as the caller passes) → e = max dated end.
  const span = episodeSpan([1000, 2000], [4000, 6000], -Infinity);
  eq(span, { s: 1000, e: 6000 }, 'normal: no pub-cut → e = max dated end');
  ok(Number.isFinite(span.s) && Number.isFinite(span.e), 'normal span is finite');
}
// THE FIX: a stub (no dated phases) returns null so the caller skips the bar.
eq(episodeSpan([], [], -Infinity), null, 'STUB: no dated phases, no pub-cut → null');
eq(episodeSpan([], [], 9000), null, 'STUB: no dated phases (even with a pub-cut) → null (◆ marker drawn separately)');

// ── mutation self-check: the OLD inline forms were genuinely broken ───────────
// pctDone (old): Math.round(doneN / phases.length * 100) with length 0.
{
  const oldPctDone = (doneN, len) => Math.round(doneN / len * 100);
  ok(Number.isNaN(oldPctDone(0, 0)), 'MUTATION: old pctDone form yields NaN on a stub — guard is load-bearing');
}
// spanS/spanE (old): Math.min(...[]) = Infinity, Math.max(-Infinity, ...[]) = -Infinity.
{
  const starts = [], ends = [], pubMs = -Infinity;
  const oldSpanS = Math.min(...starts);
  const oldSpanE = Math.max(pubMs, ...ends);
  ok(!Number.isFinite(oldSpanS) && !Number.isFinite(oldSpanE),
     'MUTATION: old spanS/spanE yield Infinity/-Infinity on a stub — guard is load-bearing');
}

console.log(`stub-episode-resilience: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
