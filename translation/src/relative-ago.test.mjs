// Tests for translation/src/relative-ago.js — the Interpreter's save-status pill
// formatter ("Saved 3 min ago"), pulled out of main.js for coverage.
//
// THE BUG: the inline main.js copy derived each unit with Math.round, so the
// label read AHEAD of reality by up to nearly a whole unit — 90s → "2 min ago",
// 90m → "2h ago", 36h → "2d ago". The correct convention for an elapsed "N ago"
// label is FLOOR (matching library-time.js relativeTimeFrom, which floors every
// unit). This locks floor and NaN-safety; the reconstructed round copy below
// proves the exact inputs the bug over-reported.

import { relativeAgo } from './relative-ago.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

// The old inline round-based copy, reconstructed verbatim, for RED proofs.
const oldRound = (ms) => {
  const sec = Math.round(ms / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
};

// ── RED proofs: the old round copy over-reported these exact inputs ──────────
eq(oldRound(90 * S), '2 min ago', 'RED proof: round renders 90s as "2 min ago"');
eq(oldRound(90 * M), '2h ago', 'RED proof: round renders 90m as "2h ago"');
eq(oldRound(36 * H), '2d ago', 'RED proof: round renders 36h as "2d ago"');

// ── just-now / seconds band ─────────────────────────────────────────────────
eq(relativeAgo(0), 'just now', '0ms is just now');
eq(relativeAgo(4 * S), 'just now', '4s is just now');
eq(relativeAgo(4999), 'just now', '4.999s is just now');
eq(relativeAgo(5 * S), '5s ago', '5s');
eq(relativeAgo(59 * S), '59s ago', '59s');

// ── minutes band ────────────────────────────────────────────────────────────
eq(relativeAgo(60 * S), '1 min ago', '60s -> 1 min');
eq(relativeAgo(59 * M + 59 * S), '59 min ago', '59m59s -> 59 min');

// ── LOAD-BEARING mutation locks: FLOOR, not round ───────────────────────────
eq(relativeAgo(90 * S), '1 min ago', '90s is "1 min ago", NOT "2 min ago"');
eq(relativeAgo(90 * M), '1h ago', '90m is "1h ago", NOT "2h ago"');
eq(relativeAgo(36 * H), '1d ago', '36h is "1d ago", NOT "2d ago"');

// ── hours / days bands ──────────────────────────────────────────────────────
eq(relativeAgo(60 * M), '1h ago', '60m -> 1h');
eq(relativeAgo(23 * H + 59 * M), '23h ago', '23h59m -> 23h');
eq(relativeAgo(24 * H), '1d ago', '24h -> 1d');
eq(relativeAgo(9 * D), '9d ago', '9d');

// ── NaN-safety: corrupt clock value degrades to just now, never "NaNd ago" ──
eq(relativeAgo(NaN), 'just now', 'NaN -> just now');
eq(relativeAgo(undefined), 'just now', 'undefined -> just now');
eq(relativeAgo('nonsense'), 'just now', 'non-numeric string -> just now');

console.log(`relative-ago.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
