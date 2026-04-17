import { easy, hard } from './questions.js';

/* ─── Themes ─── */
const THEMES = {
  bold: {
    css: {
      '--bg': '#f83500',
      '--bg-panel': 'rgba(248, 53, 0, 0.95)',
      '--bg-solid': '#f83500',
      '--bg-start': 'rgba(248, 53, 0, 0.88)',
      '--text': '#1a1a1a',
      '--text-dim': 'rgba(0, 0, 0, 0.55)',
      '--text-faint': 'rgba(0, 0, 0, 0.3)',
      '--correct': '#fffbe6',
      '--wrong': '#1a1a1a',
      '--border': '#1a1a1a',
      '--border-light': 'rgba(0, 0, 0, 0.15)',
      '--btn-bg': '#1a1a1a',
      '--btn-text': '#f83500',
    },
    map: {
      bg: '#f83500',
      fill: '#f83500',
      outline: '#fffbe6',
    },
  },
  neon: {
    css: {
      '--bg': '#000000',
      '--bg-panel': 'rgba(0, 0, 0, 0.92)',
      '--bg-solid': '#000000',
      '--bg-start': 'rgba(0, 0, 0, 0.85)',
      '--text': '#00ff41',
      '--text-dim': 'rgba(0, 255, 65, 0.55)',
      '--text-faint': 'rgba(0, 255, 65, 0.25)',
      '--correct': '#00ff41',
      '--wrong': '#ff0040',
      '--border': '#00ff41',
      '--border-light': 'rgba(0, 255, 65, 0.2)',
      '--btn-bg': '#000000',
      '--btn-text': '#00ff41',
    },
    map: {
      bg: '#000000',
      fill: '#000000',
      outline: '#00ff41',
    },
  },
  monochrome: {
    css: {
      '--bg': '#ffffff',
      '--bg-panel': 'rgba(255, 255, 255, 0.92)',
      '--bg-solid': '#ffffff',
      '--bg-start': 'rgba(255, 255, 255, 0.85)',
      '--text': '#000000',
      '--text-dim': 'rgba(0, 0, 0, 0.4)',
      '--text-faint': 'rgba(0, 0, 0, 0.2)',
      '--correct': '#00e676',
      '--wrong': '#ff0000',
      '--border': '#000000',
      '--border-light': 'rgba(0, 0, 0, 0.1)',
      '--btn-bg': '#000000',
      '--btn-text': '#ffffff',
    },
    map: {
      bg: '#ffffff',
      fill: '#ffffff',
      outline: '#000000',
    },
  },
};

const THEME_ORDER = ['bold', 'neon', 'monochrome'];
let currentTheme = 'bold';

function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  currentTheme = name;

  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.css)) {
    root.style.setProperty(prop, value);
  }
  document.body.dataset.theme = name;

  // Update map
  if (map.isStyleLoaded()) {
    applyMapTheme(theme.map);
  } else {
    map.once('style.load', () => applyMapTheme(theme.map));
  }

  localStorage.setItem('mme-theme', name);
}

function applyMapTheme(m) {
  try {
    map.setPaintProperty('background', 'background-color', m.bg);
    map.setPaintProperty('country-fills', 'fill-color', m.fill);
    map.setPaintProperty('country-outlines', 'line-color', m.outline);
    map.setFog({
      color: m.bg,
      'high-color': m.bg,
      'space-color': m.bg,
      'horizon-blend': 0,
      'star-intensity': 0,
      range: [20, 20],
    });
  } catch (e) {
    console.warn('Theme map update failed:', e);
  }
}

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
      { id: 'background', type: 'background', paint: { 'background-color': '#f83500' } },
      {
        id: 'country-fills',
        type: 'fill',
        source: 'countries',
        'source-layer': 'country_boundaries',
        paint: { 'fill-color': '#f83500' },
      },
      {
        id: 'country-outlines',
        type: 'line',
        source: 'countries',
        'source-layer': 'country_boundaries',
        paint: { 'line-color': '#fffbe6', 'line-width': 0.6, 'line-opacity': 0.5 },
      },
    ],
  },
  center: [46, 30],   // Middle East center
  zoom: 3.5,
  minZoom: 2.5,
  maxZoom: 5,
  interactive: false,
  attributionControl: false,
  fadeDuration: 0,
  pitch: 0,
});

map.on('style.load', () => {
  map.setFog({
    color: '#f83500',
    'high-color': '#f83500',
    'space-color': '#f83500',
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
let results = []; // { question, correct, userAnswer, correctAnswer }
const TOTAL = 5;

/* ─── DOM refs ─── */
const startScreen = document.getElementById('start-screen');
const quizPanel = document.getElementById('quiz-panel');
const quizNumber = document.getElementById('quiz-number');
const quizScore = document.getElementById('quiz-score');
const quizQuestion = document.getElementById('quiz-question');
const quizOptions = document.getElementById('quiz-options');
const quizFeedback = document.getElementById('quiz-feedback');
const feedbackIcon = document.getElementById('feedback-icon');
const feedbackText = document.getElementById('feedback-text');
const quizNext = document.getElementById('quiz-next');
const resultOverlay = document.getElementById('result-overlay');
const resultWord = document.getElementById('result-word');
const resultExplanation = document.getElementById('result-explanation');
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

let vibesIntroPlayed = false;

function startGame() {
  questions = pickQuestions();
  currentIdx = 0;
  score = 0;
  results = [];

  startScreen.classList.add('hidden');
  scorecard.classList.add('hidden');
  resultOverlay.classList.add('hidden');

  // Vibes button intro: appear big, then shrink to corner
  if (!vibesIntroPlayed) {
    vibesIntroPlayed = true;
    vibesBtn.classList.remove('settled');
    vibesBtn.classList.add('visible');
    setTimeout(() => {
      vibesBtn.classList.add('settled');
    }, 1200);
    // Delay showing quiz panel until button starts settling
    setTimeout(() => {
      quizPanel.classList.remove('hidden');
      showQuestion();
    }, 1600);
  } else {
    vibesBtn.classList.add('visible', 'settled');
    quizPanel.classList.remove('hidden');
    showQuestion();
  }
}

/* ─── Show Question ─── */
const LETTERS = ['A', 'B', 'C', 'D'];

function showQuestion() {
  const q = questions[currentIdx];
  quizNumber.textContent = `${String(currentIdx + 1).padStart(2, '0')}/${String(TOTAL).padStart(2, '0')}`;
  quizScore.textContent = score;
  quizQuestion.textContent = q.question;

  // Reset feedback
  quizFeedback.classList.add('hidden');
  quizNext.classList.add('hidden');

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

/* ─── Vibes Button ─── */
const vibesBtn = document.getElementById('vibes-btn');
vibesBtn.addEventListener('click', () => {
  const idx = THEME_ORDER.indexOf(currentTheme);
  const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
  applyTheme(next);
  vibesBtn.style.transform = 'scale(1.15)';
  setTimeout(() => { vibesBtn.style.transform = ''; }, 150);
});

// Restore saved theme
const saved = localStorage.getItem('mme-theme');
if (saved && THEMES[saved]) {
  map.on('style.load', () => applyTheme(saved));
}
