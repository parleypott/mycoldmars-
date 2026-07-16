// Locks the BOOK-VERSION resolution rule in saveNote() of the BERGUNDY reader
// (public/burgundy/index.html, commit becedbe: "carry a note's original
// book_version through the edit path"). Extracted from the shipped HTML at
// runtime so a drift in index.html breaks this test.
//
// The rule:  book_version: n.book_version ?? (BOOK?.version || '')
//
// WHY IT EXISTS: every note carries the publish `version` its para_key /
// chapter_idx anchors were captured against. A note born NOW should be stamped
// with the current book (BOOK.version). But the EDIT path re-POSTs an OLD row —
// and it must keep that row's ORIGINAL stamp. Restamping an edited old note with
// today's version lies about which publish its anchors came from, so the
// authoring tool mis-resolves the highlight after a chapter split/insert.
//
// THE LOAD-BEARING OPERATOR IS `??`, NOT `||`. An edited note published before
// the tool started stamping versions carries book_version:'' (empty string).
// `??` (nullish) PRESERVES that honest empty stamp; `||` (falsy) would fall
// through and RESTAMP it with today's version — silently reintroducing the exact
// mis-anchor bug this commit fixes. `??`↔`||` look interchangeable, so this test
// exists to make the swap a RED failure, not a silent regression.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// Capture the resolution expression verbatim (whatever operator ships) so a
// `??`→`||` mutation is caught by the assertions below, not by extraction.
const m = html.match(/book_version:\s*(n\.book_version[^,]*),\s*reader:/);
assert.ok(m, 'could not extract the book_version resolution rule from saveNote() — did the row shape change?');
const expr = m[1].trim();
const resolve = new Function('n', 'BOOK', 'return ' + expr);

let pass = 0;
const eq = (got, want, label) => { assert.strictEqual(got, want, label); pass++; };

// 1. New note (no incoming stamp) → current book. This is the "born now" path
//    (press-and-hold; sel carries no book_version).
eq(resolve({}, { version: 'v-today' }), 'v-today', 'absent stamp defaults to current book version');
eq(resolve({ para_key: 'p1', quote: 'x' }, { version: 'v-today' }), 'v-today', 'a real new-note row still defaults to current');

// 2. Edit path with a real original stamp → PRESERVED, never restamped.
eq(resolve({ book_version: 'v-orig' }, { version: 'v-today' }), 'v-orig', 'edit re-post preserves the note\'s original stamp');

// 3. LOAD-BEARING: edited LEGACY note whose original stamp is '' → preserved as
//    '' (the `??` case). Under `||` this would wrongly become 'v-today'.
eq(resolve({ book_version: '' }, { version: 'v-today' }), '', 'empty original stamp is PRESERVED (the ?? contract), not restamped');

// 4. No current book at all (BOOK null / no .version) → '' fallback, never a throw.
eq(resolve({}, null), '', 'null BOOK degrades to empty string, no crash');
eq(resolve({}, {}), '', 'BOOK without a .version degrades to empty string');
eq(resolve({}, undefined), '', 'undefined BOOK degrades to empty string');

// 5. MUTATION DEMONSTRATION — prove the test is load-bearing on the operator.
//    A `||` variant of the SAME expression returns the WRONG value for the
//    empty-stamp edit case, which is precisely the bug the shipped `??` avoids.
const buggy = new Function('n', 'BOOK', 'return n.book_version || (BOOK && BOOK.version || "")');
assert.strictEqual(buggy({ book_version: '' }, { version: 'v-today' }), 'v-today',
  'sanity: the || variant restamps an empty original — so the shipped code must NOT be ||');
assert.notStrictEqual(
  resolve({ book_version: '' }, { version: 'v-today' }),
  buggy({ book_version: '' }, { version: 'v-today' }),
  'shipped resolution must differ from the buggy || variant on the empty-stamp case');
pass += 2;

console.log(`book-version-preserve: ${pass} assertions passed (rule: ${expr})`);
