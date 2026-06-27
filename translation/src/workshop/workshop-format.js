// Soundbite Workshop — pure formatting/grouping helpers.
//
// Extracted VERBATIM from workshop/index.js so they can be unit-tested
// headlessly (index.js imports DOM-coupled modules at load, so it can't be
// imported in a node/bun test). Behavior-identical to the inline copies.
//
//   formatTcShort  — the producer-facing timecode shown in the copy-with-
//                    timecode soundbite line ([speaker — TC] text). Member of
//                    the hour-drop formatter class; locked so a leading-MM:SS
//                    regression can never silently drop the hour from a
//                    producer's pasted reference.
//   countByTheme   — tallies how many soundbites carry each theme (the
//                    per-theme count badges).
//   themeColor     — stable per-theme accent color: same seed must always map
//                    to the same palette entry so reordering themes never
//                    reshuffles the colors.

import { formatPreciseTimecode, parseTimecodeToSeconds } from '../timecode-utils.js';

export function countByTheme(soundbites) {
  const c = {};
  for (const b of soundbites) {
    for (const t of b.themes || []) c[t] = (c[t] || 0) + 1;
  }
  return c;
}

// Resolve each soundbite to its transcript segment and order by start time.
// A bite whose `segmentNumber` has no matching segment (deleted/merged/renumbered
// after the soundbites were generated) is DROPPED — the workshop can't render a
// bite without its segment (renderBite needs seg). The crucial consequence: a
// section's header count must derive from THIS resolved list, NOT the raw
// per-theme tagged total (countByTheme), or the badge over-reports vs. the rows
// actually shown ("Theme · 5" while only 3 render). Both the theme sections and
// the unclassified section build their list — and therefore their count — here,
// so the two can never diverge.
export function resolveAndSortBites(soundbites, segByNum) {
  const map = segByNum || {};
  return (soundbites || [])
    .map(b => ({ bite: b, seg: map[b && b.segmentNumber] }))
    .filter(x => x.seg)
    .sort((a, b) => parseTimecodeToSeconds(a.seg.start) - parseTimecodeToSeconds(b.seg.start));
}

export function formatTcShort(tc) {
  if (!tc) return '0:00';
  const f = parseFloat(tc);
  if (!isNaN(f) && /^\d+\.?\d*$/.test(String(tc).trim())) return formatPreciseTimecode(f);
  // Already a timecode string
  const m = String(tc).match(/(\d+):(\d+):(\d+)/);
  if (m) return parseInt(m[1]) > 0 ? `${m[1]}:${m[2]}:${m[3]}` : `${parseInt(m[2])}:${m[3]}`;
  const m2 = String(tc).match(/(\d+):(\d+)/);
  if (m2) return `${parseInt(m2[1])}:${m2[2]}`;
  return String(tc);
}

// Stable per-theme accent color. Hash the theme name (or id fallback) so
// reordering doesn't reshuffle the palette assignment. Colors mirror the
// falling-glyphs palette for app-wide consistency.
export const THEME_PALETTE = [
  '#DD2C1E', // red
  '#520004', // burgundy
  '#004CFF', // blue
  '#0D5921', // green
  '#B45A00', // burnt orange
  '#C44D8E', // magenta
  '#00808A', // teal
  '#6B2D8B', // purple
  '#DAA520', // gold
  '#412C27', // sepia
];

export function themeColor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return THEME_PALETTE[Math.abs(h) % THEME_PALETTE.length];
}
