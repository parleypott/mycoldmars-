/**
 * Tests for the QSS scene-break detector (api/qss-scene-breaks.js).
 *
 * Run: node qss-scene-breaks.test.mjs   (from api/)  — or via `bun run test`.
 *
 * First coverage of the two pure cores of Henry's illustration-break pipeline:
 *   - findExplicitCuts(text)  — deterministic regex pre-pass for movie cuts.
 *   - snapToSentenceStart(text, offset) — snaps a raw break offset (from the
 *     rule pass or the LLM) to a clean sentence/paragraph start so a picture
 *     never begins mid-word or mid-sentence.
 *
 * Bug fixed here: snapToSentenceStart's "confirm a real sentence start"
 * character class was /[A-Za-z”''”]/ — it listed only the RIGHT (closing)
 * double quote (twice) and straight apostrophes. It was MISSING the OPENING
 * quotes a dialogue sentence actually begins with: straight " and curly “ ‘.
 * The comment's intent ("a letter or quote") was right; the glyphs were wrong.
 * Henry's stories are full of dialogue beats — `Scarlet burst in. "Students!"
 * she announced.` — so a break that should land on the dialogue sentence
 * failed confirmation, kept scanning backward, and collapsed all the way to
 * offset 0 (the start of the whole block). The illustration break vanished.
 * Now the class includes opening quotes: /[A-Za-z0-9"'“”‘’]/.
 *
 * The RED proof below reproduces the OLD class against the real algorithm and
 * shows it snapping to 0; the shipped (fixed) function lands on the quote.
 */
import { findExplicitCuts, snapToSentenceStart } from './qss-scene-breaks.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${label}`); }
}
function eq(a, b, label) { ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── snapToSentenceStart: the dialogue-quote fix ─────────────────────────────
{
  // straight double quote opening the new sentence
  const t = 'Scarlet burst into the classroom and slammed the heavy wooden door. "Students!" she announced to everyone in the room.';
  const want = t.indexOf('"Students');
  const off = t.indexOf('she announced');
  eq(snapToSentenceStart(t, off), want, 'snaps to a straight-double-quote sentence start');
  ok(snapToSentenceStart(t, off) !== 0, 'does NOT collapse the break to 0 on a dialogue beat');
}
{
  // curly double quote opening
  const t = 'Scarlet burst into the classroom and slammed the heavy wooden door. “Students!” she announced to everyone in the room.';
  const want = t.indexOf('“Students');
  const off = t.indexOf('she announced');
  eq(snapToSentenceStart(t, off), want, 'snaps to a curly-double-quote sentence start');
}
{
  // curly single quote opening (some typographers use ‘ for dialogue)
  const t = 'He stared at the box for a very long uncertain moment indeed. ‘What is it?’ the boy finally whispered to nobody at all.';
  const want = t.indexOf('‘What');
  const off = t.indexOf('the boy finally');
  eq(snapToSentenceStart(t, off), want, 'snaps to a curly-single-quote sentence start');
}
{
  // straight single quote opening
  const t = 'He stared at the box for a very long uncertain moment indeed. \'What is it?\' the boy finally whispered to nobody at all.';
  const want = t.indexOf("'What");
  const off = t.indexOf('the boy finally');
  eq(snapToSentenceStart(t, off), want, 'snaps to a straight-single-quote sentence start');
}

// ── snapToSentenceStart: RED proof — the OLD class collapsed to 0 ───────────
{
  // Re-implement the algorithm EXACTLY but with the OLD (buggy) char class.
  // This is the pre-fix behavior — it must demonstrably snap to 0.
  function snapOLD(text, offset) {
    const fwd = Math.min(text.length - 1, offset + 150);
    for (let i = offset; i < fwd; i++) {
      if (text[i] === '\n') {
        let j = i + 1;
        while (j < text.length && (text[j] === '\n' || text[j] === '\r')) j++;
        while (j < text.length && /[⸻—–\-]/.test(text[j])) j++;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j < text.length && j > offset) return j;
      }
    }
    const lo = Math.max(0, offset - 400);
    for (let i = offset; i >= lo; i--) {
      if (i === 0) return 0;
      const c = text[i - 1];
      if (/[.!?]/.test(c) && /\s/.test(text[i] || '')) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j < text.length && /[A-Za-z”''”]/.test(text[j])) return j; // OLD class
      }
    }
    if (offset > 0 && /\S/.test(text[offset - 1] || '') && /\S/.test(text[offset] || '')) {
      let right = offset;
      while (right < text.length && /\S/.test(text[right])) right++;
      return right < text.length ? right : offset;
    }
    return offset;
  }
  const t = 'Scarlet burst into the classroom and slammed the heavy wooden door. "Students!" she announced to everyone in the room.';
  const off = t.indexOf('she announced');
  eq(snapOLD(t, off), 0, 'RED proof: OLD class collapses a dialogue beat to 0');
  ok(snapToSentenceStart(t, off) !== snapOLD(t, off), 'RED proof: fixed function differs from old');
}

// ── snapToSentenceStart: regressions (already-correct paths) ────────────────
{
  // plain letter-opened sentence still snaps correctly
  const t = 'The forklift rolled across the gym in silence and stopped. Everyone froze where they were standing and stared at it.';
  const want = t.indexOf('Everyone froze');
  const off = t.indexOf('froze where');
  eq(snapToSentenceStart(t, off), want, 'snaps to a plain letter sentence start');
}
{
  // forward paragraph snap: a newline within 150 chars wins, skipping separators
  const t = 'The boxes appeared on every desk that morning.\n\n⸻\n\nMeanwhile, far across the city the forklift waited patiently.';
  const off = 5; // inside the first paragraph
  const want = t.indexOf('Meanwhile');
  eq(snapToSentenceStart(t, off), want, 'forward-snaps past blank lines + ⸻ separator to next paragraph');
}
{
  // word-boundary fallback: only reachable when offset > 400 (otherwise the
  // backward scan hits i===0 and returns 0 first). Build a long punctuation-free
  // run of words; land mid-word past char 400 -> snap forward to end of that word.
  const t = ('alpha bravo charlie delta echo foxtrot golf hotel india juliet ').repeat(20); // ~1260 chars, no [.!?]
  const off = 600; // somewhere mid-stream
  const want = (() => { let r = off; while (r < t.length && /\S/.test(t[r])) r++; return r; })();
  ok(/\S/.test(t[off - 1]) && /\S/.test(t[off]), 'fixture: offset 600 is mid-word');
  eq(snapToSentenceStart(t, off), want, 'mid-word past 400 with no boundary -> end of the word (never mid-word)');
}
{
  // at offset 0 with no preceding boundary, returns 0
  const t = 'No punctuation here at all just words running on and on forever';
  eq(snapToSentenceStart(t, 0), 0, 'offset 0 returns 0');
}
{
  // a sentence boundary followed by whitespace then a digit-opened sentence is honored
  const t = 'They counted the loot in the dim and dusty back room. 3 gold coins glittered faintly in the corner of the chest.';
  const want = t.indexOf('3 gold');
  const off = t.indexOf('gold coins');
  eq(snapToSentenceStart(t, off), want, 'snaps to a digit-opened sentence start');
}

// ── findExplicitCuts: deterministic movie-cut pre-pass ──────────────────────
{
  const t = 'The students waited quietly at their desks for the lesson. Cut to: Mark Rober at his desk staring at a contract.';
  const cuts = findExplicitCuts(t);
  ok(cuts.length >= 1, 'detects a "Cut to:" cut');
  ok(cuts.every(c => c.source === 'rule'), 'all explicit cuts are source:rule');
  ok(cuts.every(c => c.offset > 0), 'cut offsets are all > 0');
  ok(cuts.some(c => /cut to/i.test(c.label)), 'cut label mentions "cut to"');
}
{
  const t = 'The boys argued about the plan for what felt like hours. Meanwhile, in the gym the forklift was being prepared.';
  const cuts = findExplicitCuts(t);
  ok(cuts.some(c => /meanwhile/i.test(c.label)), 'detects a "Meanwhile," cut');
}
{
  const t = 'Everyone went home tired and went straight to their beds. The next morning the whole school looked completely different.';
  const cuts = findExplicitCuts(t);
  ok(cuts.length >= 1, 'detects a "The next morning" time jump');
}
{
  // overlapping captures dedupe within 50 chars: "Cut to: X, three weeks earlier"
  const t = 'The students sat at their wide wooden desks waiting for class. Cut to: Mark Rober\'s studio, three weeks earlier and far away.';
  const cuts = findExplicitCuts(t);
  // Cut-to and three-weeks-earlier are within the same physical cut text (<50 chars)
  const offs = cuts.map(c => c.offset);
  const tooClose = offs.some((o, i) => i > 0 && o - offs[i - 1] < 50);
  ok(!tooClose, 'overlapping cut captures within 50 chars are deduped to one');
}
{
  // distinct adjacent cuts >50 chars apart are both kept. (Meanwhile must NOT
  // sit at index 0 — a cut at offset 0 is intentionally skipped.)
  const t = 'The gym was empty and dark and very quiet. Meanwhile, in the cafeteria the cooks worked hard at the stove. The next morning everyone returned to school.';
  const cuts = findExplicitCuts(t);
  ok(cuts.length >= 2, 'keeps two distinct cuts that are >50 chars apart');
}
{
  // a cut at the very start (idx<=0) is skipped
  const t = 'Cut to: the gym, where everything had already been quietly prepared for the big surprise that was coming very soon.';
  const cuts = findExplicitCuts(t);
  ok(cuts.every(c => c.offset > 0), 'a cut at idx 0 is skipped (offset must be > 0)');
}
{
  // lastIndex is reset — running twice yields identical results (global regex hygiene)
  const t = 'They waited and waited and waited some more in the hall. Cut to: the other room across the long quiet hallway.';
  const a = findExplicitCuts(t);
  const b = findExplicitCuts(t);
  eq(JSON.stringify(a), JSON.stringify(b), 'findExplicitCuts is idempotent (lastIndex reset)');
}
{
  // "Suddenly, Capitalized" is detected
  const t = 'The room was calm and quiet and nothing at all was happening. Suddenly, Scarlet kicked the heavy door wide open.';
  const cuts = findExplicitCuts(t);
  ok(cuts.some(c => /suddenly/i.test(c.label)), 'detects a "Suddenly, X" cut');
}
{
  // no cuts in plain prose
  const t = 'The afternoon drifted by gently and the children read their picture books in a warm and pleasant and uneventful silence.';
  const cuts = findExplicitCuts(t);
  eq(cuts.length, 0, 'plain prose with no cut markers -> no explicit cuts');
}
{
  // returned cuts are sorted by offset
  const t = 'They began the morning in the gym. Meanwhile, in the cafeteria the cooks worked hard. Later that day the bell finally rang loudly.';
  const cuts = findExplicitCuts(t);
  const sorted = cuts.every((c, i) => i === 0 || c.offset >= cuts[i - 1].offset);
  ok(sorted, 'cuts are returned sorted by offset');
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(fails.join('\n'));
console.log(`\nqss-scene-breaks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
