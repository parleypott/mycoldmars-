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

// ── OPTION SHUFFLE (answer-position fairness) ─────────────────────────────────
// The hand-authored banks cluster the correct answer on ONE position: fascism
// has 42/50 answers on index 1, modern-middle-east 36/~65 on index 1. The games
// render `q.options` in authored order, so a player who always picks the second
// option scores ~84% knowing nothing — the quiz is trivially gamed. Shuffling the
// options per play (and remapping `answer` to the correct option's new index)
// removes the positional tell without touching the banks.
//
// Positional options ("All of the above" and kin) reference the LIST ORDER, so a
// question containing one must keep its authored order — moving "All of the
// above" into the middle of the list reads as nonsense. hasPositionalOption
// flags those; shuffleOptions returns them unchanged.
const POSITIONAL_OPTION = /\b(?:all|none|both|any) of (?:the above|these|the following|the others)\b/i;

export function hasPositionalOption(options) {
  return Array.isArray(options) && options.some(
    (o) => typeof o === 'string' && POSITIONAL_OPTION.test(o)
  );
}

// Return a NEW question with its options permuted and `answer` remapped to the
// correct option's new index — never mutates the input (the shared banks stay
// pristine across plays). Fisher-Yates over an index array so the correct
// option's landing spot is exact. Returns the question unchanged when there's
// nothing safe to shuffle: a non-array options list, an out-of-range/non-integer
// answer, fewer than 2 options, or a positional option present.
//   • rng() → [0,1); defaults to Math.random. Pass a seeded rng in tests.
export function shuffleOptions(question, rng = Math.random) {
  if (!question || !Array.isArray(question.options)) return question;
  const opts = question.options;
  const ans = question.answer;
  if (!Number.isInteger(ans) || ans < 0 || ans >= opts.length) return question;
  if (opts.length < 2) return question;
  if (hasPositionalOption(opts)) return question;
  const order = opts.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    // Math.min guards a seeded rng that returns exactly 1 (Math.random never does).
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  return {
    ...question,
    options: order.map((i) => opts[i]),
    answer: order.indexOf(ans),
  };
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

// The rounded whole-number percentage shown on the end scorecard ("80% — GOOD").
// Extracted to kill THREE byte-identical inline copies — each game's scorecard
// computed `rounds ? Math.round((quiz.score / rounds) * 100) : 0` on its own,
// the same divergent-triplet setup that produced the double-count bug this
// module already fixed. A zero (or missing) round count returns 0, never NaN —
// the `!total` guard mirrors the games' `rounds ? … : 0` so a quiz that somehow
// ends with no rounds shows "0%" instead of "NaN%". Byte-identical to the inline
// copies for every real quiz (rounds is always the played question count).
export function displayPercent(score, total) {
  if (!total || total <= 0) return 0;
  return Math.round((score / total) * 100);
}
