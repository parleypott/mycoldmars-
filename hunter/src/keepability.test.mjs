// Locks the keepability scale bridge: stored 0–1 scores must classify + display
// on the UI's 0–10 scale (high >=7 / mid 4–6 / low <=3, "N/10"), while any legacy
// 0–10 row stays unchanged. Imports the REAL shipped helper.
import assert from 'node:assert';
import { normalizeKeepability } from './keepability.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── Inline RED proof: the OLD frontend compared the raw 0–1 score against the
// 0–10 thresholds, so the "high" (>=7) / Best Clips (>=6) bands were permanently
// empty and every clip fell into "low" (<=3). The bridge fixes that. ──
t('RED proof: raw 0–1 score never reaches the 0–10 "high" band; normalized does', () => {
  const raw = 0.85;                       // a genuine "high keepability" clip
  assert.equal(raw >= 7, false, 'old code: 0.85 >= 7 is false → high tab empty');
  assert.equal(raw <= 3, true,  'old code: 0.85 <= 3 is true → wrongly "low"');
  const k = normalizeKeepability(raw);
  assert.equal(k, 8.5);
  assert.equal(k >= 7, true,  'bridge: 8.5 >= 7 → correctly "high"');
  assert.equal(k <= 3, false, 'bridge: 8.5 is no longer "low"');
});

// ── 0–1 → 0–10 mapping ──
t('0.7 → 7', () => assert.equal(normalizeKeepability(0.7), 7));
t('0.85 → 8.5', () => assert.equal(normalizeKeepability(0.85), 8.5));
t('1.0 (max of 0–1) → 10', () => assert.equal(normalizeKeepability(1), 10));
t('0.0 → 0', () => assert.equal(normalizeKeepability(0), 0));

// ── Float-artifact safety at band boundaries (the reason for Math.round) ──
t('0.3 → exactly 3 (lands in low band, not 3.0000000000000004)', () => {
  const k = normalizeKeepability(0.3);
  assert.equal(k, 3);
  assert.equal(k <= 3, true, 'must stay within the "<= 3" low band');
});
t('0.4 → exactly 4 (mid-band floor)', () => {
  const k = normalizeKeepability(0.4);
  assert.equal(k, 4);
  assert.equal(k >= 4 && k <= 6, true);
});
t('0.6 → 6 (mid-band ceiling)', () => assert.equal(normalizeKeepability(0.6), 6));
t('0.58 → 5.8 (one-decimal precision kept)', () => assert.equal(normalizeKeepability(0.58), 5.8));
t('average-derived score at a band boundary: round saves the classification', () => {
  // scene.avgKeep = mean of three 0.7 clips → 0.6999999999999998 in float.
  // A raw `*10` (6.999…) wrongly fails the ">= 7 accepted" gate; the rounded
  // bridge returns exactly 7 and correctly classifies "accepted".
  const avg = (0.7 + 0.7 + 0.7) / 3;
  assert.equal(avg * 10 >= 7, false, 'raw *10 floats below 7');
  const k = normalizeKeepability(avg);
  assert.equal(k, 7);
  assert.equal(k >= 7, true, 'bridge rounds to exactly 7 → "accepted"');
});

// ── Legacy 0–10 rows pass through UNCHANGED (the no-regression guarantee) ──
t('legacy 7 (already 0–10) → 7 unchanged', () => assert.equal(normalizeKeepability(7), 7));
t('legacy 8.5 → 8.5 unchanged', () => assert.equal(normalizeKeepability(8.5), 8.5));
t('legacy 10 → 10 unchanged', () => assert.equal(normalizeKeepability(10), 10));
t('legacy 3 → 3 unchanged (stays low)', () => assert.equal(normalizeKeepability(3), 3));
t('boundary value exactly 1 treated as 0–1 max → 10 (matches the live 4148 convention)', () =>
  assert.equal(normalizeKeepability(1), 10));

// ── Null / invalid → null (so threshold comparisons exclude, never NaN) ──
for (const bad of [null, undefined, NaN, Infinity, -Infinity, '0.7', {}, []]) {
  t(`invalid ${String(bad)} → null`, () => assert.equal(normalizeKeepability(bad), null));
}
t('null result fails every band check (excluded, not crash)', () => {
  const k = normalizeKeepability(undefined);
  assert.equal(k == null, true);
  assert.equal(k >= 7, false);
  assert.equal((k ?? -1) >= 6, false); // Best Clips filter shape
});

// ── End-to-end: the browse-filter band logic on a realistic 0–1 corpus ──
// Replays main.js getFilteredCorpus's exact comparisons through the bridge.
const band = (rawScore, filter) => {
  const score = normalizeKeepability(rawScore);
  if (score == null) return false;
  if (filter === 'high') return score >= 7;
  if (filter === 'mid') return score >= 4 && score <= 6;
  if (filter === 'low') return score <= 3;
  return true;
};
t('corpus of 0–1 scores: "high" tab is no longer empty', () => {
  const corpus = [0.9, 0.85, 0.72, 0.5, 0.45, 0.2, 0.1];
  const high = corpus.filter(s => band(s, 'high'));
  assert.deepEqual(high, [0.9, 0.85, 0.72], 'three genuine keepers surface in "high"');
});
t('corpus of 0–1 scores: "mid" and "low" partition the rest correctly', () => {
  const corpus = [0.9, 0.5, 0.45, 0.2, 0.1];
  assert.deepEqual(corpus.filter(s => band(s, 'mid')), [0.5, 0.45]);
  assert.deepEqual(corpus.filter(s => band(s, 'low')), [0.2, 0.1]);
});
t('Best Clips filter (>=6 on the bridged scale) surfaces only 0.6+ clips', () => {
  const corpus = [0.9, 0.65, 0.6, 0.59, 0.3];
  const best = corpus.filter(s => (normalizeKeepability(s) ?? -1) >= 6);
  assert.deepEqual(best, [0.9, 0.65, 0.6]);
});
t('scene status: a 0.8-avg scene is now "accepted", not perpetually "proposed"', () => {
  const k = normalizeKeepability(0.8);
  const status = k != null && k >= 7 ? 'accepted' : k != null && k >= 5 ? 'refined' : 'proposed';
  assert.equal(status, 'accepted');
});

console.log(`\nkeepability: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
