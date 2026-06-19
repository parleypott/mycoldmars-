// Auth-gate test for qss-explore-generate.
//
// THE BUG (iteration #25 logged it, #26 fixes it): the handler gated access with
//   try { await sharedCheckAccess(req); } catch { return 401 }
// but checkAccess (api/_lib/access.js) RETURNS a Response on denial — it does
// NOT throw. So the catch never fired, the 401 Response was discarded, and an
// UNAUTHENTICATED request fell straight through past the gate into the handler
// body. The endpoint is a stub today (returns 200 "not-yet-wired"), so exposure
// is limited — but the moment it's wired to nano-banana image-gen it would be an
// open, unauthenticated paid endpoint. The fix mirrors every other QSS handler:
//   const denied = await checkAccess(req); if (denied) return withCors(denied);
//
// Drives the REAL default export end-to-end with mock Requests. checkAccess reads
// process.env.ACCESS_CODE per-call, so we toggle it around each request to
// exercise both the enforced and dev/open modes. No network call is reached (the
// handler is a stub that returns before any external service).

import assert from 'node:assert';

const handler = (await import('./qss-explore-generate.js')).default;
const { withCors } = await import('./qss-explore-generate.js');

const ORIGINAL_CODE = process.env.ACCESS_CODE;
function setCode(v) {
  if (v === undefined) delete process.env.ACCESS_CODE;
  else process.env.ACCESS_CODE = v;
}

function post(headers = {}, bodyStr = '{}') {
  return new Request('https://x/api/qss-explore-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  });
}

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.error(`FAIL: ${label}\n  ${e.message}`); }
}

// --- INLINE RED PROOF -------------------------------------------------------
// Reconstruct the OLD try/catch gate against the REAL checkAccess and show it
// does NOT stop an unauthenticated request: checkAccess returns (not throws), so
// the catch never runs and execution falls through (no 401 produced).
await check('RED PROOF: old try/catch gate lets an unauth request fall through', async () => {
  setCode('secret-code');
  const { checkAccess } = await import('./_lib/access.js');
  let fellThrough = false, caught = false;
  try {
    await checkAccess(post()); // returns a 401 Response; the old code ignored it
    fellThrough = true;        // <- old handler reached here and kept going
  } catch { caught = true; }
  assert.strictEqual(caught, false, 'checkAccess must NOT throw (it returns)');
  assert.strictEqual(fellThrough, true, 'old gate falls through on denial — the bug');
  setCode(ORIGINAL_CODE);
});

// --- THE FIX: enforced mode -------------------------------------------------
await check('enforced: unauth POST (no x-access-code) -> 401, NOT the 200 stub', async () => {
  setCode('secret-code');
  const res = await handler(post());
  assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`);
  setCode(ORIGINAL_CODE);
});

await check('enforced: 401 carries CORS header (withCors applied)', async () => {
  setCode('secret-code');
  const res = await handler(post());
  assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  setCode(ORIGINAL_CODE);
});

await check('enforced: wrong x-access-code -> 401', async () => {
  setCode('secret-code');
  const res = await handler(post({ 'x-access-code': 'WRONG' }));
  assert.strictEqual(res.status, 401, `expected 401, got ${res.status}`);
  setCode(ORIGINAL_CODE);
});

await check('enforced: correct x-access-code -> passes gate, reaches 200 stub', async () => {
  setCode('secret-code');
  const res = await handler(post({ 'x-access-code': 'secret-code' }));
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.deepStrictEqual(body.images, [], 'stub returns empty images');
  assert.ok(/not wired/i.test(body.note || ''), 'stub note present');
  setCode(ORIGINAL_CODE);
});

// --- dev/open mode (no ACCESS_CODE) -----------------------------------------
await check('dev mode: ACCESS_CODE unset -> POST passes -> 200 stub', async () => {
  setCode(undefined);
  const res = await handler(post());
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  setCode(ORIGINAL_CODE);
});

// --- method + body guards still intact (unchanged behavior) -----------------
await check('OPTIONS -> 204', async () => {
  setCode('secret-code');
  const res = await handler(new Request('https://x/api/qss-explore-generate', { method: 'OPTIONS' }));
  assert.strictEqual(res.status, 204);
  setCode(ORIGINAL_CODE);
});

await check('GET -> 405', async () => {
  setCode('secret-code');
  const res = await handler(new Request('https://x/api/qss-explore-generate', { method: 'GET' }));
  assert.strictEqual(res.status, 405);
  setCode(ORIGINAL_CODE);
});

await check('enforced: null body AFTER passing gate -> 400 (body guard intact)', async () => {
  setCode('secret-code');
  const res = await handler(post({ 'x-access-code': 'secret-code' }, 'null'));
  assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
  setCode(ORIGINAL_CODE);
});

// --- withCors unit ----------------------------------------------------------
await check('withCors: stamps CORS onto a denial Response, preserves status', async () => {
  const src = new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });
  const out = withCors(src);
  assert.strictEqual(out.status, 401);
  assert.strictEqual(out.headers.get('Access-Control-Allow-Origin'), '*');
  assert.strictEqual(out.headers.get('Content-Type'), 'application/json');
});

setCode(ORIGINAL_CODE);
console.log(`qss-explore-generate-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
