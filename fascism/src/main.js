import { easy, hard } from './questions.js';

/* ─── Constants ─── */
const VIDEO_ID = 'GV8KGcFqeLc';
const MAP_COLORS = {
  bg: '#ffffff',
  fill: '#d42b2b',
  outline: '#ffffff',
};

/* ─── Mapbox Background ─── */
mapboxgl.accessToken = 'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

const map = new mapboxgl.Map({
  container: 'map',
  style: {
    version: 8,
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sources: {
      'countries': {
        type: 'vector',
        url: 'mapbox://mapbox.country-boundaries-v1',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': MAP_COLORS.bg } },
      {
        id: 'country-fills',
        type: 'fill',
        source: 'countries',
        'source-layer': 'country_boundaries',
        paint: { 'fill-color': MAP_COLORS.fill },
      },
      {
        id: 'country-outlines',
        type: 'line',
        source: 'countries',
        'source-layer': 'country_boundaries',
        paint: { 'line-color': MAP_COLORS.outline, 'line-width': 0.8, 'line-opacity': 0.8 },
      },
    ],
  },
  center: [15, 50],
  zoom: 3.5,
  minZoom: 1,
  maxZoom: 5,
  interactive: false,
  attributionControl: false,
  fadeDuration: 0,
  pitch: 0,
});

map.on('style.load', () => {
  map.setFog({
    color: MAP_COLORS.bg,
    'high-color': MAP_COLORS.bg,
    'space-color': MAP_COLORS.bg,
    'horizon-blend': 0,
    'star-intensity': 0,
    range: [20, 20],
  });
});

/* ─── Game State ─── */
let difficulty = 'easy';
let questions = [];
let currentIdx = 0;
let score = 0;
let results = [];
const TOTAL = 5;

/* ─── DOM refs ─── */
const startScreen = document.getElementById('start-screen');
const quizPanel = document.getElementById('quiz-panel');
const quizNumber = document.getElementById('quiz-number');
const quizScore = document.getElementById('quiz-score');
const quizQuestion = document.getElementById('quiz-question');
const quizOptions = document.getElementById('quiz-options');
const resultOverlay = document.getElementById('result-overlay');
const resultWord = document.getElementById('result-word');
const resultExplanation = document.getElementById('result-explanation');
const resultYtLink = document.getElementById('result-yt-link');
const resultNextBtn = document.getElementById('result-next-btn');
const scorecard = document.getElementById('scorecard');
const scorecardBadge = document.getElementById('scorecard-badge');
const scorecardTotal = document.getElementById('scorecard-total');
const scorecardBody = document.getElementById('scorecard-body');
const playAgainBtn = document.getElementById('play-again-btn');

/* ─── Difficulty Toggle ─── */
document.getElementById('diff-easy').addEventListener('click', () => setDifficulty('easy'));
document.getElementById('diff-hard').addEventListener('click', () => setDifficulty('hard'));

function setDifficulty(d) {
  difficulty = d;
  document.getElementById('diff-easy').classList.toggle('active', d === 'easy');
  document.getElementById('diff-hard').classList.toggle('active', d === 'hard');
}

/* ─── Shuffle + Pick ─── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions() {
  const pool = difficulty === 'easy' ? easy : hard;
  return shuffle(pool).slice(0, TOTAL);
}

/* ─── Start Game ─── */
document.getElementById('start-btn').addEventListener('click', startGame);

function startGame() {
  questions = pickQuestions();
  currentIdx = 0;
  score = 0;
  results = [];

  startScreen.classList.add('hidden');
  scorecard.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  quizPanel.classList.remove('hidden');
  showQuestion();
}

/* ─── Show Question ─── */
const LETTERS = ['A', 'B', 'C', 'D'];

function showQuestion() {
  const q = questions[currentIdx];
  quizNumber.textContent = `${String(currentIdx + 1).padStart(2, '0')}/${String(TOTAL).padStart(2, '0')}`;
  quizScore.textContent = score;
  quizQuestion.textContent = q.question;

  // Build options
  quizOptions.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.style.animationDelay = `${i * 0.06}s`;
    btn.innerHTML = `<span class="option-letter">${LETTERS[i]}</span><span class="option-text">${opt}</span>`;
    btn.addEventListener('click', () => handleAnswer(i));
    quizOptions.appendChild(btn);
  });
}

/* ─── Handle Answer ─── */
function handleAnswer(idx) {
  const q = questions[currentIdx];
  const isCorrect = idx === q.answer;
  if (isCorrect) score++;

  results.push({
    question: q.question,
    correct: isCorrect,
    userAnswer: q.options[idx],
    correctAnswer: q.options[q.answer],
  });

  // Disable all buttons, highlight correct/wrong
  const btns = quizOptions.querySelectorAll('.option-btn');
  btns.forEach((btn, i) => {
    btn.classList.add('disabled');
    if (i === q.answer) btn.classList.add('correct');
    if (i === idx && !isCorrect) btn.classList.add('wrong');
  });

  // Go straight to result overlay after a short delay
  setTimeout(() => {
    quizPanel.classList.add('hidden');
    resultOverlay.classList.remove('hidden');
    resultOverlay.className = isCorrect ? 'is-correct' : 'is-wrong';
    resultWord.textContent = isCorrect ? 'CORRECT' : 'WRONG';
    resultExplanation.textContent = q.explanation;

    // YouTube timecoded link
    resultYtLink.href = `https://www.youtube.com/watch?v=${VIDEO_ID}&t=${q.timecode}s`;
  }, 400);
}

/* ─── Next / Result Flow ─── */
resultNextBtn.addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  currentIdx++;

  if (currentIdx >= TOTAL) {
    showScorecard();
  } else {
    quizPanel.classList.remove('hidden');
    showQuestion();
  }
});

/* ─── Scorecard ─── */
function showScorecard() {
  quizPanel.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  scorecard.classList.remove('hidden');

  // Badge
  scorecardBadge.innerHTML = `<div class="badge-label">${difficulty === 'easy' ? 'EASY MODE' : 'HARD MODE'}</div>`;

  // Total
  const pct = Math.round((score / TOTAL) * 100);
  scorecardTotal.innerHTML = `
    <div class="total-number">${score}/${TOTAL}</div>
    <div class="total-label">${pct}% — ${getGrade(score)}</div>
  `;

  // Rows
  scorecardBody.innerHTML = '';
  results.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'scorecard-row';
    row.style.animationDelay = `${0.4 + i * 0.08}s`;
    row.innerHTML = `
      <span class="q-label">${r.question}</span>
      <span class="q-result ${r.correct ? 'is-correct' : 'is-wrong'}">${r.correct ? 'CORRECT' : 'WRONG'}</span>
    `;
    scorecardBody.appendChild(row);
  });
}

function getGrade(s) {
  if (s === TOTAL) return 'PERFECT';
  if (s >= 4) return 'EXCELLENT';
  if (s >= 3) return 'GOOD';
  if (s >= 2) return 'NOT BAD';
  return 'KEEP LEARNING';
}

/* ─── Play Again ─── */
playAgainBtn.addEventListener('click', () => {
  scorecard.classList.add('hidden');
  startScreen.classList.remove('hidden');
});
