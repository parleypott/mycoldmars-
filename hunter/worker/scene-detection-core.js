// Pure cores for hunter/worker/scene-detection.mjs — extracted so they're
// unit-testable headlessly (the worker script runs main() at module load and
// touches Supabase, so it can't be imported directly).
//
// TIMEZONE FIX (mirrors the client fix in hunter/src/scene-grouping.js, commit
// 6c3b06a): extractDateFromClipName builds the clip's wall-clock timestamp from
// the filename. It MUST construct that Date in UTC (Date.UTC), because every
// readback in scene-detection.mjs uses .toISOString() (UTC) for the day/time
// labels and the per-day buckets. The old code used `new Date(y, m, d, h, min)`
// — a machine-LOCAL Date — so on any non-UTC machine (Johnny edits on Pacific)
// a late-evening clip ("…-2330") was labeled the NEXT day and every time shifted
// by the runner's offset, and clips from two different shoot days collapsed into
// one wrong day bucket. Constructing in UTC makes the label round-trip the
// filename's wall-clock on ANY machine. Gap math is unaffected — all timestamps
// shift uniformly, so temporal gaps are preserved.

export function cosineSim(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}

export function parseEmbedding(emb) {
  if (Array.isArray(emb)) return emb;
  if (typeof emb === 'string') {
    try { return JSON.parse(emb); } catch {}
    return emb.replace(/[[\]()]/g, '').split(',').map(Number);
  }
  return null;
}

export function extractDateFromClipName(name) {
  // Pattern: 20241007-1332-C8757_Proxy.MP4 → date=2024-10-07, time=13:32
  const m = name?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return null;
  // UTC so the filename's wall-clock round-trips through .toISOString() readback
  // on any machine (see TIMEZONE FIX above).
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5])));
}

export function extractCameraId(name) {
  // Pattern: C8757 from 20241007-1332-C8757_Proxy.MP4
  const m = name?.match(/C(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// Day ("YYYY-MM-DD") and time ("HH:MM") labels for a clip timestamp, read back
// in UTC to match the wall-clock the filename encoded. Used for scene labels and
// the per-day buckets in scene-detection.mjs.
export function sceneDateLabels(date) {
  if (!(date instanceof Date) || isNaN(date)) return { day: null, time: null };
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// Map an hour-of-day (0-23) to a shoot time-of-day label. Pure. Callers MUST
// pass the hour read the SAME way the day/time labels are read — i.e. UTC
// (date.getUTCHours()), since the Date is constructed in UTC by
// extractDateFromClipName and the labels come from .toISOString(). Reading this
// hour via getHours() (local) while the day/time come from toISOString() (UTC)
// is the bug this consolidation fixes: on a non-UTC machine the scene's
// shoot_day would say one thing and its time_of_day another.
export function timeOfDayFromHour(hour) {
  if (hour < 6) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'golden-hour';
  if (hour < 21) return 'evening';
  return 'night';
}
