/**
 * Format decimal seconds into a human-readable timecode.
 * e.g. 105.4 → "1:45.4", 3930.12 → "1:05:30.1"
 */
export function formatPreciseTimecode(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00.0';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sWhole = Math.floor(s);
  const frac = Math.round((s - sWhole) * 10); // one decimal place

  const sPad = sWhole < 10 && (h > 0 || m > 0) ? `0${sWhole}` : `${sWhole}`;

  if (h > 0) {
    const mPad = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mPad}:${sPad}.${frac}`;
  }
  return `${m}:${sPad}.${frac}`;
}

/**
 * Parse a timecode string back to seconds.
 * Handles: "1:45.4", "1:05:30.1", "00:01:45,400", "105.4" (bare decimal)
 */
export function parseTimecodeToSeconds(tc) {
  if (!tc) return 0;

  // HH:MM:SS.f or HH:MM:SS,mmm
  const m3 = tc.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (m3) {
    const ms = m3[4].length <= 1 ? parseInt(m3[4]) / 10 : parseInt(m3[4].padEnd(3, '0').slice(0, 3)) / 1000;
    return parseInt(m3[1]) * 3600 + parseInt(m3[2]) * 60 + parseInt(m3[3]) + ms;
  }

  // HH:MM:SS
  const m3b = tc.match(/^(\d+):(\d+):(\d+)$/);
  if (m3b) return parseInt(m3b[1]) * 3600 + parseInt(m3b[2]) * 60 + parseInt(m3b[3]);

  // M:SS.f
  const m2 = tc.match(/(\d+):(\d+)\.(\d+)/);
  if (m2) {
    const frac = parseInt(m2[3]) / Math.pow(10, m2[3].length);
    return parseInt(m2[1]) * 60 + parseInt(m2[2]) + frac;
  }

  // M:SS
  const m2b = tc.match(/^(\d+):(\d+)$/);
  if (m2b) return parseInt(m2b[1]) * 60 + parseInt(m2b[2]);

  // Bare decimal seconds
  const f = parseFloat(tc);
  return isNaN(f) ? 0 : f;
}
