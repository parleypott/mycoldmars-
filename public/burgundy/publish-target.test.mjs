// Locks publish-burgundy.ts's targeting contract by static inspection:
// the main target writes ONLY book.json; the author target writes ONLY
// book-author.json + edit-spans-author.json. A cross-write would either leak
// the working manuscript to public readers or clobber the author's copy.
//
// Plain assert-script (NOT node:test): the repo runner (scripts/run-tests.mjs)
// spawns each suite as `bun <file>`, and bun refuses node:test's test() outside
// its own `bun test` runner.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// publish-burgundy.ts lives in Johnny's separate build repo (newpress-novel),
// NOT in mycoldmars, so it's only present on his Mac. Read it defensively: run
// the real contract assertions where the file exists, and SKIP-and-exit-0 (never
// hard-fail the whole suite) where it doesn't — the Redoubt, CI, or any fresh
// clone. A bare readFileSync on the absolute path ENOENT-crashed `bun run test`
// everywhere but that one machine.
const SRC_PATH = '/Users/johnnyharris/playground/newpress-novel/bill-edit/publish-burgundy.ts';
let src = null;
try { src = readFileSync(SRC_PATH, 'utf8'); } catch { /* external build-repo file absent on this machine */ }
if (src === null) {
  console.log(`publish-target: SKIPPED — publish-burgundy.ts not present at ${SRC_PATH} (external build repo, Mac only). Contract assertions run where the file exists.`);
  process.exit(0);
}

// 1) author branch writes only author artifacts.
{
  const m = src.match(/if \(TARGET === "author" \|\| TARGET === "both"\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'author branch found');
  assert.ok(m[1].includes('book-author.json'));
  assert.ok(m[1].includes('edit-spans-author.json'));
  assert.ok(!/writeFileSync\([^)]*\/book\.json/.test(m[1]), 'author branch must not write book.json');
}

// 2) main branch writes only book.json.
{
  const m = src.match(/if \(TARGET === "main" \|\| TARGET === "both"\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'main branch found');
  assert.ok(m[1].includes('/book.json'));
  assert.ok(!m[1].includes('book-author.json'), 'main branch must not write author artifacts');
}

// 3) span-locate failures set a nonzero exit code (loud, never silent).
{
  assert.ok(src.includes('SPAN-LOCATE FAILURES'));
  assert.ok(src.includes('process.exitCode = 2'));
}

// 4) default target is author (a bare run can never republish the public book).
{
  assert.ok(src.includes('arg("--target", "author")'));
}

console.log('publish-target.test.mjs: all assertions passed');
