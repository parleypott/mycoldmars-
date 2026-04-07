import mapboxgl from 'mapbox-gl';
import * as topojson from 'topojson-client';
import worldTopo from 'world-atlas/countries-110m.json';
import './style.css';

mapboxgl.accessToken =
  'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

// ─── Custom map style ───────────────────────────────────────────────
const mapStyle = {
  version: 8,
  name: 'EEZ Globe',
  sources: {
    'mapbox-streets': {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    },
    countries: {
      type: 'geojson',
      data: countriesGeo,
    },
  },
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#020817' },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'mapbox-streets',
      'source-layer': 'water',
      paint: { 'fill-color': '#040d1f' },
    },
    {
      id: 'land',
      type: 'fill',
      source: 'countries',
      paint: { 'fill-color': '#0a1628' },
    },
    {
      id: 'country-outlines',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': 'rgba(100, 180, 255, 0.08)',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.3,
          3, 0.5,
          6, 0.8,
        ],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    {
      id: 'country-label',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'country'],
      minzoom: 3,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          3, 0, 4, 7, 6, 10, 8, 13,
        ],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        'text-max-width': 8,
      },
      paint: {
        'text-color': [
          'interpolate', ['linear'], ['zoom'],
          3, 'rgba(100, 180, 255, 0)',
          4, 'rgba(100, 180, 255, 0.1)',
          6, 'rgba(100, 180, 255, 0.2)',
          8, 'rgba(100, 180, 255, 0.35)',
        ],
        'text-halo-color': '#020817',
        'text-halo-width': 1.5,
      },
    },
  ],
};

// ─── Map init (pinglobe rig) ────────────────────────────────────────
const map = new mapboxgl.Map({
  container: 'map',
  style: mapStyle,
  projection: 'globe',
  center: [20, 20],
  zoom: 2.2,
  maxPitch: 0,
  attributionControl: true,
});

map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

// ─── Spin ───────────────────────────────────────────────────────────
let spinEnabled = true;
let spinRAF = null;
let idleTimer = null;

function spinGlobe() {
  if (!spinEnabled) return;
  const center = map.getCenter();
  center.lng += 0.15;
  map.setCenter(center);
  spinRAF = requestAnimationFrame(spinGlobe);
}

function pauseSpin() {
  spinEnabled = false;
  if (spinRAF) {
    cancelAnimationFrame(spinRAF);
    spinRAF = null;
  }
  clearTimeout(idleTimer);
}

function scheduleResume() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    spinEnabled = true;
    spinGlobe();
  }, 3000);
}

map.on('mousedown', pauseSpin);
map.on('touchstart', pauseSpin);
map.on('moveend', scheduleResume);

// ─── Fog / atmosphere ───────────────────────────────────────────────
map.on('style.load', () => {
  map.setFog({
    color: '#0a1628',
    'high-color': '#1a3a6a',
    'space-color': '#020817',
    'horizon-blend': 0.03,
    'star-intensity': 0.6,
    range: [0.5, 8],
  });
});

// ─── EEZ data + layers ──────────────────────────────────────────────
const EEZ_URL =
  'https://raw.githubusercontent.com/lmirosevic/ReverseGeo/master/lib/reverse_geo/World-EEZ.geojson';

const DEFAULT_FILL_OPACITY = [
  'interpolate', ['linear'], ['zoom'],
  0, 0.03, 3, 0.06, 6, 0.1,
];

map.on('load', () => {
  spinGlobe();

  fetch(EEZ_URL)
    .then((res) => res.json())
    .then((eezData) => addEEZLayers(eezData))
    .catch((err) => console.warn('Failed to load EEZ data:', err));
});

function addEEZLayers(eezData) {
  map.addSource('eez', {
    type: 'geojson',
    data: eezData,
    tolerance: 0.5,
  });

  // Fill — subtle translucent blue
  map.addLayer(
    {
      id: 'eez-fill',
      type: 'fill',
      source: 'eez',
      paint: {
        'fill-color': '#1a4a8a',
        'fill-opacity': DEFAULT_FILL_OPACITY,
      },
    },
    'country-outlines',
  );

  // Outer glow — wide bloom
  map.addLayer(
    {
      id: 'eez-glow-outer',
      type: 'line',
      source: 'eez',
      paint: {
        'line-color': '#4a9eff',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          0, 3, 3, 5, 6, 8,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          0, 4, 3, 6, 6, 10,
        ],
        'line-opacity': 0.15,
        'line-emissive-strength': 0.8,
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    'country-outlines',
  );

  // Inner glow — tighter ring
  map.addLayer(
    {
      id: 'eez-glow-inner',
      type: 'line',
      source: 'eez',
      paint: {
        'line-color': '#6ab4ff',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          0, 1.5, 3, 2.5, 6, 4,
        ],
        'line-blur': [
          'interpolate', ['linear'], ['zoom'],
          0, 2, 3, 3, 6, 5,
        ],
        'line-opacity': 0.3,
        'line-emissive-strength': 0.9,
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    'country-outlines',
  );

  // Core line — sharp bright center
  map.addLayer(
    {
      id: 'eez-line',
      type: 'line',
      source: 'eez',
      paint: {
        'line-color': '#8acfff',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          0, 0.4, 3, 0.7, 6, 1.2,
        ],
        'line-opacity': 0.7,
        'line-emissive-strength': 1.0,
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    'country-outlines',
  );

  setupHover();
}

// ─── Hover interaction ──────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');

function setupHover() {
  map.on('mouseenter', 'eez-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'eez-fill', () => {
    map.getCanvas().style.cursor = '';
    tooltip.classList.remove('visible');
    map.setPaintProperty('eez-fill', 'fill-opacity', DEFAULT_FILL_OPACITY);
  });

  map.on('mousemove', 'eez-fill', (e) => {
    if (!e.features || e.features.length === 0) return;

    const name = e.features[0].properties.Country ||
                 e.features[0].properties.ISO_A3 || '';

    tooltip.textContent = name;
    tooltip.classList.add('visible');

    map.setPaintProperty('eez-fill', 'fill-opacity', [
      'case',
      ['==', ['get', 'Country'], name],
      ['interpolate', ['linear'], ['zoom'], 0, 0.08, 3, 0.15, 6, 0.25],
      DEFAULT_FILL_OPACITY,
    ]);
  });
}
