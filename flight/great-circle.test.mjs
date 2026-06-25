// Locks greatCirclePoints() in flight/index.html — the great-circle slerp that builds the
// DC -> Palau reveal arc on Johnny's served globe piece. Sibling of camera-core.test.mjs
// (which locks the camera pan); this one covers the arc geometry itself, which had ZERO
// coverage and a latent NaN landmine:
//
//   const A = Math.sin((1-f)*d)/Math.sin(d);
//   const B = Math.sin(f*d)/Math.sin(d);
//
// When the two endpoints COINCIDE (d≈0) or are ANTIPODAL (d≈π), Math.sin(d)≈0, so A and B
// divide by ~0 and EVERY emitted point is [NaN, NaN] — a dead arc / blown-up render. DC and
// Palau are distinct and not antipodal, so it's latent today, but a coincident/antipodal pair
// must never NaN. Fix: guard on |sin(d)| and fall back to a finite straight lat + short-way
// lng lerp. This test EXTRACTS the real shipped toRad/toDeg/greatCirclePoints from index.html
// at runtime (brace-matching + new Function), so it can't drift from a mirror, and is
// mutation-proven to go RED if the degenerate guard is removed.
//
// run: node flight/great-circle.test.mjs   (or via `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, 'index.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Bind the REAL shipped function (greatCirclePoints depends on toRad/toDeg).
const greatCirclePoints = new Function(
  extractFn(HTML, 'toRad') + '\n' +
  extractFn(HTML, 'toDeg') + '\n' +
  extractFn(HTML, 'greatCirclePoints') + '\nreturn greatCirclePoints;'
)();

const DC = [-77.037, 38.907];
const PALAU = [134.479, 7.515];

let pass = 0, fail = 0;
const ok = (msg, cond) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };
const eq = (msg, a, b, tol = 1e-9) => {
  if (Math.abs(a - b) <= tol) pass++; else { fail++; console.error(`FAIL: ${msg}\n   expected ${b}, got ${a}`); }
};
const allFinite = (pts) => pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));

// ── normal DC -> Palau arc: shape + endpoints + finiteness ──
{
  const pts = greatCirclePoints(DC, PALAU, 300);
  ok('DC->Palau returns n+1 points', pts.length === 301);
  ok('DC->Palau arc is all finite', allFinite(pts));
  eq('first point lng = DC', pts[0][0], DC[0], 1e-9);
  eq('first point lat = DC', pts[0][1], DC[1], 1e-9);
  eq('last point lng = Palau', pts[300][0], PALAU[0], 1e-9);
  eq('last point lat = Palau', pts[300][1], PALAU[1], 1e-9);
}

// ── non-degenerate output must be UNCHANGED by the guard ──
// Recompute the original slerp inline (the pre-fix formula) and require an exact match,
// proving the guard only adds a branch and leaves the normal path byte-for-byte identical.
{
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  function ref(from, to, n) {
    const lat1 = toRad(from[1]), lon1 = toRad(from[0]);
    const lat2 = toRad(to[1]),   lon2 = toRad(to[0]);
    const d = 2 * Math.asin(Math.sqrt(
      Math.pow(Math.sin((lat2-lat1)/2),2) +
      Math.cos(lat1)*Math.cos(lat2)*Math.pow(Math.sin((lon2-lon1)/2),2)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const A = Math.sin((1-f)*d)/Math.sin(d), B = Math.sin(f*d)/Math.sin(d);
      const x = A*Math.cos(lat1)*Math.cos(lon1) + B*Math.cos(lat2)*Math.cos(lon2);
      const y = A*Math.cos(lat1)*Math.sin(lon1) + B*Math.cos(lat2)*Math.sin(lon2);
      const z = A*Math.sin(lat1)               + B*Math.sin(lat2);
      pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x*x+y*y)))]);
    }
    return pts;
  }
  const got = greatCirclePoints(DC, PALAU, 60), want = ref(DC, PALAU, 60);
  let identical = true;
  for (let i = 0; i < want.length; i++) {
    if (Math.abs(got[i][0]-want[i][0]) > 1e-12 || Math.abs(got[i][1]-want[i][1]) > 1e-12) identical = false;
  }
  ok('non-degenerate arc is byte-identical to the original slerp (zero regression)', identical);
  // and the great-circle midpoint climbs north over the Pacific (~lat 55, lng near antimeridian)
  const mid = greatCirclePoints(DC, PALAU, 300)[150];
  ok('DC->Palau midpoint arcs north (lat > 50, well above both endpoints)', mid[1] > 50);
  ok('DC->Palau midpoint sits near the antimeridian (|lng| > 150)', Math.abs(mid[0]) > 150);
}

// ── DEGENERATE GUARD — the mutation-proven core (RED if the guard is removed) ──
{
  // Coincident endpoints (d≈0): old code -> 0/0 -> every point NaN.
  const same = greatCirclePoints([12.5, -3.4], [12.5, -3.4], 50);
  ok('coincident endpoints: n+1 points', same.length === 51);
  ok('coincident endpoints never NaN (guard works; RED without it)', allFinite(same));
  ok('coincident endpoints collapse to the point', same.every(p => Math.abs(p[0]-12.5) < 1e-9 && Math.abs(p[1]+3.4) < 1e-9));

  // Antipodal endpoints (d≈π): sin(π)≈0 -> old code also NaN.
  const anti = greatCirclePoints([0, 0], [180, 0], 40);
  ok('antipodal endpoints: n+1 points', anti.length === 41);
  ok('antipodal endpoints never NaN (guard works; RED without it)', allFinite(anti));
  ok('antipodal endpoints stay finite end to end', Number.isFinite(anti[0][0]) && Number.isFinite(anti[40][0]));

  // Near-antipodal (slightly off π) must also stay finite.
  const nearAnti = greatCirclePoints([0, 0], [179.9999, 0.0001], 30);
  ok('near-antipodal endpoints never NaN', allFinite(nearAnti));
}

console.log(`flight great-circle: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
