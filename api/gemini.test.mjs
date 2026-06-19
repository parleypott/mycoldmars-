// End-to-end tests for the api/gemini.js request-body guard.
//
// api/gemini.js is The Hunter's Gemini brain (pattern surfacing, semantic
// search, chat, script copilot, job queue, ...). Before this fix its handler
// read the POST body with a bare `const body = await req.json()` — NO
// try/catch and NO object guard — so it had BOTH crash modes of the null-body
// class:
//   (1) a MALFORMED body -> req.json() rejects -> unhandled -> HTTP 500.
//   (2) a JSON-literal `null`/non-object body -> `body.action` throws a
//       TypeError on null (mis-reads number/string/array) -> HTTP 500.
// It is auth-gated, but a bad request from an authed client (Johnny / anyone
// with the access code) was mis-reported as a server error rather than a 400.
//
// The fix routes the read through the shared, mutation-locked readJsonBody.
// These tests drive the REAL default export end-to-end with mock Requests.
// In the test env ACCESS_CODE is unset (checkAccess runs in dev/open mode) and
// GEMINI_API_KEY is set, so the request reaches the body read. Every bad-body
// case returns at the guard BEFORE any network call; the one valid-object case
// stubs global.fetch so it never hits the real Gemini API.

import assert from 'node:assert';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
delete process.env.ACCESS_CODE; // dev/open mode so checkAccess passes

const { default: handler } = await import('./gemini.js');

function post(rawBody) {
  return new Request('http://x/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// ── RED proof: the OLD inline read crashes on both bad-body modes ──
await checkAsync('RED PROOF: old `const body=await req.json(); body.action` throws on null body', async () => {
  async function oldRead(req) {
    const body = await req.json();
    return body.action; // throws TypeError on null
  }
  let threw = false;
  try {
    await oldRead(post('null'));
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'old read should throw on a JSON-null body (the 500)');
});
await checkAsync('RED PROOF: old read throws on a malformed body (no try/catch)', async () => {
  async function oldRead(req) {
    const body = await req.json();
    return body.action;
  }
  let threw = false;
  try {
    await oldRead(post('{not json'));
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'old read should throw on malformed JSON (the 500)');
});

// ── The fix: bad bodies return a clean 400, never 500, never a throw ──
const badBodies = [
  ['JSON-literal null', 'null'],
  ['number', '42'],
  ['string', '"hello"'],
  ['boolean', 'true'],
  ['array', '[1,2,3]'],
  ['array of objects', '[{"action":"chat"}]'],
];
for (const [label, raw] of badBodies) {
  await checkAsync(`non-object body (${label}) -> 400, no 500/throw`, async () => {
    const res = await handler(post(raw));
    assert.equal(res.status, 400, `expected 400 for ${label}, got ${res.status}`);
    const json = await res.json();
    assert.equal(json.error, 'body must be a json object');
  });
}

await checkAsync('malformed body -> 400 invalid json (no 500/throw)', async () => {
  const res = await handler(post('{not valid json'));
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'invalid json');
});

await checkAsync('empty body -> 400 (no 500/throw)', async () => {
  const res = await handler(post(''));
  assert.equal(res.status, 400);
});

// ── Back-compat: non-POST still 405; valid object still flows past the read ──
await checkAsync('GET -> 405 (method guard intact)', async () => {
  const res = await handler(
    new Request('http://x/api/gemini', { method: 'GET' })
  );
  assert.equal(res.status, 405);
});

await checkAsync('valid object body flows PAST the read to dispatch (stubbed fetch)', async () => {
  // A valid object with no recognized action falls to the default Gemini
  // proxy, which calls fetch(). Stub it so we prove the read succeeded and
  // dispatch happened without a real network call.
  const realFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const res = await handler(post(JSON.stringify({ prompt: 'hi' })));
    assert.equal(fetched, true, 'valid object should reach the default Gemini proxy fetch');
    assert.equal(res.status, 200);
  } finally {
    global.fetch = realFetch;
  }
});

console.log(`\ngemini.js body-guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
