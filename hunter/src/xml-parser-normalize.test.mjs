// Verifier-layer lock for normalizeSourceFrames — the FCP7 -1-sentinel clamp in
// hunter/src/xml-parser.js (the LIVE browser FCP7-import path). parseClipItem
// runs every imported clip's <in>/<out> through this before frame→seconds.
//
// Why it matters: FCP7/Premiere & DaVinci Resolve write -1 for an UNSET source
// in/out point ("clip not trimmed — use the full media"). Left raw, -1/fps is a
// NEGATIVE source timecode, and extractCorpusUnits keys each unit's range on
// in/outSeconds — so a negative leaks straight into the corpus and poisons the
// Hunter's clip ranking. This function clamps it. The worker has a byte-identical
// copy (worker/selects-parse-core.js) that selects-parse-core.test.mjs locks —
// but THIS client copy, reachable through the browser import, had no direct lock,
// so a regression here would have stayed green. That's the blind spot this closes.
//
// Contract (must hold; mutation-proven against the real source):
//   • a -1 (unset) source IN clamps to 0
//   • a -1 (unset) source OUT runs `duration` frames from the clamped in
//     (inN + duration when duration > 0), else falls back to inN
//   • valid (>= 0) in/out pass through byte-identical to the raw values
//   • the result is NEVER negative — the whole point of the clamp

import { normalizeSourceFrames } from './xml-parser.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};

// ── valid (>=0) in/out: pass through untouched (byte-identical to raw) ──
{
  const r = normalizeSourceFrames(100, 250, 999);
  eq('valid in passes through', r.inPoint, 100);
  eq('valid out passes through (duration ignored)', r.outPoint, 250);
}
{
  const r = normalizeSourceFrames(0, 0, 0); // a real 0-length trim at source start
  eq('zero in stays 0 (not treated as unset)', r.inPoint, 0);
  eq('zero out stays 0 (>=0, not clamped)', r.outPoint, 0);
}

// ── -1 IN sentinel → 0 ──
{
  const r = normalizeSourceFrames(-1, 500, 999);
  eq('unset in (-1) clamps to 0', r.inPoint, 0);
  eq('valid out untouched when only in was unset', r.outPoint, 500);
}

// ── -1 OUT sentinel → run `duration` frames from the clamped in ──
{
  const r = normalizeSourceFrames(50, -1, 200);
  eq('unset out (-1) with duration → in + duration', r.outPoint, 250);
  eq('in untouched (already valid)', r.inPoint, 50);
}
{
  // Untrimmed clip: BOTH in and out unset, full media of `duration` frames.
  const r = normalizeSourceFrames(-1, -1, 300);
  eq('both unset: in → 0', r.inPoint, 0);
  eq('both unset: out → 0 + duration', r.outPoint, 300);
}
{
  // duration unknown (0) → out falls back to the clamped in (degenerate range).
  const r = normalizeSourceFrames(-1, -1, 0);
  eq('both unset, no duration: in → 0', r.inPoint, 0);
  eq('both unset, no duration: out → in (0)', r.outPoint, 0);
}
{
  const r = normalizeSourceFrames(80, -1, 0);
  eq('unset out, no duration: out falls back to in', r.outPoint, 80);
}
{
  // A negative (other than the duration sentinel) must not survive either: a
  // bogus -1 duration is "unknown", so out collapses to in — never negative.
  const r = normalizeSourceFrames(40, -1, -1);
  eq('unset out, negative duration treated as unknown → in', r.outPoint, 40);
}

// ── the load-bearing invariant: output is NEVER negative ──
for (const [i, o, d] of [[-1, -1, 250], [-1, 100, 0], [25, -1, 0], [-1, -1, 0], [0, 0, 0], [-1, -1, -5]]) {
  const r = normalizeSourceFrames(i, o, d);
  eq(`never-negative in  (${i},${o},${d})`, r.inPoint >= 0, true);
  eq(`never-negative out (${i},${o},${d})`, r.outPoint >= 0, true);
}

// ── summary ──
const total = pass + fail;
console.log(`\nxml-parser-normalize: ${pass} passed, ${fail} failed (${total} total)`);
if (fail > 0) process.exit(1);
