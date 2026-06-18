// Pure polygon geometry for MapKeys shapes. Extracted from main.js so it can be
// unit-tested headlessly (main.js pulls in mapbox-gl / gif.js at import time).

export const KM_PER_DEG_LAT = 111.32;

// Approximate regular polygon ring in lng/lat. Not perfectly geodesic but
// visually correct at typical zoom levels. Scales lng by 1/cos(lat) so the
// shape doesn't squash near the poles.
//
// Vertex 0 sits straight UP (north / +lat) at rotation 0, so an odd-sided
// polygon like a triangle points up (vertex up), matching how people expect a
// freshly-dropped shape to look. (Even-sided shapes are symmetric under a 180°
// flip, so the starting angle is invisible for them — the default octagon is
// unchanged by this convention either way.)
export function regularPolygonCoords(center, sides, radiusKm, rotationDeg) {
  const [lng0, lat0] = center;
  const latRad = lat0 * Math.PI / 180;
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLng = radiusKm / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos(latRad)));
  const rot = rotationDeg * Math.PI / 180;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    // Start at top (north) so rotation 0 looks natural (vertex up).
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2 + rot;
    ring.push([lng0 + Math.cos(a) * dLng, lat0 + Math.sin(a) * dLat]);
  }
  ring.push(ring[0]);
  return ring;
}
