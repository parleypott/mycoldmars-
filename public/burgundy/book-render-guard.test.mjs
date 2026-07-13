// Locks safeBook(), the ROOT-object render guard of the BERGUNDY reader
// (public/burgundy/index.html). Extracted from the shipped HTML at runtime so a
// drift in index.html breaks this test.
//
// Bug fixed + locked here: render() dereferenced the module-level BOOK directly
// (`const chapters = BOOK.chapters || []`, `esc(BOOK.title || …)`, …) and is
// called OUTSIDE any try/catch. A malformed publish — the WIP-novel tool writing
// a literal `null`, a bare array, or a primitive to book.json — yields a
// non-object BOOK, and `BOOK.chapters` on a null BOOK throws a TypeError that
// strands the WHOLE reader on the "opening the book…" spinner (no title page, no
// chapters, no notes). The chapter/paragraph guards (chapter-html.test.mjs)
// covered a bad chapter or a bad paragraphs array; this covers the ROOT object
// one level up. `safeBook(b)` coerces a non-object to `{}` so render() renders
// the title page + an empty book instead of crashing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
// one-liner; the body contains a `{}` literal, so match the whole line, not the first `}`.
const m = html.match(/function safeBook\(b\)[^\n]*\}/);
assert.ok(m, 'could not extract safeBook() from index.html — did the function change?');
const safeBook = (0, eval)('(' + m[0] + ')');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// The pre-fix render() body did this on the root BOOK — kept to PROVE the guard
// is load-bearing (this is exactly what crashed the reader on a null book).
const buggyChaptersOf = (BOOK) => BOOK.chapters || [];
const guardedChaptersOf = (BOOK) => safeBook(BOOK).chapters || [];

// 1. A real book object passes through UNCHANGED (same reference) → byte-identical render.
{
  const book = { title: 'BERGUNDY', chapters: [{ title: 'One', paragraphs: ['a'] }], published_at: '2026-07-13' };
  ok(safeBook(book) === book, 'a real book object is returned by reference (zero regression)');
  ok(guardedChaptersOf(book) === book.chapters, 'guarded chapters access yields the real chapters array');
}

// 2. THE BUG: a malformed non-object book must NOT throw; it coerces to {}.
for (const bad of [null, undefined, 42, 'a whole book as a string', true, NaN]) {
  ok(safeBook(bad) && typeof safeBook(bad) === 'object', `safeBook(${JSON.stringify(bad)}) is an object`);
  assert.doesNotThrow(() => guardedChaptersOf(bad),
    `FIXED: guarded chapters access on ${JSON.stringify(bad)} does not throw`); pass++;
  eq(guardedChaptersOf(bad).length, 0, `${JSON.stringify(bad)} yields an empty (0-chapter) book`);
}

// 3. MUTATION PROOF: the pre-fix bare `BOOK.chapters` threw on the load-bearing
//    null/undefined cases (a literal `null` in book.json is the realistic one).
assert.throws(() => buggyChaptersOf(null), TypeError,
  'MUTATION PROOF: pre-fix form threw TypeError on a null book'); pass++;
assert.throws(() => buggyChaptersOf(undefined), TypeError,
  'MUTATION PROOF: pre-fix form threw TypeError on an undefined book'); pass++;

// 4. A bare ARRAY book (another malformed shape) is object-typed and yields no
//    chapters (arrays have no .chapters) — graceful empty book, never a crash.
{
  ok(safeBook([]) && typeof safeBook([]) === 'object', 'an array book is object-typed (passes through)');
  eq(guardedChaptersOf([]).length, 0, 'an array book yields 0 chapters, not a crash');
}

// 5. An empty object book renders as a valid empty book (title falls back downstream).
{
  eq(guardedChaptersOf({}).length, 0, 'an empty-object book yields 0 chapters');
  ok(safeBook({}) && typeof safeBook({}) === 'object', 'empty object passes through');
}

console.log(`book-render-guard.test.mjs: ${pass} assertions passed`);
