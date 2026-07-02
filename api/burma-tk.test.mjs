// Coverage for api/burma-tk.js — the WP-01 Burma Script {TK} writing helper + {fc}
// fact-check backend (a Johnny-facing tool). Two things locked here:
//
//   1. THE FIX (real bug): the handler read the POST body with `await req.json()`
//      in a try/catch (so malformed JSON was a clean 400), but had NO object guard
//      before `body.mode` — so a structurally-valid but NON-OBJECT body (a JSON
//      literal `null`, a number, a string, an array) slipped past the catch and
//      crashed at `body.mode` -> unhandled TypeError -> HTTP 500. Same null-body
//      crash class fixed across the research-* endpoints (commit 17318ec); burma-tk
//      was missed. Now routed through the shared readJsonBody -> a bad body is a 400.
//
//   2. THE PROMPT BUILDERS (verifier-layer lock): tkPrompt / fcPrompt are pure
//      string builders that decide whether the model writes in Johnny's voice at
//      the right altitude. Locked so a regression (dropped marker, wrong tool,
//      mode collapse) is caught.
//
// The end-to-end cases drive the REAL shipped default export with mock Requests and
// assert NO throw — that is the mutation proof for the fix (revert to `body.mode` on
// a null body and the handler rejects, failing these cases).

import assert from 'node:assert';
import handler, { tkPrompt, fcPrompt, rateLimitCheck, identityKey } from './burma-tk.js';

// The valid-marker path would reach the Anthropic fetch; unset the key so the handler
// stops at the apiKey guard (500 'not set') BEFORE any network call — proving it runs
// end-to-end through all body validation without crashing and never hits fetch here.
delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  RED:', name); }
}

// A mock edge Request. jsonThrows=true simulates a malformed body (req.json() rejects).
function mockReq({ method = 'POST', body, jsonThrows = false } = {}) {
  return {
    method,
    json: async () => { if (jsonThrows) throw new SyntaxError('Unexpected token'); return body; },
  };
}
async function call(opts) {
  const res = await handler(mockReq(opts));
  let parsed = null;
  try { parsed = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: parsed };
}

// ---- inline RED proof: the OLD body handling crashes on a non-object body ----
{
  function oldHandle(body) { return body.mode === 'fc' ? 'fc' : 'tk'; }
  let threw = false;
  try { oldHandle(null); } catch { threw = true; }
  ok('RED proof: old `body.mode` access throws (->500) on a JSON-null body', threw);
}

// ---- THE FIX: a non-object / malformed body is a clean 400, never a throw ----
for (const bad of [null, 42, 'a string', [1, 2, 3], true]) {
  const r = await call({ body: bad });
  ok(`null/non-object body ${JSON.stringify(bad)} -> 400 (no throw)`, r.status === 400);
  ok(`  ... body-must-be-object message`, r.body && r.body.error === 'body must be a json object');
}
{
  const r = await call({ jsonThrows: true });
  ok('malformed JSON body -> 400 invalid json', r.status === 400 && r.body.error === 'invalid json');
}

// ---- method + field validation (all return BEFORE the Anthropic fetch) ----
{
  const r = await call({ method: 'GET' });
  ok('GET -> 405', r.status === 405);
}
{
  const r = await call({ body: {} });
  ok('valid object, no marker -> 400 marker required', r.status === 400 && r.body.error === 'marker required');
}
{
  const r = await call({ body: { marker: '   ' } });
  ok('whitespace-only marker -> 400 marker required', r.status === 400);
}
{
  const r = await call({ body: { marker: 'x'.repeat(1201) } });
  ok('marker > 1200 -> 413 too long', r.status === 413 && r.body.error === 'marker too long');
}
{
  // A valid marker now passes body+field validation and reaches the apiKey guard
  // (key deleted above) — proving the handler runs the whole validation chain
  // without crashing and STOPS before any network call.
  const r = await call({ body: { marker: 'how many EAOs are there' } });
  ok('valid marker, no API key -> 500 key-not-set (reached, no fetch)', r.status === 500);
  ok('  ... no crash, returned a structured error', r.body && typeof r.body.error === 'string');
}

// ---- prompt builders: tkPrompt ----
{
  const p = tkPrompt({ marker: 'NUMBER_OF_EAOS', block: 'BLOCK_TEXT', context: 'CONTEXT_TEXT' });
  ok('tkPrompt embeds the marker', p.includes('NUMBER_OF_EAOS'));
  ok('tkPrompt embeds the block', p.includes('BLOCK_TEXT'));
  ok('tkPrompt embeds the context', p.includes('CONTEXT_TEXT'));
  ok('tkPrompt calls for emit_options', p.includes('emit_options'));
  ok('tkPrompt asks for FIVE alternatives', p.includes('FIVE'));
  ok('tkPrompt names Johnny / Burma', p.includes('Johnny Harris') && p.includes('Burma'));
}
{
  const p = tkPrompt({ marker: 'M' });
  ok('tkPrompt missing block -> fallback string', p.includes('(no surrounding block)'));
  ok('tkPrompt missing context -> fallback string', p.includes('(no extra context)'));
}

// ---- prompt builders: fcPrompt ----
{
  const p = fcPrompt({ marker: 'CLAIM_X', block: 'BLK', context: 'CTX' });
  ok('fcPrompt embeds the marker', p.includes('CLAIM_X'));
  ok('fcPrompt embeds the block', p.includes('BLK'));
  ok('fcPrompt embeds the context', p.includes('CTX'));
  ok('fcPrompt drives web_search', p.includes('web_search'));
  ok('fcPrompt calls emit_verdict', p.includes('emit_verdict'));
}
{
  const p = fcPrompt({ marker: 'M' });
  ok('fcPrompt missing block -> (none) fallback', p.includes('(none)'));
}

// ---- the two modes produce DISTINCT prompts ----
{
  const args = { marker: 'M', block: 'B', context: 'C' };
  ok('tk vs fc prompts differ', tkPrompt(args) !== fcPrompt(args));
  ok('tk prompt does NOT mention web_search', !tkPrompt(args).includes('web_search'));
  ok('fc prompt does NOT call emit_options', !fcPrompt(args).includes('emit_options'));
}

// ---- Enterprise Wave 1 #5: SIGN-IN GATE (audit finding M) ----
// burma-tk was unauthenticated. It now runs checkAccess. In dev (ACCESS_CODE unset) it's a no-op —
// that's the mode every case above ran in. With ACCESS_CODE set, an unauth'd request is 401, and a
// request carrying the correct x-access-code passes the gate (and stops later at the apiKey guard).
{
  const withHeaders = (headers, body = { marker: 'valid marker text' }) => ({
    method: 'POST', headers, json: async () => body,
  });
  process.env.ACCESS_CODE = 'sekret';
  try {
    const denied = await handler(withHeaders({})); // no code, no bearer
    ok('gated: no access code -> 401', denied.status === 401);
    const okReq = await handler(withHeaders({ 'x-access-code': 'sekret' }));
    ok('gated: correct x-access-code passes gate (reaches apiKey guard -> 500)', okReq.status === 500);
    const wrong = await handler(withHeaders({ 'x-access-code': 'nope' }));
    ok('gated: wrong x-access-code -> 401', wrong.status === 401);
  } finally {
    delete process.env.ACCESS_CODE; // restore dev mode so nothing downstream is affected
  }
}

// ---- Enterprise Wave 1 #5: RATE LIMIT (token bucket) ----
{
  const key = 'test-key-' + Math.random().toString(36).slice(2);
  const t0 = 1_000_000;
  let denied = 0, allowed = 0;
  for (let i = 0; i < 25; i++) {
    const r = rateLimitCheck(key, t0); // same instant → no refill
    if (r.allowed) allowed++; else denied++;
  }
  ok('rate limit: first 20 (burst) allowed', allowed === 20);
  ok('rate limit: the rest denied', denied === 5);
  ok('rate limit: denied carries a Retry-After hint', rateLimitCheck(key, t0).retryAfter >= 1);
  // Tokens refill over time — a minute later the bucket is full again.
  ok('rate limit: refills after a minute', rateLimitCheck(key, t0 + 60_000).allowed === true);
  // Identity keying: a Bearer JWT keys per-user; otherwise per forwarded IP.
  ok('identityKey: uses the Bearer token', identityKey({ headers: { authorization: 'Bearer abc.def.ghi' } }).startsWith('jwt:'));
  ok('identityKey: falls back to IP', identityKey({ headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' } }) === 'ip:9.9.9.9');
}

console.log(`burma-tk: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
