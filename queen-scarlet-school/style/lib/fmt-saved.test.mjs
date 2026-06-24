// Locks fmtSaved — the "last saved <date>" chip in the QSS World Style Hub
// (/universe/<world>/style/), the page Johnny uses to edit a world's art register
// + canon. Two render sites (load path + post-save path).
//
// THE BUG (present-but-bad-date class): both sites rendered
//   `last saved ${new Date(w.updated_at).toLocaleString()}`
// with NO finiteness guard. w.updated_at is the qss_worlds row's DB-set timestamptz;
// a present-but-unparseable value (corrupt/legacy/tampered/schema-drift) makes
// new Date(x) an Invalid Date, and .toLocaleString() on an Invalid Date RETURNS the
// literal string "Invalid Date" (it never throws) -> the chip read "last saved
// Invalid Date". EXACT same useless-handling class fixed in hunter formatDate
// (25183c1) + burma-essays fmtDate (aa9aa1a) + nile-flights fmtSyncTime (aa81946).
// Latent (updated_at is a DB column), so a defensive hardening of the established
// class — but real, in a Johnny-facing QSS tool, and TWO divergent copies.
//
// THE FIX: a pure fmtSaved(iso) — nullish/empty -> 'never saved', non-finite ->
// 'never saved', else `last saved ${locale}`. Byte-identical to the old load-path
// form for every valid date + nullish (proven by a no-regression battery) -> zero
// regression; only corrupt dates change ("Invalid Date" -> 'never saved').
//
// This EXTRACTS the real shipped fmtSaved from index.html at runtime (brace match +
// new Function), so it can't drift from a mirror; mutation-proven to go RED if the
// guard is removed. Same standard as the nile-flights-core / fmt-sync-time locks.
//
// run: node queen-scarlet-school/style/lib/fmt-saved.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

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

const fmtSavedSrc = extractFn(HTML, 'fmtSaved');
// materialize the REAL shipped function (it references only its arg + globals)
const fmtSaved = new Function(`${fmtSavedSrc}; return fmtSaved;`)();

// the OLD load-path form (truthiness-guarded), reconstructed for the RED proof
function oldFmtSavedLoad(iso) {
  return iso ? `last saved ${new Date(iso).toLocaleString()}` : 'never saved';
}
// the OLD save-path form (no truthiness guard at all)
function oldFmtSavedSave(iso) {
  return `last saved ${new Date(iso).toLocaleString()}`;
}

// a guard-removed mutant of the REAL source (proves the guard has teeth)
const mutatedSrc = fmtSavedSrc.replace('isFinite(d.getTime()) ?', 'true ?');
const mutatedFmtSaved = new Function(`${mutatedSrc}; return fmtSaved;`)();

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(name, got, want) { ok(`${name} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`, got === want); }

// ---- inline RED proof: both old forms leak "Invalid Date" on a corrupt updated_at ----
ok('RED: old load form leaks "Invalid Date" on a corrupt updated_at',
  oldFmtSavedLoad('garbage') === 'last saved Invalid Date');
ok('RED: old save form leaks "Invalid Date" on a corrupt updated_at',
  oldFmtSavedSave('garbage') === 'last saved Invalid Date');
ok('RED: old save form leaks 1970 epoch on a null updated_at',
  /1970/.test(oldFmtSavedSave(null)));
ok('FIX: shipped fmtSaved -> "never saved" on a corrupt updated_at',
  fmtSaved('garbage') === 'never saved');
ok('FIX: shipped fmtSaved -> "never saved" on null (no misleading 1970)',
  fmtSaved(null) === 'never saved');

// ---- mutation proof: guard-removed mutant leaks "Invalid Date" ----
ok('MUTANT: guard-removed source leaks "Invalid Date"',
  mutatedFmtSaved('garbage') === 'last saved Invalid Date');
ok('REAL: shipped source does NOT (guard is load-bearing)',
  fmtSaved('garbage') === 'never saved');

// ---- corrupt / nullish all map to "never saved" ----
for (const bad of ['garbage', 'not-a-date', '2026-13-40', 'soon', '99:99', '']) {
  eq(`corrupt/empty "${bad}" -> "never saved"`, fmtSaved(bad), 'never saved');
}
eq('null -> "never saved"', fmtSaved(null), 'never saved');
eq('undefined -> "never saved"', fmtSaved(undefined), 'never saved');
eq('0 -> "never saved"', fmtSaved(0), 'never saved');

// ---- never leaks "Invalid Date" / "NaN" across hostile inputs ----
for (const bad of ['garbage', '', null, undefined, NaN, '13/40/2026', {}, []]) {
  const out = fmtSaved(bad);
  ok(`fmtSaved(${JSON.stringify(bad)}) never contains "Invalid Date"`, !/invalid date/i.test(out));
  ok(`fmtSaved(${JSON.stringify(bad)}) never contains "NaN"`, !/NaN/.test(out));
}

// ---- NO-REGRESSION: shipped === old LOAD form for every VALID date + nullish ----
// (the load form already had the truthiness guard, so its falsy + valid outputs are
//  the contract the fix must preserve; only the corrupt-string case changes)
const valids = [
  '2026-06-24T08:30:00Z',
  '2026-06-24 08:30',
  '2026-01-01T00:00:00Z',
  '2026-12-31T23:59:00Z',
  new Date('2026-06-20T14:05:00Z').toISOString(),
  '2026-06-24T12:00:00Z',
];
for (const v of valids) {
  eq(`no-regression: valid "${v}" === old load form`, fmtSaved(v), oldFmtSavedLoad(v));
}
// nullish matches the old load form's 'never saved' too
eq('no-regression: null === old load form', fmtSaved(null), oldFmtSavedLoad(null));
eq('no-regression: empty === old load form', fmtSaved(''), oldFmtSavedLoad(''));

// ---- a valid date produces a "last saved ..." stamp (sanity) ----
ok('a valid date yields a "last saved" stamp', fmtSaved('2026-06-24T08:30:00Z').startsWith('last saved '));

console.log(`fmt-saved.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILURES:\n' + fails.map(f => '  - ' + f).join('\n')); process.exit(1); }
