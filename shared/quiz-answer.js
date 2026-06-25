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

// How many rounds a quiz will actually play: the smaller of the question cap and
// how many questions the pool can supply. The games slice their shuffled pool to
// this length, then walk `currentIdx` until it reaches the round count. Driving
// the end condition off a hardcoded cap instead of the real length is a latent
// crash: a pool trimmed below the cap leaves the game indexing past the end of
// the (shorter) sliced list — `questions[currentIdx]` is `undefined` and reading
// `.question` off it is a hard white-screen crash. For a full pool this returns
// the cap unchanged, so the normal 5-question game is byte-identical.
export function roundCount(poolLength, cap) {
  const n = Math.max(0, Math.floor(Number(poolLength) || 0));
  const c = Math.max(0, Math.floor(Number(cap) || 0));
  return Math.min(n, c);
}

// Grade label for a final score out of `total`. Percentage-based so it stays
// correct for ANY round count, not just the canonical 5. For total === 5 the
// tiers reproduce the games' original hardcoded labels exactly:
//   5 → PERFECT, 4 → EXCELLENT, 3 → GOOD, 2 → NOT BAD, 1/0 → KEEP LEARNING.
export function gradeFor(score, total) {
  if (!total || total <= 0) return 'KEEP LEARNING';
  if (score >= total) return 'PERFECT';
  const pct = (score / total) * 100;
  if (pct >= 80) return 'EXCELLENT';
  if (pct >= 60) return 'GOOD';
  if (pct >= 40) return 'NOT BAD';
  return 'KEEP LEARNING';
}
