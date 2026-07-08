/*
 * admin-users-bootstrap-ratelimit.test.mjs — the anonymous bootstrap door gets a per-IP
 * rate limit (token bucket: burst of 5, refilling 5/min). Locked here:
 *   • the pure bucket math (burst, refusal, refill, per-key isolation, prune bound)
 *   • the REAL handler: 6th anonymous bootstrap from one IP → 429 with Retry-After,
 *     and NO Supabase round-trip for the refused call
 *   • a different IP is a different bucket (Ryan's real seed never starves behind a prober)
 *   • the response still leaks nothing (no emails, no passwords) — the existing contract
 *
 * Drives the real default export with mock Requests + stubbed fetch. No network.
 * Run: bun api/admin-users-bootstrap-ratelimit.test.mjs
 */
import assert from 'node:assert/strict';

delete process.env.ACCESS_CODE;
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_EMAILS = 'admin@test.com';

const mod = await import('./admin-users.js');
const { default: handler, takeRateToken, pruneRateBuckets, BOOTSTRAP_RATE, clientIpKey } = mod;

// ── fetch stub: Supabase admin API, counts round-trips ──────────────────────
let adminCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.startsWith('https://supa.test/auth/v1/admin/users')) {
    adminCalls++;
    if (method === 'GET') return new Response(JSON.stringify({ users: [{ email: 'admin@test.com' }] }), { status: 200 });
    return new Response(JSON.stringify({ id: 'seeded' }), { status: 200 });
  }
  if (u === 'https://supa.test/auth/v1/user') {
    return new Response(JSON.stringify({ id: 'x', email: 'admin@test.com' }), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${method} ${u}`);
};

function bootstrapReq(ip) {
  return new Request('https://example.test/api/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ action: 'bootstrap' }),
  });
}

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/* ---- pure bucket math ---- */
await t('token bucket: burst of 5 then refusal, refill restores', async () => {
  const buckets = new Map();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(takeRateToken(buckets, 'ip1', t0).ok, true, `burst call ${i + 1} allowed`);
  }
  const refused = takeRateToken(buckets, 'ip1', t0);
  assert.equal(refused.ok, false, '6th immediate call refused');
  assert.ok(refused.retryAfterSeconds >= 1 && refused.retryAfterSeconds <= 12, `retryAfter sane (got ${refused.retryAfterSeconds})`);
  // 12s later one token (5/min = 1 per 12s) has refilled.
  assert.equal(takeRateToken(buckets, 'ip1', t0 + 12_000).ok, true, 'refill readmits after 12s');
  assert.equal(takeRateToken(buckets, 'ip1', t0 + 12_000).ok, false, 'but only ONE token refilled');
});

await t('token bucket: keys are independent, capacity never overfills', async () => {
  const buckets = new Map();
  const t0 = 0;
  for (let i = 0; i < 5; i++) takeRateToken(buckets, 'a', t0);
  assert.equal(takeRateToken(buckets, 'b', t0).ok, true, 'a starved bucket never blocks another key');
  // A year of idle refill still caps at capacity.
  assert.ok(buckets.get('a').tokens <= BOOTSTRAP_RATE.capacity);
  takeRateToken(buckets, 'a', t0 + 365 * 24 * 3600 * 1000);
  assert.ok(buckets.get('a').tokens <= BOOTSTRAP_RATE.capacity, 'refill clamps at capacity');
});

await t('pruneRateBuckets: bounded — a flood of distinct IPs cannot grow the map forever', async () => {
  const buckets = new Map();
  for (let i = 0; i < 600; i++) takeRateToken(buckets, `ip-${i}`, 0);
  pruneRateBuckets(buckets, 0, 500);
  assert.ok(buckets.size <= 500, `pruned under the cap (got ${buckets.size})`);
});

/* ---- the real handler ---- */
await t('handler: 6th anonymous bootstrap from one IP → 429, no Supabase round-trip', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await handler(bootstrapReq('203.0.113.9'));
    assert.equal(res.status, 200, `bootstrap ${i + 1} within burst passes`);
  }
  const before = adminCalls;
  const res = await handler(bootstrapReq('203.0.113.9'));
  assert.equal(res.status, 429);
  assert.ok(res.headers.get('Retry-After'), 'carries Retry-After');
  const out = await res.json();
  assert.equal(out.error, 'rate_limited');
  assert.equal(adminCalls, before, 'refused call must never reach Supabase');
  // Still leaks nothing — same law as the 200 path.
  const text = JSON.stringify(out);
  assert.ok(!text.includes('admin@test.com'), '429 body must not leak admin emails');
});

await t('handler: a different IP is a different bucket (auto-seed keeps working)', async () => {
  const res = await handler(bootstrapReq('198.51.100.7'));
  assert.equal(res.status, 200, 'fresh IP passes while the prober is limited');
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.ok(!JSON.stringify(out).includes('@'), 'bootstrap response still carries counts only');
});

/* ---- IP key extraction ---- */
await t('clientIpKey: first x-forwarded-for hop, x-real-ip fallback, unknown floor', async () => {
  const mk = (headers) => new Request('https://x.test/', { headers });
  assert.equal(clientIpKey(mk({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIpKey(mk({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8');
  assert.equal(clientIpKey(mk({})), 'unknown');
});

console.log(`admin-users-bootstrap-ratelimit: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
