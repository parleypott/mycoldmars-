// Tests for api/liveblocks-auth.js — the Liveblocks room-token mint (collab Phase 1).
//
// The pure boundaries: room-id validation (this endpoint mints tokens ONLY for `script-*` rooms),
// the identity shaping (real profile → real name/color; access-code/dev callers → stable guest),
// and the handler's cheap gates (method / body / room / missing-secret) — all exercised WITHOUT
// any network: every asserted path returns before the Liveblocks SDK or Supabase is ever touched.
//
// Run: bun api/liveblocks-auth.test.mjs
import assert from 'node:assert';

// dev-mode gate for the handler paths: no ACCESS_CODE → checkAccess is open, like local dev.
delete process.env.ACCESS_CODE;
delete process.env.LIVEBLOCKS_SECRET_KEY;

const { default: handler, isValidCollabRoom, collabIdentity, stableColorFor, validProfileColor, COLLAB_ROOM_RE } =
  await import('./liveblocks-auth.js');

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

/* ── room validation ─────────────────────────────────────────────────────── */

ok('script rooms for every real project-ref shape are valid', () => {
  assert.equal(isValidCollabRoom('script-burma'), true);
  assert.equal(isValidCollabRoom('script-palau2'), true);
  assert.equal(isValidCollabRoom('script-3f2c8a1e-9b4d-4f6a-8c2e-1d5b7a9c0e3f'), true); // library uuid
  assert.equal(isValidCollabRoom('script-my_new_script'), true);
});

ok('non-script / malformed / hostile rooms are refused', () => {
  assert.equal(isValidCollabRoom('lobby'), false);
  assert.equal(isValidCollabRoom('script-'), false);                    // empty ref
  assert.equal(isValidCollabRoom('script-a b'), false);                 // spaces
  assert.equal(isValidCollabRoom('script-*'), false);                   // wildcard grab
  assert.equal(isValidCollabRoom('script-' + 'x'.repeat(200)), false);  // unbounded
  assert.equal(isValidCollabRoom(''), false);
  assert.equal(isValidCollabRoom(null), false);
  assert.equal(isValidCollabRoom(42), false);
  assert.equal(isValidCollabRoom({}), false);
});

ok('room regex is anchored (no prefix/suffix smuggling)', () => {
  assert.equal(COLLAB_ROOM_RE.test('evil script-burma'), false);
  assert.equal(COLLAB_ROOM_RE.test('script-burma\nscript-other'), false);
});

/* ── identity shaping ────────────────────────────────────────────────────── */

ok('signed-in user with a profile gets real name + color', () => {
  const id = collabIdentity('user-123', { display_name: '  Johnny  ', color: '#ff5b1f' });
  assert.equal(id.id, 'user-123');
  assert.equal(id.name, 'Johnny');       // trimmed
  assert.equal(id.color, '#ff5b1f');
  assert.equal(id.attributed, true);
});

ok('signed-in user WITHOUT a profile row still gets a stable identity', () => {
  const id = collabIdentity('user-123', null);
  assert.equal(id.id, 'user-123');
  assert.equal(id.name, 'Teammate');
  assert.equal(id.color, stableColorFor('user-123')); // deterministic, not random
  assert.equal(id.attributed, true);
});

ok('access-code / dev caller (no userId) becomes a guest, never a crash', () => {
  const id = collabIdentity(null, null, 'abc123');
  assert.equal(id.id, 'guest-abc123');
  assert.equal(id.name, 'Guest');
  assert.equal(typeof id.color, 'string');
  assert.equal(id.attributed, false);
});

ok('junk profile fields fall back instead of leaking junk', () => {
  const id = collabIdentity('u1', { display_name: '   ', color: 42 });
  assert.equal(id.name, 'Teammate');
  assert.equal(id.color, stableColorFor('u1'));
});

// The same shared user_profiles.color column presence validates (api/script-presence.js
// validateHeartbeat drops non-hex / 5- and 7-digit junk). A malformed hand-set color must fall
// back to a stable palette color, NOT ride into a Liveblocks caret as a colorless userInfo.color.
ok('validProfileColor accepts only valid CSS hex lengths (3/4/6/8)', () => {
  assert.equal(validProfileColor('#abc'), '#abc');
  assert.equal(validProfileColor('#abcd'), '#abcd');
  assert.equal(validProfileColor('#ff5b1f'), '#ff5b1f');
  assert.equal(validProfileColor('  #FF5B1FCC  '), '#FF5B1FCC'); // trimmed, 8-digit
  assert.equal(validProfileColor('#12345'), null);   // 5-digit is NOT a CSS color
  assert.equal(validProfileColor('#1234567'), null); // 7-digit is NOT a CSS color
  assert.equal(validProfileColor('red'), null);      // named colors not stored here
  assert.equal(validProfileColor('ff5b1f'), null);   // missing '#'
  assert.equal(validProfileColor(42), null);
  assert.equal(validProfileColor(null), null);
});

ok('a malformed hand-set profile color falls back to a stable palette color (not colorless)', () => {
  const bad = collabIdentity('u9', { display_name: 'Ed', color: '#12345' }); // 5-digit junk
  assert.equal(bad.name, 'Ed');
  assert.equal(bad.color, stableColorFor('u9'));           // fell back — the load-bearing assertion
  assert.match(bad.color, /^#[0-9a-f]{6}$/i);              // a real, paintable color
  const good = collabIdentity('u9', { display_name: 'Ed', color: '#0af' }); // valid short hex survives
  assert.equal(good.color, '#0af');
});

ok('stableColorFor is deterministic and always a palette hex', () => {
  assert.equal(stableColorFor('seed'), stableColorFor('seed'));
  assert.match(stableColorFor('anything'), /^#[0-9a-f]{6}$/i);
});

/* ── handler cheap gates (no network on any of these paths) ─────────────── */

function post(body) {
  return new Request('http://x/api/liveblocks-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

await okAsync('GET is 405', async () => {
  const r = await handler(new Request('http://x/api/liveblocks-auth', { method: 'GET' }));
  assert.equal(r.status, 405);
});

await okAsync('OPTIONS preflight is 204 with CORS', async () => {
  const r = await handler(new Request('http://x/api/liveblocks-auth', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.ok(r.headers.get('Access-Control-Allow-Origin'));
});

await okAsync('non-JSON body is 400 BAD_JSON', async () => {
  const r = await handler(post('not json'));
  assert.equal(r.status, 400);
  const b = await r.json();
  assert.equal(b.error.code, 'BAD_JSON');
});

await okAsync('missing / non-script room is 400 BAD_ROOM', async () => {
  for (const room of [undefined, '', 'lobby', 'script-*', 'script-a b']) {
    const r = await handler(post({ room }));
    assert.equal(r.status, 400, `room=${JSON.stringify(room)} should 400`);
    const b = await r.json();
    assert.equal(b.error.code, 'BAD_ROOM');
  }
});

await okAsync('valid room but no LIVEBLOCKS_SECRET_KEY is a clean 503 (collab unavailable, not a crash)', async () => {
  const r = await handler(post({ room: 'script-burma' }));
  assert.equal(r.status, 503);
  const b = await r.json();
  assert.equal(b.error.code, 'NO_LIVEBLOCKS');
});

await okAsync('when ACCESS_CODE is set, an ungated caller is refused 401 BEFORE any room/secret logic', async () => {
  process.env.ACCESS_CODE = 'sekrit';
  try {
    const r = await handler(post({ room: 'script-burma' }));
    assert.equal(r.status, 401);
    assert.ok(r.headers.get('Access-Control-Allow-Origin'), '401 must carry CORS so the browser can read it');
    // and the access-code path still opens the gate:
    const r2 = await handler(new Request('http://x/api/liveblocks-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': 'sekrit' },
      body: JSON.stringify({ room: 'script-burma' }),
    }));
    assert.equal(r2.status, 503, 'past the gate, no secret → 503 (never touched the network)');
  } finally {
    delete process.env.ACCESS_CODE;
  }
});

console.log(`liveblocks-auth: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
