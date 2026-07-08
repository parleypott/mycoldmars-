// Feathered crop mask math for old-map overlays — pure, headless-testable.
//
// The mask is applied per TILE, at fetch time: main.js registers a custom
// mapboxgl protocol that fetches the real tile, then multiplies its alpha by
// four edge ramps (one per side of the crop rectangle) drawn with canvas
// gradients in 'destination-in' mode. The product of the ramps feathers the
// edges and rounds off the corners — Photoshop-style — at every zoom level.
// This module computes WHERE those ramps land on a given tile, in pixels.
//
// Everything happens in Web-Mercator unit space ([0,1]² with y down), which
// is exactly the space XYZ tiles are cut in, so a tile's pixel grid maps
// linearly onto it.

const clampLat = (lat) => Math.max(-85.051129, Math.min(85.051129, lat));

export function lngToMercX(lng) {
  return (lng + 180) / 360;
}

export function latToMercY(lat) {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
}

/** Mercator bounds of XYZ tile {z,x,y} → { x0, y0, x1, y1 } (y down). */
export function tileMercBounds(z, x, y) {
  const s = 1 / 2 ** z;
  return { x0: x * s, y0: y * s, x1: (x + 1) * s, y1: (y + 1) * s };
}

/** [[w,s],[e,n]] lng/lat rect → mercator rect { x0, y0, x1, y1 } (y down). */
export function rectToMerc(rect) {
  const [[w, s], [e, n]] = rect;
  return { x0: lngToMercX(w), y0: latToMercY(n), x1: lngToMercX(e), y1: latToMercY(s) };
}

/** Shrink a mercator rect by `cropFrac` of its own size on every side. */
export function insetRect(r, cropFrac) {
  const f = Math.max(0, Math.min(0.49, cropFrac || 0));
  const dx = (r.x1 - r.x0) * f;
  const dy = (r.y1 - r.y0) * f;
  return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 - dx, y1: r.y1 - dy };
}

/**
 * Compute the feather plan for one tile.
 *
 * rectLngLat  [[w,s],[e,n]] crop rectangle (pre-inset)
 * cropFrac    0..0.49 — inset applied to the rect before feathering
 * featherFrac 0..1 — feather width as a fraction of the rect's SHORT side
 * sizePx      tile bitmap size (256 or 512)
 *
 * Returns { coverage, ramps } where coverage is:
 *   'outside' — tile is fully transparent; skip fetching the tile at all
 *   'inside'  — tile is untouched by the mask; use original bytes as-is
 *   'partial' — apply `ramps`: [{ axis:'x'|'y', fromPx, toPx }] gradients,
 *               alpha 0 at fromPx → 1 at toPx (fromPx may exceed toPx for
 *               the far edges — the gradient simply runs backwards).
 */
export function featherPlan({ z, x, y }, rectLngLat, cropFrac, featherFrac, sizePx) {
  const tile = tileMercBounds(z, x, y);
  const rect = insetRect(rectToMerc(rectLngLat), cropFrac);
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return { coverage: 'outside', ramps: [] };

  const featherM = Math.max(0, featherFrac || 0) * Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0);

  // Fully outside the (un-feathered) rect → transparent tile.
  if (tile.x1 <= rect.x0 || tile.x0 >= rect.x1 || tile.y1 <= rect.y0 || tile.y0 >= rect.y1) {
    return { coverage: 'outside', ramps: [] };
  }
  // Fully inside the feather-complete zone → untouched.
  if (
    tile.x0 >= rect.x0 + featherM && tile.x1 <= rect.x1 - featherM &&
    tile.y0 >= rect.y0 + featherM && tile.y1 <= rect.y1 - featherM
  ) {
    return { coverage: 'inside', ramps: [] };
  }

  const tileSpan = tile.x1 - tile.x0; // == tile.y1 - tile.y0
  const pxPerMerc = sizePx / tileSpan;
  const toPxX = (mx) => (mx - tile.x0) * pxPerMerc;
  const toPxY = (my) => (my - tile.y0) * pxPerMerc;
  // A zero feather is a hard crop — collapse the ramp to a hair so canvas
  // gradients stay valid (from !== to).
  const fpx = Math.max(featherM * pxPerMerc, 0.01);

  return {
    coverage: 'partial',
    ramps: [
      { axis: 'x', fromPx: toPxX(rect.x0), toPx: toPxX(rect.x0) + fpx },        // west
      { axis: 'x', fromPx: toPxX(rect.x1), toPx: toPxX(rect.x1) - fpx },        // east
      { axis: 'y', fromPx: toPxY(rect.y0), toPx: toPxY(rect.y0) + fpx },        // north
      { axis: 'y', fromPx: toPxY(rect.y1), toPx: toPxY(rect.y1) - fpx },        // south
    ],
  };
}

/** Build the mkfeather:// tile-template URL that carries the mask params. */
export function featherTilesUrl(realTemplate, rectLngLat, cropFrac, featherFrac) {
  const [[w, s], [e, n]] = rectLngLat;
  const q = new URLSearchParams({
    src: realTemplate,
    rect: [w, s, e, n].map((v) => v.toFixed(6)).join(','),
    crop: String(cropFrac || 0),
    feather: String(featherFrac || 0),
  });
  // {z}/{x}/{y} stay literal so Mapbox substitutes them per tile.
  return `mkfeather://tile/{z}/{x}/{y}?${q.toString()}`;
}

/** Parse what the protocol handler receives back into usable parts. */
export function parseFeatherUrl(url) {
  const m = /^mkfeather:\/\/tile\/(\d+)\/(\d+)\/(\d+)\?(.*)$/.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[4]);
  const src = q.get('src');
  const rect = (q.get('rect') || '').split(',').map(Number);
  if (!src || rect.length !== 4 || rect.some(Number.isNaN)) return null;
  const z = +m[1], x = +m[2], y = +m[3];
  return {
    z, x, y,
    tileUrl: src.replace('{z}', z).replace('{x}', x).replace('{y}', y),
    rectLngLat: [[rect[0], rect[1]], [rect[2], rect[3]]],
    cropFrac: parseFloat(q.get('crop')) || 0,
    featherFrac: parseFloat(q.get('feather')) || 0,
  };
}
