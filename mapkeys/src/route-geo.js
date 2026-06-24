// Pure route geometry for MapKeys — distance, partial-reveal slicing, and
// antimeridian-safe interpolation. Extracted verbatim from main.js so the
// route-animation math is testable headlessly (main.js imports mapbox-gl at
// module load and can't be loaded in a test). Behavior-identical to the
// inline originals; main.js imports these and the inline copies are deleted.

// Great-circle distance between two lat/lng points, in kilometers.
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Precompute cumulative distance along a [lng,lat][] path for fast slicing.
export function buildRoute(coords) {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    cumDist.push(cumDist[i - 1] + haversine(lat1, lng1, lat2, lng2));
  }
  return { coords, cumDist, totalDist: cumDist[cumDist.length - 1] || 0 };
}

// Return the portion of a route revealed at `progress` (0..1) — the leading
// vertices plus an interpolated point on the partial segment.
export function sliceRoute(route, progress) {
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

export function lineCentroid(coords) {
  let sx = 0, sy = 0;
  for (const [x, y] of coords) { sx += x; sy += y; }
  return [sx / coords.length, sy / coords.length];
}

// Scale a line about its centroid and translate by an lng/lat offset.
export function transformLineCoords(baseCoords, offsetLng, offsetLat, scale) {
  const [cx, cy] = lineCentroid(baseCoords);
  return baseCoords.map(([lng, lat]) => [
    cx + (lng - cx) * scale + offsetLng,
    cy + (lat - cy) * scale + offsetLat,
  ]);
}

// Total great-circle length of a [lng,lat][] line, in kilometers.
export function lineLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    d += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return d;
}

// Same as sliceRoute but for a raw [lng,lat][] line (no precomputed cumDist).
export function sliceLineCoords(coords, drawProgress) {
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

// Bounding box of a [lng,lat][] path as the [[minLng,minLat],[maxLng,maxLat]]
// pair map.fitBounds() expects. Computed in a single pass on purpose: the old
// `Math.max(...lngs)` form throws `RangeError: Maximum call stack size exceeded`
// once a track exceeds ~125k points (V8's spread-argument cap), and recorded
// gx:Track GPS logs — the longest tracks — routinely run that large. Empty input
// returns the same Infinity box the spread form did, so behavior is identical
// for every array that was ever safe to spread.
export function coordsBounds(coords) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const c of coords) {
    const lng = c[0], lat = c[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

// Interpolate longitude the SHORT way around the globe (antimeridian-safe).
export function lerpLng(a, b, t) {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

// Interpolate a compass bearing the short way around the circle.
export function lerpBearing(a, b, t) {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}
