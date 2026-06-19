// Tests for the devchat-respond PostgREST filter escaping (security fix).
//
// devchat-respond is a PUBLIC, anonymous, service-role endpoint. It built its
// thread/message query URLs by interpolating a caller-supplied `threadId`
// straight into `id=eq.${threadId}` — so a payload containing `&` appended
// EXTRA query params onto a service-role (RLS-bypassing) read. buildThreadQueryUrls
// now routes threadId through pgrValue (encodeURIComponent), neutralizing the
// param separators. These tests prove the breakout is closed and that escaping
// is a no-op for legitimate ids.
//
// Run: bun api/devchat-respond.test.mjs   (also picked up by `bun run test`)

import assert from 'node:assert/strict';
import { pgrValue } from './_lib/pgrest.js';
import { buildThreadQueryUrls } from './devchat-respond.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

const SUPA = 'https://example.supabase.co';
const REAL_UUID = '3f9a1c2e-7b4d-4e1a-9c8f-0a1b2c3d4e5f';

// The exact attack the fix exists to stop: a threadId that smuggles an extra
// `or=(...)` query param onto the service-role request to broaden the filter.
const INJECT_OR = '0&or=(id.gte.0)';
// A select-override attempt: try to traverse another table via PostgREST embed.
const INJECT_SELECT = 'x&select=*,devchat_threads(*)';

// ── Inline RED proof: the OLD raw interpolation leaks the injected param ──
// Reconstruct exactly what the source did before the fix and prove an
// injection payload appends a real, separate query parameter.
function oldRawThreadUrl(supaUrl, threadId) {
  return `${supaUrl}/rest/v1/devchat_threads?id=eq.${threadId}&select=*`;
}
t('RED: old raw interpolation lets `or=` inject as a separate query param', () => {
  const u = new URL(oldRawThreadUrl(SUPA, INJECT_OR));
  // The injection succeeds under the old code: a distinct `or` param appears.
  assert.equal(u.searchParams.has('or'), true);
  assert.equal(u.searchParams.get('or'), '(id.gte.0)');
  // And the id filter collapsed to just `eq.0`, not the intended literal.
  assert.equal(u.searchParams.get('id'), 'eq.0');
});
t('RED: old raw interpolation lets a `select` override inject', () => {
  const u = new URL(oldRawThreadUrl(SUPA, INJECT_SELECT));
  // Two select params now exist — the attacker added one.
  assert.equal(u.searchParams.getAll('select').length, 2);
});

// ── pgrValue unit behavior ──
t('pgrValue null/undefined → empty string', () => {
  assert.equal(pgrValue(null), '');
  assert.equal(pgrValue(undefined), '');
});
t('pgrValue encodes the PostgREST param separators', () => {
  assert.equal(pgrValue('a&b'), 'a%26b');     // & → %26  (the load-bearing one)
  assert.equal(pgrValue('a=b'), 'a%3Db');     // = → %3D
  assert.ok(!pgrValue(INJECT_OR).includes('&'));
  assert.ok(!pgrValue(INJECT_OR).includes('='));
});
t('pgrValue is a no-op for a real UUID', () => {
  assert.equal(pgrValue(REAL_UUID), REAL_UUID);
});
t('pgrValue is a no-op for an integer id', () => {
  assert.equal(pgrValue(12345), '12345');
});
t('pgrValue coerces non-strings without throwing', () => {
  assert.equal(pgrValue(0), '0');
  assert.equal(pgrValue(true), 'true');
});

// ── buildThreadQueryUrls: the real shipped builder ──
t('builds both URLs against the supplied supabase origin', () => {
  const { threadUrl, messagesUrl } = buildThreadQueryUrls(SUPA, REAL_UUID);
  assert.ok(threadUrl.startsWith(`${SUPA}/rest/v1/devchat_threads?`));
  assert.ok(messagesUrl.startsWith(`${SUPA}/rest/v1/devchat_messages?`));
});

t('legit UUID round-trips verbatim through both filters (no-op)', () => {
  const { threadUrl, messagesUrl } = buildThreadQueryUrls(SUPA, REAL_UUID);
  const tu = new URL(threadUrl);
  const mu = new URL(messagesUrl);
  assert.equal(tu.searchParams.get('id'), `eq.${REAL_UUID}`);
  assert.equal(mu.searchParams.get('thread_id'), `eq.${REAL_UUID}`);
  // The legitimate params, and ONLY those.
  assert.deepEqual([...tu.searchParams.keys()].sort(), ['id', 'select']);
  assert.deepEqual([...mu.searchParams.keys()].sort(), ['order', 'select', 'thread_id']);
});

t('GREEN: `or=` injection is neutralized in the thread URL', () => {
  const { threadUrl } = buildThreadQueryUrls(SUPA, INJECT_OR);
  const u = new URL(threadUrl);
  assert.equal(u.searchParams.has('or'), false);              // no extra param
  assert.equal(u.searchParams.get('id'), `eq.${INJECT_OR}`);  // whole payload is the literal value
  assert.deepEqual([...u.searchParams.keys()].sort(), ['id', 'select']);
});

t('GREEN: `or=` injection is neutralized in the messages URL', () => {
  const { messagesUrl } = buildThreadQueryUrls(SUPA, INJECT_OR);
  const u = new URL(messagesUrl);
  assert.equal(u.searchParams.has('or'), false);
  assert.equal(u.searchParams.get('thread_id'), `eq.${INJECT_OR}`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['order', 'select', 'thread_id']);
});

t('GREEN: `select` override is neutralized — exactly one select param', () => {
  const { threadUrl } = buildThreadQueryUrls(SUPA, INJECT_SELECT);
  const u = new URL(threadUrl);
  assert.equal(u.searchParams.getAll('select').length, 1);
  assert.equal(u.searchParams.get('select'), '*');
  assert.equal(u.searchParams.get('id'), `eq.${INJECT_SELECT}`);
});

t('hard invariant: no caller-supplied threadId can add a query param', () => {
  const payloads = [
    INJECT_OR, INJECT_SELECT,
    'a&limit=9999', 'b&id=eq.something', 'c&apikey=leak',
    'd&or=(status.eq.x)&select=*', '&&&', 'x=y&z=w', REAL_UUID, '12', '',
  ];
  for (const p of payloads) {
    const { threadUrl, messagesUrl } = buildThreadQueryUrls(SUPA, p);
    const tk = [...new URL(threadUrl).searchParams.keys()].sort();
    const mk = [...new URL(messagesUrl).searchParams.keys()].sort();
    assert.deepEqual(tk, ['id', 'select'], `thread keys for payload ${JSON.stringify(p)}`);
    assert.deepEqual(mk, ['order', 'select', 'thread_id'], `message keys for payload ${JSON.stringify(p)}`);
  }
});

t('null/undefined threadId yields an empty filter value, not "undefined"', () => {
  const { threadUrl } = buildThreadQueryUrls(SUPA, undefined);
  assert.equal(new URL(threadUrl).searchParams.get('id'), 'eq.');
});

console.log(`\ndevchat-respond pgrest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
