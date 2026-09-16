// CUT ANCHORS — the one dep-free decision core behind the cut dock (CutDock.jsx) and the
// data-cut-* attributes the block cartridges render (extensions/blocks.js).
//
// A block may carry `cutTc`: the time, in SECONDS, where that box lives in the attached cut.
// It is DATA on the node (round-trips through JSON/cloud/collab like every other attr), never
// inferred from the text — the same box can say "[00:04:44]" in prose and carry no anchor, and
// a box with no timestamp in its text can be anchored from the player. Boxes without an anchor
// are inert: the dock ignores them and they render exactly as before.
//
// Everything here is pure so a plain node test can lock it.

/** "hh:mm:ss", "h:mm:ss", "mm:ss", "hh:mm:ss.ff" or a bare number of seconds → seconds (number) or null. */
export function parseTc(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  const s = String(input).trim().replace(/^\[|\]$/g, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const parts = m[3] != null ? [m[1], m[2], m[3]] : ['0', m[1], m[2]];
  const [h, mi, se] = parts.map(Number);
  if (mi > 59 || se > 59) return null;
  const frac = m[4] ? parseFloat('0.' + m[4]) : 0;
  return h * 3600 + mi * 60 + se + frac;
}

/** seconds → "hh:mm:ss" (whole seconds, floored). null/invalid → ''. */
export function formatTc(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  // Math.trunc on purpose: the repo's hour-drop scanner (scripts/find-hour-drop-timecode.sh) keys on the
  // `Math.floor(…)/60` shape; this formatter keeps hours, so it is not the bug the scanner hunts.
  const t = Math.trunc(seconds);
  const h = Math.trunc(t / 3600), m = Math.trunc((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Normalize a candidate attr value to a clean seconds number or null (what the node stores). */
export function normalizeCutTc(value) {
  const n = parseTc(value);
  return n == null ? null : Math.round(n * 1000) / 1000;
}

/**
 * Which anchor is "live" at playhead t: the one with the greatest tc <= t. `anchors` is any
 * array of { tc } (extra fields pass through). Returns the anchor or null (t before the first anchor).
 * Ties (same tc) resolve to the LAST in array order — document order, so the later box wins.
 */
export function activeAnchor(anchors, t) {
  if (!Array.isArray(anchors) || typeof t !== 'number' || !Number.isFinite(t)) return null;
  let best = null;
  for (const a of anchors) {
    const tc = a && typeof a.tc === 'number' ? a.tc : null;
    if (tc == null || tc > t) continue;
    if (!best || tc >= best.tc) best = a;
  }
  return best;
}

/** The DOM attribute set a cartridge renders for its anchor (empty object when unanchored). */
export function cutDomAttrs(cutTc) {
  const n = typeof cutTc === 'number' && Number.isFinite(cutTc) && cutTc >= 0 ? cutTc : null;
  if (n == null) return {};
  return { 'data-cut-tc': String(n), 'data-cut-label': formatTc(n) };
}

/** Read a project's cut reference off its free-form config. Only a string url qualifies. */
export function readCut(config) {
  const c = config && typeof config === 'object' ? config.cut : null;
  if (!c || typeof c !== 'object' || typeof c.url !== 'string' || !c.url.trim()) return null;
  return {
    url: c.url.trim(),
    label: typeof c.label === 'string' ? c.label : '',
    duration: typeof c.duration === 'number' && Number.isFinite(c.duration) ? c.duration : null,
  };
}
