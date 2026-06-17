// Tests for parseListingFilename() in public/westchester/index.html — the import
// front door that turns a saved-listing filename into { street, city, state, zip }
// before geocoding. Extracts the ACTUAL shipped function from index.html at runtime
// (strongest signal — can't drift from a hand-copied mirror), then proves two real
// bugs are fixed:
//   BUG-1  OneKey/HGMLS MLS numbers start with a letter ("H6285012"); the digits-only
//          strip missed them and leaked the whole tag into the city.
//   BUG-2  A spelled-out state ("New York") leaked into the city because only the
//          2-letter patterns set state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function extractFn() {
  const m = HTML.match(/function parseListingFilename\(name\) \{[\s\S]*?\n\}\n/);
  if (!m) throw new Error('could not locate parseListingFilename in index.html');
  return m[0];
}
const parseListingFilename = new Function(extractFn() + '\nreturn parseListingFilename;')();

// The OLD (buggy) implementation, for the RED proof — digits-only MLS strip, no
// spelled-out-state handling. Mirrors the pre-fix source.
const parseListingFilenameOLD = (function () {
  return function parseListingFilename(name) {
    if (!name) return null;
    let s = String(name).trim();
    s = s.replace(/\s*[_|]\s*MLS\s*#?\s*\d+\s*$/i, '').trim();
    let trailingZip = null;
    const zipM = s.match(/(?:,\s*|\s+)(\d{5})\s*$/);
    if (zipM) { trailingZip = zipM[1]; s = s.slice(0, zipM.index).replace(/,\s*$/, '').trim(); }
    const clean = (v) => String(v || '').replace(/[\s,]+$/, '').trim();
    const titleCase = (v) => clean(v).split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
    const STREET_SUFFIX = '(?:road|rd|lane|ln|court|ct|circle|cir|way|place|pl|avenue|ave|drive|dr|blvd|boulevard|street|st|terrace|trail|loop|highway|hwy|run|row|crossing|crossroad)';
    const suffixRe = new RegExp('^(.+?\\s+' + STREET_SUFFIX + ')\\.?\\s+(.+?)(?:\\s+([A-Za-z]{2}))?\\s*$', 'i');
    let m = s.match(/^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})\s*$/);
    if (m) return { street: clean(m[1]), city: titleCase(m[2]), state: m[3].toUpperCase(), zip: trailingZip };
    m = s.match(/^(.+?),\s*([^,]+?)\s+([A-Za-z]{2})\s*$/);
    if (m) return { street: clean(m[1]), city: titleCase(m[2]), state: m[3].toUpperCase(), zip: trailingZip };
    m = s.match(suffixRe);
    if (m && m[3]) return { street: clean(m[1]), city: titleCase(m[2]), state: m[3].toUpperCase(), zip: trailingZip };
    if (m && !m[3]) return { street: clean(m[1]), city: titleCase(m[2]), state: 'NY', zip: trailingZip };
    m = s.match(/^(.+?)\s+([A-Za-z]{2})\s*$/);
    if (m) {
      const parts = clean(m[1]).split(/\s+/);
      if (parts.length >= 3) {
        const street = parts.slice(0, -1).join(' ');
        const city = parts.slice(-1).join(' ');
        return { street, city: titleCase(city), state: m[2].toUpperCase(), zip: trailingZip };
      }
    }
    m = s.match(/^(.+?),\s*(.+?)\s*$/);
    if (m) return { street: clean(m[1]), city: titleCase(m[2]), state: 'NY', zip: trailingZip };
    return null;
  };
})();

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`); }
}
function ok(cond, label) { if (cond) pass++; else { fail++; console.error(`  ✗ ${label}`); } }

// ---- BUG-1: HGMLS / OneKey letter-prefixed MLS numbers ----
eq(parseListingFilename('123 Main St, Bedford, NY | MLS #H6285012'),
   { street: '123 Main St', city: 'Bedford', state: 'NY', zip: null }, 'BUG-1 piped HGMLS id');
eq(parseListingFilename('123 Main St, Bedford, NY_MLS#H6285012'),
   { street: '123 Main St', city: 'Bedford', state: 'NY', zip: null }, 'BUG-1 underscore HGMLS id');
eq(parseListingFilename('9 Lake St, Katonah, NY 10536 | MLS #H123456'),
   { street: '9 Lake St', city: 'Katonah', state: 'NY', zip: '10536' }, 'BUG-1 HGMLS id + zip kept');
eq(parseListingFilename('9 Lake St, Katonah, NY | MLS# 6285012'),
   { street: '9 Lake St', city: 'Katonah', state: 'NY', zip: null }, 'BUG-1 digits-only MLS still strips (regression)');

// ---- BUG-2: spelled-out state name ----
eq(parseListingFilename('8 Maple Avenue, Pleasantville, New York'),
   { street: '8 Maple Avenue', city: 'Pleasantville', state: 'NY', zip: null }, 'BUG-2 full state, two commas');
eq(parseListingFilename('8 Maple Ave, Rye, New York 10580'),
   { street: '8 Maple Ave', city: 'Rye', state: 'NY', zip: '10580' }, 'BUG-2 full state + zip');
eq(parseListingFilename('14 Hill Rd, Greenwich, Connecticut'),
   { street: '14 Hill Rd', city: 'Greenwich', state: 'CT', zip: null }, 'BUG-2 Connecticut → CT');
eq(parseListingFilename('2 Pine Ct, Ridgewood, New Jersey'),
   { street: '2 Pine Ct', city: 'Ridgewood', state: 'NJ', zip: null }, 'BUG-2 New Jersey → NJ');

// ---- Regression locks: existing behavior must be unchanged ----
eq(parseListingFilename('123 Main St, Greenwich, CT 06830'),
   { street: '123 Main St', city: 'Greenwich', state: 'CT', zip: '06830' }, 'A: street, city, state + zip');
eq(parseListingFilename('123 Main St, Greenwich CT'),
   { street: '123 Main St', city: 'Greenwich', state: 'CT', zip: null }, 'B: street, city state');
eq(parseListingFilename('456 Pine Ln, Rye Brook NY'),
   { street: '456 Pine Ln', city: 'Rye Brook', state: 'NY', zip: null }, 'B: two-word city');
eq(parseListingFilename('10 Hill Rd, Mount Kisco'),
   { street: '10 Hill Rd', city: 'Mount Kisco', state: 'NY', zip: null }, 'E: no state → NY');
eq(parseListingFilename('100 Old Farm Rd Chappaqua NY'),
   { street: '100 Old Farm Rd', city: 'Chappaqua', state: 'NY', zip: null }, 'C: suffix-anchored, 2-letter state');
eq(parseListingFilename('7 Sunnyside Ave Irvington NY 10533'),
   { street: '7 Sunnyside Ave', city: 'Irvington', state: 'NY', zip: '10533' }, 'C: suffix + zip');
eq(parseListingFilename('44 N State Rd, Briarcliff Manor NY'),
   { street: '44 N State Rd', city: 'Briarcliff Manor', state: 'NY', zip: null }, 'B: two-word village');
eq(parseListingFilename('25 Random Drive, Bedford, NY | MLS# 999'),
   { street: '25 Random Drive', city: 'Bedford', state: 'NY', zip: null }, 'A: digits MLS strip (regression)');
eq(parseListingFilename(''), null, 'empty → null');
eq(parseListingFilename(null), null, 'null → null');
eq(parseListingFilename('Compass-Listing-Generic-Shell'), null, 'unparseable → null');
// A real street that merely contains a state word mid-string must NOT be mis-stripped.
eq(parseListingFilename('5 Maine St, Bedford, NY'),
   { street: '5 Maine St', city: 'Bedford', state: 'NY', zip: null }, 'state word mid-string not stripped');

// ---- RED proof: the OLD implementation fails the bug cases ----
ok(parseListingFilenameOLD('123 Main St, Bedford, NY | MLS #H6285012').city.includes('Mls'),
   'RED: old code leaked the HGMLS tag into the city');
ok(parseListingFilenameOLD('8 Maple Avenue, Pleasantville, New York').city === 'Pleasantville, New York',
   'RED: old code left "New York" stuck on the city');

console.log(`listing-filename: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
