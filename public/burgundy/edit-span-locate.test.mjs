// The critical author's-edition invariant: EVERY edit span shipped in
// edit-spans-author.json must locate — each of its paragraph keys "ci:pi"
// must exist in book-author.json and (for content spans) the paragraph list
// must be non-empty. A span that fails to locate is a suggested edit Johnny
// can never see, tap, or rule on — silent data loss, the exact failure class
// the write-path-guards doctrine exists to kill.
//
// Plain assert-script (NOT node:test): the repo runner (scripts/run-tests.mjs)
// spawns each suite as `bun <file>`, and bun refuses node:test's test() outside
// its own `bun test` runner. Every suite here is a bare-assert script that throws
// on failure (nonzero exit) and prints a summary on success.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const dir = dirname(fileURLToPath(import.meta.url));
const bookPath = join(dir, 'book-author.json');
const spansPath = join(dir, 'edit-spans-author.json');

// 1) author book + span map exist together.
{
  assert.ok(existsSync(bookPath), 'book-author.json missing');
  assert.ok(existsSync(spansPath), 'edit-spans-author.json missing');
}

// 2) every span paragraph key resolves into book-author.json.
{
  const book = JSON.parse(readFileSync(bookPath, 'utf8'));
  const spans = JSON.parse(readFileSync(spansPath, 'utf8')).edits;
  assert.ok(Array.isArray(spans) && spans.length >= 70, `expected ~75 spans, got ${spans?.length}`);
  const misses = [];
  for (const s of spans) {
    if (s.id === 'E009') continue;   // structural (chapter merge) — no paragraphs
    if (!Array.isArray(s.paras) || !s.paras.length) { misses.push(s.id + ':empty'); continue; }
    for (const key of s.paras) {
      const [ci, pi] = key.split(':').map(Number);
      const para = book.chapters?.[ci]?.paragraphs?.[pi];
      if (typeof para !== 'string' || !para.length) misses.push(s.id + ':' + key);
    }
  }
  assert.deepEqual(misses, [], 'unlocatable spans: ' + misses.join(', '));
}

// 3) author book keeps the public schema (reader invariants intact).
{
  const book = JSON.parse(readFileSync(bookPath, 'utf8'));
  assert.equal(typeof book.title, 'string');
  assert.ok(Array.isArray(book.chapters) && book.chapters.length === 21, '21 chapters after the merge');
  for (const c of book.chapters) {
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length > 0);
    assert.ok(Array.isArray(c.paragraphs));
  }
  assert.equal(typeof book.voice_id, 'string');
}

console.log('edit-span-locate.test.mjs: all assertions passed');
