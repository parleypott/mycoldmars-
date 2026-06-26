/**
 * Tests for the QSS fixation/escalation signals (api/_lib/qss-signals.js).
 *
 * Run: node qss-signals.test.mjs   (from api/_lib/)  — or via `bun run test`.
 *
 * Headline bug (fixed): detectFixation()'s ESCALATION_RUN detector used a
 * non-decreasing (>=) run check, while its own comment said "strictly
 * monotonic upward" and its hint told Wordy the score "climbed every block."
 * So a FLAT steady-state of violence (e.g. escalation 5,5,5 across three
 * blocks) falsely fired ESCALATION_RUN and the "Henry is in a make-it-more-
 * extreme loop, propose something that DEFUSES" hint — a wrong creative note
 * pushed at a kid's tutor when the story was actually holding steady.
 *
 * The fix: a run counts as escalation only if it is (a) non-decreasing for
 * 3+ blocks AND (b) shows a NET increase end-over-start. Steady-high content
 * is still surfaced by EXTREME_DENSITY; ESCALATION_RUN now means specifically
 * "trending up." This file locks both the fix and the surrounding signal logic.
 */
import {
  detectFixation,
  blockSignals,
  escalationScore,
  wordCount,
  sentenceCount,
  extractCharacters,
  categoryHits,
  detectSettings,
  escapeRegExp,
} from './qss-signals.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}

const B = (text) => ({ text });
const hasEscalationRun = (res) => res.flags.some(f => f.startsWith('ESCALATION_RUN'));
const hintMentionsLoop = (res) => res.hints.some(h => /make it more extreme/i.test(h));

// Texts engineered to hit known escalation densities (extreme words / words * 100).
// LOW   = 1 extreme word in 10 words  → 10.0
// MED   = 2 extreme words in 10 words → 20.0
// HIGH  = 4 extreme words in 10 words → 40.0
const LOW  = 'the bomb went off in the old back room over there';   // bomb(1) / 10 = 10.0
const MED  = 'the bomb exploded inside the small back room just now';// bomb,exploded(2)/10 = 20.0
const HIGH = 'the bomb exploded and the missile destroyed every last room'; // bomb,exploded,missile,destroyed(4)/11

// Sanity: confirm the escalation densities are ordered as intended.
ok(escalationScore(LOW) < escalationScore(MED), 'LOW density < MED density (fixture sanity)');
ok(escalationScore(MED) < escalationScore(HIGH), 'MED density < HIGH density (fixture sanity)');
ok(escalationScore(LOW) === escalationScore(LOW), 'identical text yields identical score (flat fixture)');

// ── HEADLINE BUG: a FLAT profile must NOT fire ESCALATION_RUN ──────────────
const flat = detectFixation([B(MED), B(MED), B(MED)]);
ok(!hasEscalationRun(flat),
   'BUG: flat steady escalation (5,5,5-style) does NOT fire ESCALATION_RUN (was a false positive under >=)');
ok(!hintMentionsLoop(flat),
   'BUG: flat profile does NOT push the "make it more extreme loop / defuse" hint');
// The flat-but-high case is still surfaced — just by the right signal.
ok(flat.flags.some(f => f.startsWith('EXTREME_DENSITY')),
   'flat high-violence is still caught by EXTREME_DENSITY (coverage not lost)');

// ── Genuine escalation (rising) STILL fires (regression lock) ─────────────
const rising = detectFixation([B(LOW), B(MED), B(HIGH)]);
ok(hasEscalationRun(rising),
   'rising escalation (10→20→40) fires ESCALATION_RUN');
ok(hintMentionsLoop(rising),
   'rising escalation pushes the defuse hint');

// ── Plateau-then-rise still counts (net increase across the run) ──────────
const plateauRise = detectFixation([B(LOW), B(LOW), B(HIGH)]);
ok(hasEscalationRun(plateauRise),
   'plateau-then-rise (10,10,40) fires — net increase across the run');

// ── Rise-then-plateau still counts (it did climb net) ─────────────────────
const risePlateau = detectFixation([B(LOW), B(HIGH), B(HIGH)]);
ok(hasEscalationRun(risePlateau),
   'rise-then-plateau (10,40,40) fires — net rise over the span');

// ── DESCENDING never fires ────────────────────────────────────────────────
const falling = detectFixation([B(HIGH), B(MED), B(LOW)]);
ok(!hasEscalationRun(falling),
   'descending escalation (40→20→10) does NOT fire ESCALATION_RUN');

// ── A run broken by a dip is too short to fire ────────────────────────────
// [HIGH, LOW, MED] → 40,10,20: the non-decreasing run from the end is only
// 2 blocks (10→20); the 40→10 dip breaks it, so no ESCALATION_RUN.
const brokenRun = detectFixation([B(HIGH), B(LOW), B(MED)]);
ok(!hasEscalationRun(brokenRun),
   'a run broken by a dip (40,10,20) is too short to fire ESCALATION_RUN (needs 3+)');

// ── Calm → escalating across 3 blocks IS a genuine climb (should fire) ────
const calmToRise = detectFixation([B('a calm quiet ordinary day with nothing happening at all'), B(LOW), B(HIGH)]);
ok(hasEscalationRun(calmToRise),
   'calm→low→high (0,10,40) fires — a real escalation trajectory from a calm start');

// ── Guard: fewer than 3 blocks returns the empty shape ────────────────────
const tooFew = detectFixation([B(HIGH), B(HIGH)]);
ok(tooFew.fixating === false && !hasEscalationRun(tooFew.flags ? tooFew : { flags: [] }),
   '<3 blocks → not fixating, no escalation flag');
ok(detectFixation([]).fixating === false, 'empty blocks → not fixating');
ok(detectFixation(null).fixating === false, 'null blocks → not fixating');

// ── signals payload still exposes the trajectory for reports ──────────────
ok(Array.isArray(rising.signals.escalations) && rising.signals.escalations.length === 3,
   'signals.escalations is the per-block trajectory array');
ok(rising.signals.escalationRun >= 3, 'signals.escalationRun reflects the run length on a real climb');

// ── SAME_CHARACTER / SAME_SETTING still detected (no regression) ──────────
const charFix = detectFixation([
  B('Scarlet roared across the cafeteria'),
  B('Scarlet flew over the cafeteria again'),
  B('Scarlet landed in the cafeteria once more'),
  B('Scarlet glared around the cafeteria'),
]);
ok(charFix.flags.some(f => f.startsWith('SAME_CHARACTER:')),
   'a character appearing in 4/4 recent blocks fires SAME_CHARACTER');
ok(charFix.flags.some(f => f.startsWith('SAME_SETTING:cafeteria')),
   'the same setting across 4 blocks fires SAME_SETTING');

// ── blockSignals shape (the per-block observation bundle) ─────────────────
const bs = blockSignals('Scarlet exploded the quiet cafeteria');
ok(typeof bs.words === 'number' && bs.words > 0, 'blockSignals.words is a positive count');
ok(bs.characters.includes('Scarlet'), 'blockSignals.characters detects canon names');
ok(bs.settings.includes('cafeteria'), 'blockSignals.settings detects the setting');
ok(typeof bs.escalation === 'number', 'blockSignals.escalation is numeric');

// ── helper sanity (locks the building blocks the detector relies on) ──────
ok(wordCount('one two three') === 3, 'wordCount counts whitespace-delimited tokens');
ok(wordCount('') === 0, 'wordCount of empty is 0');
ok(sentenceCount('Hi! Bye? Done.') === 3, 'sentenceCount counts terminators');
ok(sentenceCount('no terminator') === 1, 'sentenceCount of a fragment is 1');
ok(extractCharacters('Kevin and Benny fought').includes('Kevin'), 'extractCharacters finds Kevin');
ok(!extractCharacters('the marketing scheme').includes('Mark Rober'), 'extractCharacters does not false-match substrings');
ok((categoryHits('she whispered quietly').quiet || 0) >= 2, 'categoryHits tallies quiet words');
ok(detectSettings('in the library by the shelves').includes('library'), 'detectSettings finds the library');

// ── categoryHits: all four buckets tally, not just 'quiet' ────────────────
// (Only 'quiet' was covered before; extreme/loud/comedic drove escalation and
// the EXTREME_DENSITY hint with zero direct coverage.)
ok((categoryHits('bomb explosion kill').extreme || 0) === 3,
   'categoryHits tallies extreme verbs (bomb/explosion/kill = 3)');
ok((categoryHits('yelled shouting screaming').loud || 0) === 3,
   'categoryHits tallies loud verbs (yelled/shouting/screaming = 3)');
ok((categoryHits('he tripped and giggled').comedic || 0) === 2,
   'categoryHits tallies comedic verbs (tripped/giggled = 2)');

// ── categoryHits matches WHOLE WORDS only (the \b boundary) ────────────────
// 'fire' is an extreme verb, but it must NOT fire inside 'firefighter'.
// This locks the word-boundary behavior the \b-anchored matcher relies on —
// a substring match here would over-count escalation on innocent prose.
ok((categoryHits('the brave firefighter arrived on the truck').extreme || 0) === 0,
   'categoryHits does NOT substring-match "fire" inside "firefighter" (whole-word only)');

// ── escalationScore weights LOUD at half of EXTREME (the 0.5 coefficient) ──
// Untested until now: escalationScore = (extreme + loud*0.5) / words. At an
// equal word count, a pure-LOUD block must score exactly HALF a pure-EXTREME
// block. This is the coefficient that decides whether yelling alone is enough
// to nudge ESCALATION_RUN — getting it wrong mis-calibrates Henry's tutor.
const loudOnly    = escalationScore('yelled shouting screaming');         // (0 + 3*0.5)/3 = 50.0
const extremeOnly = escalationScore('bomb explosion kill');               // (3 + 0)/3      = 100.0
ok(loudOnly > 0, 'pure-loud text still produces a positive escalation score');
ok(loudOnly < extremeOnly, 'pure-loud scores below equal-count pure-extreme');
ok(loudOnly * 2 === extremeOnly, 'loud is weighted at exactly half of extreme (the 0.5 coefficient)');

// ── regex-metachar safety: both word matchers escape their vocabulary ─────
// extractCharacters (proper-noun matcher) escaped its words; its twin
// categoryHits did NOT — it interpolated the raw category word into a
// `\b…\b` regex. Both now funnel through the shared escapeRegExp so a future
// lexeme carrying a metachar can't crash the signal pass or mis-match.
//
// Why this matters: a single bad word silently kills the WHOLE tutor-signal
// pass. 'C++ club' as a setting verb, 'K.O.' as a comedic beat, a name like
// 'Dr. Periwinkle' — any of them turns `new RegExp('\\b' + w + '\\b')` into
// either a SyntaxError (unbalanced '(' / dangling '+') or a '.'-matches-any
// over-count. Escaping makes the word match literally.

// escapeRegExp neutralizes every JS regex metacharacter.
ok(escapeRegExp('Dr. Periwinkle') === 'Dr\\. Periwinkle',
   'escapeRegExp escapes the dot in a name');
ok(escapeRegExp('a+b') === 'a\\+b', 'escapeRegExp escapes +');
ok(escapeRegExp('(x)') === '\\(x\\)', 'escapeRegExp escapes parens');
ok(escapeRegExp('plain') === 'plain', 'escapeRegExp leaves plain words untouched (no-op)');

// End-to-end through categoryHits with an INJECTED metachar-bearing lexicon.
// 'a(b' carries an unbalanced '(' — raw interpolation builds the invalid
// pattern `\ba(b\b` and THROWS SyntaxError (unterminated group), killing the
// whole signal pass. The escaped matcher builds `\ba\(b\b` and counts the
// literal token. This is the mutation sentinel: revert escapeRegExp to an
// identity passthrough and this block goes RED (throws), proving the escape
// is load-bearing.
let metacharThrew = false;
let metacharHits = null;
try {
  metacharHits = categoryHits('the a(b club met and the a(b club cheered',
                              { tech: ['a(b'] });
} catch (e) { metacharThrew = true; }
ok(!metacharThrew, 'categoryHits does not throw on a category word with a regex metachar');
ok(metacharHits && (metacharHits.tech || 0) === 2,
   'categoryHits counts the literal "a(b" token twice (metachar matched literally, not parsed as a group)');

// A metachar word must match LITERALLY, not as a regex: '.' must not match
// any character. 'a.b' should hit 'a.b' but NOT 'axb'.
ok((categoryHits('a.b and a.b again', { dotted: ['a.b'] }).dotted || 0) === 2,
   'categoryHits matches "a.b" literally (two real hits)');
ok((categoryHits('axb only', { dotted: ['a.b'] }).dotted || 0) === 0,
   'categoryHits does NOT let "a.b" wildcard-match "axb" (dot is escaped)');

// Default lexicon still behaves: passing no cats arg uses CATEGORIES.
ok((categoryHits('bomb explosion kill').extreme || 0) === 3,
   'categoryHits default lexicon unchanged after the cats param was added');

// ── report ────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-signals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
