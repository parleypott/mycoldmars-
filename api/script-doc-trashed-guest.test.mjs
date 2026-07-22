/*
 * script-doc-trashed-guest.test.mjs — a TRASHED (or soft-deleted) project's doc is NOT served to
 * anonymous readers, even while its is_public flag is still true. Drives the REAL handler with a
 * stubbed fetch, reproducing the live finding: palau (trashed_at set, is_public true) resolved to
 * null through the guest ?slug= endpoint (ACTIVE_LIST_FILTER), yet a slug-guesser hitting
 * GET /api/script-doc?project=palau directly got the FULL doc — the content gate only checked
 * is_public. Locked here:
 *
 *   • trashed + is_public  → anonymous GET 403 SHARING_OFF (indistinguishable from private),
 *     doc body NEVER in the response; owner/teammates (x-access-code / verified JWT) still 200.
 *   • soft-deleted + is_public → same.
 *   • active + is_public   → anonymous GET stays 200 — the ?read/bare-#slug share path lives.
 *   • sharing OFF + active → anonymous 403 (the pre-existing gate, still intact).
 *   • DB hiccup on the status lookup → fail-OPEN (a blip can only over-serve, never block a share).
 *
 * Run: bun api/script-doc-trashed-guest.test.mjs
 */
import assert from 'node:assert/strict';

// Gate ARMED: ACCESS_CODE set means checkAccess really checks (anonymous ≠ authorized).
process.env.ACCESS_CODE = 'test-code';
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_ANON_KEY = 'anon-key';

const handler = (await import('./script-doc.js')).default;

const PID = 'a4b1c2d3-1111-2222-3333-444455556666';
const SECRET = { type: 'doc', content: [{ type: 'p', text: 'the trashed script body' }] };

// The script_projects row the stub serves. Tests mutate this to flip trash/share state.
// `statusFails` simulates an infra blip on the status lookup only (slug resolution unaffected).
const state = { row: { id: PID, is_public: true, trashed_at: null, deleted_at: null }, statusFails: false };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://supa.test/rest/v1/script_projects')) {
    // Status lookup (select includes the trash columns) vs slug resolution (select=id).
    if (u.includes('select=is_public')) {
      if (state.statusFails) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify([state.row]), { status: 200 });
    }
    return new Response(JSON.stringify([{ id: PID }]), { status: 200 });
  }
  if (u.startsWith('https://supa.test/rest/v1/script_docs')) {
    return new Response(JSON.stringify([{ doc: SECRET, version: 7, updated_by: null }]), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

const get = (headers = {}) => handler(new Request('https://example.test/api/script-doc?project=palau', { headers }));

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/* ---- the hole: trashed-but-public served to a slug-guesser ---- */
await t('TRASHED + is_public: anonymous GET → 403 SHARING_OFF, doc never leaves the server', async () => {
  state.row = { id: PID, is_public: true, trashed_at: '2026-07-20T00:00:00Z', deleted_at: null };
  const res = await get();
  assert.equal(res.status, 403, 'trashed project must gate anonymous readers');
  const body = await res.text();
  assert.equal(JSON.parse(body).error.code, 'SHARING_OFF', 'same refusal as private — no trash-state oracle');
  assert.ok(!body.includes('the trashed script body'), 'doc body must NOT ride along on the refusal');
});

await t('soft-DELETED + is_public: anonymous GET → 403 too', async () => {
  state.row = { id: PID, is_public: true, trashed_at: '2026-07-19T00:00:00Z', deleted_at: '2026-07-20T00:00:00Z' };
  const res = await get();
  assert.equal(res.status, 403);
});

/* ---- teammates keep their door ---- */
await t('TRASHED: x-access-code still gets the doc (restore path / owner never locked out)', async () => {
  state.row = { id: PID, is_public: true, trashed_at: '2026-07-20T00:00:00Z', deleted_at: null };
  const res = await get({ 'x-access-code': 'test-code' });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.version, 7);
  assert.ok(out.doc, 'authed read serves the doc');
});

/* ---- the share path is NOT collateral damage ---- */
await t('ACTIVE + is_public: anonymous GET stays 200 (bare #slug / ?read share links live)', async () => {
  state.row = { id: PID, is_public: true, trashed_at: null, deleted_at: null };
  const res = await get();
  assert.equal(res.status, 200);
  assert.ok((await res.json()).doc);
});

await t('ACTIVE + sharing OFF: anonymous GET → 403 (the pre-existing gate, intact)', async () => {
  state.row = { id: PID, is_public: false, trashed_at: null, deleted_at: null };
  const res = await get();
  assert.equal(res.status, 403);
});

/* ---- fail-open contract: a blip over-serves, never blocks ---- */
await t('status lookup 500s: anonymous GET → 200 (fail-open on infra hiccup, unchanged)', async () => {
  state.row = { id: PID, is_public: true, trashed_at: null, deleted_at: null };
  state.statusFails = true;
  const res = await get();
  assert.equal(res.status, 200, 'a DB blip must never block a legit share');
  state.statusFails = false;
});

console.log(`script-doc-trashed-guest: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
