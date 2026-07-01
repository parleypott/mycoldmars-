// Verifier-layer lock for resolveSeekTime(words, {fromWord|fromChar}, fallback)
// in queen-scarlet-school/index.html — the pure core of QSS Storybook's brand-new
// CLICK-TO-READ feature (commit 9fbcf5c, Jun 30). Henry taps any word in his story
// and the read-aloud audio must start AT THAT WORD, not linear-from-the-top. The
// storybook player calls resolveSeekTime with either:
//   • { fromWord } — he clicked a decorated karaoke span (exact word index), or
//   • { fromChar } — he clicked raw/idle prose and we only know the caret's
//     character offset into the scene text.
// It maps that target onto this scene's timed words[] ({ start, charStart, charEnd })
// and returns the playback START TIME. If nothing resolves (no words yet, chosen
// word has no usable start), it returns the linear `fallback` so playback degrades
// to normal top-of-scene reading instead of jumping to 0 or NaN.
//
// This is load-bearing seek math in a KID'S tool with ZERO prior coverage, and it
// lives inside an auth-gated single-file app (can't be curl-verified headless). The
// test EXTRACTS the REAL shipped function from index.html at runtime (regex +
// new Function) so a hand-copied mirror can't silently drift, then mutation-proves
// each contract clause is load-bearing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Pull the real function body out of the shipped HTML.
function extractSrc(html) {
  const m = html.match(/function resolveSeekTime\(words, \{ fromWord = null[\s\S]*?\n      \}/);
  assert.ok(m, 'could not locate resolveSeekTime in index.html — did it move/rename?');
  return m[0];
}
function compile(src) {
  // Wrap the declaration and hand it back as a callable.
  return new Function(`${src}\n return resolveSeekTime;`)();
}

const SRC = extractSrc(HTML);
const resolveSeekTime = compile(SRC);

// A realistic 4-word scene: "Hi there big world" with a leading space and a
// two-space gap before "world", so charStart/charEnd have real gaps.
//   text: " Hi there  world"  (word "big" removed to force a gap)
//   idx:   0123456789012345
const WORDS = [
  { text: 'Hi',    start: 0.0, charStart: 1,  charEnd: 3  },
  { text: 'there', start: 0.5, charStart: 4,  charEnd: 9  },
  { text: 'world', start: 1.2, charStart: 11, charEnd: 16 },
];

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); n++; };

// ── fromWord: exact index → that word's start ──────────────────────────────
eq(resolveSeekTime(WORDS, { fromWord: 0 }, 99), 0.0, 'fromWord 0 → first word start');
eq(resolveSeekTime(WORDS, { fromWord: 1 }, 99), 0.5, 'fromWord 1 → second word start');
eq(resolveSeekTime(WORDS, { fromWord: 2 }, 99), 1.2, 'fromWord 2 → third word start');

// fromWord clamps out-of-range indices into bounds (never NaN / undefined)
eq(resolveSeekTime(WORDS, { fromWord: 99 }, 99), 1.2, 'fromWord past end clamps to last word');
eq(resolveSeekTime(WORDS, { fromWord: -5 }, 99), 0.0, 'fromWord negative clamps to first word');

// ── fromChar: exact hit inside a word's [charStart, charEnd) ────────────────
eq(resolveSeekTime(WORDS, { fromChar: 1 }, 99), 0.0, 'char inside word 0 → word 0');
eq(resolveSeekTime(WORDS, { fromChar: 2 }, 99), 0.0, 'char mid word 0 → word 0');
eq(resolveSeekTime(WORDS, { fromChar: 4 }, 99), 0.5, 'char at word 1 charStart → word 1');
eq(resolveSeekTime(WORDS, { fromChar: 8 }, 99), 0.5, 'char inside word 1 → word 1');
eq(resolveSeekTime(WORDS, { fromChar: 15 }, 99), 1.2, 'char inside word 2 → word 2');

// half-open interval: charEnd belongs to the NEXT word, not this one
eq(resolveSeekTime(WORDS, { fromChar: 3 }, 99), 0.0, 'charEnd of w0 (3) is a gap → nearest preceding = w0');
eq(resolveSeekTime(WORDS, { fromChar: 9 }, 99), 0.5, 'charEnd of w1 (9) is a gap → nearest preceding = w1');

// ── fromChar in a GAP → nearest PRECEDING word ─────────────────────────────
eq(resolveSeekTime(WORDS, { fromChar: 10 }, 99), 0.5, 'two-space gap before world → preceding word "there"');

// ── fromChar BEFORE the first word → falls to word 0 (not fallback/NaN) ─────
eq(resolveSeekTime(WORDS, { fromChar: 0 }, 99), 0.0, 'char in leading space → word 0');

// ── fromChar past the last word → last word ────────────────────────────────
eq(resolveSeekTime(WORDS, { fromChar: 500 }, 99), 1.2, 'char past end → last word');

// ── degradation: no usable words → return the linear fallback ──────────────
eq(resolveSeekTime([], { fromWord: 0 }, 7.7), 7.7, 'empty words → fallback');
eq(resolveSeekTime(null, { fromChar: 3 }, 7.7), 7.7, 'null words → fallback');
eq(resolveSeekTime(WORDS, {}, 7.7), 7.7, 'neither fromWord nor fromChar → fallback (linear play)');

// a chosen word with a missing/negative start must NOT seek — degrade to fallback
eq(resolveSeekTime([{ charStart: 0, charEnd: 2 }], { fromWord: 0 }, 3.3), 3.3, 'word missing start → fallback');
eq(resolveSeekTime([{ start: -1, charStart: 0, charEnd: 2 }], { fromWord: 0 }, 3.3), 3.3, 'word start<0 → fallback');
// but a legitimate start of exactly 0 IS a real seek target (truthy-zero guard)
eq(resolveSeekTime([{ start: 0, charStart: 0, charEnd: 2 }], { fromWord: 0 }, 3.3), 0, 'word start===0 → seeks to 0, not fallback');

// ── mutation harness: neutering each contract clause must break the lock ────
function expectBroken(mutate, label) {
  const broken = compile(mutate(SRC));
  let threwOrWrong = false;
  try {
    // Run the whole assertion battery's key cases against the mutant; if it
    // still passes everything, the clause we removed wasn't actually locked.
    const cases = [
      [WORDS, { fromWord: 99 }, 99, 1.2],
      [WORDS, { fromChar: 10 }, 99, 0.5],
      [WORDS, {}, 7.7, 7.7],
      [[{ start: -1, charStart: 0, charEnd: 2 }], { fromWord: 0 }, 3.3, 3.3],
      [[{ start: 0, charStart: 0, charEnd: 2 }], { fromWord: 0 }, 3.3, 0],
    ];
    for (const [w, t, f, want] of cases) {
      const got = broken(w, t, f);
      if (got !== want) { threwOrWrong = true; break; }
    }
  } catch { threwOrWrong = true; }
  assert.ok(threwOrWrong, `mutation "${label}" should have broken the contract but did not`);
  n++;
}

// Drop the fromWord clamp → out-of-range index yields undefined word (wrong/throw).
expectBroken(
  (s) => s.replace('Math.max(0, Math.min(words.length - 1, fromWord))', 'fromWord'),
  'remove fromWord clamp'
);
// Drop the neither-target fallback (return fallback when wi<0) → returns a seek instead of fallback.
expectBroken(
  (s) => s.replace('if (wi < 0) return fallback;', 'if (wi < 0) wi = 0;'),
  'remove neither-target fallback'
);
// Weaken the start guard to truthy → start===0 wrongly degrades to fallback.
expectBroken(
  (s) => s.replace("typeof w.start === 'number' && w.start >= 0", 'w.start'),
  'weaken start guard to truthy (breaks start===0)'
);

console.log(`seek-resolution.test.mjs: ${n} assertions passed`);
