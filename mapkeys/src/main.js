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

// Persist camera on every move (debounced via moveend, which already fires
// once per gesture rather than per frame).
map.on('moveend', () => {
  // Don't persist while we're playing back keyframes — save the user's
  // edit-time position, not a snapshot from the middle of an animation.
  if (typeof state !== 'undefined' && state.playing) return;
  try {
    const c = map.getCenter();
    localStorage.setItem(CAMERA_LS_KEY, JSON.stringify({
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }));
  } catch {}
});

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

  // ── Route sources + layers (added on top)
  if (!map.getSource('route-full')) {
    map.addSource('route-full', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('route-drawn', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
      id: 'route-full-line',
      type: 'line',
      source: 'route-full',
      paint: {
        'line-color': PAL.ink,
        'line-opacity': 0.25,
        'line-width': 1.5,
        'line-dasharray': [2, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
    map.addLayer({
      id: 'route-drawn-glow',
      type: 'line',
      source: 'route-drawn',
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.55, 'line-blur': 2 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
    map.addLayer({
      id: 'route-drawn-line',
      type: 'line',
      source: 'route-drawn',
      paint: { 'line-color': PAL.ink, 'line-width': 3 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    });
  }
  applyRouteStyle();
});

// ─── State ───

const state = {
  keyframes: [],          // { center: [lng, lat], zoom, bearing, pitch, progress, duration, easing }
  selectedId: null,
  nextId: 1,
  route: null,            // { coords: [[lng,lat]...], cumDist: [...], totalDist }
  routeStyle: { color: '#2b2a26', width: 3, opacity: 1, dashed: false, trail: true },
  previewProgress: 0,    // current scrub-bar position (0–1), what + Keyframe captures
  playing: false,
  rafId: null,
  playStart: 0,
  playOffset: 0,
};

function applyRouteStyle() {
  const { color, width, opacity, dashed, trail } = state.routeStyle;
  if (map.getLayer('route-drawn-line')) {
    map.setPaintProperty('route-drawn-line', 'line-color', color);
    map.setPaintProperty('route-drawn-line', 'line-width', width);
    map.setPaintProperty('route-drawn-line', 'line-opacity', opacity);
    map.setPaintProperty('route-drawn-line', 'line-dasharray', dashed ? [2, 1.5] : [1, 0]);
  }
  if (map.getLayer('route-drawn-glow')) {
    map.setPaintProperty('route-drawn-glow', 'line-width', width + 4);
    map.setPaintProperty('route-drawn-glow', 'line-opacity', opacity * 0.55);
  }
  if (map.getLayer('route-full-line')) {
    map.setLayoutProperty('route-full-line', 'visibility', trail ? 'visible' : 'none');
    map.setPaintProperty('route-full-line', 'line-color', color);
    map.setPaintProperty('route-full-line', 'line-width', Math.max(1, width * 0.5));
    map.setPaintProperty('route-full-line', 'line-opacity', opacity * 0.3);
  }
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
  if (!map.getSource('route-full')) return;
  if (!state.route) {
    map.getSource('route-full').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('route-drawn').setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  map.getSource('route-full').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: state.route.coords },
  });
  const drawn = sliceRoute(state.route, progress);
  map.getSource('route-drawn').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: drawn },
  });
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
      syncDrawSlider();
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

// KML / KMZ upload
document.getElementById('kml-file').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  let text;
  try {
    text = await readRouteFile(file);
  } catch (err) {
    alert('Failed to read file: ' + err.message);
    return;
  }
  const coords = parseKML(text);
  if (coords.length < 2) {
    alert('No usable LineString coordinates found in this KML.');
    return;
  }
  state.route = buildRoute(coords);
  document.getElementById('clear-route').classList.remove('hidden');
  document.getElementById('route-style').classList.remove('hidden');
  document.getElementById('draw-bar').classList.remove('hidden');
  document.getElementById('route-info').textContent =
    `${file.name} · ${coords.length} pts · ${state.route.totalDist.toFixed(0)} km`;

  // Fit map to route
  const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
  map.fitBounds([
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)]
  ], { padding: 80, duration: 1000 });

  // Render route at current selected progress (or 0)
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  setRouteSources(kf ? kf.progress : 0);
  e.target.value = '';
});

document.getElementById('clear-route').addEventListener('click', () => {
  state.route = null;
  document.getElementById('clear-route').classList.add('hidden');
  document.getElementById('route-style').classList.add('hidden');
  document.getElementById('draw-bar').classList.add('hidden');
  document.getElementById('route-info').textContent = '';
  setRouteSources(0);
});

// Route style controls
const rsColor = document.getElementById('rs-color');
const rsWidth = document.getElementById('rs-width');
const rsWidthVal = document.getElementById('rs-width-val');
const rsOpacity = document.getElementById('rs-opacity');
const rsOpacityVal = document.getElementById('rs-opacity-val');
const rsDashed = document.getElementById('rs-dashed');
const rsTrail = document.getElementById('rs-trail');

function syncRouteStyleInputs() {
  rsColor.value = state.routeStyle.color;
  rsWidth.value = state.routeStyle.width;
  rsWidthVal.textContent = state.routeStyle.width;
  rsOpacity.value = Math.round(state.routeStyle.opacity * 100);
  rsOpacityVal.textContent = Math.round(state.routeStyle.opacity * 100);
  rsDashed.checked = state.routeStyle.dashed;
  rsTrail.checked = state.routeStyle.trail;
}
syncRouteStyleInputs();

rsColor.addEventListener('input', e => {
  state.routeStyle.color = e.target.value;
  applyRouteStyle();
});
rsWidth.addEventListener('input', e => {
  state.routeStyle.width = parseFloat(e.target.value);
  rsWidthVal.textContent = e.target.value;
  applyRouteStyle();
});
rsOpacity.addEventListener('input', e => {
  state.routeStyle.opacity = parseFloat(e.target.value) / 100;
  rsOpacityVal.textContent = e.target.value;
  applyRouteStyle();
});
rsDashed.addEventListener('change', e => {
  state.routeStyle.dashed = e.target.checked;
  applyRouteStyle();
});
rsTrail.addEventListener('change', e => {
  state.routeStyle.trail = e.target.checked;
  applyRouteStyle();
});

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

// Export / import
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify({ keyframes: state.keyframes, routeStyle: state.routeStyle }, null, 2);
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
    if (Array.isArray(data.keyframes)) {
      state.keyframes = data.keyframes.map(k => ({ ...k, id: 'k' + (state.nextId++) }));
      state.selectedId = state.keyframes[0]?.id ?? null;
      renderKeyframes();
      renderEditor();
      if (state.selectedId) selectKeyframe(state.selectedId, true);
    }
    if (data.routeStyle) {
      Object.assign(state.routeStyle, data.routeStyle);
      syncRouteStyleInputs();
      applyRouteStyle();
    }
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
    if (state.selectedId) { e.preventDefault(); deleteKeyframe(state.selectedId); }
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
