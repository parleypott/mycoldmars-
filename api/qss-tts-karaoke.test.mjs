// Tests for groupCharsIntoWords — the karaoke word-timing grouper in
// qss-tts-karaoke.js. It walks ElevenLabs's character-level alignment and
// groups runs of non-whitespace into words with {text, start, end, charStart,
// charEnd}. The client highlights word-by-word as the audio plays (Henry's
// read-along), so wrong timing or wrong char offsets = a highlight that lands
// on the wrong word at the wrong moment.
//
// REAL FRAGILITY FIXED: the word's `start` was taken ONLY from its first
// character. If that leading glyph lacked a timestamp (ElevenLabs can omit a
// time on an edge character) the whole word got start:-1 — even when later
// characters in the word carried valid times — so the client highlighted that
// word at t=-1 (immediately / wrong). The fix anchors start to the FIRST char
// in the word that actually carries a time, mirroring how `end` already keeps
// the LAST valid end. Normal path (every char timed) is byte-identical.
//
// Run: node api/qss-tts-karaoke.test.mjs   (or via `bun run test`)

import { groupCharsIntoWords } from './qss-tts-karaoke.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; fails.push(`${msg}\n    expected: ${e}\n    actual:   ${a}`);
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// Build an alignment payload from a string + per-char timing.
// chars come straight from the text; starts/ends default to char index *0.1.
function align(text, { starts, ends } = {}) {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: starts || chars.map((_, i) => i * 0.1),
    character_end_times_seconds: ends || chars.map((_, i) => (i + 1) * 0.1),
  };
}

// The OLD shipped grouping, kept verbatim to prove the test catches the bug.
function oldGroup(srcText, alignment) {
  const chars = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const words = [];
  let buf = '', bufStartTime = -1, bufEndTime = -1, bufCharStart = 0, bufCharEnd = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isWS = /\s/.test(ch);
    if (!isWS) {
      if (buf === '') { bufStartTime = typeof starts[i] === 'number' ? starts[i] : -1; bufCharStart = i; }
      buf += ch;
      bufEndTime = typeof ends[i] === 'number' ? ends[i] : bufEndTime;
      bufCharEnd = i + 1;
    } else if (buf) {
      words.push({ text: buf, start: bufStartTime, end: bufEndTime, charStart: bufCharStart, charEnd: bufCharEnd });
      buf = ''; bufStartTime = -1; bufEndTime = -1;
    }
  }
  if (buf) words.push({ text: buf, start: bufStartTime, end: bufEndTime, charStart: bufCharStart, charEnd: bufCharEnd });
  return words;
}

// ── RED proof (non-simulated): the leading-char-missing-time bug bites ────────
// A word whose FIRST glyph has no start time, but whose later glyphs do.
{
  const text = 'hi there';
  // 'h'(0) start MISSING, 'i'(1) start 0.5; rest normal.
  const starts = [null, 0.5, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const ends   = [0.45, 0.6, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75];
  const a = align(text, { starts, ends });

  const old = oldGroup(text, a);
  ok(old[0].start === -1, 'RED: old code emits start:-1 for "hi" when its first char lacks a time');

  const out = groupCharsIntoWords(text, a);
  eq(out[0].start, 0.5, 'FIX: word start anchors to first char that HAS a time (0.5), never -1');
  eq(out[0].text, 'hi', 'word text intact after fix');
  eq(out[0].charStart, 0, 'charStart still points at the first glyph (index 0)');
  eq(out[0].charEnd, 2, 'charEnd is exclusive end of "hi"');
}

// ── Normal path is byte-identical to the old grouping (no regression) ─────────
{
  const cases = [
    'hello world',
    'the quick brown fox',
    'one',
    '',
    '   ',
    'a  b', // double space
    ' leading and trailing ',
  ];
  let allSame = true;
  for (const t of cases) {
    const a = align(t);
    if (JSON.stringify(groupCharsIntoWords(t, a)) !== JSON.stringify(oldGroup(t, a))) allSame = false;
  }
  ok(allSame, 'fully-timed input: new grouping === old grouping for every case (no regression)');
}

// ── Basic two-word grouping with correct offsets + timing ─────────────────────
{
  const text = 'go now';
  // literal time arrays so assertions compare exact decimals (no i*0.1 fp drift)
  const out = groupCharsIntoWords(text, align(text, {
    starts: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
    ends:   [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  }));
  eq(out.length, 2, 'two words');
  eq(out.map(w => w.text), ['go', 'now'], 'words split on whitespace');
  // 'go' = chars 0,1 ; 'now' = chars 3,4,5
  eq(out[0].charStart, 0, 'go.charStart');
  eq(out[0].charEnd, 2, 'go.charEnd (exclusive)');
  eq(out[1].charStart, 3, 'now.charStart');
  eq(out[1].charEnd, 6, 'now.charEnd (exclusive)');
  eq(out[0].start, 0.0, 'go.start = char0 start');
  eq(out[0].end, 0.2, 'go.end = char1 end');
  eq(out[1].start, 0.3, 'now.start = char3 start');
  eq(out[1].end, 0.6, 'now.end = char5 end');
}

// ── charStart/charEnd slice the ORIGINAL text correctly ───────────────────────
{
  const text = 'hello, brave world';
  const out = groupCharsIntoWords(text, align(text));
  eq(out.map(w => text.slice(w.charStart, w.charEnd)), out.map(w => w.text),
    'slicing the source text by [charStart,charEnd) reproduces each word verbatim');
  eq(out.map(w => w.text), ['hello,', 'brave', 'world'], 'punctuation glomms onto its adjacent word');
}

// ── End time keeps the LAST valid end within a word ───────────────────────────
{
  const text = 'ab';
  // 'a' end 0.1, 'b' end MISSING -> word end should stay 0.1 (last valid)
  const a = align(text, { starts: [0.0, 0.05], ends: [0.1, null] });
  const out = groupCharsIntoWords(text, a);
  eq(out[0].start, 0.0, 'start from first char');
  eq(out[0].end, 0.1, 'end falls back to last char that HAS an end time');
}

// ── A word with NO valid times at all stays -1 (truly no data) ─────────────────
{
  const text = 'x y';
  const a = align(text, { starts: [null, 0.1, null], ends: [null, 0.2, null] });
  const out = groupCharsIntoWords(text, a);
  eq(out[0].start, -1, 'word with zero valid start times -> start stays -1 (honest "no data")');
  eq(out[0].end, -1, 'word with zero valid end times -> end stays -1');
  eq(out[1].start, -1, 'whitespace char carried a time but the word "y" has none of its own... ');
  // (the space at index 1 holds 0.1/0.2, but it is whitespace and not part of any word)
}

// ── Leading / trailing / multiple whitespace ─────────────────────────────────
{
  const text = '  hi   yo  ';
  const out = groupCharsIntoWords(text, align(text));
  eq(out.map(w => w.text), ['hi', 'yo'], 'leading/trailing/internal whitespace runs do not create empty words');
  eq(out.map(w => text.slice(w.charStart, w.charEnd)), ['hi', 'yo'], 'offsets correct through whitespace runs');
}

// ── Newlines and tabs count as whitespace ────────────────────────────────────
{
  const text = 'a\nb\tc';
  const out = groupCharsIntoWords(text, align(text));
  eq(out.map(w => w.text), ['a', 'b', 'c'], '\\n and \\t are word separators');
}

// ── Trailing word (no closing whitespace) is flushed ──────────────────────────
{
  const text = 'end';
  const out = groupCharsIntoWords(text, align(text));
  eq(out.length, 1, 'final word with no trailing whitespace is still emitted');
  eq(out[0].text, 'end', 'trailing word text');
  eq(out[0].charEnd, 3, 'trailing word charEnd');
}

// ── Robustness: missing alignment arrays do not throw ────────────────────────
{
  eq(groupCharsIntoWords('whatever', {}), [], 'empty alignment object -> [] (no throw)');
  eq(groupCharsIntoWords('whatever', { characters: [] }), [], 'empty characters -> []');
  // chars present but no time arrays -> words with -1 times, offsets intact.
  const out = groupCharsIntoWords('hi', { characters: ['h', 'i'] });
  eq(out, [{ text: 'hi', start: -1, end: -1, charStart: 0, charEnd: 2 }],
    'chars without any time arrays -> word with -1/-1 times but correct text+offsets');
}

// ── srcText/alignment length divergence: offsets follow the alignment array ────
// (Documents the real contract: charStart/charEnd index the alignment chars,
// which for ElevenLabs `alignment` match the original text 1:1.)
{
  const a = align('hi');
  const out = groupCharsIntoWords('hi', a);
  ok(out[0].charEnd <= a.characters.length, 'charEnd never exceeds the alignment character count');
}

console.log(`\nqss-tts-karaoke groupCharsIntoWords: ${pass} passed, ${fail} failed`);
if (fail) { console.error('\nFAILURES:\n' + fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
