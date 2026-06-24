// Locks fmtSyncTime — the sync-footer "last update <date>" stamp in nile-flights,
// Johnny's ACTIVE Ethiopia/Nile-trip itinerary (live, in daily use).
//
// THE BUG (present-but-bad-date class): setSynced rendered
//   updatedAt ? new Date(updatedAt).toLocaleString(...) : ""
// with NO finiteness guard. updatedAt is the server state-sync row's updated_at; a
// present-but-unparseable value (corrupt/legacy/tampered/schema-drift) makes
// new Date(x) an Invalid Date, and .toLocaleString() on an Invalid Date RETURNS the
// literal string "Invalid Date" (it never throws) -> the footer read "last update
// Invalid Date". EXACT same useless-handling class fixed in hunter formatDate
// (25183c1) + burma-essays fmtDate (aa9aa1a). Latent (updated_at is a DB column),
// so a defensive hardening of the established class — but real, in the active-trip tool.
//
// THE FIX: a pure fmtSyncTime(updatedAt) — nullish/empty -> "", non-finite -> "",
// else the same locale string. Byte-identical for every valid/nullish input
// (proven by a no-regression battery) -> zero regression; only corrupt dates change.
//
// This EXTRACTS the real shipped fmtSyncTime from index.html at runtime (brace match
// + new Function), so it can't drift from a mirror; mutation-proven to go RED if the
// guard is removed. Same standard as the nile-flights-core / westchester-geo locks.
//
// run: node public/nile-flights/fmt-sync-time.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

const fmtSyncSrc = extractFn(HTML, 'fmtSyncTime');
// materialize the REAL shipped function (it references only its arg + globals)
const fmtSyncTime = new Function(`${fmtSyncSrc}; return fmtSyncTime;`)();

// the OLD unguarded form, reconstructed for the RED proof
function oldFmtSyncTime(updatedAt) {
  return updatedAt ? new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

// a guard-removed mutant of the REAL source (proves the guard has teeth)
const mutatedSrc = fmtSyncSrc.replace('isFinite(d.getTime()) ?', 'true ?');
const mutatedFmtSyncTime = new Function(`${mutatedSrc}; return fmtSyncTime;`)();

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(name, got, want) { ok(`${name} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`, got === want); }

// ---- inline RED proof: old code leaks "Invalid Date" / "" guard required ----
ok('RED: old form leaks "Invalid Date" on a corrupt updatedAt',
  oldFmtSyncTime('garbage') === 'Invalid Date');
ok('RED: old form leaks "Invalid Date" on a malformed timestamp',
  oldFmtSyncTime('2026-13-99T99:99') === 'Invalid Date');
ok('FIX: shipped fmtSyncTime returns "" on a corrupt updatedAt',
  fmtSyncTime('garbage') === '');
ok('FIX: shipped fmtSyncTime returns "" on a malformed timestamp',
  fmtSyncTime('2026-13-99T99:99') === '');

// ---- mutation proof: guard-removed mutant leaks "Invalid Date" ----
ok('MUTANT: guard-removed source leaks "Invalid Date"',
  mutatedFmtSyncTime('garbage') === 'Invalid Date');
ok('REAL: shipped source does NOT (guard is load-bearing)',
  fmtSyncTime('garbage') === '');

// ---- corrupt / nullish all map to "" ----
for (const bad of ['garbage', 'not-a-date', '2026-13-40', 'soon', '99:99', '']) {
  eq(`corrupt/empty "${bad}" -> ""`, fmtSyncTime(bad), '');
}
eq('null -> ""', fmtSyncTime(null), '');
eq('undefined -> ""', fmtSyncTime(undefined), '');
eq('0 -> ""', fmtSyncTime(0), '');

// ---- never leaks "Invalid Date" / "NaN" across hostile inputs ----
for (const bad of ['garbage', '', null, undefined, NaN, '13/40/2026', {}, []]) {
  const out = fmtSyncTime(bad);
  ok(`fmtSyncTime(${JSON.stringify(bad)}) never contains "Invalid Date"`, !/invalid date/i.test(out));
  ok(`fmtSyncTime(${JSON.stringify(bad)}) never contains "NaN"`, !/NaN/.test(out));
}

// ---- NO-REGRESSION: shipped === old form byte-for-byte for every VALID date ----
const valids = [
  '2026-06-24T08:30:00Z',
  '2026-06-24 08:30',
  '2026-01-01T00:00:00Z',
  '2026-12-31T23:59:00Z',
  new Date('2026-06-20T14:05:00Z').toISOString(),
  '2026-06-24T12:00:00Z',
];
for (const v of valids) {
  eq(`no-regression: valid "${v}" === old form`, fmtSyncTime(v), oldFmtSyncTime(v));
}
// and a valid date produces a non-empty stamp (sanity)
ok('a valid date yields a non-empty stamp', fmtSyncTime('2026-06-24T08:30:00Z').length > 0);

console.log(`fmt-sync-time.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:\n' + fails.map(f => '  - ' + f).join('\n')); process.exit(1); }
