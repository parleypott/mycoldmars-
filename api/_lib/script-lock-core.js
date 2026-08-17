// Offline Lock — PURE core (no network, no env), shared by api/script-lock.js (lifecycle)
// and api/script-doc.js (PUT enforcement) so "who may write" is decided by ONE tested predicate.

// A lock unheard-from for this long is STALE and may be broken by the next acquirer. 24h covers a
// single flight + layover; a live online tab heartbeats well inside it so it never trips.
export const LOCK_STALE_MS = 24 * 60 * 60 * 1000;

export function isStale(lockedAt, now = Date.now()) {
  if (lockedAt == null) return true;               // no timestamp → treat as stale
  const t = Date.parse(lockedAt);
  if (!Number.isFinite(t)) return true;
  return (now - t) > LOCK_STALE_MS;
}

// Is this lock row currently held by SOMEONE OTHER than the caller, and still fresh? A caller who
// presents the matching lock_token counts as the holder even if their JWT id is momentarily unknown
// (offline-flush edge). Missing row / no holder / mine / stale → not blocking.
export function lockBlocks(row, { userId = null, token = null } = {}, now = Date.now()) {
  if (!row || typeof row !== 'object') return false;
  const holder = (typeof row.locked_by === 'string' && row.locked_by) ? row.locked_by : null;
  if (!holder) return false;                                        // unlocked
  if (userId && holder === userId) return false;                    // I hold it (by identity)
  if (token && typeof row.lock_token === 'string' && row.lock_token && token === row.lock_token) return false; // by token
  if (isStale(row.locked_at, now)) return false;                    // abandoned — breakable
  return true;                                                      // someone else, fresh → blocks
}

// Shape a lock row into the wire view for a given caller. NEVER leaks lock_token.
export function lockView(row, userId, now = Date.now()) {
  const holder = row && typeof row.locked_by === 'string' && row.locked_by ? row.locked_by : null;
  const stale = holder ? isStale(row.locked_at, now) : false;
  const active = holder && !stale;
  return {
    locked: !!active,
    lockedBy: active ? holder : null,
    lockedByLabel: active ? (row.locked_by_label ?? null) : null,
    lockedByColor: active ? (row.locked_by_color ?? null) : null,
    lockedAt: active ? (row.locked_at ?? null) : null,
    stale,
    mine: !!(active && userId && holder === userId),
  };
}
