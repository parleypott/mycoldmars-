// First coverage for the quiz-game QUESTION BANKS (fascism, flyingmoney,
// modern-middle-east). The shared answer-accounting core is already locked
// (quiz-answer.test.mjs) — but the authored question DATA, the thing Johnny
// hand-edits and the most likely place for a typo, had no guard at all.
//
// Two live contracts depend on this data being well-formed:
//
//   1. answer-index-in-bounds. main.js highlights the correct option with
//      `if (i === q.answer) btn.classList.add('correct')` and records
//      `correctAnswer: question.options[question.answer]`. An off-by-one
//      `answer` (e.g. 4 on a 4-option array — trivially easy to author wrong)
//      means NO option is ever marked correct on screen AND the end scorecard
//      records `correctAnswer: undefined`. A silent, fully-shipped content bug.
//
//   2. numeric-timecode (fascism + flyingmoney only). Those two build the
//      "watch this moment on YouTube" link as
//      `https://www.youtube.com/watch?v=${VIDEO_ID}&t=${q.timecode}s`.
//      A missing/non-numeric timecode yields `&t=undefineds` / `&t=NaNs` —
//      a dead jump-link for that question. (modern-middle-east deliberately
//      dropped the per-question YouTube link, so it carries no timecode and is
//      exempt — asserted below so a future re-add of the link is noticed.)
//
// This is a data contract, not a code mutation lock: it re-derives the exact
// invariants the live games rely on, so any future content edit that breaks
// them goes RED in `bun run test` before it can ship.
import { easy as fEasy, hard as fHard } from '../fascism/src/questions.js';
import { easy as mEasy, hard as mHard } from '../flyingmoney/src/questions.js';
import { easy as eEasy, hard as eHard } from '../modern-middle-east/src/questions.js';
import assert from 'node:assert/strict';

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

// Mirror of how fascism/flyingmoney build the per-question YouTube jump link.
function ytHref(videoId, q) {
  return `https://www.youtube.com/watch?v=${videoId}&t=${q.timecode}s`;
}

// ── Shared structural contract every bank must satisfy ──
function checkStructure(label, pool) {
  assert.ok(Array.isArray(pool) && pool.length > 0, `${label}: pool must be a non-empty array`);
  pool.forEach((q, i) => {
    const where = `${label} #${i} (${String(q && q.question).slice(0, 40)})`;
    assert.ok(q && typeof q === 'object', `${where}: question must be an object`);
    assert.ok(typeof q.question === 'string' && q.question.trim().length > 0, `${where}: empty question text`);
    assert.ok(typeof q.explanation === 'string' && q.explanation.trim().length > 0, `${where}: empty explanation`);
    assert.ok(Array.isArray(q.options), `${where}: options must be an array`);
    assert.ok(q.options.length >= 2, `${where}: need at least 2 options`);
    // THE render-capacity LOCK. All three games render the option letter badge
    // from a 4-element `LETTERS = ['A','B','C','D']` array via `LETTERS[i]`
    // (fascism/main.js:131,146 · flyingmoney/main.js:131,146 ·
    // modern-middle-east/main.js:257,276), and the CSS lays out exactly 4
    // options. A 5th+ option would render the literal text "undefined" as its
    // letter badge (LETTERS[4] === undefined) and fall outside the styled grid
    // — a silent, fully-shipped content bug, same authoring-error class as the
    // off-by-one answer. The live render caps at 4, so the data must too.
    assert.ok(q.options.length <= 4,
      `${where}: ${q.options.length} options exceeds the 4-letter render capacity (A–D) — ` +
      `the option letter badge would render "undefined" for option ${q.options.length}`);
    q.options.forEach((opt, oi) =>
      assert.ok(typeof opt === 'string' && opt.trim().length > 0, `${where}: option ${oi} is empty`));
    // THE answer-in-bounds LOCK — the one that silently breaks a question.
    assert.ok(Number.isInteger(q.answer), `${where}: answer must be an integer index, got ${q.answer}`);
    assert.ok(q.answer >= 0 && q.answer < q.options.length,
      `${where}: answer index ${q.answer} is out of bounds for ${q.options.length} options`);
    // Duplicate option text would let a "wrong" pick visually equal the "correct" one.
    const norm = q.options.map((o) => o.trim().toLowerCase());
    assert.equal(new Set(norm).size, norm.length, `${where}: duplicate option text`);
  });
}

// fascism + flyingmoney additionally require a real numeric timecode.
function checkTimecodes(label, videoId, pool) {
  pool.forEach((q, i) => {
    const where = `${label} #${i} (${String(q.question).slice(0, 40)})`;
    assert.ok(Number.isFinite(Number(q.timecode)),
      `${where}: timecode must be a finite number, got ${q.timecode}`);
    assert.ok(Number(q.timecode) >= 0, `${where}: timecode must be >= 0`);
    const href = ytHref(videoId, q);
    assert.ok(!/undefined|NaN/.test(href), `${where}: YouTube link is broken -> ${href}`);
  });
}

t('fascism: every question is structurally sound', () => {
  checkStructure('fascism/easy', fEasy);
  checkStructure('fascism/hard', fHard);
});

t('fascism: every question has a usable YouTube timecode link', () => {
  checkTimecodes('fascism/easy', 'GV8KGcFqeLc', fEasy);
  checkTimecodes('fascism/hard', 'GV8KGcFqeLc', fHard);
});

t('flyingmoney: every question is structurally sound', () => {
  checkStructure('flyingmoney/easy', mEasy);
  checkStructure('flyingmoney/hard', mHard);
});

t('flyingmoney: every question has a usable YouTube timecode link', () => {
  checkTimecodes('flyingmoney/easy', 'nAFw5i39m9I', mEasy);
  checkTimecodes('flyingmoney/hard', 'nAFw5i39m9I', mHard);
});

t('modern-middle-east: every question is structurally sound', () => {
  checkStructure('mme/easy', eEasy);
  checkStructure('mme/hard', eHard);
});

t('modern-middle-east deliberately carries no per-question timecode (no YT jump-link)', () => {
  // Documents the intentional divergence: if a future edit re-adds the YouTube
  // link to mme, this assertion fires so timecode coverage gets added with it.
  const all = [...eEasy, ...eHard];
  assert.ok(all.every((q) => q.timecode === undefined),
    'mme questions unexpectedly carry a timecode — re-add timecode coverage if the YT link returned');
});

// Sanity: the answer-in-bounds check is actually load-bearing — prove it would
// catch the off-by-one it exists to catch (so this isn't a vacuous green).
t('the in-bounds lock rejects an off-by-one answer index', () => {
  const bad = { question: 'q', explanation: 'e', options: ['a', 'b', 'c', 'd'], answer: 4 };
  assert.throws(() => checkStructure('synthetic', [bad]), /out of bounds/);
});

t('the render-capacity lock rejects a 5-option question (the "undefined" letter-badge bug)', () => {
  const bad = { question: 'q', explanation: 'e', options: ['a', 'b', 'c', 'd', 'e'], answer: 4 };
  assert.throws(() => checkStructure('synthetic', [bad]), /render capacity/);
});

t('the timecode lock rejects a missing timecode (the &t=undefineds bug)', () => {
  const bad = { question: 'q', explanation: 'e', options: ['a', 'b'], answer: 0 }; // no timecode
  assert.throws(() => checkTimecodes('synthetic', 'VID', [bad]), /broken|finite number/);
});

console.log(`\nquiz-questions.test.mjs: ${pass} passed`);
