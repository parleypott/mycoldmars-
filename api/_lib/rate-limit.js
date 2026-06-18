// Best-effort, in-memory per-key rate limiter for long-lived edge instances.
//
// The backing Map is module-scoped on an edge instance, so it persists across
// requests. A naive limiter that only resets the per-key count (but never
// removes the entry) grows the Map without bound — one entry per distinct key
// (IP) ever seen — a slow memory leak on a public, anonymous endpoint exposed
// to arbitrary IPs. This module keeps the Map bounded.
//
// Bounding strategy (same shape as api/_lib/access.js pruneJwtCache, which
// fixed the identical class of leak): when the Map exceeds a hard cap, prune.
// Pruning guarantees forward progress — first drop entries whose window has
// already expired (free; they'd reset anyway), then, if still over the cap,
// evict the OLDEST entries (Map insertion order) down to a low-water mark.
//
// Evicting a still-active entry is harmless: the limiter is a cost guard, not a
// security boundary, so a dropped key just starts a fresh window on its next
// request (at worst it gets a few extra allowed requests, never fewer). Active
// callers are never starved.

export const RATE_BUCKET_MAX = 5000; // hard cap on distinct keys tracked at once
export const RATE_BUCKET_LOW = 2500; // trim down to this when the cap is hit

export const DEFAULT_RATE_LIMIT = 6; // requests per window per key
export const DEFAULT_RATE_WINDOW_MS = 60_000;

// Keep `bucket` bounded. Returns the same Map (mutated in place).
export function pruneRateBucket(bucket, now, max = RATE_BUCKET_MAX, low = RATE_BUCKET_LOW) {
  // 1. Drop expired windows first — they carry no live count and would reset
  //    on next access anyway, so this is a free reclaim.
  for (const [key, entry] of bucket) {
    if (now > entry.resetAt) bucket.delete(key);
  }
  // 2. Still over the cap (a burst of distinct, still-active keys)? Evict the
  //    oldest entries down to the low-water mark. Map iteration is insertion
  //    order, so the first keys are the oldest. This guarantees the Map can
  //    never exceed `low` after a prune, regardless of expiry state.
  if (bucket.size > max) {
    const toEvict = bucket.size - low;
    let evicted = 0;
    for (const key of bucket.keys()) {
      if (evicted >= toEvict) break;
      bucket.delete(key);
      evicted++;
    }
  }
  return bucket;
}

// Record one request for `key` against `bucket` at time `now`; returns true if
// the request is within the limit, false if it should be rejected. A falsy key
// (couldn't extract one) is always allowed — this is a cost guard, not the DoS
// boundary, so we never reject just because we can't identify the caller.
export function checkRateLimit(bucket, key, now, opts = {}) {
  const limit = opts.limit ?? DEFAULT_RATE_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const max = opts.max ?? RATE_BUCKET_MAX;
  const low = opts.low ?? RATE_BUCKET_LOW;

  if (!key) return true;

  const entry = bucket.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  bucket.set(key, entry);

  // Keep the Map bounded. Lazy: only scan/evict once we exceed the cap, so the
  // common path stays O(1). The just-touched key is the newest insertion, so
  // oldest-eviction won't drop it unless the cap is pathologically small.
  if (bucket.size > max) pruneRateBucket(bucket, now, max, low);

  return entry.count <= limit;
}
