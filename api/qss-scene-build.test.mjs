// Tests for qss-scene-build's source-cap helper — the trim applied before a
// pasted/uploaded story is sent to the auto-scene-builder.
//
// The bug this locks: the inline cap was
//     const cut = source.lastIndexOf('\n\n', MAX_CHARS) || MAX_CHARS;
//     source = source.slice(0, cut);
// `lastIndexOf` returns -1 when there is NO paragraph break in range (a long
// single-newline / wall-of-text source), and -1 is TRUTHY — so the `||` form
// kept -1, and `slice(0, -1)` returned the ENTIRE oversized source minus one
// char, defeating the 200K cap entirely and blowing the token budget. A break
// at index 0 (source starts with a blank line) was also mishandled. The fix
// extracts capSourceAtParagraph() with an explicit <=0 check.
//
// Imports the REAL shipped helper (no drift-prone mirror). Run with bun
// (auto-discovered by `bun run test`).

import { capSourceAtParagraph } from './qss-scene-build.js';

let pass = 0;
let fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); }
}

const MAX = 1000; // small cap for testing; behavior is the same at 200_000

// ── Under the cap: returned unchanged ──
check('short source returned unchanged', capSourceAtParagraph('hello world', MAX) === 'hello world');
check('exactly-at-cap returned unchanged', capSourceAtParagraph('x'.repeat(MAX), MAX).length === MAX);

// ── THE BUG: oversized source with NO paragraph break (-1 case) ──
// A wall of text using single newlines (or none) longer than the cap.
{
  const wall = 'a\n'.repeat(MAX); // length 2*MAX, contains '\n' but never '\n\n'
  const out = capSourceAtParagraph(wall, MAX);
  check('no-paragraph-break source is HARD-capped at maxChars (the -1 bug)', out.length === MAX);
  check('no-paragraph-break source does NOT leak full length', out.length < wall.length);
}
{
  const blob = 'x'.repeat(MAX * 2); // no newline at all
  const out = capSourceAtParagraph(blob, MAX);
  check('newline-free blob is hard-capped at maxChars', out.length === MAX);
}

// ── Oversized source WITH a paragraph break in range: cut on the break ──
{
  const head = 'word '.repeat(150);      // ~750 chars
  const src = head + '\n\n' + 'tail '.repeat(400); // total > MAX, break ~750
  const out = capSourceAtParagraph(src, MAX);
  const breakIdx = src.lastIndexOf('\n\n', MAX);
  check('cuts exactly at the last paragraph break <= maxChars', out.length === breakIdx);
  check('cut source ends without the trailing blank line', !out.endsWith('\n'));
  check('cut source is a prefix of the original', src.startsWith(out));
  check('cut never exceeds maxChars', out.length <= MAX);
}

// ── Paragraph break at index 0 (source starts with a blank line) ──
// lastIndexOf would return 0; `0 || MAX` happened to work, but the old code's
// real failure was -1. The fix's <=0 guard hard-caps this too (cutting at 0
// would yield empty, which is useless), so we still get a maxChars cut.
{
  const src = '\n\n' + 'y'.repeat(MAX * 2);
  const out = capSourceAtParagraph(src, MAX);
  check('leading blank-line source falls back to hard cap (not empty)', out.length === MAX);
}

// ── Multiple breaks: picks the LAST one within range, not the first ──
{
  const src = 'A'.repeat(300) + '\n\n' + 'B'.repeat(300) + '\n\n' + 'C'.repeat(MAX);
  const out = capSourceAtParagraph(src, MAX);
  const expected = src.lastIndexOf('\n\n', MAX);
  check('picks last break within range', out.length === expected && expected > 300);
}

// ── Non-string input is returned as-is (defensive) ──
check('null source returned as-is', capSourceAtParagraph(null, MAX) === null);
check('undefined source returned as-is', capSourceAtParagraph(undefined, MAX) === undefined);

// ── Inline RED proof: the OLD `|| ` logic leaks the whole source ──
// Reconstruct the pre-fix one-liner and show it fails on the no-break case.
{
  function oldCap(source, maxChars) {
    if (source.length <= maxChars) return source;
    const cut = source.lastIndexOf('\n\n', maxChars) || maxChars; // BUG
    return source.slice(0, cut);
  }
  const wall = 'a\n'.repeat(MAX); // 2*MAX chars, no '\n\n'
  const oldOut = oldCap(wall, MAX);
  const newOut = capSourceAtParagraph(wall, MAX);
  check('RED proof: old || logic leaks full source minus one char', oldOut.length === wall.length - 1);
  check('RED proof: new logic correctly hard-caps it', newOut.length === MAX);
}

console.log(`qss-scene-build: ${pass} passed, ${fail} failed`);
if (fail) {
  console.error('FAILURES:\n  ' + fails.join('\n  '));
  process.exit(1);
}
