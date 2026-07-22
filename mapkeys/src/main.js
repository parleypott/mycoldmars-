import mapboxgl from 'mapbox-gl';
import { unzipSync, strFromU8 } from 'fflate';
import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';
import { feature as topoFeature, mesh as topoMesh } from 'topojson-client';
// 10m is Natural Earth's highest resolution — ~3.5MB, but borders look real
// (coastlines, archipelagos, peninsulas all detailed) instead of low-poly
// 110m blocks. Worth the payload for a video/animation tool.
import countriesTopo from 'world-atlas/countries-10m.json';
import { regularPolygonCoords, KM_PER_DEG_LAT, clampSides } from './polygon-geom.js';
import { extractKmlCoords } from './kml-coords.js';
import {
  haversine, buildRoute, sliceRoute, lineCentroid, transformLineCoords,
  lineLength, sliceLineCoords, lerpLng, lerpBearing, coordsBounds,
} from './route-geo.js';
import { computeGifRange } from './gif-range.js';
import { EASINGS, totalDuration, resolveKeyframeSegment, keyframeStartTime } from './playback-timing.js';
import { searchCountries as rankCountries } from './country-search.js';
import { classifyOldMapInput, annotationBounds, annotationLabel } from './oldmap-resolve.js';
import { featherPlan } from './feather-mask.js';
import { escHtml } from './esc.js';
import {
  findBySlug, syncFromCloud as syncProjectsFromCloud, loadProjectState,
  pushProjectState, beaconProjectState, writeStateCache, touchProject,
  renameProject, migrateLegacyIfNeeded,
} from './projects.js';
import { initLibrary, showLibrary, hideLibrary } from './library.js';
import './style.css';
import './library.css';

// ─── Country data (loaded once at startup) ───
const COUNTRIES = (() => {
  const fc = topoFeature(countriesTopo, countriesTopo.objects.countries);
  return fc.features
    .map(f => ({
      id: String(f.id),
      name: f.properties && f.properties.name ? f.properties.name : 'Unknown',
      geometry: f.geometry,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();
const COUNTRY_BY_ID = new Map(COUNTRIES.map(c => [c.id, c]));
const COUNTRY_BY_NAME = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]));

// World-borders mesh for the BORDERS hub — every boundary arc drawn exactly
// once (interior borders + coastlines). Built lazily on first enable; the
// topology is already parsed at startup so this is just arc stitching.
let _bordersGeom = null;
function bordersGeom() {
  if (!_bordersGeom) _bordersGeom = topoMesh(countriesTopo, countriesTopo.objects.countries);
  return _bordersGeom;
}

// searchCountries (the country-picker ranking) lives in ./country-search.js so
// it's headless-testable; here it's bound to the module-scoped COUNTRIES list.
const searchCountries = (query) => rankCountries(query, COUNTRIES);

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

// ─── Skins (basemap) ───
// Earthen = outdoors recolored + de-noised (the original look).
// Satellite = pure imagery, no labels/roads — recolor & hillshade don't apply.
// The sat-* profiles are the SAME satellite style with a raster grade
// (contrast/brightness/saturation): raw imagery blows the Sahara out to
// near-white, so the graded profiles pull it back. Switching between two
// satellite profiles is instant paint work — no style reload.
const SAT_STYLE = 'mapbox://styles/mapbox/satellite-v9';
const SKINS = {
  earthen:     { label: 'Earthen', style: 'mapbox://styles/mapbox/outdoors-v12', earthen: true },
  satellite:   { label: 'Sat',     style: SAT_STYLE, earthen: false, sat: true, grade: null },
  'sat-soft':  { label: 'Soft',    style: SAT_STYLE, earthen: false, sat: true,
                 grade: { 'raster-contrast': -0.3, 'raster-brightness-max': 0.88, 'raster-saturation': -0.12 } },
  'sat-muted': { label: 'Muted',   style: SAT_STYLE, earthen: false, sat: true,
                 grade: { 'raster-contrast': -0.38, 'raster-brightness-max': 0.8, 'raster-saturation': -0.45 } },
  'sat-dusk':  { label: 'Dusk',    style: SAT_STYLE, earthen: false, sat: true,
                 grade: { 'raster-contrast': -0.18, 'raster-brightness-max': 0.6, 'raster-saturation': -0.28 } },
};
const SKIN_LS_KEY = 'mapkeys_skin_v1';
let currentSkin = (() => {
  try {
    const s = localStorage.getItem(SKIN_LS_KEY);
    return SKINS[s] ? s : 'earthen';
  } catch { return 'earthen'; }
})();

// Apply the current skin's raster grade to the satellite imagery layer.
// Neutral values are always included so flipping back to raw Sat resets a
// previous profile's grade.
function applySatGrade() {
  const skin = SKINS[currentSkin];
  if (!skin || !skin.sat) return;
  const rasterLayer = map.getStyle().layers.find(l => l.type === 'raster' && !l.id.startsWith('mk-'));
  if (!rasterLayer) return;
  const grade = {
    'raster-contrast': 0,
    'raster-brightness-max': 1,
    'raster-saturation': 0,
    ...(skin.grade || {}),
  };
  for (const [prop, val] of Object.entries(grade)) {
    try { map.setPaintProperty(rasterLayer.id, prop, val); } catch (_) {}
  }
}

function setSkin(name) {
  if (!SKINS[name] || name === currentSkin) return;
  const prev = SKINS[currentSkin];
  currentSkin = name;
  try { localStorage.setItem(SKIN_LS_KEY, name); } catch {}
  syncSkinButtons();
  // Satellite profile → satellite profile: same style, just regrade the
  // raster in place. Everything else pays the full style reload.
  if (prev && prev.sat && SKINS[name].sat) {
    applySatGrade();
    return;
  }
  // setStyle wipes all sources/layers; the style.load handler rebuilds
  // overlays, routes, and shapes on top of the new skin.
  map.setStyle(SKINS[name].style);
}

function syncSkinButtons() {
  document.querySelectorAll('.skin-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.skin === currentSkin);
  });
}

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
  style: SKINS[currentSkin].style,
  projection: 'globe',
  center: lastCam?.center ?? [20, 20],
  zoom: lastCam?.zoom ?? 1.8,
  bearing: lastCam?.bearing ?? 0,
  pitch: lastCam?.pitch ?? 0,
  maxPitch: 85,
  attributionControl: false,
  preserveDrawingBuffer: true,
});

// ─── Project session (declared early — referenced by save paths below) ───
let currentProject = null;     // the open library row, or null on the library
let cloudSaveTimer = null;     // debounce handle for the cloud autosave
let suppressAutosave = false;  // true while a project snapshot is being applied

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
  // Camera is part of a project's state — a settled move counts as an edit.
  if (currentProject) scheduleCloudSave();
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

  // ── Hillshade — subtle ridge emphasis (earthen only; satellite imagery
  // carries its own real shading)
  if (SKINS[currentSkin].earthen && !map.getLayer('mk-hillshade')) {
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

  // ── Satellite profiles — grade the imagery (no-op on earthen)
  applySatGrade();

  // ── Recolor base style toward earthen minimal
  const recolor = SKINS[currentSkin].earthen ? [
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
  ] : [];
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
  // Overlays first so old-map rasters sit under routes and shapes.
  for (const overlay of state.overlays) {
    ensureOverlayOnMap(overlay);
  }
  // World borders sit above old-map rasters, below routes/shapes.
  ensureBordersOnMap();
  for (const layer of state.layers) {
    ensureLayerOnMap(layer);
  }
  for (const shape of state.shapes) {
    ensureShapeOnMap(shape);
    redrawShape(shape);
  }
  ensureDrawPreviewOnMap();
  ensureSelectionLayers();
  ensureCountryEditLayers();
  applyShapeOrder();
  updateSelectionIndicator();
  // Re-render with the current preview progress so a hard refresh shows
  // the correct partial-draw state immediately.
  setRouteSources(state.previewProgress);
});

// ─── State ───

const DEFAULT_LAYER_STYLE = { color: '#2b2a26', width: 3, opacity: 1, dashed: false, trail: true };

// ─── BORDERS hub — two independently-styled world-border line layers ───
const DEFAULT_BORDERS = {
  primary:   { on: false, color: '#6b5640', width: 1,   opacity: 0.85, dashed: false },
  secondary: { on: false, color: '#a8482b', width: 2.5, opacity: 0.35, dashed: true },
};
function normalizeBorders(raw) {
  const one = (d, r) => ({
    on: r && typeof r.on === 'boolean' ? r.on : d.on,
    color: r && typeof r.color === 'string' ? r.color : d.color,
    width: r && typeof r.width === 'number' ? r.width : d.width,
    opacity: r && typeof r.opacity === 'number' ? r.opacity : d.opacity,
    dashed: r && typeof r.dashed === 'boolean' ? r.dashed : d.dashed,
  });
  return {
    primary: one(DEFAULT_BORDERS.primary, raw && raw.primary),
    secondary: one(DEFAULT_BORDERS.secondary, raw && raw.secondary),
  };
}
// Color cycle for new uploads so they're visually distinct by default.
const LAYER_COLORS = ['#2b2a26', '#a8482b', '#3b6a4a', '#4a5e8a', '#8a4a6a', '#6a4a2b'];

const state = {
  keyframes: [],          // { center, zoom, bearing, pitch, progress, duration, easing, shapes: { id: {...} } }
  selectedId: null,
  nextId: 1,
  layers: [],             // [{ id, name, coords, cumDist, totalDist, style, visible }]
  overlays: [],           // [{ id, name, kind, source, tiles, opacity, visible, bounds }]
  activeLayerId: null,    // which layer the route-style controls bind to
  borders: normalizeBorders(null),  // BORDERS hub: { primary, secondary } world-border styling
  frame169: false,        // 16:9 compose frame + render crop (persisted per project)
  frameGuides: false,     // cyan center-cross guides inside the 16:9 frame
  previewProgress: 0,    // current scrub-bar position (0–1), what + Keyframe captures
  shapes: [],             // [{ id, type, sides?, baseCoords?, stroke, fill, strokeWidth, fillOpacity, visible, preview: {...} }]
  activeShapeId: null,    // selected shape (or null)
  editingShapeId: null,   // shape currently in geometry-edit mode (countries only, for now)
  draggingVertex: null,   // when dragging a vertex in country-edit mode: { shapeId, polyIdx, ringIdx, vertIdx }
  lastFocus: null,        // 'shape' | 'keyframe' — drives Backspace target when both are selected
  drawingLine: null,      // when drawing a line: { coords: [[lng,lat], ...], cursor: [lng,lat] | null }
  draggingShape: null,    // when dragging: { shapeId, type, anchor: [lng,lat], origin: {...preview} }
  playing: false,
  rafId: null,
  playStart: 0,
  playOffset: 0,
};

// Debug handle — lets a console (or headless CDP verification) inspect the
// live editor without exposing anything in the UI. The fns kit exists so an
// assistant session can repair or extend a LIVE editor in place (paint +
// panel + save) instead of racing the 1.5s cloud autosave with server-side
// writes — last-write-wins means the open tab always wins that race.
window.__mapkeys = {
  map,
  state,
  fns: {
    addCountry, addPlace, saveLayers, renderShapesPanel, renderLayersPanel,
    applyShapeOrder, reorderShapeByDisplay,
    ensureShapeOnMap, redrawShape, backfillShapeIntoKeyframes,
    ensureBordersOnMap, applyBordersToMap, applySatGrade,
  },
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

// ─── Undo stack (deletes + adds) ───
// Snapshots are intentionally lightweight: shapes/layers/keyframes only.
// Style edits, slider drags, and camera moves do NOT push snapshots.
const undoStack = [];
const UNDO_MAX = 30;

function snapshotForUndo(label) {
  const snap = {
    label,
    shapes: state.shapes.map(serializeShape),
    layers: state.layers.map(l => ({
      id: l.id, name: l.name, coords: l.coords.map(c => [c[0], c[1]]),
      style: { ...l.style }, visible: l.visible,
    })),
    keyframes: JSON.parse(JSON.stringify(state.keyframes)),
    overlays: state.overlays.map(serializeOverlay),
    activeShapeId: state.activeShapeId,
    activeLayerId: state.activeLayerId,
    selectedId: state.selectedId,
  };
  undoStack.push(snap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  closeLabelEditor();
  // Tear down current map artifacts
  for (const s of state.shapes) removeShapeFromMap(s);
  for (const l of state.layers) removeLayerFromMap(l);
  for (const o of state.overlays) removeOverlayFromMap(o);
  // Rebuild state from snapshot
  state.shapes = snap.shapes.map(hydrateShape).filter(Boolean);
  state.layers = snap.layers.map(l => {
    const route = buildRoute(l.coords);
    return {
      id: l.id, name: l.name,
      coords: route.coords, cumDist: route.cumDist, totalDist: route.totalDist,
      style: { ...DEFAULT_LAYER_STYLE, ...l.style }, visible: l.visible,
    };
  });
  state.keyframes = snap.keyframes;
  state.overlays = (snap.overlays || []).map(hydrateOverlay).filter(Boolean);
  state.activeShapeId = snap.activeShapeId;
  state.activeLayerId = snap.activeLayerId;
  state.selectedId = snap.selectedId;
  // Re-attach to map (overlays first — they sit under routes/shapes)
  for (const o of state.overlays) ensureOverlayOnMap(o);
  for (const l of state.layers) ensureLayerOnMap(l);
  for (const s of state.shapes) { ensureShapeOnMap(s); redrawShape(s); }
  setRouteSources(state.previewProgress);
  // Re-render UI
  saveLayers();
  renderLayersPanel();
  renderShapesPanel();
  renderOverlaysPanel();
  renderKeyframes();
  renderEditor();
  showRouteUI();
  syncShapeStyleInputs();
  syncRouteStyleInputs();
  syncDrawSlider();
}

// EASINGS, totalDuration, and the segment-resolution math now live in
// ./playback-timing.js so they're headless-testable (imported at top).

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
  return extractKmlCoords(doc);
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

function shapeSourceIds(id) {
  return {
    fill: `shape-fill-src-${id}`,
    line: `shape-line-src-${id}`,
    label: `shape-label-src-${id}`,
    fillLayer: `shape-fill-${id}`,
    lineLayer: `shape-line-${id}`,
    labelLayer: `shape-label-${id}`,
  };
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
  if (shape.type === 'country') {
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
    applyShapeStyle(shape);
    applyShapeVisibility(shape);
    return;
  }
  if (shape.type === 'polygon') {
    if (!map.getSource(ids.fill)) {
      map.addSource(ids.fill, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getSource(ids.label)) {
      map.addSource(ids.label, { type: 'geojson', data: emptyFC() });
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
    if (!map.getLayer(ids.labelLayer)) {
      map.addLayer({
        id: ids.labelLayer,
        type: 'symbol',
        source: ids.label,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 16,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-anchor': 'center',
          'text-justify': 'center',
        },
        paint: {
          'text-color': shape.stroke,
          'text-halo-color': '#fffaf0',
          'text-halo-width': 1.2,
        },
      });
    }
  } else if (shape.type === 'place') {
    // Place = dot (circle layer) + name label (symbol layer), one point source.
    if (!map.getSource(ids.fill)) {
      map.addSource(ids.fill, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(ids.fillLayer)) {
      map.addLayer({
        id: ids.fillLayer,
        type: 'circle',
        source: ids.fill,
        paint: {
          'circle-color': shape.stroke,
          'circle-stroke-color': '#fffaf0',
          'circle-stroke-width': 1.5,
        },
      });
    }
    if (!map.getLayer(ids.labelLayer)) {
      map.addLayer({
        id: ids.labelLayer,
        type: 'symbol',
        source: ids.fill,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': shape.labelSize,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': shape.stroke,
          'text-halo-color': '#fffaf0',
          'text-halo-width': 1.2,
        },
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

// Effective on-map position of a place: geocoded center + drag offsets.
function placePosition(shape) {
  return [
    shape.center[0] + (shape.preview.offsetLng || 0),
    shape.center[1] + (shape.preview.offsetLat || 0),
  ];
}

// ─── Shape z-order ───
// state.shapes is TOP-FIRST (Photoshop order): index 0 is the top row in the
// panel AND the topmost paint on the globe. Rebuild the map's layer stack to
// match by walking bottom→top and lifting each shape's layers to the top;
// editor chrome (selection ring, draw preview, country-edit overlay, search
// pin) always rides above content.
function applyShapeOrder() {
  try {
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const ids = shapeSourceIds(state.shapes[i].id);
      for (const lid of [ids.fillLayer, ids.lineLayer, ids.labelLayer]) {
        if (map.getLayer(lid)) map.moveLayer(lid); // no beforeId → top
      }
    }
    for (const lid of [
      SEL_HALO, SEL_LINE,
      DRAW_PREVIEW_LINE, DRAW_PREVIEW_PTS,
      CE_FILL, CE_LINE, CE_VERT,
      SEARCH_PIN_DOT, SEARCH_PIN_LABEL,
    ]) {
      if (map.getLayer(lid)) map.moveLayer(lid);
    }
  } catch (err) {
    console.warn('[mapkeys] shape reorder failed:', err.message);
  }
}

// Move a shape to a new panel position (display index == array index).
function reorderShapeByDisplay(dragId, targetIdx) {
  const from = state.shapes.findIndex(s => s.id === dragId);
  if (from === -1) return;
  const [moved] = state.shapes.splice(from, 1);
  state.shapes.splice(Math.max(0, Math.min(targetIdx, state.shapes.length)), 0, moved);
  applyShapeOrder();
  saveLayers();
  renderShapesPanel();
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

// ─── BORDERS hub — map plumbing ───
// One geojson source (the world-atlas mesh), two line layers styled from
// state.borders. Layers are created lazily the first time either is switched
// on, inserted beneath every route/shape/selection layer so borders always
// read as basemap chrome, never as content.

const BORDERS_SRC = 'mk-borders-src';
const BORDERS_LAYERS = { primary: 'mk-borders-1', secondary: 'mk-borders-2' };

function bordersBeforeId() {
  for (const l of map.getStyle().layers) {
    if (/^(route-|shape-|mk-sel|mk-country-edit|mk-draw)/.test(l.id)) return l.id;
  }
  return undefined;
}

function ensureBordersOnMap() {
  const b = state.borders;
  if (!b || (!b.primary.on && !b.secondary.on)) { applyBordersToMap(); return; }
  try {
    if (!map.getSource(BORDERS_SRC)) {
      map.addSource(BORDERS_SRC, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: bordersGeom() },
      });
    }
    const beforeId = bordersBeforeId();
    for (const key of ['primary', 'secondary']) {
      const id = BORDERS_LAYERS[key];
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type: 'line',
          source: BORDERS_SRC,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        }, beforeId);
      }
    }
  } catch (err) {
    console.warn('[mapkeys] borders setup failed:', err.message);
  }
  applyBordersToMap();
}

function applyBordersToMap() {
  const b = state.borders;
  if (!b) return;
  for (const key of ['primary', 'secondary']) {
    const id = BORDERS_LAYERS[key];
    if (!map.getLayer(id)) continue;
    const s = b[key];
    try {
      map.setLayoutProperty(id, 'visibility', s.on ? 'visible' : 'none');
      map.setPaintProperty(id, 'line-color', s.color);
      map.setPaintProperty(id, 'line-width', s.width);
      map.setPaintProperty(id, 'line-opacity', s.opacity);
      map.setPaintProperty(id, 'line-dasharray', s.dashed ? [2, 2] : [1, 0]);
    } catch (_) {}
  }
}

function removeShapeFromMap(shape) {
  const ids = shapeSourceIds(shape.id);
  for (const id of [ids.fillLayer, ids.lineLayer, ids.labelLayer]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [ids.fill, ids.line, ids.label]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

function applyShapeStyle(shape) {
  const ids = shapeSourceIds(shape.id);
  const hasFill = shape.type === 'polygon' || shape.type === 'country';
  if (map.getLayer(ids.fillLayer) && hasFill) {
    map.setPaintProperty(ids.fillLayer, 'fill-color', shape.fill);
    map.setPaintProperty(ids.fillLayer, 'fill-opacity', shape.visible ? shape.fillOpacity : 0);
  }
  if (shape.type === 'place' && map.getLayer(ids.fillLayer)) {
    map.setPaintProperty(ids.fillLayer, 'circle-color', shape.stroke);
  }
  if (map.getLayer(ids.lineLayer)) {
    map.setPaintProperty(ids.lineLayer, 'line-color', shape.stroke);
    map.setPaintProperty(ids.lineLayer, 'line-width', shape.strokeWidth);
    map.setPaintProperty(ids.lineLayer, 'line-opacity', shape.visible ? 1 : 0);
  }
  if (map.getLayer(ids.labelLayer)) {
    map.setPaintProperty(ids.labelLayer, 'text-color', shape.stroke);
  }
}

function applyShapeVisibility(shape) {
  const ids = shapeSourceIds(shape.id);
  const vis = shape.visible ? 'visible' : 'none';
  if (map.getLayer(ids.fillLayer)) map.setLayoutProperty(ids.fillLayer, 'visibility', vis);
  if (map.getLayer(ids.lineLayer)) map.setLayoutProperty(ids.lineLayer, 'visibility', vis);
  if (map.getLayer(ids.labelLayer)) map.setLayoutProperty(ids.labelLayer, 'visibility', vis);
}

// Render the shape using its current preview state.
function redrawShape(shape) {
  redrawShapeImpl(shape);
  // Keep the selection indicator pinned to the active shape as it moves
  // (drag, slider edits, playback interpolation).
  if (state.activeShapeId === shape.id && state.lastFocus === 'shape') {
    updateSelectionIndicator();
  }
}

function redrawShapeImpl(shape) {
  const ids = shapeSourceIds(shape.id);
  if (shape.type === 'country') {
    const src = map.getSource(ids.fill);
    if (!src) return;
    const geom = effectiveCountryGeometry(shape);
    if (!geom) { src.setData(emptyFC()); return; }
    src.setData({ type: 'Feature', properties: {}, geometry: geom });
    return;
  }
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
    // Label point + auto-fit text size
    const labelSrc = map.getSource(ids.label);
    if (labelSrc) {
      const label = shape.label || '';
      labelSrc.setData({
        type: 'Feature',
        properties: { label },
        geometry: { type: 'Point', coordinates: shape.preview.center },
      });
      if (map.getLayer(ids.labelLayer)) {
        const size = computePolygonLabelSize(shape);
        map.setLayoutProperty(ids.labelLayer, 'text-size', size);
      }
    }
  } else if (shape.type === 'place') {
    const src = map.getSource(ids.fill);
    if (!src) return;
    const pos = placePosition(shape);
    src.setData({
      type: 'Feature',
      properties: { label: shape.label || '' },
      geometry: { type: 'Point', coordinates: pos },
    });
    const scale = shape.preview.scale ?? 1;
    const dotR = Math.max(0.5, shape.dotSize * scale);
    const textPx = Math.max(1, shape.labelSize * scale);
    if (map.getLayer(ids.fillLayer)) {
      map.setPaintProperty(ids.fillLayer, 'circle-radius', dotR);
    }
    if (map.getLayer(ids.labelLayer)) {
      map.setLayoutProperty(ids.labelLayer, 'text-size', textPx);
      // Anchor is 'bottom' — lift the text clear of the dot (ems of text size).
      map.setLayoutProperty(ids.labelLayer, 'text-offset', [0, -(dotR / textPx + 0.35)]);
    }
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

// Auto-fit text size: pick the largest pixel size where the rendered text
// width fits within ~80% of the polygon's on-screen diameter, capped by ~70%
// of the polygon height. Recomputed on every redraw and on map zoom.
function computePolygonLabelSize(shape) {
  const label = shape.label || '';
  if (!label) return 1; // hidden by empty text-field anyway
  const center = shape.preview.center;
  // Project center and a point on the polygon's bounding extent to get pixel
  // dimensions at the current zoom/pitch.
  const cp = map.project(center);
  const dLatDeg = shape.preview.radiusKm / KM_PER_DEG_LAT;
  const ep = map.project([center[0], center[1] + dLatDeg]);
  const radiusPx = Math.max(8, Math.hypot(cp.x - ep.x, cp.y - ep.y));
  // Effective interior width across an n-gon ≈ 2 * radius * cos(π/n) for even n.
  // Use a slightly conservative 1.5×radius diameter target.
  const widthBudget = radiusPx * 1.55;
  const heightBudget = radiusPx * 1.35;
  // Approx font width per char. Bold sans averages ~0.58 of font size at most weights.
  const widthRatio = 0.58;
  const fromWidth = widthBudget / Math.max(1, label.length) / widthRatio;
  const fromHeight = heightBudget;
  const px = Math.max(8, Math.min(160, Math.min(fromWidth, fromHeight)));
  return px;
}

function refreshAllPolygonLabelSizes() {
  for (const shape of state.shapes) {
    if (shape.type !== 'polygon') continue;
    const ids = shapeSourceIds(shape.id);
    if (!map.getLayer(ids.labelLayer)) continue;
    map.setLayoutProperty(ids.labelLayer, 'text-size', computePolygonLabelSize(shape));
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
  snapshotForUndo('add octagon');
  const c = map.getCenter();
  const id = newShapeId();
  const shape = {
    id,
    type: 'polygon',
    name: nextShapeName('polygon'),
    sides: 8,
    label: '',
    stroke: SHAPE_DEFAULTS.stroke,
    fill: pickShapeFill(),
    strokeWidth: SHAPE_DEFAULTS.strokeWidth,
    fillOpacity: SHAPE_DEFAULTS.fillOpacity,
    visible: true,
    preview: defaultShapePreview('polygon', [c.lng, c.lat]),
  };
  state.shapes.unshift(shape); // top-first: new shapes land on top
  // Backfill all existing keyframes with this shape's initial state so
  // playback doesn't pop when crossing a keyframe that pre-dates the shape.
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  // Don't auto-open the style panel — let the user click the shape to do that.
  saveLayers();
  renderShapesPanel();
  renderLayersPanel();
  showRouteUI();
}

// A geocoded place becomes a real shape: dot + label, keyframable and
// persisted like everything else. result: { name, center: [lng, lat] }.
function addPlace(result) {
  if (!result || !Array.isArray(result.center)) return null;
  snapshotForUndo('add place');
  const id = newShapeId();
  const shape = {
    id,
    type: 'place',
    name: result.name,
    label: result.name,
    center: [result.center[0], result.center[1]],
    dotSize: 6,
    labelSize: 14,
    stroke: SHAPE_DEFAULTS.stroke,
    fill: SHAPE_DEFAULTS.stroke,  // unused for places but persisted
    strokeWidth: 1.5,
    fillOpacity: 0,
    visible: true,
    preview: defaultShapePreview('place'),
  };
  state.shapes.unshift(shape); // top-first: new shapes land on top
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  saveLayers();
  renderShapesPanel();
  renderLayersPanel();
  showRouteUI();
  selectShape(id);
  return shape;
}

function resolveCountryGeometry(shape) {
  // Custom edits (vertex drags / inserts / deletes) live in shape.customGeometry
  // and override the canonical country shape from the COUNTRIES table.
  if (shape.customGeometry) return shape.customGeometry;
  if (shape._geometry) return shape._geometry;
  let c = null;
  if (shape.countryId) c = COUNTRY_BY_ID.get(String(shape.countryId)) || null;
  if (!c && shape.countryName) c = COUNTRY_BY_NAME.get(shape.countryName.toLowerCase()) || null;
  if (c) shape._geometry = c.geometry;
  return shape._geometry || null;
}

function addCountry(country) {
  // country: { id, name, geometry } from the COUNTRIES list
  if (!country) return;
  // Don't double-add the same country
  const exists = state.shapes.find(s => s.type === 'country' && String(s.countryId) === String(country.id));
  if (exists) {
    selectShape(exists.id);
    return;
  }
  snapshotForUndo('add country');
  const id = newShapeId();
  const shape = {
    id,
    type: 'country',
    name: country.name,
    countryId: String(country.id),
    countryName: country.name,
    _geometry: country.geometry,
    stroke: SHAPE_DEFAULTS.stroke,
    fill: pickShapeFill(),
    strokeWidth: 1.5,
    fillOpacity: 0.35,
    visible: true,
    preview: {},  // unused but kept for compatibility with the rest of the system
  };
  state.shapes.unshift(shape); // top-first: new shapes land on top
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  saveLayers();
  renderShapesPanel();
  showRouteUI();
}

function addLineFromCoords(coords) {
  if (!coords || coords.length < 2) return;
  snapshotForUndo('add line');
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
  state.shapes.unshift(shape); // top-first: new shapes land on top
  backfillShapeIntoKeyframes(shape);
  ensureShapeOnMap(shape);
  redrawShape(shape);
  // Don't auto-open the style panel — let the user click the line to do that.
  saveLayers();
  renderShapesPanel();
  renderLayersPanel();
  showRouteUI();
}

function duplicateShape(id) {
  const orig = state.shapes.find(s => s.id === id);
  if (!orig) return;
  snapshotForUndo('duplicate shape');
  const newId = newShapeId();
  // Copy with offset so user can see it. ~10% of polygon radius or default 5km.
  const offsetDeg = orig.type === 'polygon'
    ? (orig.preview.radiusKm * 0.4) / KM_PER_DEG_LAT
    : 0.5;
  const dup = JSON.parse(JSON.stringify(orig));
  dup.id = newId;
  dup.name = orig.name + ' copy';
  if (dup.type === 'polygon') {
    dup.preview.center = [orig.preview.center[0] + offsetDeg, orig.preview.center[1] + offsetDeg];
  } else {
    dup.preview.offsetLng = orig.preview.offsetLng + offsetDeg;
    dup.preview.offsetLat = orig.preview.offsetLat + offsetDeg;
  }
  // Insert the copy just above the original (top-first stack).
  const origIdx = state.shapes.findIndex(s => s.id === id);
  state.shapes.splice(Math.max(0, origIdx), 0, dup);
  // Copy per-keyframe state from original to duplicate.
  for (const kf of state.keyframes) {
    if (!kf.shapes) kf.shapes = {};
    if (kf.shapes[id]) {
      const cloned = JSON.parse(JSON.stringify(kf.shapes[id]));
      // Apply same offset to keyframed positions so the copy stays separated
      if (cloned.center) cloned.center = [cloned.center[0] + offsetDeg, cloned.center[1] + offsetDeg];
      if (typeof cloned.offsetLng === 'number') cloned.offsetLng += offsetDeg;
      if (typeof cloned.offsetLat === 'number') cloned.offsetLat += offsetDeg;
      kf.shapes[newId] = cloned;
    }
  }
  ensureShapeOnMap(dup);
  redrawShape(dup);
  applyShapeOrder();
  state.activeShapeId = newId;
  state.lastFocus = 'shape';
  saveLayers();
  renderShapesPanel();
  syncShapeStyleInputs();
  showRouteUI();
}

function deleteShape(id) {
  const shape = state.shapes.find(s => s.id === id);
  if (!shape) return;
  snapshotForUndo('delete shape');
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
  state.lastFocus = 'shape';
  renderShapesPanel();
  renderLayersPanel();
  syncShapeStyleInputs();
  showRouteUI();
}

function activeShape() {
  return state.shapes.find(s => s.id === state.activeShapeId) || null;
}

function snapshotShapePreview(shape) {
  // Returns a plain object copy of the shape's keyframe-relevant state.
  // Also captures stroke width + fill opacity so they animate between kfs.
  const common = {
    strokeWidth: shape.strokeWidth,
    fillOpacity: shape.fillOpacity,
  };
  if (shape.type === 'country') {
    // Country geometry is fixed; only style props are keyframeable.
    return { ...common };
  }
  if (shape.type === 'polygon') {
    return {
      ...common,
      center: [shape.preview.center[0], shape.preview.center[1]],
      radiusKm: shape.preview.radiusKm,
      rotation: shape.preview.rotation,
    };
  }
  return {
    ...common,
    offsetLng: shape.preview.offsetLng,
    offsetLat: shape.preview.offsetLat,
    scale: shape.preview.scale,
    drawProgress: shape.preview.drawProgress,
  };
}

function applyShapeKfState(shape, st) {
  if (!st) return;
  if (typeof st.strokeWidth === 'number') shape.strokeWidth = st.strokeWidth;
  if (typeof st.fillOpacity === 'number') shape.fillOpacity = st.fillOpacity;
  if (shape.type === 'country') {
    // Geometry is fixed; nothing else to apply.
  } else if (shape.type === 'polygon') {
    if (Array.isArray(st.center)) shape.preview.center = [st.center[0], st.center[1]];
    if (typeof st.radiusKm === 'number') shape.preview.radiusKm = st.radiusKm;
    if (typeof st.rotation === 'number') shape.preview.rotation = st.rotation;
  } else {
    if (typeof st.offsetLng === 'number') shape.preview.offsetLng = st.offsetLng;
    if (typeof st.offsetLat === 'number') shape.preview.offsetLat = st.offsetLat;
    if (typeof st.scale === 'number') shape.preview.scale = st.scale;
    if (typeof st.drawProgress === 'number') shape.preview.drawProgress = st.drawProgress;
  }
  // Re-apply paint props after style changes
  applyShapeStyle(shape);
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
    if (shape.type === 'country') {
      // Only style props animate. Skip geometry transforms.
    } else if (shape.type === 'polygon') {
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
    if (typeof sa.strokeWidth === 'number' && typeof sb.strokeWidth === 'number') {
      shape.strokeWidth = lerp(sa.strokeWidth, sb.strokeWidth, eased);
    }
    if (typeof sa.fillOpacity === 'number' && typeof sb.fillOpacity === 'number') {
      shape.fillOpacity = lerp(sa.fillOpacity, sb.fillOpacity, eased);
    }
    applyShapeStyle(shape);
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

// ─── Old-map overlays (georeferenced paper maps as raster tiles) ───

// Feathered-crop tiles via Mapbox's CustomSource API: loadTile fetches the
// real tile, then multiplies its alpha by four edge ramps so the map fades
// out toward its crop rectangle — Photoshop-style feather, applied per tile
// at every zoom. (mapbox-gl has no addProtocol — custom sources are the
// supported hook for synthesized raster tiles.)
const DEFAULT_FEATHER = { on: false, rect: null, crop: 0.06, width: 0.12 };

// loadTile reads the overlay's live feather params; param changes rebuild the
// source (refreshOverlayTiles) so cached tiles can't go stale.
function featherCustomSource(overlay) {
  return {
    type: 'custom',
    dataType: 'raster',
    tileSize: 256,
    maxzoom: 20,
    async loadTile({ z, x, y }, { signal }) {
      const f = overlay.feather;
      if (!f || !Array.isArray(f.rect)) return new ImageData(4, 4);
      const plan = featherPlan({ z, x, y }, f.rect, f.crop, f.width, 256);
      if (plan.coverage === 'outside') return new ImageData(4, 4); // transparent
      const url = overlay.tiles
        .replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`tile fetch failed (${res.status})`);
      const bmp = await createImageBitmap(await res.blob());
      if (plan.coverage === 'inside') return bmp;
      // Re-plan at the bitmap's real pixel size (256 vs 512 tiles).
      const px = featherPlan({ z, x, y }, f.rect, f.crop, f.width, bmp.width);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      for (const r of px.ramps) {
        const g = r.axis === 'x'
          ? ctx.createLinearGradient(r.fromPx, 0, r.toPx, 0)
          : ctx.createLinearGradient(0, r.fromPx, 0, r.toPx);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return canvas.transferToImageBitmap();
    },
  };
}

function overlaySourceIds(id) {
  return { src: `oldmap-src-${id}`, layer: `oldmap-${id}` };
}

function overlayFeatherActive(overlay) {
  const f = overlay.feather;
  return !!(f && f.on && Array.isArray(f.rect));
}

// Rebuild an overlay's source + layer (feather toggled or params changed).
// Custom sources cache composited tiles, so a rebuild is the only reliable
// invalidation; the browser's HTTP cache keeps the refetch cheap.
function refreshOverlayTiles(overlay) {
  removeOverlayFromMap(overlay);
  ensureOverlayOnMap(overlay);
  applyOverlayOrder();
}

// Restack every overlay layer to match state.overlays order (index 0 =
// bottom). Each move drops the layer just under the first route/shape layer,
// so walking bottom→top leaves the last overlay on top — Photoshop rules.
function applyOverlayOrder() {
  for (const o of state.overlays) {
    const ids = overlaySourceIds(o.id);
    if (map.getLayer(ids.layer)) map.moveLayer(ids.layer, overlayBeforeId());
  }
}

// Overlays live above the basemap/hillshade but below every route, shape,
// and UI layer. Returns the id of the first such layer to insert before.
function overlayBeforeId() {
  for (const l of map.getStyle().layers) {
    if (/^(route-|shape-|mk-sel|mk-ce)/.test(l.id)) return l.id;
  }
  return undefined;
}

function ensureOverlayOnMap(overlay) {
  const ids = overlaySourceIds(overlay.id);
  if (!map.getSource(ids.src)) {
    map.addSource(ids.src, overlayFeatherActive(overlay)
      ? featherCustomSource(overlay)
      : { type: 'raster', tiles: [overlay.tiles], tileSize: 256, maxzoom: 20 });
  }
  if (!map.getLayer(ids.layer)) {
    map.addLayer({
      id: ids.layer,
      type: 'raster',
      source: ids.src,
      paint: {
        'raster-opacity': overlay.visible ? overlay.opacity : 0,
        'raster-fade-duration': 0,
      },
    }, overlayBeforeId());
  }
  applyOverlayStyle(overlay);
}

function removeOverlayFromMap(overlay) {
  const ids = overlaySourceIds(overlay.id);
  if (map.getLayer(ids.layer)) map.removeLayer(ids.layer);
  if (map.getSource(ids.src)) map.removeSource(ids.src);
}

function applyOverlayStyle(overlay) {
  const ids = overlaySourceIds(overlay.id);
  if (!map.getLayer(ids.layer)) return;
  map.setPaintProperty(ids.layer, 'raster-opacity', overlay.visible ? overlay.opacity : 0);
}

async function addOldMapFromInput(raw) {
  const classified = classifyOldMapInput(raw);
  if (!classified) throw new Error('That doesn’t look like a map URL.');

  const overlay = {
    id: 'om_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    name: 'Old map',
    kind: classified.kind,
    source: classified.kind === 'allmaps' ? classified.annotation : classified.tiles,
    tiles: classified.tiles,
    opacity: 1,
    visible: true,
    bounds: null,
    feather: { ...DEFAULT_FEATHER },
  };

  // For Allmaps annotations, fetch label + GCP bounds so we can name the
  // overlay and fly to it. Failure here is fatal — if the annotation can't
  // be read, the tile proxy can't warp it either.
  if (classified.kind === 'allmaps') {
    const res = await fetch(classified.annotation, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Couldn’t load that map (HTTP ${res.status}).`);
    const doc = await res.json();
    const isGeoref = JSON.stringify(doc).includes('georeferencing');
    if (!isGeoref) throw new Error('That URL isn’t a georeference annotation.');
    overlay.name = annotationLabel(doc) || 'Old map';
    overlay.bounds = annotationBounds(doc);
  } else {
    // XYZ templates carry no title — number them so a stack of maps from the
    // same server stays tellable-apart (rename any row by double-clicking it).
    try {
      const host = new URL(classified.tiles.replace(/\{[zxy]\}/g, '0')).hostname;
      overlay.name = `${host.replace(/^wmts\.|^tiles\./, '')} · ${state.overlays.length + 1}`;
    } catch { /* keep default */ }
  }

  snapshotForUndo('add old map');
  state.overlays.push(overlay);
  ensureOverlayOnMap(overlay);
  backfillOverlayIntoKeyframes(overlay);
  saveLayers();
  renderOverlaysPanel();
  showRouteUI();
  if (overlay.bounds) map.fitBounds(overlay.bounds, { padding: 60, duration: 1200 });
  return overlay;
}

function deleteOverlay(id) {
  const overlay = state.overlays.find(o => o.id === id);
  if (!overlay) return;
  snapshotForUndo('delete old map');
  removeOverlayFromMap(overlay);
  state.overlays = state.overlays.filter(o => o.id !== id);
  for (const kf of state.keyframes) {
    if (kf.overlays) delete kf.overlays[id];
  }
  saveLayers();
  renderOverlaysPanel();
  showRouteUI();
}

function setOverlayVisible(id, visible) {
  const overlay = state.overlays.find(o => o.id === id);
  if (!overlay) return;
  overlay.visible = visible;
  applyOverlayStyle(overlay);
  saveLayers();
  renderOverlaysPanel();
}

function fitToOverlay(overlay) {
  const target = overlay.bounds || overlay.feather?.rect;
  if (target) map.fitBounds(target, { padding: 60, duration: 800 });
}

// ── Feather controls ──

function currentViewRect() {
  const b = map.getBounds();
  return [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]];
}

function toggleOverlayFeather(overlay) {
  const f = overlay.feather || (overlay.feather = { ...DEFAULT_FEATHER });
  f.on = !f.on;
  // First switch-on needs a frame: the map's own bounds when we know them
  // (Allmaps), otherwise whatever is framed in the viewport right now.
  if (f.on && !Array.isArray(f.rect)) {
    f.rect = overlay.bounds ? [
      [overlay.bounds[0][0], overlay.bounds[0][1]],
      [overlay.bounds[1][0], overlay.bounds[1][1]],
    ] : currentViewRect();
  }
  refreshOverlayTiles(overlay);
  saveLayers();
  renderOverlaysPanel();
}

function setOverlayFeatherRectToView(overlay) {
  const f = overlay.feather || (overlay.feather = { ...DEFAULT_FEATHER });
  f.rect = currentViewRect();
  if (f.on) refreshOverlayTiles(overlay);
  saveLayers();
}

// Debounced per-overlay tile refresh so slider drags don't thrash the source.
const featherRefreshTimers = {};
function mutateOverlayFeather(overlay, fn) {
  const f = overlay.feather || (overlay.feather = { ...DEFAULT_FEATHER });
  fn(f);
  clearTimeout(featherRefreshTimers[overlay.id]);
  featherRefreshTimers[overlay.id] = setTimeout(() => {
    if (f.on) refreshOverlayTiles(overlay);
    saveLayers();
  }, 180);
}

// ── Overlay keyframing — opacity animates between keyframes, so a paper
// map can fade up over the satellite (or dissolve away) during playback.

function captureOverlaysForKeyframe() {
  const out = {};
  for (const o of state.overlays) out[o.id] = { opacity: o.opacity, visible: o.visible };
  return out;
}

function backfillOverlayIntoKeyframes(overlay) {
  for (const kf of state.keyframes) {
    if (!kf.overlays) kf.overlays = {};
    if (!kf.overlays[overlay.id]) {
      kf.overlays[overlay.id] = { opacity: overlay.opacity, visible: overlay.visible };
    }
  }
}

function applyOverlayKfState(overlay, st) {
  if (!st) return;
  if (typeof st.opacity === 'number') overlay.opacity = st.opacity;
  if (typeof st.visible === 'boolean') overlay.visible = st.visible;
  applyOverlayStyle(overlay);
}

function applyOverlayStateAtKeyframe(kf) {
  for (const overlay of state.overlays) {
    applyOverlayKfState(overlay, kf.overlays?.[overlay.id]);
  }
}

function interpolateOverlaysAtTime(a, b, eased) {
  for (const overlay of state.overlays) {
    const oa = a.overlays?.[overlay.id];
    const ob = b.overlays?.[overlay.id];
    if (!oa && !ob) continue;
    if (!oa) { applyOverlayKfState(overlay, ob); continue; }
    if (!ob) { applyOverlayKfState(overlay, oa); continue; }
    overlay.opacity = lerp(oa.opacity, ob.opacity, eased);
    overlay.visible = oa.visible || ob.visible;
    applyOverlayStyle(overlay);
  }
}

// ─── Selection indicator (visual highlight on the active shape/route) ───
const SEL_SRC = 'mk-sel-src';
const SEL_HALO = 'mk-sel-halo';
const SEL_LINE = 'mk-sel-line';

function ensureSelectionLayers() {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(SEL_SRC)) {
    map.addSource(SEL_SRC, { type: 'geojson', data: emptyFC() });
  }
  if (!map.getLayer(SEL_HALO)) {
    map.addLayer({
      id: SEL_HALO,
      type: 'line',
      source: SEL_SRC,
      paint: {
        'line-color': '#fffaf0',
        'line-width': 9,
        'line-blur': 4,
        'line-opacity': 0.85,
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  if (!map.getLayer(SEL_LINE)) {
    map.addLayer({
      id: SEL_LINE,
      type: 'line',
      source: SEL_SRC,
      paint: {
        'line-color': '#b85c3c',
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
}

function effectiveCountryGeometry(shape) {
  const geom = resolveCountryGeometry(shape);
  if (!geom) return null;
  if (geom.type !== 'MultiPolygon') return geom;
  const excluded = new Set(shape.excludedPolygonIndices || []);
  if (excluded.size === 0) return geom;
  const filtered = geom.coordinates.filter((_, idx) => !excluded.has(idx));
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return { type: 'Polygon', coordinates: filtered[0] };
  return { type: 'MultiPolygon', coordinates: filtered };
}

function updateSelectionIndicator() {
  // No isStyleLoaded() gate here: setData() flips the style to "loading" on
  // every shape redraw, so gating would randomly skip updates mid-drag and
  // leave the indicator stranded at a stale position. Layer creation is
  // guarded inside ensureSelectionLayers(); setData on an existing source is
  // always safe.
  ensureSelectionLayers();
  const src = map.getSource(SEL_SRC);
  if (!src) return;
  // Hide selection indicator while editing — the edit overlay is the focus.
  if (state.editingShapeId) { src.setData(emptyFC()); return; }
  let geometry = null;
  if (state.lastFocus === 'shape' && state.activeShapeId) {
    const shape = state.shapes.find(s => s.id === state.activeShapeId);
    if (!shape || !shape.visible) { src.setData(emptyFC()); return; }
    if (shape.type === 'polygon') {
      const ring = regularPolygonCoords(
        shape.preview.center, shape.sides, shape.preview.radiusKm, shape.preview.rotation,
      );
      geometry = { type: 'LineString', coordinates: ring };
    } else if (shape.type === 'line') {
      const transformed = transformLineCoords(
        shape.baseCoords, shape.preview.offsetLng, shape.preview.offsetLat, shape.preview.scale,
      );
      const drawn = sliceLineCoords(transformed, shape.preview.drawProgress);
      if (drawn.length < 2) { src.setData(emptyFC()); return; }
      geometry = { type: 'LineString', coordinates: drawn };
    } else if (shape.type === 'country') {
      const geom = effectiveCountryGeometry(shape);
      if (!geom) { src.setData(emptyFC()); return; }
      const polyRings = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      const allRings = [];
      for (const polyR of polyRings) for (const ring of polyR) allRings.push(ring);
      geometry = { type: 'MultiLineString', coordinates: allRings };
    } else if (shape.type === 'place') {
      // Pixel-space ring just outside the dot, unprojected back to lngLat.
      const pos = placePosition(shape);
      const cp = map.project(pos);
      const rPx = Math.max(0.5, shape.dotSize * (shape.preview.scale ?? 1)) + 6;
      const ring = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const p = map.unproject([cp.x + Math.cos(a) * rPx, cp.y + Math.sin(a) * rPx]);
        ring.push([p.lng, p.lat]);
      }
      geometry = { type: 'LineString', coordinates: ring };
    }
  } else if (state.lastFocus === 'layer' && state.activeLayerId) {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    if (!layer || !layer.visible) { src.setData(emptyFC()); return; }
    geometry = { type: 'LineString', coordinates: layer.coords };
  }
  if (!geometry) { src.setData(emptyFC()); return; }
  src.setData({ type: 'Feature', geometry, properties: {} });
}

// ─── Country edit overlay (per-subpolygon click-to-toggle exclusion) ───
const CE_SRC = 'mk-ce-src';
const CE_FILL = 'mk-ce-fill';
const CE_LINE = 'mk-ce-line';
const CE_VERT_SRC = 'mk-ce-vert-src';
const CE_VERT = 'mk-ce-vert';

function ensureCountryEditLayers() {
  if (!map.isStyleLoaded()) return false;
  if (!map.getSource(CE_SRC)) {
    map.addSource(CE_SRC, { type: 'geojson', data: emptyFC() });
  }
  if (!map.getLayer(CE_FILL)) {
    map.addLayer({
      id: CE_FILL,
      type: 'fill',
      source: CE_SRC,
      paint: {
        'fill-color': ['case', ['get', 'excluded'], '#b85c3c', '#3b6a4a'],
        'fill-opacity': ['case', ['get', 'excluded'], 0.55, 0.35],
      },
    });
  }
  if (!map.getLayer(CE_LINE)) {
    map.addLayer({
      id: CE_LINE,
      type: 'line',
      source: CE_SRC,
      paint: {
        'line-color': ['case', ['get', 'excluded'], '#7a3d28', '#1f3a28'],
        'line-width': 1.5,
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  if (!map.getSource(CE_VERT_SRC)) {
    map.addSource(CE_VERT_SRC, { type: 'geojson', data: emptyFC() });
  }
  if (!map.getLayer(CE_VERT)) {
    map.addLayer({
      id: CE_VERT,
      type: 'circle',
      source: CE_VERT_SRC,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.5, 6, 4, 10, 5],
        'circle-color': '#fffaf0',
        'circle-stroke-color': '#1f3a28',
        'circle-stroke-width': 1.5,
      },
    });
  }
}

// Promote-on-write: clone the original country geometry into shape.customGeometry
// (always normalized as MultiPolygon for uniform vertex addressing).
function ensureCustomGeometry(shape) {
  if (shape.customGeometry && shape.customGeometry.type === 'MultiPolygon') {
    return shape.customGeometry;
  }
  if (shape.customGeometry && shape.customGeometry.type === 'Polygon') {
    shape.customGeometry = {
      type: 'MultiPolygon',
      coordinates: [shape.customGeometry.coordinates],
    };
    return shape.customGeometry;
  }
  const orig = shape._geometry || resolveCountryGeometry(shape);
  if (!orig) return null;
  const polys = orig.type === 'Polygon' ? [orig.coordinates] : orig.coordinates;
  shape.customGeometry = {
    type: 'MultiPolygon',
    coordinates: JSON.parse(JSON.stringify(polys)),
  };
  return shape.customGeometry;
}

// Distance from point P to segment AB, in screen-space pixels.
function pointToSegmentDistPx(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// Find the nearest non-excluded ring segment to a screen point. Returns the
// insertion index (where the new vertex would be spliced in) or null if none
// is within the threshold.
function findNearestEdgeForInsertion(shape, screenPoint, thresholdPx = 14) {
  const geom = ensureCustomGeometry(shape);
  if (!geom) return null;
  const excluded = new Set(shape.excludedPolygonIndices || []);
  let best = null;
  for (let pi = 0; pi < geom.coordinates.length; pi++) {
    if (excluded.has(pi)) continue;
    const rings = geom.coordinates[pi];
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = map.project(ring[i]);
        const b = map.project(ring[i + 1]);
        const d = pointToSegmentDistPx(screenPoint, a, b);
        if (!best || d < best.dist) {
          best = { dist: d, polyIdx: pi, ringIdx: ri, vertIdx: i + 1 };
        }
      }
    }
  }
  if (!best || best.dist > thresholdPx) return null;
  return best;
}

function updateCountryEditOverlay(shape) {
  ensureCountryEditLayers();
  const src = map.getSource(CE_SRC);
  const vsrc = map.getSource(CE_VERT_SRC);
  if (!src) return;
  if (!shape || shape.type !== 'country') {
    src.setData(emptyFC());
    if (vsrc) vsrc.setData(emptyFC());
    return;
  }
  const geom = resolveCountryGeometry(shape);
  if (!geom) {
    src.setData(emptyFC());
    if (vsrc) vsrc.setData(emptyFC());
    return;
  }
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const excluded = new Set(shape.excludedPolygonIndices || []);
  const features = polys.map((rings, idx) => ({
    type: 'Feature',
    properties: { idx, excluded: excluded.has(idx) },
    geometry: { type: 'Polygon', coordinates: rings },
  }));
  src.setData({ type: 'FeatureCollection', features });

  // Vertex circles — only for non-excluded polys, skip the closing duplicate
  // vertex (last === first in a GeoJSON ring).
  if (vsrc) {
    const verts = [];
    for (let pi = 0; pi < polys.length; pi++) {
      if (excluded.has(pi)) continue;
      const rings = polys[pi];
      for (let ri = 0; ri < rings.length; ri++) {
        const ring = rings[ri];
        for (let vi = 0; vi < ring.length - 1; vi++) {
          verts.push({
            type: 'Feature',
            properties: { polyIdx: pi, ringIdx: ri, vertIdx: vi },
            geometry: { type: 'Point', coordinates: ring[vi] },
          });
        }
      }
    }
    vsrc.setData({ type: 'FeatureCollection', features: verts });
  }
}

function clearCountryEditOverlay() {
  const src = map.getSource(CE_SRC);
  if (src) src.setData(emptyFC());
  const vsrc = map.getSource(CE_VERT_SRC);
  if (vsrc) vsrc.setData(emptyFC());
}

function startCountryEdit(shape) {
  state.editingShapeId = shape.id;
  document.body.classList.add('editing-country');
  // Hide the live render of this country so the overlay is the only visible
  // representation; click parts to toggle them.
  const ids = shapeSourceIds(shape.id);
  if (map.getLayer(ids.fillLayer)) map.setLayoutProperty(ids.fillLayer, 'visibility', 'none');
  if (map.getLayer(ids.lineLayer)) map.setLayoutProperty(ids.lineLayer, 'visibility', 'none');
  ensureCountryEditLayers();
  updateCountryEditOverlay(shape);
  updateSelectionIndicator();  // hides while editing
  document.getElementById('country-edit-bar').classList.remove('hidden');
}

function exitCountryEdit() {
  const id = state.editingShapeId;
  state.editingShapeId = null;
  document.body.classList.remove('editing-country');
  const shape = id ? state.shapes.find(s => s.id === id) : null;
  if (shape) {
    const ids = shapeSourceIds(shape.id);
    if (map.getLayer(ids.fillLayer)) map.setLayoutProperty(ids.fillLayer, 'visibility', shape.visible ? 'visible' : 'none');
    if (map.getLayer(ids.lineLayer)) map.setLayoutProperty(ids.lineLayer, 'visibility', shape.visible ? 'visible' : 'none');
    redrawShape(shape);
  }
  clearCountryEditOverlay();
  updateSelectionIndicator();
  document.getElementById('country-edit-bar').classList.add('hidden');
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
  snapshotForUndo('add keyframe');
  const view = captureView();
  const kf = {
    id: 'k' + (state.nextId++),
    ...view,
    progress: state.previewProgress,
    duration: 4.0,
    easing: 'easeInOut',
    shapes: captureShapesForKeyframe(),
    overlays: captureOverlaysForKeyframe(),
  };
  state.keyframes.push(kf);
  state.selectedId = kf.id;
  state.lastFocus = 'keyframe';
  renderKeyframes();
  renderEditor();
  syncDrawSlider();
}

function deleteKeyframe(id) {
  snapshotForUndo('delete keyframe');
  state.keyframes = state.keyframes.filter(k => k.id !== id);
  if (state.selectedId === id) {
    state.selectedId = state.keyframes[0]?.id ?? null;
  }
  renderKeyframes();
  renderEditor();
}

function selectKeyframe(id, jump = true) {
  state.selectedId = id;
  state.lastFocus = 'keyframe';
  renderKeyframes();
  renderEditor();
  if (jump) {
    const kf = state.keyframes.find(k => k.id === id);
    if (kf) {
      map.jumpTo({ center: kf.center, zoom: kf.zoom, bearing: kf.bearing, pitch: kf.pitch });
      state.previewProgress = kf.progress;
      setRouteSources(kf.progress);
      applyShapeStateAtKeyframe(kf);
      applyOverlayStateAtKeyframe(kf);
      syncDrawSlider();
      syncShapeStyleInputs();
      // Park the playhead here so Play continues from this keyframe.
      if (!state.playing) {
        state.playOffset = keyframeStartTime(state.keyframes, id);
        updateTimeDisplay(state.playOffset);
      }
    }
  }
}

// ─── Interpolation ───

function lerp(a, b, t) { return a + (b - a) * t; }

function applyAtTime(timeSec) {
  const kfs = state.keyframes;
  if (kfs.length === 0) return;
  if (kfs.length === 1) {
    const kf = kfs[0];
    map.jumpTo({ center: kf.center, zoom: kf.zoom, bearing: kf.bearing, pitch: kf.pitch });
    state.previewProgress = kf.progress;
    setRouteSources(kf.progress);
    applyShapeStateAtKeyframe(kf);
    applyOverlayStateAtKeyframe(kf);
    syncDrawSlider();
    return;
  }

  // Find segment + eased position (pure math lives in playback-timing.js).
  const seg = resolveKeyframeSegment(kfs, timeSec);
  if (!seg) return;
  const i = seg.index;
  const eased = (EASINGS[kfs[i].easing] || EASINGS.linear)(seg.localT);
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
  interpolateOverlaysAtTime(a, b, eased);
  syncDrawSlider();
}

// ─── Playback ───

function play() {
  if (state.keyframes.length < 2) return;
  if (state.playing) return;
  const total = totalDuration(state.keyframes);
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
  state.playOffset = Math.min(elapsed, totalDuration(state.keyframes));
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

// SVG icons for easing toggle. Linear = 45° line, Ease (in-out) = S-curve.
const EASE_ICONS = {
  linear: '<svg class="kfg-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 14 L14 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  easeInOut: '<svg class="kfg-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 14 C 8 14, 8 2, 14 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
};

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
        Z <b>${kf.zoom.toFixed(1)}</b>
      </div>
    `;
    tile.addEventListener('click', () => selectKeyframe(kf.id));
    list.appendChild(tile);

    if (i < state.keyframes.length - 1) {
      const gap = document.createElement('div');
      gap.className = 'kf-gap';
      const easing = (kf.easing === 'linear') ? 'linear' : 'easeInOut';
      gap.innerHTML = `
        <input class="kfg-dur" type="number" min="0" step="0.1" value="${kf.duration}" title="Duration to next (s)">
        <span class="kfg-unit">s</span>
        <button class="kfg-ease" title="Click to toggle easing">${EASE_ICONS[easing]}</button>
      `;
      const durIn = gap.querySelector('.kfg-dur');
      durIn.addEventListener('input', () => {
        const v = parseFloat(durIn.value);
        if (isFinite(v) && v >= 0) {
          kf.duration = v;
          document.getElementById('time-total').textContent = totalDuration(state.keyframes).toFixed(1);
          saveLayers();
        }
      });
      durIn.addEventListener('keydown', e => e.stopPropagation());
      const easeBtn = gap.querySelector('.kfg-ease');
      easeBtn.addEventListener('click', e => {
        e.stopPropagation();
        kf.easing = (kf.easing === 'linear') ? 'easeInOut' : 'linear';
        easeBtn.innerHTML = EASE_ICONS[kf.easing === 'linear' ? 'linear' : 'easeInOut'];
        saveLayers();
      });
      list.appendChild(gap);
    }
  });

  document.getElementById('time-total').textContent = totalDuration(state.keyframes).toFixed(1);
}

function renderEditor() {
  // Editor was merged into the top control row — Update/Delete buttons now
  // act on the currently-selected keyframe directly. Toggle their disabled
  // state to make it clear when nothing is selected.
  const hasSelection = !!state.selectedId && !!state.keyframes.find(k => k.id === state.selectedId);
  const update = document.getElementById('kf-update-view');
  const del = document.getElementById('kf-delete');
  if (update) update.disabled = !hasSelection;
  if (del) del.disabled = !hasSelection;
}

function updateTimeDisplay(t) {
  document.getElementById('time-cur').textContent = t.toFixed(1);
}

// ─── Wiring ───

document.getElementById('add-kf').addEventListener('click', addKeyframe);
document.getElementById('play-btn').addEventListener('click', () => state.playing ? stop() : play());
document.getElementById('reset-btn').addEventListener('click', reset);

// Duration + easing now edited inline between keyframe boxes (see renderKeyframes).
// Route progress is set per-route layer via the DRAW slider in the layers panel.
function updateSelectedKeyframe() {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (!kf) return;
  Object.assign(kf, captureView());
  kf.progress = state.previewProgress;
  kf.shapes = captureShapesForKeyframe();
  kf.overlays = captureOverlaysForKeyframe();
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

// ─── BORDERS hub UI ───

const bordersHub = document.getElementById('borders-hub');

document.getElementById('borders-btn').addEventListener('click', () => {
  const opening = bordersHub.classList.contains('hidden');
  bordersHub.classList.toggle('hidden');
  if (opening) syncBordersHub();
});
document.getElementById('bh-close').addEventListener('click', () => bordersHub.classList.add('hidden'));

function bhInputs(key) {
  const p = key === 'primary' ? 'bh1' : 'bh2';
  return {
    on: document.getElementById(`${p}-on`),
    color: document.getElementById(`${p}-color`),
    width: document.getElementById(`${p}-width`),
    widthVal: document.getElementById(`${p}-width-val`),
    opacity: document.getElementById(`${p}-opacity`),
    opacityVal: document.getElementById(`${p}-opacity-val`),
    dashed: document.getElementById(`${p}-dashed`),
  };
}

function syncBordersHub() {
  for (const key of ['primary', 'secondary']) {
    const s = state.borders[key];
    const el = bhInputs(key);
    el.on.checked = s.on;
    el.color.value = s.color;
    el.width.value = s.width;
    el.widthVal.value = s.width;
    el.opacity.value = Math.round(s.opacity * 100);
    el.opacityVal.value = Math.round(s.opacity * 100);
    el.dashed.checked = s.dashed;
  }
}

function wireBordersLayer(key) {
  const el = bhInputs(key);
  const upd = (mut) => {
    mut(state.borders[key]);
    ensureBordersOnMap();
    saveLayers();
  };
  el.on.addEventListener('change', () => upd(s => { s.on = el.on.checked; }));
  el.color.addEventListener('input', () => upd(s => { s.color = el.color.value; }));
  el.width.addEventListener('input', () => {
    el.widthVal.value = el.width.value;
    upd(s => { s.width = parseFloat(el.width.value); });
  });
  el.widthVal.addEventListener('change', () => {
    el.width.value = el.widthVal.value;
    const n = parseFloat(el.widthVal.value);
    upd(s => { s.width = Number.isFinite(n) ? n : 1; });
  });
  el.opacity.addEventListener('input', () => {
    el.opacityVal.value = el.opacity.value;
    upd(s => { s.opacity = parseInt(el.opacity.value, 10) / 100; });
  });
  el.opacityVal.addEventListener('change', () => {
    el.opacity.value = el.opacityVal.value;
    upd(s => { s.opacity = (parseInt(el.opacityVal.value, 10) || 0) / 100; });
  });
  el.dashed.addEventListener('change', () => upd(s => { s.dashed = el.dashed.checked; }));
}
wireBordersLayer('primary');
wireBordersLayer('secondary');

document.getElementById('kf-update-view').addEventListener('click', updateSelectedKeyframe);
document.getElementById('kf-delete').addEventListener('click', () => {
  if (state.selectedId) deleteKeyframe(state.selectedId);
});

// ─── Layers (KML/KMZ) ───

const LAYERS_LS_KEY = 'mapkeys_layers_v1';

// The full editor snapshot — what a project IS. Same shape the legacy
// mapkeys_layers_v1 key stored, plus the camera so reopening a project puts
// you exactly where you left it.
function getProjectSnapshot() {
  const c = map.getCenter();
  return {
    layers: state.layers.map(l => ({
      id: l.id,
      name: l.name,
      coords: l.coords,
      style: l.style,
      visible: l.visible,
    })),
    activeLayerId: state.activeLayerId,
    shapes: state.shapes.map(serializeShape),
    activeShapeId: state.activeShapeId,
    keyframes: state.keyframes,
    overlays: state.overlays.map(serializeOverlay),
    borders: {
      primary: { ...state.borders.primary },
      secondary: { ...state.borders.secondary },
    },
    frame169: !!state.frame169,
    frameGuides: !!state.frameGuides,
    camera: {
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    },
  };
}

function saveLayers() {
  if (suppressAutosave) return;
  try {
    const snap = getProjectSnapshot();
    if (currentProject) {
      writeStateCache(currentProject.id, snap);
      scheduleCloudSave();
    } else {
      // No project open (shouldn't happen once the library owns routing) —
      // fall back to the legacy single-map key so nothing is ever dropped.
      localStorage.setItem(LAYERS_LS_KEY, JSON.stringify(snap));
    }
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
    label: s.label,
    baseCoords: s.baseCoords,
    countryId: s.countryId,
    countryName: s.countryName,
    excludedPolygonIndices: Array.isArray(s.excludedPolygonIndices) ? s.excludedPolygonIndices.slice() : [],
    customGeometry: s.customGeometry || null,
    center: s.center,
    dotSize: s.dotSize,
    labelSize: s.labelSize,
    stroke: s.stroke,
    fill: s.fill,
    strokeWidth: s.strokeWidth,
    fillOpacity: s.fillOpacity,
    visible: s.visible,
    preview: s.preview,
  };
}

function serializeOverlay(o) {
  return {
    id: o.id, name: o.name, kind: o.kind, source: o.source, tiles: o.tiles,
    opacity: o.opacity, visible: o.visible, bounds: o.bounds,
    feather: o.feather ? { ...o.feather } : null,
  };
}

function hydrateOverlay(raw) {
  if (!raw || !raw.id || typeof raw.tiles !== 'string') return null;
  const f = raw.feather;
  return {
    id: raw.id,
    name: raw.name || 'Old map',
    kind: raw.kind === 'xyz' ? 'xyz' : 'allmaps',
    source: raw.source || raw.tiles,
    tiles: raw.tiles,
    opacity: typeof raw.opacity === 'number' ? raw.opacity : 1,
    visible: raw.visible !== false,
    bounds: Array.isArray(raw.bounds) ? raw.bounds : null,
    feather: {
      ...DEFAULT_FEATHER,
      ...(f && typeof f === 'object' ? {
        on: f.on === true && Array.isArray(f.rect),
        rect: Array.isArray(f.rect) ? f.rect : null,
        crop: typeof f.crop === 'number' ? f.crop : DEFAULT_FEATHER.crop,
        width: typeof f.width === 'number' ? f.width : DEFAULT_FEATHER.width,
      } : {}),
    },
  };
}

function hydrateShape(raw) {
  if (!raw || !raw.type || !raw.id) return null;
  const baseName =
    raw.type === 'polygon' ? 'Polygon' :
    raw.type === 'line'    ? 'Line' :
    raw.type === 'place'   ? 'Place' :
    raw.type === 'country' ? (raw.countryName || 'Country') :
                             'Shape';
  const base = {
    id: raw.id,
    type: raw.type,
    name: raw.name || baseName,
    sides: clampSides(raw.sides),
    label: typeof raw.label === 'string' ? raw.label : '',
    baseCoords: Array.isArray(raw.baseCoords) ? raw.baseCoords : [],
    countryId: raw.countryId,
    countryName: raw.countryName,
    excludedPolygonIndices: Array.isArray(raw.excludedPolygonIndices) ? raw.excludedPolygonIndices.slice() : [],
    customGeometry: raw.customGeometry && (raw.customGeometry.type === 'Polygon' || raw.customGeometry.type === 'MultiPolygon')
      ? raw.customGeometry
      : null,
    stroke: raw.stroke || SHAPE_DEFAULTS.stroke,
    fill: raw.fill || SHAPE_DEFAULTS.fill,
    strokeWidth: typeof raw.strokeWidth === 'number' ? raw.strokeWidth : SHAPE_DEFAULTS.strokeWidth,
    fillOpacity: typeof raw.fillOpacity === 'number' ? raw.fillOpacity : SHAPE_DEFAULTS.fillOpacity,
    visible: raw.visible !== false,
    preview: raw.preview || (raw.type === 'country' ? {} : defaultShapePreview(raw.type, [0, 0])),
    center: Array.isArray(raw.center) && raw.center.length === 2 ? [raw.center[0], raw.center[1]] : null,
    dotSize: typeof raw.dotSize === 'number' ? raw.dotSize : 6,
    labelSize: typeof raw.labelSize === 'number' ? raw.labelSize : 14,
  };
  if (base.type === 'line' && base.baseCoords.length < 2) return null;
  if (base.type === 'place' && !base.center) return null;
  if (base.type === 'country') {
    // Resolve geometry now so subsequent renders just read from _geometry.
    resolveCountryGeometry(base);
    if (!base._geometry) return null;
  }
  return base;
}

// Hydrate a project snapshot (or the legacy localStorage blob — same shape)
// into the live state object. Pure state mutation: attaching to the map and
// re-rendering panels is the caller's job (applyProjectSnapshot / style.load).
function hydrateSnapshotIntoState(parsed) {
  state.layers = (Array.isArray(parsed.layers) ? parsed.layers : [])
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

  state.shapes = (Array.isArray(parsed.shapes) ? parsed.shapes : []).map(hydrateShape).filter(Boolean);
  state.activeShapeId = parsed.activeShapeId || null;
  state.overlays = (Array.isArray(parsed.overlays) ? parsed.overlays : []).map(hydrateOverlay).filter(Boolean);
  state.borders = normalizeBorders(parsed.borders);
  state.frame169 = parsed.frame169 === true;
  state.frameGuides = parsed.frameGuides === true;

  state.keyframes = (Array.isArray(parsed.keyframes) ? parsed.keyframes : []).map(k => ({
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

function addLayerFromKML(file, coords) {
  snapshotForUndo('add layer');
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
  map.fitBounds(coordsBounds(layer.coords), { padding: 80, duration: 1000 });
  setRouteSources(state.previewProgress);
}

function duplicateLayer(id) {
  const orig = state.layers.find(l => l.id === id);
  if (!orig) return;
  snapshotForUndo('duplicate layer');
  const newId = 'lyr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const route = buildRoute(orig.coords.map(c => [c[0], c[1]]));
  const dup = {
    id: newId,
    name: orig.name + ' copy',
    coords: route.coords,
    cumDist: route.cumDist,
    totalDist: route.totalDist,
    style: { ...orig.style },
    visible: true,
  };
  state.layers.push(dup);
  state.activeLayerId = newId;
  ensureLayerOnMap(dup);
  setRouteSources(state.previewProgress);
  saveLayers();
  renderLayersPanel();
  syncRouteStyleInputs();
  showRouteUI();
}

function deleteLayer(id) {
  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;
  snapshotForUndo('delete layer');
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
  state.lastFocus = 'layer';
  // Clear shape focus so the shape-style panel hides.
  state.activeShapeId = null;
  saveLayers();
  renderLayersPanel();
  renderShapesPanel();
  syncRouteStyleInputs();
  showRouteUI();
}

function showRouteUI() {
  const panel = document.getElementById('layers-panel');
  const styleEl = document.getElementById('route-style');
  const drawBar = document.getElementById('draw-bar');
  const info = document.getElementById('route-info');
  const hasLayers = state.layers.length > 0;
  const hasShapes = state.shapes.length > 0;
  const hasOverlays = state.overlays.length > 0;
  panel.classList.toggle('hidden', !hasLayers && !hasShapes && !hasOverlays);
  drawBar.classList.toggle('hidden', !hasLayers);
  document.getElementById('layers-count').textContent = state.layers.length;
  document.getElementById('shapes-count').textContent = state.shapes.length;
  document.getElementById('oldmaps-count').textContent = state.overlays.length;
  document.getElementById('shapes-header').classList.toggle('hidden', !hasShapes);
  document.getElementById('shapes-divider').classList.toggle('hidden', !(hasLayers && hasShapes));
  document.getElementById('oldmaps-header').classList.toggle('hidden', !hasOverlays);
  document.getElementById('oldmaps-divider').classList.toggle('hidden', !(hasOverlays && (hasLayers || hasShapes)));
  if (hasLayers) {
    const a = activeLayer();
    info.textContent = a ? `${a.coords.length} pts · ${Math.round(a.totalDist)} km` : '';
  } else {
    info.textContent = '';
  }
  // Route-style panel only when a route is the current focus AND there's an active layer.
  const showRouteStyle = state.lastFocus === 'layer' && !!activeLayer();
  styleEl.classList.toggle('hidden', !showRouteStyle);
  // Shape style panel only when a shape is the current focus.
  const showShapeStyle = state.lastFocus === 'shape' && !!activeShape();
  document.getElementById('shape-style').classList.toggle('hidden', !showShapeStyle);
  updateSelectionIndicator();
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
        <div class="layer-name" title="${escHtml(layer.name)}">${escHtml(layer.name)}</div>
        <div class="layer-detail">${layer.coords.length} pts · ${Math.round(layer.totalDist)} km</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn layer-btn-fit" title="Fit to layer">⊕</button>
        <button class="layer-btn layer-btn-dup" title="Duplicate layer">⎘</button>
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
    row.querySelector('.layer-btn-dup').addEventListener('click', e => {
      e.stopPropagation();
      duplicateLayer(layer.id);
    });
    row.querySelector('.layer-btn-fit').addEventListener('click', e => {
      e.stopPropagation();
      map.fitBounds(coordsBounds(layer.coords), { padding: 80, duration: 800 });
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
  rsWidthVal.value = layer.style.width;
  rsOpacity.value = Math.round(layer.style.opacity * 100);
  rsOpacityVal.value = Math.round(layer.style.opacity * 100);
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
pairSliderNum(rsWidth, rsWidthVal, (v) => {
  mutateActiveLayerStyle(s => { s.width = v; });
});
pairSliderNum(rsOpacity, rsOpacityVal, (v) => {
  mutateActiveLayerStyle(s => { s.opacity = v / 100; });
});
rsDashed.addEventListener('change', e => mutateActiveLayerStyle(s => { s.dashed = e.target.checked; }));
rsTrail.addEventListener('change', e => mutateActiveLayerStyle(s => { s.trail = e.target.checked; }));

document.getElementById('rs-close').addEventListener('click', () => {
  state.lastFocus = null;
  showRouteUI();
});

// ─── Shape panel rendering ───

let draggedShapeId = null;

function renderShapesPanel() {
  const list = document.getElementById('shapes-list');
  list.innerHTML = '';
  if (state.shapes.length === 0) return;
  // state.shapes is already TOP-FIRST — row order == paint order.
  state.shapes.forEach((shape, displayIdx) => {
    const row = document.createElement('div');
    row.className = 'shape-row';
    row.draggable = true;
    if (shape.id === state.activeShapeId) row.classList.add('active');
    if (!shape.visible) row.classList.add('hidden-layer');
    const glyph =
      shape.type === 'polygon' ? '⬡' :
      shape.type === 'line'    ? '╱' :
      shape.type === 'place'   ? '◉' :
      shape.type === 'country' ? '◇' : '?';
    const stat =
      shape.type === 'polygon' ? `n=${shape.sides} · ${Math.round(shape.preview.radiusKm)} km` :
      shape.type === 'line'    ? `${shape.baseCoords.length} pts · scale ${shape.preview.scale.toFixed(2)}` :
      shape.type === 'place'   ? `dot ${shape.dotSize} · text ${shape.labelSize}` :
      shape.type === 'country' ? `α ${Math.round(shape.fillOpacity * 100)}% · sw ${shape.strokeWidth}` :
                                 '';
    row.innerHTML = `
      <span class="om-grip" title="Drag to reorder — top row paints on top">⠿</span>
      <input type="checkbox" class="layer-vis" ${shape.visible ? 'checked' : ''} title="Toggle visibility">
      <span class="shape-swatch" style="background:${shape.type === 'polygon' ? shape.fill : shape.stroke}; border-color:${shape.stroke};"></span>
      <span class="shape-glyph">${glyph}</span>
      <div class="layer-meta">
        <div class="layer-name" title="${escHtml(shape.name)}">${escHtml(shape.name)}</div>
        <div class="layer-detail">${stat}</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn shape-btn-fit" title="Fit to shape">⊕</button>
        <button class="layer-btn shape-btn-dup" title="Duplicate shape">⎘</button>
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
    row.querySelector('.shape-btn-dup').addEventListener('click', e => {
      e.stopPropagation();
      duplicateShape(shape.id);
    });
    row.querySelector('.shape-btn-fit').addEventListener('click', e => {
      e.stopPropagation();
      fitToShape(shape);
    });
    row.addEventListener('click', () => selectShape(shape.id));

    // ── drag to reorder (top row paints on top) ──
    row.addEventListener('dragstart', e => {
      draggedShapeId = shape.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', shape.id); } catch {}
    });
    row.addEventListener('dragend', () => {
      draggedShapeId = null;
      list.querySelectorAll('.drop-above, .drop-below').forEach(el =>
        el.classList.remove('drop-above', 'drop-below'));
      row.classList.remove('dragging');
    });
    row.addEventListener('dragover', e => {
      if (!draggedShapeId || draggedShapeId === shape.id) return;
      e.preventDefault();
      const above = e.offsetY < row.offsetHeight / 2;
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!draggedShapeId || draggedShapeId === shape.id) return;
      const above = e.offsetY < row.offsetHeight / 2;
      const fromIdx = state.shapes.findIndex(s => s.id === draggedShapeId);
      let target = displayIdx + (above ? 0 : 1);
      if (fromIdx < target) target -= 1; // removal shifts insertion point
      snapshotForUndo('reorder shape');
      reorderShapeByDisplay(draggedShapeId, target);
    });

    list.appendChild(row);
  });
}

// ─── Old-maps panel rendering ───
// Rows render TOP-FIRST (Photoshop order): the first row in the panel is the
// topmost layer on the globe. state.overlays stays bottom→top (map order).

let draggedOverlayId = null;

function reorderOverlayByDisplay(dragId, targetDisplayIdx) {
  const display = [...state.overlays].reverse();
  const from = display.findIndex(o => o.id === dragId);
  if (from === -1) return;
  const [moved] = display.splice(from, 1);
  display.splice(Math.max(0, Math.min(targetDisplayIdx, display.length)), 0, moved);
  state.overlays = display.reverse();
  applyOverlayOrder();
  saveLayers();
  renderOverlaysPanel();
}

function renderOverlaysPanel() {
  const list = document.getElementById('oldmaps-list');
  list.innerHTML = '';
  if (state.overlays.length === 0) return;
  const display = [...state.overlays].reverse();
  display.forEach((overlay, displayIdx) => {
    const f = overlay.feather || (overlay.feather = { ...DEFAULT_FEATHER });
    const row = document.createElement('div');
    row.className = 'layer-row oldmap-row';
    row.draggable = true;
    if (!overlay.visible) row.classList.add('hidden-layer');
    row.innerHTML = `
      <span class="om-grip" title="Drag to reorder — top row shows on top">⠿</span>
      <input type="checkbox" class="layer-vis" ${overlay.visible ? 'checked' : ''} title="Toggle visibility">
      <div class="layer-meta">
        <div class="layer-name" title="${escHtml(overlay.name)} — double-click to rename">${escHtml(overlay.name)}</div>
        <div class="oldmap-opacity">
          <input type="range" class="om-opacity" min="0" max="100" step="1" value="${Math.round(overlay.opacity * 100)}" title="Opacity">
          <span class="om-opacity-val">${Math.round(overlay.opacity * 100)}%</span>
        </div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn oldmap-btn-feather ${f.on ? 'is-on' : ''}" title="Feathered crop — fade the map's edges">✂</button>
        <button class="layer-btn oldmap-btn-fit" title="Fit to map">⊕</button>
        <button class="layer-btn oldmap-btn-del" title="Remove old map">×</button>
      </div>
    `;

    // ── drag to reorder ──
    row.addEventListener('dragstart', e => {
      draggedOverlayId = overlay.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', overlay.id); } catch {}
    });
    row.addEventListener('dragend', () => {
      draggedOverlayId = null;
      list.querySelectorAll('.drop-above, .drop-below').forEach(el =>
        el.classList.remove('drop-above', 'drop-below'));
      row.classList.remove('dragging');
    });
    row.addEventListener('dragover', e => {
      if (!draggedOverlayId || draggedOverlayId === overlay.id) return;
      e.preventDefault();
      const above = e.offsetY < row.offsetHeight / 2;
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!draggedOverlayId || draggedOverlayId === overlay.id) return;
      const above = e.offsetY < row.offsetHeight / 2;
      const dragDisplayIdx = display.findIndex(o => o.id === draggedOverlayId);
      let target = displayIdx + (above ? 0 : 1);
      if (dragDisplayIdx < target) target -= 1; // removal shifts insertion point
      reorderOverlayByDisplay(draggedOverlayId, target);
    });

    // ── rename on double-click ──
    const nameEl = row.querySelector('.layer-name');
    nameEl.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.className = 'om-rename';
      input.value = overlay.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (v) { overlay.name = v; saveLayers(); }
        renderOverlaysPanel();
      };
      input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { done = true; renderOverlaysPanel(); }
      });
      input.addEventListener('blur', commit);
    });

    row.querySelector('.layer-vis').addEventListener('click', e => {
      e.stopPropagation();
      setOverlayVisible(overlay.id, e.target.checked);
    });
    const slider = row.querySelector('.om-opacity');
    const sliderVal = row.querySelector('.om-opacity-val');
    slider.addEventListener('input', e => {
      overlay.opacity = parseInt(e.target.value, 10) / 100;
      sliderVal.textContent = e.target.value + '%';
      applyOverlayStyle(overlay);
    });
    slider.addEventListener('change', () => saveLayers());
    row.querySelector('.oldmap-btn-feather').addEventListener('click', e => {
      e.stopPropagation();
      toggleOverlayFeather(overlay);
    });
    row.querySelector('.oldmap-btn-fit').addEventListener('click', e => {
      e.stopPropagation();
      fitToOverlay(overlay);
    });
    row.querySelector('.oldmap-btn-del').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Remove "${overlay.name}"?`)) deleteOverlay(overlay.id);
    });
    list.appendChild(row);

    // ── feather controls (expanded under the row while ✂ is on) ──
    if (f.on) {
      const ctl = document.createElement('div');
      ctl.className = 'oldmap-feather-ctl';
      ctl.innerHTML = `
        <label class="omf-field"><span>Crop</span>
          <input type="range" class="omf-crop" min="0" max="45" step="1" value="${Math.round(f.crop * 100)}">
          <span class="omf-val omf-crop-val">${Math.round(f.crop * 100)}%</span>
        </label>
        <label class="omf-field"><span>Feather</span>
          <input type="range" class="omf-width" min="0" max="40" step="1" value="${Math.round(f.width * 100)}">
          <span class="omf-val omf-width-val">${Math.round(f.width * 100)}%</span>
        </label>
        <button class="btn ghost omf-setview" title="Use the current viewport as this map's crop frame">⌖ frame = view</button>
      `;
      const crop = ctl.querySelector('.omf-crop');
      crop.addEventListener('input', e => {
        ctl.querySelector('.omf-crop-val').textContent = e.target.value + '%';
        mutateOverlayFeather(overlay, ff => { ff.crop = parseInt(e.target.value, 10) / 100; });
      });
      const width = ctl.querySelector('.omf-width');
      width.addEventListener('input', e => {
        ctl.querySelector('.omf-width-val').textContent = e.target.value + '%';
        mutateOverlayFeather(overlay, ff => { ff.width = parseInt(e.target.value, 10) / 100; });
      });
      ctl.querySelector('.omf-setview').addEventListener('click', () => setOverlayFeatherRectToView(overlay));
      list.appendChild(ctl);
    }
  });
}

function fitToShape(shape) {
  let coords = [];
  if (shape.type === 'polygon') {
    coords = regularPolygonCoords(shape.preview.center, shape.sides, shape.preview.radiusKm, shape.preview.rotation);
  } else if (shape.type === 'line') {
    coords = transformLineCoords(shape.baseCoords, shape.preview.offsetLng, shape.preview.offsetLat, shape.preview.scale);
  } else if (shape.type === 'country') {
    const geom = resolveCountryGeometry(shape);
    if (!geom) return;
    const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    for (const ring of rings) coords = coords.concat(ring);
  } else if (shape.type === 'place') {
    map.easeTo({ center: placePosition(shape), zoom: Math.max(map.getZoom(), 5.5), duration: 800 });
    return;
  }
  if (coords.length === 0) return;
  map.fitBounds(coordsBounds(coords), { padding: 120, duration: 800 });
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
const ssDot = document.getElementById('ss-dot');
const ssDotVal = document.getElementById('ss-dot-val');
const ssDotField = document.getElementById('ss-dot-field');
const ssLabelSize = document.getElementById('ss-label-size');
const ssLabelSizeVal = document.getElementById('ss-label-size-val');
const ssLabelSizeField = document.getElementById('ss-label-size-field');
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
  ssStrokeWVal.value = shape.strokeWidth;
  reconfigureSlidersFor(shape);

  // "Edit parts" button is country-only.
  const editBtn = document.getElementById('ss-edit-country');
  if (editBtn) editBtn.classList.toggle('hidden', shape.type !== 'country');

  const suffix = document.getElementById('ss-scale-suffix');
  if (shape.type === 'country') {
    ssFill.value = shape.fill;
    ssFillOpacity.value = Math.round(shape.fillOpacity * 100);
    ssFillOpacityVal.value = Math.round(shape.fillOpacity * 100);
    ssFillOpacityField.classList.remove('hidden');
    ssSidesField.classList.add('hidden');
    ssScaleField.classList.add('hidden');
    ssRotationField.classList.add('hidden');
    ssDrawField.classList.add('hidden');
  } else if (shape.type === 'polygon') {
    ssFill.value = shape.fill;
    ssFillOpacity.value = Math.round(shape.fillOpacity * 100);
    ssFillOpacityVal.value = Math.round(shape.fillOpacity * 100);
    ssSides.value = shape.sides;
    ssScale.value = Math.round(shape.preview.radiusKm);
    ssScaleVal.value = Math.round(shape.preview.radiusKm);
    if (suffix) suffix.textContent = ' km';
    ssRotation.value = Math.round(shape.preview.rotation);
    ssRotationVal.value = Math.round(shape.preview.rotation);
    ssFillOpacityField.classList.remove('hidden');
    ssSidesField.classList.remove('hidden');
    ssScaleField.classList.remove('hidden');
    ssRotationField.classList.remove('hidden');
    ssDrawField.classList.add('hidden');
  } else if (shape.type === 'place') {
    ssScale.value = Math.round(shape.preview.scale * 100);
    ssScaleVal.value = Math.round(shape.preview.scale * 100);
    if (suffix) suffix.textContent = '%';
    ssDot.value = shape.dotSize;
    ssDotVal.value = shape.dotSize;
    ssLabelSize.value = shape.labelSize;
    ssLabelSizeVal.value = shape.labelSize;
    ssFillOpacityField.classList.add('hidden');
    ssSidesField.classList.add('hidden');
    ssScaleField.classList.remove('hidden');
    ssRotationField.classList.add('hidden');
    ssDrawField.classList.add('hidden');
  } else {
    ssScale.value = Math.round(shape.preview.scale * 100);
    ssScaleVal.value = Math.round(shape.preview.scale * 100);
    if (suffix) suffix.textContent = '%';
    ssDraw.value = Math.round(shape.preview.drawProgress * 1000);
    ssDrawVal.value = (shape.preview.drawProgress * 100).toFixed(1).replace(/\.0$/, '');
    ssFillOpacityField.classList.add('hidden');
    ssSidesField.classList.add('hidden');
    ssScaleField.classList.remove('hidden');
    ssRotationField.classList.add('hidden');
    ssDrawField.classList.remove('hidden');
  }
  ssDotField.classList.toggle('hidden', shape.type !== 'place');
  ssLabelSizeField.classList.toggle('hidden', shape.type !== 'place');
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

// Bidirectional pair: slider ↔ number input. `numToSliderRatio` is multiplied
// by num to get slider value (used by ss-draw where slider is 0-1000 and num
// is 0-100).
function pairSliderNum(slider, num, onCommit, opts = {}) {
  const numToSlider = opts.numToSlider || ((v) => v);
  const sliderToNum = opts.sliderToNum || ((v) => v);
  slider.addEventListener('input', () => {
    const sv = parseFloat(slider.value);
    num.value = sliderToNum(sv);
    onCommit(sv);
  });
  num.addEventListener('input', () => {
    const nv = parseFloat(num.value);
    if (!isFinite(nv)) return;
    const sv = numToSlider(nv);
    const lo = slider.min !== '' ? parseFloat(slider.min) : -Infinity;
    const hi = slider.max !== '' ? parseFloat(slider.max) : Infinity;
    const clamped = Math.max(lo, Math.min(hi, sv));
    slider.value = String(clamped);
    onCommit(clamped);
  });
}

ssStroke.addEventListener('input', e => mutateActiveShape(s => { s.stroke = e.target.value; }));
ssFill.addEventListener('input', e => mutateActiveShape(s => { s.fill = e.target.value; }));

pairSliderNum(ssFillOpacity, ssFillOpacityVal, (v) => {
  mutateActiveShape(s => { s.fillOpacity = v / 100; });
});
pairSliderNum(ssStrokeW, ssStrokeWVal, (v) => {
  mutateActiveShape(s => { s.strokeWidth = v; });
});
pairSliderNum(ssDot, ssDotVal, (v) => {
  mutateActiveShape(s => { if (s.type === 'place') s.dotSize = v; });
});
pairSliderNum(ssLabelSize, ssLabelSizeVal, (v) => {
  mutateActiveShape(s => { if (s.type === 'place') s.labelSize = v; });
});
ssSides.addEventListener('input', e => {
  const n = Math.max(3, Math.min(24, parseInt(e.target.value, 10) || 8));
  mutateActiveShape(s => { if (s.type === 'polygon') s.sides = n; });
});
pairSliderNum(ssScale, ssScaleVal, (v) => {
  mutateActiveShape(s => {
    if (s.type === 'polygon') s.preview.radiusKm = v;
    else s.preview.scale = v / 100;
  });
});
pairSliderNum(ssRotation, ssRotationVal, (v) => {
  mutateActiveShape(s => { if (s.type === 'polygon') s.preview.rotation = v; });
});
// ss-draw: slider 0-1000 (fine resolution), num 0-100 (percent).
pairSliderNum(ssDraw, ssDrawVal, (sv) => {
  const progress = sv / 1000;
  mutateActiveShape(s => { if (s.type === 'line') s.preview.drawProgress = progress; });
}, {
  numToSlider: (n) => n * 10,    // 0-100 → 0-1000
  sliderToNum: (s) => +(s / 10).toFixed(1),
});
ssDelete.addEventListener('click', () => {
  const shape = activeShape();
  if (!shape) return;
  if (confirm(`Delete "${shape.name}"?`)) deleteShape(shape.id);
});

document.getElementById('ss-edit-country').addEventListener('click', () => {
  const shape = activeShape();
  if (shape && shape.type === 'country') startCountryEdit(shape);
});
document.getElementById('ce-done').addEventListener('click', exitCountryEdit);
document.getElementById('ce-reset').addEventListener('click', () => {
  const id = state.editingShapeId;
  if (!id) return;
  const shape = state.shapes.find(s => s.id === id);
  if (!shape) return;
  if (!shape.customGeometry) return;
  if (!confirm(`Discard all vertex edits to "${shape.name}"?`)) return;
  shape.customGeometry = null;
  updateCountryEditOverlay(shape);
  redrawShape(shape);
  saveLayers();
});

document.getElementById('ss-close').addEventListener('click', () => {
  state.activeShapeId = null;
  renderShapesPanel();
  syncShapeStyleInputs();
  showRouteUI();
});

// ─── Add-shape buttons ───

document.getElementById('add-octagon-btn').addEventListener('click', () => {
  if (state.drawingLine) cancelLineDrawing();
  addOctagon();
});

// ─── Country picker ───
const cpModal = document.getElementById('country-picker');
const cpSearch = document.getElementById('cp-search');
const cpList = document.getElementById('cp-list');

function openCountryPicker() {
  cpModal.classList.remove('hidden');
  cpSearch.value = '';
  renderCountryPickerList('');
  setTimeout(() => cpSearch.focus(), 0);
}

function closeCountryPicker() {
  cpModal.classList.add('hidden');
}

function renderCountryPickerList(query) {
  const matches = searchCountries(query);
  cpList.innerHTML = '';
  matches.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cp-row' + (i === 0 ? ' cp-active' : '');
    row.textContent = c.name;
    row.dataset.id = c.id;
    row.addEventListener('click', () => {
      addCountry(c);
      closeCountryPicker();
    });
    cpList.appendChild(row);
  });
}

document.getElementById('add-country-btn').addEventListener('click', openCountryPicker);

cpSearch.addEventListener('input', () => renderCountryPickerList(cpSearch.value));
cpSearch.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); closeCountryPicker(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const active = cpList.querySelector('.cp-row.cp-active') || cpList.querySelector('.cp-row');
    if (active) active.click();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = Array.from(cpList.querySelectorAll('.cp-row'));
    if (rows.length === 0) return;
    let idx = rows.findIndex(r => r.classList.contains('cp-active'));
    rows.forEach(r => r.classList.remove('cp-active'));
    if (e.key === 'ArrowDown') idx = Math.min(rows.length - 1, idx + 1);
    else idx = Math.max(0, idx - 1);
    rows[idx].classList.add('cp-active');
    rows[idx].scrollIntoView({ block: 'nearest' });
  }
});

cpModal.addEventListener('click', (e) => {
  if (e.target === cpModal) closeCountryPicker();
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
    .filter(s => s.type === 'polygon' || s.type === 'country')
    .map(s => shapeSourceIds(s.id).fillLayer)
    .filter(id => map.getLayer(id));
}
function shapeLineLayerIds() {
  return state.shapes
    .map(s => shapeSourceIds(s.id).lineLayer)
    .filter(id => map.getLayer(id));
}

function placeLayerIds() {
  // Both the dot AND the label are click targets for a place.
  return state.shapes
    .filter(s => s.type === 'place')
    .flatMap(s => {
      const ids = shapeSourceIds(s.id);
      return [ids.fillLayer, ids.labelLayer];
    })
    .filter(id => map.getLayer(id));
}

function findShapeAtPoint(point) {
  const fills = shapeFillLayerIds();
  const lines = shapeLineLayerIds();
  const places = placeLayerIds();
  const all = [...places, ...fills, ...lines];
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
    if (ids.fillLayer === layerId || ids.lineLayer === layerId || ids.labelLayer === layerId) return s;
  }
  return null;
}

// KML route hit-testing — returns the route layer under the cursor, if any.
function findRouteLayerAtPoint(point) {
  const lineIds = state.layers
    .filter(l => l.visible)
    .flatMap(l => {
      const ids = layerSourceIds(l.id);
      const out = [];
      if (map.getLayer(ids.drawnLine)) out.push(ids.drawnLine);
      if (l.style.trail && map.getLayer(ids.fullLine)) out.push(ids.fullLine);
      return out;
    });
  if (lineIds.length === 0) return null;
  const bbox = [
    [point.x - 8, point.y - 8],
    [point.x + 8, point.y + 8],
  ];
  const features = map.queryRenderedFeatures(bbox, { layers: lineIds });
  if (!features.length) return null;
  const layerId = features[0].layer.id;
  for (const l of state.layers) {
    const ids = layerSourceIds(l.id);
    if (ids.drawnLine === layerId || ids.fullLine === layerId) return l;
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
  // Country edit mode — vertex/edge ops, then fall through to part-toggle
  if (state.editingShapeId) {
    const shape = state.shapes.find(s => s.id === state.editingShapeId);
    if (!shape) return;

    // Alt+click on a vertex → delete it (drag handled in mousedown)
    if (e.originalEvent && e.originalEvent.altKey) {
      const vhits = map.queryRenderedFeatures(e.point, { layers: [CE_VERT] });
      if (vhits.length) {
        const { polyIdx, ringIdx, vertIdx } = vhits[0].properties;
        const geom = ensureCustomGeometry(shape);
        const ring = geom.coordinates[polyIdx][ringIdx];
        // Need at least 4 points (3 unique + closing duplicate) to stay valid
        if (ring.length <= 4) return;
        ring.splice(vertIdx, 1);
        // If we removed the first vertex, mirror new first into the closing slot
        if (vertIdx === 0) ring[ring.length - 1] = ring[0].slice();
        updateCountryEditOverlay(shape);
        redrawShape(shape);
        saveLayers();
        return;
      }
    }

    // Shift+click on or near an edge → insert a new vertex at the click point
    if (e.originalEvent && e.originalEvent.shiftKey) {
      const hit = findNearestEdgeForInsertion(shape, e.point);
      if (hit) {
        const geom = ensureCustomGeometry(shape);
        const ring = geom.coordinates[hit.polyIdx][hit.ringIdx];
        ring.splice(hit.vertIdx, 0, [e.lngLat.lng, e.lngLat.lat]);
        updateCountryEditOverlay(shape);
        redrawShape(shape);
        saveLayers();
        return;
      }
    }

    // Otherwise: clicking a vertex is a no-op (drag handles move), and
    // clicking the polygon body toggles part exclusion as before.
    const vhits = map.queryRenderedFeatures(e.point, { layers: [CE_VERT] });
    if (vhits.length) return;
    const features = map.queryRenderedFeatures(e.point, { layers: [CE_FILL] });
    if (features.length) {
      const idx = features[0].properties.idx;
      const set = new Set(shape.excludedPolygonIndices || []);
      if (set.has(idx)) set.delete(idx); else set.add(idx);
      shape.excludedPolygonIndices = Array.from(set).sort((a, b) => a - b);
      updateCountryEditOverlay(shape);
      redrawShape(shape);
      updateSelectionIndicator();
      saveLayers();
    }
    return;
  }
  // Selection priority: shapes (top), then routes
  const shapeHit = findShapeAtPoint(e.point);
  if (shapeHit) {
    selectShape(shapeHit.id);
    return;
  }
  const routeHit = findRouteLayerAtPoint(e.point);
  if (routeHit) {
    selectLayer(routeHit.id);
    return;
  }
  // Click on empty map deselects
  if (state.activeShapeId || state.lastFocus === 'layer') {
    state.activeShapeId = null;
    state.lastFocus = null;
    renderShapesPanel();
    renderLayersPanel();
    syncShapeStyleInputs();
    showRouteUI();
  }
});

map.on('dblclick', (e) => {
  if (state.drawingLine) {
    finalizeLineDrawing();
    return;
  }
  // Double-click a polygon or place → open the inline label editor
  const hit = findShapeAtPoint(e.point);
  if (hit && (hit.type === 'polygon' || hit.type === 'place')) {
    e.preventDefault();
    openLabelEditor(hit);
  }
});

// Recompute polygon label sizes whenever the camera changes — keeps text
// visually fitted regardless of zoom or pitch.
map.on('zoom', refreshAllPolygonLabelSizes);
map.on('move', refreshAllPolygonLabelSizes);
map.on('pitch', refreshAllPolygonLabelSizes);

// ─── Inline polygon label editor ───

function openLabelEditor(shape) {
  closeLabelEditor();
  const overlay = document.createElement('input');
  overlay.type = 'text';
  overlay.id = 'shape-label-edit';
  overlay.value = shape.label || '';
  overlay.placeholder = 'label';
  overlay.dataset.shapeId = shape.id;
  document.body.appendChild(overlay);

  const placeOverlay = () => {
    if (shape.type === 'place') {
      const cp = map.project(placePosition(shape));
      overlay.style.left = `${cp.x - 90}px`;
      overlay.style.top = `${cp.y - 46}px`;
      overlay.style.width = '180px';
      return;
    }
    const cp = map.project(shape.preview.center);
    const dLatDeg = shape.preview.radiusKm / KM_PER_DEG_LAT;
    const ep = map.project([shape.preview.center[0], shape.preview.center[1] + dLatDeg]);
    const radiusPx = Math.max(40, Math.hypot(cp.x - ep.x, cp.y - ep.y));
    overlay.style.left = `${cp.x - radiusPx}px`;
    overlay.style.top = `${cp.y - 14}px`;
    overlay.style.width = `${radiusPx * 2}px`;
  };
  placeOverlay();
  const reposition = () => placeOverlay();
  map.on('move', reposition);
  map.on('zoom', reposition);
  overlay._reposition = reposition;
  // Hide the rendered label while editing so it doesn't sit behind the input
  const ids = shapeSourceIds(shape.id);
  if (map.getLayer(ids.labelLayer)) {
    map.setLayoutProperty(ids.labelLayer, 'visibility', 'none');
  }

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    shape.label = overlay.value.trim();
    redrawShape(shape);
    if (map.getLayer(ids.labelLayer)) {
      map.setLayoutProperty(ids.labelLayer, 'visibility', shape.visible ? 'visible' : 'none');
    }
    saveLayers();
    closeLabelEditor();
  };
  const cancel = () => {
    if (done) return;
    done = true;
    if (map.getLayer(ids.labelLayer)) {
      map.setLayoutProperty(ids.labelLayer, 'visibility', shape.visible ? 'visible' : 'none');
    }
    closeLabelEditor();
  };
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  overlay.addEventListener('blur', commit);
  setTimeout(() => {
    overlay.focus();
    overlay.select();
  }, 0);
}

function closeLabelEditor() {
  const overlay = document.getElementById('shape-label-edit');
  if (!overlay) return;
  if (overlay._reposition) {
    map.off('move', overlay._reposition);
    map.off('zoom', overlay._reposition);
  }
  if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

// ─── Place search (Mapbox geocoder → navigate + temp pin, or ✎ → place shape) ───

const SEARCH_PIN_SRC = 'mk-search-pin-src';
const SEARCH_PIN_DOT = 'mk-search-pin-dot';
const SEARCH_PIN_LABEL = 'mk-search-pin-label';

const psInput = document.getElementById('place-search');
const psResults = document.getElementById('place-search-results');
let psFeatures = [];
let psHighlight = 0;
let psAbort = null;
let psTimer = null;

function ensureSearchPinLayers() {
  try {
    if (!map.getSource(SEARCH_PIN_SRC)) {
      map.addSource(SEARCH_PIN_SRC, { type: 'geojson', data: emptyFC() });
    }
    if (!map.getLayer(SEARCH_PIN_DOT)) {
      map.addLayer({
        id: SEARCH_PIN_DOT,
        type: 'circle',
        source: SEARCH_PIN_SRC,
        paint: {
          'circle-radius': 7,
          'circle-color': '#b85c3c',
          'circle-stroke-color': '#fffaf0',
          'circle-stroke-width': 2,
        },
      });
    }
    if (!map.getLayer(SEARCH_PIN_LABEL)) {
      map.addLayer({
        id: SEARCH_PIN_LABEL,
        type: 'symbol',
        source: SEARCH_PIN_SRC,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 14,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.9],
        },
        paint: {
          'text-color': '#b85c3c',
          'text-halo-color': '#fffaf0',
          'text-halo-width': 1.4,
        },
      });
    }
  } catch (_) {}
}

function showSearchPin(r) {
  ensureSearchPinLayers();
  const src = map.getSource(SEARCH_PIN_SRC);
  if (!src) return;
  src.setData({
    type: 'Feature',
    properties: { label: r.name },
    geometry: { type: 'Point', coordinates: r.center },
  });
}

function clearSearchPin() {
  const src = map.getSource(SEARCH_PIN_SRC);
  if (src) src.setData(emptyFC());
}

async function geocodePlaces(q) {
  if (psAbort) psAbort.abort();
  psAbort = new AbortController();
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`
    + `?access_token=${mapboxgl.accessToken}&types=country,region,place,locality&limit=6&language=en`;
  const res = await fetch(url, { signal: psAbort.signal });
  if (!res || !res.ok) return [];
  const json = await res.json().catch(() => null);
  return ((json && json.features) || []).map(f => ({
    name: f.text,
    context: (f.place_name || '').replace(`${f.text}, `, ''),
    center: f.center,
    kind: (f.place_type && f.place_type[0]) || 'place',
  }));
}

function searchZoomFor(kind) {
  return kind === 'country' ? 3.8 : kind === 'region' ? 5.2 : kind === 'locality' ? 9 : 7.2;
}

function navigateToResult(r) {
  showSearchPin(r);
  map.flyTo({ center: r.center, zoom: Math.max(map.getZoom(), searchZoomFor(r.kind)), duration: 1500 });
}

function closeSearchResults() {
  psResults.classList.add('hidden');
  psResults.innerHTML = '';
}

function renderSearchResults() {
  psResults.innerHTML = '';
  if (!psFeatures.length) { closeSearchResults(); return; }
  psResults.classList.remove('hidden');
  psFeatures.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'ps-row' + (i === psHighlight ? ' active' : '');
    row.innerHTML = `
      <div class="ps-meta">
        <div class="ps-name">${escHtml(r.name)}</div>
        <div class="ps-context">${escHtml(r.context)}</div>
      </div>
      <button class="ps-pin" title="Add as a place layer (dot + label)">✎</button>
    `;
    row.addEventListener('click', () => {
      psHighlight = i;
      navigateToResult(r);
      closeSearchResults();
    });
    row.querySelector('.ps-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      clearSearchPin();
      addPlace(r);
      map.flyTo({ center: r.center, zoom: Math.max(map.getZoom(), searchZoomFor(r.kind)), duration: 1200 });
      closeSearchResults();
      psInput.value = '';
      psInput.blur();
    });
    psResults.appendChild(row);
  });
}

psInput.addEventListener('input', () => {
  const q = psInput.value.trim();
  clearTimeout(psTimer);
  if (!q) { psFeatures = []; closeSearchResults(); clearSearchPin(); return; }
  psTimer = setTimeout(async () => {
    try {
      psFeatures = await geocodePlaces(q);
      psHighlight = 0;
      renderSearchResults();
    } catch (err) {
      if (err && err.name !== 'AbortError') console.warn('[mapkeys] geocode failed:', err.message);
    }
  }, 250);
});

psInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'ArrowDown' && psFeatures.length) {
    e.preventDefault();
    psHighlight = (psHighlight + 1) % psFeatures.length;
    renderSearchResults();
  } else if (e.key === 'ArrowUp' && psFeatures.length) {
    e.preventDefault();
    psHighlight = (psHighlight - 1 + psFeatures.length) % psFeatures.length;
    renderSearchResults();
  } else if (e.key === 'Enter' && psFeatures.length) {
    e.preventDefault();
    navigateToResult(psFeatures[psHighlight]);
    closeSearchResults();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSearchResults();
    clearSearchPin();
    psInput.value = '';
    psInput.blur();
  }
});

// Click anywhere else closes the results dropdown.
document.addEventListener('click', (e) => {
  if (!psResults.classList.contains('hidden')
      && !e.target.closest('#place-search-wrap')) {
    closeSearchResults();
  }
});

// Hover cursor over selectable shapes / routes (and vertices in edit mode)
map.on('mousemove', (e) => {
  if (state.drawingLine || state.draggingShape || state.draggingVertex) return;
  if (state.editingShapeId) {
    const vhits = map.queryRenderedFeatures(e.point, { layers: [CE_VERT] });
    if (vhits.length) {
      const ev = e.originalEvent;
      map.getCanvas().style.cursor = ev && ev.altKey ? 'crosshair' : 'move';
      return;
    }
    if (e.originalEvent && e.originalEvent.shiftKey) {
      const shape = state.shapes.find(s => s.id === state.editingShapeId);
      if (shape) {
        const near = findNearestEdgeForInsertion(shape, e.point);
        map.getCanvas().style.cursor = near ? 'copy' : '';
        return;
      }
    }
    const fillHits = map.queryRenderedFeatures(e.point, { layers: [CE_FILL] });
    map.getCanvas().style.cursor = fillHits.length ? 'pointer' : '';
    return;
  }
  const hit = findShapeAtPoint(e.point) || findRouteLayerAtPoint(e.point);
  map.getCanvas().style.cursor = hit ? 'pointer' : '';
});

// ─── Shape dragging ───

map.on('mousedown', (e) => {
  if (state.drawingLine) return;

  // In country-edit mode: mousedown on a vertex starts a vertex drag.
  // Modifier keys (alt/shift) are routed by the click handler instead.
  if (state.editingShapeId && !(e.originalEvent && (e.originalEvent.altKey || e.originalEvent.shiftKey))) {
    const vhits = map.queryRenderedFeatures(e.point, { layers: [CE_VERT] });
    if (vhits.length) {
      const { polyIdx, ringIdx, vertIdx } = vhits[0].properties;
      e.preventDefault();
      state.draggingVertex = {
        shapeId: state.editingShapeId,
        polyIdx, ringIdx, vertIdx,
      };
      map.dragPan.disable();
      document.body.classList.add('dragging-shape');
      return;
    }
  }

  const hit = findShapeAtPoint(e.point);
  if (!hit) return;
  // Country shapes have fixed geometry — clicking just selects, drag still pans the map.
  if (hit.type === 'country') {
    selectShape(hit.id);
    return;
  }
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
  // Vertex drag in country-edit mode
  if (state.draggingVertex) {
    const dv = state.draggingVertex;
    const shape = state.shapes.find(s => s.id === dv.shapeId);
    if (!shape) return;
    const geom = ensureCustomGeometry(shape);
    if (!geom) return;
    const ring = geom.coordinates[dv.polyIdx][dv.ringIdx];
    const next = [e.lngLat.lng, e.lngLat.lat];
    ring[dv.vertIdx] = next;
    // Mirror first→last to keep the ring closed
    if (dv.vertIdx === 0) ring[ring.length - 1] = next.slice();
    updateCountryEditOverlay(shape);
    redrawShape(shape);
    return;
  }

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

function endVertexDrag() {
  if (!state.draggingVertex) return;
  state.draggingVertex = null;
  map.dragPan.enable();
  document.body.classList.remove('dragging-shape');
  saveLayers();
}

function endShapeDrag() {
  if (state.draggingVertex) endVertexDrag();
  if (!state.draggingShape) return;
  state.draggingShape = null;
  map.dragPan.enable();
  document.body.classList.remove('dragging-shape');
  saveLayers();
  renderShapesPanel();
  // Re-sync the selection ring to the shape's final position — mid-drag
  // updates can be skipped while the map style is mid-load.
  updateSelectionIndicator();
}
map.on('mouseup', endShapeDrag);
// Fallback: if the user releases outside the canvas, recover.
window.addEventListener('mouseup', endShapeDrag);

// Esc handles cancel-line + clear-selection
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.editingShapeId) {
      e.preventDefault();
      exitCountryEdit();
    } else if (state.drawingLine) {
      e.preventDefault();
      cancelLineDrawing();
    } else if (state.activeShapeId || state.lastFocus === 'layer') {
      state.activeShapeId = null;
      state.lastFocus = null;
      renderShapesPanel();
      renderLayersPanel();
      syncShapeStyleInputs();
      showRouteUI();
    }
  } else if ((e.key === 'Enter') && state.drawingLine) {
    e.preventDefault();
    finalizeLineDrawing();
  }
});

// ─── Skin toggle + old-map modal wiring ───

document.querySelectorAll('.skin-btn').forEach(btn => {
  btn.addEventListener('click', () => setSkin(btn.dataset.skin));
});

const omModal = document.getElementById('oldmap-picker');
const omInput = document.getElementById('om-url');
const omAdd = document.getElementById('om-add');
const omStatus = document.getElementById('om-status');

function openOldMapModal() {
  omModal.classList.remove('hidden');
  omStatus.textContent = '';
  omInput.value = '';
  omInput.focus();
}

function closeOldMapModal() {
  omModal.classList.add('hidden');
}

async function submitOldMap() {
  const raw = omInput.value;
  if (!raw.trim()) return;
  omAdd.disabled = true;
  omStatus.textContent = 'Loading map…';
  try {
    const overlay = await addOldMapFromInput(raw);
    omStatus.textContent = '';
    closeOldMapModal();
    console.info('[mapkeys] added old map:', overlay.name, overlay.tiles);
  } catch (err) {
    omStatus.textContent = err.message || 'Couldn’t load that map.';
  } finally {
    omAdd.disabled = false;
  }
}

document.getElementById('add-oldmap-btn').addEventListener('click', openOldMapModal);
document.getElementById('om-close').addEventListener('click', closeOldMapModal);
omModal.addEventListener('click', e => { if (e.target === omModal) closeOldMapModal(); });
omAdd.addEventListener('click', submitOldMap);
omInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitOldMap(); }
  if (e.key === 'Escape') { e.preventDefault(); closeOldMapModal(); }
  e.stopPropagation();  // don't trigger global shortcuts while typing
});

// Initial render
renderLayersPanel();
renderShapesPanel();
renderOverlaysPanel();
showRouteUI();
syncSkinButtons();
syncRouteStyleInputs();
syncShapeStyleInputs();
// Ensure persisted shapes are drawn even if style.load already fired.
if (map.isStyleLoaded()) {
  for (const overlay of state.overlays) ensureOverlayOnMap(overlay);
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
    overlays: state.overlays.map(serializeOverlay),
    skin: currentSkin,
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
    if (Array.isArray(data.overlays)) {
      for (const o of state.overlays) removeOverlayFromMap(o);
      state.overlays = data.overlays.map(hydrateOverlay).filter(Boolean);
      for (const o of state.overlays) ensureOverlayOnMap(o);
      renderOverlaysPanel();
    }
    if (typeof data.skin === 'string' && SKINS[data.skin]) setSkin(data.skin);
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

// Auto-select-all on first click into any number input — so typing immediately
// replaces the value (no cursor positioning, no manual delete). On subsequent
// clicks while already focused, default cursor positioning still works.
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.type !== 'number') return;
  if (document.activeElement === t) return;
  e.preventDefault();
  t.focus();
  setTimeout(() => t.select(), 0);
});
// Tab-into also gets the same treatment
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'number') {
    setTimeout(() => { if (document.activeElement === t) t.select(); }, 0);
  }
});

// Overflow menu (Export/Import) toggle
document.getElementById('overflow-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelector('.overflow-content').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.overflow-content');
  if (!menu || menu.classList.contains('hidden')) return;
  if (!e.target.closest('.overflow-menu')) menu.classList.add('hidden');
});

// Cmd+Z / Ctrl+Z — undo. Bound separately so it works even when an input is
// focused (typing in an input + cmd+z still undoes the action, mimicking native).
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    // Skip when actively typing — let the input's native undo win.
    if (e.target.matches('input, textarea') || e.target.isContentEditable) return;
    e.preventDefault();
    if (undoStack.length === 0) return;
    const next = undoStack[undoStack.length - 1];
    undo();
    flashToast(`Undo: ${next.label}`);
  }
});

function flashToast(msg) {
  let el = document.getElementById('mk-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mk-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(flashToast._t);
  flashToast._t = setTimeout(() => el.classList.remove('visible'), 1200);
}

// Keyboard
window.addEventListener('keydown', e => {
  // Ignore typing in inputs (and contenteditable — the project-name rename)
  if (e.target.matches('input, select, textarea') || e.target.isContentEditable) return;
  if (e.code === 'Space') { e.preventDefault(); state.playing ? stop() : play(); }
  else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); addKeyframe(); }
  else if (e.key === 'u' || e.key === 'U') {
    if (state.selectedId) { e.preventDefault(); updateSelectedKeyframe(); }
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    // In country-edit mode: Delete permanently splices marked parts out of geometry.
    if (state.editingShapeId) {
      const shape = state.shapes.find(s => s.id === state.editingShapeId);
      const marked = new Set(shape && shape.excludedPolygonIndices || []);
      if (shape && marked.size > 0) {
        e.preventDefault();
        const geom = ensureCustomGeometry(shape);
        if (geom) {
          const remaining = geom.coordinates.filter((_, idx) => !marked.has(idx));
          if (remaining.length === 0) {
            flashToast("can't delete every part");
          } else {
            geom.coordinates = remaining;
            shape.excludedPolygonIndices = [];
            updateCountryEditOverlay(shape);
            redrawShape(shape);
            saveLayers();
          }
        }
        return;
      }
    }
    // Whichever was last actively focused (shape vs keyframe) is the target.
    if (state.lastFocus === 'shape' && state.activeShapeId) {
      e.preventDefault();
      const s = activeShape();
      if (s && confirm(`Delete "${s.name}"?`)) deleteShape(s.id);
    } else if (state.selectedId) {
      e.preventDefault();
      deleteKeyframe(state.selectedId);
    } else if (state.activeShapeId) {
      // Fallback for older sessions (no lastFocus yet)
      e.preventDefault();
      const s = activeShape();
      if (s && confirm(`Delete "${s.name}"?`)) deleteShape(s.id);
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

function gifRange() {
  const fromSel = document.getElementById('gif-from');
  const toSel = document.getElementById('gif-to');
  return computeGifRange(fromSel.value, toSel.value, state.keyframes.map(k => k.duration));
}

function populateGifRange() {
  const fromSel = document.getElementById('gif-from');
  const toSel = document.getElementById('gif-to');
  const prevFrom = fromSel.value;
  const prevTo = toSel.value;
  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  state.keyframes.forEach((kf, i) => {
    const label = `K${String(i + 1).padStart(2, '0')}`;
    fromSel.appendChild(new Option(label, String(i)));
    toSel.appendChild(new Option(label, String(i)));
  });
  const n = state.keyframes.length;
  // Restore prior selection if still valid, else default to first/last
  fromSel.value = (prevFrom !== '' && parseInt(prevFrom, 10) < n) ? prevFrom : '0';
  toSel.value = (prevTo !== '' && parseInt(prevTo, 10) < n) ? prevTo : String(Math.max(0, n - 1));
}

function gifSummaryUpdate() {
  const { tStart, tEnd, fromIdx, toIdx } = gifRange();
  const total = Math.max(0, tEnd - tStart);
  const speed = parseFloat(gifSpeed.value) / 100;
  const fps = parseInt(gifFps.value, 10);
  const outDur = speed > 0 ? total / speed : 0;
  const frames = Math.max(1, Math.round(outDur * fps));
  const canvas = map.getCanvas();
  const scale = parseInt(gifScale.value, 10) / 100;
  const srcW = state.frame169 ? frame169Rect().w : canvas.clientWidth;
  const srcH = state.frame169 ? frame169Rect().h : canvas.clientHeight;
  const w = Math.round(srcW * scale);
  const h = state.frame169 ? Math.round(w * 9 / 16) : Math.round(srcH * scale);
  const rangeLabel = `K${String(fromIdx + 1).padStart(2, '0')}→K${String(toIdx + 1).padStart(2, '0')}`;
  const frameTag = state.frame169 ? ' · 16:9 frame' : '';
  gifSummary.textContent = `${rangeLabel} · ${frames} frames · ${outDur.toFixed(1)}s · ${w}×${h}${frameTag}`;
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

document.getElementById('gif-from').addEventListener('change', gifSummaryUpdate);
document.getElementById('gif-to').addEventListener('change', gifSummaryUpdate);

document.getElementById('gif-btn').addEventListener('click', () => {
  if (state.keyframes.length < 2) {
    alert('Add at least 2 keyframes first.');
    return;
  }
  populateGifRange();
  gifProgress.classList.add('hidden');
  gifGo.disabled = false;
  gifGo.textContent = 'Queue Render';
  gifSummaryUpdate();
  gifModal.classList.remove('hidden');
});

document.getElementById('gif-cancel').addEventListener('click', () => {
  gifModal.classList.add('hidden');
});

// ─── 16:9 compose frame ───
// A camera matte: heavy shading over everything (panels, header, timeline)
// except a centered 16:9 window over the map. When on, GIF renders crop to
// exactly this window — compose the shot inside the frame, render the frame.

function frame169Rect() {
  // Largest 16:9 rect that clears the editor chrome: side insets keep it off
  // the layers panel (left, 16+240) and the style panels (right, mirrored so
  // the frame stays screen-centered); top inset clears the topbar. CSS px
  // relative to the map container.
  const el = map.getContainer();
  const W = el.clientWidth, H = el.clientHeight;
  const SIDE = 272, TOP = 56, BOTTOM = 16;
  const boxW = Math.max(320, W - SIDE * 2);
  const boxH = Math.max(180, H - TOP - BOTTOM);
  let w = boxW, h = (w * 9) / 16;
  if (h > boxH) { h = boxH; w = (h * 16) / 9; }
  return { x: (W - w) / 2, y: TOP + (boxH - h) / 2, w, h };
}

function syncFrame169() {
  const el = document.getElementById('frame169');
  const btn = document.getElementById('frame169-btn');
  const gBtn = document.getElementById('frame-guides-btn');
  if (btn) btn.classList.toggle('active', !!state.frame169);
  if (gBtn) gBtn.classList.toggle('active', !!state.frameGuides);
  if (!el) return;
  el.classList.toggle('guides', !!state.frameGuides);
  if (!state.frame169) { el.classList.add('hidden'); return; }
  const mapRect = map.getContainer().getBoundingClientRect();
  const r = frame169Rect();
  el.classList.remove('hidden');
  el.style.left = `${mapRect.left + r.x}px`;
  el.style.top = `${mapRect.top + r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

document.getElementById('frame169-btn').addEventListener('click', () => {
  state.frame169 = !state.frame169;
  syncFrame169();
  saveLayers();
});
document.getElementById('frame-guides-btn').addEventListener('click', () => {
  state.frameGuides = !state.frameGuides;
  if (state.frameGuides && !state.frame169) state.frame169 = true; // guides live in the frame
  syncFrame169();
  saveLayers();
});
window.addEventListener('resize', syncFrame169);

// Source crop for the renderer, in device pixels of the map canvas. Frozen
// once per render job so a mid-render window resize can't shift the crop.
function renderCropRect(sourceCanvas) {
  if (!state.frame169) {
    return { sx: 0, sy: 0, sw: sourceCanvas.width, sh: sourceCanvas.height,
             cssW: sourceCanvas.clientWidth, cssH: sourceCanvas.clientHeight, is169: false };
  }
  const r = frame169Rect();
  const dpr = sourceCanvas.width / Math.max(1, sourceCanvas.clientWidth);
  return { sx: r.x * dpr, sy: r.y * dpr, sw: r.w * dpr, sh: r.h * dpr,
           cssW: r.w, cssH: r.h, is169: true };
}

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

// Render queue — multiple GIFs queue up and process one at a time.
// Note: jobs use the visible map and current state at render time. While a
// job is rendering, scrubbing the timeline conflicts with the renderer; safer
// to leave the timeline alone until the queue drains. Editing colors/strokes/
// shape positions is fine.
const renderQueue = [];
let renderProcessing = false;

function enqueueRender(opts) {
  const job = {
    id: 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 5),
    status: 'queued',
    progress: 0,
    label: `K${String(opts.fromIdx + 1).padStart(2, '0')}–K${String(opts.toIdx + 1).padStart(2, '0')} · ${opts.fps}fps · ${opts.speedPct}%`,
    error: null,
    opts,
  };
  renderQueue.push(job);
  renderQueuePanelUpdate();
  drainRenderQueue();
  return job;
}

async function drainRenderQueue() {
  if (renderProcessing) return;
  const next = renderQueue.find(j => j.status === 'queued');
  if (!next) return;
  renderProcessing = true;
  next.status = 'rendering';
  renderQueuePanelUpdate();
  try {
    await runRenderJob(next);
    next.status = 'done';
    next.progress = 1;
  } catch (err) {
    next.status = 'error';
    next.error = (err && err.message) || String(err);
  }
  renderProcessing = false;
  renderQueuePanelUpdate();
  drainRenderQueue();
}

function renderQueuePanelUpdate() {
  const panel = document.getElementById('render-queue');
  const list = document.getElementById('rq-list');
  if (renderQueue.length === 0) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  list.innerHTML = '';
  for (const job of renderQueue) {
    const row = document.createElement('div');
    row.className = 'rq-row rq-' + job.status;
    const pct = Math.round(job.progress * 100);
    const statusLabel = job.status === 'rendering' ? `Rendering · ${pct}%` :
                        job.status === 'done'      ? 'Done — downloaded' :
                        job.status === 'error'     ? `Error: ${job.error}` :
                                                     'Queued';
    row.innerHTML = `
      <div class="rq-label">${job.label}</div>
      <div class="rq-status">${statusLabel}</div>
      <div class="rq-bar"><div class="rq-fill" style="width:${pct}%"></div></div>
    `;
    list.appendChild(row);
  }
}

document.getElementById('rq-clear').addEventListener('click', () => {
  for (let i = renderQueue.length - 1; i >= 0; i--) {
    if (renderQueue[i].status === 'done' || renderQueue[i].status === 'error') {
      renderQueue.splice(i, 1);
    }
  }
  renderQueuePanelUpdate();
});

async function runRenderJob(job) {
  stop();
  const { tStart, tEnd, fromIdx, toIdx, speedPct, fps, scalePct } = job.opts;
  const total = Math.max(0, tEnd - tStart);
  const speed = speedPct / 100;
  const outDur = speed > 0 ? total / speed : 0;
  const totalFrames = Math.max(1, Math.round(outDur * fps));
  const sourceCanvas = map.getCanvas();
  const crop = renderCropRect(sourceCanvas);
  const w = Math.round(crop.cssW * scalePct);
  const h = crop.is169 ? Math.round((w * 9) / 16) : Math.round(crop.cssH * scalePct);

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const offCtx = off.getContext('2d');

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: w,
    height: h,
    workerScript: gifWorkerUrl,
    repeat: 0,
  });

  const stepPerFrame = (1 / fps) * speed;

  // Capture phase: 0 → 0.5 of progress
  for (let i = 0; i < totalFrames; i++) {
    const t = tStart + Math.min(total, i * stepPerFrame);
    applyAtTime(t);
    await new Promise(resolve => {
      if (map.areTilesLoaded()) {
        map.once('render', resolve);
        map.triggerRepaint();
      } else {
        map.once('idle', resolve);
      }
    });
    const src = map.getCanvas();
    offCtx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    gif.addFrame(offCtx, { copy: true, delay: Math.round(1000 / fps) });
    job.progress = 0.5 * (i + 1) / totalFrames;
    renderQueuePanelUpdate();
  }

  // Encoding phase: 0.5 → 1.0 of progress
  await new Promise((resolve, reject) => {
    gif.on('progress', p => {
      job.progress = 0.5 + p * 0.5;
      renderQueuePanelUpdate();
    });
    gif.on('finished', blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const rangeTag = `K${String(fromIdx + 1).padStart(2, '0')}-K${String(toIdx + 1).padStart(2, '0')}`;
      a.download = `mapkeys-${rangeTag}${crop.is169 ? '-16x9' : ''}-${speedPct}pct-${fps}fps.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve();
    });
    try { gif.render(); } catch (e) { reject(e); }
  });
}

gifGo.addEventListener('click', () => {
  const { tStart, tEnd, fromIdx, toIdx } = gifRange();
  const total = Math.max(0, tEnd - tStart);
  if (total <= 0) {
    alert('Pick a From keyframe earlier than the To keyframe.');
    return;
  }
  const speedPct = parseFloat(gifSpeed.value);
  const fps = parseInt(gifFps.value, 10);
  const scalePct = parseInt(gifScale.value, 10) / 100;
  enqueueRender({ tStart, tEnd, fromIdx, toIdx, speedPct, fps, scalePct });
  // Close modal — the queue panel takes over from here.
  gifModal.classList.add('hidden');
});

// Initial render
renderKeyframes();
renderEditor();

// ─── Project library: routing, open/save, chrome ───
// The URL hash is the source of truth: '' → library, '#<slug>' → that project.
// State flows: open = cache-instant + cloud-if-newer; save = per-project cache
// immediately + debounced cloud push + sendBeacon on tab close.

const EMPTY_SNAPSHOT = { layers: [], shapes: [], keyframes: [], overlays: [], camera: null };

const projectNameEl = document.getElementById('project-name');
const savePillEl = document.getElementById('save-pill');

function slugFromHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  // A malformed percent-sequence (a bare '%', or a tampered/shared link) makes
  // decodeURIComponent throw a URIError — which would brick project routing on
  // boot and every hashchange. Fall back to the raw (un-decoded) slug on failure.
  let h;
  try { h = decodeURIComponent(raw); } catch { h = raw; }
  return h.split('?')[0].trim();
}

function updateSavePill(mode) {
  if (!savePillEl) return;
  if (!currentProject || !mode) { savePillEl.classList.add('hidden'); return; }
  savePillEl.classList.remove('hidden');
  savePillEl.classList.toggle('is-saving', mode === 'saving');
  savePillEl.textContent = mode === 'saving' ? 'saving…' : mode === 'local' ? 'saved here' : 'saved';
}

function updateProjectChrome() {
  if (!projectNameEl) return;
  if (currentProject) {
    projectNameEl.textContent = currentProject.name;
    projectNameEl.classList.remove('hidden');
  } else {
    projectNameEl.classList.add('hidden');
    updateSavePill(null);
  }
}

// ── cloud autosave (debounced; capture-now flush) ──

function scheduleCloudSave() {
  if (!currentProject || suppressAutosave) return;
  updateSavePill('saving');
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(flushCloudSave, 1500);
}

// Captures the snapshot SYNCHRONOUSLY (safe to call right before a project
// switch tears the editor down), pushes in the background.
function flushCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = null;
  if (!currentProject) return;
  const id = currentProject.id;
  const snap = getProjectSnapshot();
  touchProject(id);
  pushProjectState(id, snap).then((ok) => {
    if (currentProject && currentProject.id === id) updateSavePill(ok ? 'saved' : 'local');
  });
}

// Last gasp — a beacon survives the tab closing mid-debounce.
window.addEventListener('pagehide', () => {
  if (!currentProject) return;
  clearTimeout(cloudSaveTimer);
  beaconProjectState(currentProject.id, getProjectSnapshot());
});

// ── apply a snapshot to the live editor ──

function applyProjectSnapshot(snap) {
  suppressAutosave = true;
  try {
    closeLabelEditor();
    if (state.playing) stop();
    if (state.editingShapeId) exitCountryEdit();
    // Tear down current map artifacts
    for (const s of state.shapes) removeShapeFromMap(s);
    for (const l of state.layers) removeLayerFromMap(l);
    for (const o of state.overlays) removeOverlayFromMap(o);
    undoStack.length = 0; // undo never crosses a project boundary
    hydrateSnapshotIntoState(snap || EMPTY_SNAPSHOT);
    // Attach to the map now if the style is ready; otherwise the style.load
    // handler walks state.* and attaches everything itself.
    if (map.isStyleLoaded()) {
      for (const o of state.overlays) ensureOverlayOnMap(o);
      ensureBordersOnMap();
      for (const l of state.layers) ensureLayerOnMap(l);
      for (const s of state.shapes) { ensureShapeOnMap(s); redrawShape(s); }
      applyShapeOrder();
      setRouteSources(state.previewProgress);
    }
    if (snap && snap.camera && Array.isArray(snap.camera.center)) {
      map.jumpTo({
        center: snap.camera.center,
        zoom: snap.camera.zoom ?? map.getZoom(),
        bearing: snap.camera.bearing ?? 0,
        pitch: snap.camera.pitch ?? 0,
      });
    }
    // Re-render all chrome
    renderLayersPanel();
    renderShapesPanel();
    renderOverlaysPanel();
    renderKeyframes();
    renderEditor();
    showRouteUI();
    syncShapeStyleInputs();
    syncRouteStyleInputs();
    syncDrawSlider();
    syncBordersHub();
    syncFrame169();
    clearSearchPin();
    closeSearchResults();
    updateSelectionIndicator();
  } finally {
    suppressAutosave = false;
  }
}

// ── open / route ──

function openProjectRow(row) {
  if (currentProject && currentProject.id === row.id) {
    // Same project (e.g. a rename changed the slug) — refresh chrome only.
    currentProject = row;
    updateProjectChrome();
    hideLibrary();
    return;
  }
  if (currentProject) flushCloudSave(); // save the outgoing project first
  currentProject = row;
  const { state: cached, fresh } = loadProjectState(row);
  applyProjectSnapshot(cached || EMPTY_SNAPSHOT);
  hideLibrary();
  updateProjectChrome();
  updateSavePill('saved');
  // If the cloud copy is newer than the cache (edited on another machine),
  // it lands a moment later.
  fresh.then((newer) => {
    if (newer && currentProject && currentProject.id === row.id) {
      applyProjectSnapshot(newer);
    }
  });
}

async function routeFromHash() {
  const slug = slugFromHash();
  if (!slug) {
    if (currentProject) flushCloudSave();
    currentProject = null;
    updateProjectChrome();
    showLibrary();
    return;
  }
  let row = findBySlug(slug);
  if (!row) {
    await syncProjectsFromCloud();
    row = findBySlug(slug);
  }
  if (!row) {
    // Unknown slug — land on the library rather than a dead page.
    window.location.hash = '';
    return;
  }
  openProjectRow(row);
}

window.addEventListener('hashchange', routeFromHash);

// ── topbar chrome ──

document.getElementById('brand').addEventListener('click', () => {
  window.location.hash = '';
});

if (projectNameEl) {
  const commitName = () => {
    if (!currentProject) return;
    const name = projectNameEl.textContent.trim();
    if (!name || name === currentProject.name) {
      projectNameEl.textContent = currentProject ? currentProject.name : '';
      return;
    }
    const row = renameProject(currentProject.id, name);
    if (row) {
      currentProject = row;
      projectNameEl.textContent = row.name;
      // Follow the slug without retriggering a full route (same project).
      history.replaceState(null, '', `#${encodeURIComponent(row.slug)}`);
    }
  };
  projectNameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); projectNameEl.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      projectNameEl.textContent = currentProject ? currentProject.name : '';
      projectNameEl.blur();
    }
  });
  projectNameEl.addEventListener('blur', commitName);
}

// ── boot ──

initLibrary({
  onOpen: (row) => {
    const target = `#${encodeURIComponent(row.slug)}`;
    if (window.location.hash === target) routeFromHash();
    else window.location.hash = target;
  },
});

// Adopt the pre-library single map once, then route. If the very first load
// just migrated Johnny's existing map, open it directly — seamless continuity.
migrateLegacyIfNeeded().then((migrated) => {
  if (migrated && !slugFromHash()) {
    window.location.hash = `#${encodeURIComponent(migrated.slug)}`;
  } else {
    routeFromHash();
  }
  syncProjectsFromCloud();
});
