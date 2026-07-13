// Locks sheetQuoteLabel(), the note-sheet header quote renderer of the BERGUNDY
// reader (public/burgundy/index.html). Extracted from the shipped HTML at runtime
// so a drift in index.html breaks this test.
//
// Bug fixed + locked here: openSheet() built the header label with a bare
// `n.quote.slice(0, 220)` + `n.quote.length`. openSheet is called on an ORPHAN
// tap (renderOrphans wires each orphan to openSheet(n)) with a note object taken
// straight from a raw DB row — GET /api/burgundy-notes returns `select=*`, so a
// legacy/out-of-band/partial row whose `quote` is null (or non-string) reaches
// openSheet unfiltered. `null.slice` / `null.length` throw a TypeError, so the
// note becomes un-openable and the tap handler throws. paintNote and
// renderOrphans already guard the same field (`(n.quote || '')`); openSheet did
// not. sheetQuoteLabel(q) coerces with `String(q ?? '')` first — byte-identical
// for every real string quote, safe for a partial row.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function sheetQuoteLabel\(quote\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract sheetQuoteLabel() from index.html — did the function signature change?');
const sheetQuoteLabel = (0, eval)('(' + m[0] + ')');

// The pre-fix form, kept here to PROVE the test is load-bearing: this is exactly
// what the shipped openSheet() inlined before the guard.
function buggyLabel(quote) {
  return '“' + quote.slice(0, 220) + (quote.length > 220 ? '…' : '') + '”';
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// 1. A short quote is wrapped in curly quotes, no ellipsis.
{
  const out = sheetQuoteLabel('the number did not bother him');
  eq(out, '“the number did not bother him”', 'short quote wrapped, no ellipsis');
  ok(!out.includes('…'), 'no ellipsis on a short quote');
}

// 2. Byte-identical to the pre-fix inline form for real string quotes (zero regression).
for (const q of ['x', 'a short line', 'q'.repeat(219), 'q'.repeat(220), 'q'.repeat(221), 'q'.repeat(900)]) {
  eq(sheetQuoteLabel(q), buggyLabel(q), `guarded form matches old inline output for length ${q.length}`);
}

// 3. Truncation at exactly 220 chars, with the ellipsis only when over.
{
  const at220 = sheetQuoteLabel('a'.repeat(220));
  ok(!at220.includes('…'), 'exactly 220 chars → no ellipsis');
  const over = sheetQuoteLabel('a'.repeat(221));
  ok(over.includes('…'), 'over 220 chars → ellipsis appended');
  eq(over, '“' + 'a'.repeat(220) + '…”', 'over-cap keeps 220 chars then ellipsis');
}

// 4. THE BUG: a partial/legacy note row whose quote is null/non-string.
//    Fixed form yields an empty label; old inline form THREW.
for (const bad of [null, undefined, 42, {}, ['a']]) {
  let out;
  assert.doesNotThrow(() => { out = sheetQuoteLabel(bad); },
    `FIXED: quote=${JSON.stringify(bad)} does not throw`); pass++;
  ok(typeof out === 'string' && out.startsWith('“') && out.endsWith('”'),
    `quote=${JSON.stringify(bad)} still renders a well-formed label`);
}
// MUTATION PROOF: the pre-fix form threw on a null quote.
assert.throws(() => buggyLabel(null), TypeError,
  'MUTATION PROOF: pre-fix inline form threw TypeError on a null quote'); pass++;

console.log(`sheet-quote-label.test.mjs: ${pass} assertions passed`);
