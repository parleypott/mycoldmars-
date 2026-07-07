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
import handler, { tkPrompt, fcPrompt, quotePrompt, rateLimitCheck, identityKey, buildPayload, FC_UPSTREAM_TIMEOUT_MS } from './burma-tk.js';

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

// ── FIX 2026-07-06: the "CHECKING… forever" hang ──────────────────────────────────────────────
// Measured in prod: a live fc request rode past the old 100s fetch-only AbortController to the
// 120s FUNCTION_INVOCATION_TIMEOUT platform kill, returning a PLAIN-TEXT page after 120.1s. The
// locks below pin the three levers of the fix.

// (a) the server deadline is a HARD bound comfortably under every platform cap (60s clamp incl.).
{
  ok('timeout: FC_UPSTREAM_TIMEOUT_MS ≤ 55s (under the 60s platform clamp)', FC_UPSTREAM_TIMEOUT_MS <= 55_000);
  ok('timeout: FC_UPSTREAM_TIMEOUT_MS ≥ 30s (room for a real 2-3 search verify)', FC_UPSTREAM_TIMEOUT_MS >= 30_000);
}

// (b) the payload is tuned for speed: current Sonnet, current web_search tool, max_uses 5→3.
{
  const p = buildPayload('fc', { marker: 'M', block: 'B', context: 'C' });
  ok('payload fc: current model id (no stale date-pinned sonnet-4-5)', p.model === 'claude-sonnet-4-6');
  const ws = (p.tools || []).find((t) => t.name === 'web_search');
  ok('payload fc: web_search tool present', !!ws);
  ok('payload fc: current web_search version (20260209, dynamic filtering)', ws && ws.type === 'web_search_20260209');
  ok('payload fc: max_uses capped at 3 (was 5 — the latency lever)', ws && ws.max_uses === 3);
  ok('payload fc: emit_verdict tool present', (p.tools || []).some((t) => t.name === 'emit_verdict'));
  ok('payload fc: tool_choice auto (model must be free to search first)', p.tool_choice && p.tool_choice.type === 'auto');

  const tk = buildPayload('tk', { marker: 'M', block: 'B', context: 'C' });
  ok('payload tk: NO web_search', !(tk.tools || []).some((t) => t.name === 'web_search'));
  ok('payload tk: emit_options forced', tk.tool_choice && tk.tool_choice.type === 'tool' && tk.tool_choice.name === 'emit_options');
  ok('payload fc prompt: tells the model its search budget', String(p.messages[0].content).includes('at most 3 searches'));
}

// (c) the deadline WINS even when the upstream fetch never settles and IGNORES the abort signal —
//     this is the exact prod failure mode (function rode to the platform kill). Promise.race
//     guarantees our clean JSON 504 regardless of undici signal plumbing.
{
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.BURMA_TK_TIMEOUT_MS = '60'; // test hook: 60ms deadline instead of 50s
  try {
    // hung fetch that ignores the signal entirely — never resolves, never rejects
    globalThis.fetch = () => new Promise(() => {});
    const r1 = await call({ body: { mode: 'fc', marker: 'the river is named after an elephant' } });
    ok('hang: hung signal-ignoring fetch -> clean JSON 504 (never platform page)', r1.status === 504);
    ok('hang: 504 body is structured with timeout flag', r1.body && r1.body.timeout === true && /verify in \d+s/.test(r1.body.error));

    // well-behaved fetch that rejects with AbortError when the deadline aborts it
    globalThis.fetch = (_url, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const r2 = await call({ body: { mode: 'fc', marker: 'claim two' } });
    ok('hang: abort-respecting fetch -> same clean JSON 504', r2.status === 504 && r2.body && r2.body.timeout === true);

    // tk mode gets the same guarantee with its own message
    const r3 = await call({ body: { mode: 'tk', marker: 'gap text' } });
    ok('hang: tk mode timeout -> 504 with tk wording', r3.status === 504 && /writing helper timed out/.test(r3.body.error));
  } finally {
    delete process.env.BURMA_TK_TIMEOUT_MS;
  }

  // (d) fast paths still work end-to-end under the race: success + upstream error both return
  //     BEFORE the deadline (proving the race resolves on the upstream branch too).
  process.env.BURMA_TK_TIMEOUT_MS = '5000';
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      content: [
        { type: 'text', text: 'searching…' },
        { type: 'tool_use', name: 'emit_verdict', input: { verdict: 'false', finding: 'Named after a mythical creature.', suggestedEdit: 'the line', sources: [{ label: 'src' }] } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const r4 = await call({ body: { mode: 'fc', marker: 'claim three' } });
    ok('race: successful verdict flows through -> 200', r4.status === 200);
    ok('race: verdict payload intact', r4.body && r4.body.mode === 'fc' && r4.body.verdict === 'false' && r4.body.finding.includes('mythical'));

    globalThis.fetch = async () => new Response('overloaded', { status: 529 });
    const r5 = await call({ body: { mode: 'fc', marker: 'claim four' } });
    ok('race: anthropic error -> clean 502 JSON (not a hang, not a throw)', r5.status === 502 && /anthropic 529/.test(r5.body.error));
  } finally {
    delete process.env.BURMA_TK_TIMEOUT_MS;
    delete process.env.ANTHROPIC_API_KEY; // restore the no-key state earlier cases rely on
    globalThis.fetch = realFetch;
  }
}

// ---- VERCEL NODE ADAPTER (the "CHECKING… -> FUNCTION_INVOCATION_TIMEOUT" root cause) ----
// runtime:'nodejs' invokes the default export with (IncomingMessage, ServerResponse) and IGNORES
// a returned web Response. The old web-only handler therefore never ended `res`: EVERY request --
// even a bare GET -- hung to the 60s platform wall (reproduced in prod 2026-07-06). Lock the fix:
// Node-style invocation must WRITE the response through `res`, for the cheap 405 and a body-carrying
// POST alike; web-style single-arg invocation (edge/tests/dev-middleware) must keep working (it is
// exercised by every `call()` above).
function mockNodeRes() {
  const out = { statusCode: 0, headers: {}, body: null, ended: false };
  return {
    out,
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
    end(buf) { out.body = buf != null ? String(buf) : ''; out.ended = true; },
    set statusCode(v) { out.statusCode = v; },
    get statusCode() { return out.statusCode; },
  };
}
{
  // GET through the NODE-STYLE path -> instant 405 written to res (this exact call hung 60s in prod).
  const res = mockNodeRes();
  await handler({ method: 'GET', headers: { host: 'x' }, url: '/api/burma-tk' }, res);
  ok('node adapter: GET ends res with 405 (never hangs)', res.out.ended && res.out.statusCode === 405);
  ok('node adapter: 405 body is our JSON, not a platform page', /POST only/.test(res.out.body || ''));

  // POST with Vercel's pre-parsed req.body object -> flows through validation to the marker guard.
  const res2 = mockNodeRes();
  await handler({ method: 'POST', headers: { host: 'x', 'content-type': 'application/json' }, url: '/api/burma-tk', body: { mode: 'fc' } }, res2);
  ok('node adapter: pre-parsed JSON body reaches validation (400 marker required)',
    res2.out.ended && res2.out.statusCode === 400 && /marker required/.test(res2.out.body || ''));

  // POST with a raw stream body (no pre-parse) -> adapter reads the stream.
  const { Readable } = await import('node:stream');
  const stream = Readable.from([Buffer.from(JSON.stringify({ mode: 'fc', marker: 'x' }))]);
  stream.method = 'POST';
  stream.headers = { host: 'x', 'content-type': 'application/json' };
  stream.url = '/api/burma-tk';
  const res3 = mockNodeRes();
  await handler(stream, res3);
  // no ANTHROPIC_API_KEY in the test env -> the valid body runs all the way to the key guard (500).
  ok('node adapter: raw stream body read end-to-end (hits the api-key guard, not a hang)',
    res3.out.ended && res3.out.statusCode === 500 && /ANTHROPIC_API_KEY/.test(res3.out.body || ''));
}

// ── mode:'quote' — the footnote RECHECK (commit c0c1e26). A brand-new THIRD web_search mode,
// live in Johnny's script editor and previously UNLOCKED: it hunts the VERBATIM supporting
// quotation for an already-checked fact and lands it in the on-script receipt. The fc/tk locks
// above never touched it. Pin the three things a regression could silently break.
{
  const q = buildPayload('quote', { marker: 'M', block: 'B', context: 'C' });
  ok('payload quote: emit_quotes tool present (the receipt tool)', (q.tools || []).some((t) => t.name === 'emit_quotes'));
  ok('payload quote: web_search present + capped at 3 (it searches like fc)', (q.tools || []).some((t) => t.name === 'web_search' && t.max_uses === 3));
  ok('payload quote: tool_choice auto (must search before it can quote)', q.tool_choice && q.tool_choice.type === 'auto');
  ok('payload quote: NOT the fc verdict tool', !(q.tools || []).some((t) => t.name === 'emit_verdict'));
  ok('payload quote: NOT the tk options tool', !(q.tools || []).some((t) => t.name === 'emit_options'));
  ok('payload quote: uses quotePrompt + demands a VERBATIM quote',
    String(q.messages[0].content) === quotePrompt({ marker: 'M', block: 'B', context: 'C' }) && /VERBATIM/.test(String(q.messages[0].content)));
  ok('payload quote: prompt DISTINCT from fc + tk (never falls through to their wording)',
    String(q.messages[0].content) !== fcPrompt({ marker: 'M', block: 'B', context: 'C' }) &&
    String(q.messages[0].content) !== tkPrompt({ marker: 'M', block: 'B', context: 'C' }));
}

// (end-to-end) a mode:'quote' POST returns the RECEIPT shape. Mutation proof of the routing
// (body.mode === 'quote') AND the emit_quotes tool-name pull: if quote collapsed back to tk,
// buildPayload would force emit_options, the handler would hunt the wrong tool_use name, find
// none -> 502 — never {mode:'quote', quotes:[…]}. And a quote timeout must carry the web-search
// wording (isFc includes quote), not the generation-only "writing helper" line.
{
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.BURMA_TK_TIMEOUT_MS = '5000';
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'myanmar fuel crisis' } },
        { type: 'tool_use', name: 'emit_quotes', input: { verdict: 'true', finding: 'The fuel shortage is documented.', quotes: [{ quote: 'Fuel queues stretched for blocks in Yangon.', source: 'Reuters, 2024-03-02', url: 'https://reuters.example/x' }] } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const r = await call({ body: { mode: 'quote', marker: 'fuel shortage in yangon' } });
    ok('quote: success flows through -> 200', r.status === 200);
    ok('quote: response carries mode:quote + the verbatim quotes (not collapsed to tk/fc)',
      r.body && r.body.mode === 'quote' && Array.isArray(r.body.quotes) && r.body.quotes[0].quote.includes('Yangon') && r.body.verdict === 'true');

    process.env.BURMA_TK_TIMEOUT_MS = '60';
    globalThis.fetch = () => new Promise(() => {}); // hang -> deadline wins
    const rt = await call({ body: { mode: 'quote', marker: 'slow claim' } });
    ok('quote: timeout -> 504 with the web-search wording (isFc must include quote)',
      rt.status === 504 && rt.body && rt.body.timeout === true && /verify in \d+s/.test(rt.body.error) && !/writing helper/.test(rt.body.error));
  } finally {
    delete process.env.BURMA_TK_TIMEOUT_MS;
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = realFetch;
  }
}

console.log(`burma-tk: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
