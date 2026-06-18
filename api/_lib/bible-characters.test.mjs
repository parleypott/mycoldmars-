// Tests for api/_lib/bible-characters.js — the server-side bible character
// extractor that feeds the live QSS tutor's fixation detection
// (nano-banana.js handleTutor → detectFixation → blockSignals → extractCharacters).
//
// THE BUG (server mirror of the already-fixed client copy, commit 13d94ca):
// the old floor /\b[A-Z][a-zA-Z]{3,29}\b/ required a 4+ letter first token, so
// it silently dropped EVERY 3-letter character name — Max, Sam, Leo, Ben, Mia,
// Zoe, Ada, Ivy — the single most common kid naming pattern. A dropped name is
// never in detectFixation's known-character list, so the tutor's SAME_CHARACTER
// signal could never fire for a kid whose main character is 3 letters.
//
// Run: node api/_lib/bible-characters.test.mjs   (or `bun run test`)
import { extractBibleCharacters } from './bible-characters.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eqSet(actual, expected, msg) {
  const a = [...actual].sort().join('|');
  const e = [...expected].sort().join('|');
  ok(a === e, `${msg}\n    expected: [${e}]\n    actual:   [${a}]`);
}
function has(arr, name, msg) { ok(arr.includes(name), `${msg} — expected to include "${name}", got [${arr.join(', ')}]`); }
function lacks(arr, name, msg) { ok(!arr.includes(name), `${msg} — expected NOT to include "${name}", got [${arr.join(', ')}]`); }

// ─────────────────────────────────────────────────────────────
// THE FIX: 3-letter names are now recognized
// ─────────────────────────────────────────────────────────────
{
  const bible = 'The hero is Max. His friend Sam helps. Leo is the villain.';
  const r = extractBibleCharacters(bible);
  has(r, 'Max', 'recognizes 3-letter name Max');
  has(r, 'Sam', 'recognizes 3-letter name Sam');
  has(r, 'Leo', 'recognizes 3-letter name Leo');
}
for (const name of ['Ben', 'Mia', 'Zoe', 'Ada', 'Ivy', 'Kai', 'Eli', 'Ros']) {
  const r = extractBibleCharacters(`The main character is ${name} and they are brave.`);
  has(r, name, `recognizes common 3-letter name ${name}`);
}

// ── inline RED proof: the OLD 4-letter-floor logic dropped these ──
{
  function oldExtract(bible) {
    if (!bible || typeof bible !== 'string') return [];
    const out = new Set();
    const re = /\b([A-Z][a-zA-Z]{3,29}(?:\s+[A-Z][a-zA-Z]{2,29})?)\b/g;
    const STOP = new Set(['The', 'His']);
    let m;
    while ((m = re.exec(bible)) !== null) {
      const w = m[1];
      if (STOP.has(w.split(/\s/)[0])) continue;
      if (w.length < 4) continue;
      out.add(w);
    }
    return [...out];
  }
  const bible = 'The hero is Max. Leo is the villain.';
  ok(!oldExtract(bible).includes('Max'), 'RED proof: old floor-4 logic DROPPED Max');
  ok(!oldExtract(bible).includes('Leo'), 'RED proof: old floor-4 logic DROPPED Leo');
  ok(extractBibleCharacters(bible).includes('Max'), 'GREEN: new logic keeps Max');
  ok(extractBibleCharacters(bible).includes('Leo'), 'GREEN: new logic keeps Leo');
}

// ─────────────────────────────────────────────────────────────
// GRAMMAR GUARD: the lower floor must NOT leak grammar/pronoun words
// (a leaked pronoun = a false recurring "character" = false fixation hint)
// ─────────────────────────────────────────────────────────────
{
  const bible = 'She went there. His plan was bold. And now they all ran. Who knew? But why?';
  const r = extractBibleCharacters(bible);
  for (const g of ['She', 'His', 'And', 'Now', 'They', 'Who', 'But', 'Why', 'The', 'Her', 'Was', 'Can']) {
    lacks(r, g, `grammar word "${g}" does not leak as a character`);
  }
}
// individual grammar words at sentence start, each in isolation
for (const g of ['She', 'His', 'Now', 'And', 'When', 'Then', 'Was', 'Will', 'Could', 'What', 'Which', 'Here', 'There', 'Just', 'Very', 'Every']) {
  const r = extractBibleCharacters(`${g} something happened in the school.`);
  lacks(r, g, `isolated grammar word "${g}" not surfaced`);
}

// ─────────────────────────────────────────────────────────────
// SALVAGE: a real name riding behind a grammar sentence-starter is kept
// ─────────────────────────────────────────────────────────────
{
  has(extractBibleCharacters('Now Max ran fast.'), 'Max', 'salvages name after grammar starter ("Now Max")');
  has(extractBibleCharacters('Then Sam laughed.'), 'Sam', 'salvages name after "Then"');
  has(extractBibleCharacters('And Leo agreed.'), 'Leo', 'salvages name after "And"');
  // two-word salvage: "Today Maxwell woke" -> Maxwell (the second token)
  has(extractBibleCharacters('Today Maxwell woke up.'), 'Maxwell', 'salvages multi-letter name after "Today"');
  // grammar-then-grammar yields nothing
  eqSet(extractBibleCharacters('And then they ran.'), [], 'grammar-then-grammar salvages nothing');
}

// ─────────────────────────────────────────────────────────────
// TWO-WORD NAMES still work
// ─────────────────────────────────────────────────────────────
{
  const r = extractBibleCharacters('Queen Scarlet rules the school. Mark Rober visits.');
  has(r, 'Queen Scarlet', 'two-word name Queen Scarlet');
  has(r, 'Mark Rober', 'two-word name Mark Rober');
}

// ─────────────────────────────────────────────────────────────
// REGRESSION LOCKS: surrounding behavior preserved
// ─────────────────────────────────────────────────────────────
ok(Array.isArray(extractBibleCharacters(null)) && extractBibleCharacters(null).length === 0, 'null -> []');
ok(extractBibleCharacters(undefined).length === 0, 'undefined -> []');
ok(extractBibleCharacters('').length === 0, 'empty string -> []');
ok(extractBibleCharacters(12345).length === 0, 'non-string -> []');
ok(extractBibleCharacters('all lowercase no names here').length === 0, 'no capitalized words -> []');
// dedupe: same name twice -> once
eqSet(extractBibleCharacters('Max ran. Max jumped. Max won.'), ['Max'], 'dedupes repeated name');
// two-letter capitalized token is NOT a name (floor is 3 chars total: 1 + {2,})
lacks(extractBibleCharacters('Hi there friend.'), 'Hi', 'two-letter capitalized token not surfaced');
// ordinary noun a kid might name a character (NOT in STOP) is kept
has(extractBibleCharacters('The dragon is named Sky.'), 'Sky', 'ordinary-noun name (Sky) kept — not a grammar word');
// hard cap at 30
{
  const many = Array.from({ length: 40 }, (_, i) => `Char${String.fromCharCode(65 + (i % 26))}${i}`).join(' ');
  ok(extractBibleCharacters(many).length <= 31, 'hard cap keeps result bounded (<=31)');
}

// ── MUTATION SENTINEL: prove the suite catches a regression to the old floor ──
// (documentation only — the real source mutation is run from the shell:
//  flip {2,29} back to {3,29} in bible-characters.js and this suite goes RED
//  on every 3-letter-name case above.)

console.log(`\nbible-characters.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
