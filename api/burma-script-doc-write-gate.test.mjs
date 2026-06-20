// Handler-level tests for the SHARE-SAFETY WRITE GATE in api/burma-script-doc.js.
//
// THE GAP (was): the PUT was unauthenticated. Read-only was enforced CLIENT-SIDE only, so a `?read`
// recipient with DevTools could hand-craft fetch('/api/burma-script-doc',{method:'PUT',body:{doc,
// version:999999}}) and clobber Johnny's canonical cloud doc — version concurrency alone (a high
// version) defeats the optimistic guard. THE FIX: when BURMA_WRITE_TOKEN is configured the server
// refuses any PUT lacking a matching X-Burma-Write-Token header with a clean 401, BEFORE any DB read.
//
// These drive the REAL default export end-to-end with mock Requests. SUPABASE env is set to fake values
// so the handler passes its NO_DB gate and reaches the write gate / DB layer; globalThis.fetch is mocked
// so the one AUTHORIZED case that proceeds past the gate never touches a real Supabase. GET stays open.

import assert from 'node:assert';

// Configure BEFORE importing the handler (module reads env at load).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-key';
process.env.BURMA_WRITE_TOKEN = 's3cret-write-token';

const handler = (await import('./burma-script-doc.js')).default;

const DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

function put(body, headers = {}) {
  return new Request('https://x/api/burma-script-doc', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

let passed = 0, failed = 0;
async function aok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Mock fetch so an AUTHORIZED PUT that proceeds past the gate hits a controllable "DB". We model an empty
// table: GET select -> [] (so the write inserts), POST insert -> the new row. Any unauthorized PUT must
// 401 BEFORE any of this is called, which we assert via a call-count.
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  fetchCalls++;
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  // current-row read (select) — return empty so putDoc takes the insert path
  if (method === 'GET' || u.includes('select=doc,version')) {
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // insert (POST return=representation)
  if (method === 'POST') {
    return new Response(JSON.stringify([{ id: 'wp01-burma', doc: DOC, version: 602 }]), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  }
  // guarded PATCH fallback
  return new Response(JSON.stringify([{ version: 602 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  // ── RED-FLAVOURED: the attacker PUT (no token, huge version) is REFUSED 401 before any DB touch ──
  await aok('tokenless PUT with a huge version -> 401, and NO DB call made', async () => {
    fetchCalls = 0;
    const res = await handler(put({ doc: DOC, version: 999999 }));
    assert.equal(res.status, 401, 'a reader/attacker has no token -> 401');
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.equal(fetchCalls, 0, 'gate must short-circuit BEFORE any Supabase read/write');
  });

  await aok('wrong token -> 401 (no DB call)', async () => {
    fetchCalls = 0;
    const res = await handler(put({ doc: DOC, version: 999999 }, { 'X-Burma-Write-Token': 'guessed' }));
    assert.equal(res.status, 401);
    assert.equal(fetchCalls, 0);
  });

  // ── GREEN: Johnny's device (correct token) proceeds past the gate into the normal write path ──
  await aok('correct token -> proceeds past gate (reaches DB write, 200)', async () => {
    fetchCalls = 0;
    const res = await handler(put({ doc: DOC, version: 602 }, { 'X-Burma-Write-Token': 's3cret-write-token' }));
    assert.equal(res.status, 200, 'authorized write proceeds');
    assert.ok(fetchCalls > 0, 'authorized path DOES touch the DB');
    const body = await res.json();
    assert.equal(body.version, 602);
  });

  // ── GET is ALWAYS open (a read-share recipient must be able to READ) ──
  await aok('GET requires NO token (read share stays open)', async () => {
    const res = await handler(new Request('https://x/api/burma-script-doc', { method: 'GET' }));
    assert.equal(res.status, 200, 'GET is open regardless of token');
  });

  // ── OPTIONS preflight advertises the write-token header so a gated cross-origin PUT isn't CORS-blocked ──
  await aok('OPTIONS preflight allows X-Burma-Write-Token', async () => {
    const res = await handler(new Request('https://x/api/burma-script-doc', { method: 'OPTIONS' }));
    assert.equal(res.status, 204);
    assert.match(res.headers.get('Access-Control-Allow-Headers') || '', /X-Burma-Write-Token/i);
  });

  // ── A bad body STILL only reached AFTER auth (auth precedes body parse) ──
  await aok('authorized but malformed JSON -> 400 BAD_JSON (auth passed, then body parse)', async () => {
    const req = new Request('https://x/api/burma-script-doc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Burma-Write-Token': 's3cret-write-token' },
      body: '{not json',
    });
    const res = await handler(req);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'BAD_JSON');
  });
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\nburma-script-doc-write-gate: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
