// Tests for The Hunter's shared timecode formatters (hour-drop fix).
//
// formatTc (display) and formatClipTime (Gemini prompt) used to be inline MM:SS
// formatters with no hour carry, so an hour-plus clip rendered "61:40" instead
// of "1:01:40". These lock the hour carry + the byte-identical sub-hour output.

import assert from 'node:assert';
import { formatTc, formatClipTime, formatDuration } from './format-tc.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n   ${e.message}`); } };

// ── Old inline implementations, reconstructed for RED proofs / no-regression ──
function oldFormatTc(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function oldFormatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
// The LONE hour-dropping duration formatter: the inline scenesPayload.durationStr
// site in main.js. `Xm Ys` with no hour carry, fed to the narrative AI.
function oldDurationStr(seconds) {
  const durMin = Math.floor(seconds / 60);
  const durSec = Math.floor(seconds % 60);
  return `${durMin}m${durSec}s`;
}

// ── RED proof: the old code dropped the hour ──
t('RED: old formatTc drops the hour (3700 -> 61:40)', () => {
  assert.strictEqual(oldFormatTc(3700), '61:40');          // the bug
  assert.strictEqual(formatTc(3700), '1:01:40');           // the fix
});
t('RED: old formatTime drops the hour (3661 -> 61:01)', () => {
  assert.strictEqual(oldFormatTime(3661), '61:01');        // the bug
  assert.strictEqual(formatClipTime(3661), '1:01:01');     // the fix
});

// ── formatTc: hour-plus carries ──
t('formatTc 1h exactly', () => assert.strictEqual(formatTc(3600), '1:00:00'));
t('formatTc 1:01:40', () => assert.strictEqual(formatTc(3700), '1:01:40'));
t('formatTc 2:02:05', () => assert.strictEqual(formatTc(7325), '2:02:05'));
t('formatTc 10h+ multi-digit hour', () => assert.strictEqual(formatTc(36000 + 125), '10:02:05'));
t('formatTc just under an hour stays MM:SS', () => assert.strictEqual(formatTc(3599), '59:59'));
t('formatTc fractional floors', () => assert.strictEqual(formatTc(3700.9), '1:01:40'));

// ── formatTc: bad input ──
t('formatTc null -> --:--', () => assert.strictEqual(formatTc(null), '--:--'));
t('formatTc undefined -> --:--', () => assert.strictEqual(formatTc(undefined), '--:--'));
t('formatTc NaN -> --:-- (was NaN:NaN)', () => assert.strictEqual(formatTc(NaN), '--:--'));
t('formatTc Infinity -> --:--', () => assert.strictEqual(formatTc(Infinity), '--:--'));
t('formatTc negative -> --:--', () => assert.strictEqual(formatTc(-5), '--:--'));

// ── formatClipTime: hour-plus carries, unpadded minutes sub-hour ──
t('formatClipTime 1h exactly', () => assert.strictEqual(formatClipTime(3600), '1:00:00'));
t('formatClipTime 1:01:01', () => assert.strictEqual(formatClipTime(3661), '1:01:01'));
t('formatClipTime 3:00:00', () => assert.strictEqual(formatClipTime(10800), '3:00:00'));
t('formatClipTime sub-hour unpadded minutes', () => assert.strictEqual(formatClipTime(65), '1:05'));
t('formatClipTime under-min zero minutes', () => assert.strictEqual(formatClipTime(5), '0:05'));
t('formatClipTime NaN -> 0:00 (was NaN:NaN)', () => assert.strictEqual(formatClipTime(NaN), '0:00'));
t('formatClipTime negative -> 0:00', () => assert.strictEqual(formatClipTime(-1), '0:00'));

// ── No-regression: sub-hour output is byte-identical to the old inline code ──
t('formatTc === oldFormatTc for every sub-hour second 0..3599', () => {
  for (let s = 0; s < 3600; s++) {
    assert.strictEqual(formatTc(s), oldFormatTc(s), `formatTc(${s})`);
  }
});
t('formatClipTime === oldFormatTime for every sub-hour second 0..3599', () => {
  for (let s = 0; s < 3600; s++) {
    assert.strictEqual(formatClipTime(s), oldFormatTime(s), `formatClipTime(${s})`);
  }
});

// ── formatDuration: hour-plus carries (the scenesPayload.durationStr fix) ──
// RED proof: the old inline form dropped the hour on a shoot-day scene.
t('RED: old durationStr drops the hour (7530 -> 125m30s)', () => {
  assert.strictEqual(oldDurationStr(7530), '125m30s');     // the bug
  assert.strictEqual(formatDuration(7530), '2h5m30s');     // the fix
});
t('formatDuration 1h exactly', () => assert.strictEqual(formatDuration(3600), '1h0m0s'));
t('formatDuration 2h5m30s', () => assert.strictEqual(formatDuration(7530), '2h5m30s'));
t('formatDuration 10h+ multi-digit hour', () => assert.strictEqual(formatDuration(36000 + 125), '10h2m5s'));
t('formatDuration just under an hour stays Xm Ys', () => assert.strictEqual(formatDuration(3599), '59m59s'));
t('formatDuration fractional floors', () => assert.strictEqual(formatDuration(7530.9), '2h5m30s'));
t('formatDuration sub-minute keeps 0m', () => assert.strictEqual(formatDuration(30), '0m30s'));

// ── formatDuration: bad input degrades (was "NaNmNaNs") ──
t('formatDuration NaN -> 0m0s', () => assert.strictEqual(formatDuration(NaN), '0m0s'));
t('formatDuration Infinity -> 0m0s', () => assert.strictEqual(formatDuration(Infinity), '0m0s'));
t('formatDuration negative -> 0m0s', () => assert.strictEqual(formatDuration(-5), '0m0s'));
t('formatDuration null -> 0m0s', () => assert.strictEqual(formatDuration(null), '0m0s'));

// ── No-regression: sub-hour output is byte-identical to the old inline code ──
t('formatDuration === oldDurationStr for every sub-hour second 0..3599', () => {
  for (let s = 0; s < 3600; s++) {
    assert.strictEqual(formatDuration(s), oldDurationStr(s), `formatDuration(${s})`);
  }
});

console.log(`\nformat-tc: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
