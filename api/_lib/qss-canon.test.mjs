/**
 * Tests for the QSS canon matcher (api/_lib/qss-canon.js).
 *
 * Run: node qss-canon.test.mjs   (from api/_lib/)
 *
 * Headline bug (fixed): findCanonCharactersInText() / canonForName() matched
 * ONLY the full canonical key ("queen scarlet"), via substring includes(). But
 * Henry almost always writes just "Scarlet". So whenever he used the short
 * name, the canon overlay — including the load-bearing "never draw her as a
 * cute cartoon mascot" guardrail — silently dropped, and the image generator
 * (nano-banana) was free to render the forbidden mascot version.
 *
 * The fix: declare aliases on the canon entry and match the key + every alias
 * with whole-word (\b) boundaries (so "scarlet" still doesn't fire inside
 * "scarletina"). Same \b discipline as the b-roll and voice-segmenter fixes.
 */
import {
  findCanonCharactersInText,
  canonForName,
  canonContextBlock,
  QSS_CANON,
} from './qss-canon.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

const names = (text) => findCanonCharactersInText(text).map(c => c.name);

// ── Headline: the short name "Scarlet" now resolves to canon ──────────────
ok(names('Scarlet breathed fire on the cafeteria').includes('Queen Scarlet'),
   'BUG: bare "Scarlet" matches the canon entry (was missed by includes("queen scarlet"))');
ok(names('the scarlet dragon glared').includes('Queen Scarlet'),
   'BUG: lowercase "scarlet" matches too (case-insensitive)');

// The whole point — the matched entry carries the must-not-draw-cute guardrail
const scarletHit = findCanonCharactersInText('Scarlet roared')[0];
ok(scarletHit && /cartoon mascot/i.test(scarletHit.donts || ''),
   'short-name match still carries the "never draw her as a cartoon mascot" guardrail');

// ── Full canonical name still works (no regression) ───────────────────────
ok(names('Queen Scarlet stomped into assembly').includes('Queen Scarlet'),
   'full name "Queen Scarlet" still matches');
ok(names('QUEEN SCARLET was furious').includes('Queen Scarlet'),
   'upper-cased full name still matches');

// ── Returns the CANONICAL name, never the alias the text happened to use ──
// Downstream canonContextBlock() filters by canonical name, so this matters.
ok(JSON.stringify(names('Scarlet')) === JSON.stringify(['Queen Scarlet']),
   'returns canonical "Queen Scarlet" even when text used the alias "Scarlet"');

// ── Dedupe: key + alias in the same text yields ONE entry ─────────────────
ok(names('Queen Scarlet glared. Then Scarlet roared again.').length === 1,
   'key + alias in one text dedupes to a single canon entry');

// ── Word-boundary: no false substring matches ─────────────────────────────
ok(names('scarletina the firefly buzzed').length === 0,
   'word-boundary: "scarlet" does NOT fire inside "scarletina"');
ok(names('a scarlett ribbon fluttered').length === 0,
   'word-boundary: "scarlet" does NOT fire inside the name "Scarlett"');
ok(names('the masquerade ball began').length === 0,
   'unrelated text matches nothing');
ok(names('').length === 0, 'empty text → no matches');
ok(findCanonCharactersInText(null).length === 0, 'null text → no matches');

// ── canonForName resolves aliases ─────────────────────────────────────────
ok(canonForName('Scarlet') === QSS_CANON.characters['queen scarlet'],
   'BUG: canonForName("Scarlet") resolves the alias to the canon entry');
ok(canonForName('scarlet  ') === QSS_CANON.characters['queen scarlet'],
   'canonForName trims + lowercases the alias');
ok(canonForName('Queen Scarlet') === QSS_CANON.characters['queen scarlet'],
   'canonForName still resolves the full canonical name');
ok(canonForName('Benny') === null, 'canonForName returns null for an unknown name');
ok(canonForName('') === null, 'canonForName("") returns null');
ok(canonForName(null) === null, 'canonForName(null) returns null');

// ── canonContextBlock accepts canonical name AND alias ────────────────────
ok(/red dragon/i.test(canonContextBlock(['Queen Scarlet'])),
   'canonContextBlock(["Queen Scarlet"]) emits the species line');
ok(/cartoon mascot/i.test(canonContextBlock(['Scarlet'])),
   'canonContextBlock(["Scarlet"]) (alias) also emits the must-not guardrail');
ok(canonContextBlock([]).includes('WORLD CANON'),
   'canonContextBlock([]) still emits world canon with no character filter');
ok(!/red dragon/i.test(canonContextBlock(['Benny'])),
   'canonContextBlock(["Benny"]) emits no character canon for an unknown name');

// ── Report ────────────────────────────────────────────────────────────────
console.log(`\nqss-canon: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
