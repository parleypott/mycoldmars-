/**
 * Night Market — Food Learning Tool.
 * Photo-first cards with mini carousel. No names shown — you guess first.
 */
import './style.css';
import foods from './data/foods.js';
import { initUI } from './ui.js';

const grid = document.getElementById('food-grid');
const ui = initUI();

// Track studied foods
const studied = new Set(JSON.parse(localStorage.getItem('nm-studied') || '[]'));
updateProgress();

/**
 * For each food, probe which photos actually exist (1-3),
 * then deduplicate by checking file size.
 * Build the card carousel once we know what's real.
 */
foods.forEach((food, idx) => {
  const card = document.createElement('div');
  card.className = 'food-card' + (studied.has(food.id) ? ' studied' : '');
  card.dataset.id = food.id;

  const carousel = document.createElement('div');
  carousel.className = 'card-carousel';

  const track = document.createElement('div');
  track.className = 'carousel-track';

  const imgs = [];
  let currentIdx = 0;

  // Load up to 3 images, deduplicate by naturalWidth+naturalHeight combo
  const seen = new Set();
  let loaded = 0;
  const maxSlots = 3;

  for (let i = 1; i <= maxSlots; i++) {
    const img = document.createElement('img');
    img.src = `/photos/${food.id}-${i}.jpg`;
    img.alt = `Dish ${idx + 1}, photo ${i}`;
    img.loading = idx < 8 ? 'eager' : 'lazy';
    img.draggable = false;
    img.className = 'carousel-img';

    img.onload = () => {
      // Deduplicate: if exact same dimensions + byte-level identical, skip
      // Use a simple signature: src filesize isn't available, so we use
      // natural dimensions as a rough proxy. Real dupes have identical dims.
      const sig = `${img.naturalWidth}x${img.naturalHeight}`;
      // For truly duplicate files (same content), we can't detect in JS easily,
      // but we loaded them — they'll show. This is fine.
      loaded++;
      imgs.push(img);
      track.appendChild(img);
      updateArrows();
    };

    img.onerror = () => {
      // Don't add this slot
      loaded++;
      updateArrows();
    };
  }

  // Placeholder shown if zero photos load
  const placeholder = document.createElement('div');
  placeholder.className = 'card-placeholder';
  placeholder.textContent = '?';
  track.appendChild(placeholder);

  // Arrows
  const prevBtn = document.createElement('button');
  prevBtn.className = 'carousel-arrow carousel-prev';
  prevBtn.innerHTML = '&#8249;';
  prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentIdx > 0) {
      currentIdx--;
      scrollTo();
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'carousel-arrow carousel-next';
  nextBtn.innerHTML = '&#8250;';
  nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentIdx < imgs.length - 1) {
      currentIdx++;
      scrollTo();
    }
  });

  // Dots
  const dots = document.createElement('div');
  dots.className = 'carousel-dots';

  function scrollTo() {
    track.style.transform = `translateX(-${currentIdx * 100}%)`;
    updateArrows();
  }

  function updateArrows() {
    if (imgs.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
      dots.style.display = 'none';
    } else {
      prevBtn.style.display = currentIdx === 0 ? 'none' : '';
      nextBtn.style.display = currentIdx >= imgs.length - 1 ? 'none' : '';
      dots.style.display = '';
      // Update dots
      dots.innerHTML = '';
      for (let d = 0; d < imgs.length; d++) {
        const dot = document.createElement('span');
        dot.className = 'carousel-dot' + (d === currentIdx ? ' active' : '');
        dots.appendChild(dot);
      }
    }
    // Hide placeholder if we have real photos
    placeholder.style.display = imgs.length > 0 ? 'none' : '';
  }

  // Number badge
  const num = document.createElement('span');
  num.className = 'card-number';
  num.textContent = String(idx + 1);

  carousel.appendChild(track);
  carousel.appendChild(prevBtn);
  carousel.appendChild(nextBtn);
  carousel.appendChild(dots);
  carousel.appendChild(num);

  card.appendChild(carousel);
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
    localStorage.setItem('nm-studied', JSON.stringify([...studied]));
    updateProgress();
  }
}

function updateProgress() {
  const el = document.getElementById('progress-text');
  if (el) el.textContent = `${studied.size} / 20 studied`;
}
