// reef-geo.ts — pure Web-Mercator projection + tile-layout math for the reef
// frame baker (reef-render.ts). Split out of the renderer (which pulls in `sharp`
// and hits the Google tile network) so the load-bearing geometry can be unit-tested
// headless. reef-render.ts imports these verbatim, so this module and the renderer
// share ONE copy of the math — locked in reef-geo.test.mjs, no divergent twin.

export const TILE = 256;

// global-pixel X of a longitude at zoom z (whole world = TILE * 2^z px wide).
export function lonToGlobalPx(lon: number, z: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}

// global-pixel Y of a latitude at zoom z. Y grows SOUTHWARD: the equator is the
// vertical midpoint, north is a smaller Y, south a larger one.
export function latToGlobalPx(lat: number, z: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

// The world wraps east–west at the antimeridian, so a tile X index is taken
// modulo 2^z into [0, 2^z). (True modulo — negative x wraps to the east edge.)
export function wrapTileX(x: number, z: number): number {
  const n = 2 ** z;
  return ((x % n) + n) % n;
}

// There is no wrap north–south: a tile Y is valid only inside the mercator square.
export function tileYInBounds(y: number, z: number): boolean {
  return y >= 0 && y < 2 ** z;
}

export interface FrameLayout {
  left: number; top: number;                 // global-px origin of the OUT_W×OUT_H crop
  tL: number; tR: number; tT: number; tB: number; // inclusive covering tile range
  canvasW: number; canvasH: number;          // stitched-canvas size (whole tiles)
  extractLeft: number; extractTop: number;   // where to cut the crop out of the canvas
}

// Given a center (lat,lon,z) and an output W×H, compute the covering tile range and
// the offset at which the W×H window is extracted from the stitched canvas.
//
// INVARIANT the renderer relies on (locked in the test): the extract window lies
// FULLY inside the stitched canvas — extractLeft ≥ 0, extractTop ≥ 0,
// extractLeft + W ≤ canvasW, extractTop + H ≤ canvasH — for ANY center/zoom. If it
// didn't, sharp's .extract() would read past the composited tiles and throw (or, at
// a fractional edge, bake a black bar into a frame).
export function frameLayout(lat: number, lon: number, z: number, outW: number, outH: number): FrameLayout {
  const cx = lonToGlobalPx(lon, z), cy = latToGlobalPx(lat, z);
  const left = Math.round(cx - outW / 2), top = Math.round(cy - outH / 2);
  const tL = Math.floor(left / TILE), tR = Math.floor((left + outW - 1) / TILE);
  const tT = Math.floor(top / TILE), tB = Math.floor((top + outH - 1) / TILE);
  const canvasW = (tR - tL + 1) * TILE, canvasH = (tB - tT + 1) * TILE;
  const extractLeft = left - tL * TILE, extractTop = top - tT * TILE;
  return { left, top, tL, tR, tT, tB, canvasW, canvasH, extractLeft, extractTop };
}
