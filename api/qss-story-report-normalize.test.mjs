// Mutation-proven coverage for the Story Report Card sanitizer.
//
// Imports the REAL shipped pure function (no drift-prone mirror). Every
// assertion is designed so that reverting the corresponding logic in
// api/_lib/qss-story-report-normalize.js makes a case go RED. Run directly:
//   bun api/qss-story-report-normalize.test.mjs
// (auto-discovered by `bun run test`.)

import {
  normalizeReport,
  labelForScore,
  clamp,
  ALLOWED_LABEL,
  ALLOWED_CATEGORIES,
} from './_lib/qss-story-report-normalize.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(msg); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  ok(A === B, `${msg}  (got ${A}, want ${B})`);
}

// ── clamp ────────────────────────────────────────────────────────────────
eq(clamp(50, 0, 100), 50, 'clamp: in-range passthrough');
eq(clamp(-5, 0, 100), 0, 'clamp: below floor');
eq(clamp(150, 0, 100), 100, 'clamp: above ceiling');
eq(clamp(5, 1, 5), 5, 'clamp: at ceiling');

// ── labelForScore: boundaries MUST match the system prompt ─────────────────
eq(labelForScore(100), 'really strong', 'label: 100');
eq(labelForScore(85), 'really strong', 'label: 85 boundary');
eq(labelForScore(84), 'almost ready', 'label: 84 just below');
eq(labelForScore(70), 'almost ready', 'label: 70 boundary');
eq(labelForScore(69), 'getting there', 'label: 69 just below');
eq(labelForScore(55), 'getting there', 'label: 55 boundary');
eq(labelForScore(54), 'needs work', 'label: 54 just below');
eq(labelForScore(40), 'needs work', 'label: 40 boundary');
eq(labelForScore(39), 'needs a redo', 'label: 39 just below');
eq(labelForScore(0), 'needs a redo', 'label: 0');
// every derived label is one the prompt promised
for (const s of [0, 39, 40, 54, 55, 69, 70, 84, 85, 100]) {
  ok(ALLOWED_LABEL.has(labelForScore(s)), `label: derived ${s} is an allowed label`);
}

// ── allow-lists match the system prompt + the consuming UI ─────────────────
eq([...ALLOWED_CATEGORIES].sort(), ['action', 'characters', 'cohesion', 'intention', 'repetition', 'surprise'], 'categories: exactly the six graded dimensions');
ok(ALLOWED_LABEL.size === 5, 'labels: exactly five');

// ── power_score clamping + coercion ────────────────────────────────────────
eq(normalizeReport({ power_score: 73 }).power_score, 73, 'score: passes through');
eq(normalizeReport({ power_score: 250 }).power_score, 100, 'score: clamped high');
eq(normalizeReport({ power_score: -10 }).power_score, 0, 'score: clamped low');
eq(normalizeReport({ power_score: 'not a number' }).power_score, 0, 'score: garbage → 0');
eq(normalizeReport({}).power_score, 0, 'score: missing → 0');

// ── power_label: trust valid model label, else derive ──────────────────────
eq(normalizeReport({ power_label: 'almost ready', power_score: 20 }).power_label, 'almost ready',
  'label: valid model label kept even if it disagrees with score');
eq(normalizeReport({ power_label: 'ALMOST READY', power_score: 20 }).power_label, 'almost ready',
  'label: model label normalized to lowercase before allow-check');
eq(normalizeReport({ power_label: '  really strong  ', power_score: 10 }).power_label, 'really strong',
  'label: model label trimmed');
eq(normalizeReport({ power_label: 'amazing', power_score: 90 }).power_label, 'really strong',
  'label: invalid model label → derived from score (90)');
eq(normalizeReport({ power_label: 'C-', power_score: 60 }).power_label, 'getting there',
  'label: junk label → derived (60 → getting there)');
eq(normalizeReport({ power_score: 42 }).power_label, 'needs work',
  'label: no model label → derived (42 → needs work)');

// ── scores: only the six allowed categories survive ────────────────────────
{
  const r = normalizeReport({
    scores: [
      { category: 'cohesion', score: 4, comment: 'tight' },
      { category: 'Surprise', score: 2, comment: 'predictable' }, // mixed case → kept, lowercased
      { category: 'vibes', score: 5, comment: 'not a real axis' }, // dropped
      { category: 'pacing', score: 5 }, // dropped (not allowed)
    ],
  });
  eq(r.scores.length, 2, 'scores: invalid categories dropped');
  eq(r.scores[0], { category: 'cohesion', score: 4, comment: 'tight' }, 'scores: cohesion kept');
  eq(r.scores[1].category, 'surprise', 'scores: category lowercased');
}
// score clamping 1..5 and garbage handling
{
  const r = normalizeReport({
    scores: [
      { category: 'action', score: 9 },     // clamp → 5
      { category: 'intention', score: 0 },  // 0 → falsy → 1, then clamp → 1
      { category: 'repetition', score: 'x' }, // garbage → 1
    ],
  });
  eq(r.scores[0].score, 5, 'scores: clamp high → 5');
  eq(r.scores[1].score, 1, 'scores: 0 → 1 (1..5 axis)');
  eq(r.scores[2].score, 1, 'scores: garbage → 1');
  eq(r.scores[0].comment, '', 'scores: missing comment → ""');
}
// comment cap 220
{
  const long = 'x'.repeat(400);
  const r = normalizeReport({ scores: [{ category: 'characters', score: 3, comment: long }] });
  ok(r.scores[0].comment.length === 220, 'scores: comment capped at 220');
}
// scores cap 6 (dupes allowed, but max 6)
{
  const six = Array.from({ length: 9 }, () => ({ category: 'action', score: 3 }));
  eq(normalizeReport({ scores: six }).scores.length, 6, 'scores: capped at 6');
}
// non-object entries filtered
eq(normalizeReport({ scores: [null, 'cohesion', { category: 'cohesion', score: 3 }] }).scores.length, 1,
  'scores: non-object entries dropped');
// scores not an array → []
eq(normalizeReport({ scores: 'nope' }).scores, [], 'scores: non-array → []');

// ── gaps ───────────────────────────────────────────────────────────────────
{
  const r = normalizeReport({
    gaps: [
      { from_block: 3, to_block: 4, issue: 'cafeteria → underground, no transition' },
      { from_block: 'x', to_block: undefined }, // coerced to 0/0, issue ''
      'not an object',
    ],
  });
  eq(r.gaps.length, 2, 'gaps: non-object dropped');
  eq(r.gaps[0], { from_block: 3, to_block: 4, issue: 'cafeteria → underground, no transition' }, 'gaps: valid kept');
  eq(r.gaps[1], { from_block: 0, to_block: 0, issue: '' }, 'gaps: bad numbers → 0, missing issue → ""');
}
eq(normalizeReport({ gaps: Array.from({ length: 12 }, () => ({ from_block: 1, to_block: 2 })) }).gaps.length, 8,
  'gaps: capped at 8');
{
  const r = normalizeReport({ gaps: [{ from_block: 1, to_block: 2, issue: 'y'.repeat(400) }] });
  ok(r.gaps[0].issue.length === 220, 'gaps: issue capped at 220');
}

// ── repetitions ─────────────────────────────────────────────────────────────
{
  const r = normalizeReport({
    repetitions: [
      { pattern: 'PA crackles', count: 3, where: 'blocks 1, 4, 7' },
      { count: 'x' }, // pattern '', count 0, where ''
      42,
    ],
  });
  eq(r.repetitions.length, 2, 'reps: non-object dropped');
  eq(r.repetitions[0], { pattern: 'PA crackles', count: 3, where: 'blocks 1, 4, 7' }, 'reps: valid kept');
  eq(r.repetitions[1], { pattern: '', count: 0, where: '' }, 'reps: missing fields defaulted');
}
eq(normalizeReport({ repetitions: Array.from({ length: 9 }, () => ({ pattern: 'p', count: 1 })) }).repetitions.length, 6,
  'reps: capped at 6');
{
  const r = normalizeReport({ repetitions: [{ pattern: 'p'.repeat(300), count: 1, where: 'w'.repeat(300) }] });
  ok(r.repetitions[0].pattern.length === 180, 'reps: pattern capped at 180');
  ok(r.repetitions[0].where.length === 120, 'reps: where capped at 120');
}

// ── strengths / recommendations: non-empty strings only ─────────────────────
{
  const r = normalizeReport({
    strengths: ['Block 5 lands well', '   ', '', 42, null, '  trimmed me  '],
    recommendations: ["Let's add a goal for Kevin", 'I think we cut block 3', ''],
  });
  eq(r.strengths, ['Block 5 lands well', 'trimmed me'], 'strengths: empties/non-strings dropped, trimmed');
  eq(r.recommendations.length, 2, 'recs: empty dropped');
}
eq(normalizeReport({ strengths: Array.from({ length: 7 }, (_, i) => `s${i}`) }).strengths.length, 4,
  'strengths: capped at 4');
eq(normalizeReport({ recommendations: Array.from({ length: 9 }, (_, i) => `r${i}`) }).recommendations.length, 5,
  'recs: capped at 5');
{
  const r = normalizeReport({ strengths: ['z'.repeat(400)] });
  ok(r.strengths[0].length === 240, 'strengths: capped at 240');
}

// ── one_liner ────────────────────────────────────────────────────────────────
eq(normalizeReport({ one_liner: 'a house with framing but no walls' }).one_liner, 'a house with framing but no walls',
  'one_liner: passthrough');
ok(normalizeReport({ one_liner: 'q'.repeat(400) }).one_liner.length === 280, 'one_liner: capped at 280');
eq(normalizeReport({}).one_liner, '', 'one_liner: missing → ""');

// ── full empty input → fully-shaped all-defaults report (client never guards) ─
{
  const r = normalizeReport({});
  eq(r, {
    power_score: 0,
    power_label: 'needs a redo',
    one_liner: '',
    scores: [],
    gaps: [],
    repetitions: [],
    strengths: [],
    recommendations: [],
  }, 'empty: fully-shaped all-defaults report');
}

// ── HARDENING: non-object parsed must NOT throw (the old inline code did) ────
// JSON.parse('null') === null; the previous `parsed.power_score` access would
// have thrown an unhandled exception → 500. normalizeReport degrades cleanly.
for (const bad of [null, undefined, 42, 'a string', true]) {
  let threw = false, r;
  try { r = normalizeReport(bad); } catch { threw = true; }
  ok(!threw, `hardening: normalizeReport(${JSON.stringify(bad)}) does not throw`);
  if (!threw) {
    eq(r.power_score, 0, `hardening: ${JSON.stringify(bad)} → score 0`);
    eq(r.scores, [], `hardening: ${JSON.stringify(bad)} → scores []`);
    eq(r.power_label, 'needs a redo', `hardening: ${JSON.stringify(bad)} → derived label`);
  }
}
// INLINE RED PROOF: reconstruct the OLD inline access pattern and show it
// throws on a literal-null parse, which the shipped normalizeReport survives.
{
  const oldInlineAccess = (parsed) => clamp(Number(parsed.power_score) || 0, 0, 100); // mirrors removed code
  let oldThrew = false;
  try { oldInlineAccess(null); } catch { oldThrew = true; }
  ok(oldThrew, 'RED proof: the OLD inline `parsed.power_score` access throws on null');
  let newThrew = false;
  try { normalizeReport(null); } catch { newThrew = true; }
  ok(!newThrew, 'RED proof: the shipped normalizeReport survives null');
}

// ── report ──────────────────────────────────────────────────────────────────
if (fail) {
  console.error(`\n✗ qss-story-report-normalize: ${pass} passed, ${fail} FAILED`);
  for (const m of fails) console.error('  - ' + m);
  process.exit(1);
}
console.log(`✓ qss-story-report-normalize: ${pass} passed`);
