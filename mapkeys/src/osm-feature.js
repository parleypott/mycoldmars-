// MapKeys — OSM feature search geometry plumbing (extracted for headless testing).
//
// Pure functions that turn OpenStreetMap data (Nominatim search results,
// Nominatim polygon_geojson geometry, Overpass relation dumps) into the
// payloads main.js needs to add real, editable shapes:
//
//   linear features (rivers, roads, railways)  → { kind:'line', coords }
//   area features (provinces, lakes, parks)    → { kind:'area', geometry }
//   point features (peaks, towns w/o polygon)  → { kind:'point', center }
//
// No fetch here — main.js owns the network so aborts/debounce stay in one
// place and these stay trivially testable.

/* ── Nominatim search results → picker rows ───────────────────────────── */

// Human labels for the OSM class/type pairs worth surfacing. Anything not
// listed falls back to the raw type string — still informative, never blank.
const KIND_LABELS = new Map([
  ['waterway/river', 'river'],
  ['waterway/stream', 'stream'],
  ['waterway/canal', 'canal'],
  ['natural/water', 'lake'],
  ['natural/bay', 'bay'],
  ['natural/strait', 'strait'],
  ['natural/peak', 'peak'],
  ['natural/mountain_range', 'range'],
  ['boundary/administrative', 'admin area'],
  ['place/state', 'state'],
  ['place/province', 'province'],
  ['place/region', 'region'],
  ['place/island', 'island'],
  ['place/sea', 'sea'],
  ['landuse/forest', 'forest'],
  ['leisure/nature_reserve', 'reserve'],
  ['boundary/national_park', 'park'],
  ['route/road', 'road'],
  ['highway/primary', 'road'],
]);

export function osmKindLabel(cls, type) {
  return KIND_LABELS.get(`${cls}/${type}`) || String(type || cls || 'feature').replace(/_/g, ' ');
}

/**
 * Normalize a Nominatim /search?format=jsonv2 response into picker rows.
 * Keeps only rows with an OSM id we can fetch geometry for; relations and
 * ways carry real geometry, nodes become point features.
 */
export function mapNominatimResults(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const r of json) {
    if (!r || !r.osm_type || !r.osm_id) continue;
    const name = r.name || (r.display_name || '').split(',')[0].trim();
    if (!name) continue;
    const context = (r.display_name || '')
      .split(',').slice(1).map(s => s.trim()).filter(Boolean).slice(0, 2).join(', ');
    const lon = Number(r.lon), lat = Number(r.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({
      source: 'osm',
      osmType: r.osm_type,            // 'relation' | 'way' | 'node'
      osmId: r.osm_id,
      name,
      context,
      kind: osmKindLabel(r.category ?? r.class, r.type),
      center: [lon, lat],
      bbox: Array.isArray(r.boundingbox) && r.boundingbox.length === 4
        ? [Number(r.boundingbox[2]), Number(r.boundingbox[0]), Number(r.boundingbox[3]), Number(r.boundingbox[1])] // [w,s,e,n]
        : null,
    });
  }
  return out;
}

/* ── Overpass relation dump → role-aware line segments ────────────────── */

/**
 * Extract way geometries from an Overpass `rel(id);out body;way(r);out geom;`
 * response. Braided rivers tag their members main_stream/side_stream — when
 * any main_stream members exist, side channels are dropped so the stitched
 * line follows one continuous channel. Returns [[ [lng,lat], … ], …].
 */
export function overpassLineSegments(json) {
  const els = (json && Array.isArray(json.elements)) ? json.elements : [];
  const rel = els.find(e => e.type === 'relation');
  const ways = new Map(els.filter(e => e.type === 'way' && Array.isArray(e.geometry)).map(e => [e.id, e]));
  let ids;
  if (rel && Array.isArray(rel.members)) {
    const members = rel.members.filter(m => m.type === 'way');
    const main = members.filter(m => m.role === 'main_stream');
    ids = (main.length ? main : members).map(m => m.ref);
  } else {
    ids = [...ways.keys()];
  }
  const segs = [];
  for (const id of ids) {
    const w = ways.get(id);
    if (!w) continue;
    const pts = w.geometry.map(p => [p.lon, p.lat]);
    if (pts.length >= 2) segs.push(pts);
  }
  return segs;
}

/* ── stitch + simplify ────────────────────────────────────────────────── */

function d2(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; }

/**
 * Greedy endpoint stitch: start from the segment endpoint farthest north
 * (rivers read source→mouth) and repeatedly append the nearest unused
 * segment, flipping it when its far end is the touching one. Stops at the
 * first gap beyond maxGapDeg — disconnected leftovers (side arms surviving
 * an untagged relation) are dropped rather than teleport-joined.
 */
export function stitchSegments(segs, maxGapDeg = 0.05) {
  const clean = (segs || []).filter(s => Array.isArray(s) && s.length >= 2);
  if (!clean.length) return [];
  const used = new Array(clean.length).fill(false);
  let si = 0, best = -Infinity;
  for (let i = 0; i < clean.length; i++) {
    const t = Math.max(clean[i][0][1], clean[i][clean[i].length - 1][1]);
    if (t > best) { best = t; si = i; }
  }
  let seg = clean[si];
  if (seg[seg.length - 1][1] > seg[0][1]) seg = seg.slice().reverse();
  const chain = seg.slice();
  used[si] = true;
  const maxGap2 = maxGapDeg * maxGapDeg;
  for (let n = 1; n < clean.length; n++) {
    const tail = chain[chain.length - 1];
    let bi = -1, bd = Infinity, flip = false;
    for (let i = 0; i < clean.length; i++) {
      if (used[i]) continue;
      const s = clean[i];
      const d0 = d2(tail, s[0]), d1 = d2(tail, s[s.length - 1]);
      if (d0 < bd) { bd = d0; bi = i; flip = false; }
      if (d1 < bd) { bd = d1; bi = i; flip = true; }
    }
    if (bi < 0 || bd > maxGap2) break;
    const s = flip ? clean[bi].slice().reverse() : clean[bi];
    for (let k = 1; k < s.length; k++) chain.push(s[k]);
    used[bi] = true;
  }
  return chain;
}

/**
 * Iterative Douglas–Peucker (explicit stack — a 100k-point river must not
 * blow the call stack). eps is in degrees; 0.002 ≈ 200 m, faithful at any
 * country-level zoom while cutting point counts ~10×.
 */
export function simplifyLine(pts, eps = 0.002) {
  if (!Array.isArray(pts) || pts.length < 3) return (pts || []).slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let imax = -1, dmax = eps;
    for (let i = a + 1; i < b; i++) {
      const dd = Math.abs(dx * (ay - pts[i][1]) - dy * (ax - pts[i][0])) / len;
      if (dd > dmax) { dmax = dd; imax = i; }
    }
    if (imax > 0) {
      keep[imax] = true;
      stack.push([a, imax], [imax, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* ── GeoJSON geometry → shape payload ─────────────────────────────────── */

const round5 = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];

function roundRing(ring) { return ring.map(round5); }

/**
 * Classify a fetched geometry into the shape MapKeys should create.
 * Lines are stitched (MultiLineString) + simplified; polygons are simplified
 * ring-by-ring but never below 4 points (closed ring minimum).
 */
export function geometryToPayload(geometry, opts = {}) {
  if (!geometry || !geometry.type) return null;
  const eps = typeof opts.eps === 'number' ? opts.eps : 0.002;
  const t = geometry.type;
  if (t === 'Point') {
    return { kind: 'point', center: round5(geometry.coordinates) };
  }
  if (t === 'LineString' || t === 'MultiLineString') {
    const segs = t === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    const coords = simplifyLine(stitchSegments(segs), eps).map(round5);
    return coords.length >= 2 ? { kind: 'line', coords } : null;
  }
  if (t === 'Polygon' || t === 'MultiPolygon') {
    const polys = t === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const out = [];
    for (const rings of polys) {
      const cleaned = [];
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4) continue;
        let r = simplifyLine(ring, eps);
        if (r.length < 4) r = ring; // simplification collapsed it — keep original
        cleaned.push(roundRing(r));
      }
      if (cleaned.length) out.push(cleaned);
    }
    if (!out.length) return null;
    return { kind: 'area', geometry: { type: 'MultiPolygon', coordinates: out } };
  }
  return null;
}

/* ── merge Mapbox + OSM result lists for the picker ───────────────────── */

/**
 * Interleave: Mapbox point hits stay first (they're the fast navigate-to
 * results people expect), OSM geometry hits follow, deduped against Mapbox
 * by lowercase name so "Myanmar" doesn't appear twice.
 */
export function mergeSearchResults(mapboxResults, osmResults, limit = 8) {
  const mb = Array.isArray(mapboxResults) ? mapboxResults : [];
  const osm = Array.isArray(osmResults) ? osmResults : [];
  const seen = new Set(mb.map(r => (r.name || '').toLowerCase()));
  const merged = [...mb];
  for (const r of osm) {
    const key = (r.name || '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.slice(0, limit);
}
