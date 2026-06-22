// Corpus browse filter + sort — the central logic behind every Hunter browse
// tab and the keepability filter on Johnny's footage tool.
//
// Extracted VERBATIM from main.js's getFilteredCorpus so it can be unit-tested
// (main.js read it from module globals; this takes them as params). The live
// getFilteredCorpus is now a thin wrapper that passes the globals through.
//
// Three stages, in order:
//   1. analyzed-only — drop units with no analysis output_text (pending noise).
//   2. tier filter — keep only the selected tier (raw/script/selects/finished/…).
//   3. keepability band — high (>=7) / mid (4–6) / low (<=3) on the 0–10 scale,
//      via normalizeKeepability (the 0–1→0–10 bridge). A null score is excluded.
//   4. sort — keep-desc / keep-asc by normalized keepability (null sinks to the
//      bottom in each direction: -1 for desc, 99 for asc).
//
// This is the exact logic that was BROKEN before the keepability scale fix
// (raw 0–1 scores never reached the 0–10 bands → high/mid tabs came up empty).
// Locking the end-to-end band behavior pins that class shut.
//
// The stage-1 filter ALWAYS runs, so the result is always a fresh array — the
// in-place .sort() never mutates the caller's units.
import { normalizeKeepability } from './keepability.js';

export function filterAndSortCorpus(units, { tier = '', keep = '', sort = 'default' } = {}) {
  let filtered = (units || []).filter(u => u.analyses?.length > 0 && u.analyses[0]?.output_text);
  if (tier) {
    filtered = filtered.filter(u => (u.media_assets?.tier || '') === tier);
  }
  if (keep) {
    filtered = filtered.filter(u => {
      const score = normalizeKeepability(u.analyses?.[0]?.output_json?.keepability_score);
      if (score == null) return false;
      if (keep === 'high') return score >= 7;
      if (keep === 'mid') return score >= 4 && score <= 6;
      if (keep === 'low') return score <= 3;
      return true;
    });
  }
  if (sort === 'keep-desc') {
    filtered.sort((a, b) => (normalizeKeepability(b.analyses?.[0]?.output_json?.keepability_score) ?? -1) - (normalizeKeepability(a.analyses?.[0]?.output_json?.keepability_score) ?? -1));
  } else if (sort === 'keep-asc') {
    filtered.sort((a, b) => (normalizeKeepability(a.analyses?.[0]?.output_json?.keepability_score) ?? 99) - (normalizeKeepability(b.analyses?.[0]?.output_json?.keepability_score) ?? 99));
  }
  return filtered;
}
