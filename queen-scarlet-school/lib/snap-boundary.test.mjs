// Tests for snapBreakToCleanBoundary() in queen-scarlet-school/index.html — the
// CLIENT-side "final safety net" that snaps an auto scene-break offset to a clean
// paragraph/sentence boundary in the QSS Storybook reader (runs on EVERY auto break
// placed in detectSceneBreaksForAllBlocks). Extracts the ACTUAL shipped function from
// index.html at runtime (strongest signal — can't drift from a hand-copied mirror).
//
// BUG (divergent copy of the server fix cb57661): the backward sentence-start scan
// confirmed a real boundary with /[A-Za-z"'"]/ — straight quotes only (the double was
// even listed twice), MISSING the curly OPENING quotes “ ‘ that a dialogue beat actually
// begins with under smart-quote styling, plus digits. Henry's stories are wall-to-wall
// dialogue, so a break meant to land on `. “Students!”` failed confirmation and the scan
// overshot to an earlier (worse) boundary. Fix widens the class to /[A-Za-z0-9"'“”‘’]/,
// matching the server's snapToSentenceStart exactly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFn() {
  const m = HTML.match(/function snapBreakToCleanBoundary\(text, offset\) \{[\s\S]*?\n    \}\n/);
  if (!m) throw new Error('could not locate snapBreakToCleanBoundary in index.html');
  return m[0];
}
const snapBreakToCleanBoundary = new Function(extractFn() + '\nreturn snapBreakToCleanBoundary;')();

// The OLD (buggy) implementation, for the RED proof — straight-quote-only confirm class,
// no opening curly quotes, no digits. Mirrors the pre-fix source byte-for-byte.
const snapOLD = (function () {
  return function snapBreakToCleanBoundary(text, offset) {
    if (offset <= 0 || offset >= text.length) return offset;
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
    const lo = Math.max(0, offset - 300);
    for (let i = offset; i >= lo; i--) {
      if (i === 0) return 0;
      if (/[.!?]/.test(text[i - 1]) && /\s/.test(text[i] || '')) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (j < text.length && /[A-Za-z"'"]/.test(text[j])) return j;
      }
    }
    if (/\S/.test(text[offset - 1] || '') && /\S/.test(text[offset] || '')) {
      let right = offset;
      while (right < text.length && /\S/.test(text[right])) right++;
      return right < text.length ? right : offset;
    }
    return offset;
  };
})();

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ── Inline RED proof: the OLD class fails on a curly-quote dialogue beat ──
// "The end. “New scene starts here." — the offset sits inside the 2nd sentence;
// the backward scan should snap to the “ that opens the dialogue, but the old class
// rejects “ and overshoots to the start of "The end." (offset 0).
{
  const text = 'The end. “New scene starts here and goes on for a while so forward paragraph never matches.';
  const offset = 40; // somewhere inside the 2nd sentence, > 150-char forward window has no \n
  const oldRes = snapOLD(text, offset);
  const idxCurly = text.indexOf('“');
  ok(oldRes !== idxCurly, 'RED: old class does NOT snap to the curly-opening dialogue beat');
  // new (shipped) snaps exactly to the “ that opens the dialogue sentence
  eq(snapBreakToCleanBoundary(text, offset), idxCurly, 'NEW: snaps to the curly-opening dialogue beat');
}

// ── The fix across all four curly quotes + straight quotes + digit openings ──
const openers = [
  ['“', 'left double curly'],
  ['‘', 'left single curly'],
  ['”', 'right double curly'],   // matched by server class too (kept for parity)
  ['’', 'right single curly'],
  ['"', 'straight double'],
  ["'", 'straight single'],
];
for (const [q, name] of openers) {
  const text = `First sentence ends here. ${q}Dialogue or quote opens the next sentence and runs long enough that the forward paragraph scan finds nothing.`;
  const idx = text.indexOf(q);
  eq(snapBreakToCleanBoundary(text, idx + 5), idx, `snaps to sentence opening with ${name}`);
}
// digit opening (e.g. "1962 was the year.")
{
  const text = 'It happened long ago. 1962 was the year everything changed for the country and its people forever.';
  const idx = text.indexOf('1962');
  eq(snapBreakToCleanBoundary(text, idx + 6), idx, 'snaps to sentence opening with a digit');
}

// ── No-regression: behavior the OLD code already got right is unchanged ──
// A plain-letter sentence opening — both old and new must agree.
{
  const text = 'Alpha beta gamma. Delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau.';
  const idx = text.indexOf('Delta');
  eq(snapBreakToCleanBoundary(text, idx + 4), idx, 'plain-letter opening still snaps to sentence start');
  eq(snapBreakToCleanBoundary(text, idx + 4), snapOLD(text, idx + 4), 'plain-letter case: new === old');
}
// Forward paragraph snap (a \n\n within 150 chars wins before backward scan).
{
  const text = 'Some prose here that is the tail of a paragraph.\n\nThe next paragraph begins cleanly right here.';
  const nlIdx = text.indexOf('\n');
  const res = snapBreakToCleanBoundary(text, nlIdx - 3);
  eq(res, text.indexOf('The next paragraph'), 'forward paragraph break wins');
  eq(res, snapOLD(text, nlIdx - 3), 'forward paragraph case: new === old');
}
// Forward snap skips visual separators (⸻ — –) after the newline.
{
  const text = 'Tail of paragraph here.\n⸻\nFresh scene opens after the separator and continues onward.';
  const res = snapBreakToCleanBoundary(text, 10);
  eq(res, text.indexOf('Fresh scene'), 'forward snap skips ⸻ separator');
}
// Edge guards: offset <= 0 or >= length returns offset unchanged.
eq(snapBreakToCleanBoundary('abc', 0), 0, 'offset 0 returned unchanged');
eq(snapBreakToCleanBoundary('abc', 3), 3, 'offset == length returned unchanged');
eq(snapBreakToCleanBoundary('abc', 9), 9, 'offset > length returned unchanged');
// Backward scan hits start-of-text when no sentence boundary precedes the offset.
{
  const text = 'aaaaaaaaaa bbbbbbbbbb cccccccccc';
  eq(snapBreakToCleanBoundary(text, 3), 0, 'no preceding boundary → snaps to start of text');
}
// Word-end fallback: offset > 300 (so lo > 0, the i===0 return is unreachable) and no
// sentence boundary in the 300-char backward window → snap forward to the next word end.
{
  const word = 'wordwordword '; // 13 chars, no . ! ? \n
  const text = word.repeat(40); // 520 chars, all spaces/letters
  const offset = 405; // lands inside a word, > 300 from a boundary, no \n forward
  const res = snapBreakToCleanBoundary(text, offset);
  ok(res > offset, 'word-end fallback snaps forward to a word boundary');
  ok(/\s/.test(text[res] || '') || res === text.length, 'word-end fallback lands at end of the word');
}

// ── Parity lock: the shipped confirm class equals the server's exactly ──
{
  const src = extractFn();
  ok(src.includes("/[A-Za-z0-9\"'“”‘’]/"), 'shipped class matches server snapToSentenceStart (cb57661)');
  ok(!/\[A-Za-z"'"\]/.test(src), 'old straight-quote-only class is gone');
}

console.log(`snap-boundary: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
