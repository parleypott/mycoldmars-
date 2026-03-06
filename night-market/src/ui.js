/**
 * UI — detail panel (study), quiz panel, mode toggle.
 */
import foods from './data/foods.js';

let mode = 'study'; // 'study' or 'quiz'
let quizPhase = 'name'; // 'name' | 'trivia' | 'done'
let currentFood = null;
let score = { nameCorrect: 0, triviaCorrect: 0, visited: 0 };

const $ = (id) => document.getElementById(id);

export function initUI() {
  const els = {
    modeToggle: $('mode-toggle'),
    modeLabel: $('mode-label'),
    // Detail
    detailOverlay: $('detail-overlay'),
    detailPhotos: $('detail-photos'),
    detailZh: $('detail-zh'),
    detailEn: $('detail-en'),
    detailIngredients: $('detail-ingredients'),
    detailOrigin: $('detail-origin'),
    detailNotes: $('detail-notes'),
    detailTriviaQ: $('detail-trivia-q'),
    detailTriviaA: $('detail-trivia-a'),
    detailReveal: $('detail-reveal'),
    detailQuizBtn: $('detail-quiz-btn'),
    // Quiz
    quizOverlay: $('quiz-overlay'),
    quizPhotos: $('quiz-photos'),
    quizPrompt: $('quiz-prompt'),
    quizChoices: $('quiz-choices'),
    quizFeedback: $('quiz-feedback'),
    quizTrivia: $('quiz-trivia'),
    triviaQuestion: $('trivia-question'),
    triviaChoices: $('trivia-choices'),
    quizNext: $('quiz-next'),
  };

  // Mode toggle
  els.modeToggle.addEventListener('click', () => {
    mode = mode === 'study' ? 'quiz' : 'study';
    els.modeLabel.textContent = mode === 'study' ? 'Study Mode' : 'Quiz Mode';
    els.modeToggle.querySelector('.mode-icon').textContent = mode === 'study' ? '\u{1F4D6}' : '\u{1F3AF}';
    if (mode === 'quiz') {
      score = { nameCorrect: 0, triviaCorrect: 0, visited: 0 };
    }
  });

  // Close buttons
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.close;
      if (target === 'detail') els.detailOverlay.classList.add('hidden');
      if (target === 'quiz') closeQuiz();
    });
  });

  // Click outside modal
  els.detailOverlay.addEventListener('click', (e) => {
    if (e.target === els.detailOverlay) els.detailOverlay.classList.remove('hidden') || els.detailOverlay.classList.add('hidden');
  });
  els.quizOverlay.addEventListener('click', (e) => {
    if (e.target === els.quizOverlay) closeQuiz();
  });

  // Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.detailOverlay.classList.add('hidden');
      closeQuiz();
    }
  });

  // Reveal trivia answer in detail view
  els.detailReveal.addEventListener('click', () => {
    els.detailTriviaA.classList.remove('hidden');
    els.detailReveal.classList.add('hidden');
  });

  // Quiz me button in detail view
  els.detailQuizBtn.addEventListener('click', () => {
    const food = currentFood;
    els.detailOverlay.classList.add('hidden');
    openQuiz(food);
  });

  // Quiz next
  els.quizNext.addEventListener('click', handleQuizNext);

  // ─── Detail ───
  function openDetail(food) {
    currentFood = food;

    if (mode === 'quiz') {
      openQuiz(food);
      return;
    }

    loadPhoto(els.detailPhotos, food);
    els.detailZh.textContent = food.zhName;
    els.detailEn.textContent = food.enName;

    els.detailIngredients.innerHTML = '';
    food.ingredients.forEach((ing) => {
      const pill = document.createElement('span');
      pill.className = 'ingredient-pill';
      pill.textContent = ing;
      els.detailIngredients.appendChild(pill);
    });

    els.detailOrigin.textContent = food.origin;
    els.detailNotes.textContent = food.notes;
    els.detailTriviaQ.textContent = food.trivia.question;
    els.detailTriviaA.textContent = food.trivia.answer;
    els.detailTriviaA.classList.add('hidden');
    els.detailReveal.classList.remove('hidden');

    els.detailOverlay.classList.remove('hidden');
  }

  // ─── Quiz ───
  function openQuiz(food) {
    currentFood = food;
    quizPhase = 'name';
    score.visited++;

    loadPhoto(els.quizPhotos, food);
    els.quizFeedback.classList.add('hidden');
    els.quizFeedback.className = 'quiz-feedback hidden';
    els.quizTrivia.classList.add('hidden');
    els.quizNext.classList.add('hidden');
    els.quizNext.textContent = 'NEXT';
    els.quizPrompt.textContent = 'What dish is this?';

    const choices = buildChoices(food);
    els.quizChoices.innerHTML = '';
    choices.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-choice';
      btn.textContent = `${f.zhName}  ${f.enName}`;
      btn.addEventListener('click', () => handleNameAnswer(btn, f, food));
      els.quizChoices.appendChild(btn);
    });

    els.quizOverlay.classList.remove('hidden');
  }

  function buildChoices(correctFood) {
    const others = foods.filter((f) => f.id !== correctFood.id);
    shuffle(others);
    const all = [correctFood, ...others.slice(0, 3)];
    shuffle(all);
    return all;
  }

  function handleNameAnswer(btn, selected, correct) {
    const buttons = els.quizChoices.querySelectorAll('.quiz-choice');
    buttons.forEach((b) => b.classList.add('disabled'));

    if (selected.id === correct.id) {
      btn.classList.add('correct');
      score.nameCorrect++;
      showFeedback(true, `Correct! It's ${correct.enName}.`);
    } else {
      btn.classList.add('wrong');
      buttons.forEach((b) => {
        if (b.textContent.includes(correct.zhName)) b.classList.add('reveal');
      });
      showFeedback(false, `That's ${correct.zhName} — ${correct.enName}.`);
    }

    quizPhase = 'trivia';
    els.quizNext.classList.remove('hidden');
  }

  function handleQuizNext() {
    if (quizPhase === 'trivia') showTrivia();
    else if (quizPhase === 'done') closeQuiz();
  }

  function showTrivia() {
    els.quizNext.classList.add('hidden');
    els.quizFeedback.classList.add('hidden');
    els.quizFeedback.className = 'quiz-feedback hidden';
    els.quizPrompt.textContent = 'Trivia:';
    els.quizChoices.innerHTML = '';

    const t = currentFood.trivia;
    els.triviaQuestion.textContent = t.question;

    const answers = [t.answer, ...t.decoys];
    shuffle(answers);

    els.triviaChoices.innerHTML = '';
    answers.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-choice';
      btn.textContent = a;
      btn.addEventListener('click', () => handleTriviaAnswer(btn, a, t.answer));
      els.triviaChoices.appendChild(btn);
    });

    els.quizTrivia.classList.remove('hidden');
  }

  function handleTriviaAnswer(btn, selected, correct) {
    const buttons = els.triviaChoices.querySelectorAll('.quiz-choice');
    buttons.forEach((b) => b.classList.add('disabled'));

    if (selected === correct) {
      btn.classList.add('correct');
      score.triviaCorrect++;
      showFeedback(true, 'Correct!');
    } else {
      btn.classList.add('wrong');
      buttons.forEach((b) => {
        if (b.textContent === correct) b.classList.add('reveal');
      });
      showFeedback(false, `The answer was: ${correct}`);
    }

    quizPhase = 'done';
    els.quizNext.classList.remove('hidden');
    els.quizNext.textContent = 'CLOSE';
  }

  function closeQuiz() {
    els.quizOverlay.classList.add('hidden');
    els.quizTrivia.classList.add('hidden');
    els.quizNext.textContent = 'NEXT';
  }

  function showFeedback(correct, text) {
    els.quizFeedback.textContent = text;
    els.quizFeedback.className = 'quiz-feedback ' + (correct ? 'correct-fb' : 'wrong-fb');
  }

  return { openDetail, openQuiz };
}

// ─── Helpers ───

function loadPhoto(container, food) {
  container.innerHTML = '';
  container.classList.add('single-photo');
  const slot = document.createElement('div');
  slot.className = 'photo-slot';
  const img = document.createElement('img');
  img.src = food.image;
  img.alt = food.enName;
  img.loading = 'eager';
  img.onerror = () => {
    slot.className = 'photo-placeholder';
    slot.textContent = food.zhName.charAt(0);
  };
  slot.appendChild(img);
  container.appendChild(slot);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
