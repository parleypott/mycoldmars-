const TOTAL = 17;
const deck = document.getElementById('deck');
const counter = document.getElementById('slide-counter');
const progFill = document.getElementById('prog-fill');
const progTrack = document.getElementById('prog-track');

let current = 0;

/* ── Build slides ── */
for (let i = 1; i <= TOTAL; i++) {
  const slide = document.createElement('div');
  slide.className = 'slide' + (i === 1 ? ' active' : '');
  const img = document.createElement('img');
  img.src = `./slides/slide-${String(i).padStart(2, '0')}.jpg`;
  img.alt = `Slide ${i}`;
  img.draggable = false;
  slide.appendChild(img);
  deck.appendChild(slide);
}

/* ── Build progress segments ── */
for (let i = 0; i < TOTAL; i++) {
  const seg = document.createElement('div');
  seg.className = 'prog-seg' + (i === 0 ? ' passed' : '');
  seg.dataset.label = `${i + 1}`;
  seg.addEventListener('click', () => goTo(i));
  progTrack.appendChild(seg);
}

/* ── Hint ── */
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = 'Click or press arrow keys';
document.body.appendChild(hint);

/* ── Navigation ── */
function goTo(idx) {
  if (idx < 0 || idx >= TOTAL || idx === current) return;

  const slides = deck.querySelectorAll('.slide');
  slides[current].classList.remove('active');
  slides[idx].classList.add('active');
  current = idx;

  updateUI();
}

function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

function updateUI() {
  // Counter
  counter.textContent = `${current + 1} / ${TOTAL}`;

  // Progress fill
  const pct = ((current + 1) / TOTAL) * 100;
  progFill.style.width = `${pct}%`;

  // Segments
  const segs = progTrack.querySelectorAll('.prog-seg');
  segs.forEach((seg, i) => {
    seg.classList.toggle('passed', i <= current);
  });

  // Remove hint after first navigation
  if (current > 0 && hint.parentNode) {
    hint.remove();
  }
}

// Initial state
updateUI();

/* ── Keyboard ── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    prev();
  }
});

/* ── Click zones ── */
deck.addEventListener('click', (e) => {
  const x = e.clientX / window.innerWidth;
  if (x > 0.65) next();
  else if (x < 0.35) prev();
});

/* ── Touch / Swipe ── */
let touchStartX = 0;
let touchStartY = 0;

deck.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

deck.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;

  // Only handle horizontal swipes
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) next();
    else prev();
  }
});

/* ── Preload adjacent slides ── */
function preloadAdjacent() {
  const idxs = [current - 1, current + 1, current + 2].filter(i => i >= 0 && i < TOTAL);
  idxs.forEach(i => {
    const img = new Image();
    img.src = `./slides/slide-${String(i + 1).padStart(2, '0')}.jpg`;
  });
}

// Preload on navigation
const origGoTo = goTo;
// Override not needed — images are in the DOM already
