// Tests for the auth-gated null-body crash class across the remaining ten QSS
// endpoints the loop logged after the qss-tts / qss-tts-karaoke / admin-users
// fix (iteration #24):
//   qss-character-card, qss-character-compare, qss-explore-generate,
//   qss-image-upload, qss-observe, qss-scene-build, qss-story-report,
//   qss-story-title, qss-touch-base, qss-arc-extract
//
// Each read its POST body inside a try/catch that only caught req.json()
// REJECTING (malformed JSON), NOT a structurally-valid `null`/non-object body.
// A JSON-literal `null` parses successfully to null, slips past the catch, and
// the next access (body.character / body.event / body.story_name /
// body.blocks ...) throws a TypeError on null -> unhandled HTTP 500. (The
// earlier loop note that `Array.isArray(body.blocks)`-first handlers were "safe"
// was WRONG: evaluating `body.blocks` on a null body throws BEFORE Array.isArray
// ever runs.) Auth-gated, so reachable by an authed client; a bad request
// mis-reported as a server error. Same class fixed this week in research-* /
// prawn / burma-tk / devchat / gemini and the first three auth-gated copies.
//
// Fix: route every read through the shared, mutation-locked readJsonBody helper
// so a bad body is a clean 400, never a 500.
//
// Drives the REAL default exports end-to-end with mock Requests. ACCESS_CODE is
// unset so checkAccess runs in dev/open mode; the provider key/env gates are
// satisfied so each handler REACHES the body read. Every bad-body case returns
// at the body guard, and a minimal valid object returns at each handler's own
// field gate (or stub / "not enough yet" branch) BEFORE any Anthropic / Gemini /
// Supabase network call — no test ever hits an external service.

import assert from 'node:assert';

// dev/open access + present provider keys + Supabase env, so every handler gets
// PAST its pre-body gate to the body read. Set before importing the handlers.
delete process.env.ACCESS_CODE;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://x.test';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.QSS_SUPABASE_URL = process.env.QSS_SUPABASE_URL || 'https://x.test';
process.env.QSS_SUPABASE_SERVICE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || 'test-key';

const HANDLERS = [
  { name: 'qss-character-card',    file: './qss-character-card.js' },
  { name: 'qss-character-compare', file: './qss-character-compare.js' },
  { name: 'qss-explore-generate',  file: './qss-explore-generate.js' },
  { name: 'qss-image-upload',      file: './qss-image-upload.js' },
  { name: 'qss-observe',           file: './qss-observe.js' },
  { name: 'qss-scene-build',       file: './qss-scene-build.js' },
  { name: 'qss-story-report',      file: './qss-story-report.js' },
  { name: 'qss-story-title',       file: './qss-story-title.js' },
  { name: 'qss-touch-base',        file: './qss-touch-base.js' },
  { name: 'qss-arc-extract',       file: './qss-arc-extract.js' },
];
for (const h of HANDLERS) h.handler = (await import(h.file)).default;

function post(name, bodyStr) {
  return new Request(`https://x/api/${name}`, {
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
await aok('RED: old `body.character` access throws on a null body (would be HTTP 500)', async () => {
  const body = await post('qss-character-card', 'null').json(); // succeeds, returns null
  let threw = false;
  try { void (body.character || {}); } catch { threw = true; }
  assert.equal(threw, true, 'old code reads body.character on null -> TypeError -> 500');
});
await aok('RED: old `Array.isArray(body.blocks)` throws on a null body (the "safe-first" myth)', async () => {
  const body = await post('qss-arc-extract', 'null').json();
  let threw = false;
  try { void Array.isArray(body.blocks); } catch { threw = true; }
  assert.equal(threw, true, 'evaluating body.blocks on null throws BEFORE Array.isArray runs -> 500');
});
await aok('RED: old `body.event` access throws on a null body (would be HTTP 500)', async () => {
  const body = await post('qss-observe', 'null').json();
  let threw = false;
  try { void (body.event || ''); } catch { threw = true; }
  assert.equal(threw, true, 'old code reads body.event on null -> TypeError -> 500');
});

// ── THE FIX: a non-object body is a clean 400 "body must be a json object" ──
const BAD = ['null', '42', '"hi"', 'true', '[]', '[{"x":1}]'];
for (const h of HANDLERS) {
  for (const b of BAD) {
    await aok(`${h.name}: non-object body ${b} -> 400 (no throw)`, async () => {
      let res;
      try { res = await h.handler(post(h.name, b)); }
      catch (e) { assert.fail(`handler threw (HTTP 500) on ${b}: ${e.message}`); }
      assert.equal(res.status, 400, `body ${b} should be 400`);
      assert.equal((await res.json()).error, 'body must be a json object', `body ${b} wrong error`);
    });
  }
}

// ── BACK-COMPAT: malformed JSON -> 400 "invalid json" ──
for (const h of HANDLERS) {
  await aok(`${h.name}: malformed json -> 400 invalid json`, async () => {
    let res;
    try { res = await h.handler(post(h.name, '{not json')); }
    catch (e) { assert.fail(`handler threw on malformed json: ${e.message}`); }
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid json');
  });
}

// ── A valid object flows PAST the body guard (to a field gate / stub), no crash,
//    no network. The universal proof: the response is NOT the body-guard 400. ──
for (const h of HANDLERS) {
  await aok(`${h.name}: valid {} object flows past the body guard (no crash, no network)`, async () => {
    let res;
    try { res = await h.handler(post(h.name, '{}')); }
    catch (e) { assert.fail(`handler threw on a valid object body: ${e.message}`); }
    // It may land on a 400 field gate, a 200 stub, or a 200 "not enough yet" —
    // any of those proves it got PAST the body guard. The one thing it must NOT
    // be is the body-guard rejection.
    if (res.status === 400) {
      const err = (await res.json()).error;
      assert.notEqual(err, 'body must be a json object', 'must be past the body guard');
      assert.notEqual(err, 'invalid json', 'a valid object is not malformed json');
    }
  });
}

// ── Method gating unaffected (spot-check two shapes) ──
await aok('qss-observe: GET -> 405', async () => {
  const res = await HANDLERS.find(h => h.name === 'qss-observe').handler(
    new Request('https://x/api/qss-observe', { method: 'GET' }));
  assert.equal(res.status, 405);
});
await aok('qss-arc-extract: GET -> 405', async () => {
  const res = await HANDLERS.find(h => h.name === 'qss-arc-extract').handler(
    new Request('https://x/api/qss-arc-extract', { method: 'GET' }));
  assert.equal(res.status, 405);
});

console.log(`\nqss-null-body-sweep: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
