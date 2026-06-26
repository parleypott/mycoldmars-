// Pure keyframe-interpolation core for the animatedcrazy animation tool.
//
// Extracted VERBATIM from main.js so the playback math (the code that produces
// every frame the user sees on the canvas AND exports to GIF) is unit-testable
// without the DOM. main.js imports these; the values are byte-identical to the
// old inline copies, so the live tool's behavior is unchanged.

export function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

export function lerp(a, b, t) { return a + (b - a) * t; }

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}

export function lerpColor(a, b, t) {
  if (!a || !b) return a || b;
  try {
    const [ar, ag, ab] = hexToRgb(a);
    const [br, bg, bb] = hexToRgb(b);
    return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  } catch { return a; }
}

export const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    else if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    else if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    else { t -= 2.625 / d1; return n1 * t * t + 0.984375; }
  },
  elastic: t => {
    if (t === 0 || t === 1) return t;
    const c = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
  },
};

// Cumulative start time of each keyframe: times[i] = sum of kfs[0..i-1].duration.
// The last entry equals the total animation span (the trailing keyframe's own
// duration is a hold and is never part of the interpolated span).
export function keyframeTimes(kfs) {
  const times = [0];
  for (let i = 1; i < kfs.length; i++) times[i] = times[i - 1] + (kfs[i - 1].duration || 0);
  return times;
}

// Total animation span = sum of every keyframe's duration EXCEPT the last.
// < 2 keyframes => no span.
export function totalAnimDuration(kfs) {
  if (kfs.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < kfs.length - 1; i++) t += (kfs[i].duration || 0);
  return t;
}

// Map a playback time to the segment [i, i+1] it falls in and the eased local
// progress within that segment. Assumes >= 2 keyframes (callers early-return for
// 0/1). Returns { i, eased } where eased = EASINGS[kfs[i].easing](localT).
export function segmentAtTime(kfs, timeSec) {
  const times = keyframeTimes(kfs);
  const total = times[times.length - 1];
  timeSec = clamp(timeSec, 0, total);

  let i = 0;
  for (let k = 0; k < kfs.length - 1; k++) {
    if (timeSec >= times[k] && timeSec <= times[k + 1]) { i = k; break; }
    if (k === kfs.length - 2) i = k;
  }
  const dur = (kfs[i].duration || 0);
  const localT = dur > 0 ? clamp((timeSec - times[i]) / dur, 0, 1) : 1;
  const eased = (EASINGS[kfs[i].easing] || EASINGS.linear)(localT);
  return { i, eased };
}

// ─── Shape geometry (pure, DOM-free) ───
// Extracted VERBATIM from main.js's renderers so the SVG-string math is
// unit-testable. main.js imports these; output is byte-identical to the old
// inline copies, so the live tool draws exactly the same shapes.

// Points string for an N-spoke star, alternating outer/inner radius. numPoints
// is clamped to [3, 12] spokes; the first vertex points straight up.
export function starPoints(numPoints, rxOuter, ryOuter) {
  const n = Math.max(3, Math.min(12, numPoints));
  const inner = 0.42;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : inner;
    const x = Math.cos(a) * rxOuter * r;
    const y = Math.sin(a) * ryOuter * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

// Build a smooth SVG path `d` string from a squiggle shape's unit-space points
// (Catmull-Rom-ish smoothing -> cubic beziers). Endpoints duplicate their
// neighbour so the curve doesn't overshoot at the ends.
export function squigglePathD(s) {
  const pts = (s.points || []).map(([ux, uy]) => [ux * s.width, uy * s.height]);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}
