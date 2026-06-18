// Tests for translation/src/format-clock.js — the shared clock formatter behind
// the Interpreter's player playhead/duration label (media-deck.js) and the
// soundbite-sequence total (main.js formatDuration).
//
// The bug: two inline MM:SS formatters BOTH dropped the hour, so an hour-plus
// playhead on Johnny's hour-long interview footage showed "75:30" instead of
// "1:15:30". formatClock carries the hour. Sub-hour output must stay
// byte-identical to the old inline code (non-negative finite) so the
// consolidation is zero-regression on the common short clip.

import { formatClock } from './format-clock.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// The two old inline formatters, reconstructed verbatim for RED proofs + the
// no-regression lock. media-deck.js fmt and main.js formatDuration tail were
// identical in shape: m = floor(secs/60), s = floor(secs%60), `${m}:${pad2(s)}`.
const oldInlineFmt = (secs) => {
  if (!isFinite(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ── RED proof: the old inline formatter dropped the hour ────────────────────
eq(oldInlineFmt(4530), '75:30', 'RED proof: old inline drops the hour (1h15m30s -> 75:30)');
eq(oldInlineFmt(3661), '61:01', 'RED proof: old inline drops the hour (1h01m01s -> 61:01)');
// formatClock carries it
eq(formatClock(4530), '1:15:30', 'fix: 1h15m30s playhead -> 1:15:30');
eq(formatClock(3661), '1:01:01', 'fix: 1h01m01s -> 1:01:01');
eq(formatClock(5535), '1:32:15', 'fix: 1h32m15s -> 1:32:15');

// ── Hour boundary + multi-hour ──────────────────────────────────────────────
eq(formatClock(3599), '59:59', 'one second under an hour stays M:SS');
eq(formatClock(3600), '1:00:00', 'exactly one hour carries');
eq(formatClock(7200), '2:00:00', 'two hours');
eq(formatClock(7325), '2:02:05', '2h02m05s');
eq(formatClock(36000), '10:00:00', 'ten hours (minutes zero-padded under hour)');
eq(formatClock(3725), '1:02:05', 'minutes zero-padded when an hour is present (1:02:05 not 1:2:5)');

// ── Seconds always 2-padded; minutes unpadded when no hour ──────────────────
eq(formatClock(5), '0:05', 'seconds zero-padded');
eq(formatClock(65), '1:05', 'one minute five seconds');
eq(formatClock(600), '10:00', 'ten minutes, minutes NOT padded when no hour');
eq(formatClock(0), '0:00', 'zero');

// ── Fractional seconds floored (matches old behavior) ───────────────────────
eq(formatClock(45.7), '0:45', 'fractional second floored');
eq(formatClock(119.99), '1:59', 'just under two minutes floored');
eq(formatClock(3600.9), '1:00:00', 'fractional just past an hour floored');

// ── Non-finite / defensive ──────────────────────────────────────────────────
eq(formatClock(NaN), '0:00', 'NaN -> 0:00 (matches old media-deck guard)');
eq(formatClock(Infinity), '0:00', 'Infinity -> 0:00 (media duration unknown)');
eq(formatClock(-Infinity), '0:00', '-Infinity -> 0:00');
eq(formatClock(-5), '0:00', 'negative clamped to 0:00 (impossible input, defensive)');

// ── NO-REGRESSION LOCK: byte-identical to the old inline code for every ─────
// non-negative finite sub-hour value (the common short-clip case). This is
// what proves the consolidation changed nothing except the hour-plus path.
for (let secs = 0; secs < 3600; secs += 0.5) {
  eq(formatClock(secs), oldInlineFmt(secs), `sub-hour byte-identical to old inline at ${secs}s`);
}

console.log(`\nformat-clock: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
