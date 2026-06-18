// queen-scarlet-school: pure sanitizer for the Story Report Card.
//
// Extracted from api/qss-story-report.js so the normalization that
// guarantees the client never has to guard for missing / malformed fields
// is unit-testable in isolation. The handler parses the model's raw JSON,
// calls normalizeReport(parsed), and ships the result verbatim (plus a
// `model` field).
//
// Behavior is identical to the previous inline block for every OBJECT input
// (the only real case). The one deliberate hardening: a non-object `parsed`
// — most importantly a literal `null` (JSON.parse('null') succeeds), or a
// bare number/string the model might emit — no longer throws. The old inline
// code did `parsed.power_score` directly, so a `null` parse would crash the
// handler with an unhandled exception (500). normalizeReport degrades that to
// a clean all-defaults report instead.
//
// Report contract (what the client can rely on):
//   power_score      0..100, integer-ish, 0 on garbage
//   power_label      the model's label IF it is one of the 5 allowed,
//                    else DERIVED from power_score with the same thresholds
//                    the system prompt states (85/70/55/40)
//   one_liner        string, capped 280
//   scores           ONLY the 6 allowed categories; score clamped 1..5;
//                    category lowercased+trimmed; comment capped 220; max 6
//   gaps             shape-validated {from_block,to_block,issue}; max 8
//   repetitions      shape-validated {pattern,count,where}; max 6
//   strengths        non-empty trimmed strings, capped 240; max 4
//   recommendations  non-empty trimmed strings, capped 240; max 5

export const ALLOWED_LABEL = new Set([
  'really strong', 'almost ready', 'getting there', 'needs work', 'needs a redo',
]);

export const ALLOWED_CATEGORIES = new Set([
  'cohesion', 'surprise', 'intention', 'action', 'repetition', 'characters',
]);

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Power-score → kid-friendly label. Thresholds MUST match the system prompt
// (85-100 / 70-84 / 55-69 / 40-54 / 0-39).
export function labelForScore(power_score) {
  return power_score >= 85 ? 'really strong'
    : power_score >= 70 ? 'almost ready'
      : power_score >= 55 ? 'getting there'
        : power_score >= 40 ? 'needs work'
          : 'needs a redo';
}

export function normalizeReport(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};

  const power_score = clamp(Number(p.power_score) || 0, 0, 100);
  const rawLabel = String(p.power_label).toLowerCase().trim();
  const power_label = ALLOWED_LABEL.has(rawLabel) ? rawLabel : labelForScore(power_score);

  const scores = (Array.isArray(p.scores) ? p.scores : [])
    .filter(s => s && typeof s === 'object' && ALLOWED_CATEGORIES.has(String(s.category).toLowerCase().trim()))
    .map(s => ({
      category: String(s.category).toLowerCase().trim(),
      score: clamp(Number(s.score) || 1, 1, 5),
      comment: String(s.comment || '').slice(0, 220),
    }))
    .slice(0, 6);

  const gaps = (Array.isArray(p.gaps) ? p.gaps : [])
    .filter(g => g && typeof g === 'object')
    .map(g => ({
      from_block: Number(g.from_block) || 0,
      to_block: Number(g.to_block) || 0,
      issue: String(g.issue || '').slice(0, 220),
    }))
    .slice(0, 8);

  const repetitions = (Array.isArray(p.repetitions) ? p.repetitions : [])
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      pattern: String(r.pattern || '').slice(0, 180),
      count: Number(r.count) || 0,
      where: String(r.where || '').slice(0, 120),
    }))
    .slice(0, 6);

  const strengths = (Array.isArray(p.strengths) ? p.strengths : [])
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 240))
    .slice(0, 4);

  const recommendations = (Array.isArray(p.recommendations) ? p.recommendations : [])
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 240))
    .slice(0, 5);

  const one_liner = String(p.one_liner || '').slice(0, 280);

  return { power_score, power_label, one_liner, scores, gaps, repetitions, strengths, recommendations };
}
