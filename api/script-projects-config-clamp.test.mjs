/*
 * script-projects-config-clamp.test.mjs — two list-endpoint hardenings, locked:
 *
 *   1. CONFIG WRITE CLAMP — the config jsonb bag is capped at 64KB serialized. Over the cap:
 *      validateCreateBody / buildPatch return CONFIG_TOO_BIG and the handler answers 413 (not
 *      a generic 400), so the client can name the real problem. Under the cap: unchanged.
 *
 *   2. LIST STRIPS CONFIG — the world-readable GET list (site gate only, no login) no longer
 *      echoes each project's config. The library client never reads it off the list
 *      (configForProject derives from id/episode/title), and the DB SELECT itself drops the
 *      column so the bytes never even leave Postgres. POST/PATCH responses keep config for
 *      authed writers (projectView unchanged).
 *
 * Pure functions + the REAL handler with a stubbed fetch. No network.
 * Run: bun api/script-projects-config-clamp.test.mjs
 */
import assert from 'node:assert/strict';

delete process.env.ACCESS_CODE; // open access mode so write paths pass checkAccess
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const mod = await import('./script-projects.js');
const {
  default: handler, validateCreateBody, buildPatch, projectListView, projectView,
  CONFIG_MAX_BYTES, configByteSize,
} = mod;

const bigConfig = { blob: 'x'.repeat(CONFIG_MAX_BYTES + 1) };
const okConfig = { accent: '#1f1d18', days: [1, 2, 3] };

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/* ---- pure: byte sizing + validators ---- */
await t('configByteSize measures serialized bytes (multibyte-safe)', async () => {
  assert.equal(configByteSize({}), 2);
  assert.ok(configByteSize({ a: 'é' }) > configByteSize({ a: 'e' }), 'UTF-8 bytes, not string length');
  assert.equal(configByteSize(makeCircular()), Infinity, 'unserializable → Infinity (always over cap)');
});
function makeCircular() { const o = {}; o.self = o; return o; }

await t('validateCreateBody: over-cap config → CONFIG_TOO_BIG; under-cap unchanged', async () => {
  const over = validateCreateBody({ slug: 'ep-one', title: 'Ep One', config: bigConfig });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'CONFIG_TOO_BIG');
  const under = validateCreateBody({ slug: 'ep-one', title: 'Ep One', config: okConfig });
  assert.equal(under.ok, true);
  assert.deepEqual(under.config, okConfig);
});

await t('buildPatch: over-cap config → CONFIG_TOO_BIG; under-cap unchanged', async () => {
  const over = buildPatch({ config: bigConfig });
  assert.equal(over.ok, false);
  assert.equal(over.code, 'CONFIG_TOO_BIG');
  const under = buildPatch({ config: okConfig });
  assert.equal(under.ok, true);
  assert.deepEqual(under.fields.config, okConfig);
});

/* ---- pure: list view drops config, full view keeps it ---- */
await t('projectListView = projectView minus config (and only config)', async () => {
  const row = {
    id: 'a4b1c2d3-1111-2222-3333-444455556666', slug: 'ep-one', title: 'Ep One', episode: null,
    config: { secretish: 'bag' }, created_at: 't0', updated_at: 't1', trashed_at: null, deleted_at: null,
  };
  const full = projectView(row);
  const list = projectListView(row);
  assert.ok('config' in full, 'projectView (POST/PATCH responses) keeps config');
  assert.ok(!('config' in list), 'list view must not carry config');
  const { config, ...rest } = full;
  assert.deepEqual(list, rest, 'everything else identical');
  assert.equal(projectListView(null), null);
});

/* ---- real handler: 413 on the wire, list SELECT drops the column ---- */
let lastListUrl = '';
let dbWrites = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (u.startsWith('https://supa.test/rest/v1/script_projects')) {
    if (method === 'GET') {
      lastListUrl = u;
      return new Response(JSON.stringify([
        { id: 'a4b1c2d3-1111-2222-3333-444455556666', slug: 'ep-one', title: 'Ep One', episode: null, created_at: 't0', updated_at: 't1', trashed_at: null, deleted_at: null },
      ]), { status: 200 });
    }
    dbWrites++;
    return new Response(JSON.stringify([{ id: 'a4b1c2d3-1111-2222-3333-444455556666', slug: 'ep-one', title: 'Ep One', config: okConfig }]), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${method} ${u}`);
};
const req = (method, qs, payload) => new Request(`https://example.test/api/script-projects${qs}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
});

await t('handler: POST with over-cap config → 413, nothing written', async () => {
  const res = await handler(req('POST', '', { slug: 'ep-two', title: 'Ep Two', config: bigConfig }));
  assert.equal(res.status, 413);
  const out = await res.json();
  assert.equal(out.error.code, 'CONFIG_TOO_BIG');
  assert.equal(dbWrites, 0, 'clamped before the DB');
});

await t('handler: PATCH with over-cap config → 413, nothing written', async () => {
  const res = await handler(req('PATCH', '?id=a4b1c2d3-1111-2222-3333-444455556666', { config: bigConfig }));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'CONFIG_TOO_BIG');
  assert.equal(dbWrites, 0);
});

await t('handler: GET list rows carry no config, and the DB SELECT itself drops the column', async () => {
  const res = await handler(req('GET', ''));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(Array.isArray(out.projects) && out.projects.length === 1);
  assert.ok(!('config' in out.projects[0]), 'list row must not carry config');
  assert.equal(out.projects[0].slug, 'ep-one', 'rest of the shape intact');
  const sel = new URL(lastListUrl).searchParams.get('select') || '';
  assert.ok(!sel.split(',').includes('config'), `SELECT must not request config (got select=${sel})`);
});

await t('handler: trashed list gets the same treatment', async () => {
  const res = await handler(req('GET', '?trashed=1'));
  const out = await res.json();
  assert.ok(!('config' in out.projects[0]));
  const sel = new URL(lastListUrl).searchParams.get('select') || '';
  assert.ok(!sel.split(',').includes('config'));
});

console.log(`script-projects-config-clamp: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
