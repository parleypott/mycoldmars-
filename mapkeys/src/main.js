import mapboxgl from 'mapbox-gl';
import { unzipSync, strFromU8 } from 'fflate';
import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';
import './style.css';

// ─── Mapbox setup ───

mapboxgl.accessToken = 'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

// Earthen terrain palette — quiet, mountain-forward, no clutter
const PAL = {
  paper: '#e4d8be',   // warm sand land
  ocean: '#bdb59a',   // muted dust-sage ocean (no bathymetry shading)
  ink:   '#2b2a26',
  shade: '#6b5640',   // umber ridge shadow
  fog:   '#e0d4b8',
};

// Restore last camera position so a reload picks up where you left off.
const CAMERA_LS_KEY = 'mapkeys_last_camera';
let isPlayingBack = false;  // local flag (updated by play/stop). Avoids any
                            // chance of touching `state` before it's defined.
function loadLastCamera() {
  try {
    const raw = localStorage.getItem(CAMERA_LS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.center) || c.center.length !== 2) return null;
    if (typeof c.zoom !== 'number') return null;
    return c;
  } catch { return null; }
}
const lastCam = loadLastCamera();
console.info('[mapkeys] loaded camera:', lastCam || '(none — using defaults)');

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  projection: 'globe',
  center: lastCam?.center ?? [20, 20],
  zoom: lastCam?.zoom ?? 1.8,
  bearing: lastCam?.bearing ?? 0,
  pitch: lastCam?.pitch ?? 0,
  maxPitch: 85,
  attributionControl: false,
  preserveDrawingBuffer: true,
});

function saveCurrentCamera() {
  if (isPlayingBack) return;
  try {
    const c = map.getCenter();
    localStorage.setItem(CAMERA_LS_KEY, JSON.stringify({
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      savedAt: Date.now(),
    }));
  } catch {}
}

// `moveend` is the natural fit but on globe projection it can be flaky;
// `idle` fires when all motion + tile loading is fully settled, which is
// strictly more reliable. Listen to both — saves are cheap and idempotent.
map.on('moveend', saveCurrentCamera);
map.on('zoomend', saveCurrentCamera);
map.on('pitchend', saveCurrentCamera);
map.on('rotateend', saveCurrentCamera);

// Last-resort save: if the user reloads or closes the tab mid-gesture before
// `idle` fires, capture position on unload.
window.addEventListener('beforeunload', saveCurrentCamera);
window.addEventListener('pagehide', saveCurrentCamera);

map.on('style.load', () => {
  // ── Quiet, warm fog
  map.setFog({
    color: PAL.fog,
    'high-color': '#d8cfbb',
    'space-color': '#1a1916',
    'horizon-blend': 0.04,
    'star-intensity': 0.05,
  });

  // ── 3D terrain (DEM)
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    });
  }
  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.3 });

  // ── Hillshade — subtle ridge emphasis
  if (!map.getLayer('mk-hillshade')) {
    // Insert under labels if possible
    const layers = map.getStyle().layers;
    const firstSymbol = layers.find(l => l.type === 'symbol')?.id;
    map.addLayer({
      id: 'mk-hillshade',
      type: 'hillshade',
      source: 'mapbox-dem',
      paint: {
        'hillshade-shadow-color': PAL.shade,
        'hillshade-highlight-color': '#f4ead0',
        'hillshade-accent-color': '#4d3d29',
        'hillshade-exaggeration': 0.62,
      },
    }, firstSymbol);
  }

  // ── Recolor base style toward earthen minimal
  const recolor = [
    ['background', 'background-color', PAL.paper],
    ['land', 'background-color', PAL.paper],
    ['landcover', 'fill-color', PAL.paper],
    ['national-park', 'fill-color', '#dac9a8'],
    ['landuse', 'fill-color', '#dccdaf'],
    ['pitch', 'fill-color', '#dccdaf'],
    ['pitch-line', 'line-color', '#c6b596'],
    // Water — flat earthen tone, no bathymetry depth shading
    ['water', 'fill-color', PAL.ocean],
    ['waterway', 'line-color', '#a89e80'],
  ];
  for (const [id, prop, val] of recolor) {
    if (map.getLayer(id)) {
      try { map.setPaintProperty(id, prop, val); } catch (_) {}
    }
  }

  // ── Hide everything noisy: roads, transit, admin boundaries, bathymetry, ALL labels
  const hideById = (id) => {
    if (map.getLayer(id)) {
      try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (_) {}
    }
  };
  const hidePrefixes = [
    'road', 'bridge', 'tunnel', 'aeroway', 'rail', 'ferry', 'transit', 'building',
    'admin',                  // country / state / disputed boundaries
    'boundary',
    'water-depth', 'bathymetry', 'water-shadow',  // bathymetric shading
  ];
  const hideKeywords = ['label', 'place-', 'poi-', 'natural-point', 'water-point'];

  for (const layer of map.getStyle().layers) {
    if (layer.id === 'mk-hillshade') continue;
    if (layer.id.startsWith('route-')) continue;
    const id = layer.id;
    if (hidePrefixes.some(p => id.startsWith(p))) { hideById(id); continue; }
    if (hideKeywords.some(k => id.includes(k))) { hideById(id); continue; }
    if (layer.type === 'symbol') { hideById(id); }   // catch-all for labels
  }

  // Route sources are now created per-layer when a KML is uploaded.
  // After style.load (or restyle), recreate any persisted layer's
  // sources/layers — they get blown away by Mapbox on style change.
  for (const layer of state.layers) {
    ensureLayerOnMap(layer);
  }
  for (const shape of state.shapes) {
    ensureShapeOnMap(shape);
    redrawShape(shape);
  }
  ensureDrawPreviewOnMap();
  // Re-render with the current preview progress so a hard refresh shows
  // the correct partial-draw state immediately.
  setRouteSources(state.previewProgress);
});

// ─── State ───

const DEFAULT_LAYER_STYLE = { color: '#2b2a26', width: 3, opacity: 1, dashed: false, trail: true };
// Color cycle for new uploads so they're visually distinct by default.
const LAYER_COLORS = ['#2b2a26', '#a8482b', '#3b6a4a', '#4a5e8a', '#8a4a6a', '#6a4a2b'];

const state = {
  keyframes: [],          // { center, zoom, bearing, pitch, progress, duration, easing, shapes: { id: {...} } }
  selectedId: null,
  nextId: 1,
  layers: [],             // [{ id, name, coords, cumDist, totalDist, style, visible }]
  activeLayerId: null,    // which layer the route-style controls bind to
  previewProgress: 0,    // current scrub-bar position (0–1), what + Keyframe captures
  shapes: [],             // [{ id, type, sides?, baseCoords?, stroke, fill, strokeWidth, fillOpacity, visible, preview: {...} }]
  activeShapeId: null,    // selected shape (or null)
  drawingLine: null,      // when drawing a line: { coords: [[lng,lat], ...], cursor: [lng,lat] | null }
  draggingShape: null,    // when dragging: { shapeId, type, anchor: [lng,lat], origin: {...preview} }
  playing: false,
  rafId: null,
  playStart: 0,
  playOffset: 0,
};

// Backwards-compat shim: code that referenced state.route as "the current
// route" now reads the active layer (or first visible layer).
Object.defineProperty(state, 'route', {
  get() {
    const active = state.layers.find(l => l.id === state.activeLayerId);
    if (active) return active;
    return state.layers.find(l => l.visible) || null;
  },
});

function activeLayer() {
  return state.layers.find(l => l.id === state.activeLayerId)
      || state.layers.find(l => l.visible)
      || state.layers[0]
      || null;
}

function layerSourceIds(id) {
  return {
    full: `route-full-${id}`,
    drawn: `route-drawn-${id}`,
    fullLine: `route-full-line-${id}`,
    drawnGlow: `route-drawn-glow-${id}`,
    drawnLine: `route-drawn-line-${id}`,
  };
}

function ensureLayerOnMap(layer) {
  const ids = layerSourceIds(layer.id);
  if (!map.getSource(ids.full)) {
    map.addSource(ids.full, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getSource(ids.drawn)) {
    map.addSource(ids.drawn, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer(ids.fullLine)) {
    map.addLayer({
      id: ids.fullLine,
      type: 'line',
      source: ids.full,
      paint: {
        'line-color': layer.style.color,
        'line-opacity': 0.25,
        'line-width': 1.5,
        'line-dasharray': [2, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  if (!map.getLayer(ids.drawnGlow)) {
    map.addLayer({
      id: ids.drawnGlow,
      type: 'line',
      source: ids.drawn,
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.55, 'line-blur': 2 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  if (!map.getLayer(ids.drawnLine)) {
    map.addLayer({
      id: ids.drawnLine,
      type: 'line',
      source: ids.drawn,
      paint: { 'line-color': layer.style.color, 'line-width': layer.style.width },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  applyLayerStyle(layer);
  applyLayerVisibility(layer);
}

function removeLayerFromMap(layer) {
  const ids = layerSourceIds(layer.id);
  for (const id of [ids.fullLine, ids.drawnGlow, ids.drawnLine]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [ids.full, ids.drawn]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function applyLayerStyle(layer) {
  const ids = layerSourceIds(layer.id);
  const { color, width, opacity, dashed, trail } = layer.style;
  if (map.getLayer(ids.drawnLine)) {
    map.setPaintProperty(ids.drawnLine, 'line-color', color);
    map.setPaintProperty(ids.drawnLine, 'line-width', width);
    map.setPaintProperty(ids.drawnLine, 'line-opacity', opacity);
    map.setPaintProperty(ids.drawnLine, 'line-dasharray', dashed ? [2, 1.5] : [1, 0]);
  }
  if (map.getLayer(ids.drawnGlow)) {
    map.setPaintProperty(ids.drawnGlow, 'line-width', width + 4);
    map.setPaintProperty(ids.drawnGlow, 'line-opacity', opacity * 0.55);
  }
  if (map.getLayer(ids.fullLine)) {
    map.setLayoutProperty(ids.fullLine, 'visibility', (trail && layer.visible) ? 'visible' : 'none');
    map.setPaintProperty(ids.fullLine, 'line-color', color);
    map.setPaintProperty(ids.fullLine, 'line-width', Math.max(1, width * 0.5));
    map.setPaintProperty(ids.fullLine, 'line-opacity', opacity * 0.3);
  }
}

function applyLayerVisibility(layer) {
  const ids = layerSourceIds(layer.id);
  const vis = layer.visible ? 'visible' : 'none';
  for (const id of [ids.drawnLine, ids.drawnGlow]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
  if (map.getLayer(ids.fullLine)) {
    map.setLayoutProperty(ids.fullLine, 'visibility', (layer.style.trail && layer.visible) ? 'visible' : 'none');
  }
}

// Re-apply style/visibility to all layers (called when activeLayerId changes,
// just in case any visual treatment depends on which is "active" — currently
// none does, but keeps a single entry point.)
function applyRouteStyle() {
  for (const l of state.layers) applyLayerStyle(l);
}

const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
};

// ─── KML / KMZ parsing ───

async function readRouteFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kmz')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buf);
    // Prefer doc.kml, otherwise first .kml in the archive
    let kmlEntry = Object.keys(files).find(k => k.toLowerCase() === 'doc.kml')
                || Object.keys(files).find(k => k.toLowerCase().endsWith('.kml'));
    if (!kmlEntry) throw new Error('No .kml found inside KMZ');
    return strFromU8(files[kmlEntry]);
  }
  return await file.text();
}

function parseKML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const lineStrings = doc.getElementsByTagName('LineString');
  const out = [];
  for (const ls of lineStrings) {
    const coordEl = ls.getElementsByTagName('coordinates')[0];
    if (!coordEl) continue;
    const tokens = coordEl.textContent.trim().split(/\s+/);
    for (const tok of tokens) {
      const parts = tok.split(',').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        out.push([parts[0], parts[1]]);
      }
    }
  }
  // Also try gx:Track / Track if no LineString — flexible KML support
  if (out.length === 0) {
    const coords = doc.getElementsByTagName('coord');
    for (const c of coords) {
      const parts = c.textContent.trim().split(/\s+/).map(Number);
      if (parts.length >= 2) out.push([parts[0], parts[1]]);
    }
  }
  return out;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function buildRoute(coords) {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    cumDist.push(cumDist[i - 1] + haversine(lat1, lng1, lat2, lng2));
  }
  return { coords, cumDist, totalDist: cumDist[cumDist.length - 1] || 0 };
}

function sliceRoute(route, progress) {
  const { coords, cumDist, totalDist } = route;
  if (progress <= 0 || coords.length < 2) return [];
  if (progress >= 1) return coords.slice();
  const target = totalDist * progress;
  let i = 1;
  while (i < cumDist.length && cumDist[i] < target) i++;
  if (i >= coords.length) return coords.slice();
  const segLen = cumDist[i] - cumDist[i - 1];
  const t = segLen > 0 ? (target - cumDist[i - 1]) / segLen : 0;
  const [lng1, lat1] = coords[i - 1];
  const [lng2, lat2] = coords[i];
  return [...coords.slice(0, i), [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t]];
}

function setRouteSources(progress) {
  for (const layer of state.layers) {
    const ids = layerSourceIds(layer.id);
    const fullSrc = map.getSource(ids.full);
    const drawnSrc = map.getSource(ids.drawn);
    if (!fullSrc || !drawnSrc) continue;
    fullSrc.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: layer.coords },
    });
    const drawn = sliceRoute(layer, progress);
    drawnSrc.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: drawn },
    });
  }
}

// ─── Shapes (drawn polygons + lines) ───

const SHAPE_DEFAULTS = {
  stroke: '#2b2a26',
  fill: '#a8482b',
  strokeWidth: 2,
  fillOpacity: 0.35,
  visible: true,
};

const SHAPE_FILLS = ['#a8482b', '#b85c3c', '#3b6a4a', '#4a5e8a', '#8a4a6a', '#c69437'];

const KM_PER_DEG_LAT = 111.32;

function shapeSourceIds(id) {
  return {
    fill: `shape-fill-src-${id}`,
    line: `shape-line-src-${id}`,
    fillLayer: `shape-fill-${id}`,
    lineLayer: `shape-line-${id}`,
  };
}

// Approximate regular polygon ring in lng/lat. Not perfectly geodesic but
// visually correct at typical zoom levels. Scales lng by 1/cos(lat) so the
// shape doesn't squash near the poles.
function regularPolygonCoords(center, sides, radiusKm, rotationDeg) {
  const [lng0, lat0] = center;
  const latRad = lat0 * Math.PI / 180;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos(latRad)));
  const rot = rotationDeg * Math.PI / 180;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    // Start at top so rotation 0 looks "natural" (vertex up)
    const a = -Math.PI / 2 + (i / sides) * Math.PI * 2 + rot;
    ring.push([lng0 + Math.cos(a) * dLng, lat0 + Math.sin(a) * dLat]);
  }
  ring.push(ring[0]);
  return ring;
}

function lineCentroid(coords) {
  let sx = 0, sy = 0;
  for (const [x, y] of coords) { sx += x; sy += y; }
  return [sx / coords.length, sy / coords.length];
}

function transformLineCoords(baseCoords, offsetLng, offsetLat, scale) {
  const [cx, cy] = lineCentroid(baseCoords);
  return baseCoords.map(([lng, lat]) => [
    cx + (lng - cx) * scale + offsetLng,
    cy + (lat - cy) * scale + offsetLat,
  ]);
}

function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return d;
}

function sliceLineCoords(coords, drawProgress) {
  if (drawProgress <= 0 || coords.length < 2) return [];
  if (drawProgress >= 1) return coords.slice();
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  const total = cum[cum.length - 1];
  const target = total * drawProgress;
  let i = 1;
  while (i < cum.length && cum[i] < target) i++;
  if (i >= coords.length) return coords.slice();
  const segLen = cum[i] - cum[i - 1];
  const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
  const [lng1, lat1] = coords[i - 1];
  const [lng2, lat2] = coords[i];
  return [...coords.slice(0, i), [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t]];
}

function defaultShapePreview(type, atCenter) {
  if (type === 'polygon') {
    return { center: atCenter, radiusKm: 50, rotation: 0 };
  }
  // Line preview is just the transform applied to baseCoords.
  return { offsetLng: 0, offsetLat: 0, scale: 1, drawProgress: 1 };
}

function ensureShapeOnMap(shape) {
  const ids = shapeSourceIds(shape.id);
  if (shape.type === 'polygon') {
    if (!map.getSource(ids.fill)) {
      map.addSource(ids.fill, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(ids.fillLayer)) {
      map.addLayer({
        id: ids.fillLayer,
        type: 'fill',
        source: ids.fill,
        paint: {
          'fill-color': shape.fill,
          'fill-opacity': shape.fillOpacity,
        },
      });
    }
    if (!map.getLayer(ids.lineLayer)) {
      map.addLayer({
        id: ids.lineLayer,
        type: 'line',
        source: ids.fill,
        paint: {
          'line-color': shape.stroke,
          'line-width': shape.strokeWidth,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
    }
  } else {
    // line
    if (!map.getSource(ids.line)) {
      map.addSource(ids.line, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(ids.lineLayer)) {
      map.addLayer({
        id: ids.lineLayer,
        type: 'line',
        source: ids.line,
        paint: {
          'line-color': shape.stroke,
          'line-width': shape.strokeWidth,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });
    }
  }
  applyShapeStyle(shape);
  applyShapeVisibility(shape);
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function removeShapeFromMap(shape) {
  const ids = shapeSourceIds(shape.id);
  for (const id of [ids.fillLayer, ids.lineLayer]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [ids.fill, ids.line]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function applyShapeStyle(shape) {
  const ids = shapeSourceIds(shape.id);
  if (map.getLayer(ids.fillLayer) && shape.type === 'polygon') {
    map.setPaintProperty(ids.fillLayer, 'fill-color', shape.fill);
    map.setPaintProperty(ids.fillLayer, 'fill-opacity', shape.visible ? shape.fillOpacity : 0);
  }
  if (map.getLayer(ids.lineLayer)) {
    map.setPaintProperty(ids.lineLayer, 'line-color', shape.stroke);
    map.setPaintProperty(ids.lineLayer, 'line-width', shape.strokeWidth);
    map.setPaintProperty(ids.lineLayer, 'line-opacity', shape.visible ? 1 : 0);
  }
}

function applyShapeVisibility(shape) {
  const ids = shapeSourceIds(shape.id);
  const vis = shape.visible ? 'visible' : 'none';
  if (map.getLayer(ids.fillLayer)) map.setLayoutProperty(ids.fillLayer, 'visibility', vis);
  if (map.getLayer(ids.lineLayer)) map.setLayoutProperty(ids.lineLayer, 'visibility', vis);
}

// Render the shape using its current preview state.
function redrawShape(shape) {
  const ids = shapeSourceIds(shape.id);
  if (shape.type === 'polygon') {
    const src = map.getSource(ids.fill);
    if (!src) return;
    const ring = regularPolygonCoords(
      shape.preview.center,
      shape.sides,
      shape.preview.radiusKm,
      shape.preview.rotation,
    );
    src.setData({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  } else {
    const src = map.getSource(ids.line);
    if (!src) return;
    const transformed = transformLineCoords(
      shape.baseCoords,
      shape.preview.offsetLng,
      shape.preview.offsetLat,
      shape.preview.scale,
    );
    const drawn = sliceLineCoords(transformed, shape.preview.drawProgress);
    src.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: drawn },
    });
  }
}

function newShapeId() {
  return 'shp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function nextShapeName(type) {
  const base = type === 'polygon' ? 'Polygon' : 'Line';
  const used = new Set(state.shapes.map(s => s.name));
  let n = state.shapes.filter(s => s.type === type).length + 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function pickShapeFill() {
  return SHAPE_FILLS[state.shapes.length % SHAPE_FILLS.length];
}

function addOctagon() {
  const c = map.getCenter();
  const id = newShapeId();
  const shape = {
    id,
    type: 'polygon',
    name: nextShapeName('polygon'),
    sides: 8,
    stroke: SHAPE_DEFAULTS.stroke,
    fill: pickShapeFill(),
    strokeWidth: SHAPE_DEFAULTS.strokeWidth,
    fillOpacity: SHAPE_DEFAULTS.fillOpacity,
    visible: true,
    preview: defaultShapePreview('polygon', [c.lng, c.lat]),
  };
  state.shapes.push(shape);
  // Backfill all existing keyframes with this shape's initial state so
  // playback doesn't pop when crossing a keyframe that pre-dates the shape.
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  state.activeShapeId = id;
  saveLayers();
  renderShapesPanel();
  renderLayersPanel();
  showRouteUI();
  syncShapeStyleInputs();
}

function addLineFromCoords(coords) {
  if (!coords || coords.length < 2) return;
  const id = newShapeId();
  const shape = {
    id,
    type: 'line',
    name: nextShapeName('line'),
    baseCoords: coords.map(c => [c[0], c[1]]),
    stroke: pickShapeFill(),
    fill: '#000000',  // unused for lines but persisted
    strokeWidth: 3,
    fillOpacity: 0,
    visible: true,
    preview: defaultShapePreview('line'),
  };
  state.shapes.push(shape);
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  state.activeShapeId = id;
  saveLayers();
  renderShapesPanel();
  renderLayersPanel();
  showRouteUI();
  syncShapeStyleInputs();
}

function deleteShape(id) {
  const shape = state.shapes.find(s => s.id === id);
  if (!shape) return;
  removeShapeFromMap(shape);
  state.shapes = state.shapes.filter(s => s.id !== id);
  // Strip from all keyframes
  for (const kf of state.keyframes) {
    if (kf.shapes && kf.shapes[id]) delete kf.shapes[id];
  }
  if (state.activeShapeId === id) state.activeShapeId = null;
  saveLayers();
  renderShapesPanel();
  showRouteUI();
  syncShapeStyleInputs();
}

function setShapeVisible(id, visible) {
  const shape = state.shapes.find(s => s.id === id);
  if (!shape) return;
  shape.visible = visible;
  applyShapeVisibility(shape);
  applyShapeStyle(shape);
  saveLayers();
  renderShapesPanel();
}

function selectShape(id) {
  state.activeShapeId = id;
  // Selecting a shape also implies you don't want a KML layer "active" for the
  // style panel — but we leave KML active state alone so swapping back works.
  renderShapesPanel();
  renderLayersPanel();
  syncShapeStyleInputs();
}

function activeShape() {
  return state.shapes.find(s => s.id === state.activeShapeId) || null;
}

function snapshotShapePreview(shape) {
  // Returns a plain object copy of the shape's keyframe-relevant preview state.
  if (shape.type === 'polygon') {
    return {
      center: [shape.preview.center[0], shape.preview.center[1]],
      radiusKm: shape.preview.radiusKm,
      rotation: shape.preview.rotation,
    };
  }
  return {
    offsetLng: shape.preview.offsetLng,
    offsetLat: shape.preview.offsetLat,
    scale: shape.preview.scale,
    drawProgress: shape.preview.drawProgress,
  };
}

function applyShapeKfState(shape, st) {
  if (!st) return;
  if (shape.type === 'polygon') {
    if (Array.isArray(st.center)) shape.preview.center = [st.center[0], st.center[1]];
    if (typeof st.radiusKm === 'number') shape.preview.radiusKm = st.radiusKm;
    if (typeof st.rotation === 'number') shape.preview.rotation = st.rotation;
  } else {
    if (typeof st.offsetLng === 'number') shape.preview.offsetLng = st.offsetLng;
    if (typeof st.offsetLat === 'number') shape.preview.offsetLat = st.offsetLat;
    if (typeof st.scale === 'number') shape.preview.scale = st.scale;
    if (typeof st.drawProgress === 'number') shape.preview.drawProgress = st.drawProgress;
  }
}

function backfillShapeIntoKeyframes(shape) {
  const snap = snapshotShapePreview(shape);
  for (const kf of state.keyframes) {
    if (!kf.shapes) kf.shapes = {};
    if (!kf.shapes[shape.id]) kf.shapes[shape.id] = JSON.parse(JSON.stringify(snap));
  }
}

function captureShapesForKeyframe() {
  const out = {};
  for (const s of state.shapes) out[s.id] = snapshotShapePreview(s);
  return out;
}

// Interpolate per-shape state between two keyframes and apply to live preview,
// then redraw. Called from applyAtTime.
function interpolateShapesAtTime(a, b, eased) {
  for (const shape of state.shapes) {
    const sa = a.shapes?.[shape.id];
    const sb = b.shapes?.[shape.id];
    if (!sa && !sb) continue;
    if (!sa) { applyShapeKfState(shape, sb); redrawShape(shape); continue; }
    if (!sb) { applyShapeKfState(shape, sa); redrawShape(shape); continue; }
    if (shape.type === 'polygon') {
      shape.preview.center = [
        lerpLng(sa.center[0], sb.center[0], eased),
        lerp(sa.center[1], sb.center[1], eased),
      ];
      shape.preview.radiusKm = lerp(sa.radiusKm, sb.radiusKm, eased);
      shape.preview.rotation = lerpBearing(sa.rotation, sb.rotation, eased);
    } else {
      shape.preview.offsetLng = lerp(sa.offsetLng, sb.offsetLng, eased);
      shape.preview.offsetLat = lerp(sa.offsetLat, sb.offsetLat, eased);
      shape.preview.scale = lerp(sa.scale, sb.scale, eased);
      shape.preview.drawProgress = lerp(sa.drawProgress, sb.drawProgress, eased);
    }
    redrawShape(shape);
  }
}

function applyShapeStateAtKeyframe(kf) {
  // Static (non-interpolating) — used when selecting a single keyframe or
  // when there's only one keyframe.
  for (const shape of state.shapes) {
    const st = kf.shapes?.[shape.id];
    if (st) applyShapeKfState(shape, st);
    redrawShape(shape);
  }
}

// ─── Line-drawing preview source ───

const DRAW_PREVIEW_SRC = 'shape-draw-preview-src';
const DRAW_PREVIEW_LINE = 'shape-draw-preview-line';
const DRAW_PREVIEW_PTS = 'shape-draw-preview-pts';

function ensureDrawPreviewOnMap() {
  if (!map.getSource(DRAW_PREVIEW_SRC)) {
    map.addSource(DRAW_PREVIEW_SRC, { type: 'geojson', data: emptyFC() });
  }
  if (!map.getLayer(DRAW_PREVIEW_LINE)) {
    map.addLayer({
      id: DRAW_PREVIEW_LINE,
      type: 'line',
      source: DRAW_PREVIEW_SRC,
      filter: ['==', '$type', 'LineString'],
      paint: {
        'line-color': '#b85c3c',
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    });
  }
  if (!map.getLayer(DRAW_PREVIEW_PTS)) {
    map.addLayer({
      id: DRAW_PREVIEW_PTS,
      type: 'circle',
      source: DRAW_PREVIEW_SRC,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#b85c3c',
        'circle-stroke-color': '#fffaf0',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

function setDrawPreviewData() {
  const src = map.getSource(DRAW_PREVIEW_SRC);
  if (!src) return;
  const features = [];
  if (state.drawingLine) {
    const pts = state.drawingLine.coords.slice();
    if (state.drawingLine.cursor) pts.push(state.drawingLine.cursor);
    if (pts.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts },
      });
    }
    for (const p of state.drawingLine.coords) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p },
      });
    }
  }
  src.setData({ type: 'FeatureCollection', features });
}

// ─── Keyframe operations ───

function captureView() {
  const c = map.getCenter();
  return {
    center: [c.lng, c.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function addKeyframe() {
  const view = captureView();
  const kf = {
    id: 'k' + (state.nextId++),
    ...view,
    progress: state.previewProgress,
    duration: 2.0,
    easing: 'easeInOut',
    shapes: captureShapesForKeyframe(),
  };
  state.keyframes.push(kf);
  state.selectedId = kf.id;
  renderKeyframes();
  renderEditor();
  syncDrawSlider();
}

function deleteKeyframe(id) {
  state.keyframes = state.keyframes.filter(k => k.id !== id);
  if (state.selectedId === id) {
    state.selectedId = state.keyframes[0]?.id ?? null;
  }
  renderKeyframes();
  renderEditor();
}

function selectKeyframe(id, jump = true) {
  state.selectedId = id;
  renderKeyframes();
  renderEditor();
  if (jump) {
    const kf = state.keyframes.find(k => k.id === id);
    if (kf) {
      map.jumpTo({ center: kf.center, zoom: kf.zoom, bearing: kf.bearing, pitch: kf.pitch });
      state.previewProgress = kf.progress;
      setRouteSources(kf.progress);
      applyShapeStateAtKeyframe(kf);
      syncDrawSlider();
      syncShapeStyleInputs();
    }
  }
}

function totalDuration() {
  if (state.keyframes.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < state.keyframes.length - 1; i++) t += state.keyframes[i].duration;
  return t;
}

// ─── Interpolation ───

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpLng(a, b, t) {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

function lerpBearing(a, b, t) {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

function applyAtTime(timeSec) {
  const kfs = state.keyframes;
  if (kfs.length === 0) return;
  if (kfs.length === 1) {
    const kf = kfs[0];
    map.jumpTo({ center: kf.center, zoom: kf.zoom, bearing: kf.bearing, pitch: kf.pitch });
    state.previewProgress = kf.progress;
    setRouteSources(kf.progress);
    applyShapeStateAtKeyframe(kf);
    syncDrawSlider();
    return;
  }

  // Find segment
  let acc = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    const dur = kfs[i].duration;
    if (timeSec <= acc + dur || i === kfs.length - 2) {
      const localT = dur > 0 ? Math.max(0, Math.min(1, (timeSec - acc) / dur)) : 1;
      const eased = (EASINGS[kfs[i].easing] || EASINGS.linear)(localT);
      const a = kfs[i], b = kfs[i + 1];
      const lng = lerpLng(a.center[0], b.center[0], eased);
      const lat = lerp(a.center[1], b.center[1], eased);
      const zoom = lerp(a.zoom, b.zoom, eased);
      const bearing = lerpBearing(a.bearing, b.bearing, eased);
      const pitch = lerp(a.pitch, b.pitch, eased);
      const progress = lerp(a.progress, b.progress, eased);
      map.jumpTo({ center: [lng, lat], zoom, bearing, pitch });
      state.previewProgress = progress;
      setRouteSources(progress);
      interpolateShapesAtTime(a, b, eased);
      syncDrawSlider();
      return;
    }
    acc += dur;
  }
}

// ─── Playback ───

function play() {
  if (state.keyframes.length < 2) return;
  if (state.playing) return;
  const total = totalDuration();
  // If at end, restart from 0
  let offset = state.playOffset;
  if (offset >= total) offset = 0;
  state.playing = true;
  isPlayingBack = true;
  state.playStart = performance.now();
  state.playOffset = offset;
  document.getElementById('play-btn').textContent = '⏸ Pause';
  const tick = () => {
    if (!state.playing) return;
    const elapsed = (performance.now() - state.playStart) / 1000 + state.playOffset;
    if (elapsed >= total) {
      applyAtTime(total);
      updateTimeDisplay(total);
      stop();
      return;
    }
    applyAtTime(elapsed);
    updateTimeDisplay(elapsed);
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function stop() {
  if (!state.playing) return;
  const elapsed = (performance.now() - state.playStart) / 1000 + state.playOffset;
  state.playOffset = Math.min(elapsed, totalDuration());
  state.playing = false;
  isPlayingBack = false;
  cancelAnimationFrame(state.rafId);
  document.getElementById('play-btn').textContent = '▶ Play';
}

function reset() {
  stop();
  state.playOffset = 0;
  if (state.keyframes[0]) {
    selectKeyframe(state.keyframes[0].id, true);
  }
  updateTimeDisplay(0);
}

// ─── Rendering ───

function renderKeyframes() {
  const list = document.getElementById('kf-list');
  list.innerHTML = '';

  if (state.keyframes.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'kf-empty';
    empty.textContent = 'NO KEYFRAMES — POSITION THE MAP, THEN HIT + KEYFRAME';
    list.appendChild(empty);
  }

  state.keyframes.forEach((kf, i) => {
    const tile = document.createElement('div');
    tile.className = 'kf-tile' + (kf.id === state.selectedId ? ' selected' : '');
    tile.innerHTML = `
      <div class="kf-num">K${String(i + 1).padStart(2, '0')}</div>
      <div class="kf-meta">
        Z <b>${kf.zoom.toFixed(1)}</b> · ${Math.round(kf.progress * 100)}%
      </div>
    `;
    tile.addEventListener('click', () => selectKeyframe(kf.id));
    list.appendChild(tile);

    if (i < state.keyframes.length - 1) {
      const gap = document.createElement('div');
      gap.className = 'kf-gap';
      gap.textContent = `→ ${kf.duration}s · ${kf.easing}`;
      list.appendChild(gap);
    }
  });

  document.getElementById('time-total').textContent = totalDuration().toFixed(1);
}

function renderEditor() {
  const editor = document.getElementById('kf-editor');
  if (!state.selectedId) {
    editor.classList.add('hidden');
    return;
  }
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (!kf) {
    editor.classList.add('hidden');
    return;
  }
  editor.classList.remove('hidden');
  document.getElementById('kf-duration').value = kf.duration;
  document.getElementById('kf-easing').value = kf.easing;
  document.getElementById('kf-progress').value = Math.round(kf.progress * 100);
}

function updateTimeDisplay(t) {
  document.getElementById('time-cur').textContent = t.toFixed(1);
}

// ─── Wiring ───

document.getElementById('add-kf').addEventListener('click', addKeyframe);
document.getElementById('play-btn').addEventListener('click', () => state.playing ? stop() : play());
document.getElementById('reset-btn').addEventListener('click', reset);

document.getElementById('kf-duration').addEventListener('input', e => {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (kf) {
    kf.duration = Math.max(0, parseFloat(e.target.value) || 0);
    renderKeyframes();
  }
});
document.getElementById('kf-easing').addEventListener('change', e => {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (kf) {
    kf.easing = e.target.value;
    renderKeyframes();
  }
});
document.getElementById('kf-progress').addEventListener('input', e => {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (kf) {
    kf.progress = Math.max(0, Math.min(1, (parseFloat(e.target.value) || 0) / 100));
    state.previewProgress = kf.progress;
    renderKeyframes();
    setRouteSources(kf.progress);
    syncDrawSlider();
  }
});
function updateSelectedKeyframe() {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (!kf) return;
  Object.assign(kf, captureView());
  kf.progress = state.previewProgress;
  kf.shapes = captureShapesForKeyframe();
  renderKeyframes();
  flashUpdateConfirmation();
}

function flashUpdateConfirmation() {
  const btn = document.getElementById('kf-update-view');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = 'Updated ✓';
  btn.classList.add('flash-ok');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('flash-ok');
  }, 900);
}

document.getElementById('kf-update-view').addEventListener('click', updateSelectedKeyframe);
document.getElementById('kf-delete').addEventListener('click', () => {
  if (state.selectedId) deleteKeyframe(state.selectedId);
});

// ─── Layers (KML/KMZ) ───

const LAYERS_LS_KEY = 'mapkeys_layers_v1';

function saveLayers() {
  try {
    // Only persist what's needed; recompute cumDist on load.
    const minimal = state.layers.map(l => ({
      id: l.id,
      name: l.name,
      coords: l.coords,
      style: l.style,
      visible: l.visible,
    }));
    const shapesMinimal = state.shapes.map(serializeShape);
    localStorage.setItem(LAYERS_LS_KEY, JSON.stringify({
      layers: minimal,
      activeLayerId: state.activeLayerId,
      shapes: shapesMinimal,
      activeShapeId: state.activeShapeId,
      keyframes: state.keyframes,
    }));
  } catch (err) {
    console.warn('[mapkeys] saveLayers failed (likely quota):', err.message);
  }
}

function serializeShape(s) {
  return {
    id: s.id,
    type: s.type,
    name: s.name,
    sides: s.sides,
    baseCoords: s.baseCoords,
    stroke: s.stroke,
    fill: s.fill,
    strokeWidth: s.strokeWidth,
    fillOpacity: s.fillOpacity,
    visible: s.visible,
    preview: s.preview,
  };
}

function hydrateShape(raw) {
  if (!raw || !raw.type || !raw.id) return null;
  const base = {
    id: raw.id,
    type: raw.type,
    name: raw.name || (raw.type === 'polygon' ? 'Polygon' : 'Line'),
    sides: typeof raw.sides === 'number' ? raw.sides : 8,
    baseCoords: Array.isArray(raw.baseCoords) ? raw.baseCoords : [],
    stroke: raw.stroke || SHAPE_DEFAULTS.stroke,
    fill: raw.fill || SHAPE_DEFAULTS.fill,
    strokeWidth: typeof raw.strokeWidth === 'number' ? raw.strokeWidth : SHAPE_DEFAULTS.strokeWidth,
    fillOpacity: typeof raw.fillOpacity === 'number' ? raw.fillOpacity : SHAPE_DEFAULTS.fillOpacity,
    visible: raw.visible !== false,
    preview: raw.preview || defaultShapePreview(raw.type, [0, 0]),
  };
  if (base.type === 'line' && base.baseCoords.length < 2) return null;
  return base;
}

function loadLayersFromLS() {
  try {
    const raw = localStorage.getItem(LAYERS_LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.layers)) return;
    state.layers = parsed.layers
      .filter(l => l && Array.isArray(l.coords) && l.coords.length >= 2)
      .map(l => {
        const route = buildRoute(l.coords);
        return {
          id: l.id || ('lyr_' + Math.random().toString(36).slice(2, 9)),
          name: l.name || 'Untitled layer',
          coords: route.coords,
          cumDist: route.cumDist,
          totalDist: route.totalDist,
          style: { ...DEFAULT_LAYER_STYLE, ...(l.style || {}) },
          visible: l.visible !== false,
        };
      });
    state.activeLayerId = parsed.activeLayerId || state.layers[0]?.id || null;

    if (Array.isArray(parsed.shapes)) {
      state.shapes = parsed.shapes.map(hydrateShape).filter(Boolean);
      state.activeShapeId = parsed.activeShapeId || null;
    }
    if (Array.isArray(parsed.keyframes)) {
      // Restore keyframes saved alongside shapes (so shape keyframe state persists).
      state.keyframes = parsed.keyframes.map(k => ({
        ...k,
        id: k.id || ('k' + (state.nextId++)),
      }));
      // Bump nextId past any restored ids
      for (const k of state.keyframes) {
        const m = /^k(\d+)$/.exec(k.id || '');
        if (m) state.nextId = Math.max(state.nextId, parseInt(m[1], 10) + 1);
      }
      state.selectedId = state.keyframes[0]?.id ?? null;
    }
    console.info(`[mapkeys] restored ${state.layers.length} layer(s), ${state.shapes.length} shape(s), ${state.keyframes.length} keyframe(s) from localStorage`);
  } catch (err) {
    console.warn('[mapkeys] loadLayers failed:', err.message);
  }
}
loadLayersFromLS();

function addLayerFromKML(file, coords) {
  const route = buildRoute(coords);
  const id = 'lyr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const colorIdx = state.layers.length % LAYER_COLORS.length;
  const layer = {
    id,
    name: file.name.replace(/\.(kml|kmz|xml)$/i, ''),
    coords: route.coords,
    cumDist: route.cumDist,
    totalDist: route.totalDist,
    style: { ...DEFAULT_LAYER_STYLE, color: LAYER_COLORS[colorIdx] },
    visible: true,
  };
  state.layers.push(layer);
  state.activeLayerId = id;
  ensureLayerOnMap(layer);
  saveLayers();
  renderLayersPanel();
  syncRouteStyleInputs();
  showRouteUI();
  // Fit map to route
  const lngs = layer.coords.map(c => c[0]), lats = layer.coords.map(c => c[1]);
  map.fitBounds([
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ], { padding: 80, duration: 1000 });
  setRouteSources(state.previewProgress);
}

function deleteLayer(id) {
  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;
  removeLayerFromMap(layer);
  state.layers = state.layers.filter(l => l.id !== id);
  if (state.activeLayerId === id) {
    state.activeLayerId = state.layers[0]?.id ?? null;
  }
  saveLayers();
  renderLayersPanel();
  syncRouteStyleInputs();
  showRouteUI();
  setRouteSources(state.previewProgress);
}

function setLayerVisible(id, visible) {
  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = visible;
  applyLayerVisibility(layer);
  applyLayerStyle(layer);
  saveLayers();
  renderLayersPanel();
}

function selectLayer(id) {
  state.activeLayerId = id;
  saveLayers();
  renderLayersPanel();
  syncRouteStyleInputs();
}

function showRouteUI() {
  const panel = document.getElementById('layers-panel');
  const styleEl = document.getElementById('route-style');
  const drawBar = document.getElementById('draw-bar');
  const info = document.getElementById('route-info');
  const hasLayers = state.layers.length > 0;
  const hasShapes = state.shapes.length > 0;
  panel.classList.toggle('hidden', !hasLayers && !hasShapes);
  // Route-style only relevant when at least one KML layer exists.
  styleEl.classList.toggle('hidden', !hasLayers);
  drawBar.classList.toggle('hidden', !hasLayers);
  document.getElementById('layers-count').textContent = state.layers.length;
  document.getElementById('shapes-count').textContent = state.shapes.length;
  document.getElementById('shapes-header').classList.toggle('hidden', !hasShapes);
  document.getElementById('shapes-divider').classList.toggle('hidden', !(hasLayers && hasShapes));
  if (hasLayers) {
    const a = activeLayer();
    info.textContent = a ? `${a.coords.length} pts · ${Math.round(a.totalDist)} km` : '';
  } else {
    info.textContent = '';
  }
  // Shape style panel only when a shape is selected.
  const ss = document.getElementById('shape-style');
  ss.classList.toggle('hidden', !activeShape());
}

function renderLayersPanel() {
  const list = document.getElementById('layers-list');
  list.innerHTML = '';
  if (state.layers.length === 0) return;
  for (const layer of state.layers) {
    const row = document.createElement('div');
    row.className = 'layer-row';
    if (layer.id === state.activeLayerId) row.classList.add('active');
    if (!layer.visible) row.classList.add('hidden-layer');
    row.innerHTML = `
      <input type="checkbox" class="layer-vis" ${layer.visible ? 'checked' : ''} title="Toggle visibility">
      <span class="layer-swatch" style="background:${layer.style.color}"></span>
      <div class="layer-meta">
        <div class="layer-name" title="${layer.name}">${layer.name}</div>
        <div class="layer-detail">${layer.coords.length} pts · ${Math.round(layer.totalDist)} km</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn layer-btn-fit" title="Fit to layer">⊕</button>
        <button class="layer-btn layer-btn-del" title="Delete layer">×</button>
      </div>
    `;
    row.querySelector('.layer-vis').addEventListener('click', e => {
      e.stopPropagation();
      setLayerVisible(layer.id, e.target.checked);
    });
    row.querySelector('.layer-btn-del').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${layer.name}"?`)) deleteLayer(layer.id);
    });
    row.querySelector('.layer-btn-fit').addEventListener('click', e => {
      e.stopPropagation();
      const lngs = layer.coords.map(c => c[0]), lats = layer.coords.map(c => c[1]);
      map.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ], { padding: 80, duration: 800 });
    });
    row.addEventListener('click', () => selectLayer(layer.id));
    list.appendChild(row);
  }
}

document.getElementById('kml-file').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    let text;
    try { text = await readRouteFile(file); }
    catch (err) { alert(`Failed to read ${file.name}: ${err.message}`); continue; }
    const coords = parseKML(text);
    if (coords.length < 2) { alert(`No usable LineString in ${file.name}.`); continue; }
    addLayerFromKML(file, coords);
  }
  e.target.value = '';
});

// ─── Active-layer style controls ───
const rsColor = document.getElementById('rs-color');
const rsWidth = document.getElementById('rs-width');
const rsWidthVal = document.getElementById('rs-width-val');
const rsOpacity = document.getElementById('rs-opacity');
const rsOpacityVal = document.getElementById('rs-opacity-val');
const rsDashed = document.getElementById('rs-dashed');
const rsTrail = document.getElementById('rs-trail');
const rsActiveName = document.getElementById('rs-active-name');

function syncRouteStyleInputs() {
  const layer = activeLayer();
  if (!layer) return;
  rsColor.value = layer.style.color;
  rsWidth.value = layer.style.width;
  rsWidthVal.textContent = layer.style.width;
  rsOpacity.value = Math.round(layer.style.opacity * 100);
  rsOpacityVal.textContent = Math.round(layer.style.opacity * 100);
  rsDashed.checked = layer.style.dashed;
  rsTrail.checked = layer.style.trail;
  if (rsActiveName) rsActiveName.textContent = layer.name;
}

function mutateActiveLayerStyle(fn) {
  const layer = activeLayer();
  if (!layer) return;
  fn(layer.style);
  applyLayerStyle(layer);
  saveLayers();
  renderLayersPanel();
}

rsColor.addEventListener('input', e => mutateActiveLayerStyle(s => { s.color = e.target.value; }));
rsWidth.addEventListener('input', e => {
  rsWidthVal.textContent = e.target.value;
  mutateActiveLayerStyle(s => { s.width = parseFloat(e.target.value); });
});
rsOpacity.addEventListener('input', e => {
  rsOpacityVal.textContent = e.target.value;
  mutateActiveLayerStyle(s => { s.opacity = parseFloat(e.target.value) / 100; });
});
rsDashed.addEventListener('change', e => mutateActiveLayerStyle(s => { s.dashed = e.target.checked; }));
rsTrail.addEventListener('change', e => mutateActiveLayerStyle(s => { s.trail = e.target.checked; }));

// ─── Shape panel rendering ───

function renderShapesPanel() {
  const list = document.getElementById('shapes-list');
  list.innerHTML = '';
  if (state.shapes.length === 0) return;
  for (const shape of state.shapes) {
    const row = document.createElement('div');
    row.className = 'shape-row';
    if (shape.id === state.activeShapeId) row.classList.add('active');
    if (!shape.visible) row.classList.add('hidden-layer');
    const glyph = shape.type === 'polygon' ? '⬡' : '╱';
    const stat = shape.type === 'polygon'
      ? `n=${shape.sides} · ${Math.round(shape.preview.radiusKm)} km`
      : `${shape.baseCoords.length} pts · scale ${shape.preview.scale.toFixed(2)}`;
    row.innerHTML = `
      <input type="checkbox" class="layer-vis" ${shape.visible ? 'checked' : ''} title="Toggle visibility">
      <span class="shape-swatch" style="background:${shape.type === 'polygon' ? shape.fill : shape.stroke}; border-color:${shape.stroke};"></span>
      <span class="shape-glyph">${glyph}</span>
      <div class="layer-meta">
        <div class="layer-name" title="${shape.name}">${shape.name}</div>
        <div class="layer-detail">${stat}</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn shape-btn-fit" title="Fit to shape">⊕</button>
        <button class="layer-btn shape-btn-del" title="Delete shape">×</button>
      </div>
    `;
    row.querySelector('.layer-vis').addEventListener('click', e => {
      e.stopPropagation();
      setShapeVisible(shape.id, e.target.checked);
    });
    row.querySelector('.shape-btn-del').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${shape.name}"?`)) deleteShape(shape.id);
    });
    row.querySelector('.shape-btn-fit').addEventListener('click', e => {
      e.stopPropagation();
      fitToShape(shape);
    });
    row.addEventListener('click', () => selectShape(shape.id));
    list.appendChild(row);
  }
}

function fitToShape(shape) {
  if (shape.type === 'polygon') {
    const ring = regularPolygonCoords(shape.preview.center, shape.sides, shape.preview.radiusKm, shape.preview.rotation);
    const lngs = ring.map(c => c[0]), lats = ring.map(c => c[1]);
    map.fitBounds([
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ], { padding: 120, duration: 800 });
  } else {
    const coords = transformLineCoords(shape.baseCoords, shape.preview.offsetLng, shape.preview.offsetLat, shape.preview.scale);
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
    map.fitBounds([
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ], { padding: 120, duration: 800 });
  }
}

// ─── Shape style panel ───

const ssActiveName = document.getElementById('ss-active-name');
const ssStroke = document.getElementById('ss-stroke');
const ssFill = document.getElementById('ss-fill');
const ssFillOpacity = document.getElementById('ss-fill-opacity');
const ssFillOpacityVal = document.getElementById('ss-fill-opacity-val');
const ssFillOpacityField = document.getElementById('ss-fill-opacity-field');
const ssStrokeW = document.getElementById('ss-stroke-w');
const ssStrokeWVal = document.getElementById('ss-stroke-w-val');
const ssSides = document.getElementById('ss-sides');
const ssSidesField = document.getElementById('ss-sides-field');
const ssScale = document.getElementById('ss-scale');
const ssScaleVal = document.getElementById('ss-scale-val');
const ssScaleField = document.getElementById('ss-scale-field');
const ssRotation = document.getElementById('ss-rotation');
const ssRotationVal = document.getElementById('ss-rotation-val');
const ssRotationField = document.getElementById('ss-rotation-field');
const ssDraw = document.getElementById('ss-draw');
const ssDrawVal = document.getElementById('ss-draw-val');
const ssDrawField = document.getElementById('ss-draw-field');
const ssDelete = document.getElementById('ss-delete');

function syncShapeStyleInputs() {
  const shape = activeShape();
  const panel = document.getElementById('shape-style');
  if (!shape) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  ssActiveName.textContent = shape.name;
  ssStroke.value = shape.stroke;
  ssStrokeW.value = shape.strokeWidth;
  ssStrokeWVal.textContent = shape.strokeWidth;
  reconfigureSlidersFor(shape);

  const suffix = document.getElementById('ss-scale-suffix');
  if (shape.type === 'polygon') {
    ssFill.value = shape.fill;
    ssFillOpacity.value = Math.round(shape.fillOpacity * 100);
    ssFillOpacityVal.textContent = Math.round(shape.fillOpacity * 100);
    ssSides.value = shape.sides;
    ssScale.value = Math.round(shape.preview.radiusKm);
    ssScaleVal.textContent = Math.round(shape.preview.radiusKm);
    if (suffix) suffix.textContent = ' km';
    ssRotation.value = Math.round(shape.preview.rotation);
    ssRotationVal.textContent = Math.round(shape.preview.rotation);
    ssFillOpacityField.classList.remove('hidden');
    ssSidesField.classList.remove('hidden');
    ssScaleField.classList.remove('hidden');
    ssRotationField.classList.remove('hidden');
    ssDrawField.classList.add('hidden');
  } else {
    ssScale.value = Math.round(shape.preview.scale * 100);
    ssScaleVal.textContent = Math.round(shape.preview.scale * 100);
    if (suffix) suffix.textContent = '%';
    ssDraw.value = Math.round(shape.preview.drawProgress * 1000);
    ssDrawVal.textContent = Math.round(shape.preview.drawProgress * 100);
    ssFillOpacityField.classList.add('hidden');
    ssSidesField.classList.add('hidden');
    ssScaleField.classList.remove('hidden');
    ssRotationField.classList.add('hidden');
    ssDrawField.classList.remove('hidden');
  }
}

// Adjust slider attributes to suit the active shape type.
function reconfigureSlidersFor(shape) {
  if (!shape) return;
  if (shape.type === 'polygon') {
    ssScale.min = '5';
    ssScale.max = '2000';
    ssScale.step = '1';
  } else {
    ssScale.min = '5';
    ssScale.max = '500';
    ssScale.step = '1';
  }
}

function mutateActiveShape(fn) {
  const shape = activeShape();
  if (!shape) return;
  fn(shape);
  applyShapeStyle(shape);
  redrawShape(shape);
  saveLayers();
  renderShapesPanel();
}

ssStroke.addEventListener('input', e => mutateActiveShape(s => { s.stroke = e.target.value; }));
ssFill.addEventListener('input', e => mutateActiveShape(s => { s.fill = e.target.value; }));
ssFillOpacity.addEventListener('input', e => {
  ssFillOpacityVal.textContent = e.target.value;
  mutateActiveShape(s => { s.fillOpacity = parseFloat(e.target.value) / 100; });
});
ssStrokeW.addEventListener('input', e => {
  ssStrokeWVal.textContent = e.target.value;
  mutateActiveShape(s => { s.strokeWidth = parseFloat(e.target.value); });
});
ssSides.addEventListener('input', e => {
  const n = Math.max(3, Math.min(24, parseInt(e.target.value, 10) || 8));
  mutateActiveShape(s => { if (s.type === 'polygon') s.sides = n; });
});
ssScale.addEventListener('input', e => {
  ssScaleVal.textContent = e.target.value;
  const v = parseFloat(e.target.value);
  mutateActiveShape(s => {
    if (s.type === 'polygon') s.preview.radiusKm = v;
    else s.preview.scale = v / 100;
  });
});
ssRotation.addEventListener('input', e => {
  ssRotationVal.textContent = e.target.value;
  const v = parseFloat(e.target.value);
  mutateActiveShape(s => { if (s.type === 'polygon') s.preview.rotation = v; });
});
ssDraw.addEventListener('input', e => {
  const v = parseFloat(e.target.value) / 1000;
  ssDrawVal.textContent = Math.round(v * 100);
  mutateActiveShape(s => { if (s.type === 'line') s.preview.drawProgress = v; });
});
ssDelete.addEventListener('click', () => {
  const shape = activeShape();
  if (!shape) return;
  if (confirm(`Delete "${shape.name}"?`)) deleteShape(shape.id);
});

// ─── Add-shape buttons ───

document.getElementById('add-octagon-btn').addEventListener('click', () => {
  if (state.drawingLine) cancelLineDrawing();
  addOctagon();
});

document.getElementById('add-line-btn').addEventListener('click', () => {
  if (state.drawingLine) {
    finalizeLineDrawing();
    return;
  }
  startLineDrawing();
});

// ─── Line drawing mode ───

function startLineDrawing() {
  state.drawingLine = { coords: [], cursor: null };
  document.body.classList.add('drawing-line');
  document.getElementById('draw-mode-hint').classList.remove('hidden');
  // Disable Mapbox dblclick zoom so finalize-on-double-click works cleanly.
  map.doubleClickZoom.disable();
  ensureDrawPreviewOnMap();
  setDrawPreviewData();
}

function cancelLineDrawing() {
  state.drawingLine = null;
  document.body.classList.remove('drawing-line');
  document.getElementById('draw-mode-hint').classList.add('hidden');
  map.doubleClickZoom.enable();
  setDrawPreviewData();
}

function finalizeLineDrawing() {
  if (!state.drawingLine) return;
  const coords = state.drawingLine.coords.slice();
  cancelLineDrawing();
  if (coords.length >= 2) {
    addLineFromCoords(coords);
  }
}

map.on('mousemove', (e) => {
  if (!state.drawingLine) return;
  state.drawingLine.cursor = [e.lngLat.lng, e.lngLat.lat];
  setDrawPreviewData();
});

// ─── Map clicks: draw points, select shapes, drag, deselect ───

function shapeFillLayerIds() {
  return state.shapes
    .filter(s => s.type === 'polygon')
    .map(s => shapeSourceIds(s.id).fillLayer)
    .filter(id => map.getLayer(id));
}
function shapeLineLayerIds() {
  return state.shapes
    .map(s => shapeSourceIds(s.id).lineLayer)
    .filter(id => map.getLayer(id));
}

function findShapeAtPoint(point) {
  const fills = shapeFillLayerIds();
  const lines = shapeLineLayerIds();
  const all = [...fills, ...lines];
  if (all.length === 0) return null;
  // Tiny pixel buffer for line hit-testing
  const bbox = [
    [point.x - 6, point.y - 6],
    [point.x + 6, point.y + 6],
  ];
  const features = map.queryRenderedFeatures(bbox, { layers: all });
  if (!features.length) return null;
  const layerId = features[0].layer.id;
  for (const s of state.shapes) {
    const ids = shapeSourceIds(s.id);
    if (ids.fillLayer === layerId || ids.lineLayer === layerId) return s;
  }
  return null;
}

map.on('click', (e) => {
  // Drawing mode — click adds a point
  if (state.drawingLine) {
    state.drawingLine.coords.push([e.lngLat.lng, e.lngLat.lat]);
    setDrawPreviewData();
    return;
  }
  // Select shape if clicked
  const hit = findShapeAtPoint(e.point);
  if (hit) {
    selectShape(hit.id);
  } else {
    // Click on empty map deselects
    if (state.activeShapeId) {
      state.activeShapeId = null;
      renderShapesPanel();
      syncShapeStyleInputs();
      showRouteUI();
    }
  }
});

map.on('dblclick', () => {
  if (state.drawingLine) finalizeLineDrawing();
});

// Hover cursor over selectable shapes
map.on('mousemove', (e) => {
  if (state.drawingLine || state.draggingShape) return;
  const hit = findShapeAtPoint(e.point);
  map.getCanvas().style.cursor = hit ? 'pointer' : '';
});

// ─── Shape dragging ───

map.on('mousedown', (e) => {
  if (state.drawingLine) return;
  const hit = findShapeAtPoint(e.point);
  if (!hit) return;
  // Begin drag — pin selection to this shape, prevent map pan
  e.preventDefault();
  selectShape(hit.id);
  state.draggingShape = {
    shapeId: hit.id,
    type: hit.type,
    start: [e.lngLat.lng, e.lngLat.lat],
    origin: hit.type === 'polygon'
      ? { center: [hit.preview.center[0], hit.preview.center[1]] }
      : { offsetLng: hit.preview.offsetLng, offsetLat: hit.preview.offsetLat },
  };
  map.dragPan.disable();
  document.body.classList.add('dragging-shape');
});

map.on('mousemove', (e) => {
  if (!state.draggingShape) return;
  const drag = state.draggingShape;
  const shape = state.shapes.find(s => s.id === drag.shapeId);
  if (!shape) return;
  const dLng = e.lngLat.lng - drag.start[0];
  const dLat = e.lngLat.lat - drag.start[1];
  if (shape.type === 'polygon') {
    shape.preview.center = [drag.origin.center[0] + dLng, drag.origin.center[1] + dLat];
  } else {
    shape.preview.offsetLng = drag.origin.offsetLng + dLng;
    shape.preview.offsetLat = drag.origin.offsetLat + dLat;
  }
  redrawShape(shape);
});

function endShapeDrag() {
  if (!state.draggingShape) return;
  state.draggingShape = null;
  map.dragPan.enable();
  document.body.classList.remove('dragging-shape');
  saveLayers();
  renderShapesPanel();
}
map.on('mouseup', endShapeDrag);
// Fallback: if the user releases outside the canvas, recover.
window.addEventListener('mouseup', endShapeDrag);

// Esc handles cancel-line + clear-selection
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.drawingLine) {
      e.preventDefault();
      cancelLineDrawing();
    } else if (state.activeShapeId) {
      state.activeShapeId = null;
      renderShapesPanel();
      syncShapeStyleInputs();
      showRouteUI();
    }
  } else if ((e.key === 'Enter') && state.drawingLine) {
    e.preventDefault();
    finalizeLineDrawing();
  }
});

// Initial render
renderLayersPanel();
renderShapesPanel();
showRouteUI();
syncRouteStyleInputs();
syncShapeStyleInputs();
// Ensure persisted shapes are drawn even if style.load already fired.
if (map.isStyleLoaded()) {
  for (const shape of state.shapes) {
    ensureShapeOnMap(shape);
    redrawShape(shape);
  }
  ensureDrawPreviewOnMap();
}

// Draw-on scrub slider
const drawSlider = document.getElementById('draw-slider');
const drawVal = document.getElementById('draw-val');

function syncDrawSlider() {
  drawSlider.value = Math.round(state.previewProgress * 1000);
  drawVal.textContent = Math.round(state.previewProgress * 100);
}

drawSlider.addEventListener('input', e => {
  // Slider is the staging value for the next + Keyframe; it does NOT
  // edit any existing keyframe (use the kf editor's number input for that).
  const p = parseFloat(e.target.value) / 1000;
  state.previewProgress = p;
  drawVal.textContent = Math.round(p * 100);
  setRouteSources(p);
});

// Export / import — bundles keyframes AND all uploaded layers (so a project
// is portable across browsers/machines, not just keyframes).
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify({
    keyframes: state.keyframes,
    layers: state.layers.map(l => ({
      id: l.id, name: l.name, coords: l.coords, style: l.style, visible: l.visible,
    })),
    activeLayerId: state.activeLayerId,
    shapes: state.shapes.map(serializeShape),
    activeShapeId: state.activeShapeId,
  }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mapkeys.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (Array.isArray(data.layers)) {
      // Replace layers — clear current map sources first.
      for (const l of state.layers) removeLayerFromMap(l);
      state.layers = data.layers
        .filter(l => l && Array.isArray(l.coords) && l.coords.length >= 2)
        .map(l => {
          const route = buildRoute(l.coords);
          return {
            id: l.id || ('lyr_' + Math.random().toString(36).slice(2, 9)),
            name: l.name || 'Untitled',
            coords: route.coords,
            cumDist: route.cumDist,
            totalDist: route.totalDist,
            style: { ...DEFAULT_LAYER_STYLE, ...(l.style || {}) },
            visible: l.visible !== false,
          };
        });
      state.activeLayerId = data.activeLayerId || state.layers[0]?.id || null;
      for (const l of state.layers) ensureLayerOnMap(l);
      saveLayers();
      renderLayersPanel();
      showRouteUI();
      syncRouteStyleInputs();
      setRouteSources(state.previewProgress);
    }
    if (Array.isArray(data.shapes)) {
      for (const s of state.shapes) removeShapeFromMap(s);
      state.shapes = data.shapes.map(hydrateShape).filter(Boolean);
      state.activeShapeId = data.activeShapeId || null;
      for (const s of state.shapes) {
        ensureShapeOnMap(s);
        redrawShape(s);
      }
    }
    if (Array.isArray(data.keyframes)) {
      state.keyframes = data.keyframes.map(k => ({ ...k, id: 'k' + (state.nextId++) }));
      state.selectedId = state.keyframes[0]?.id ?? null;
      renderKeyframes();
      renderEditor();
      if (state.selectedId) selectKeyframe(state.selectedId, true);
    }
    saveLayers();
    renderShapesPanel();
    showRouteUI();
    syncShapeStyleInputs();
  } catch (err) {
    alert('Failed to parse JSON: ' + err.message);
  }
  e.target.value = '';
});

// Keyboard
window.addEventListener('keydown', e => {
  // Ignore typing in inputs
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); state.playing ? stop() : play(); }
  else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); addKeyframe(); }
  else if (e.key === 'u' || e.key === 'U') {
    if (state.selectedId) { e.preventDefault(); updateSelectedKeyframe(); }
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    // Selected shape takes priority over selected keyframe
    if (state.activeShapeId) {
      e.preventDefault();
      const s = activeShape();
      if (s && confirm(`Delete "${s.name}"?`)) deleteShape(s.id);
    } else if (state.selectedId) {
      e.preventDefault();
      deleteKeyframe(state.selectedId);
    }
  }
  else if (e.key === 'ArrowLeft') {
    const i = state.keyframes.findIndex(k => k.id === state.selectedId);
    if (i > 0) selectKeyframe(state.keyframes[i - 1].id);
  }
  else if (e.key === 'ArrowRight') {
    const i = state.keyframes.findIndex(k => k.id === state.selectedId);
    if (i >= 0 && i < state.keyframes.length - 1) selectKeyframe(state.keyframes[i + 1].id);
  }
});

// ─── GIF rendering ───

const gifModal = document.getElementById('gif-modal');
const gifSpeed = document.getElementById('gif-speed');
const gifFps = document.getElementById('gif-fps');
const gifScale = document.getElementById('gif-scale');
const gifSpeedVal = document.getElementById('gif-speed-val');
const gifFpsVal = document.getElementById('gif-fps-val');
const gifScaleVal = document.getElementById('gif-scale-val');
const gifSummary = document.getElementById('gif-summary');
const gifProgress = document.getElementById('gif-progress');
const gifProgressFill = document.getElementById('gif-progress-fill');
const gifProgressLabel = document.getElementById('gif-progress-label');
const gifGo = document.getElementById('gif-go');

function gifSummaryUpdate() {
  const total = totalDuration();
  const speed = parseFloat(gifSpeed.value) / 100;
  const fps = parseInt(gifFps.value, 10);
  const outDur = speed > 0 ? total / speed : 0;
  const frames = Math.max(0, Math.round(outDur * fps));
  const canvas = map.getCanvas();
  const w = Math.round(canvas.clientWidth * (parseInt(gifScale.value, 10) / 100));
  const h = Math.round(canvas.clientHeight * (parseInt(gifScale.value, 10) / 100));
  gifSummary.textContent = `${frames} frames · ${outDur.toFixed(1)}s · ${w}×${h}`;
}

function bindLive(input, valEl) {
  input.addEventListener('input', () => {
    valEl.textContent = input.value;
    gifSummaryUpdate();
  });
}
bindLive(gifSpeed, gifSpeedVal);
bindLive(gifFps, gifFpsVal);
bindLive(gifScale, gifScaleVal);

document.getElementById('gif-btn').addEventListener('click', () => {
  if (state.keyframes.length < 2) {
    alert('Add at least 2 keyframes first.');
    return;
  }
  gifProgress.classList.add('hidden');
  gifGo.disabled = false;
  gifGo.textContent = 'Render';
  gifSummaryUpdate();
  gifModal.classList.remove('hidden');
});

document.getElementById('gif-cancel').addEventListener('click', () => {
  gifModal.classList.add('hidden');
});

async function captureFrame() {
  // Force a render then read the canvas
  map.triggerRepaint();
  return new Promise(resolve => {
    map.once('render', () => {
      const canvas = map.getCanvas();
      resolve(canvas);
    });
  });
}

gifGo.addEventListener('click', async () => {
  stop();
  const total = totalDuration();
  const speedPct = parseFloat(gifSpeed.value);
  const speed = speedPct / 100;            // 1.0 = same speed, 2.0 = 2x faster
  const fps = parseInt(gifFps.value, 10);
  const scalePct = parseInt(gifScale.value, 10) / 100;
  const outDur = total / speed;
  const totalFrames = Math.max(1, Math.round(outDur * fps));

  const sourceCanvas = map.getCanvas();
  const w = Math.round(sourceCanvas.clientWidth * scalePct);
  const h = Math.round(sourceCanvas.clientHeight * scalePct);

  // Resize down by drawing into an off-screen canvas
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const offCtx = off.getContext('2d');

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: w,
    height: h,
    workerScript: gifWorkerUrl,
    repeat: 0,
  });

  gif.on('progress', p => {
    gifProgressFill.style.width = (50 + p * 50) + '%';
    gifProgressLabel.textContent = `Encoding GIF · ${Math.round(p * 100)}%`;
  });

  gif.on('finished', blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapkeys-${speedPct}pct-${fps}fps.gif`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    gifProgressLabel.textContent = 'Done.';
    gifGo.disabled = false;
    gifGo.textContent = 'Render';
    gifSummaryUpdate();
  });

  gifProgress.classList.remove('hidden');
  gifProgressFill.style.width = '0%';
  gifProgressLabel.textContent = 'Capturing frames…';
  gifGo.disabled = true;
  gifGo.textContent = 'Rendering…';

  // Each frame represents (1/fps) seconds of OUTPUT, which corresponds to
  // (1/fps) * speed seconds of TIMELINE. So the timeline advance per frame:
  const timelineStepPerFrame = (1 / fps) * speed;

  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(total, i * timelineStepPerFrame);
    applyAtTime(t);

    // Wait for the map to fully render (idle event covers tile loading)
    await new Promise(resolve => {
      if (map.areTilesLoaded()) {
        map.once('render', resolve);
        map.triggerRepaint();
      } else {
        map.once('idle', resolve);
      }
    });

    const src = map.getCanvas();
    offCtx.drawImage(src, 0, 0, w, h);
    gif.addFrame(offCtx, { copy: true, delay: Math.round(1000 / fps) });

    gifProgressFill.style.width = ((i + 1) / totalFrames * 50) + '%';
    gifProgressLabel.textContent = `Capturing · frame ${i + 1} / ${totalFrames}`;
  }

  gifProgressLabel.textContent = 'Encoding GIF…';
  gif.render();
});

// Initial render
renderKeyframes();
renderEditor();
