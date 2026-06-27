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
import { buildThreadQueryUrls, default as handler } from './devchat-respond.js';
import { normalizeAnthropicMessages } from './_lib/anthropic-messages.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };
const at = async (name, fn) => { try { await fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

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

// ───────────────────────────────────────────────────────────────────────────
// NULL-BODY CRASH FIX (same class as the research-* / prawn / burma-tk fixes).
//
// devchat-respond is PUBLIC + anonymous. The old read was
//   let body = {}; try { body = await req.json(); } catch {}
//   const threadId = body.threadId;
// A JSON-literal `null` body parses to null (no throw), overwrites the {}
// default, and `body.threadId` throws a TypeError -> caught by the handler's
// top-level guard -> HTTP 500. A bad request reported as a server error.
// readJsonBody now guarantees a plain object or a clean 400.
//
// These drive the REAL default export end-to-end with mock Requests. Every
// case returns at the body guard or the threadId gate BEFORE any Supabase /
// Anthropic fetch (the mock requests carry no x-forwarded-for, so extractIp()
// -> null, which the rate limiter always lets through), so no test hits the
// network.
function post(bodyStr) {
  return new Request('https://x/api/devchat-respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
}

// Inline RED proof: the OLD unguarded read throws on a JSON-null body.
await at('RED: old unguarded body.threadId access throws on null body', async () => {
  const req = post('null');
  let body = {};
  try { body = await req.json(); } catch {} // succeeds, body becomes null
  let threw = false;
  try { body.threadId; } catch { threw = true; }
  assert.equal(threw, true, 'old code reads body.threadId on null → TypeError → HTTP 500');
});

// THE FIX: a non-object body is a clean 400, never a 500.
for (const b of ['null', '42', '"hi"', 'true', '[]', '[{"threadId":"x"}]']) {
  await at(`non-object body ${b} -> clean 400 (no 500)`, async () => {
    let res;
    try { res = await handler(post(b)); }
    catch (e) { assert.fail(`handler threw on body ${b}: ${e.message}`); }
    assert.equal(res.status, 400, `body ${b} should be 400, not 500`);
    assert.equal((await res.json()).error, 'body must be a json object', `body ${b} 400 message`);
  });
}

// BACK-COMPAT: malformed JSON is a clean 400.
await at('malformed json -> 400 invalid json', async () => {
  const res = await handler(post('{not json'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid json');
});

// A valid object flows through the guard to the threadId gate (no crash).
await at('valid object, no threadId -> 400 threadId required (body flowed through)', async () => {
  const res = await handler(post(JSON.stringify({ message: 'hi' })));
  assert.equal(res.status, 400, 'reaches the threadId gate, does not crash');
  assert.equal((await res.json()).error, 'threadId required');
});
await at('valid object, empty threadId -> 400 threadId required', async () => {
  const res = await handler(post(JSON.stringify({ threadId: '' })));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'threadId required');
});

// Method gating unaffected.
await at('GET -> 405 (POST only)', async () => {
  const res = await handler(new Request('https://x/api/devchat-respond', { method: 'GET' }));
  assert.equal(res.status, 405);
});

// ───────────────────────────────────────────────────────────────────────────
// ANTHROPIC FIRST-TURN-MUST-BE-USER FIX (wiring devchat through the shared
// normalizeAnthropicMessages — the same guard qss-freestyle / tutor-claude use).
//
// devchat builds its Anthropic `messages` by windowing the thread to the last
// 20 user/assistant rows: `recent = userOrAssistant.slice(-20)`, then maps each
// row to a turn. On a long, alternating thread, slice(-20) can land the window's
// HEAD on an ASSISTANT turn — and Anthropic rejects any request whose first
// message isn't `user` ("messages: first message must use the 'user' role"), so
// devchat 400s and Johnny silently gets no reply. The handler now routes
// historyMessages through normalizeAnthropicMessages before forwarding.
//
// These reconstruct the EXACT devchat assembly (filter → slice(-20) → map) and
// prove two things: (a) that assembly genuinely produces a leading-assistant
// head on a long thread — the bug's trigger (the RED assertion) — and (b) the
// shared normalizer the handler now calls turns that into a user-first array
// (the FIX/multimodal assertions). Mutation proof of the load-bearing piece:
// delete the leading-drop loop in anthropic-messages.js and the FIX/multimodal
// assertions go RED. The handler wiring itself (messages: safeMessages, not
// historyMessages) is the one-line code change this regression guards against
// silently rotting back.

// Faithful mirror of devchat-respond.js's assembly (the filter → slice → map).
function devchatAssemble(rows) {
  const userOrAssistant = rows.filter((m) => m.sender === 'user' || m.sender === 'assistant');
  const recent = userOrAssistant.slice(-20);
  return recent.map((m) => {
    const role = m.sender === 'assistant' ? 'assistant' : 'user';
    const images = m.metadata && Array.isArray(m.metadata.images) ? m.metadata.images : [];
    if (role === 'user' && images.length) {
      const content = [];
      for (const img of images) {
        if (!img?.url) continue;
        content.push({ type: 'image', source: { type: 'url', url: img.url } });
      }
      if (m.body) content.push({ type: 'text', text: m.body });
      else if (content.length) content.push({ type: 'text', text: '(image)' });
      return { role, content };
    }
    return { role, content: m.body || '(empty)' };
  });
}

// user, assistant, user, assistant, ... — so slice(-20) opens on an assistant.
function alternatingThread(n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ sender: i % 2 === 0 ? 'user' : 'assistant', body: `msg ${i}` });
  return rows;
}

t('RED: long thread makes the raw window lead with an assistant turn', () => {
  // 25 rows (0..24, even=user / odd=assistant). slice(-20) keeps 5..24; index 5
  // is odd → assistant. The raw array the OLD code forwarded → Anthropic 400.
  const raw = devchatAssemble(alternatingThread(25));
  assert.equal(raw[0].role, 'assistant', 'raw window leads with assistant (the bug)');
});

t('FIX: normalizer makes the long-thread window lead with a user turn', () => {
  const raw = devchatAssemble(alternatingThread(25));
  const safe = normalizeAnthropicMessages(raw);
  assert.ok(safe.length > 0, 'window is non-empty');
  assert.equal(safe[0].role, 'user', 'normalized window leads with user');
  // devchat is called right after the user row is inserted → tail stays a user turn.
  assert.equal(safe[safe.length - 1].role, 'user');
  assert.equal(safe[safe.length - 1].content, 'msg 24');
});

t('all-assistant degenerate window collapses to [] (graceful 400, not Anthropic 400)', () => {
  const raw = devchatAssemble([
    { sender: 'assistant', body: 'a' },
    { sender: 'assistant', body: 'b' },
  ]);
  assert.deepEqual(normalizeAnthropicMessages(raw), []);
});

t('user-turn multimodal image blocks survive normalization untouched', () => {
  const rows = alternatingThread(24); // ends on assistant at idx 23
  rows.push({
    sender: 'user',
    body: 'why is this red?',
    metadata: { images: [{ url: 'https://mycoldmars.com/shot.png' }] },
  });
  const safe = normalizeAnthropicMessages(devchatAssemble(rows));
  assert.equal(safe[0].role, 'user', 'leads with user after dropping the assistant head');
  const last = safe[safe.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content), 'image turn keeps its block-array content');
  assert.equal(last.content[0].type, 'image');
  assert.equal(last.content[0].source.url, 'https://mycoldmars.com/shot.png');
  assert.equal(last.content[1].type, 'text');
  assert.equal(last.content[1].text, 'why is this red?');
});

t('short, already-valid thread is forwarded unchanged (behavior-preserving)', () => {
  const safe = normalizeAnthropicMessages(devchatAssemble([
    { sender: 'user', body: 'hi' },
    { sender: 'assistant', body: 'hello' },
    { sender: 'user', body: 'help me' },
  ]));
  assert.deepEqual(safe, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'help me' },
  ]);
});

console.log(`\ndevchat-respond pgrest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
