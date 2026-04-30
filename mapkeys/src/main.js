import mapboxgl from 'mapbox-gl';
import * as topojson from 'topojson-client';
import worldTopo from 'world-atlas/countries-50m.json';
import './style.css';

// ─── Mapbox setup (matches pinglobe) ───

mapboxgl.accessToken = 'pk.eyJ1Ijoiam9obm55d2hhcnJpcyIsImEiOiJ3ck1DN2dnIn0.B-hCqwHxWQwTFGYWOfCLfg';

const countriesGeo = topojson.feature(worldTopo, worldTopo.objects.countries);

const mapStyle = {
  version: 8,
  name: 'MapKeys',
  sources: {
    'mapbox-streets': { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
    'countries': { type: 'geojson', data: countriesGeo },
    'route-full': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    'route-drawn': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f83500' } },
    { id: 'water', type: 'fill', source: 'mapbox-streets', 'source-layer': 'water', paint: { 'fill-color': '#f83500' } },
    {
      id: 'country-outlines', type: 'line', source: 'countries',
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 2, 0.8, 4, 1.2, 7, 1.5, 12, 1],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    {
      id: 'admin-disputed', type: 'line', source: 'mapbox-streets', 'source-layer': 'admin',
      filter: ['all', ['==', ['get', 'admin_level'], 0], ['==', ['get', 'disputed'], 'true']],
      paint: {
        'line-color': '#fffbe6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 4, 1, 7, 1.2],
        'line-dasharray': [3, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    {
      id: 'country-label', type: 'symbol', source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'country'], minzoom: 1,
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
    {
      id: 'capital-label', type: 'symbol', source: 'mapbox-streets', 'source-layer': 'place_label',
      filter: ['all', ['==', ['get', 'class'], 'settlement'], ['any', ['==', ['get', 'capital'], 2], ['==', ['get', 'capital'], 3]]],
      minzoom: 3,
      layout: {
        'text-field': ['concat', '★ ', ['get', 'name_en']],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 7, 5, 9, 8, 12, 10, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.06,
      },
      paint: {
        'text-color': ['interpolate', ['linear'], ['zoom'], 3, 'rgba(255,251,230,0.3)', 5, 'rgba(255,251,230,0.6)', 7, 'rgba(255,251,230,0.85)'],
        'text-halo-color': '#f83500',
        'text-halo-width': 1.5,
      },
    },
    // Route — full path (faint)
    {
      id: 'route-full-line', type: 'line', source: 'route-full',
      paint: {
        'line-color': '#fffbe6',
        'line-opacity': 0.18,
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    // Route — drawn portion (bold)
    {
      id: 'route-drawn-glow', type: 'line', source: 'route-drawn',
      paint: { 'line-color': '#0a0a0a', 'line-width': 7, 'line-opacity': 0.4, 'line-blur': 1 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
    {
      id: 'route-drawn-line', type: 'line', source: 'route-drawn',
      paint: { 'line-color': '#fffbe6', 'line-width': 4 },
      layout: { 'line-join': 'round', 'line-cap': 'round' },
    },
  ],
};

const map = new mapboxgl.Map({
  container: 'map',
  style: mapStyle,
  projection: 'globe',
  center: [20, 20],
  zoom: 1.8,
  maxPitch: 85,
  attributionControl: false,
});

map.on('style.load', () => {
  map.setFog({
    color: '#f83500',
    'high-color': '#f83500',
    'space-color': '#f83500',
    'horizon-blend': 0,
    'star-intensity': 0,
    range: [20, 20],
  });
});

// ─── State ───

const state = {
  keyframes: [],          // { center: [lng, lat], zoom, bearing, pitch, progress, duration, easing }
  selectedId: null,
  nextId: 1,
  route: null,            // { coords: [[lng,lat]...], cumDist: [...], totalDist }
  playing: false,
  rafId: null,
  playStart: 0,           // performance.now() when play started, accounting for offset
  playOffset: 0,          // seconds into timeline at play start
};

const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
};

// ─── KML parsing ───

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
  const lastKf = state.keyframes[state.keyframes.length - 1];
  const kf = {
    id: 'k' + (state.nextId++),
    ...view,
    progress: lastKf ? lastKf.progress : 0,
    duration: 2.0,
    easing: 'easeInOut',
  };
  state.keyframes.push(kf);
  state.selectedId = kf.id;
  renderKeyframes();
  renderEditor();
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
      setRouteSources(kf.progress);
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
    setRouteSources(kf.progress);
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
      setRouteSources(progress);
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
    renderKeyframes();
    setRouteSources(kf.progress);
  }
});
document.getElementById('kf-update-view').addEventListener('click', () => {
  const kf = state.keyframes.find(k => k.id === state.selectedId);
  if (kf) {
    Object.assign(kf, captureView());
    renderKeyframes();
  }
});
document.getElementById('kf-delete').addEventListener('click', () => {
  if (state.selectedId) deleteKeyframe(state.selectedId);
});

// KML upload
document.getElementById('kml-file').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const coords = parseKML(text);
  if (coords.length < 2) {
    alert('No usable LineString coordinates found in this KML.');
    return;
  }
  state.route = buildRoute(coords);
  document.getElementById('clear-route').classList.remove('hidden');
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
  document.getElementById('route-info').textContent = '';
  setRouteSources(0);
});

// Export / import
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify({ keyframes: state.keyframes }, null, 2);
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
  else if (e.key === 'ArrowLeft') {
    const i = state.keyframes.findIndex(k => k.id === state.selectedId);
    if (i > 0) selectKeyframe(state.keyframes[i - 1].id);
  }
  else if (e.key === 'ArrowRight') {
    const i = state.keyframes.findIndex(k => k.id === state.selectedId);
    if (i >= 0 && i < state.keyframes.length - 1) selectKeyframe(state.keyframes[i + 1].id);
  }
});

// Initial render
renderKeyframes();
renderEditor();
