// Mutation-proven lock for The Hunter's two date/time display formatters.
//
// Reproduces RED first: the OLD inline copies leaked the present-but-bad-date
// class to the UI —
//   formatTimeAgo(new Date('garbage')) -> "NaNd ago"
//   formatDate('garbage')              -> "INVALID DATE"  (its try/catch was
//     useless: .toLocaleDateString() on an Invalid Date RETURNS the string
//     "Invalid Date", it never throws).
// Both now degrade an un-orderable date to '—' (the call sites already use '—'
// for an ABSENT timestamp). Byte-identical for every valid date.
//
// Same class fixed across interpreter library/trash, commentbank, QSS
// library/write, devchat — these were the surviving copies in hunter/src.
// Imports the REAL shipped functions — no mirror, can't drift.

import { formatTimeAgo, formatDate, fmtLocaleDate } from './time-format.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`✗ ${msg}\n    got:  ${g}\n    want: ${w}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };

// ── INLINE RED PROOFS: reconstruct the OLD inline forms ───────────────────────
function oldFormatTimeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function oldFormatDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch { return '—'; }
}

eq(oldFormatTimeAgo(new Date('garbage')), 'NaNd ago', 'RED: old formatTimeAgo leaks "NaNd ago"');
eq(formatTimeAgo(new Date('garbage')), '—', 'fixed formatTimeAgo defuses the bad date');
eq(oldFormatDate('garbage'), 'INVALID DATE', 'RED: old formatDate leaks "INVALID DATE" (try/catch useless)');
eq(formatDate('garbage'), '—', 'fixed formatDate defuses the bad date');

// ── formatTimeAgo: the fix ────────────────────────────────────────────────────
eq(formatTimeAgo(new Date('garbage')), '—', 'formatTimeAgo: Invalid Date -> —');
eq(formatTimeAgo(new Date('not-a-date')), '—', 'formatTimeAgo: unparseable -> —');
eq(formatTimeAgo(new Date(NaN)), '—', 'formatTimeAgo: NaN date -> —');

// defensive against non-Date args
eq(formatTimeAgo(null), '—', 'formatTimeAgo: null -> —');
eq(formatTimeAgo(undefined), '—', 'formatTimeAgo: undefined -> —');
eq(formatTimeAgo({}), '—', 'formatTimeAgo: plain object -> —');
eq(formatTimeAgo('2026-06-23'), '—', 'formatTimeAgo: string (not a Date) -> —');

// never renders the literal "NaN"
for (const bad of [new Date('x'), new Date(NaN), null, undefined, {}, 'str', 42]) {
  ok(!formatTimeAgo(bad).includes('NaN'), `formatTimeAgo: no "NaN" for ${JSON.stringify(String(bad))}`);
}

// no-regression: valid dates byte-identical to the OLD formatter
{
  const now = Date.now();
  for (const ageMs of [0, 30_000, 59_000, 60_000, 90_000, 3_599_000, 3_600_000,
                       7_200_000, 86_399_000, 86_400_000, 200_000_000, 5_000_000_000]) {
    const d = new Date(now - ageMs);
    eq(formatTimeAgo(d), oldFormatTimeAgo(d), `formatTimeAgo: age ${ageMs}ms === old`);
  }
}

// band boundaries
{
  const now = Date.now();
  eq(formatTimeAgo(new Date(now - 5_000)), 'just now', 'formatTimeAgo: 5s -> just now');
  eq(formatTimeAgo(new Date(now - 59_000)), 'just now', 'formatTimeAgo: 59s -> just now');
  eq(formatTimeAgo(new Date(now - 60_000)), '1m ago', 'formatTimeAgo: 60s -> 1m ago');
  eq(formatTimeAgo(new Date(now - 3_540_000)), '59m ago', 'formatTimeAgo: 59m');
  eq(formatTimeAgo(new Date(now - 3_600_000)), '1h ago', 'formatTimeAgo: 1h');
  eq(formatTimeAgo(new Date(now - 86_400_000)), '1d ago', 'formatTimeAgo: 1d');
  eq(formatTimeAgo(new Date(now - 3 * 86_400_000)), '3d ago', 'formatTimeAgo: 3d');
}

// epoch is a finite valid date — only NaN is guarded (call sites gate on falsy)
ok(!formatTimeAgo(new Date(0)).includes('NaN'), 'formatTimeAgo: epoch is finite, no NaN');
ok(formatTimeAgo(new Date(0)) !== '—', 'formatTimeAgo: epoch not swallowed to —');

// ── formatDate: the fix ───────────────────────────────────────────────────────
eq(formatDate('garbage'), '—', 'formatDate: unparseable -> —');
eq(formatDate('not-a-date'), '—', 'formatDate: bad string -> —');
eq(formatDate(undefined), '—', 'formatDate: undefined -> —');
eq(formatDate(null), '—', 'formatDate: null -> —');
eq(formatDate(''), '—', 'formatDate: empty -> —');

for (const bad of ['garbage', '', undefined, null, 'xx-yy-zz', {}]) {
  ok(!formatDate(bad).includes('INVALID'), `formatDate: no "INVALID" for ${JSON.stringify(String(bad))}`);
}

// no-regression: valid ISO strings byte-identical to the OLD formatter
for (const iso of ['2026-06-23T12:00:00Z', '2026-01-01T00:00:00Z',
                   '2025-12-31T23:59:59Z', '2026-07-04T18:30:00Z',
                   '2026-02-28T06:00:00Z']) {
  eq(formatDate(iso), oldFormatDate(iso), `formatDate: ${iso} === old`);
}

// known outputs
eq(formatDate('2026-06-23T12:00:00Z'), 'JUN 23', 'formatDate: JUN 23');
eq(formatDate('2026-01-01T12:00:00Z'), 'JAN 1', 'formatDate: JAN 1');

// ── fmtLocaleDate: the project-list / snapshot / learned-context / taste-context
//    rows used a BARE new Date(x).toLocaleDateString() — three with NO guard, so
//    a missing created_at leaked "Invalid Date" (undefined) or "1/1/1970" (null).
// RED PROOF: reconstruct the OLD bare inline form.
function oldBareLocaleDate(isoStr) {
  return new Date(isoStr).toLocaleDateString();
}
eq(oldBareLocaleDate(undefined), 'Invalid Date', 'RED: old bare form leaks "Invalid Date" (undefined)');
eq(oldBareLocaleDate('garbage'), 'Invalid Date', 'RED: old bare form leaks "Invalid Date" (garbage)');
eq(fmtLocaleDate(undefined), '', 'fixed fmtLocaleDate defuses undefined -> ""');
eq(fmtLocaleDate('garbage'), '', 'fixed fmtLocaleDate defuses garbage -> ""');

// the null -> misleading 1970 epoch the old form rendered
ok(oldBareLocaleDate(null).includes('1970'), 'RED: old bare form renders 1970 on null');
eq(fmtLocaleDate(null), '', 'fmtLocaleDate: null -> "" (no misleading 1970)');

// every corrupt/absent shape -> fallback, never "Invalid Date"/"NaN"/"1970"
for (const bad of ['garbage', 'not-a-date', '99:99', '2026-13-40', '', undefined, null, {}, []]) {
  const out = fmtLocaleDate(bad);
  eq(out, '', `fmtLocaleDate: ${JSON.stringify(String(bad))} -> ""`);
  ok(!out.includes('Invalid') && !out.includes('NaN') && !out.includes('1970'),
     `fmtLocaleDate: no Invalid/NaN/1970 for ${JSON.stringify(String(bad))}`);
}

// custom fallback honored (e.g. a '—' caller)
eq(fmtLocaleDate('garbage', '—'), '—', 'fmtLocaleDate: custom fallback on bad date');
eq(fmtLocaleDate(null, '—'), '—', 'fmtLocaleDate: custom fallback on null');

// NO-REGRESSION: valid ISO strings byte-identical to the OLD bare form
for (const iso of ['2026-06-23T12:00:00Z', '2026-01-01T00:00:00Z',
                   '2025-12-31T23:59:59Z', '2026-07-04T18:30:00Z',
                   '2024-02-29T06:00:00Z', '2026-06-23']) {
  eq(fmtLocaleDate(iso), oldBareLocaleDate(iso), `fmtLocaleDate: ${iso} === old bare form`);
}
// a valid date renders a real, non-empty stamp
ok(fmtLocaleDate('2026-06-23T12:00:00Z').length > 0, 'fmtLocaleDate: valid date is non-empty');

console.log(`time-format: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
