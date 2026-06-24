// Pure answer-accounting core shared by the quiz games (fascism, flyingmoney,
// modern-middle-east). Extracted to kill three byte-identical inline copies AND
// to fix a real double-count bug: each game reveals the answer behind a 400ms
// setTimeout but only adds a cosmetic `.disabled` CSS class to the option
// buttons — the click listeners stay live. A fast double-click (or clicking two
// options inside the reveal window) used to run the accounting twice: `score`
// could exceed the question count (e.g. 6/5 → 120%) and the end scorecard grew
// phantom duplicate rows for the same question.
//
// The guard lives HERE, in `applyAnswer`, so it's lockable: once a question is
// answered (`state.answered === true`) further answers for that question are
// ignored until `nextQuestion()` clears the flag for the next one.

export function newQuiz() {
  return { score: 0, results: [], answered: false };
}

// Clear the per-question guard so the next question can be answered. Returns a
// fresh object (never mutates) so the games can keep treating quiz state as
// replaceable.
export function nextQuestion(state) {
  return { score: state.score, results: state.results, answered: false };
}

// Record one answer. Idempotent within a question: a second call before
// nextQuestion() returns the state unchanged — that's the double-click fix.
export function applyAnswer(state, idx, question) {
  if (state.answered) return state;
  const isCorrect = idx === question.answer;
  return {
    score: state.score + (isCorrect ? 1 : 0),
    results: state.results.concat({
      question: question.question,
      correct: isCorrect,
      userAnswer: question.options[idx],
      correctAnswer: question.options[question.answer],
    }),
    answered: true,
  };
}
