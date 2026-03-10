/**
 * Hakka — Food Learning Tool.
 * Photo-first cards. No names shown — you guess first.
 */
import './style.css';
import foods from './data/foods.js';
import { initUI } from './ui.js';

const grid = document.getElementById('food-grid');
const ui = initUI();

// Track studied foods
const studied = new Set(JSON.parse(localStorage.getItem('hk-studied') || '[]'));
updateProgress();

foods.forEach((food, idx) => {
  const card = document.createElement('div');
  card.className = 'food-card' + (studied.has(food.id) ? ' studied' : '');
  card.dataset.id = food.id;

  const photoWrap = document.createElement('div');
  photoWrap.className = 'card-photo';

  const img = document.createElement('img');
  img.src = food.image;
  img.alt = `Dish ${idx + 1}`;
  img.loading = idx < 8 ? 'eager' : 'lazy';
  img.draggable = false;
  img.className = 'card-img';

  // Placeholder shown if image fails
  const placeholder = document.createElement('div');
  placeholder.className = 'card-placeholder';
  placeholder.textContent = food.zhName.charAt(0);
  placeholder.style.display = 'none';

  img.onerror = () => {
    img.style.display = 'none';
    placeholder.style.display = '';
  };

  // Number badge
  const num = document.createElement('span');
  num.className = 'card-number';
  num.textContent = String(idx + 1);

  photoWrap.appendChild(img);
  photoWrap.appendChild(placeholder);
  photoWrap.appendChild(num);

  card.appendChild(photoWrap);
  grid.appendChild(card);

  card.addEventListener('click', () => {
    markStudied(food.id, card);
    ui.openDetail(food);
  });
});

function markStudied(id, card) {
  if (!studied.has(id)) {
    studied.add(id);
    card.classList.add('studied');
    localStorage.setItem('hk-studied', JSON.stringify([...studied]));
    updateProgress();
  }
}

function updateProgress() {
  const el = document.getElementById('progress-text');
  if (el) el.textContent = `${studied.size} / ${foods.length} studied`;
}
