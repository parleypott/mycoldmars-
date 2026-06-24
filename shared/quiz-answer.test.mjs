// Mutation-locked tests for the shared quiz answer-accounting core.
// Run: node shared/quiz-answer.test.mjs  (picked up by scripts/run-tests.mjs)
import { newQuiz, nextQuestion, applyAnswer } from './quiz-answer.js';
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

console.log(`\nquiz-answer: ${pass} checks passed`);
