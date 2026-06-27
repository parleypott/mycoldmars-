// Tests for the server-side keepability scale bridge (api/_lib/keepability.js).
// Imports the REAL shipped function. Locks the 0–1 → 0–10 normalization that the
// narrative-insights prompt (api/gemini.js) depends on for its "/10" framing, and
// preserves the no-op behavior for legacy 0–10 rows + the null fallback.
import { normalizeKeepability } from './keepability.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── RED PROOF: the OLD narrative path sent avgKeep RAW (no bridge) so the prompt
//    rendered "0.7/10" — bottom-tier — for a scene that is really 7/10. ──
function oldRawForPrompt(avgKeep) {
  // exactly what gemini.js used to interpolate: scene.avgKeep.toFixed(1) + '/10'
  return (avgKeep != null ? avgKeep.toFixed(1) : '?') + '/10';
}
function newForPrompt(avgKeep) {
  // the shipped expression
  return (normalizeKeepability(avgKeep)?.toFixed(1) ?? '?') + '/10';
}
t('RED proof: old raw path told the AI a 7/10 scene was "0.7/10"', () => {
  assert.equal(oldRawForPrompt(0.7), '0.7/10');   // the bug: bottom-tier signal
  assert.equal(newForPrompt(0.7), '7.0/10');      // the fix: real 0–10 value
});
t('RED proof: old raw path floored the whole corpus into sub-1/10', () => {
  // a strong scene (0.9) and a weak one (0.3) both read as garbage on the old path
  assert.equal(oldRawForPrompt(0.9), '0.9/10');
  assert.equal(oldRawForPrompt(0.3), '0.3/10');
  assert.equal(newForPrompt(0.9), '9.0/10');
  assert.equal(newForPrompt(0.3), '3.0/10');
});

// ── The fix: 0–1 scores scale ×10 ──
t('0.7 → 7', () => assert.equal(normalizeKeepability(0.7), 7));
t('0.0 → 0', () => assert.equal(normalizeKeepability(0), 0));
t('1.0 (boundary) → 10', () => assert.equal(normalizeKeepability(1), 10));
t('0.3 → 3 (no float artifact past a band edge)', () => assert.equal(normalizeKeepability(0.3), 3));
t('0.55 → 5.5', () => assert.equal(normalizeKeepability(0.55), 5.5));

// ── No-op for legacy 0–10 rows (value > 1 returned unchanged) ──
t('7 (already 0–10) → 7 unchanged', () => assert.equal(normalizeKeepability(7), 7));
t('10 → 10 unchanged', () => assert.equal(normalizeKeepability(10), 10));
t('3.5 (already 0–10) → 3.5 unchanged', () => assert.equal(normalizeKeepability(3.5), 3.5));

// ── Idempotence on the 0–10 output: re-normalizing a normalized value is stable ──
t('idempotent on >1 outputs', () => {
  for (const v of [0.2, 0.5, 0.8, 1]) {
    const once = normalizeKeepability(v);
    assert.equal(normalizeKeepability(once), once, `not idempotent at ${v}`);
  }
});

// ── Null fallback so the prompt renders "?" not "null/10" or a crash ──
t('null → null', () => assert.equal(normalizeKeepability(null), null));
t('undefined → null', () => assert.equal(normalizeKeepability(undefined), null));
t('NaN → null', () => assert.equal(normalizeKeepability(NaN), null));
t('Infinity → null', () => assert.equal(normalizeKeepability(Infinity), null));
t('string → null (never a bogus number)', () => assert.equal(normalizeKeepability('0.7'), null));
t('prompt renders "?" on a missing score', () => assert.equal(newForPrompt(null), '?/10'));

// ── Matches the canonical CLIENT copy (hunter/src/keepability.js) bit-for-bit ──
function clientCopy(score) {
  if (typeof score !== 'number' || !isFinite(score)) return null;
  if (score <= 1) return Math.round(score * 100) / 10;
  return score;
}
t('server copy === client copy across the range', () => {
  for (const v of [null, undefined, NaN, Infinity, -1, 0, 0.1, 0.3, 0.55, 0.7, 1, 1.5, 3.5, 7, 10, 12]) {
    assert.equal(normalizeKeepability(v), clientCopy(v), `divergence at ${v}`);
  }
});

console.log(`\nkeepability: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
