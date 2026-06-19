// Tests for the auth-gated null-body crash class across three endpoints:
//   api/qss-tts.js          (TTS audio stream)
//   api/qss-tts-karaoke.js  (TTS + word-timing)
//   api/admin-users.js      (admin user management)
//
// Each read its POST body inside a try/catch that only caught req.json()
// REJECTING (malformed JSON), NOT a structurally-valid `null`/non-object body.
// A JSON-literal `null` parses successfully to null, slips past the catch, and
// the subsequent `body.text` / `body.action` access throws a TypeError ->
// unhandled HTTP 500. (admin-users' `let body = {}; try{...}catch{}` was the
// same: null OVERWRITES the {} default, then body.action crashes.) Auth-gated,
// so reachable by an authed client; a bad request mis-reported as a server
// error. Same class fixed publicly this week in research-* / prawn / burma-tk /
// devchat / gemini — these are the surviving auth-gated copies.
//
// Fix: route the read through the shared, mutation-locked readJsonBody helper
// so a bad body is a clean 400, never a 500.
//
// Drives the REAL default exports end-to-end with mock Requests. ACCESS_CODE is
// unset so checkAccess runs in dev/open mode; every bad-body case returns at the
// body guard, and valid-object cases return at the field-required gate BEFORE
// any ElevenLabs/Supabase network call — no test ever hits an external service.

import assert from 'node:assert';

// dev/open access mode + a present ELEVENLABS key so the TTS handlers reach the
// body read (the key gate sits before it). Set before importing the handlers.
delete process.env.ACCESS_CODE;
process.env.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://admin.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ttsHandler     = (await import('./qss-tts.js')).default;
const karaokeHandler = (await import('./qss-tts-karaoke.js')).default;
const adminHandler   = (await import('./admin-users.js')).default;

function post(url, bodyStr) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
}

let passed = 0;
let failed = 0;
async function aok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── RED PROOF: the OLD unguarded reads crash on a JSON-null body ──
await aok('RED: old `body.text` access throws on a null body (would be HTTP 500)', async () => {
  const req = post('https://x/api/qss-tts', 'null');
  const body = await req.json(); // succeeds, returns null
  let threw = false;
  try { void body.text; } catch { threw = true; }
  assert.equal(threw, true, 'old code reads body.text on null -> TypeError -> 500');
});
await aok('RED: old `body.action` access throws on a null body (would be HTTP 500)', async () => {
  const req = post('https://x/api/admin-users', 'null');
  let body = {};
  try { body = await req.json(); } catch {} // null overwrites the {} default
  let threw = false;
  try { void body.action; } catch { threw = true; }
  assert.equal(threw, true, 'old code reads body.action on null -> TypeError -> 500');
});

// ── THE FIX: a non-object / malformed body is a clean 400, never a 500 ──
const BAD = ['null', '42', '"hi"', 'true', '[]', '[{"text":"x"}]'];

for (const b of BAD) {
  await aok(`qss-tts: non-object body ${b} -> 400 (no throw)`, async () => {
    let res;
    try { res = await ttsHandler(post('https://x/api/qss-tts', b)); }
    catch (e) { assert.fail(`handler threw (HTTP 500) on ${b}: ${e.message}`); }
    assert.equal(res.status, 400, `body ${b} should be 400`);
    assert.equal((await res.json()).error, 'body must be a json object');
  });
  await aok(`qss-tts-karaoke: non-object body ${b} -> 400 (no throw)`, async () => {
    let res;
    try { res = await karaokeHandler(post('https://x/api/qss-tts-karaoke', b)); }
    catch (e) { assert.fail(`handler threw (HTTP 500) on ${b}: ${e.message}`); }
    assert.equal(res.status, 400, `body ${b} should be 400`);
    assert.equal((await res.json()).error, 'body must be a json object');
  });
  await aok(`admin-users: non-object body ${b} -> 400 (no throw)`, async () => {
    let res;
    try { res = await adminHandler(post('https://x/api/admin-users', b)); }
    catch (e) { assert.fail(`handler threw (HTTP 500) on ${b}: ${e.message}`); }
    assert.equal(res.status, 400, `body ${b} should be 400`);
    assert.equal((await res.json()).error, 'body must be a json object');
  });
}

// ── BACK-COMPAT: malformed JSON -> 400 invalid json ──
await aok('qss-tts: malformed json -> 400 invalid json', async () => {
  const res = await ttsHandler(post('https://x/api/qss-tts', '{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid json');
});
await aok('qss-tts-karaoke: malformed json -> 400 invalid json', async () => {
  const res = await karaokeHandler(post('https://x/api/qss-tts-karaoke', '{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid json');
});
await aok('admin-users: malformed json -> 400 invalid json', async () => {
  const res = await adminHandler(post('https://x/api/admin-users', '{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid json');
});

// ── A valid object flows PAST the guard to field validation (no crash, no network) ──
await aok('qss-tts: valid object, no text -> 400 text required (body flowed through)', async () => {
  const res = await ttsHandler(post('https://x/api/qss-tts', JSON.stringify({ voice: 'matilda' })));
  assert.equal(res.status, 400, 'reaches the text gate, does not crash');
  assert.equal((await res.json()).error, 'text required');
});
await aok('qss-tts-karaoke: valid object, no text -> 400 text required', async () => {
  const res = await karaokeHandler(post('https://x/api/qss-tts-karaoke', JSON.stringify({ voice: 'matilda' })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'text required');
});
await aok('admin-users: valid object, no action -> 400 action required (returns before access/Supabase)', async () => {
  const res = await adminHandler(post('https://x/api/admin-users', JSON.stringify({ foo: 'bar' })));
  assert.equal(res.status, 400, 'reaches the action gate, does not crash');
  assert.match((await res.json()).error, /action required/);
});

// ── Method gating unaffected ──
await aok('qss-tts: GET -> 405', async () => {
  const res = await ttsHandler(new Request('https://x/api/qss-tts', { method: 'GET' }));
  assert.equal(res.status, 405);
});
await aok('admin-users: GET -> 405', async () => {
  const res = await adminHandler(new Request('https://x/api/admin-users', { method: 'GET' }));
  assert.equal(res.status, 405);
});

console.log(`\nauth-gated-null-body: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
