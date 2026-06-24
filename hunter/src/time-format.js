// Pure date/time display helpers for The Hunter dashboard.
//
// Both render DB-set timestamps (asset.updated_at, job.created_at) into the
// ops/feed UI. A present-but-UNPARSEABLE value (corrupt/legacy/tampered row,
// schema drift) makes `new Date(x)` an Invalid Date whose .getTime() is NaN —
// and the old inline copies leaked that straight to the user:
//   formatTimeAgo(new Date('garbage')) -> "NaNd ago"
//   formatDate('garbage')              -> "INVALID DATE"  (the try/catch was
//     useless: .toLocaleDateString() on an Invalid Date returns the string
//     "Invalid Date", it never throws).
// Both now degrade an un-orderable date to the same '—' marker the call sites
// already use for an ABSENT timestamp. Byte-identical for every valid date.

// Relative "Nm/h/d ago" stamp from a Date object.
export function formatTimeAgo(date) {
  const ms = date && typeof date.getTime === 'function' ? date.getTime() : NaN;
  if (!Number.isFinite(ms)) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Short "MON DD" date stamp from an ISO string.
export function formatDate(isoStr) {
  try {
    // nullish/empty -> '—' (new Date(null) is the epoch, a misleading 1970
    // render; call sites already use '—' for an absent timestamp).
    if (isoStr == null || isoStr === '') return '—';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch { return '—'; }
}

// Full locale date stamp ("6/23/2026") — the bare .toLocaleDateString() form
// the project-list / snapshot / learned-context / taste-context rows use.
// Same Invalid-Date trap as formatDate: a corrupt value renders "Invalid Date"
// and a null renders a misleading 1970 epoch ("1/1/1970"). Degrades to the
// fallback ('' by default — the empty render those inline rows already use for
// an absent timestamp). Byte-identical for every valid date.
export function fmtLocaleDate(isoStr, fallback = '') {
  if (isoStr == null || isoStr === '') return fallback;
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString();
}
