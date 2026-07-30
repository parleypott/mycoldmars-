// Guard-rail lock for api/citations-search.js — the citations-RAG fact-check
// retrieval endpoint. These assertions cover the paths that must NOT reach the
// paid Jina embed / Supabase RPC: method, access gate, body validation, and the
// missing-config 500. The live retrieval path (real Jina embed → pgvector RPC)
// is verified end-to-end out of band (it needs the real corpus + keys), not here.
//
// Run: bun api/citations-search.test.mjs   (auto-discovered by `bun run test`)

import handler from './citations-search.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

function mkReq({ method = 'POST', headers = {}, jsonThrows = false, jsonValue = {} } = {}) {
  return {
    method,
    headers: new Headers(headers),
    async json() { if (jsonThrows) throw new Error('bad json'); return jsonValue; },
  };
}

// env snapshot / helpers — bun auto-loads .env, so mutate explicitly per test.
const snap = { ...process.env };
function resetEnv() {
  for (const k of ['ACCESS_CODE', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RAG_SUPABASE_URL', 'RAG_SUPABASE_SERVICE_KEY']) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// 1. Non-POST → 405 (before any gate/spend).
{
  resetEnv();
  const res = await handler(mkReq({ method: 'GET' }));
  ok(res.status === 405, `GET → 405 (got ${res.status})`);
}

// 2. Access gate: ACCESS_CODE set + no credentials → 401 (before embed/RPC).
{
  resetEnv();
  process.env.ACCESS_CODE = 'secret-code';
  const res = await handler(mkReq({ method: 'POST', jsonValue: { query: 'x' } }));
  ok(res.status === 401, `gated, no code → 401 (got ${res.status})`);
}

// 3. Access gate: correct x-access-code passes the gate (then 400 on missing query,
//    proving we got PAST the gate without a valid query — and without embedding).
{
  resetEnv();
  process.env.ACCESS_CODE = 'secret-code';
  const res = await handler(mkReq({ headers: { 'x-access-code': 'secret-code' }, jsonValue: {} }));
  ok(res.status === 400, `valid code, no query → 400 (got ${res.status})`);
  const body = await res.json();
  ok(/query is required/.test(body.error || ''), 'missing query → "query is required"');
}

// 4. Malformed body → 400 (dev-mode gate open).
{
  resetEnv();
  const res = await handler(mkReq({ jsonThrows: true }));
  ok(res.status === 400, `bad json → 400 (got ${res.status})`);
}

// 5. Non-object body (array) → 400.
{
  resetEnv();
  const res = await handler(mkReq({ jsonValue: [1, 2, 3] }));
  ok(res.status === 400, `array body → 400 (got ${res.status})`);
}

// 6. Missing query → 400 (dev-mode gate open).
{
  resetEnv();
  const res = await handler(mkReq({ jsonValue: { notquery: 'hi' } }));
  ok(res.status === 400, `no query field → 400 (got ${res.status})`);
}

// 7. Supabase not configured → 500 BEFORE the Jina embed (config check precedes embed).
//    If this ever 502s instead, the embed ran first — a real regression (paid call
//    on an unconfigured server).
{
  resetEnv(); // clears SUPABASE_* — config missing
  const res = await handler(mkReq({ jsonValue: { query: 'anything' } }));
  ok(res.status === 500, `no supabase config → 500 (got ${res.status})`);
  const body = await res.json();
  ok(/Supabase is not configured/.test(body.error || ''), 'config error message present');
}

// 8. 'claim' is accepted as an alias for 'query' (still 500 here for missing config,
//    proving it passed the query-presence check via the alias, not a 400).
{
  resetEnv();
  const res = await handler(mkReq({ jsonValue: { claim: 'Ngo Dinh Diem' } }));
  ok(res.status === 500, `claim alias accepted (→500 config, not 400) (got ${res.status})`);
}

// 9. Supabase configured but JINA_API_KEY missing → 501 retrieval_not_configured,
//    NOT 502. Regression lock for a production incident (2026-07-30): the missing key
//    fell through to embedQuery(), threw, and was caught as a 502 — so a Verify All
//    batch emitted one 502 per claim. 502 says "upstream failed, retry may work"; an
//    unset env var can never succeed until a human sets it. The distinct 501 is what
//    lets corpus-retrieval.js latch off after a single hit instead of asking N times.
{
  resetEnv();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-not-real';
  const jinaSnap = process.env.JINA_API_KEY;
  delete process.env.JINA_API_KEY;

  const res = await handler(mkReq({ jsonValue: { query: 'Burma was annexed in 1826.' } }));
  ok(res.status === 501, `no JINA key → 501, not 502 (got ${res.status})`);
  const body = await res.json();
  ok(body.error === 'retrieval_not_configured', `error is the latchable sentinel (got ${body.error})`);
  ok(/JINA_API_KEY/.test(body.message || ''), 'message names the missing var so it is actionable');

  if (jinaSnap !== undefined) process.env.JINA_API_KEY = jinaSnap;
}


// 10. CORPUS/APP DATABASE SPLIT (2026-07-30: production's SUPABASE_URL pointed at the
//     legacy app DB while the corpus lived elsewhere -> PGRST202 on every retrieval).
//     RAG_SUPABASE_* must WIN so retrieval can be aimed at the corpus independently.
{
  resetEnv();
  process.env.SUPABASE_URL = 'https://app-db.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'app-key';
  process.env.RAG_SUPABASE_URL = 'https://corpus-db.supabase.co';
  process.env.RAG_SUPABASE_SERVICE_KEY = 'corpus-key';
  process.env.JINA_API_KEY = 'jina-test-key';

  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init) => {
    seen.push(String(u));
    if (String(u).includes('jina.ai')) {
      return { ok: true, status: 200, json: async () => ({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.01) }] }) };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
  };
  try {
    await handler(mkReq({ jsonValue: { query: 'a claim' } }));
    const rpc = seen.find((u) => u.includes('/rpc/search_rag_chunks')) || '';
    ok(rpc.includes('corpus-db'), `RPC goes to the CORPUS project (got ${rpc || 'no rpc call'})`);
    ok(!rpc.includes('app-db'), 'RPC does NOT go to the app project');
  } finally { globalThis.fetch = realFetch; }
}
{
  // Fallback intact: with no RAG_* set, the app pair is still used (today's behaviour).
  resetEnv();
  process.env.SUPABASE_URL = 'https://app-db.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'app-key';
  process.env.JINA_API_KEY = 'jina-test-key';
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => {
    seen.push(String(u));
    if (String(u).includes('jina.ai')) return { ok: true, status: 200, json: async () => ({ data: [{ embedding: Array.from({ length: 1024 }, () => 0.01) }] }) };
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
  };
  try {
    await handler(mkReq({ jsonValue: { query: 'a claim' } }));
    ok((seen.find((u) => u.includes('/rpc/')) || '').includes('app-db'), 'no RAG_* set -> falls back to the app project');
  } finally { globalThis.fetch = realFetch; }
}

// restore env
process.env = snap;

console.log(`citations-search: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
