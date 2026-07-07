// Tests for the admin-users password contract (api/admin-users.js).
//
// The old behavior was a security hole: create/set_password/bootstrap all fell
// back to the fixed password 'newpress', which was ALSO printed on the public
// login screen — a skeleton key for any account whose owner never rotated it.
// New contract, locked here:
//   • create without password  → server generates a random per-user password,
//     sends THAT to Supabase, and returns it exactly once as `generatedPassword`.
//   • create with password     → uses it, `generatedPassword` is null.
//   • set_password without one → same generate-and-return-once behavior.
//   • bootstrap                → seeds admins with random (undisclosed)
//     passwords; the anonymous response never carries a credential.
//   • the string 'newpress' is gone from the module entirely.
//
// Drives the REAL default export with mock Requests. globalThis.fetch is
// stubbed to play both Supabase roles (JWT verification + admin API) and to
// CAPTURE what the handler sends, so we can assert the generated password is
// what actually reached Supabase. No network.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Env before import: open access mode (no ACCESS_CODE), admin gate armed.
delete process.env.ACCESS_CODE;
process.env.SUPABASE_URL = 'https://supa.test';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.ADMIN_EMAILS = 'admin@test.com';

const handler = (await import('./admin-users.js')).default;

const GENERATED_RE = /^[abcdefghijkmnpqrstuvwxyz23456789]{14}$/;

// ── fetch stub: verifies the caller JWT, records admin API calls ────────────
let captured = []; // { method, path, body }
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (u === 'https://supa.test/auth/v1/user') {
    return new Response(JSON.stringify({ id: 'admin-id', email: 'admin@test.com' }), { status: 200 });
  }
  if (u.startsWith('https://supa.test/auth/v1/admin/users')) {
    const body = init.body ? JSON.parse(init.body) : null;
    captured.push({ method, path: u.slice('https://supa.test'.length), body });
    if (method === 'POST') {
      return new Response(JSON.stringify({ id: 'new-user-id', email: body?.email }), { status: 200 });
    }
    if (method === 'GET') {
      return new Response(JSON.stringify({ users: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 }); // PUT/DELETE
  }
  throw new Error(`unexpected fetch: ${method} ${u}`);
};

function post(payload) {
  return new Request('https://example.test/api/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer caller-jwt' },
    body: JSON.stringify(payload),
  });
}

let passed = 0;
async function t(name, fn) {
  captured = [];
  try { await fn(); passed++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
}

// ── create ──────────────────────────────────────────────────────────────────
await t('create without password: generates one, sends it to Supabase, returns it once', async () => {
  const res = await handler(post({ action: 'create', email: 'colleague@test.com' }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.match(out.generatedPassword, GENERATED_RE, 'generatedPassword should be a 14-char random password');
  const create = captured.find(c => c.method === 'POST');
  assert.equal(create.body.password, out.generatedPassword, 'password sent to Supabase must be the one returned');
  assert.equal(create.body.email_confirm, true);
});

await t('create twice: generated passwords differ (per-user, not a new fixed default)', async () => {
  const a = await (await handler(post({ action: 'create', email: 'a@test.com' }))).json();
  const b = await (await handler(post({ action: 'create', email: 'b@test.com' }))).json();
  assert.notEqual(a.generatedPassword, b.generatedPassword);
});

await t('create with explicit password: uses it, returns no generatedPassword', async () => {
  const res = await handler(post({ action: 'create', email: 'c@test.com', password: 'chosen-by-admin' }));
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.generatedPassword, null);
  assert.equal(captured.find(c => c.method === 'POST').body.password, 'chosen-by-admin');
});

await t('create with too-short explicit password: 400, nothing sent to Supabase', async () => {
  const res = await handler(post({ action: 'create', email: 'd@test.com', password: 'abc' }));
  assert.equal(res.status, 400);
  assert.equal(captured.filter(c => c.method === 'POST').length, 0);
});

// ── set_password ────────────────────────────────────────────────────────────
await t('set_password without password: generates, applies, returns it once', async () => {
  const res = await handler(post({ action: 'set_password', userId: 'u-42' }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.match(out.generatedPassword, GENERATED_RE);
  const put = captured.find(c => c.method === 'PUT');
  assert.equal(put.path, '/auth/v1/admin/users/u-42');
  assert.equal(put.body.password, out.generatedPassword);
});

await t('set_password with explicit password: uses it, returns no generatedPassword', async () => {
  const res = await handler(post({ action: 'set_password', userId: 'u-42', password: 'their-choice' }));
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.generatedPassword, null);
  assert.equal(captured.find(c => c.method === 'PUT').body.password, 'their-choice');
});

// ── bootstrap ───────────────────────────────────────────────────────────────
await t('bootstrap: seeds admin with a RANDOM password and leaks nothing in the response', async () => {
  const res = await handler(post({ action: 'bootstrap' }));
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.createdCount, 1);
  const create = captured.find(c => c.method === 'POST');
  assert.equal(create.body.email, 'admin@test.com');
  assert.match(create.body.password, GENERATED_RE, 'bootstrap seed password must be generated');
  const text = JSON.stringify(out);
  assert.ok(!text.includes(create.body.password), 'anonymous bootstrap response must never carry the password');
  assert.ok(!text.includes('admin@test.com'), 'anonymous bootstrap response must never carry admin emails');
});

// ── the skeleton key is dead ────────────────────────────────────────────────
await t("the string 'newpress' no longer appears in the handler source", async () => {
  const src = await readFile(new URL('./admin-users.js', import.meta.url), 'utf8');
  assert.ok(!/newpress/i.test(src.replace(/johnny@newpress\.com/g, '')),
    "found 'newpress' in api/admin-users.js — the shared default must not come back");
});

console.log(`admin-users: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
