// Cache-bust test for qss-world-style PUT.
//
// THE BUG (memory obs 2739, flagged Jun 18; documented in the library itself):
// loadWorldStyle() in api/_lib/qss-worlds.js caches each world's art_style +
// canon_text per edge instance with a 5-min TTL so a busy portrait-draw burst
// hits Supabase at most once. The library ships invalidateWorldStyleCache()
// whose OWN comment says "call from PUT handler after writing so the next draw
// picks up the new style without waiting out the TTL." But qss-world-style.js's
// PUT handler PATCHed the row and returned 200 WITHOUT calling it — so after an
// author saved a world's style in the Style Hub, a portrait draw on the SAME
// edge instance kept serving the OLD cached style/canon for up to 5 minutes.
//
// This drives the REAL default export end-to-end with mock Requests and a
// stubbed global.fetch, and asserts the behavioral consequence: after a PUT,
// loadWorldStyle() RE-FETCHES (sees the new style) instead of serving the stale
// cached value. checkAccess reads ACCESS_CODE per-call — unset => dev/open mode.
//
// The handler and this test both import './_lib/qss-worlds.js', so they share
// the SAME module-scoped STYLE_CACHE (ESM module identity) — the handler's
// invalidate touches the very Map loadWorldStyle reads.

import assert from 'node:assert';

// Env must be set BEFORE importing the handler (it reads SUPABASE_* at module load).
process.env.QSS_SUPABASE_URL = 'https://stub.supabase.co';
process.env.QSS_SUPABASE_SERVICE_KEY = 'stub-service-key';
const ORIGINAL_CODE = process.env.ACCESS_CODE;
delete process.env.ACCESS_CODE; // dev/open mode -> checkAccess passes

const handler = (await import('./qss-world-style.js')).default;
const { loadWorldStyle, invalidateWorldStyleCache } = await import('./_lib/qss-worlds.js');

const ORIGINAL_FETCH = global.fetch;

// fetch stub that returns a fixed JSON array with HTTP 200 (the shape both
// fetchWorldRowFromDb and the handler's sb() expect).
function fetchReturning(jsonValue) {
  return async () =>
    new Response(JSON.stringify(jsonValue), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
}
// Prime the cache with a row whose styleBlock === marker.
function rowWithStyle(marker) {
  return [{ slug: 'queen-scarlet', name: 'QSS', art_style: { styleBlock: marker }, canon_text: `CANON_${marker}` }];
}
function putReq() {
  return new Request('https://x/api/qss-world-style?world=queen-scarlet', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ art_style: { styleBlock: 'NEW' } }),
  });
}
function getReq() {
  return new Request('https://x/api/qss-world-style?world=queen-scarlet', { method: 'GET' });
}

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.error(`FAIL: ${label}\n  ${e.message}`); }
}

// --- INLINE RED PROOF: the cache is real and serves stale within the TTL -----
// Prime with STYLE_A, then loadWorldStyle again while fetch would return STYLE_B.
// With no bust, the cached STYLE_A is returned — proving a write that does NOT
// invalidate the cache leaves a draw serving the OLD style (the bug class).
await check('RED PROOF: without a bust, loadWorldStyle serves the stale cached style within TTL', async () => {
  invalidateWorldStyleCache(); // clear all -> clean slate
  global.fetch = fetchReturning(rowWithStyle('A'));
  const first = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(first.artStyle.styleBlock, 'A', 'prime should load STYLE_A');
  global.fetch = fetchReturning(rowWithStyle('B'));
  const second = await loadWorldStyle('queen-scarlet'); // no PUT, no bust
  assert.strictEqual(second.artStyle.styleBlock, 'A', 'stale cache serves STYLE_A, not the new STYLE_B');
});

// --- THE FIX: a successful PUT busts the cache -> next draw re-fetches --------
await check('FIX: after a successful PUT, loadWorldStyle re-fetches the new style (cache busted)', async () => {
  invalidateWorldStyleCache();
  global.fetch = fetchReturning(rowWithStyle('A'));
  const primed = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(primed.artStyle.styleBlock, 'A', 'prime should cache STYLE_A');

  // PUT — handler PATCHes (fetch returns a representation row) then, with the
  // fix, calls invalidateWorldStyleCache('queen-scarlet').
  global.fetch = fetchReturning(rowWithStyle('NEW'));
  const putRes = await handler(putReq());
  assert.strictEqual(putRes.status, 200, `PUT should 200, got ${putRes.status}`);

  // Next draw — fetch now returns STYLE_B. If the cache was busted we see B;
  // if it wasn't (the bug) we'd still see the cached STYLE_A.
  global.fetch = fetchReturning(rowWithStyle('B'));
  const after = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(after.artStyle.styleBlock, 'B', 'cache was busted -> re-fetched STYLE_B');
});

// --- LOCK: a GET does NOT bust the cache -------------------------------------
await check('LOCK: a GET leaves the cache intact (only a write busts it)', async () => {
  invalidateWorldStyleCache();
  global.fetch = fetchReturning(rowWithStyle('A'));
  await loadWorldStyle('queen-scarlet'); // prime A
  global.fetch = fetchReturning(rowWithStyle('GETROW'));
  const getRes = await handler(getReq());
  assert.strictEqual(getRes.status, 200, `GET should 200, got ${getRes.status}`);
  global.fetch = fetchReturning(rowWithStyle('B'));
  const after = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(after.artStyle.styleBlock, 'A', 'GET must not bust -> still cached STYLE_A');
});

// --- LOCK: a PUT that 404s (no matching row) does NOT bust -------------------
// The invalidate fires AFTER the empty-rows 404 guard, so a failed write leaves
// the cache untouched (correct — nothing was written).
await check('LOCK: a PUT that matches no row (404) does not bust the cache', async () => {
  invalidateWorldStyleCache();
  global.fetch = fetchReturning(rowWithStyle('A'));
  await loadWorldStyle('queen-scarlet'); // prime A
  global.fetch = fetchReturning([]); // PATCH returns no rows -> 404
  const putRes = await handler(putReq());
  assert.strictEqual(putRes.status, 404, `PUT-with-no-row should 404, got ${putRes.status}`);
  global.fetch = fetchReturning(rowWithStyle('B'));
  const after = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(after.artStyle.styleBlock, 'A', '404 PUT must not bust -> still cached STYLE_A');
});

// --- LOCK: a PUT with no editable fields (400) does NOT bust -----------------
await check('LOCK: a PUT with no editable fields (400) does not bust the cache', async () => {
  invalidateWorldStyleCache();
  global.fetch = fetchReturning(rowWithStyle('A'));
  await loadWorldStyle('queen-scarlet'); // prime A
  const badReq = new Request('https://x/api/qss-world-style?world=queen-scarlet', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nope: 1 }),
  });
  global.fetch = fetchReturning(rowWithStyle('SHOULD_NOT_FETCH'));
  const putRes = await handler(badReq);
  assert.strictEqual(putRes.status, 400, `no-editable-fields PUT should 400, got ${putRes.status}`);
  global.fetch = fetchReturning(rowWithStyle('B'));
  const after = await loadWorldStyle('queen-scarlet');
  assert.strictEqual(after.artStyle.styleBlock, 'A', '400 PUT must not bust -> still cached STYLE_A');
});

// restore globals
global.fetch = ORIGINAL_FETCH;
if (ORIGINAL_CODE === undefined) delete process.env.ACCESS_CODE;
else process.env.ACCESS_CODE = ORIGINAL_CODE;

console.log(`\nqss-world-style-cache-bust: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
