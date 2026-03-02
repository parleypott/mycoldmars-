import mapboxgl from 'mapbox-gl';
import './style.css';

mapboxgl.accessToken = 'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

const PALAU_CENTER = [134.48, 7.35];
const PALAU_BOUNDS = [[131.0, 2.0], [136.0, 9.0]];
const GLYPHS = 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf';

// ─── Shared label layers ───
function labelLayers(textColor, haloColor, capitalColor, majorColor, minorColor) {
  return [
    {
      id: 'country-label', type: 'symbol',
      source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'country'],
      minzoom: 1,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 0, 4, 10, 7, 16],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
      },
      paint: { 'text-color': textColor, 'text-halo-color': haloColor, 'text-halo-width': 2 },
    },
    {
      id: 'capital-label', type: 'symbol',
      source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['any', ['==', ['get', 'capital'], 2], ['==', ['get', 'capital'], 3]],
      ],
      minzoom: 5,
      layout: {
        'text-field': ['concat', '★ ', ['get', 'name_en']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 8, 11, 12, 14],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
      },
      paint: { 'text-color': capitalColor, 'text-halo-color': haloColor, 'text-halo-width': 1.5 },
    },
    {
      id: 'city-label-major', type: 'symbol',
      source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['<=', ['get', 'filterrank'], 2],
        ['!', ['any', ['==', ['get', 'capital'], 2], ['==', ['get', 'capital'], 3]]],
      ],
      minzoom: 8,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
        'text-max-width': 8,
      },
      paint: { 'text-color': majorColor, 'text-halo-color': haloColor, 'text-halo-width': 1.5 },
    },
    {
      id: 'city-label-minor', type: 'symbol',
      source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['all',
        ['==', ['get', 'class'], 'settlement'],
        ['>', ['get', 'filterrank'], 2],
        ['!', ['any', ['==', ['get', 'capital'], 2], ['==', ['get', 'capital'], 3]]],
      ],
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 14, 12],
        'text-max-width': 8,
      },
      paint: { 'text-color': minorColor, 'text-halo-color': haloColor, 'text-halo-width': 1.5 },
    },
  ];
}

// ═══════════════════════════════════════
//  NEON THEME — black everything, ivory lines
// ═══════════════════════════════════════
const neonStyle = {
  version: 8,
  name: 'Palau Neon',
  sources: {
    'mapbox-streets': { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
  },
  glyphs: GLYPHS,
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
    {
      id: 'water', type: 'fill',
      source: 'mapbox-streets', 'source-layer': 'water',
      paint: { 'fill-color': '#000000' },
    },
    {
      id: 'coastlines', type: 'line',
      source: 'mapbox-streets', 'source-layer': 'water',
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 4, 0.6, 8, 1.0, 12, 1.5, 16, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    {
      id: 'admin-disputed', type: 'line',
      source: 'mapbox-streets', 'source-layer': 'admin',
      filter: ['all', ['==', ['get', 'admin_level'], 0], ['==', ['get', 'disputed'], 'true']],
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 4, 0.6, 8, 1],
        'line-dasharray': [3, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    ...labelLayers(
      ['interpolate', ['linear'], ['zoom'], 1, 'rgba(255,251,230,0)', 4, 'rgba(255,251,230,0.3)', 7, 'rgba(255,251,230,0.7)'],
      '#000000',
      ['interpolate', ['linear'], ['zoom'], 5, 'rgba(255,251,230,0.3)', 7, 'rgba(255,251,230,0.6)', 10, 'rgba(255,251,230,0.85)'],
      'rgba(255,251,230,0.35)',
      'rgba(255,251,230,0.2)',
    ),
  ],
};

// ═══════════════════════════════════════
//  REALISTIC THEME — satellite, hillshade, bathymetry
// ═══════════════════════════════════════
const realisticStyle = {
  version: 8,
  name: 'Palau Realistic',
  sources: {
    'mapbox-streets': { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
    'mapbox-satellite': { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 },
    'mapbox-dem': { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 },
  },
  glyphs: GLYPHS,
  layers: [
    // Deep ocean background
    { id: 'background', type: 'background', paint: { 'background-color': '#0a2e4a' } },
    // Satellite imagery — natural bathymetry + land colors
    {
      id: 'satellite', type: 'raster',
      source: 'mapbox-satellite',
      paint: {
        'raster-saturation': 0.15,
        'raster-brightness-min': 0.06,
        'raster-contrast': 0.08,
      },
    },
    // Hillshade — terrain shading over satellite
    {
      id: 'hillshade', type: 'hillshade',
      source: 'mapbox-dem',
      paint: {
        'hillshade-exaggeration': 0.5,
        'hillshade-shadow-color': '#0a1628',
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.2)',
        'hillshade-accent-color': '#1a4a3a',
        'hillshade-illumination-direction': 315,
      },
    },
    // Subtle coastline
    {
      id: 'coastlines', type: 'line',
      source: 'mapbox-streets', 'source-layer': 'water',
      paint: {
        'line-color': 'rgba(255,255,255,0.2)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.2, 8, 0.4, 14, 0.8],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    ...labelLayers(
      ['interpolate', ['linear'], ['zoom'], 1, 'rgba(255,255,255,0)', 4, 'rgba(255,255,255,0.5)', 7, 'rgba(255,255,255,0.9)'],
      'rgba(0,0,0,0.6)',
      ['interpolate', ['linear'], ['zoom'], 5, 'rgba(255,255,255,0.5)', 7, 'rgba(255,255,255,0.8)', 10, '#ffffff'],
      'rgba(255,255,255,0.65)',
      'rgba(255,255,255,0.4)',
    ),
  ],
};

// ═══════════════════════════════════════
//  THEME TOGGLING
// ═══════════════════════════════════════
const THEMES = {
  neon: {
    style: neonStyle,
    fog: { color: '#000', 'high-color': '#000', 'space-color': '#000', 'horizon-blend': 0, 'star-intensity': 0 },
  },
  realistic: {
    style: realisticStyle,
    fog: { color: '#8ab4d6', 'high-color': '#4a8ab4', 'space-color': '#04162a', 'horizon-blend': 0.04, 'star-intensity': 0 },
  },
};

const THEME_ORDER = ['neon', 'realistic'];
let currentTheme = localStorage.getItem('palau-theme') || 'neon';
if (!THEMES[currentTheme]) currentTheme = 'neon';

// ─── Create Map ───
const map = new mapboxgl.Map({
  container: 'map',
  style: THEMES[currentTheme].style,
  center: PALAU_CENTER,
  zoom: 9,
  minZoom: 6,
  maxZoom: 18,
  maxBounds: PALAU_BOUNDS,
  maxPitch: 0,
  attributionControl: true,
});

map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

// Theme UI — set data-theme on body for CSS selectors
function applyThemeUI(name) {
  document.body.dataset.theme = name;
}
applyThemeUI(currentTheme);

// Fog on every style load
map.on('style.load', () => {
  map.setFog(THEMES[currentTheme].fog);
});

// ─── VIBES button ───
const vibesBtn = document.getElementById('vibes-btn');
if (vibesBtn) {
  vibesBtn.addEventListener('click', () => {
    const idx = THEME_ORDER.indexOf(currentTheme);
    currentTheme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    localStorage.setItem('palau-theme', currentTheme);

    map.setStyle(THEMES[currentTheme].style, { diff: false });
    applyThemeUI(currentTheme);

    // Juicy feedback
    vibesBtn.style.transform = 'scale(1.15)';
    setTimeout(() => { vibesBtn.style.transform = ''; }, 150);
  });
}
