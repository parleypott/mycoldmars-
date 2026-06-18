// Tests for the Hunter clip-range timecode formatter (api/_lib/format-seconds.js).
// Imports the REAL shipped function. Locks the hour-carry fix + preserves the
// exact sub-hour MM:SS behavior the old inline gemini.js version produced.
import { formatSeconds } from './format-seconds.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── RED PROOF: reconstruct the OLD inline formatSeconds and show it drops the hour ──
function oldFormatSeconds(s) {
  if (s == null) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
t('RED proof: old code drops the hour on hour-plus clips', () => {
  assert.equal(oldFormatSeconds(3661), '61:01');      // a 1h01m01s clip → ambiguous "61:01"
  assert.equal(oldFormatSeconds(7325), '122:05');     // 2h02m05s → "122:05"
  // the shipped function fixes exactly these
  assert.equal(formatSeconds(3661), '1:01:01');
  assert.equal(formatSeconds(7325), '2:02:05');
});
t('RED proof: old code yields NaN:NaN on bad input', () => {
  assert.equal(oldFormatSeconds(NaN), 'NaN:NaN');
  assert.equal(formatSeconds(NaN), '--:--');
});

// ── The fix: hour carry ──
t('exactly one hour → 1:00:00', () => assert.equal(formatSeconds(3600), '1:00:00'));
t('1h01m01s → 1:01:01', () => assert.equal(formatSeconds(3661), '1:01:01'));
t('2h02m05s → 2:02:05', () => assert.equal(formatSeconds(7325), '2:02:05'));
t('59:59 stays sub-hour (no carry one tick early)', () => assert.equal(formatSeconds(3599), '59:59'));
t('large multi-hour 10h00m00s', () => assert.equal(formatSeconds(36000), '10:00:00'));

// ── NO-REGRESSION: every sub-hour value is byte-identical to the old inline code ──
t('sub-hour outputs identical to old inline formatter', () => {
  for (const s of [0, 1, 5, 9, 59, 60, 61, 125, 599, 600, 1234, 3599]) {
    assert.equal(formatSeconds(s), oldFormatSeconds(s), `mismatch at ${s}`);
  }
});
t('zero → 00:00', () => assert.equal(formatSeconds(0), '00:00'));
t('5s → 00:05 (padded)', () => assert.equal(formatSeconds(5), '00:05'));
t('65s → 01:05', () => assert.equal(formatSeconds(65), '01:05'));
t('125s → 02:05', () => assert.equal(formatSeconds(125), '02:05'));
t('fractional seconds floored', () => {
  assert.equal(formatSeconds(125.9), '02:05');
  assert.equal(formatSeconds(3661.4), '1:01:01');
});
t('numeric string coerced', () => {
  assert.equal(formatSeconds('125'), '02:05');
  assert.equal(formatSeconds('3661'), '1:01:01');
});

// ── Guards: nullish / non-finite → sentinel (never NaN:NaN) ──
t('null → --:--', () => assert.equal(formatSeconds(null), '--:--'));
t('undefined → --:--', () => assert.equal(formatSeconds(undefined), '--:--'));
t('NaN → --:--', () => assert.equal(formatSeconds(NaN), '--:--'));
t('Infinity → --:--', () => assert.equal(formatSeconds(Infinity), '--:--'));
t('-Infinity → --:--', () => assert.equal(formatSeconds(-Infinity), '--:--'));
t('non-numeric string → --:--', () => assert.equal(formatSeconds('abc'), '--:--'));

// ── Negative (defensive; clips shouldn't be negative but never throw) ──
t('negative sub-hour → -MM:SS', () => assert.equal(formatSeconds(-65), '-01:05'));
t('negative hour-plus → -H:MM:SS', () => assert.equal(formatSeconds(-3661), '-1:01:01'));

// ── Invariant: output always matches a timecode shape, never NaN ──
t('output is always a valid timecode shape', () => {
  for (const s of [0, 7, 59, 60, 3599, 3600, 3661, 7325, 36000, 125.5, '90']) {
    assert.match(formatSeconds(s), /^-?(\d{1,}:)?\d{2}:\d{2}$/, `bad shape at ${s}`);
  }
});

console.log(`\nformat-seconds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
