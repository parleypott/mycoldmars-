// nile-flights booking tracker — fmtDate Invalid-Date crash guard.
//
// THE LATENT BUG (fixed): fmtDate(dt) = `${MON[dt.getMonth()].slice(0,3)} ${dt.getDate()}`.
// On an invalid Date, dt.getMonth() is NaN, MON[NaN] is undefined, and undefined.slice(...)
// THROWS a TypeError — it doesn't just render "und NaN", it crashes. fmtDate runs INSIDE
// render()'s LEGS.forEach (line ~237: `· ${fmtDate(new Date(info.at))}` for the booked-on
// byline), so one bad date takes down the WHOLE timeline render — blank/stale tracker.
//
// REACHABLE: the booking object's `at` comes from state.bookings, which load() reads RAW from
// the synced cloud blob (`state={bookings:(j.state.bookings)||{}}`) with no per-field
// validation. A corrupt / legacy / hand-edited `at` (anything new Date() can't parse) flows
// straight into fmtDate. This is the SAME Invalid-Date class the loop closed across ~10 tools,
// and the sibling formatter fmtSyncTime in THIS file was already guarded (isFinite(getTime()))
// on 2026-06-24 — fmtDate was the unguarded twin.
//
// THE FIX: fmtDate returns "" when dt is missing or invalid (mirrors fmtSyncTime). Valid dates
// render byte-identically. This test extracts the SHIPPED MON + fmtDate from index.html and
// exercises the real function so the guard can't silently regress.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  try { assert.ok(cond, msg); pass++; }
  catch (e) { fail++; console.error('  ✗', msg, '—', e.message); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// Pull the shipped MON array and fmtDate definition straight out of index.html and build a
// live fmtDate from them — we test the real source, not a hand-copy.
function buildFmtDate(source) {
  const monMatch = source.match(/const MON=\[[^\]]*\];/);
  const fmtMatch = source.match(/const fmtDate=dt=>[^\n;]*;/);
  assert.ok(monMatch, 'MON array found in source');
  assert.ok(fmtMatch, 'fmtDate definition found in source');
  // eslint-disable-next-line no-new-func
  return new Function(`${monMatch[0]} ${fmtMatch[0]} return fmtDate;`)();
}

const fmtDate = buildFmtDate(html);

// ---- GREEN: valid dates render exactly as before ("Mon D", 3-letter month) ----
eq(fmtDate(new Date(2026, 5, 22)), 'Jun 22', 'valid June date renders "Jun 22"');
eq(fmtDate(new Date(2026, 0, 1)), 'Jan 1', 'valid Jan 1 renders "Jan 1"');
eq(fmtDate(new Date(2026, 11, 9)), 'Dec 9', 'valid December date renders "Dec 9"');
eq(fmtDate(new Date('2026-06-22T10:00:00Z')), `Jun ${new Date('2026-06-22T10:00:00Z').getDate()}`,
   'valid ISO timestamp (booking `at` shape) renders fine');

// ---- GREEN: invalid / missing dates degrade to "" instead of THROWING ----
let threw = false, out;
try { out = fmtDate(new Date('garbage')); } catch { threw = true; }
ok(!threw, 'fmtDate(invalid Date) does NOT throw');
eq(out, '', 'fmtDate(invalid Date) returns "" (was a TypeError crash)');
eq(fmtDate(new Date(NaN)), '', 'fmtDate(new Date(NaN)) returns ""');
eq(fmtDate(null), '', 'fmtDate(null) returns "" (no .getTime crash)');
eq(fmtDate(undefined), '', 'fmtDate(undefined) returns ""');

// ---- RED proof: the OLD unguarded form crashes on an invalid date ----
{
  const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const oldFmtDate = dt => `${MON[dt.getMonth()].slice(0,3)} ${dt.getDate()}`;
  let oldThrew = false;
  try { oldFmtDate(new Date('garbage')); } catch { oldThrew = true; }
  ok(oldThrew, 'RED proof: old unguarded fmtDate THROWS on an invalid date (the crash this fix removes)');
}

// ---- source contract: the shipped fmtDate actually carries an isFinite/getTime guard ----
ok(/const fmtDate=dt=>.*isFinite\(dt\.getTime\(\)\)/.test(html),
   'shipped fmtDate guards on isFinite(dt.getTime())');

if (fail) { console.error(`\nfmtdate-guard: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`fmtdate-guard: ${pass} passed, 0 failed`);
