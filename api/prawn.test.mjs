// Tests for api/prawn.js — the PUBLIC (no-auth, service-role) Prawn Weekend
// RSVP endpoint. Locks the null-body crash fix (same class as the research-* /
// burma-tk fixes): a structurally-valid but non-object POST body must be a
// clean 400, never an unhandled HTTP 500.
//
// Drives the REAL default export end-to-end with mock Requests. Every bad-body
// case returns BEFORE the PostgREST fetch, and the no-name case returns at the
// name_required gate before the network, so no test ever hits Supabase.

import assert from 'node:assert';

// The handler reads SUPABASE_URL/KEY at call time; set before importing so the
// config gate passes and we exercise the real body-read path.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://prawn.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const handler = (await import('./prawn.js')).default;

function post(bodyStr) {
  return new Request('https://x/api/prawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
}

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function aok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── RED PROOF: the OLD unguarded body read crashes on a JSON-null body ──
// Reconstructs the pre-fix logic (body = await req.json(); then body.name) and
// asserts it THROWS on null — i.e. would surface as an unhandled HTTP 500.
await aok('RED: old unguarded body.name access throws on null body', async () => {
  const req = post('null');
  const body = await req.json(); // succeeds, returns null
  let threw = false;
  try {
    // eslint-disable-next-line no-unused-expressions
    body.name;
  } catch {
    threw = true;
  }
  assert.equal(threw, true, 'old code reads body.name on null → TypeError → HTTP 500');
});

// ── THE FIX: a non-object body is a clean 400, never a 500 ──
for (const b of ['null', '42', '"hi"', 'true', '[]', '[{"name":"x"}]']) {
  await aok(`non-object body ${b} -> clean 400 bad_body (no throw)`, async () => {
    let res;
    try {
      res = await handler(post(b));
    } catch (e) {
      assert.fail(`handler threw (HTTP 500) on body ${b}: ${e.message}`);
    }
    assert.equal(res.status, 400, `body ${b} should be 400`);
    const json = await res.json();
    assert.equal(json.error, 'bad_body', `body ${b} should report bad_body`);
  });
}

// ── BACK-COMPAT: malformed JSON keeps the original bad_json 400 ──
await aok('malformed json -> 400 bad_json (back-compat)', async () => {
  const res = await handler(post('{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'bad_json');
});

// ── A valid object flows through the guard to field validation ──
await aok('valid object, no name -> 400 name_required (body flowed through)', async () => {
  const res = await handler(post(JSON.stringify({ food: 'prawns' })));
  assert.equal(res.status, 400, 'reaches the name gate, does not crash');
  assert.equal((await res.json()).error, 'name_required');
});

await aok('valid object, blank/whitespace name -> 400 name_required', async () => {
  const res = await handler(post(JSON.stringify({ name: '   ' })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'name_required');
});

// ── Method gating unaffected ──
await aok('OPTIONS -> 204 (CORS preflight)', async () => {
  const res = await handler(new Request('https://x/api/prawn', { method: 'OPTIONS' }));
  assert.equal(res.status, 204);
});

console.log(`\nprawn: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
