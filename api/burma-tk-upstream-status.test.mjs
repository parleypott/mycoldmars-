// Lock for the upstream-status mapping in burma-tk.js (commit 32ce62f, incident 2026-07-30).
//
// THE INCIDENT: fc-deep calls returned 502, read as the platform's 60s function clamp
// killing a 240s run — and hours went into chasing function time limits. The real cause was
// an Anthropic spend cap: upstream returned a plain 400 ("You have reached your specified API
// usage limits…"), and the handler's `!res.ok` branch mapped EVERY upstream status to 502,
// so a billing 400 read as a gateway fault.
//
// THE FIX (this is what we lock): a 4xx from upstream is a REQUEST/ACCOUNT condition (bad
// key, quota, spend cap, rate limit) — it will not fix itself on retry and the operator must
// read it. So the handler now:
//   • passes an upstream 4xx through as `upstream_rejected` (HTTP 422; 429 keeps 429),
//   • extracts the verbatim JSON error.message so the writer sees the real reason,
//   • keeps 5xx / unusable statuses as 502 (`anthropic N: …`),
//   • guards the status EXPLICITLY (Number.isFinite && >= 100), never a truthiness gate.
//
// Why this is load-bearing beyond a nicer error page: the client's isUnavailable() latches
// the whole VERIFY ALL batch OFF on `upstream_rejected`/`usage limits` (see verify-all-core.js
// + its test). Mislabel the spend cap as 502 again and the batch reads it as an infra blip,
// grinds all N claims into the same wall, and burns the shared rate budget discovering the
// billing cap N times. So the SERVER label and the CLIENT latch are one chain — this file
// locks the server half; verify-all-core.test.mjs locks the client half.

import assert from 'node:assert';
import handler from './burma-tk.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  RED:', name); }
}

function mockReq(body) { return { method: 'POST', json: async () => body }; }
async function call(body, fetchImpl) {
  const realFetch = globalThis.fetch;
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real'; // get PAST the key guard to reach the fetch
  globalThis.fetch = fetchImpl;
  try {
    const res = await handler(mockReq(body));
    let parsed = null; try { parsed = await res.json(); } catch { /* ignore */ }
    return { status: res.status, body: parsed };
  } finally {
    globalThis.fetch = realFetch;
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; else delete process.env.ANTHROPIC_API_KEY;
  }
}
const upstream = (status, body) => async () => ({ ok: false, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const ARGS = { mode: 'fc', marker: 'the junta controls about 21% of the country', block: 'B', context: 'C' };

// ── 1. THE INCIDENT CASE: an Anthropic spend-cap 400 surfaces as a readable 422, not a 502 ──
{
  const capMsg = 'You have reached your specified API usage limits. You will regain access on 2026-08-01.';
  const r = await call(ARGS, upstream(400, { type: 'error', error: { type: 'invalid_request_error', message: capMsg } }));
  ok('spend-cap 400: mapped to 422, NOT 502', r.status === 422);
  ok('spend-cap 400: error is the latchable sentinel upstream_rejected', r.body && r.body.error === 'upstream_rejected');
  ok('spend-cap 400: the verbatim billing message reaches the writer', r.body && r.body.message && r.body.message.includes(capMsg));
  ok('spend-cap 400: upstreamStatus preserved', r.body && r.body.upstreamStatus === 400);
}

// ── 2. Other 4xx account conditions pass through as 422 upstream_rejected ────────────────────
{
  const r401 = await call(ARGS, upstream(401, { error: { message: 'invalid x-api-key' } }));
  ok('bad-key 401: 422 upstream_rejected (account condition, not gateway)', r401.status === 422 && r401.body.error === 'upstream_rejected');
  ok('bad-key 401: upstreamStatus is the real 401', r401.body.upstreamStatus === 401);
}

// ── 3. 429 KEEPS its own meaning (retry-later), still upstream_rejected ──────────────────────
{
  const r = await call(ARGS, upstream(429, { error: { message: 'rate limited, retry after 30s' } }));
  ok('rate-limit 429: stays 429 (not flattened to 422)', r.status === 429);
  ok('rate-limit 429: still upstream_rejected + carries the detail', r.body.error === 'upstream_rejected' && /rate limited/.test(r.body.message || ''));
}

// ── 4. Genuine upstream faults (5xx) stay 502 — NOT upstream_rejected ────────────────────────
{
  const r502 = await call(ARGS, upstream(503, 'upstream 503 gateway page'));
  ok('gateway 503: stays 502 (a real infra fault)', r502.status === 502);
  ok('gateway 503: error is anthropic N (NOT the account sentinel)', /^anthropic 503:/.test(r502.body.error) && r502.body.error !== 'upstream_rejected');
  ok('gateway 503: no client-latch message (this SHOULD retry)', r502.body.message === undefined);
  const r500 = await call(ARGS, upstream(500, 'internal'));
  ok('gateway 500: stays 502', r500.status === 502 && r500.body.error !== 'upstream_rejected');
}

// ── 5. The EXPLICIT status guard: an unusable status (<100 / non-finite) falls to 502, ──────
//      never a truthiness gate that would rewrite a legitimate 0 into 422.
{
  const r0 = await call(ARGS, upstream(0, 'weird'));
  ok('status 0: unusable → 502, upstreamStatus coerced to 502', r0.status === 502 && r0.body.upstreamStatus === 502 && r0.body.error !== 'upstream_rejected');
  const rNaN = await call(ARGS, async () => ({ ok: false, status: NaN, text: async () => 'nan status' }));
  ok('status NaN: unusable → 502', rNaN.status === 502 && rNaN.body.upstreamStatus === 502);
}

// ── 6. A non-JSON 4xx body: detail degrades to the raw slice, still 422 upstream_rejected ───
{
  const r = await call(ARGS, upstream(400, '<html>Bad Request plain text</html>'));
  ok('non-JSON 400: still 422 upstream_rejected (no throw on JSON.parse)', r.status === 422 && r.body.error === 'upstream_rejected');
  ok('non-JSON 400: raw body slice carried as the detail', /Bad Request plain text/.test(r.body.message || ''));
}

// ── 7. MUTATION ORACLE: the OLD "everything is 502" mapping fails the incident case. ────────
//      Reconstruct the pre-fix branch and prove it would have re-buried the spend cap.
{
  const oldMap = (status /*, text */) => ({ status: 502, error: `anthropic ${status}: …` }); // pre-32ce62f
  const legacy = oldMap(400);
  ok('mutation: the OLD map returns 502 for a 400 (the bug we fixed)', legacy.status === 502);
  ok('mutation: the OLD map never emits upstream_rejected (client would NOT latch → grinds all N)', legacy.error !== 'upstream_rejected');
}

console.log(`burma-tk-upstream-status: ${pass} passed, ${fail} failed`);
assert.strictEqual(fail, 0, `${fail} assertion(s) failed`);
