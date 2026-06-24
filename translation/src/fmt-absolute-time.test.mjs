// Mutation-proven lock for fmtAbsoluteTime — the guarded absolute-time stamp the
// interpreter renders in its conflict/recovery surfaces (snapshot-restore modal,
// remote-change banner, lock-conflict modal, unsaved-work recovery overlay, and
// the admin user list). Imports the REAL shipped function.
//
// The class: each site was truthiness-guarded (`value ? new Date(value)
// .toLocale*() : fallback`) but NOT finite-guarded, and .toLocaleString() /
// .toLocaleTimeString() / .toLocaleDateString() on an Invalid Date RETURN the
// literal string "Invalid Date" (they never throw) — so a present-but-
// unparseable timestamp rendered "Invalid Date" in exactly the moments
// (a recovery prompt) where a confusing stamp matters most. Same present-but-
// bad-date class fixed across hunter / burma-essays / nile-flights / qss-style /
// westchester this week. fmtAbsoluteTime guards it; for any VALID date it is
// byte-identical to the old inline code, so only a corrupt/absent value changes.
//
// Run: bun translation/src/fmt-absolute-time.test.mjs
import { fmtAbsoluteTime } from './library-time.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// The three old inline forms, reconstructed verbatim from main.js's pre-fix sites.
const oldDateTime = (v, fb) => (v ? new Date(v).toLocaleString() : fb);
const oldTime     = (v, fb) => (v ? new Date(v).toLocaleTimeString() : fb);
const oldDate     = (v, fb) => (v ? new Date(v).toLocaleDateString() : fb);

// ── Inline RED proofs: the OLD inline forms leak "Invalid Date" on a bad date ──
ok(oldDateTime('not-a-date', 'unknown') === 'Invalid Date',
  'RED PROOF: old toLocaleString form leaks "Invalid Date" on garbage');
ok(fmtAbsoluteTime('not-a-date', 'unknown') === 'unknown',
  'FIX: fmtAbsoluteTime returns the fallback instead of "Invalid Date"');

ok(oldTime('2026-13-99', 'recently') === 'Invalid Date',
  'RED PROOF: old toLocaleTimeString form leaks "Invalid Date" on a bad ISO');
ok(fmtAbsoluteTime('2026-13-99', 'recently', { time: true }) === 'recently',
  'FIX: time-mode returns the fallback');

ok(oldDate('garbage', 'never') === 'Invalid Date',
  'RED PROOF: old toLocaleDateString form leaks "Invalid Date" on garbage');
ok(fmtAbsoluteTime('garbage', 'never', { date: true }) === 'never',
  'FIX: date-mode returns the fallback');

// ── Every corrupt / falsy shape -> fallback (all three modes) ──
const badInputs = ['not-a-date', 'garbage', '2026-13-99', '99:99', 'soon', '', null, undefined, 0, {}, []];
for (const v of badInputs) {
  eq(fmtAbsoluteTime(v, 'FB'), 'FB', `datetime: ${JSON.stringify(v)} -> fallback`);
  eq(fmtAbsoluteTime(v, 'FB', { time: true }), 'FB', `time: ${JSON.stringify(v)} -> fallback`);
  eq(fmtAbsoluteTime(v, 'FB', { date: true }), 'FB', `date: ${JSON.stringify(v)} -> fallback`);
}

// ── Invariant: the output NEVER contains "Invalid Date" or "NaN" ──
const hostile = [...badInputs, '0', 'null', true, false, NaN, Infinity, '2026/24/12', '   '];
for (const v of hostile) {
  for (const opts of [undefined, { time: true }, { date: true }]) {
    const out = fmtAbsoluteTime(v, '—', opts);
    ok(!String(out).includes('Invalid Date'), `no "Invalid Date" for ${JSON.stringify(v)} / ${JSON.stringify(opts)}`);
    ok(!String(out).includes('NaN'), `no "NaN" for ${JSON.stringify(v)} / ${JSON.stringify(opts)}`);
  }
}

// ── Default fallback is '' (no fallback arg, matching the `: ''` sites) ──
eq(fmtAbsoluteTime('garbage'), '', 'no fallback arg + bad date -> empty string');
eq(fmtAbsoluteTime(null), '', 'no fallback arg + null -> empty string');

// ── NO-REGRESSION: fmtAbsoluteTime === the old inline form for every VALID date ──
// (computed in-process, so the locale output is exact and deterministic here).
const validDates = [
  '2026-06-24T03:57:00Z',
  '2026-01-01T00:00:00Z',
  '2026-12-31T23:59:59Z',
  '2020-02-29T12:00:00Z',   // leap day
  '2026-06-23',             // bare YYYY-MM-DD
  1750000000000,            // numeric epoch ms
];
for (const v of validDates) {
  eq(fmtAbsoluteTime(v, 'FB'), oldDateTime(v, 'FB'), `datetime equivalence: ${JSON.stringify(v)}`);
  eq(fmtAbsoluteTime(v, 'FB', { time: true }), oldTime(v, 'FB'), `time equivalence: ${JSON.stringify(v)}`);
  eq(fmtAbsoluteTime(v, 'FB', { date: true }), oldDate(v, 'FB'), `date equivalence: ${JSON.stringify(v)}`);
  // And each renders a real, non-empty, non-fallback stamp.
  ok(fmtAbsoluteTime(v) !== '' && fmtAbsoluteTime(v) !== 'FB', `valid date renders a real stamp: ${JSON.stringify(v)}`);
}

// ── The mode switch actually selects a different formatter for a valid date ──
{
  const v = '2026-06-24T15:30:00Z';
  eq(fmtAbsoluteTime(v, '', { date: true }), new Date(v).toLocaleDateString(), 'date mode -> toLocaleDateString');
  eq(fmtAbsoluteTime(v, '', { time: true }), new Date(v).toLocaleTimeString(), 'time mode -> toLocaleTimeString');
  eq(fmtAbsoluteTime(v, ''), new Date(v).toLocaleString(), 'default mode -> toLocaleString');
}

console.log(`\nfmt-absolute-time: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
