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

// Cosine similarity of two equal-length numeric vectors. Returns 0 for
// missing/mismatched/zero-magnitude inputs (a safe "no signal" value).
//
// The `!a || !b || a.length !== b.length` guard is LOAD-BEARING here, not
// cosmetic: scene-detection.mjs feeds this `unit.embedding` / `other.embedding`
// straight from parseEmbedding (line 87/155). Before parseEmbedding was hardened
// below, a null/malformed embedding row reached this function as `null`, and the
// old unguarded `for (i < a.length)` did `null.length` → TypeError, which aborts
// the ENTIRE scene-detection run (one bad embedding row → zero scenes for the
// whole project). The guard degrades that to sim=0 (the clip strands as its own
// singleton scene) instead of crashing. The length-mismatch check also stops a
// short/corrupt vector from yielding a bogus partial similarity. This is the
// consolidated, hardened copy — behaviourally identical to api/_lib/semantic-
// search.js (tested) and hunter/worker/cross-tier-core.js (tested).
export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}

// Parse a stored embedding (PostgREST: JSON-array string, JSON array, or
// paren/bracket literal) into a clean numeric vector, or null if it can't be
// trusted. GUARANTEES a non-empty array of finite numbers or null — never a
// poison `[NaN]` vector, a non-array scalar (e.g. JSON.parse("42") === 42), or
// an empty array, all of which the OLD copy returned and which then slipped
// past scene-detection.mjs's `embeddingMap.has(id)` filter (the key is set even
// when the value is null/garbage) to reach cosineSim. Matches the hardened
// sibling copies in api/_lib/semantic-search.js and cross-tier-core.js.
export function parseEmbedding(emb) {
  let arr = null;
  if (Array.isArray(emb)) {
    arr = emb;
  } else if (typeof emb === 'string') {
    try {
      const parsed = JSON.parse(emb);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // not JSON — fall through to the literal parser below
    }
    if (!arr) {
      arr = emb.replace(/[[\]()]/g, '').split(',').map(Number);
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
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
