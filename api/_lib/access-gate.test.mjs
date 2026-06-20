// Lock for the AUTH GATE in api/_lib/access.js — the single most load-bearing
// security function in the repo (checkAccess runs on EVERY /api/* endpoint).
//
// access.test.mjs already locks the JWT cache eviction (pruneJwtCache). This
// file locks the GATE DECISION itself — previously ZERO coverage:
//   1. BEARER_JWT_SHAPE — the security pre-filter regex. Per the source
//      comment, an adversarial audit found hand-crafted `eyJabc.eyJdef.xxx`
//      strings were getting past the gate and opening /api/claude (Opus,
//      64k tokens) + every paid endpoint to the open internet. The fix added
//      a real /auth/v1/user round-trip BEHIND the shape check. A regression
//      that loosened this regex (or dropped the network verify it gates) would
//      re-open that exact hole — so it's locked here, hard.
//   2. readHeader — the dual-runtime header reader (Web Headers .get() vs
//      Node plain lowercase-keyed object). A regression breaking either
//      runtime silently breaks the gate on that runtime.
//   3. checkAccess — the decision: dev-mode open, correct x-access-code,
//      wrong/absent code, and the bearer path. Tested deterministically by
//      controlling env vars (ACCESS_CODE + the SUPABASE_* vars), so the
//      valid-shape-bearer path returns false WITHOUT any network round-trip.
//
// No live bug found (the gate is correct) — this is a verifier-layer LOCK,
// mutation-proven to go RED on any regression. Only source change: `export`
// added to readHeader + BEARER_JWT_SHAPE (behavior-identical).

import assert from 'node:assert/strict';
import { checkAccess, readHeader, BEARER_JWT_SHAPE } from './access.js';

let pass = 0, fail = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

// ---- env isolation -------------------------------------------------------
// checkAccess reads process.env at call time. Snapshot + clear the auth vars
// so the test environment is deterministic regardless of the host's env.
const ENV_KEYS = ['ACCESS_CODE', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];
const ENV_SNAPSHOT = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function clearAuthEnv() { for (const k of ENV_KEYS) delete process.env[k]; }
function restoreAuthEnv() {
  for (const k of ENV_KEYS) {
    if (ENV_SNAPSHOT[k] === undefined) delete process.env[k];
    else process.env[k] = ENV_SNAPSHOT[k];
  }
}

// ---- request builders ----------------------------------------------------
// Edge: req.headers is a Web Headers object with .get()
function edgeReq(headers = {}) { return { headers: new Headers(headers) }; }
// Node: req.headers is a plain object with lowercase keys
function nodeReq(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return { headers: h };
}

// A well-formed JWT-shaped token (3 base64url parts, first two start `eyJ`).
const VALID_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

console.log('access.js — auth gate (checkAccess + readHeader + BEARER_JWT_SHAPE)');

// ========================================================================
// 1. BEARER_JWT_SHAPE — the security pre-filter
// ========================================================================

// Inline RED proof: a NAIVE shape that doesn't require three eyJ-anchored
// segments would accept a 2-part token; the real shape must reject it.
t('RED: a naive 2-part-accepting shape would pass a non-JWT (real shape rejects)', () => {
  const naive = /^Bearer\s+(\S+)$/i; // accepts any non-space blob
  const twoPart = 'Bearer eyJa.eyJb';
  assert.ok(naive.test(twoPart), 'naive shape wrongly accepts a 2-part token');
  assert.equal(BEARER_JWT_SHAPE.test(twoPart), false, 'real shape must reject a 2-part token');
});

t('accepts a well-formed Bearer JWT and captures the token', () => {
  const m = BEARER_JWT_SHAPE.exec(`Bearer ${VALID_JWT}`);
  assert.ok(m, 'should match a well-formed bearer JWT');
  assert.equal(m[1], VALID_JWT, 'capture group must be the exact token (no "Bearer ")');
});

t('case-insensitive scheme: lowercase "bearer" accepted', () => {
  assert.ok(BEARER_JWT_SHAPE.test(`bearer ${VALID_JWT}`));
});

t('tolerates trailing whitespace', () => {
  assert.ok(BEARER_JWT_SHAPE.test(`Bearer ${VALID_JWT}   `));
});

t('rejects: missing the "Bearer" scheme', () => {
  assert.equal(BEARER_JWT_SHAPE.test(VALID_JWT), false);
});

t('rejects: only two segments (no signature)', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer eyJhbGci.eyJzdWIi'), false);
});

t('rejects: first segment not eyJ-anchored', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer abc.eyJzdWIi.sig'), false);
});

t('rejects: second segment not eyJ-anchored', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer eyJhbGci.abc.sig'), false);
});

t('rejects: empty signature segment', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer eyJhbGci.eyJzdWIi.'), false);
});

t('rejects: whitespace inside the token', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer eyJh bGci.eyJzdWIi.sig'), false);
});

t('rejects: empty / whitespace-only header', () => {
  assert.equal(BEARER_JWT_SHAPE.test(''), false);
  assert.equal(BEARER_JWT_SHAPE.test('   '), false);
  assert.equal(BEARER_JWT_SHAPE.test('Bearer '), false);
});

t('rejects: illegal base64url chars (+ / =) in segments', () => {
  assert.equal(BEARER_JWT_SHAPE.test('Bearer eyJh+Gci.eyJzdWIi.si/g='), false);
});

// Documents the DESIGN: the shape is intentionally permissive — a hand-crafted
// `eyJabc.eyJdef.xxx` PASSES the shape (that was the audited hole), and the
// /auth/v1/user round-trip behind it is the real gate. Locking this so nobody
// "tightens" the shape and assumes it's now sufficient on its own.
t('DESIGN: a hand-crafted eyJ.eyJ.x string passes the SHAPE (verify is the real gate)', () => {
  assert.ok(BEARER_JWT_SHAPE.test('Bearer eyJabc.eyJdef.xxx'),
    'shape is a cheap pre-filter; network verify behind it is what actually authorizes');
});

// ========================================================================
// 2. readHeader — dual-runtime header reader
// ========================================================================

// Inline RED proof: a Node-blind reader (only .get) would return '' for a
// plain Node object; the real reader must read the lowercase key.
t('RED: a .get-only reader is blind to Node plain-object headers (real reader is not)', () => {
  const nodeBlind = (req, name) => (typeof req?.headers?.get === 'function' ? req.headers.get(name) || '' : '');
  const req = nodeReq({ 'x-access-code': 'secret' });
  assert.equal(nodeBlind(req, 'x-access-code'), '', 'node-blind reader wrongly returns empty');
  assert.equal(readHeader(req, 'x-access-code'), 'secret', 'real reader must read the Node header');
});

t('Edge Headers: reads value via .get()', () => {
  assert.equal(readHeader(edgeReq({ 'x-access-code': 'abc' }), 'x-access-code'), 'abc');
});

t('Edge Headers: absent header → empty string', () => {
  assert.equal(readHeader(edgeReq({}), 'x-access-code'), '');
});

t('Node object: reads via lowercased key (case-insensitive name)', () => {
  const req = nodeReq({ 'x-access-code': 'abc' });
  assert.equal(readHeader(req, 'X-Access-Code'), 'abc', 'name must be lowercased before lookup');
  assert.equal(readHeader(req, 'x-access-code'), 'abc');
});

t('Node object: array-valued header joined with ", "', () => {
  assert.equal(readHeader({ headers: { 'x-access-code': ['a', 'b'] } }, 'x-access-code'), 'a, b');
});

t('Node object: absent / null value → empty string', () => {
  assert.equal(readHeader(nodeReq({}), 'x-access-code'), '');
  assert.equal(readHeader({ headers: { 'x-access-code': null } }, 'x-access-code'), '');
});

t('no/undefined headers object → empty string (no throw)', () => {
  assert.equal(readHeader({}, 'x-access-code'), '');
  assert.equal(readHeader(undefined, 'x-access-code'), '');
  assert.equal(readHeader(null, 'x-access-code'), '');
});

// ========================================================================
// 3. checkAccess — the gate decision (env-controlled, no network)
// ========================================================================

t('dev mode: ACCESS_CODE unset → null (open), both runtimes', async () => {
  clearAuthEnv();
  assert.equal(await checkAccess(edgeReq({})), null);
  assert.equal(await checkAccess(nodeReq({})), null);
});

t('correct x-access-code → null (Edge runtime)', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  assert.equal(await checkAccess(edgeReq({ 'x-access-code': 'sekret' })), null);
});

t('correct x-access-code → null (Node runtime)', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  assert.equal(await checkAccess(nodeReq({ 'x-access-code': 'sekret' })), null);
});

t('wrong x-access-code → 401 Response with unauthorized body', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  const r = await checkAccess(edgeReq({ 'x-access-code': 'nope' }));
  assert.ok(r instanceof Response, 'must return a Response, not null');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('content-type'), 'application/json');
  const body = await r.json();
  assert.equal(body.error, 'unauthorized');
});

t('no headers at all → 401', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  const r = await checkAccess(edgeReq({}));
  assert.ok(r instanceof Response);
  assert.equal(r.status, 401);
});

t('garbage Authorization (invalid shape) → 401, no network', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  const r = await checkAccess(edgeReq({ authorization: 'Bearer not-a-jwt' }));
  assert.ok(r instanceof Response);
  assert.equal(r.status, 401);
});

// The bearer path EXERCISED deterministically: a SHAPE-valid token, but with
// SUPABASE_URL/ANON unset, makes verifyBearerJwt return false BEFORE any
// fetch — so checkAccess denies with no network round-trip.
t('valid-shape bearer but no Supabase configured → 401 (verify fails, no network)', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  // (SUPABASE_* deliberately left unset by clearAuthEnv)
  const r = await checkAccess(edgeReq({ authorization: `Bearer ${VALID_JWT}` }));
  assert.ok(r instanceof Response, 'unverifiable bearer must be denied');
  assert.equal(r.status, 401);
});

t('x-access-code beats an invalid bearer (header precedence)', async () => {
  clearAuthEnv();
  process.env.ACCESS_CODE = 'sekret';
  const r = await checkAccess(edgeReq({ 'x-access-code': 'sekret', authorization: 'Bearer junk' }));
  assert.equal(r, null, 'a correct code authorizes regardless of a bad bearer');
});

// ---- run (sequential, async-aware) --------------------------------------
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); }
}
restoreAuthEnv();

console.log(`\naccess.js gate: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
