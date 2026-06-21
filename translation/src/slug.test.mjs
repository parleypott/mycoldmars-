// Lock generateSlug — the transcript permalink slug builder.
//
// REAL BUG fixed: the apostrophe strip was straight-apostrophe-only (U+0027),
// so a name carrying a curly apostrophe (U+2019 — the default macOS Finder /
// smart-quote glyph in file names, and generateSlug is fed the uploaded FILE
// NAME at the bulk-upload call site) fell through to the `[^a-z0-9]+ -> '-'`
// pass and produced "mehdi-s-interview" instead of the intended
// "mehdis-interview". Same incomplete-char-class family as b-roll \b /
// strip-quotes / voice-segmenter. The fix strips straight ' + curly ' '.
//
// Run: bun translation/src/slug.test.mjs   (auto-discovered by `bun run test`)
import { generateSlug } from './slug.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

const CURLY_R = '’'; // ' right single quote
const CURLY_L = '‘'; // ' left single quote

// ── inline RED proof: reconstruct the OLD straight-apostrophe-only strip ──
function oldGenerateSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/'/g, '') // straight apostrophe ONLY (the bug)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}
// The old code mishandles a curly apostrophe; the shipped fix does not.
eq(oldGenerateSlug(`Mehdi${CURLY_R}s Interview`), 'mehdi-s-interview',
  'RED proof: old strip leaves curly apostrophe -> hyphenated "mehdi-s-interview"');
eq(generateSlug(`Mehdi${CURLY_R}s Interview`), 'mehdis-interview',
  'fix: curly apostrophe stripped -> "mehdis-interview"');

// ── the fix: curly apostrophes stripped like the straight one ──
eq(generateSlug(`Johnny${CURLY_R}s Story`), 'johnnys-story', 'right curly apostrophe stripped');
eq(generateSlug(`Johnny${CURLY_L}s Story`), 'johnnys-story', 'left curly apostrophe stripped');
eq(generateSlug("Johnny's Story"), 'johnnys-story', 'straight apostrophe stripped (unchanged behavior)');
eq(generateSlug(`don${CURLY_R}t can${CURLY_R}t won${CURLY_R}t`), 'dont-cant-wont', 'multiple curly apostrophes all stripped');
eq(generateSlug(`Mehdi${CURLY_R}s ${CURLY_L}Special${CURLY_R} Cut.mp4`), 'mehdis-special-cut-mp4',
  'mixed curly apostrophes + non-alnum hyphenated');

// ── the three glyphs produce the SAME slug (the whole point) ──
const fromStraight = generateSlug("O'Brien's File");
const fromRight = generateSlug(`O${CURLY_R}Brien${CURLY_R}s File`);
const fromLeft = generateSlug(`O${CURLY_L}Brien${CURLY_L}s File`);
eq(fromStraight, 'obriens-file', 'straight -> obriens-file');
eq(fromRight, fromStraight, 'right curly slug == straight curly slug');
eq(fromLeft, fromStraight, 'left curly slug == straight curly slug');

// ── NO-REGRESSION: names WITHOUT any apostrophe are byte-identical to old ──
const noApos = [
  'My Interview', 'Taiwan Day 2', '  spaced  out  ', 'UPPER CASE', 'a/b\\c:d', 'feature #4 (final)',
  'résumé café', '日本語 test', '---leading and trailing---', '', '   ', 'a', '12345',
  'A'.repeat(80) + ' very long name that exceeds sixty characters for the slice',
  'symbols!@#$%^&*()=+', 'tabs\tand\nnewlines', 'dot.separated.name.v2',
];
for (const n of noApos) {
  eq(generateSlug(n), oldGenerateSlug(n), `no-regression (no apostrophe): ${JSON.stringify(n)}`);
}

// ── known-output locks ──
eq(generateSlug('My Interview'), 'my-interview', 'basic lowercase + hyphen');
eq(generateSlug('  spaced  out  '), 'spaced-out', 'collapse runs, trim leading/trailing');
eq(generateSlug('---'), 'untitled', 'all-separator -> untitled fallback');
eq(generateSlug(''), 'untitled', 'empty -> untitled');
eq(generateSlug('UPPER'), 'upper', 'lowercased');
ok(generateSlug('A'.repeat(100)).length <= 60, '60-char cap enforced');

// ── null-safety hardening (old code threw on nullish .toLowerCase()) ──
eq(generateSlug(null), 'untitled', 'null -> untitled, no throw');
eq(generateSlug(undefined), 'untitled', 'undefined -> untitled, no throw');
eq(generateSlug(12345), '12345', 'number coerced to string');
let threw = false;
try { generateSlug(null); } catch { threw = true; }
ok(!threw, 'generateSlug(null) does not throw');

// ── caller-shape lock: bulk-upload feeds the file-name (sans extension) ──
const fileBase = `Mehdi${CURLY_R}s Interview.mp4`.replace(/\.[^.]+$/, ''); // mirrors bulkSaveTranscript
eq(generateSlug(fileBase), 'mehdis-interview', 'upload file-name with curly apostrophe -> clean slug');

console.log(`\nslug.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
