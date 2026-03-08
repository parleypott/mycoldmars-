import { spaces, mediaManifest } from './spaces.js';
import { createGridCollage, destroyGridCollage } from './grid-collage.js';
import { createGridGallery, destroyGridGallery } from './grid-gallery.js';
import { createWheel, destroyWheel } from './wheel.js';
import { initEffects, applyEffect, clearEffect, destroyEffects } from './effects.js';
import './style.css';

const app = document.getElementById('app');
let currentCleanup = null;
let currentMode = 'gallery'; // 'gallery' (default) or 'blinds'
let currentSlug = null;

function getMediaType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (ext === 'gif') return 'gif';
  return 'image';
}

function getMediaForSpace(slug) {
  const files = mediaManifest[slug] || [];
  if (files.length > 0) {
    return files.map(f => ({
      src: `/zanyplans/spaces/${slug}/${f}`,
      type: getMediaType(f),
      label: f
    }));
  }
  // Generate placeholders
  const palettes = {
    void: [220, 260],
    memories: [0, 30],
  };
  const [hueMin, hueMax] = palettes[slug] || [0, 360];
  return Array.from({ length: 12 }, (_, i) => ({
    src: null,
    type: 'placeholder',
    color: `hsl(${hueMin + ((hueMax - hueMin) * i / 12)}, 50%, ${15 + Math.random() * 20}%)`,
    label: `${slug.toUpperCase()}_${String(i).padStart(3, '0')}.DAT`
  }));
}

// ═══════════════════════════════════════════
// HOMEPAGE
// ═══════════════════════════════════════════

function renderHome() {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }
  currentSlug = null;
  app.innerHTML = '';
  app.className = 'home';

  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = 'ENTER THE ARCHIVE';
  app.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'home-subtitle';
  subtitle.textContent = 'SELECT A DIMENSION';
  app.appendChild(subtitle);

  const field = document.createElement('div');
  field.className = 'button-field';

  spaces.forEach((space, i) => {
    const btn = document.createElement('button');
    btn.className = 'mac-button';
    btn.textContent = space.name;
    btn.title = space.description;
    btn.style.setProperty('--drift-delay', `${i * -2.3}s`);
    btn.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 40}px`);
    btn.style.setProperty('--drift-y', `${(Math.random() - 0.5) * 30}px`);
    btn.addEventListener('click', () => {
      location.hash = `/space/${space.slug}`;
    });
    field.appendChild(btn);
  });

  app.appendChild(field);
}

// ═══════════════════════════════════════════
// SPACE PAGE
// ═══════════════════════════════════════════

function renderSpace(slug, mode) {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }

  const space = spaces.find(s => s.slug === slug);
  if (!space) { renderHome(); return; }

  currentSlug = slug;
  currentMode = mode || currentMode;

  app.innerHTML = '';
  app.className = 'space';

  // Back button
  const back = document.createElement('button');
  back.className = 'back-btn';
  back.textContent = '\u2190 BACK';
  back.addEventListener('click', () => { location.hash = ''; });
  app.appendChild(back);

  // Title
  const title = document.createElement('div');
  title.className = 'space-title';
  title.textContent = space.name;
  app.appendChild(title);

  // Mode toggle button
  const modeBtn = document.createElement('button');
  modeBtn.className = 'mode-btn';
  modeBtn.textContent = currentMode === 'gallery' ? 'BLINDS' : 'GALLERY';
  modeBtn.addEventListener('click', () => {
    const next = currentMode === 'gallery' ? 'blinds' : 'gallery';
    renderSpace(slug, next);
  });
  app.appendChild(modeBtn);

  // Content container
  const container = document.createElement('div');
  container.className = 'windows-container';
  app.appendChild(container);

  // Build scene based on mode
  const media = getMediaForSpace(slug);
  let scene;

  if (currentMode === 'blinds') {
    // Tile to 10 for the blinds grid
    let tiled = [...media];
    while (tiled.length < 10) tiled = tiled.concat(media);
    scene = createGridCollage(tiled.slice(0, 10), container);
  } else {
    // Gallery mode — pass full pool, cells pick randomly
    scene = createGridGallery(media, container);
  }

  // Wheel of fortune
  const wheel = createWheel((effectName) => {
    applyEffect(effectName, container);
  });
  app.appendChild(wheel);

  // Effects overlay
  const effectsCanvas = initEffects();
  app.appendChild(effectsCanvas);

  currentCleanup = () => {
    if (currentMode === 'blinds') destroyGridCollage(scene);
    else destroyGridGallery(scene);
    destroyWheel();
    destroyEffects();
  };
}

// ═══════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════

function route() {
  const hash = location.hash.slice(1);
  const match = hash.match(/^\/space\/(.+)$/);
  if (match) {
    renderSpace(match[1]);
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', route);
route();
