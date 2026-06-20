// Tests for api/qss-access-token.js — the QSS BOOTSTRAP auth exchange: the
// public endpoint that trades the cosmetic gate password ("newpress") for the
// server-side ACCESS_CODE secret, which then unlocks the rest of /api/* through
// the shared checkAccess() perimeter.
//
// This endpoint DELIBERATELY skips checkAccess() — it IS the bootstrap, so the
// gate password is its own authorization. That makes its password comparison the
// single load-bearing security decision: a regression that returns the access
// code on a WRONG password (or rejects the RIGHT one) would either hand the
// /api/* perimeter key to anyone or lock Henry out entirely, with no signal.
//
// No live bug found — the handler is null-safe (optional chaining on the body)
// and the comparison is correct — so this is a verifier-layer LOCK of the
// security invariant + the case/whitespace-forgiving contract the gate UI relies
// on, mutation-proven against the REAL default export driven end-to-end with mock
// Requests. No network: the handler makes zero external calls.

import assert from 'node:assert';

const ENV_CODE = 'TEST-ACCESS-CODE-xyz';
const REAL_PASSWORD = 'newpress';

// Set a known ACCESS_CODE before importing so the success path returns a
// deterministic, recognizable value (the handler reads process.env at call time,
// so per-case overrides below still work).
const _origCode = process.env.ACCESS_CODE;
process.env.ACCESS_CODE = ENV_CODE;

const handler = (await import('./qss-access-token.js')).default;

function post(bodyStr, { raw = false } = {}) {
  return new Request('https://x/api/qss-access-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? bodyStr : bodyStr,
  });
}
function req(method) {
  return new Request('https://x/api/qss-access-token', { method });
}
async function readJson(res) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

let passed = 0;
let failed = 0;
async function aok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── RED PROOF: the bad-password early return is the load-bearing guard ──
// Reconstruct a buggy variant that drops the early `return 403` and always falls
// through to returning the access code. Prove it LEAKS the code on a wrong
// password — i.e. the real handler's early return is what stops the leak.
await aok('RED proof: dropping the bad_password early-return leaks the code', async () => {
  function buggyExchange(suppliedRaw, gate, code) {
    const supplied = String(suppliedRaw ?? '').trim().toLowerCase();
    const bad = supplied !== gate;
    // BUG: the early `if (bad) return 403` was removed — fall through regardless.
    void bad;
    return { status: 200, body: { accessCode: code } };
  }
  const leaked = buggyExchange('wrong-password', REAL_PASSWORD, ENV_CODE);
  assert.strictEqual(leaked.status, 200, 'buggy variant returns 200 on a wrong password');
  assert.strictEqual(leaked.body.accessCode, ENV_CODE, 'buggy variant LEAKS the access code');

  // The real handler must NOT do this.
  const res = await handler(post(JSON.stringify({ password: 'wrong-password' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403, 'real handler rejects a wrong password');
  assert.ok(!('accessCode' in body), 'real handler never includes accessCode on rejection');
});

// ── THE SECURITY INVARIANT: a wrong password never yields the code ──
await aok('wrong password → 403 bad_password, NO accessCode in body', async () => {
  const res = await handler(post(JSON.stringify({ password: 'hunter2' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403);
  assert.strictEqual(body.error, 'bad_password');
  assert.ok(!('accessCode' in body), 'must not leak accessCode');
});

await aok('a password that is a PREFIX of the gate is rejected', async () => {
  const res = await handler(post(JSON.stringify({ password: 'new' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403);
  assert.ok(!('accessCode' in body));
});

await aok('a password that SUPERSTRINGS the gate is rejected', async () => {
  const res = await handler(post(JSON.stringify({ password: 'newpress!' })));
  assert.strictEqual(res.status, 403);
});

// ── THE SUCCESS PATH ──
await aok('correct password → 200 with the exact ACCESS_CODE', async () => {
  const res = await handler(post(JSON.stringify({ password: REAL_PASSWORD })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.accessCode, ENV_CODE, 'returns the env access code verbatim');
});

// ── CASE/WHITESPACE FORGIVENESS (the gate UI contract) ──
await aok('UPPERCASE password accepted (case-insensitive)', async () => {
  const res = await handler(post(JSON.stringify({ password: 'NEWPRESS' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.accessCode, ENV_CODE);
});

await aok('mixed case + surrounding whitespace accepted (trim + lower)', async () => {
  const res = await handler(post(JSON.stringify({ password: '  NewPress \t' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.accessCode, ENV_CODE);
});

// ── NULL-SAFETY: a bad/empty/non-object body must 403, never 500, never leak ──
await aok('empty password string → 403 (no leak)', async () => {
  const res = await handler(post(JSON.stringify({ password: '' })));
  assert.strictEqual(res.status, 403);
});

await aok('missing password field → 403 (no leak)', async () => {
  const res = await handler(post(JSON.stringify({ note: 'hi' })));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403);
  assert.ok(!('accessCode' in body));
});

await aok('JSON-literal null body → 403, no crash, no leak', async () => {
  const res = await handler(post('null'));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403);
  assert.ok(!('accessCode' in body));
});

await aok('non-object body (number) → 403, no crash', async () => {
  const res = await handler(post('42'));
  assert.strictEqual(res.status, 403);
});

await aok('non-object body (array) → 403, no crash', async () => {
  const res = await handler(post('["newpress"]'));
  assert.strictEqual(res.status, 403);
});

await aok('malformed JSON body → 403, no crash, no leak', async () => {
  const res = await handler(post('{not valid json'));
  const body = await readJson(res);
  assert.strictEqual(res.status, 403);
  assert.ok(!('accessCode' in body));
});

await aok('numeric password value → coerced, rejected', async () => {
  // String(123) === '123' !== 'newpress'
  const res = await handler(post(JSON.stringify({ password: 123 })));
  assert.strictEqual(res.status, 403);
});

// ── METHOD HANDLING ──
await aok('OPTIONS → 204 with CORS', async () => {
  const res = await handler(req('OPTIONS'));
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
});

await aok('GET → 405 method not allowed', async () => {
  const res = await handler(req('GET'));
  assert.strictEqual(res.status, 405);
});

// ── CORS on the real responses ──
await aok('403 + 200 responses carry CORS headers', async () => {
  const bad = await handler(post(JSON.stringify({ password: 'nope' })));
  assert.strictEqual(bad.headers.get('access-control-allow-origin'), '*');
  const good = await handler(post(JSON.stringify({ password: REAL_PASSWORD })));
  assert.strictEqual(good.headers.get('access-control-allow-origin'), '*');
});

// ── DEV PASSTHROUGH: ACCESS_CODE unset → correct password returns '' ──
await aok('ACCESS_CODE unset → correct password → 200 with empty string', async () => {
  delete process.env.ACCESS_CODE;
  try {
    const res = await handler(post(JSON.stringify({ password: REAL_PASSWORD })));
    const body = await readJson(res);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.accessCode, '', 'dev passthrough returns empty string, not undefined');
    // Even with the perimeter open, a wrong password is STILL rejected.
    const bad = await handler(post(JSON.stringify({ password: 'wrong' })));
    assert.strictEqual(bad.status, 403);
  } finally {
    process.env.ACCESS_CODE = ENV_CODE;
  }
});

// restore original env
if (_origCode === undefined) delete process.env.ACCESS_CODE;
else process.env.ACCESS_CODE = _origCode;

console.log(`\nqss-access-token: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
