// Locks the AUTHOR'S EDITION contract in public/burgundy/index.html:
//  1. author mode activates ONLY on /burgundy/johnny (path-gated, same password
//     gate as every reader — the gate check is mode-independent),
//  2. author decisions ride the existing notes transport with para_key
//     "edit:<id>" and are SPLIT OUT of paintable NOTES in every mode (a
//     decision row must never paint as a margin note or surface as an orphan),
//  3. book-author.json is fetched only in author mode, with book.json fallback.
//
// Plain assert-script (NOT node:test): the repo runner (scripts/run-tests.mjs)
// spawns each suite as `bun <file>`, and bun refuses node:test's test() outside
// its own `bun test` runner.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// 1) author mode is path-gated on /burgundy/johnny.
assert.match(html, /const AUTHOR = \/\^\\\/burgundy\\\/johnny\(\\\/\|\$\)\/\.test\(location\.pathname\)/);

// 2) the password gate does not special-case author mode (one gate for all).
{
  const gate = html.match(/function gateOpen\(\)[^\n]*/)[0];
  assert.ok(!gate.includes('AUTHOR'), 'gateOpen must stay mode-independent');
}

// 3) decision rows (edit:*) are split out of paintable NOTES in every mode.
assert.match(html, /NOTES = mine\.filter\(n => !String\(n\.para_key \|\| ''\)\.startsWith\('edit:'\)\)/);
assert.match(html, /DECISIONS = all\.filter\(n => String\(n\.para_key \|\| ''\)\.startsWith\('edit:'\)\)/);

// 4) book-author.json is author-only, with public fallback.
assert.match(html, /AUTHOR \? await fetch\('\/burgundy\/book-author\.json/);
assert.match(html, /if \(!r \|\| !r\.ok\) r = await fetch\('\/burgundy\/book\.json/);

// 5) decisions post through the existing notes API with the edit: prefix.
assert.match(html, /para_key: 'edit:' \+ ed\.id/);
assert.match(html, /queueNote\(\{ \.\.\.row/);   // offline durability via the same queue

// 6) author reader identity is pinned to r-johnny.
assert.match(html, /if \(AUTHOR\) \{ READER = 'r-johnny'; return READER; \}/);

console.log('author-mode.test.mjs: all assertions passed');
