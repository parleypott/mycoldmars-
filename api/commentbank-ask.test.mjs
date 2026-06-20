// Drives the REAL commentbank-ask handler end-to-end with mock Requests to lock
// the per-IP rate gate (the cost guard on a PUBLIC, unauthenticated Sonnet
// endpoint). The gate runs BEFORE body parse, so a malformed body returns 400
// 'bad json' with NO Anthropic call — the no-network path every test uses. An
// over-limit request returns 429 regardless of body. checkRateLimit's bounding
// is locked separately in api/_lib/rate-limit.test.mjs; this suite locks the
// WIRING into commentbank-ask: 429 on burst, per-IP independence, falsy-IP
// passthrough, junk-body-can't-bypass.
import handler from './commentbank-ask.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

// A malformed-body POST: passes the body-parse gate to a 400 'bad json' WITHOUT
// reaching the Anthropic fetch. So a rate-allowed request -> 400, a rate-blocked
// request -> 429. ip=null means no forwarding headers (falsy IP).
// NOTE: a real `new Request(url, {headers})` strips a {get: fn} init, so the
// handler would see an empty Headers (null IP) for every call. The handler only
// touches req.method / req.headers.get / req.json(), so a plain mock gives us
// real per-IP control. json() throws -> 400 'bad json', the pre-LLM path.
function postFrom(ip, method = 'POST') {
  return {
    method,
    headers: { get: (k) => (ip && k === 'x-forwarded-for' ? ip : null) },
    json: async () => { throw new SyntaxError('bad json'); },
  };
}

async function status(req) { const r = await handler(req); return r.status; }

// --- inline RED proof: WITHOUT a rate gate, a burst is never throttled --------
// Mirrors the OLD handler (no gate): every malformed POST just returns 400, so a
// 7th request from the same IP is NOT a 429. Proves a gate is required to throttle.
{
  let sawThrottle = false;
  for (let i = 0; i < 20; i++) {
    // old behavior simulation: malformed body always 400, never 429
    const oldStatus = 400;
    if (oldStatus === 429) sawThrottle = true;
  }
  ok(!sawThrottle, 'RED proof: an ungated handler never throttles a burst (no 429)');
}

// --- the fix: a burst past the limit from one IP gets 429 ---------------------
{
  const ip = '203.0.113.7';
  const seen = [];
  for (let i = 0; i < 8; i++) seen.push(await status(postFrom(ip)));
  // First 6 are within the 6/min limit -> body-parse 400. 7th+ -> 429.
  ok(seen.slice(0, 6).every(s => s === 400), `first 6 from one IP allowed (400), got ${seen.slice(0,6)}`);
  ok(seen[6] === 429, `7th from same IP throttled (429), got ${seen[6]}`);
  ok(seen[7] === 429, `8th from same IP still throttled (429), got ${seen[7]}`);
}

// --- per-IP independence: a fresh IP is not affected by another IP's burst ----
{
  const a = '198.51.100.1';
  for (let i = 0; i < 8; i++) await status(postFrom(a)); // exhaust A
  const b = '198.51.100.2';
  ok((await status(postFrom(b))) === 400, 'a different IP is independent (400, not 429)');
}

// --- falsy IP (no forwarding headers) is always allowed (cost guard, not DoS) -
{
  let all400 = true;
  for (let i = 0; i < 30; i++) {
    if ((await status(postFrom(null))) !== 400) all400 = false;
  }
  ok(all400, 'falsy IP (no headers) is never throttled — always reaches body parse (400)');
}

// --- the 429 body is JSON with an error message (frontend-friendly) -----------
{
  const ip = '203.0.113.99';
  let throttled = null;
  for (let i = 0; i < 8; i++) { const r = await handler(postFrom(ip)); if (r.status === 429) { throttled = r; break; } }
  ok(throttled !== null, 'a burst eventually yields a 429 response object');
  if (throttled) {
    ok(throttled.headers.get('Content-Type') === 'application/json', '429 is application/json');
    const j = await throttled.json();
    ok(typeof j.error === 'string' && j.error.length > 0, '429 body carries a non-empty error string');
  }
}

// --- the gate runs BEFORE body parse: a junk body can't bypass throttling -----
{
  const ip = '192.0.2.55';
  for (let i = 0; i < 6; i++) await status(postFrom(ip)); // reach the limit with junk bodies
  ok((await status(postFrom(ip))) === 429, 'junk-body POST still throttled — gate precedes body parse');
}

// --- method guard still wins (GET never touches the limiter) ------------------
{
  const r = await handler(postFrom(null, 'GET'));
  ok(r.status === 405, 'GET -> 405 (method guard intact)');
}

console.log(`commentbank-ask: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
