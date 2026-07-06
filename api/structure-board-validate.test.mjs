/**
 * First coverage + contract-lock for the STRUCTURE (public/structure/) team-board
 * sync endpoint, api/structure-board.js.
 *
 * This is the PUBLIC, service-role write endpoint that Johnny's editors and he
 * push the shared board through while he travels — last-write-wins blob sync,
 * one row per slug. It had ZERO tests. This drives the REAL shipped handler (no
 * extraction, no source change) with a mocked fetch, and pins the input contract:
 *
 *   1. slug gate      — GET + POST reject a missing / malformed slug (400 BAD_SLUG).
 *   2. json gate      — a non-JSON POST body is a clean 400 BAD_JSON, never a crash.
 *   3. state shape     — null / array / string / missing state is 400 BAD_STATE.
 *   4. BYTE cap        — the 2MB cap counts real UTF-8 BYTES, not UTF-16 .length.
 *                        The load-bearing assertion: an over-BYTE blob whose
 *                        .length (UTF-16 units) is UNDER the cap still 413s. A
 *                        naive `serialized.length > MAX_BYTES` check — the exact
 *                        class fixed ~15x across the other state-sync validators
 *                        (winchester / nile-flights / commentbank) — would have
 *                        WRONGLY let this CJK blob through. This test goes RED if
 *                        structure-board ever regresses to a char-count cap.
 *   5. method + CORS   — OPTIONS preflight 204; a non-GET/POST verb is 405.
 *   6. happy path      — a valid slug + object state upserts and echoes the row.
 *   7. source-binding  — the handler still measures bytes via TextEncoder.
 *
 * Run: bun api/structure-board-validate.test.mjs   (or: bun run test)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_BYTES = 2 * 1024 * 1024; // mirrors api/structure-board.js

// The handler reads Supabase env vars at MODULE LOAD, and short-circuits to
// 500 NO_DB before any validation if they're missing. Set dummy vars FIRST so
// the validation path is reachable, THEN dynamic-import the handler.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://dummy.local';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy-service-key';
const { default: handler } = await import('./structure-board.js');

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// --- request helpers -------------------------------------------------------
function req(method, { url = 'http://x/api/structure-board', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new Request(url, init);
}
async function call(r, fetchImpl) {
  const orig = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    const res = await handler(r);
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON body */ }
    return { status: res.status, json, res };
  } finally {
    globalThis.fetch = orig;
  }
}
// A fetch stub that returns a canned Supabase response and NEVER touches the net.
const stubFetch = (rows, status = 200) => async () =>
  new Response(JSON.stringify(rows), { status, headers: { 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------------------
// 1. slug gate
// ---------------------------------------------------------------------------
{
  const r = await call(req('GET', { url: 'http://x/api/structure-board' })); // no slug
  eq(r.status, 400, 'GET without a slug -> 400');
  eq(r.json?.error?.code, 'BAD_SLUG', 'GET missing slug -> BAD_SLUG');
}
{
  const r = await call(req('GET', { url: 'http://x/api/structure-board?slug=has%20space' }));
  eq(r.status, 400, 'GET with a malformed slug (space) -> 400');
  eq(r.json?.error?.code, 'BAD_SLUG', 'GET malformed slug -> BAD_SLUG');
}
{
  const r = await call(req('POST', { body: { slug: 'no good!', state: {} } }));
  eq(r.status, 400, 'POST with a malformed slug -> 400');
  eq(r.json?.error?.code, 'BAD_SLUG', 'POST malformed slug -> BAD_SLUG');
}

// ---------------------------------------------------------------------------
// 2. json gate — a non-JSON body must be a clean 400, not a thrown 500
// ---------------------------------------------------------------------------
{
  const r = await call(req('POST', { body: 'this is not json{' }));
  eq(r.status, 400, 'POST with a non-JSON body -> 400');
  eq(r.json?.error?.code, 'BAD_JSON', 'non-JSON body -> BAD_JSON (no crash)');
}

// ---------------------------------------------------------------------------
// 3. state shape — null / array / string / missing all rejected (with valid slug)
// ---------------------------------------------------------------------------
for (const [label, state] of [
  ['null', null],
  ['an array', []],
  ['a string', 'nope'],
  ['a number', 42],
]) {
  const r = await call(req('POST', { body: { slug: 'palau', state } }));
  eq(r.status, 400, `POST state = ${label} -> 400`);
  eq(r.json?.error?.code, 'BAD_STATE', `POST state = ${label} -> BAD_STATE`);
}
{
  const r = await call(req('POST', { body: { slug: 'palau' } })); // state missing entirely
  eq(r.status, 400, 'POST with no state field -> 400 BAD_STATE');
  eq(r.json?.error?.code, 'BAD_STATE', 'missing state -> BAD_STATE');
}

// ---------------------------------------------------------------------------
// 4. BYTE cap — load-bearing: an over-BYTE-but-under-.length CJK blob still 413s
// ---------------------------------------------------------------------------
{
  // '啊' = 1 UTF-16 code unit, 3 UTF-8 bytes. Pick N so bytes > cap but .length < cap.
  const N = 720_000; // ~2.16MB UTF-8, ~0.72M UTF-16 units
  const state = { t: '啊'.repeat(N) };
  const serialized = JSON.stringify(state);
  const utf16Len = serialized.length;
  const utf8Bytes = new TextEncoder().encode(serialized).length;

  // Prove the trap conditions hold before asserting the handler dodges it.
  ok(utf16Len < MAX_BYTES, 'RED-proof: the CJK blob is UNDER the cap by UTF-16 .length');
  ok(utf8Bytes > MAX_BYTES, 'the CJK blob is OVER the cap by real UTF-8 bytes');

  const r = await call(req('POST', { body: { slug: 'palau', state } }));
  eq(r.status, 413, 'over-BYTE CJK state -> 413 (byte-accurate cap, NOT char count)');
  eq(r.json?.error?.code, 'TOO_LARGE', 'over-byte state -> TOO_LARGE');
}
{
  // A genuinely small state must NOT trip the cap.
  const r = await call(
    req('POST', { body: { slug: 'palau', state: { cards: [] } } }),
    stubFetch([{ state: { cards: [] }, updated_at: '2026-07-06T00:00:00Z' }])
  );
  ok(r.status !== 413, 'a tiny state does NOT trip the byte cap');
}

// ---------------------------------------------------------------------------
// 5. method + CORS
// ---------------------------------------------------------------------------
{
  const r = await call(req('OPTIONS'));
  eq(r.status, 204, 'OPTIONS preflight -> 204');
}
{
  const r = await call(req('PUT', { body: { slug: 'palau', state: {} } }));
  eq(r.status, 405, 'an unsupported verb (PUT) -> 405');
  eq(r.json?.error?.code, 'METHOD_NOT_ALLOWED', 'PUT -> METHOD_NOT_ALLOWED');
}

// ---------------------------------------------------------------------------
// 6. happy path — valid slug + object state upserts and echoes the row
// ---------------------------------------------------------------------------
{
  const row = { state: { cards: [{ id: 'a' }] }, updated_at: '2026-07-06T12:00:00Z' };
  const r = await call(req('POST', { body: { slug: 'palau', state: row.state } }), stubFetch([row]));
  eq(r.status, 200, 'a valid POST upsert -> 200');
  eq(r.json?.updated_at, row.updated_at, 'the upsert echoes updated_at back to the client');
  eq(r.json?.state, row.state, 'the upsert echoes the persisted state');
}
{
  // GET an existing board.
  const row = { state: { cards: [] }, updated_at: '2026-07-06T09:00:00Z' };
  const r = await call(req('GET', { url: 'http://x/api/structure-board?slug=palau' }), stubFetch([row]));
  eq(r.status, 200, 'GET an existing board -> 200');
  eq(r.json?.updated_at, row.updated_at, 'GET returns the row updated_at');
}
{
  // GET a slug with no row -> 404 (well-formed slug, empty result set).
  const r = await call(req('GET', { url: 'http://x/api/structure-board?slug=ghost' }), stubFetch([]));
  eq(r.status, 404, 'GET a slug with no cloud row -> 404');
  eq(r.json?.error?.code, 'NOT_FOUND', 'empty result set -> NOT_FOUND');
}

// ---------------------------------------------------------------------------
// 7. source-binding — the byte cap still measures via TextEncoder, not .length
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(__dirname, 'structure-board.js'), 'utf8');
  ok(/new TextEncoder\(\)\.encode\(JSON\.stringify\(state\)\)\.length/.test(src),
     'source binds the cap to TextEncoder UTF-8 byte length (not serialized.length)');
  ok(!/JSON\.stringify\(state\)\.length\s*>/.test(src),
     'source has NO char-count `JSON.stringify(state).length >` cap (the UTF-16 trap)');
}

// ---------------------------------------------------------------------------
console.log(`\nstructure-board-validate: ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + fails.join('\n')); process.exit(1); }
