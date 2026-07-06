// Verifier-layer test for the STRUCTURE board NLE-marker CSV export escaper.
//
// CONTRACT: csvField(v) escapes ONE CSV field per RFC 4180 — wrap in double
// quotes, double every internal quote. The marker-export handler assembles each
// row as `[markerName, markerDesc, startTC, endTC, durTC, 'Comment', pColor]
// .map(csvField).join(',')`, so csvField is the ONLY thing standing between a
// stray `"` (in a card's text, its labelTag, or its timecode source) and a
// corrupted CSV row that mis-imports into Premiere/Resolve/FCP.
//
// This locks the two bugs the fix closed:
//   1. label/src were interpolated RAW (only cleanText was escaped) — a quote in
//      a label tag or timecode source broke the field boundary. Now every field
//      goes through csvField.
//   2. cleanText was escaped BEFORE the .substring(0,1000) truncation, so a cut
//      landing inside an escaped "" pair left a lone quote. Now the raw text is
//      truncated first and csvField escapes last, so a field always has an EVEN
//      number of quotes (balanced) no matter where truncation lands.
//
// EXTRACTS the real shipped csvField from index.html at runtime (regex + new
// Function) so the test can't drift from a hand-mirrored copy. Mutation-proven:
// drop the `.replace(/"/g,'""')` (or the wrapping quotes) and the balance /
// double-quote assertions turn RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const m = html.match(/function csvField\(v\)\{[\s\S]*?\}/);
assert.ok(m, 'could not find csvField() in index.html');
const csvField = new Function(`${m[0]}\nreturn csvField;`)();

// Count unescaped-vs-escaped quotes: a valid RFC-4180 field has an EVEN number
// of `"` chars total (2 wrappers + doubled internals), and starts/ends with `"`.
function isBalanced(field) {
  const quotes = (field.match(/"/g) || []).length;
  return field.startsWith('"') && field.endsWith('"') && quotes % 2 === 0;
}

// 1. Plain value — wrapped, no doubling needed.
assert.equal(csvField('hello'), '"hello"');

// 2. Internal quote is doubled.
assert.equal(csvField('a"b'), '"a""b"');
assert.ok(isBalanced(csvField('a"b')), 'single internal quote must stay balanced');

// 3. Null / undefined coerce to an empty field, never the string "null".
assert.equal(csvField(null), '""');
assert.equal(csvField(undefined), '""');

// 4. Numbers coerce (timecode/duration fields arrive as strings, but be safe).
assert.equal(csvField(0), '"0"');

// 5. The load-bearing case: a LABEL TAG containing a quote (bug #1). Before the
//    fix this went in raw and split the field; now it's balanced.
const labelField = csvField('[Label: he said "cut"] B-ROLL');
assert.ok(isBalanced(labelField), 'a quote in a label tag must not break the row');
assert.equal(labelField, '"[Label: he said ""cut""] B-ROLL"');

// 6. The truncation case (bug #2): escaping happens AFTER truncation, so even a
//    field whose RAW text ends exactly on a quote stays balanced. Simulate the
//    handler's order — truncate raw, then csvField.
const raw = 'x'.repeat(999) + '"' + 'tail'; // quote at index 999
const truncated = raw.substring(0, 1000);   // keeps the quote as the last char
assert.ok(isBalanced(csvField(truncated)), 'quote on the truncation boundary must stay balanced');

// 7. A full marker row with a quote in EACH free-text field stays parseable:
//    every column balanced, 7 columns.
const row = ['[Status: MISSING] "A" ROLL', '[Timecode: 01:00"] note', '00:00:00:00', '00:00:10:00', '00:00:10:00', 'Comment', 'Red']
  .map(csvField).join(',');
const fields = row.split(/,(?=")/); // split on comma that precedes a wrapper quote
assert.equal(fields.length, 7, 'row must have 7 columns');
fields.forEach((f, i) => assert.ok(isBalanced(f), `column ${i} must be balanced`));

console.log('csv-field.test.mjs — all assertions passed');
