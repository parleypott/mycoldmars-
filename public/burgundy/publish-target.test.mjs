// Locks publish-burgundy.ts's targeting contract by static inspection:
// the main target writes ONLY book.json; the author target writes ONLY
// book-author.json + edit-spans-author.json. A cross-write would either leak
// the working manuscript to public readers or clobber the author's copy.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const src = readFileSync('/Users/johnnyharris/playground/newpress-novel/bill-edit/publish-burgundy.ts', 'utf8');

test('author branch writes only author artifacts', () => {
  const m = src.match(/if \(TARGET === "author" \|\| TARGET === "both"\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'author branch found');
  assert.ok(m[1].includes('book-author.json'));
  assert.ok(m[1].includes('edit-spans-author.json'));
  assert.ok(!/writeFileSync\([^)]*\/book\.json/.test(m[1]), 'author branch must not write book.json');
});

test('main branch writes only book.json', () => {
  const m = src.match(/if \(TARGET === "main" \|\| TARGET === "both"\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'main branch found');
  assert.ok(m[1].includes('/book.json'));
  assert.ok(!m[1].includes('book-author.json'), 'main branch must not write author artifacts');
});

test('span-locate failures set a nonzero exit code (loud, never silent)', () => {
  assert.ok(src.includes('SPAN-LOCATE FAILURES'));
  assert.ok(src.includes('process.exitCode = 2'));
});

test('default target is author (a bare run can never republish the public book)', () => {
  assert.ok(src.includes('arg("--target", "author")'));
});
