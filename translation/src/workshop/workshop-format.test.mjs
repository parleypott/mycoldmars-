// Lock for the Soundbite Workshop pure helpers (workshop-format.js).
//
// formatTcShort is PRODUCER-FACING: it renders the timecode in the
// copy-with-timecode soundbite line ([speaker — TC] text) Johnny pastes into
// producer docs. It's a member of the hour-drop formatter class — so this
// locks that it never drops the hour on hour-plus HH:MM:SS, strips a
// leading-zero hour-less TC to M:SS, routes a plain seconds value through the
// (already-fixed) precise formatter, and preserves a producer TC.
//
// themeColor is the stable-color UX contract (same seed → same palette entry,
// reorder-invariant, always in palette). countByTheme tallies theme counts.
//
// Mutation-proven a real verifier: see the NOTE at the bottom for the source
// edits that turn this RED.

import { countByTheme, formatTcShort, themeColor, THEME_PALETTE } from './workshop-format.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`${label}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, label) { if (cond) { pass++; } else { fail++; fails.push(label); } }

// ── formatTcShort ───────────────────────────────────────────────────────────

// RED PROOF — an hour-drop regression. The class's signature failure is a
// hour-plus HH:MM:SS collapsing to MM:SS. Reconstruct a broken formatter that
// always takes the hour-less branch and prove it loses the hour, while the
// shipped function keeps it.
function brokenHourDrop(tc) {
  if (!tc) return '0:00';
  const m = String(tc).match(/(\d+):(\d+):(\d+)/);
  if (m) return `${parseInt(m[2])}:${m[3]}`; // BUG: ignores hours entirely
  return String(tc);
}
ok(brokenHourDrop('01:05:30') === '5:30', 'RED proof: broken formatter drops the hour (01:05:30 -> 5:30)');
ok(formatTcShort('01:05:30') !== '5:30', 'RED proof: shipped formatTcShort does NOT drop the hour');

// Hour-plus HH:MM:SS keeps the hour (the producer reference must not desync).
eq(formatTcShort('01:05:30'), '01:05:30', 'hour-plus HH:MM:SS keeps hour');
eq(formatTcShort('2:02:01'), '2:02:01', 'hour-plus single-digit-hour kept');
eq(formatTcShort('10:00:00'), '10:00:00', 'double-digit hour kept');

// Hour-less HH:MM:SS strips the leading 00: to M:SS (parseInt drops the
// minutes leading zero, seconds kept padded).
eq(formatTcShort('00:05:30'), '5:30', 'hour-less HH:MM:SS -> M:SS');
eq(formatTcShort('00:00:07'), '0:07', 'hour-less, sub-minute keeps padded seconds');
eq(formatTcShort('00:12:09'), '12:09', 'hour-less two-digit minutes -> 12:09');

// Plain seconds value routes through the precise formatter (hour-carry lives
// there — already locked by timecode-utils.test.mjs; here we just prove the
// routing). A number and a numeric string both take this branch.
eq(formatTcShort(3661), '1:01:01.0', 'numeric seconds -> precise formatter (hour carried)');
eq(formatTcShort('3661'), '1:01:01.0', 'numeric STRING seconds -> precise formatter');
eq(formatTcShort(83.5), '1:23.5', 'fractional numeric seconds -> precise formatter');
eq(formatTcShort('83.5'), '1:23.5', 'fractional numeric string -> precise formatter');

// MM:SS string preserved verbatim (already a short display).
eq(formatTcShort('1:23'), '1:23', 'MM:SS preserved');
eq(formatTcShort('65:30'), '65:30', 'over-60 MM:SS preserved (not this fn to carry)');

// Fractional HH:MM:SS — the fraction is dropped for the short display, hours
// honored.
eq(formatTcShort('00:01:23.456'), '1:23', 'fractional hour-less HH:MM:SS -> M:SS (frac dropped)');

// 4-part SMPTE (HH:MM:SS:FF) — first three groups win, frames dropped (a
// producer reference is HH:MM:SS, never frames). Hour still honored.
eq(formatTcShort('02:02:01:07'), '02:02:01', 'SMPTE 4-part -> HH:MM:SS (frames dropped)');
eq(formatTcShort('00:02:01:07'), '2:01', 'SMPTE hour-less -> M:SS');

// Empty / nullish -> the zero floor (never a crash, never a bare empty TC in
// the copied line).
eq(formatTcShort(0), '0:00', 'zero -> 0:00');
eq(formatTcShort(''), '0:00', 'empty string -> 0:00');
eq(formatTcShort(null), '0:00', 'null -> 0:00');
eq(formatTcShort(undefined), '0:00', 'undefined -> 0:00');

// Unparseable -> passed through as a string (never throws).
eq(formatTcShort('soon'), 'soon', 'unparseable string passed through');

// ── countByTheme ────────────────────────────────────────────────────────────

eq(countByTheme([]), {}, 'empty soundbites -> {}');
eq(
  countByTheme([
    { themes: ['power', 'fear'] },
    { themes: ['power'] },
    { themes: ['fear', 'hope'] },
  ]),
  { power: 2, fear: 2, hope: 1 },
  'tallies each theme across soundbites'
);
eq(countByTheme([{ themes: [] }, {}]), {}, 'missing/empty themes -> no counts, no throw');
eq(countByTheme([{ themes: ['x'] }, { themes: ['x'] }, { themes: ['x'] }]), { x: 3 }, 'repeated theme accumulates');

// ── themeColor (stable-color contract) ──────────────────────────────────────

// Deterministic: same seed always maps to the same color, regardless of
// surrounding order — this is the whole point (reorder must not reshuffle).
eq(themeColor('power'), themeColor('power'), 'same seed -> same color (deterministic)');
ok(THEME_PALETTE.includes(themeColor('power')), 'color is always in the palette');
ok(THEME_PALETTE.includes(themeColor('a different theme name entirely')), 'long seed still in palette');
ok(THEME_PALETTE.includes(themeColor('')), 'empty seed still yields an in-palette color (no crash)');
ok(THEME_PALETTE.includes(themeColor(null)), 'null seed -> in-palette (String(null||"") guard)');
// Different seeds generally pick different slots (not a hard guarantee, but
// these two known-distinct strings must differ to prove it isn't a constant).
ok(themeColor('power') !== themeColor('zzzzzzzz'), 'distinct seeds can produce distinct colors (not a constant)');
// Always returns a non-empty 7-char hex.
ok(/^#[0-9A-F]{6}$/i.test(themeColor('anything')), 'returns a #RRGGBB hex');

// ── report ──────────────────────────────────────────────────────────────────
console.log(`workshop-format: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }

// NOTE — mutation proof (each makes this suite RED; restore to GREEN):
//   1. formatTcShort hour-less branch on hour-plus: change `parseInt(m[1]) > 0`
//      to `false` -> the hour-keep cases fail (the hour-drop class).
//   2. themeColor: `return THEME_PALETTE[0]` (constant) -> the distinct-seeds
//      and determinism-vs-constant asserts fail.
//   3. countByTheme: `c[t] = 1` (no accumulate) -> the count asserts fail.
