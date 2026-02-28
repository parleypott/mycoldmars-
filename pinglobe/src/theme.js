const THEMES = {
  bold: {
    label: 'Bold',
    css: {
      '--bg': '#f83500',
      '--bg-panel': 'rgba(248, 53, 0, 0.95)',
      '--bg-solid': '#f83500',
      '--bg-start': 'rgba(248, 53, 0, 0.85)',
      '--text': '#1a1a1a',
      '--text-dim': 'rgba(0, 0, 0, 0.55)',
      '--text-faint': 'rgba(0, 0, 0, 0.3)',
      '--red': '#1a1a1a',
      '--green': '#fffbe6',
      '--border': '#1a1a1a',
      '--border-light': 'rgba(0, 0, 0, 0.15)',
      '--font': "'Bebas Neue', 'Helvetica Neue', system-ui, sans-serif",
      '--mono': "'Bebas Neue', 'Helvetica Neue', system-ui, sans-serif",
      '--btn-bg': '#1a1a1a',
      '--btn-text': '#f83500',
    },
    map: {
      background: '#f83500',
      water: '#f83500',
      outlines: '#fffbe6',
      labelColor: ['interpolate', ['linear'], ['zoom'], 1, 'rgba(255,251,230,0)', 2, 'rgba(255,251,230,0.2)', 3, 'rgba(255,251,230,0.4)', 5, 'rgba(255,251,230,0.7)', 7, '#fffbe6'],
      labelHalo: '#f83500',
      capitalColor: ['interpolate', ['linear'], ['zoom'], 3, 'rgba(255,251,230,0.3)', 5, 'rgba(255,251,230,0.6)', 7, 'rgba(255,251,230,0.85)'],
      cityColor: 'rgba(255,251,230,0.35)',
      cityMinorColor: 'rgba(255,251,230,0.2)',
      fog: {
        color: '#f83500',
        'high-color': '#f83500',
        'space-color': '#f83500',
        'horizon-blend': 0,
        'star-intensity': 0,
        range: [20, 20],
      },
    },
  },

  monochrome: {
    label: 'Monochrome',
    css: {
      '--bg': '#ffffff',
      '--bg-panel': 'rgba(255, 255, 255, 0.92)',
      '--bg-solid': '#ffffff',
      '--bg-start': 'rgba(255, 255, 255, 0.85)',
      '--text': '#000000',
      '--text-dim': 'rgba(0, 0, 0, 0.4)',
      '--text-faint': 'rgba(0, 0, 0, 0.2)',
      '--red': '#ff0000',
      '--green': '#00e676',
      '--border': '#000000',
      '--border-light': 'rgba(0, 0, 0, 0.1)',
      '--font': "'Space Grotesk', 'Helvetica Neue', system-ui, sans-serif",
      '--mono': "'Space Mono', 'Courier New', monospace",
      '--btn-bg': '#000000',
      '--btn-text': '#ffffff',
    },
    map: {
      background: '#ffffff',
      water: '#ffffff',
      outlines: '#000000',
      labelColor: ['interpolate', ['linear'], ['zoom'], 1, 'rgba(255,0,0,0)', 2, 'rgba(255,0,0,0.2)', 3, 'rgba(255,0,0,0.4)', 5, 'rgba(255,0,0,0.7)', 7, '#ff0000'],
      labelHalo: '#ffffff',
      capitalColor: ['interpolate', ['linear'], ['zoom'], 3, 'rgba(255,0,0,0.3)', 5, 'rgba(255,0,0,0.6)', 7, 'rgba(255,0,0,0.8)'],
      cityColor: 'rgba(0,0,0,0.3)',
      cityMinorColor: 'rgba(0,0,0,0.2)',
      fog: {
        color: '#ffffff',
        'high-color': '#ffffff',
        'space-color': '#ffffff',
        'horizon-blend': 0,
        'star-intensity': 0,
      },
    },
  },
};

const THEME_ORDER = ['bold', 'monochrome'];
let currentTheme = 'bold';
let mapRef = null;

export function initThemes(map) {
  mapRef = map;

  // Restore saved theme
  const saved = localStorage.getItem('globe-theme');
  if (saved && THEMES[saved]) {
    currentTheme = saved;
  }
  applyTheme(currentTheme);

  // VIBES button — cycles through themes
  const btn = document.getElementById('vibes-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      const idx = THEME_ORDER.indexOf(currentTheme);
      const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      applyTheme(next);
      localStorage.setItem('globe-theme', next);

      // Juicy feedback — brief scale pulse
      btn.style.transform = 'scale(1.15)';
      setTimeout(() => { btn.style.transform = ''; }, 150);
    });
  }
}

function applyTheme(name) {
  const theme = THEMES[name];
  if (!theme) return;
  currentTheme = name;

  // Apply CSS variables
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.css)) {
    root.style.setProperty(prop, value);
  }

  document.body.dataset.theme = name;

  // Apply Mapbox paint properties
  if (mapRef && mapRef.isStyleLoaded()) {
    applyMapTheme(theme.map);
  }
}

function applyMapTheme(m) {
  try {
    mapRef.setPaintProperty('background', 'background-color', m.background);
    mapRef.setPaintProperty('water', 'fill-color', m.water);
    mapRef.setPaintProperty('country-outlines', 'line-color', m.outlines);
    mapRef.setPaintProperty('admin-disputed', 'line-color', m.outlines);
    mapRef.setPaintProperty('country-label', 'text-color', m.labelColor);
    mapRef.setPaintProperty('country-label', 'text-halo-color', m.labelHalo);
    mapRef.setPaintProperty('capital-label', 'text-color', m.capitalColor);
    mapRef.setPaintProperty('capital-label', 'text-halo-color', m.labelHalo);
    mapRef.setPaintProperty('city-label-major', 'text-color', m.cityColor);
    mapRef.setPaintProperty('city-label-major', 'text-halo-color', m.labelHalo);
    mapRef.setPaintProperty('city-label-minor', 'text-color', m.cityMinorColor);
    mapRef.setPaintProperty('city-label-minor', 'text-halo-color', m.labelHalo);
    mapRef.setFog(m.fog);
  } catch (e) {
    console.warn('Theme map update failed:', e);
  }
}

export function getCurrentTheme() {
  return currentTheme;
}
