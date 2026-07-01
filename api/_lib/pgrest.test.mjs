// Tests for pgrValue() — the SHARED PostgREST filter-value injection guard.
//
// Why this is load-bearing: pgrValue() escapes any caller-supplied value that
// gets interpolated into a PostgREST filter clause (`id=eq.${pgrValue(id)}`).
// PostgREST query params are `&`-separated and `=`-keyed, so a RAW value holding
// `&` or `=` lets an attacker append EXTRA query params onto the request URL and
// broaden/rewrite the filter — e.g. `0&or=(...)` turns a single-row read into an
// OR-widened one. Three LIVE endpoints depend on this guard, and two of them —
// burma-essays.js and devchat-respond.js — are PUBLIC service-role readers whose
// service key BYPASSES RLS, so a widened filter is a real data-exposure hole, not
// cosmetic. This is exactly the class the loop already hand-fixed at those two
// endpoints; this test freezes the shared guard so it can never silently regress.
//
// Imports the REAL shipped function — no reimplementation.
import { pgrValue } from './pgrest.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── The load-bearing guarantee: param separators are neutralized ───────────
// If pgrValue ever stopped encoding, these are the two chars that let a payload
// escape the filter literal and inject additional query params.
ok(!pgrValue('0&or=(admin.eq.true)').includes('&'),
  'ampersand is neutralized (cannot append an extra query param)');
ok(!pgrValue('0&or=(admin.eq.true)').includes('='),
  'equals is neutralized (cannot start an extra key=value)');
eq(pgrValue('0&or=(admin.eq.true)'), '0%26or%3D(admin.eq.true)',
  'a real widening payload becomes one opaque, inert filter literal');
eq(pgrValue('a&b'), 'a%26b', 'bare ampersand → %26');
eq(pgrValue('k=v'), 'k%3Dv', 'bare equals → %3D');

// ── No-op for legitimate ids (real traffic is unchanged) ───────────────────
// UUIDs and integers contain only URL-unreserved chars, so escaping them is a
// no-op — the guard defangs payloads without touching honest ids.
eq(pgrValue('550e8400-e29b-41d4-a716-446655440000'),
   '550e8400-e29b-41d4-a716-446655440000',
  'a UUID passes through byte-identical');
eq(pgrValue('12345'), '12345', 'an integer id passes through byte-identical');
eq(pgrValue(12345), '12345', 'a numeric (non-string) id is coerced then passed through');
eq(pgrValue('abc_DEF-123.4~5'), 'abc_DEF-123.4~5',
  'all URL-unreserved chars (-_.~ + alnum) pass through unchanged');

// ── null / undefined collapse to empty string (never the words) ────────────
// A missing id must become '' — NOT the literal strings "null"/"undefined",
// which would themselves be interpolated into the filter as a bogus value.
eq(pgrValue(null), '', 'null → empty string');
eq(pgrValue(undefined), '', 'undefined → empty string');
eq(pgrValue(''), '', 'empty string stays empty');

// ── RED proof: the naive raw version LEAKS the separators ───────────────────
// This reconstructs "what pgrValue would be without the guard" and shows the
// payload escaping — so if someone neuters pgrValue back to a raw String(v),
// the assertions above go RED while this one documents exactly why.
const rawUnguarded = (v) => (v === null || v === undefined) ? '' : String(v);
ok(rawUnguarded('0&or=(admin.eq.true)').includes('&='.slice(0, 1)),
  'RED proof: an unguarded raw value STILL contains the & separator');
eq(rawUnguarded('0&or=(admin.eq.true)'), '0&or=(admin.eq.true)',
  'RED proof: unguarded payload stays injectable (this is what the guard prevents)');

console.log(`pgrest: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
