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
