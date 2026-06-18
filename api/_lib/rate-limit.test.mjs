// Tests for the bounded in-memory rate limiter (api/_lib/rate-limit.js).
//
// The load-bearing property: the backing Map stays bounded under any number of
// distinct keys (the leak this fixes), while active-key limiting is unchanged.
// Imports the REAL shipped functions — no mirror to drift.

import assert from 'node:assert';
import {
  checkRateLimit,
  pruneRateBucket,
  RATE_BUCKET_MAX,
  RATE_BUCKET_LOW,
  DEFAULT_RATE_LIMIT,
} from './rate-limit.js';

let pass = 0;
let fail = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    failures.push(`${name}: ${err.message}`);
  }
}

// ── Inline RED proof: the OLD limiter (no pruning) leaks ─────────────────────
// Reconstruct the pre-fix rateLimitOk that only reset the count and never
// removed entries, and show it grows the Map without bound. The shipped
// checkRateLimit keeps it bounded under the identical input.
function oldRateLimitOk(bucket, key, now, windowMs, limit) {
  if (!key) return true;
  const entry = bucket.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  bucket.set(key, entry); // ← never deletes: unbounded
  return entry.count <= limit;
}

t('RED proof: old logic is unbounded under a burst of distinct keys', () => {
  const N = RATE_BUCKET_MAX + 1500; // comfortably over the cap
  const oldBucket = new Map();
  for (let i = 0; i < N; i++) oldRateLimitOk(oldBucket, `ip-${i}`, 1000, 60_000, 6);
  assert.strictEqual(oldBucket.size, N, 'old logic should retain every distinct key (the leak)');
});

t('FIX: checkRateLimit stays bounded under the same burst', () => {
  const N = RATE_BUCKET_MAX + 1500;
  const bucket = new Map();
  for (let i = 0; i < N; i++) checkRateLimit(bucket, `ip-${i}`, 1000, { limit: 6, windowMs: 60_000 });
  assert.ok(bucket.size <= RATE_BUCKET_MAX, `bucket size ${bucket.size} must stay <= ${RATE_BUCKET_MAX}`);
});

t('FIX: after a prune trims, the Map is at or below the low-water mark', () => {
  // All keys share the same window (still active), so nothing is expired —
  // the prune MUST still make forward progress by evicting oldest.
  const bucket = new Map();
  const N = RATE_BUCKET_MAX + 10;
  for (let i = 0; i < N; i++) checkRateLimit(bucket, `ip-${i}`, 1000, { windowMs: 60_000 });
  assert.ok(bucket.size <= RATE_BUCKET_MAX, 'never exceeds cap');
  // The cap-crossing insert prunes down to the low-water mark; the handful of
  // inserts after that (before the cap is hit again) sit just above it. So the
  // Map lands near low-water — far below the cap — not pinned at the cap.
  const slack = N - RATE_BUCKET_MAX; // inserts after the cap-crossing prune
  assert.ok(
    bucket.size <= RATE_BUCKET_LOW + slack,
    `size ${bucket.size} should be ~low-water (${RATE_BUCKET_LOW}, +${slack} slack)`,
  );
});

t('FIX: steady state stays bounded over many windows (the real leak)', () => {
  const bucket = new Map();
  let now = 1000;
  // Simulate 30k distinct one-shot IPs spread across many expired windows.
  for (let i = 0; i < 30_000; i++) {
    now += 100; // advance time so old windows expire
    checkRateLimit(bucket, `ip-${i}`, now, { windowMs: 60_000 });
  }
  assert.ok(bucket.size <= RATE_BUCKET_MAX, `steady-state size ${bucket.size} must stay bounded`);
});

// ── Active-key limiting correctness (must be byte-identical to before) ───────
t('allows up to the limit, rejects beyond it within one window', () => {
  const bucket = new Map();
  const now = 1000;
  for (let i = 1; i <= DEFAULT_RATE_LIMIT; i++) {
    assert.strictEqual(checkRateLimit(bucket, 'a', now, {}), true, `request ${i} should pass`);
  }
  assert.strictEqual(checkRateLimit(bucket, 'a', now, {}), false, 'request over the limit is rejected');
  assert.strictEqual(checkRateLimit(bucket, 'a', now, {}), false, 'and stays rejected');
});

t('window reset lets the key through again after resetAt', () => {
  const bucket = new Map();
  for (let i = 0; i < DEFAULT_RATE_LIMIT + 3; i++) checkRateLimit(bucket, 'a', 1000, { windowMs: 60_000 });
  assert.strictEqual(checkRateLimit(bucket, 'a', 1000, { windowMs: 60_000 }), false, 'exhausted within window');
  // Jump past the window — count resets, request passes.
  assert.strictEqual(checkRateLimit(bucket, 'a', 1000 + 60_001, { windowMs: 60_000 }), true, 'fresh window allows');
});

t('distinct keys are limited independently', () => {
  const bucket = new Map();
  const now = 1000;
  for (let i = 0; i < DEFAULT_RATE_LIMIT; i++) checkRateLimit(bucket, 'a', now, {});
  assert.strictEqual(checkRateLimit(bucket, 'a', now, {}), false, 'a exhausted');
  assert.strictEqual(checkRateLimit(bucket, 'b', now, {}), true, 'b unaffected by a');
});

t('falsy key is always allowed (cost guard, not DoS boundary)', () => {
  const bucket = new Map();
  assert.strictEqual(checkRateLimit(bucket, '', 1000, {}), true);
  assert.strictEqual(checkRateLimit(bucket, null, 1000, {}), true);
  assert.strictEqual(checkRateLimit(bucket, undefined, 1000, {}), true);
  assert.strictEqual(bucket.size, 0, 'falsy keys are never stored');
});

t('custom limit is honored', () => {
  const bucket = new Map();
  assert.strictEqual(checkRateLimit(bucket, 'a', 1000, { limit: 2 }), true);
  assert.strictEqual(checkRateLimit(bucket, 'a', 1000, { limit: 2 }), true);
  assert.strictEqual(checkRateLimit(bucket, 'a', 1000, { limit: 2 }), false);
});

// ── pruneRateBucket unit behavior ────────────────────────────────────────────
t('pruneRateBucket drops expired entries first (free reclaim)', () => {
  const bucket = new Map();
  bucket.set('old', { count: 3, resetAt: 500 });   // expired at now=1000
  bucket.set('live', { count: 1, resetAt: 9000 });  // still active
  pruneRateBucket(bucket, 1000, 1, 0); // tiny cap to force the path
  assert.ok(!bucket.has('old'), 'expired entry removed');
  assert.ok(bucket.has('live'), 'active entry kept when capacity allows after expiry reclaim');
});

t('pruneRateBucket evicts oldest when nothing is expired and still over cap', () => {
  const bucket = new Map();
  // All active (resetAt far in the future), insertion order a,b,c,d.
  for (const k of ['a', 'b', 'c', 'd']) bucket.set(k, { count: 1, resetAt: 99999 });
  pruneRateBucket(bucket, 1000, 2, 2); // max 2, low 2 → must trim to 2
  assert.strictEqual(bucket.size, 2, 'trimmed to low-water');
  assert.ok(bucket.has('c') && bucket.has('d'), 'kept the two newest');
  assert.ok(!bucket.has('a') && !bucket.has('b'), 'evicted the two oldest');
});

t('pruneRateBucket is a no-op under the cap', () => {
  const bucket = new Map();
  bucket.set('a', { count: 1, resetAt: 99999 });
  bucket.set('b', { count: 1, resetAt: 99999 });
  pruneRateBucket(bucket, 1000, 100, 50);
  assert.strictEqual(bucket.size, 2, 'nothing evicted when under cap and nothing expired');
});

t('pruneRateBucket guarantees forward progress (cap reached, none expired)', () => {
  const bucket = new Map();
  for (let i = 0; i < RATE_BUCKET_MAX + 200; i++) bucket.set(`k${i}`, { count: 1, resetAt: 99999 });
  pruneRateBucket(bucket, 1000); // defaults
  assert.ok(bucket.size <= RATE_BUCKET_LOW, `forward progress: ${bucket.size} <= ${RATE_BUCKET_LOW}`);
});

console.log(`rate-limit: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
