// Tests for the AUTHED per-project GET (?id=<uuid>) added to api/script-projects.js — the read-back
// path that lets a signed-in teammate hydrate a project's per-project config (picker days/sequences).
//
// Why it exists: the LIST endpoint deliberately never carries config (world-shaped index; locked by
// script-projects-config-clamp.test.mjs), so a teammate's added days can't ride the background list sync.
// This single-project read fills that gap — behind checkAccess, returning the FULL projectView (config
// included). The anonymous ?slug= guest door is untouched (still config-free).
//
// Locked here:
//   • GET ?id=<uuid> (authed) returns { project } WITH config, and its DB SELECT DOES request config.
//   • an unknown id resolves to { project: null } (calm no-op for the client's background hydrate).
//   • a malformed id → 400 BAD_ID.
//   • the list path (no id/slug) is unchanged — still config-free.
//
// checkAccess is a no-op here (SCRIPT_ACCESS_CODE unset → open), matching the sibling config-clamp test.
//
// Run: bun api/script-projects-id-get.test.mjs
import assert from 'node:assert';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://supa.test';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'svc.test';

const { default: handler } = await import('./script-projects.js');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { process.exitCode = 1; console.error(`  ✗ ${name}: ${e.message}`); }
}

const UUID = 'a4b1c2d3-1111-2222-3333-444455556666';
let lastGetUrl = '';
const req = (qs) => new Request(`https://example.test/api/script-projects${qs}`, { method: 'GET', headers: { Accept: 'application/json' } });

// Mock the Supabase REST layer.
function installFetch({ rows }) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.startsWith('https://supa.test/rest/v1/script_projects')) {
      if (method === 'GET') { lastGetUrl = u; return new Response(JSON.stringify(rows), { status: 200 }); }
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
}

await t('GET ?id= (authed) returns the project WITH config; SELECT requests config', async () => {
  installFetch({ rows: [{
    id: UUID, slug: 'nile', title: 'Nile', episode: null,
    config: { picker: { days: [4, 5], sequences: ['Boatman:'] } },
    created_at: 't0', updated_at: 't1', trashed_at: null, deleted_at: null, is_public: true,
  }] });
  const res = await handler(req(`?id=${UUID}`));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.project, 'a project came back');
  assert.deepEqual(out.project.config.picker.days, [4, 5], 'config.picker.days present on the wire');
  const sel = new URL(lastGetUrl).searchParams.get('select') || '';
  assert.ok(sel.split(',').includes('config'), `single-project SELECT DOES request config (got select=${sel})`);
  assert.ok(new URL(lastGetUrl).searchParams.get('id') === `eq.${UUID}`, 'queried by id');
});

await t('GET ?id= unknown → { project: null } (calm no-op, not 404)', async () => {
  installFetch({ rows: [] });
  const res = await handler(req(`?id=${UUID}`));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).project, null);
});

await t('GET ?id=<malformed> → 400 BAD_ID', async () => {
  installFetch({ rows: [] });
  const res = await handler(req('?id=not-a-uuid'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'BAD_ID');
});

await t('GET list (no id/slug) is unchanged — still config-free', async () => {
  installFetch({ rows: [{ id: UUID, slug: 'nile', title: 'Nile', episode: null, created_at: 't0', updated_at: 't1', trashed_at: null, deleted_at: null }] });
  const res = await handler(req(''));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(Array.isArray(out.projects), 'list shape');
  assert.ok(!('config' in out.projects[0]), 'list rows still carry no config');
  const sel = new URL(lastGetUrl).searchParams.get('select') || '';
  assert.ok(!sel.split(',').includes('config'), 'list SELECT still drops config');
});

console.log(`script-projects-id-get: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
