// Locks fmtWhenLabel — the guarded date-label helper behind the Westchester
// scenario dropdown ("name · 6/24/2026") and the daily-watch "Last run" stamp.
// A present-but-unparseable timestamp makes new Date(x).toLocale*String() RETURN
// the literal string "Invalid Date" (it never throws), so the old bare inline forms
// leaked "Invalid Date" / "Last run: Invalid Date" into Johnny's active-hunt UI.
// EXTRACTS the real shipped fmtWhenLabel from index.html at runtime (can't drift).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'westchester', 'index.html'),
  'utf8'
);

// Pull the function body out of the shipped HTML by brace-matching from its signature.
function extractFn(name) {
  const sig = `function ${name}(`;
  const start = HTML.indexOf(sig);
  if (start === -1) throw new Error(`${name} not found in index.html`);
  const open = HTML.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

const fmtSrc = extractFn('fmtWhenLabel');
// eslint-disable-next-line no-new-func
const fmtWhenLabel = new Function(`${fmtSrc}; return fmtWhenLabel;`)();

// The OLD inline forms, reconstructed for the RED proof.
const oldScenario = (savedAt) => new Date(savedAt).toLocaleDateString();
const oldLastRun = (lastRun) => (lastRun ? new Date(lastRun).toLocaleString() : 'never');

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

const VALID = '2026-06-24T15:00:00Z';
const corruptCases = ['garbage', 'not-a-date', '2026-13-40', '99:99', 'soon', 'Invalid Date'];

// --- inline RED proof: the old forms leak "Invalid Date" on a corrupt timestamp ---
eq(oldScenario('garbage'), 'Invalid Date', 'RED proof: old scenario form leaks "Invalid Date"');
eq(oldLastRun('garbage'), 'Invalid Date', 'RED proof: old lastRun form leaks "Invalid Date"');
ok(fmtWhenLabel('garbage', '', false) === '', 'shipped fmtWhenLabel defuses corrupt scenario date');
ok(fmtWhenLabel('garbage', 'never', true) === 'never', 'shipped fmtWhenLabel defuses corrupt lastRun date');

// --- THE FIX: every corrupt shape -> fallback, never "Invalid Date"/"NaN" ---
for (const c of corruptCases) {
  eq(fmtWhenLabel(c, '', false), '', `corrupt scenario "${c}" -> ''`);
  eq(fmtWhenLabel(c, 'never', true), 'never', `corrupt lastRun "${c}" -> 'never'`);
}
// no-Invalid-Date / no-NaN invariant across hostile inputs (incl. objects/arrays)
for (const c of [...corruptCases, {}, [], 'NaN', '']) {
  const a = String(fmtWhenLabel(c, '', false));
  const b = String(fmtWhenLabel(c, 'never', true));
  ok(!a.includes('Invalid Date') && !a.includes('NaN'), `scenario "${JSON.stringify(c)}" never leaks Invalid Date/NaN`);
  ok(!b.includes('Invalid Date') && !b.includes('NaN'), `lastRun "${JSON.stringify(c)}" never leaks Invalid Date/NaN`);
}

// --- nullish/falsy -> fallback ---
for (const n of [null, undefined, '', 0]) {
  eq(fmtWhenLabel(n, '', false), '', `nullish scenario ${JSON.stringify(n)} -> ''`);
  eq(fmtWhenLabel(n, 'never', true), 'never', `nullish lastRun ${JSON.stringify(n)} -> 'never'`);
}

// --- NO-REGRESSION: for every VALID date, fmtWhenLabel === the old forms byte-for-byte ---
const validDates = [
  VALID,
  '2026-01-01T00:00:00Z',
  '2026-12-31T23:59:59Z',
  '2025-03-15T08:30:00Z',
  1700000000000, // epoch-ms number
  '2024-07-04T12:00:00-04:00',
];
for (const v of validDates) {
  eq(fmtWhenLabel(v, '', false), oldScenario(v), `no-regression scenario: ${JSON.stringify(v)} === old form`);
  eq(fmtWhenLabel(v, 'never', true), oldLastRun(v), `no-regression lastRun: ${JSON.stringify(v)} === old form`);
}
// a valid date is non-empty and carries no failure marker
ok(fmtWhenLabel(VALID, '', false).length > 0 && !fmtWhenLabel(VALID, '', false).includes('Invalid'), 'valid scenario date renders a real label');

// --- the withTime switch: lastRun carries time, scenario does not (same valid input) ---
ok(fmtWhenLabel(VALID, '', true) !== fmtWhenLabel(VALID, '', false), 'withTime=true differs from withTime=false on a valid date');

console.log(`\nwestchester-when-label: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
