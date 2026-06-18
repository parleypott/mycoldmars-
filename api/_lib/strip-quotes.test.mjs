// Tests for the shared surrounding-quote stripper used by qss-story-title
// (the Storybook title Henry sees) and qss-character-card cleanSynopsis.
//
// The bug this closes: both call sites had their OWN regex and BOTH missed
// the curly single quotes ‘ ’, so a model reply wrapped in smart single
// quotes leaked them into Henry-facing text. Imports the REAL shipped fn.
import { stripSurroundingQuotes, QUOTE_CHARS } from './strip-quotes.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── The fix: curly single quotes are now stripped ──────────────────────────
eq(stripSurroundingQuotes('‘Sparkle the Dragon’'), 'Sparkle the Dragon',
  'curly single quotes stripped (the bug)');
eq(stripSurroundingQuotes('‘The Apocalypse Box'), 'The Apocalypse Box',
  'leading curly single stripped');
eq(stripSurroundingQuotes('Wordy the Owl’'), 'Wordy the Owl',
  'trailing curly single stripped');

// ── Inline RED proof: reconstruct BOTH old regexes and show they leaked ────
// qss-story-title old:  /^["“”'']+|["“”'']+$/g
const oldTitleStrip = (s) => String(s || '').replace(/^["“”'']+|["“”'']+$/g, '').trim();
// qss-character-card old:  /^["'“”]+|["'“”]+$/g
const oldSynopsisStrip = (s) => String(s || '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
ok(oldTitleStrip('‘Sparkle the Dragon’') === '‘Sparkle the Dragon’',
  'RED proof: old title regex LEAVES curly singles');
ok(oldSynopsisStrip('‘a brave owl’') === '‘a brave owl’',
  'RED proof: old synopsis regex LEAVES curly singles');
ok(stripSurroundingQuotes('‘Sparkle the Dragon’') !== oldTitleStrip('‘Sparkle the Dragon’'),
  'RED proof: shipped fn differs from old title regex on curly singles');

// ── Behavior-preserving locks: everything the old copies DID strip, still strips ──
eq(stripSurroundingQuotes('"Quoted"'), 'Quoted', 'straight double still stripped');
eq(stripSurroundingQuotes("'Quoted'"), 'Quoted', 'straight single still stripped');
eq(stripSurroundingQuotes('“Quoted”'), 'Quoted', 'curly double still stripped');
eq(stripSurroundingQuotes('"“mixed”"'), 'mixed', 'mixed double run stripped');
eq(stripSurroundingQuotes('`code`'), 'code', 'backtick wrap stripped');
eq(stripSurroundingQuotes('""""Title""""'), 'Title', 'long run of quotes stripped both ends');

// ── Apostrophe / quote INSIDE the value is preserved (only edges touched) ──
eq(stripSurroundingQuotes("Henry's Dragon"), "Henry's Dragon",
  'internal straight apostrophe preserved');
eq(stripSurroundingQuotes('Henry’s Dragon'), 'Henry’s Dragon',
  'internal curly apostrophe preserved');
eq(stripSurroundingQuotes('"Henry\'s Dragon"'), "Henry's Dragon",
  'outer quotes stripped, inner apostrophe kept');
eq(stripSurroundingQuotes('The "Best" Day'), 'The "Best" Day',
  'mid-string quotes preserved (no leading/trailing run)');

// ── Edge cases ─────────────────────────────────────────────────────────────
eq(stripSurroundingQuotes(''), '', 'empty string → empty');
eq(stripSurroundingQuotes(null), '', 'null → empty');
eq(stripSurroundingQuotes(undefined), '', 'undefined → empty');
eq(stripSurroundingQuotes('plain'), 'plain', 'no quotes → unchanged');
eq(stripSurroundingQuotes('""'), '', 'only quotes → empty');
eq(stripSurroundingQuotes('‘’'), '', 'only curly singles → empty');
eq(stripSurroundingQuotes(42), '42', 'number coerced to string then stripped');
// Does not trim whitespace itself (caller controls that):
eq(stripSurroundingQuotes('  spaced  '), '  spaced  ', 'whitespace NOT trimmed by this fn');
eq(stripSurroundingQuotes('"  inside  "'), '  inside  ', 'quotes stripped, inner whitespace kept');

// QUOTE_CHARS contains all seven wrap marks
for (const ch of '"\'`“”‘’') ok(QUOTE_CHARS.includes(ch), `QUOTE_CHARS includes ${ch}`);

// ── Caller-pipeline replicas (mirror the two handlers, using the REAL fn) ──
// qss-story-title:  trim → stripSurroundingQuotes → trim → cap 80
const cleanTitle = (raw) => {
  let t = String(raw || '').trim();
  t = stripSurroundingQuotes(t).trim();
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
};
eq(cleanTitle('‘The Apocalypse Box’'), 'The Apocalypse Box', 'title pipeline strips curly singles');
eq(cleanTitle('"  The Dragon  "'), 'The Dragon', 'title pipeline trims inside quotes');
eq(cleanTitle("Henry's First Story"), "Henry's First Story", 'title pipeline keeps internal apostrophe');
ok(cleanTitle('x'.repeat(120)).length === 80, 'title pipeline caps at 80');

// qss-character-card cleanSynopsis:  strip "synopsis:" label → strip quotes → trim
const cleanSynopsis = (s) => {
  const labelStripped = String(s || '').replace(/^\s*synopsis\s*:\s*/i, '');
  return stripSurroundingQuotes(labelStripped).trim();
};
eq(cleanSynopsis('Synopsis: ‘a brave little owl’'), 'a brave little owl',
  'synopsis pipeline strips label then curly singles');
eq(cleanSynopsis('"A jokey three-sentence tale."'), 'A jokey three-sentence tale.',
  'synopsis pipeline strips straight doubles');
eq(cleanSynopsis("It's a story about Henry's owl."), "It's a story about Henry's owl.",
  'synopsis pipeline keeps internal apostrophes');

console.log(`strip-quotes: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
