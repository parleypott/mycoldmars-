import mapboxgl from 'mapbox-gl';
import * as topojson from 'topojson-client';
import worldTopo from 'world-atlas/countries-50m.json';

import { Game } from './game.js';
import { initThemes } from './theme.js';
import './style.css';

// ─── Country GeoJSON for coastlines ───

const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

// ─── Mapbox Setup ───

mapboxgl.accessToken = 'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

// ─── Custom Style (Bold orange defaults) ───

const mapStyle = {
  version: 8,
  name: 'PinGlobe',
  sources: {
    'mapbox-streets': {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    },
    'countries': {
      type: 'geojson',
      data: countriesGeo,
    },
  },
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    // Land — bold orange
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f83500' },
    },
    // Water — same orange
    {
      id: 'water',
      type: 'fill',
      source: 'mapbox-streets',
      'source-layer': 'water',
      paint: { 'fill-color': '#f83500' },
    },
    // Country outlines — ivory
    {
      id: 'country-outlines',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 2, 0.8, 4, 1.2, 7, 1.5, 12, 1],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    // Disputed borders
    {
      id: 'admin-disputed',
      type: 'line',
      source: 'mapbox-streets',
      'source-layer': 'admin',
      filter: ['all',
        ['==', ['get', 'admin_level'], 0],
        ['==', ['get', 'disputed'], 'true'],
      ],
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 1, 7, 1.2],
        'line-dasharray': [3, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    // Country labels — ivory, fading in
    {
      id: 'country-label',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'country'],
      minzoom: 1,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 0, 2, 6, 3, 9, 5, 13, 7, 18],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
      },
      paint: {
        'text-color': ['interpolate', ['linear'], ['zoom'], 1, 'rgba(255,251,230,0)', 2, 'rgba(255,251,230,0.2)', 3, 'rgba(255,251,230,0.4)', 5, 'rgba(255,251,230,0.7)', 7, '#fffbe6'],
        'text-halo-color': '#f83500',
        'text-halo-width': 2,
      },
    },
    // Capital labels
    {
      id: 'capital-label',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['any',
          ['==', ['get', 'capital'], 2],
          ['==', ['get', 'capital'], 3],
        ],
      ],
      minzoom: 3,
      layout: {
        'text-field': ['concat', '★ ', ['get', 'name_en']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 7, 5, 9, 8, 12, 10, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
      },
      paint: {
        'text-color': ['interpolate', ['linear'], ['zoom'], 3, 'rgba(255,251,230,0.3)', 5, 'rgba(255,251,230,0.6)', 7, 'rgba(255,251,230,0.85)'],
        'text-halo-color': '#f83500',
        'text-halo-width': 1.5,
      },
    },
    // Major city labels
    {
      id: 'city-label-major',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['<=', ['get', 'filterrank'], 2],
        ['!', ['any',
          ['==', ['get', 'capital'], 2],
          ['==', ['get', 'capital'], 3],
        ]],
      ],
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 10, 12, 12, 14],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
      },
      paint: {
        'text-color': 'rgba(255,251,230,0.35)',
        'text-halo-color': '#f83500',
        'text-halo-width': 1.5,
      },
    },
    // Smaller city labels
    {
      id: 'city-label-minor',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['>', ['get', 'filterrank'], 2],
        ['!', ['any',
          ['==', ['get', 'capital'], 2],
          ['==', ['get', 'capital'], 3],
        ]],
      ],
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 13, 12],
        'text-max-width': 8,
      },
      paint: {
        'text-color': 'rgba(255,251,230,0.2)',
        'text-halo-color': '#f83500',
        'text-halo-width': 1.5,
      },
    },
  ],
};

// ─── Create Map ───

const map = new mapboxgl.Map({
  container: 'map',
  style: mapStyle,
  projection: 'globe',
  center: [20, 20],
  zoom: 3,
  maxPitch: 0,
  attributionControl: true,
});

// Disable rotation (keep it globe-like)
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

// ─── Auto-Spin Globe (Intro) ───

let spinEnabled = true;
let spinRAF = null;

function spinGlobe() {
  if (!spinEnabled) return;
  const center = map.getCenter();
  center.lng += 0.15;
  map.setCenter(center);
  spinRAF = requestAnimationFrame(spinGlobe);
}

function stopSpin() {
  spinEnabled = false;
  if (spinRAF) {
    cancelAnimationFrame(spinRAF);
    spinRAF = null;
  }
}

// ─── Map Load ───

map.on('style.load', () => {
  // Bold orange fog
  map.setFog({
    color: '#f83500',
    'high-color': '#f83500',
    'space-color': '#f83500',
    'horizon-blend': 0,
    'star-intensity': 0,
    range: [20, 20],
  });

  // Initialize theme system (applies saved theme, including map paint)
  initThemes(map);
});

map.on('load', () => {
  spinGlobe();
});

// ─── Game ───

const game = new Game();

let tentativeMarker = null;
let tentativeLngLat = null;
let allMarkers = [];
let currentArrowMarker = null;

// UI refs
const successOverlay = document.getElementById('success-overlay');
const successAnswer = document.getElementById('success-answer');
const successPins = document.getElementById('success-pins');
const successBlurb = document.getElementById('success-blurb');
const successNextBtn = document.getElementById('success-next-btn');
const startBtn = document.getElementById('start-btn');
const playAgainBtn = document.getElementById('play-again-btn');
const pinTracker = document.getElementById('pin-tracker');
const diffEasy = document.getElementById('diff-easy');
const diffHard = document.getElementById('diff-hard');

// ─── Difficulty Toggle ───

diffEasy.addEventListener('click', () => {
  diffEasy.classList.add('active');
  diffHard.classList.remove('active');
  game.setDifficulty('easy');
});

diffHard.addEventListener('click', () => {
  diffHard.classList.add('active');
  diffEasy.classList.remove('active');
  game.setDifficulty('hard');
});

// ─── Map Click ───

map.on('click', (e) => {
  if (!game.isActive || game.currentClueResolved) return;

  const { lng, lat } = e.lngLat;

  // Remove previous tentative marker
  clearTentativeMarker();

  // Create tentative marker with confirm buttons
  const el = document.createElement('div');
  el.className = 'tentative-wrapper';
  el.innerHTML = `
    <div class="tentative-dot"></div>
    <div class="tentative-buttons">
      <button class="tentative-confirm">Drop Pin</button>
      <button class="tentative-cancel">✕</button>
    </div>
  `;

  // Confirm handler
  el.querySelector('.tentative-confirm').addEventListener('click', (ev) => {
    ev.stopPropagation();
    confirmGuess();
  });

  // Cancel handler
  el.querySelector('.tentative-cancel').addEventListener('click', (ev) => {
    ev.stopPropagation();
    clearTentativeMarker();
  });

  tentativeMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng, lat])
    .addTo(map);

  tentativeLngLat = { lng, lat };
});

function confirmGuess() {
  if (!tentativeLngLat || !game.isActive) return;

  const { lng, lat } = tentativeLngLat;
  clearTentativeMarker();

  const result = game.checkGuess(lat, lng);
  if (!result) return;

  // Add square pin to tracker
  const dot = document.createElement('span');
  dot.className = `tracker-dot pin-square ${result.correct ? 'correct' : 'wrong'}`;
  pinTracker.appendChild(dot);

  // Place permanent marker
  const pinEl = document.createElement('div');
  pinEl.className = `pin-marker ${result.correct ? 'pin-correct' : 'pin-wrong'}`;

  const pinMarker = new mapboxgl.Marker({ element: pinEl, anchor: 'center' })
    .setLngLat([lng, lat])
    .addTo(map);
  allMarkers.push(pinMarker);

  if (result.correct) {
    // Remove active arrow on correct guess
    clearActiveArrow();

    // Add row to persistent ledger
    game.addLedgerRow(game.currentClueIndex);

    // Celebration — green flash then blurb reveal
    successAnswer.textContent = result.answer.toUpperCase();
    // Build square pin icons: wrong (red) for misses, correct (green) for the final hit
    const squares = Array.from({ length: result.pinsUsed }, (_, j) => {
      const type = j < result.pinsUsed - 1 ? 'wrong' : 'correct';
      return `<span class="pin-square ${type}"></span>`;
    }).join('');
    successPins.className = '';
    successPins.innerHTML = squares;
    successBlurb.textContent = result.blurb || '';
    successOverlay.classList.remove('hidden', 'phase-blurb');
    // Force reflow to restart animation
    successOverlay.offsetHeight;
    successOverlay.style.animation = 'none';
    successOverlay.offsetHeight;
    successOverlay.style.animation = '';

    // Quick green flash then immediately show blurb
    setTimeout(() => {
      successOverlay.classList.add('phase-blurb');
    }, 600);
  } else {
    // Remove previous active arrow
    clearActiveArrow();

    // Distance label — attached to pin as a marker
    const distEl = document.createElement('div');
    distEl.className = 'pin-distance';
    distEl.innerHTML = `
      <span class="dist-num">${result.distanceKm.toLocaleString()}</span><span class="dist-unit"> km</span>
      <br>
      <span class="dist-num dist-mi">${result.distanceMi.toLocaleString()}</span><span class="dist-unit"> mi</span>
    `;

    const distMarker = new mapboxgl.Marker({ element: distEl, anchor: 'top' })
      .setLngLat([lng, lat])
      .addTo(map);
    allMarkers.push(distMarker);

    // Fade out units after 2.5s
    setTimeout(() => {
      distEl.querySelectorAll('.dist-unit').forEach(u => u.classList.add('dissolve'));
    }, 2500);

    // Direction arrow — clean line arrow, offset in the direction of the target
    const guessScreen = map.project([lng, lat]);
    const targetScreen = map.project([result.targetLon, result.targetLat]);
    const dx = targetScreen.x - guessScreen.x;
    const dy = targetScreen.y - guessScreen.y;
    const screenAngle = Math.atan2(dx, -dy) * 180 / Math.PI;

    // Offset the arrow marker away from the pin in the direction it points
    const offsetDist = 30;
    const rad = screenAngle * Math.PI / 180;
    const offsetPx = { x: Math.sin(rad) * offsetDist, y: -Math.cos(rad) * offsetDist };
    const arrowLngLat = map.unproject([guessScreen.x + offsetPx.x, guessScreen.y + offsetPx.y]);

    const arrowEl = document.createElement('div');
    arrowEl.className = 'direction-arrow';
    // Clean stroke-only arrow: line + two chevron arms
    arrowEl.innerHTML = `
      <svg viewBox="0 0 40 40" style="transform: rotate(${screenAngle}deg)">
        <g class="direction-arrow-inner">
          <line x1="20" y1="32" x2="20" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="12" y1="16" x2="20" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="28" y1="16" x2="20" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </g>
      </svg>
    `;

    currentArrowMarker = new mapboxgl.Marker({ element: arrowEl, anchor: 'center' })
      .setLngLat(arrowLngLat)
      .addTo(map);
  }
}

// ─── Helpers ───

function clearActiveArrow() {
  if (currentArrowMarker) {
    currentArrowMarker.remove();
    currentArrowMarker = null;
  }
}

function clearTentativeMarker() {
  if (tentativeMarker) {
    tentativeMarker.remove();
    tentativeMarker = null;
    tentativeLngLat = null;
  }
}

function clearAllMarkers() {
  for (const m of allMarkers) m.remove();
  allMarkers = [];
  clearActiveArrow();
}

// ─── Next Clue ───

successNextBtn.addEventListener('click', () => {
  successOverlay.classList.add('hidden');
  successOverlay.classList.remove('phase-blurb');
  pinTracker.innerHTML = '';
  const continues = game.nextClue();
  if (continues) clearAllMarkers();
});

// ─── Start / Restart ───

let vibesIntroPlayed = false;
const vibesBtn = document.getElementById('vibes-btn');

startBtn.addEventListener('click', () => {
  // Stop spinning globe
  stopSpin();

  // Animate zoom out to gameplay level
  map.easeTo({
    zoom: 1.5,
    center: [20, 20],
    duration: 1500,
    easing: (t) => t * (2 - t),
  });

  pinTracker.innerHTML = '';
  game.startRound();
  clearAllMarkers();

  // Vibes button intro: appear big, then shrink to corner
  if (!vibesIntroPlayed && vibesBtn) {
    vibesIntroPlayed = true;
    vibesBtn.classList.remove('settled');
    vibesBtn.classList.add('visible');
    setTimeout(() => {
      vibesBtn.classList.add('settled');
    }, 1200);
  } else if (vibesBtn) {
    vibesBtn.classList.add('visible', 'settled');
  }
});

playAgainBtn.addEventListener('click', () => {
  map.easeTo({
    zoom: 1.5,
    center: [20, 20],
    duration: 800,
  });

  pinTracker.innerHTML = '';
  game.startRound();
  clearAllMarkers();

  if (vibesBtn) vibesBtn.classList.add('visible', 'settled');
});

// ─── Feedback ───

const feedbackBtn = document.getElementById('feedback-btn');
const feedbackOverlay = document.getElementById('feedback-overlay');
const feedbackInner = document.getElementById('feedback-inner');
const feedbackThanks = document.getElementById('feedback-thanks');
const feedbackText = document.getElementById('feedback-text');
const feedbackSubmit = document.getElementById('feedback-submit');
const feedbackClose = document.getElementById('feedback-close');
const thanksClose = document.getElementById('thanks-close');

feedbackBtn.addEventListener('click', () => {
  feedbackInner.classList.remove('hidden');
  feedbackThanks.classList.add('hidden');
  feedbackText.value = '';
  feedbackOverlay.classList.remove('hidden');
  feedbackText.focus();
});

feedbackClose.addEventListener('click', () => {
  feedbackOverlay.classList.add('hidden');
});

thanksClose.addEventListener('click', () => {
  feedbackOverlay.classList.add('hidden');
});

feedbackSubmit.addEventListener('click', () => {
  const text = feedbackText.value.trim();
  if (!text) return;

  const entry = {
    text,
    ts: new Date().toISOString(),
    ua: navigator.userAgent,
  };

  const stored = JSON.parse(localStorage.getItem('pg-feedback') || '[]');
  stored.push(entry);
  localStorage.setItem('pg-feedback', JSON.stringify(stored));

  feedbackInner.classList.add('hidden');
  feedbackThanks.classList.remove('hidden');
});
