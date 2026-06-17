// Tests for the JWT verification cache eviction in api/_lib/access.js.
//
// THE BUG (fixed): the old eviction only deleted EXPIRED entries, then broke
// at size <= MAX/2. A burst of >MAX distinct still-valid (unexpired) tokens
// within the 60s TTL window therefore deleted NOTHING — the per-instance edge
// cache grew unbounded (a slow memory leak). The fix guarantees forward
// progress: drop expired first, then evict oldest valid entries until bounded.
//
// Evicting a valid cache entry is harmless: the cache is a pure latency
// optimization over the /auth/v1/user round-trip, so a dropped entry just
// gets re-validated next time. Auth correctness is unaffected.

import assert from 'node:assert/strict';
import { pruneJwtCache } from './access.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); }
}

const MAX = 200;
const TARGET = Math.floor(MAX / 2); // low-water mark the fix trims down to

// Build a Map of `n` entries, all VALID (expiresAt in the future).
function validCache(n, now) {
  const c = new Map();
  for (let i = 0; i < n; i++) c.set('tok' + i, { ok: true, expiresAt: now + 60_000 });
  return c;
}

// The OLD eviction logic, reproduced verbatim, for the RED proof.
function oldPrune(cache, now, max = MAX) {
  if (cache.size > max) {
    for (const [k, v] of cache) {
      if (v.expiresAt <= now) cache.delete(k);
      if (cache.size <= max / 2) break;
    }
  }
}

console.log('access.js — JWT cache eviction');

// ---- RED proof: the old logic does NOT bound an all-valid cache ----
t('RED: old logic leaves 250 all-valid entries unbounded (the bug)', () => {
  const now = 1_000_000;
  const c = validCache(250, now);
  oldPrune(c, now);
  // Nothing expired, so nothing was deleted — cache stays at 250 (> MAX).
  assert.equal(c.size, 250, 'old logic should fail to bound the cache');
});

// ---- GREEN: the fix bounds it ----
t('all-valid burst is trimmed to the low-water mark', () => {
  const now = 1_000_000;
  const c = validCache(250, now);
  pruneJwtCache(c, now);
  assert.equal(c.size, TARGET, `should trim to ${TARGET}`);
});

t('evicts the OLDEST entries, keeps the newest', () => {
  const now = 1_000_000;
  const c = validCache(250, now); // tok0 (oldest) .. tok249 (newest)
  pruneJwtCache(c, now);
  // After trimming 250 -> 100, the 150 oldest (tok0..tok149) are gone,
  // the 100 newest (tok150..tok249) remain.
  assert.ok(!c.has('tok0'), 'oldest evicted');
  assert.ok(!c.has('tok149'), 'oldest band evicted');
  assert.ok(c.has('tok150'), 'newest band kept');
  assert.ok(c.has('tok249'), 'newest kept');
});

t('prefers dropping expired entries before valid ones', () => {
  const now = 1_000_000;
  const c = new Map();
  // 150 expired (oldest) + 100 valid (newest) = 250 total.
  for (let i = 0; i < 150; i++) c.set('exp' + i, { ok: true, expiresAt: now - 1 });
  for (let i = 0; i < 100; i++) c.set('val' + i, { ok: true, expiresAt: now + 60_000 });
  pruneJwtCache(c, now);
  // Dropping the 150 expired alone takes size to 100 == TARGET, so pass 1
  // stops there and every valid entry survives.
  assert.equal(c.size, TARGET);
  for (let i = 0; i < 100; i++) assert.ok(c.has('val' + i), 'valid entry survived');
});

t('mixed: drops all expired, then oldest valid to reach the mark', () => {
  const now = 1_000_000;
  const c = new Map();
  // 50 expired + 200 valid = 250. Dropping 50 expired -> 200, still > TARGET,
  // so pass 2 drops 100 oldest VALID -> 100.
  for (let i = 0; i < 50; i++) c.set('exp' + i, { ok: true, expiresAt: now - 1 });
  for (let i = 0; i < 200; i++) c.set('val' + i, { ok: false, expiresAt: now + 60_000 });
  pruneJwtCache(c, now);
  assert.equal(c.size, TARGET);
  // All expired gone.
  for (let i = 0; i < 50; i++) assert.ok(!c.has('exp' + i), 'expired evicted');
  // Newest valid kept.
  assert.ok(c.has('val199'), 'newest valid kept');
});

t('no-op when at or below the cap', () => {
  const now = 1_000_000;
  const c = validCache(MAX, now);
  pruneJwtCache(c, now);
  assert.equal(c.size, MAX, 'exactly MAX is left alone');

  const c2 = validCache(10, now);
  pruneJwtCache(c2, now);
  assert.equal(c2.size, 10, 'small cache untouched');
});

t('one over the cap trims to the low-water mark (amortized)', () => {
  const now = 1_000_000;
  const c = validCache(MAX + 1, now);
  pruneJwtCache(c, now);
  // Trims well below the cap so it does not re-trim on every subsequent insert.
  assert.equal(c.size, TARGET);
});

t('repeated pruning stays bounded (steady state)', () => {
  const now = 1_000_000;
  const c = new Map();
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 120; i++) c.set(`r${round}_${i}`, { ok: true, expiresAt: now + 60_000 });
    pruneJwtCache(c, now);
    assert.ok(c.size <= MAX, `round ${round}: size ${c.size} must stay <= ${MAX}`);
  }
});

t('respects a custom max argument', () => {
  const now = 1_000_000;
  const c = validCache(20, now);
  pruneJwtCache(c, now, 10); // target = 5
  assert.equal(c.size, 5);
});

console.log(`\naccess.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
