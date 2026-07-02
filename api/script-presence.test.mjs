// Tests for api/script-presence.js — basic "who else is in this project" heartbeat (Wave 2).
//
// The pure boundary is heartbeat validation: a row must carry a project + holder, labels/colors are
// sanitized (hex-only color, bounded label), and junk is dropped rather than stored. Also lock the
// active-window constant so a drift doesn't silently make everyone look permanently online / offline.
//
// Run: bun api/script-presence.test.mjs
import assert from 'node:assert';

const { validateHeartbeat, ACTIVE_WINDOW_MS } = await import('./script-presence.js');

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

ok('valid heartbeat passes and normalizes', () => {
  const v = validateHeartbeat({ projectId: 'burma', holderId: 'u1', label: '  Johnny  ', color: '#2b7fff', sectionId: 'sec-3' });
  assert.equal(v.ok, true);
  assert.equal(v.projectId, 'burma');
  assert.equal(v.holderId, 'u1');
  assert.equal(v.label, 'Johnny');      // trimmed
  assert.equal(v.color, '#2b7fff');
  assert.equal(v.sectionId, 'sec-3');
});

ok('missing projectId refused', () => {
  assert.equal(validateHeartbeat({ holderId: 'u1' }).code, 'NO_PROJECT');
  assert.equal(validateHeartbeat({ projectId: '  ', holderId: 'u1' }).code, 'NO_PROJECT');
});

ok('missing holderId refused', () => {
  assert.equal(validateHeartbeat({ projectId: 'burma' }).code, 'NO_HOLDER');
});

ok('non-hex color is dropped, not stored', () => {
  const v = validateHeartbeat({ projectId: 'p', holderId: 'h', color: 'red; DROP TABLE' });
  assert.equal(v.ok, true);
  assert.equal(v.color, null);
});

ok('hex colors of assorted lengths accepted', () => {
  for (const c of ['#fff', '#2b7fff', '#2b7fffcc']) {
    assert.equal(validateHeartbeat({ projectId: 'p', holderId: 'h', color: c }).color, c);
  }
});

ok('label bounded to 80 chars', () => {
  const v = validateHeartbeat({ projectId: 'p', holderId: 'h', label: 'x'.repeat(200) });
  assert.equal(v.label.length, 80);
});

ok('empty label ok (renders as initial fallback client-side)', () => {
  const v = validateHeartbeat({ projectId: 'p', holderId: 'h' });
  assert.equal(v.ok, true);
  assert.equal(v.label, '');
  assert.equal(v.color, null);
  assert.equal(v.sectionId, null);
});

ok('overlong holderId refused', () => {
  assert.equal(validateHeartbeat({ projectId: 'p', holderId: 'x'.repeat(201) }).code, 'BAD_HOLDER');
});

ok('non-object body refused', () => {
  assert.equal(validateHeartbeat(null).code, 'BAD_BODY');
  assert.equal(validateHeartbeat('str').code, 'BAD_BODY');
});

ok('active window is 30s (one missed 15s beat tolerated)', () => {
  assert.equal(ACTIVE_WINDOW_MS, 30_000);
});

console.log(failed === 0
  ? `PASS — all ${passed} script-presence cases correct`
  : `\n${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
