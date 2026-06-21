// Tests for extractFromMeta() in public/westchester/index.html — the OG-meta
// fallback parser (Strategy 3) for the single-listing import on Johnny's ACTIVE
// house hunt. It fires when __NEXT_DATA__, Apollo/Redux state, AND JSON-LD all miss
// (i.e. for non-Compass / stripped listing pages), turning og:title + og:description
// into the { streetAddress, city, state, zip, price, beds, baths, sqft, ... } that
// feeds the geocode query in importListingAsPin.
//
// BUG (this fix): a spelled-out state ("New York") or a full name with the zip baked
// in ("New York 10514") leaked verbatim into the `state` field because the old
// /([A-Z]{2})\s+(\d{5})/ only recognized a 2-letter code. That dirties the geocode
// query string and loses the zip. EXACT same divergent-copy class already fixed in
// parseListingFilename (commit d6e776b, "spelled-out state leaked"); extractFromMeta
// was the surviving copy missing the normalization.
//
// Extracts the ACTUAL shipped function from index.html at runtime (new Function +
// brace match — can't drift from a hand-copied mirror) and drives it with an injected
// doc stub built from a {ogTitle, ogDesc, ogImg, ogUrl, canonical} map.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'westchester', 'index.html'), 'utf8');

function extractFn() {
  const m = HTML.match(/function extractFromMeta\(doc\) \{[\s\S]*?\n\}\n/);
  if (!m) throw new Error('could not locate extractFromMeta in index.html');
  return m[0];
}
const extractFromMeta = new Function(extractFn() + '\nreturn extractFromMeta;')();

// Minimal doc stub — extractFromMeta reads everything through doc.querySelector().
function makeDoc(meta) {
  return {
    querySelector(sel) {
      if (sel === 'meta[property="og:title"]') return meta.ogTitle != null ? { content: meta.ogTitle } : null;
      if (sel === 'meta[property="og:description"]') return meta.ogDesc != null ? { content: meta.ogDesc } : null;
      if (sel === 'meta[property="og:image"]') return meta.ogImg != null ? { content: meta.ogImg } : null;
      if (sel === 'meta[property="og:url"]') return meta.ogUrl != null ? { content: meta.ogUrl } : null;
      if (sel === 'link[rel="canonical"]') return meta.canonical != null ? { href: meta.canonical } : null;
      return null;
    },
  };
}
const run = (meta) => extractFromMeta(makeDoc(meta));

// The OLD (buggy) state derivation, for the RED proof — only a 2-letter code is
// recognized; anything else (a full state name) is returned verbatim.
function oldStateZip(part2) {
  const stateZipMatch = part2?.match(/([A-Z]{2})\s+(\d{5})/);
  return { state: stateZipMatch?.[1] || part2, zip: stateZipMatch?.[2] };
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ ' + name); }
}
function eq(name, got, want) {
  check(name + ` (got ${JSON.stringify(got)})`, got === want);
}

// ── RED proof: the old state derivation leaks a spelled-out state ──
{
  const a = oldStateZip('New York');
  check('RED: old logic leaks "New York" verbatim as state', a.state === 'New York');
  const b = oldStateZip('New York 10514');
  check('RED: old logic leaks "New York 10514" as state, loses zip', b.state === 'New York 10514' && b.zip === undefined);
  // ...while the shipped (fixed) function normalizes both.
  const fixedA = run({ ogTitle: '12 Oak Rd, Bedford, New York' });
  check('RED-contrast: shipped fn maps "New York" → NY', fixedA.state === 'NY');
  const fixedB = run({ ogTitle: '12 Oak Rd, Bedford, New York 10514' });
  check('RED-contrast: shipped fn pulls zip from "New York 10514"', fixedB.state === 'NY' && fixedB.zip === '10514');
}

// ── The fix: full state name → abbreviation ──
{
  const r = run({ ogTitle: '34 Maple Ave, Pleasantville, New York' });
  eq('full-name no-zip: state→NY', r.state, 'NY');
  eq('full-name no-zip: zip undefined', r.zip, undefined);
  eq('full-name no-zip: street', r.streetAddress, '34 Maple Ave');
  eq('full-name no-zip: city', r.city, 'Pleasantville');
}
{
  const r = run({ ogTitle: '34 Maple Ave, Pleasantville, New York 10570' });
  eq('full-name+zip: state→NY', r.state, 'NY');
  eq('full-name+zip: zip extracted', r.zip, '10570');
}
{
  const r = run({ ogTitle: '7 River Rd, Greenwich, Connecticut 06830' });
  eq('Connecticut→CT', r.state, 'CT');
  eq('Connecticut zip', r.zip, '06830');
}

// ── Regression locks: 2-letter cases must be byte-identical to before ──
{
  const r = run({ ogTitle: '123 Main St, Bedford, NY 10514' });
  eq('2-letter+zip: state', r.state, 'NY');
  eq('2-letter+zip: zip', r.zip, '10514');
  eq('2-letter+zip: street', r.streetAddress, '123 Main St');
  eq('2-letter+zip: city', r.city, 'Bedford');
}
{
  const r = run({ ogTitle: '123 Main St, Bedford, NY' });
  eq('2-letter no-zip: state', r.state, 'NY');
  eq('2-letter no-zip: zip', r.zip, undefined);
}
{
  // No state chunk at all (only street + city)
  const r = run({ ogTitle: '123 Main St, Bedford' });
  eq('no-state: city', r.city, 'Bedford');
  eq('no-state: state undefined', r.state, undefined);
  eq('no-state: zip undefined', r.zip, undefined);
}

// ── og:title required ──
check('no og:title → null', run({ ogDesc: 'some desc' }) === null);

// ── price, specs, photos, url still parse (no regression in the rest of the fn) ──
{
  const r = run({
    ogTitle: '$1,250,000 · 88 Hill Rd, Chappaqua, NY 10514',
    ogDesc: '4 bed, 3.5 bath, 3,200 sqft colonial',
    ogImg: 'https://img.example/cover.jpg',
    ogUrl: 'https://compass.com/listing/88-hill-rd',
  });
  eq('price parsed from title', r.price, 1250000);
  eq('street after price strip', r.streetAddress, '88 Hill Rd');
  eq('city', r.city, 'Chappaqua');
  eq('state', r.state, 'NY');
  eq('zip', r.zip, '10514');
  eq('beds', r.beds, 4);
  eq('baths', r.baths, 3.5);
  eq('sqft', r.sqft, 3200);
  eq('listingUrl from og:url', r.listingUrl, 'https://compass.com/listing/88-hill-rd');
  check('photos from og:image', Array.isArray(r.photos) && r.photos[0] === 'https://img.example/cover.jpg');
}
{
  // listingUrl falls back to canonical link when og:url is absent
  const r = run({ ogTitle: '5 Elm St, Rye, NY 10580', canonical: 'https://x.com/canon' });
  eq('listingUrl from canonical fallback', r.listingUrl, 'https://x.com/canon');
}
{
  // pipe/middot separators are normalized to commas before splitting
  const r = run({ ogTitle: '9 Pine Ct | Armonk | NY 10504' });
  eq('pipe-separated street', r.streetAddress, '9 Pine Ct');
  eq('pipe-separated city', r.city, 'Armonk');
  eq('pipe-separated state', r.state, 'NY');
  eq('pipe-separated zip', r.zip, '10504');
}

console.log(`\nwestchester-extract-meta: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
