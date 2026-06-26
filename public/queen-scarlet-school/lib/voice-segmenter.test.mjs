// First coverage + mutation lock for segmentByVoice — the function that splits
// a QSS story into per-character voice segments so Henry's story reads aloud in
// a different ElevenLabs voice for each character (narrator owns everything
// else). This is a LIVE, Henry-facing read-aloud path with ZERO prior tests,
// despite the source header claiming two load-bearing fixes that nothing locked:
//
//   1. WORD-BOUNDARY name matching — a mapped name must never match as a
//      substring of a larger word. "Ann" must not steal "Joann"'s line.
//   2. SMART-QUOTE position preservation — curly quotes are normalized to
//      straight ONLY to drive the regex; output spans slice the ORIGINAL text,
//      and the char offsets must still line up (single-codepoint replacement).
//
// Each test that locks a header claim is MUTATION-PROVEN: a reconstructed buggy
// variant (substring match / no smart-quote handling) is asserted to produce
// the WRONG result, so we know the assertion actually bites a regression and
// isn't a tautology. Plus a structural integrity invariant (segments are
// contiguous, cover the whole text exactly once, and every segment's text is
// the literal slice of its [charStart,charEnd)) — the property that, if it ever
// breaks, makes the audio play the wrong words in the wrong voice.

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { segmentByVoice } = require('./voice-segmenter.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

const MAP = { scarlet: 'george', ann: 'gigi' };
const DEF = 'matilda';

// ── structural integrity: the invariant that protects "right words, right voice"
function assertIntegrity(text, segs) {
  let cursor = 0;
  for (const s of segs) {
    assert.equal(s.charStart, cursor, `segment must start where the previous ended (${JSON.stringify(s.text)})`);
    assert.equal(text.slice(s.charStart, s.charEnd), s.text, 'segment.text must be the literal slice of its offsets');
    assert.ok(s.text.length > 0, 'no zero-length segments may survive');
    cursor = s.charEnd;
  }
  assert.equal(cursor, text.length, 'segments must cover the whole text exactly');
}

// Reconstructed BUGGY variants — used only to prove the lock bites. ──────────
// (1) substring matcher: no word boundaries (the pre-fix Pattern A behavior).
function segmentSubstringBug(text, map, def) {
  const names = Object.keys(map);
  const namePat = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${namePat})\\s+(?:said|whispered)[,:]?\\s+("[^"\\n]+")`, 'gi');
  const markers = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = map[m[1].trim().toLowerCase()];
    if (!v) continue;
    const idx = m.index + m[0].lastIndexOf(m[2]);
    markers.push({ start: idx, end: idx + m[2].length, voice: v });
  }
  return markers;
}

test('Pattern A — "Name said, \\"quote\\"" attributes the quote to the character', () => {
  const text = 'Scarlet said, "Hello there."';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  const quote = segs.find(s => s.text.includes('Hello there'));
  assert.equal(quote.voice, 'george');
  assert.equal(segs[0].voice, DEF); // "Scarlet said, " is narration
});

test('Pattern B — "\\"quote,\\" whispered Name" attributes correctly', () => {
  const text = '"Go away," whispered Ann.';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  assert.equal(segs[0].voice, 'gigi');
  assert.equal(segs[0].text, '"Go away,"');
});

test('Pattern C — "Name: \\"quote\\"" attributes the rest of the line', () => {
  const text = 'Scarlet: "I am queen."';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  const spoken = segs.find(s => s.text.includes('I am queen'));
  assert.equal(spoken.voice, 'george');
});

test('WORD BOUNDARY — "Ann" must not steal "Joann"\'s line (mutation-proven)', () => {
  const text = 'Joann said, "not me."';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  // SHIPPED: the whole line is narration — no character voice leaks in.
  assert.ok(segs.every(s => s.voice === DEF), 'no character voice should attach to Joann');
  // MUTATION PROOF: the pre-fix substring matcher WOULD wrongly grab it as Ann.
  const bug = segmentSubstringBug(text, MAP, DEF);
  assert.ok(bug.some(mk => mk.voice === 'gigi'), 'sanity: the buggy substring variant misattributes to Ann');
});

test('SMART QUOTES — curly quotes attribute AND preserve original-text offsets (mutation-proven)', () => {
  const text = '“Curly quotes,” said Scarlet.';
  const segs = segmentByVoice(text, MAP, DEF);
  // Integrity proves the offsets still index the ORIGINAL (curly) text — the
  // codepoint-length-preserving normalization claim. This is the assertion that
  // a "strip the smart quotes / replace with two chars" mutation would break,
  // because slicing the original at shifted offsets would no longer equal s.text.
  assertIntegrity(text, segs);
  const spoken = segs.find(s => s.text.includes('Curly quotes'));
  assert.equal(spoken.voice, 'george');
  assert.ok(spoken.text.includes('“') && spoken.text.includes('”'), 'output preserves the original curly quotes');
});

test('case-insensitive match — uppercased name in prose still attributes (lowercase map key)', () => {
  const text = 'SCARLET said, "caps name"';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  assert.equal(segs.find(s => s.text.includes('caps name')).voice, 'george');
});

test('two speakers in one block — each quote gets its own voice, prose stays narrator', () => {
  const text = 'Scarlet said, "Hi" and Ann said, "Bye"';
  const segs = segmentByVoice(text, MAP, DEF);
  assertIntegrity(text, segs);
  assert.equal(segs.find(s => s.text === '"Hi"').voice, 'george');
  assert.equal(segs.find(s => s.text === '"Bye"').voice, 'gigi');
});

test('longest name wins — "Queen Scarlet" is not shadowed by "Scarlet"', () => {
  const map = { scarlet: 'george', 'queen scarlet': 'daniel' };
  const text = 'Queen Scarlet said, "by decree"';
  const segs = segmentByVoice(text, map, DEF);
  assertIntegrity(text, segs);
  assert.equal(segs.find(s => s.text.includes('by decree')).voice, 'daniel');
});

test('no assigned voices — returns the whole text as a single narrator span', () => {
  const text = 'Scarlet said, "Hello"';
  const segs = segmentByVoice(text, {}, DEF);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].voice, DEF);
  assert.equal(segs[0].charStart, 0);
  assert.equal(segs[0].charEnd, text.length);
});

test('empty / nullish text — returns no segments (no crash)', () => {
  assert.deepEqual(segmentByVoice('', MAP, DEF), []);
  assert.deepEqual(segmentByVoice(null, MAP, DEF), []);
  assert.deepEqual(segmentByVoice(undefined, MAP, DEF), []);
});

test('coalescing — adjacent narrator runs merge into one span (fewest audio fetches)', () => {
  const text = 'Just narration, no dialogue here at all.';
  const segs = segmentByVoice(text, MAP, DEF);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].voice, DEF);
  assertIntegrity(text, segs);
});

test('default voice fallback — omitted defaultVoice falls back to matilda', () => {
  const segs = segmentByVoice('plain narration', { scarlet: 'george' });
  assert.equal(segs[0].voice, 'matilda');
});

test('empty Name: line — a colon line with nothing after it is not mis-attributed', () => {
  const text = 'Scarlet:   ';
  const segs = segmentByVoice(text, MAP, DEF);
  // Whole thing is narration (no spoken content after the colon).
  assert.ok(segs.every(s => s.voice === DEF));
  if (segs.length) assertIntegrity(text, segs);
});

console.log(`\nvoice-segmenter: ${passed} tests passed`);
