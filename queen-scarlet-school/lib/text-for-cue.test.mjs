// Tests for textForCue() in queen-scarlet-school/index.html — the load-bearing,
// Henry-FACING function that decides WHAT TEXT GETS SPOKEN for each storybook cue
// during read-aloud. For each cue it slices block.text between this cue's offset and
// the next cue's offset (last cue → end of block), so a regression here makes the
// TTS read the WRONG words to Henry — silently. Zero prior coverage.
//
// This is a verifier-layer LOCK (no live bug found — the slicing is correct), built
// the same way as snap-boundary / parse-bible-characters: it EXTRACTS the ACTUAL
// shipped function from index.html at runtime (strongest signal — can't drift from a
// hand-copied mirror). textForCue's only free variable is `state`, so it's wrapped in
// a `new Function('state', ...)` factory and bound to a test-provided { blocks }.
//
// LATENT EDGE CASES found while locking (NOT changed — degenerate inputs, and the
// doctrine says don't touch working Henry-facing code unattended; logged for Johnny):
//   1. `end = cues[i+1].offset || block.text.length` is a truthy-zero trap — if a
//      NON-FIRST cue had offset 0 (degenerate: two cues at position 0) the `|| len`
//      would read to end-of-block instead of to 0. Real cues have distinct ascending
//      offsets so this can't fire today.
//   2. A cue whose id is NOT in its own block.__cues (myIdx === -1) slices [0, firstOffset]
//      — the leading text before cue 0. Unreachable normally (cues derive from blocks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Brace-matched extraction (bulletproof vs a lazy regex — the function has a nested if).
function extractFn() {
  const marker = 'function textForCue(cue) {';
  const start = HTML.indexOf(marker);
  if (start < 0) throw new Error('could not locate textForCue in index.html');
  let i = HTML.indexOf('{', start);
  let depth = 0;
  for (; i < HTML.length; i++) {
    const ch = HTML[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}
// Factory: bind the extracted function to a provided `state` closure.
const makeTextForCue = new Function('state', extractFn() + '\nreturn textForCue;');
// Convenience: build a textForCue over a given blocks array.
const make = (blocks) => makeTextForCue({ blocks });

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// ── Fixtures ──────────────────────────────────────────────────────────────
// "Hello world. " is exactly 13 chars; "Goodbye" begins at index 13.
const TWO = {
  id: 'b1',
  text: 'Hello world. Goodbye now.',
  __cues: [
    { id: 'c1', blockId: 'b1', offset: 0 },
    { id: 'c2', blockId: 'b1', offset: 13 },
  ],
};
const tfTwo = make([TWO]);

// ── 1. consecutive-cue slice: first cue reads [0, nextOffset) ────────────────
eq(tfTwo(TWO.__cues[0]), 'Hello world.', 'first cue slices to next offset');
// ── 2. last cue reads to end of block ───────────────────────────────────────
eq(tfTwo(TWO.__cues[1]), 'Goodbye now.', 'last cue slices to end of block');

// ── 3. middle cue of three: slice between own offset and next offset ─────────
// "AAA. " = 5 chars; "BBB. " next 5; "CCC." last.
const THREE = {
  id: 'b2',
  text: 'AAA. BBB. CCC.',
  __cues: [
    { id: 'm1', blockId: 'b2', offset: 0 },
    { id: 'm2', blockId: 'b2', offset: 5 },
    { id: 'm3', blockId: 'b2', offset: 10 },
  ],
};
const tfThree = make([THREE]);
eq(tfThree(THREE.__cues[0]), 'AAA.', 'three-cue: first');
eq(tfThree(THREE.__cues[1]), 'BBB.', 'three-cue: middle slices own→next');
eq(tfThree(THREE.__cues[2]), 'CCC.', 'three-cue: last reads to end');

// ── 4. cue offsets given OUT OF ORDER are sorted before slicing ──────────────
const UNSORTED = {
  id: 'b3',
  text: 'Hello world. Goodbye now.',
  __cues: [
    { id: 'u2', blockId: 'b3', offset: 13 },
    { id: 'u1', blockId: 'b3', offset: 0 },
  ],
};
const tfUnsorted = make([UNSORTED]);
eq(tfUnsorted(UNSORTED.__cues[1]), 'Hello world.', 'unsorted __cues: offset-0 cue still slices [0,13)');
eq(tfUnsorted(UNSORTED.__cues[0]), 'Goodbye now.', 'unsorted __cues: offset-13 cue still reads to end');

// ── 5. source_text fallback when the block is missing ────────────────────────
eq(make([])({ id: 'x', blockId: 'gone', source_text: 'Fallback text here' }),
  'Fallback text here', 'missing block → source_text fallback (len>4)');
eq(make([])({ id: 'x', blockId: 'gone', source_text: '  Fallback text here  ' }),
  'Fallback text here', 'missing block → source_text fallback is trimmed');
// ── 6. fallback NOT used when source_text is too short (<=4 after trim) ───────
eq(make([])({ id: 'x', blockId: 'gone', source_text: 'hi' }), '', 'short source_text (<=4) → empty');
eq(make([])({ id: 'x', blockId: 'gone' }), '', 'missing block + no source_text → empty');
// block present but no text → source_text fallback path
eq(make([{ id: 'b4', text: '' }])({ id: 'c', blockId: 'b4', source_text: 'long enough text' }),
  'long enough text', 'block with empty text → source_text fallback');

// ── 7. null / undefined cue → '' ─────────────────────────────────────────────
eq(tfTwo(null), '', 'null cue → empty');
eq(tfTwo(undefined), '', 'undefined cue → empty');

// ── 8. result is trimmed ─────────────────────────────────────────────────────
const PAD = {
  id: 'b5',
  text: '   spaced out.   tail.',
  __cues: [
    { id: 'p1', blockId: 'b5', offset: 0 },
    { id: 'p2', blockId: 'b5', offset: 16 },
  ],
};
const tfPad = make([PAD]);
eq(tfPad(PAD.__cues[0]), 'spaced out.', 'leading/trailing whitespace trimmed from slice');

// ── 9. single-cue block reads the whole text ─────────────────────────────────
const ONE = { id: 'b6', text: 'Only one cue here.', __cues: [{ id: 's1', blockId: 'b6', offset: 0 }] };
eq(make([ONE])(ONE.__cues[0]), 'Only one cue here.', 'single cue → whole block text');

// ── RED PROOF: a slice-from-start-only variant (drops the `end` arg) would read the
// WHOLE block for the first cue instead of stopping at the next offset. The shipped
// function must NOT behave like this. ─────────────────────────────────────────
const brokenWholeBlock = tfTwo(TWO.__cues[0]) === TWO.text;
eq(brokenWholeBlock, false, 'RED proof: first cue must NOT return the whole block (slice has an end)');

console.log(`\ntext-for-cue: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
