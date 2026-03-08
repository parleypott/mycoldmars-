import { spaces, mediaManifest } from './spaces.js';
import { createFloatingScene, destroyFloatingScene } from './floating-windows.js';
import { createWheel, destroyWheel } from './wheel.js';
import { initEffects, applyEffect, clearEffect, destroyEffects } from './effects.js';
import './style.css';

const app = document.getElementById('app');
let currentCleanup = null;

function getMediaType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (ext === 'gif') return 'gif';
  return 'image';
}

function getMediaForSpace(slug) {
  const files = mediaManifest[slug] || [];
  if (files.length > 0) {
    let media = files.map(f => ({
      src: `/zanyplans/spaces/${slug}/${f}`,
      type: getMediaType(f),
      label: f
    }));
    while (media.length < 20) media = media.concat(media).slice(0, 20);
    return media.slice(0, 20);
  }
  // Generate placeholders
  const palettes = {
    void: [220, 260],
    memories: [0, 30],
  };
  const [hueMin, hueMax] = palettes[slug] || [0, 360];
  return Array.from({ length: 20 }, (_, i) => ({
    src: null,
    type: 'placeholder',
    color: `hsl(${hueMin + ((hueMax - hueMin) * i / 20)}, 50%, ${15 + Math.random() * 20}%)`,
    label: `${slug.toUpperCase()}_${String(i).padStart(3, '0')}.DAT`
  }));
}

// ═══════════════════════════════════════════
// HOMEPAGE
// ═══════════════════════════════════════════

function renderHome() {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }
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
    // Random drift params
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

function renderSpace(slug) {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }

  const space = spaces.find(s => s.slug === slug);
  if (!space) { renderHome(); return; }

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

  // Windows container
  const container = document.createElement('div');
  container.className = 'windows-container';
  app.appendChild(container);

  // Create floating windows
  const media = getMediaForSpace(slug);
  const scene = createFloatingScene(media, container);

  // Wheel of fortune
  const wheel = createWheel((effectName) => {
    applyEffect(effectName, container);
  });
  app.appendChild(wheel);

  // Effects overlay canvas
  const effectsCanvas = initEffects();
  app.appendChild(effectsCanvas);

  currentCleanup = () => {
    destroyFloatingScene(scene);
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
