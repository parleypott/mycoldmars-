/*
 * script-doc-revisions-auth.test.mjs — revision-history reads are LOGIN-GATED, the plain
 * doc GET stays PUBLIC. Locked here, driving the REAL handler with a stubbed fetch:
 *
 *   • GET ?project=X                      → 200 with no credentials AT ALL — the ?read/?view
 *     share links (cloud-sync.js fetchCloudDocReadOnly) depend on this staying open.
 *   • GET ?project=X&revisions=1          → 401 anonymous (the list carries teammate
 *     names/colours via user_profiles); 200 with x-access-code; 200 with a verified JWT.
 *   • GET ?project=X&revision=<id>        → 401 anonymous (it hands back any FULL past doc);
 *     200 when authed. Same checkAccess gate the PUT write path already uses.
 *   • the 401 is CORS-wrapped (browser-readable) and fires BEFORE any DB round-trip, so an
 *     anonymous prober can't even confirm a project slug exists via the history route.
 *
 * Run: bun api/script-doc-revisions-auth.test.mjs
 */
import assert from 'node:assert/strict';

// Gate ARMED (unlike the pure-logic suite): ACCESS_CODE set means checkAccess really checks.
process.env.ACCESS_CODE = 'test-code';
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_ANON_KEY = 'anon-key';

const handler = (await import('./script-doc.js')).default;

// ── fetch stub: Supabase REST + auth. Counts DB round-trips so we can prove the 401 is cheap.
let dbCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://supa.test/rest/v1/script_projects')) {
    dbCalls++;
    return new Response(JSON.stringify([{ id: 'a4b1c2d3-1111-2222-3333-444455556666' }]), { status: 200 });
  }
  if (u.startsWith('https://supa.test/rest/v1/script_docs')) {
    dbCalls++;
    return new Response(JSON.stringify([{ doc: { type: 'doc' }, version: 7, updated_by: null }]), { status: 200 });
  }
  if (u.startsWith('https://supa.test/rest/v1/script_doc_revisions')) {
    dbCalls++;
    if (u.includes('&id=eq.')) return new Response(JSON.stringify([{ doc: { type: 'doc' }, version: 5 }]), { status: 200 });
    return new Response(JSON.stringify([{ id: 9, version: 7, source: 'autosave', user_id: 'u1', created_at: 't' }]), { status: 200 });
  }
  if (u.startsWith('https://supa.test/rest/v1/user_profiles')) {
    dbCalls++;
    return new Response(JSON.stringify([{ user_id: 'u1', display_name: 'Ryan', color: '#f44315' }]), { status: 200 });
  }
  if (u === 'https://supa.test/auth/v1/user') {
    // Only the well-shaped test JWT verifies.
    const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    return String(auth).includes('eyJgood')
      ? new Response(JSON.stringify({ id: 'u1' }), { status: 200 })
      : new Response('{}', { status: 401 });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

const GOOD_JWT = 'eyJgoodAAAA.eyJgoodBBBB.sig';
const get = (qs, headers = {}) => handler(new Request(`https://example.test/api/script-doc${qs}`, { headers }));

let passed = 0;
async function t(name, fn) {
  dbCalls = 0;
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/* ---- the share path stays open ---- */
await t('plain doc GET: 200 with zero credentials (the ?read share path)', async () => {
  const res = await get('?project=burma');
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.version, 7);
  assert.ok(out.doc, 'doc body served');
});

/* ---- history list ---- */
await t('&revisions=1 anonymous → 401, CORS-readable, zero DB round-trips', async () => {
  const res = await get('?project=burma&revisions=1');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', '401 must be CORS-wrapped for the browser');
  assert.equal(dbCalls, 0, 'gate fires before any DB fetch — no slug-existence oracle');
});

await t('&revisions=1 with x-access-code → 200 with the roster intact', async () => {
  const res = await get('?project=burma&revisions=1', { 'x-access-code': 'test-code' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.revisions.length, 1);
  assert.equal(out.revisions[0].user_name, 'Ryan', 'authed shape unchanged (names still resolve)');
});

await t('&revisions=1 with a verified JWT → 200 (the library gate.js road)', async () => {
  const res = await get('?project=burma&revisions=1', { Authorization: `Bearer ${GOOD_JWT}` });
  assert.equal(res.status, 200);
});

/* ---- single revision (full doc) ---- */
await t('&revision=<id> anonymous → 401, zero DB round-trips', async () => {
  const res = await get('?project=burma&revision=5');
  assert.equal(res.status, 401);
  assert.equal(dbCalls, 0);
});

await t('&revision=<id> authed → 200 with the full past doc (shape unchanged)', async () => {
  const res = await get('?project=burma&revision=5', { 'x-access-code': 'test-code' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.version, 5);
  assert.ok(out.doc);
});

/* ---- garbage credentials are not credentials ---- */
await t('&revisions=1 with a bad JWT / wrong code → still 401', async () => {
  const bad1 = await get('?project=burma&revisions=1', { Authorization: 'Bearer eyJevil.eyJevil.zzz' });
  assert.equal(bad1.status, 401);
  const bad2 = await get('?project=burma&revisions=1', { 'x-access-code': 'wrong' });
  assert.equal(bad2.status, 401);
});

console.log(`script-doc-revisions-auth: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
