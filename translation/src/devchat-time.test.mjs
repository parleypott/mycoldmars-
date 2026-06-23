// Locks relAgo, the devchat thread-list "when" stamp (devchat.js:
// `${escDc(relAgo(t.updated_at))}`). The bug class: a present-but-unparseable
// updated_at makes `Date.now() - new Date(iso).getTime()` NaN, and without an
// isFinite guard every `s < N` branch is false so it falls through to the days
// branch and renders the literal "NaNd". Same present-but-bad-date class fixed
// in commentbank (relTimeAgo) / interpreter trash (relativeTimeFrom) / QSS
// library + write (relTime). This is the surviving copy.
//
// Imports the REAL shipped relAgo (no mirror). Mutation-proven: remove the
// isFinite guard from devchat-time.js and the corrupt-date cases go RED.

import { relAgo } from './devchat-time.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── Inline RED proof: reconstruct the OLD unguarded relAgo and show it renders
//    "NaNd" on a present-but-unparseable date, while the shipped relAgo doesn't.
function oldRelAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
eq(oldRelAgo('not-a-date'), 'NaNd', 'RED proof: old relAgo renders "NaNd" on a corrupt date');
eq(relAgo('not-a-date'), 'recently', 'FIX: shipped relAgo renders "recently" on a corrupt date');

// ── The fix: every present-but-unparseable shape → "recently", never "NaN…" ──
for (const bad of ['not-a-date', 'garbage', 'yesterday', '2026-13-99', 'soon', '%%%', '12345-xyz']) {
  const got = relAgo(bad);
  ok(!String(got).includes('NaN'), `corrupt "${bad}" never renders NaN (got ${JSON.stringify(got)})`);
  eq(got, 'recently', `corrupt "${bad}" → "recently"`);
}

// ── No-regression: null/empty → '' (byte-identical to the old behavior) ──
eq(relAgo(null), '', 'null → ""');
eq(relAgo(undefined), '', 'undefined → ""');
eq(relAgo(''), '', 'empty string → ""');

// ── No-regression: valid ISO timestamps → the same "Ns/Nm/Nh/Nd" as before ──
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
eq(relAgo(iso(5_000)), '5s', '5s ago → "5s"');
eq(relAgo(iso(0)), '0s', 'now → "0s"');
eq(relAgo(iso(90_000)), '2m', '90s ago → "2m" (rounded)');
eq(relAgo(iso(60_000)), '1m', '60s ago → "1m"');
eq(relAgo(iso(3_600_000)), '1h', '1h ago → "1h"');
eq(relAgo(iso(7_200_000)), '2h', '2h ago → "2h"');
eq(relAgo(iso(86_400_000)), '1d', '24h ago → "1d"');
eq(relAgo(iso(3 * 86_400_000)), '3d', '3 days ago → "3d"');

// boundary: 59s stays seconds, 3599s stays minutes, 86399s stays hours
eq(relAgo(iso(59_000)), '59s', '59s → "59s" (still seconds)');
eq(relAgo(iso(3_599_000)), '60m', '3599s → "60m" (still minutes, rounded)');

// No-regression equivalence vs the old formatter for valid inputs (the only
// behavior change is the corrupt-date case).
for (const msAgo of [0, 1_000, 45_000, 120_000, 5_400_000, 172_800_000]) {
  const t = iso(msAgo);
  eq(relAgo(t), oldRelAgo(t), `valid ${msAgo}ms ago: shipped === old formatter`);
}

console.log(`\ndevchat-time relAgo: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
