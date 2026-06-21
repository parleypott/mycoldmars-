// Lock for The Hunter editorial-taste aggregator (taste-aggregate-core.js) —
// aggregateDecisions, the pure Phase-2 core that turns editorial_decisions rows
// into the calibration stats that brief Gemini on THIS editor's footage taste
// (keep rates per shot/emotion/function, keepability calibration, score↔decision
// mismatches). It was inline + ZERO-coverage in build-taste-profile.mjs (which
// builds a Supabase + GoogleGenAI client and reads .env with top-level await, so
// it can't be imported headlessly); extracted VERBATIM here, the worker imports it.
//
// NO live bug in this function — this is a verifier-layer LOCK. Reviewed carefully:
// every keep-rate division is guarded, the calibration filters null scores, and
// the mismatch loop SKIPS a null keepability_score (line `if (... == null) continue`)
// — that skip is load-bearing: without it, a KEPT clip with a null score would be
// coerced `null < 0.4` → true and falsely flagged a "low_score_kept" mismatch,
// polluting the examples fed to Gemini. The headline mutation proves that guard.
//
// SCALE: keepability_score is 0.0–1.0 here, matching the source of truth that
// GENERATES it — gemini-client.js:195 (`"keepability_score": 0.0-1.0`). The
// sibling worker consumers agree. The 0.7/0.4 mismatch thresholds are 0–1
// thresholds, correct against that schema. (The Hunter FRONTEND drifted to a 0–10
// interpretation — see the NOTE in BACKLOG.md; an attended fix, not touched here.)

import { aggregateDecisions } from './taste-aggregate-core.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }
function approx(a, b, msg, tol = 1e-9) { if (Math.abs(a - b) <= tol) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ~${b}\n    got      ${a}`); } }

// helper: a decision row with sane defaults
function dec(o = {}) {
  return {
    kept: false, keepability_score: null, shot_type: null,
    emotional_register: null, editorial_function: null,
    usage_count: 0, source_clip_name: 'clip', ...o,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// RED PROOF — the mismatch null-skip is load-bearing. A KEPT clip with a null
// keepability_score must NOT be a "low_score_kept" mismatch. Without the
// `== null` guard the loop reaches `null < 0.4 && kept` → (0 < 0.4) → true,
// minting a false mismatch. Reconstruct the unguarded loop to show the trap.
// ─────────────────────────────────────────────────────────────────────────
function oldMismatchesNoNullGuard(decisions) {
  const m = [];
  for (const d of decisions) {
    // (no `if (d.keepability_score == null) continue;`)
    if (d.keepability_score > 0.7 && !d.kept) m.push({ type: 'high_score_discarded', decision: d });
    else if (d.keepability_score < 0.4 && d.kept) m.push({ type: 'low_score_kept', decision: d });
  }
  return m;
}
{
  const nullKept = [dec({ kept: true, keepability_score: null })];
  const oldM = oldMismatchesNoNullGuard(nullKept);
  ok(oldM.length === 1 && oldM[0].type === 'low_score_kept',
     'RED PROOF: unguarded loop falsely flags a null-score KEPT clip as low_score_kept (null<0.4 coercion)');
  const shipped = aggregateDecisions(nullKept);
  eq(shipped.mismatches, [], 'SHIPPED: null-score kept clip is NOT a mismatch (the == null guard)');
}

// ── mismatch null-skip across shapes ──
{
  const r = aggregateDecisions([
    dec({ kept: true,  keepability_score: null }),   // null kept → skip (the guard)
    dec({ kept: false, keepability_score: null }),   // null discarded → skip
    dec({ kept: true,  keepability_score: 0.2 }),    // low_score_kept ✓
    dec({ kept: false, keepability_score: 0.9 }),    // high_score_discarded ✓
  ]);
  eq(r.mismatches.map(m => m.type).sort(),
     ['high_score_discarded', 'low_score_kept'],
     'exactly the two real mismatches; both null-score clips skipped');
}

// ── keepability calibration: null scores excluded from averages ──
{
  const r = aggregateDecisions([
    dec({ kept: true,  keepability_score: 0.8 }),
    dec({ kept: true,  keepability_score: 0.6 }),
    dec({ kept: true,  keepability_score: null }),   // must NOT drag avg toward 0
    dec({ kept: false, keepability_score: 0.2 }),
    dec({ kept: false, keepability_score: null }),
  ]);
  approx(r.keepabilityCalibration.avg_kept_score, 0.7, 'avg_kept_score = (0.8+0.6)/2, null excluded');
  approx(r.keepabilityCalibration.avg_discarded_score, 0.2, 'avg_discarded_score = 0.2, null excluded');
  eq(r.keepabilityCalibration.kept_sample_size, 2, 'kept_sample_size counts only non-null kept');
  eq(r.keepabilityCalibration.discarded_sample_size, 1, 'discarded_sample_size counts only non-null discarded');
}
{
  // no non-null scores → null averages, not NaN/0
  const r = aggregateDecisions([dec({ kept: true }), dec({ kept: false })]);
  eq(r.keepabilityCalibration.avg_kept_score, null, 'avg_kept_score null when no non-null kept scores');
  eq(r.keepabilityCalibration.avg_discarded_score, null, 'avg_discarded_score null when no non-null discarded scores');
  eq(r.keepabilityCalibration.correlation, null, 'correlation null when no high-score clips');
}

// ── correlation: % of >0.7 clips actually kept (0–1 schema) ──
{
  const r = aggregateDecisions([
    dec({ kept: true,  keepability_score: 0.9 }),  // high + kept
    dec({ kept: true,  keepability_score: 0.8 }),  // high + kept
    dec({ kept: false, keepability_score: 0.75 }), // high + discarded
    dec({ kept: false, keepability_score: 0.5 }),  // not high → ignored by correlation
  ]);
  approx(r.keepabilityCalibration.correlation, 2 / 3, 'correlation = 2 of 3 high-score clips kept');
}

// ── shot/emotion/function keep rates (scale-INDEPENDENT division) ──
{
  const r = aggregateDecisions([
    dec({ shot_type: 'wide', kept: true }),
    dec({ shot_type: 'wide', kept: true }),
    dec({ shot_type: 'wide', kept: false }),
    dec({ shot_type: 'cu',   kept: false }),
    dec({ shot_type: null,   kept: true }),   // no shot_type → skipped entirely
  ]);
  eq(r.shotStats.wide, { kept: 2, total: 3, rate: 2 / 3 }, 'wide: 2/3 kept');
  eq(r.shotStats.cu,   { kept: 0, total: 1, rate: 0 },     'cu: 0/1 kept, rate 0');
  ok(!('null' in r.shotStats) && !('undefined' in r.shotStats), 'null shot_type contributes no bucket');
}
{
  const r = aggregateDecisions([
    dec({ emotional_register: 'tense', kept: true }),
    dec({ emotional_register: 'tense', kept: false }),
    dec({ editorial_function: 'establishing', kept: true }),
    dec({ emotional_register: '', kept: true }),   // falsy register → skipped
  ]);
  eq(r.emotionStats.tense, { kept: 1, total: 2, rate: 0.5 }, 'emotion keep rate 1/2');
  eq(r.functionStats.establishing, { kept: 1, total: 1, rate: 1 }, 'function keep rate 1/1');
  ok(!('' in r.emotionStats), 'empty-string register contributes no bucket');
}

// ── overall keep rate + avg usage (kept-with-usage>0 only) ──
{
  const r = aggregateDecisions([
    dec({ kept: true,  usage_count: 3 }),
    dec({ kept: true,  usage_count: 1 }),
    dec({ kept: true,  usage_count: 0 }),   // usage 0 → excluded from avgUsageCount
    dec({ kept: false, usage_count: 5 }),   // not kept → excluded from avgUsageCount
  ]);
  approx(r.overallKeptRate, 3 / 4, 'overallKeptRate = 3 kept / 4 total');
  approx(r.avgUsageCount, 2, 'avgUsageCount = (3+1)/2, kept-with-usage>0 only');
}
{
  const r = aggregateDecisions([]);
  eq(r.overallKeptRate, 0, 'empty → overallKeptRate 0 (no divide-by-zero)');
  eq(r.avgUsageCount, 0, 'empty → avgUsageCount 0');
  eq(r.mismatches, [], 'empty → no mismatches');
  eq(r.shotStats, {}, 'empty → no shot stats');
}

// ── high_score_discarded vs low_score_kept boundaries (strict 0.7 / 0.4) ──
{
  const r = aggregateDecisions([
    dec({ kept: false, keepability_score: 0.7 }),  // NOT > 0.7 → not a mismatch
    dec({ kept: true,  keepability_score: 0.4 }),  // NOT < 0.4 → not a mismatch
    dec({ kept: false, keepability_score: 0.71 }), // > 0.7 discarded ✓
    dec({ kept: true,  keepability_score: 0.39 }), // < 0.4 kept ✓
  ]);
  eq(r.mismatches.map(m => m.type).sort(),
     ['high_score_discarded', 'low_score_kept'],
     'strict boundaries: exactly 0.7 / 0.4 are NOT mismatches');
}

console.log(`taste-aggregate-core: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
