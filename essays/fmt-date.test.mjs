// essays — fmtDate() Invalid-Date guard coverage.
//
// THE BUG (fixed): the essays list row date chip rendered
//   new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', {...})
// with NO validity guard. ESSAYS (essays/index.html) is a HAND-EDITED manifest, so
// e.date can be a typo — '2026-13-45', 'July 4', '2026-7' — that makes new Date(...)
// an Invalid Date whose toLocaleDateString() returns the literal string
// "Invalid Date", which then renders verbatim in the live public essays list.
// This is the single most-repeated user-facing bug class in this loop's backlog
// (QSS/Hunter/Interpreter/Burma/nile/Westchester/Commentbank all fixed the same
// shape). The standing gate (find-unguarded-date-format.sh) DELIBERATELY skipped
// the `new Date(x + 'T...')` concatenation form, assuming x is always a machine ISO
// day key (true for the Hunter calendar) — but the essays manifest is hand-authored,
// so that assumption breaks here. Fix: degrade a bad e.date to '' (the same empty
// chip an ABSENT date already shows); byte-identical for every valid date string.
//
// This test EXTRACTS the REAL shipped fmtDate from essays/index.html at runtime
// (new Function), so it can never drift from a hand-copied mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

// Pull the exact shipped fmtDate() body out of the inline script. Non-greedy to the
// first `\n}` at column 0 — the toLocaleDateString options object stays on one line,
// so the first newline-anchored `}` is the function's own closing brace.
const m = html.match(/function fmtDate\(s\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not locate fmtDate() in essays/index.html');
const fmtDate = new Function('s', m[0].replace(/^function fmtDate\(s\)\s*\{/, '').replace(/\}\s*$/, ''));

// The OLD, unguarded formatter — for the inline RED proof.
const oldFmt = (s) => {
  if (!s) return '';
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  try { assert.equal(got, want, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};

// ── absent value → '' (byte-identical, both forms) ──
eq(fmtDate(''), '', "empty string → ''");
eq(fmtDate(null), '', "null → ''");
eq(fmtDate(undefined), '', "undefined → ''");

// ── the bug: hand-edited typos must NOT render "Invalid Date" ──
for (const bad of ['2026-13-45', 'July 4', '2026-7', 'notadate', '2026/07/04-bad']) {
  eq(fmtDate(bad), '', `bad hand-edited date ${JSON.stringify(bad)} → '' (never "Invalid Date")`);
  // RED proof: the OLD unguarded form leaks the literal "Invalid Date" on the same input.
  ok(/Invalid Date/.test(oldFmt(bad)), `  (mutation) old unguarded form leaks "Invalid Date" on ${JSON.stringify(bad)}`);
}

// ── valid ISO days: real, non-empty, no "Invalid" leak, and IDENTICAL to old form ──
for (const good of ['2026-07-04', '2025-01-01', '2026-12-31']) {
  const out = fmtDate(good);
  ok(out !== '' && !/Invalid/.test(out), `valid ${good} → real label (${JSON.stringify(out)})`);
  eq(out, oldFmt(good), `valid ${good}: guarded output byte-identical to old form`);
}

console.log(`fmt-date: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
