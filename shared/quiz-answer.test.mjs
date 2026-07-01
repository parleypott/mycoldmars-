// Mutation-locked tests for the shared quiz answer-accounting core.
// Run: node shared/quiz-answer.test.mjs  (picked up by scripts/run-tests.mjs)
import { newQuiz, nextQuestion, applyAnswer, roundCount, gradeFor, displayPercent } from './quiz-answer.js';
import assert from 'node:assert/strict';

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

// A sample question: answer index 2 is correct.
const Q = {
  question: 'Which is fascism?',
  options: ['A', 'B', 'Correct one', 'D'],
  answer: 2,
};

t('newQuiz starts empty and unanswered', () => {
  const q = newQuiz();
  assert.deepEqual(q, { score: 0, results: [], answered: false });
});

t('a correct answer scores 1 and records the result', () => {
  const q = applyAnswer(newQuiz(), 2, Q);
  assert.equal(q.score, 1);
  assert.equal(q.answered, true);
  assert.equal(q.results.length, 1);
  assert.deepEqual(q.results[0], {
    question: 'Which is fascism?',
    correct: true,
    userAnswer: 'Correct one',
    correctAnswer: 'Correct one',
  });
});

t('a wrong answer scores 0 but still records user + correct answer', () => {
  const q = applyAnswer(newQuiz(), 0, Q);
  assert.equal(q.score, 0);
  assert.equal(q.results[0].correct, false);
  assert.equal(q.results[0].userAnswer, 'A');
  assert.equal(q.results[0].correctAnswer, 'Correct one');
});

// THE BUG LOCK: a second answer for the SAME question (double-click in the
// reveal window) must be ignored. Mutating applyAnswer to drop the
// `if (state.answered) return state;` guard makes BOTH of these go RED.
t('double-answer on one question does not double-count the score', () => {
  let q = applyAnswer(newQuiz(), 2, Q); // correct
  q = applyAnswer(q, 2, Q);             // rage double-click, also "correct"
  assert.equal(q.score, 1, 'score must not exceed 1 for one question');
  assert.equal(q.results.length, 1, 'must record exactly one result row');
});

t('double-answer is ignored even when the second click is a different option', () => {
  let q = applyAnswer(newQuiz(), 2, Q); // correct
  q = applyAnswer(q, 0, Q);             // then fat-fingers a wrong one
  assert.equal(q.score, 1);
  assert.equal(q.results[0].correct, true, 'first answer stands; second ignored');
  assert.equal(q.results.length, 1);
});

t('nextQuestion clears the guard so the next question can be answered', () => {
  let q = applyAnswer(newQuiz(), 2, Q); // Q1 correct
  q = nextQuestion(q);
  assert.equal(q.answered, false);
  q = applyAnswer(q, 2, Q);             // Q2 correct
  assert.equal(q.score, 2, 'two distinct questions can each score');
  assert.equal(q.results.length, 2);
});

t('five distinct questions can never exceed 5/5', () => {
  let q = newQuiz();
  for (let i = 0; i < 5; i++) {
    q = applyAnswer(q, 2, Q);   // answer correctly
    q = applyAnswer(q, 2, Q);   // and immediately double-click — must be ignored
    q = nextQuestion(q);
  }
  assert.equal(q.score, 5);
  assert.equal(q.results.length, 5);
});

t('applyAnswer never mutates the input state', () => {
  const before = newQuiz();
  const snapshot = JSON.stringify(before);
  applyAnswer(before, 2, Q);
  assert.equal(JSON.stringify(before), snapshot, 'input must be unchanged');
});

// ── roundCount: the latent-crash guard ──

t('roundCount returns the cap when the pool can supply it', () => {
  assert.equal(roundCount(25, 5), 5);
  assert.equal(roundCount(5, 5), 5);
});

t('roundCount caps to the pool when the pool is short of the cap', () => {
  assert.equal(roundCount(3, 5), 3);
  assert.equal(roundCount(0, 5), 0);
  assert.equal(roundCount(1, 5), 1);
});

t('roundCount degrades garbage input to 0 instead of NaN', () => {
  assert.equal(roundCount(undefined, 5), 0);
  assert.equal(roundCount(null, 5), 0);
  assert.equal(roundCount(-4, 5), 0);
  assert.equal(roundCount(3.9, 5), 3); // floors, never over-counts
});

// THE CRASH LOCK: the games slice their pool to `roundCount` and walk
// `currentIdx` until it reaches that length. If a pool is trimmed below the cap,
// driving the walk off the hardcoded cap (the old `currentIdx >= TOTAL`) indexes
// past the end of the shorter sliced list → `questions[idx]` is undefined →
// reading `.question` is a hard white-screen crash. Proven here: with a 3-item
// pool and a cap of 5, walking to the cap touches undefined; walking to
// roundCount never does.
t('walking to the cap crashes on a short pool; walking to roundCount does not', () => {
  const pool = [{ question: 'a' }, { question: 'b' }, { question: 'c' }];
  const CAP = 5;
  const questions = pool.slice(0, roundCount(pool.length, CAP));

  // Old buggy walk: end condition uses the constant cap.
  let crashed = false;
  try {
    for (let i = 0; i < CAP; i++) {
      const q = questions[i];
      void q.question; // throws at i=3 (undefined)
    }
  } catch { crashed = true; }
  assert.equal(crashed, true, 'walking to the hardcoded cap must hit undefined');

  // Fixed walk: end condition uses the real length.
  let ok = true;
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      void q.question;
    }
  } catch { ok = false; }
  assert.equal(ok, true, 'walking to questions.length never touches undefined');
  assert.equal(questions.length, 3);
});

// ── gradeFor: percentage-based, but byte-identical to the old labels at total=5 ──

// The original hardcoded grader the three games each carried inline. The lock
// below proves gradeFor reproduces it EXACTLY for the canonical 5-question game.
function legacyGrade5(s) {
  if (s === 5) return 'PERFECT';
  if (s >= 4) return 'EXCELLENT';
  if (s >= 3) return 'GOOD';
  if (s >= 2) return 'NOT BAD';
  return 'KEEP LEARNING';
}

t('gradeFor matches the original hardcoded labels for every score out of 5', () => {
  for (let s = 0; s <= 5; s++) {
    assert.equal(gradeFor(s, 5), legacyGrade5(s), `score ${s}/5`);
  }
});

t('gradeFor degrades to sensible labels for a short (3-question) game', () => {
  assert.equal(gradeFor(3, 3), 'PERFECT');      // 100%
  assert.equal(gradeFor(2, 3), 'GOOD');         // 66.6% → ≥60
  assert.equal(gradeFor(1, 3), 'KEEP LEARNING'); // 33% → <40
  assert.equal(gradeFor(0, 3), 'KEEP LEARNING');
});

t('gradeFor never divides by zero on an empty game', () => {
  assert.equal(gradeFor(0, 0), 'KEEP LEARNING');
  assert.equal(gradeFor(0, undefined), 'KEEP LEARNING');
});

// ── displayPercent: the scorecard "N% — GRADE" number, de-triplicated ──

// The three games each computed `rounds ? Math.round((score/rounds)*100) : 0`
// inline. displayPercent must reproduce that EXACTLY — same rounding, same
// zero-round guard — so the scorecard number never drifts between games.
function legacyPct(score, rounds) {
  return rounds ? Math.round((score / rounds) * 100) : 0;
}

t('displayPercent reproduces the inline scorecard math for every 5-question score', () => {
  for (let s = 0; s <= 5; s++) {
    assert.equal(displayPercent(s, 5), legacyPct(s, 5), `score ${s}/5`);
  }
  // canonical labels the user sees
  assert.equal(displayPercent(5, 5), 100);
  assert.equal(displayPercent(4, 5), 80);
  assert.equal(displayPercent(3, 5), 60);
  assert.equal(displayPercent(0, 5), 0);
});

t('displayPercent ROUNDS (not floors/truncates) to a whole percent', () => {
  // 2/3 = 66.66% must round UP to 67, not truncate to 66 — the mutation guard:
  // a floor/truncate/ceil/toFixed variant fails this.
  assert.equal(displayPercent(2, 3), 67);
  assert.equal(displayPercent(1, 3), 33); // 33.33% rounds DOWN to 33
  assert.equal(displayPercent(1, 8), 13); // 12.5% rounds to 13
  assert.equal(displayPercent(3, 8), 38); // 37.5% rounds to 38
});

t('displayPercent guards a zero/missing round count to 0, never NaN', () => {
  assert.equal(displayPercent(0, 0), 0);
  assert.equal(displayPercent(3, 0), 0);
  assert.equal(displayPercent(0, undefined), 0);
  assert.equal(displayPercent(0, null), 0);
  assert.equal(Number.isNaN(displayPercent(2, 0)), false);
});

t('displayPercent agrees with gradeFor at the reachable (≤5) round counts', () => {
  // For every real quiz size the rounded display % and the grade band tell the
  // same story — no "80% — GOOD" contradiction. (Rounding is a no-op at these
  // sizes, so coupling display to grade stays byte-identical.)
  for (let total = 1; total <= 5; total++) {
    for (let s = 0; s <= total; s++) {
      const pct = displayPercent(s, total);
      const grade = gradeFor(s, total);
      if (pct >= 80) assert.ok(grade === 'EXCELLENT' || grade === 'PERFECT', `${s}/${total}=${pct}% is ${grade}`);
      if (grade === 'KEEP LEARNING') assert.ok(pct < 40, `${s}/${total}=${pct}% graded KEEP LEARNING`);
    }
  }
});

console.log(`\nquiz-answer: ${pass} checks passed`);
