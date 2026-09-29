// Guard-rail + logic lock for api/citations-source.js (the /sources viewer's backend).
// Covers: method, access gate, id validation, config, upstream 502, 404, overlap
// stripping, the whole-source re-call, and citation dedupe. The RPC is stubbed via
// globalThis.fetch; the live path is checked out of band against the real corpus.
//
// Run: bun api/citations-source.test.mjs   (auto-discovered by `bun run test`)

import handler, { stripOverlap, titleFor } from './citations-source.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

const ID = 'abcdef0123456789';
function mkReq({ method = 'GET', headers = {}, qs = `chunk=${ID}` } = {}) {
  return { method, headers: new Headers(headers), url: `http://localhost/api/citations-source?${qs}` };
}

function resetEnv() {
  for (const k of ['ACCESS_CODE', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RAG_SUPABASE_URL', 'RAG_SUPABASE_SERVICE_KEY']) delete process.env[k];
}
function configure() {
  process.env.RAG_SUPABASE_URL = 'https://example.supabase.co';
  process.env.RAG_SUPABASE_SERVICE_KEY = 'service-key-not-real';
}
const realFetch = globalThis.fetch;
function stubRpc(handlerFn) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    return handlerFn(body, calls.length);
  };
  return calls;
}
const rpcJson = (rows, status = 200) => new Response(JSON.stringify(rows), { status });

// A source made of overlapping chunks, the way the chunker leaves them.
const SRC = Array.from({ length: 30 }, (_, i) => `Sentence ${i} says the quick brown fox number ${i * 7} jumps over the lazy dog.`).join(' ');
function mkChunks(n) {
  const size = 300, ov = 200, out = [];
  let i = 0;
  while (out.length < n) { out.push(SRC.slice(i, i + size).trim()); i += size - ov; }
  return out;
}
function row(i, text, extra = {}) {
  return { chunk_id: (i.toString(16).padStart(16, '0')), seq: i, text, source_url: 'https://www.bbc.com/news/world-asia-12345-the-story',
    access_method: 'wayback', video: 'Burma', book_title: null, metadata: [], is_focus: false, total: 3, ...extra };
}

// 1. Non-GET → 405.
{ resetEnv(); const res = await handler(mkReq({ method: 'POST' })); ok(res.status === 405, `POST → 405 (${res.status})`); }

// 2. Gate: ACCESS_CODE set, no credentials → 401, before any RPC.
{
  resetEnv(); process.env.ACCESS_CODE = 'secret-code'; configure();
  const calls = stubRpc(() => rpcJson([]));
  const res = await handler(mkReq());
  ok(res.status === 401, `gated, no code → 401 (${res.status})`);
  ok(calls.length === 0, 'no RPC on a 401');
  const res2 = await handler(mkReq({ headers: { 'x-access-code': 'secret-code' }, qs: 'chunk=nope' }));
  ok(res2.status === 400, `valid code passes the gate (→400 bad id) (${res2.status})`);
}

// 3. Bad ids → 400 (before config / RPC).
for (const qs of ['', 'chunk=', 'chunk=xyz', 'chunk=ABCDEF0123456789', 'chunk=abcdef012345678', 'chunk=abcdef01234567890', `chunk=${ID};drop`]) {
  resetEnv(); const calls = stubRpc(() => rpcJson([]));
  const res = await handler(mkReq({ qs }));
  ok(res.status === 400, `bad id "${qs}" → 400 (${res.status})`);
  ok(calls.length === 0, `no RPC for bad id "${qs}"`);
}

// 4. Unconfigured → 500.
{ resetEnv(); const res = await handler(mkReq()); ok(res.status === 500, `no config → 500 (${res.status})`); }

// 5. Upstream failure → 502; not-an-array → 502; empty → 404.
{
  resetEnv(); configure();
  stubRpc(() => new Response('boom', { status: 500 }));
  ok((await handler(mkReq())).status === 502, 'supabase 500 → 502');
  stubRpc(() => rpcJson({ message: 'nope' }));
  ok((await handler(mkReq())).status === 502, 'non-array → 502');
  globalThis.fetch = async () => { throw new Error('network down'); };
  ok((await handler(mkReq())).status === 502, 'fetch throws → 502');
  stubRpc(() => rpcJson([]));
  ok((await handler(mkReq())).status === 404, 'zero rows → 404');
}

// 6. Overlap stripping + response shape; credentials go in headers only.
{
  resetEnv(); configure();
  const t = mkChunks(3);
  const rows = [row(4, t[0]), row(5, t[1], { is_focus: true, total: 900 }), row(6, t[2])];
  const calls = stubRpc(() => rpcJson(rows));
  const res = await handler(mkReq({ qs: `chunk=${rows[1].chunk_id}&before=1&after=1` }));
  ok(res.status === 200, `ok → 200 (${res.status})`);
  const b = await res.json();
  ok(calls.length === 1 && calls[0].body.p_before === 1 && calls[0].body.p_after === 1, 'before/after forwarded');
  ok(!JSON.stringify(calls[0].body).includes('service-key'), 'key never in the body');
  ok(b.chunks.length === 3 && b.focus === rows[1].chunk_id && b.total === 900, 'shape: chunks/focus/total');
  ok(b.chunks[0].display_text === t[0], 'first chunk shown whole');
  ok(b.chunks[1].text === t[1] && b.chunks[1].display_text !== t[1], 'overlap removed from later chunk');
  const joined = b.chunks.map((c) => c.display_text).join('');
  ok(joined === SRC.slice(0, 500).trim() || joined === SRC.slice(0, 500), 'stitched text is continuous');
  ok(b.chunks[1].continues === true && b.chunks[0].continues === false, 'continues flag');
  ok(b.chunks[1].is_focus === true && b.chunks[0].is_focus === false, 'is_focus carried');
  ok(b.first_seq === 4 && b.last_seq === 6, 'first_seq / last_seq');
  ok(b.source.access_method === 'wayback' && b.source.video === 'Burma' && /bbc\.com/.test(b.source.title), 'source block + readable title');
}

// 7. stripOverlap is verified, never guessed.
{
  const a = 'x'.repeat(300) + ' the tail that repeats into the next chunk of this very long source text';
  const n = 'the tail that repeats into the next chunk of this very long source text and then new words follow';
  ok(stripOverlap(a, n) === ' and then new words follow', 'strips the exact repeated lead-in');
  const unrelated = 'completely different opening sentence that shares nothing with the previous chunk at all';
  ok(stripOverlap(a, unrelated) === unrelated, 'no overlap → text untouched');
  const near = 'the tail that repeats into the next chunk of this very long source TEXT differs here';
  ok(stripOverlap(a, near) === near, 'non-exact overlap → untouched (no lost text)');
  ok(stripOverlap(a, 'short') === 'short', 'short text untouched');
}

// 8. Whole-source re-call when total <= 40 and the window did not cover it.
{
  resetEnv(); configure();
  const t = mkChunks(5);
  const all = t.map((x, i) => row(i, x, { total: 5, is_focus: i === 2 }));
  const calls = stubRpc((body) => rpcJson(body.p_before >= 60 ? all : all.slice(1, 4)));
  const res = await handler(mkReq({ qs: `chunk=${all[2].chunk_id}` }));
  const b = await res.json();
  ok(calls.length === 2 && calls[1].body.p_before === 60 && calls[1].body.p_after === 60, `second wide call made (${calls.length})`);
  ok(b.chunks.length === 5 && b.total === 5 && b.has_before === false, 'whole source returned');
}

// 8b. Big source → no re-call, window only, has_before heuristic.
{
  resetEnv(); configure();
  const t = mkChunks(3);
  const rows = [row(10, t[0], { total: 2000 }), row(11, t[1], { total: 2000, is_focus: true }), row(12, t[2], { total: 2000 })];
  const calls = stubRpc(() => rpcJson(rows));
  const b = await (await handler(mkReq({ qs: `chunk=${rows[1].chunk_id}` }))).json();
  ok(calls.length === 1, 'big source not re-called');
  ok(b.has_before === true, 'has_before for a mid-source window');
}

// 8c. Focus with unknown position (seq null) → only itself, never re-called.
{
  resetEnv(); configure();
  const rows = [row(1, 'Lone chunk text that has no known neighbours in the reading order.', { seq: null, is_focus: true, total: 3 })];
  const calls = stubRpc(() => rpcJson(rows));
  const b = await (await handler(mkReq({ qs: `chunk=${rows[0].chunk_id}` }))).json();
  ok(calls.length === 1 && b.chunks.length === 1 && b.first_seq === null, 'null-seq focus returned alone, no re-call');
}

// 9. Citation dedupe (across chunks, focus first).
{
  resetEnv(); configure();
  const t = mkChunks(3);
  const c1 = { type: 'quote', video: 'Burma', author: 'A', doc_id: 'doc1', context: 'ctx one', quoted_span: 'the quick  brown fox' };
  const c1dup = { ...c1, quoted_span: 'the quick brown fox' }; // whitespace-only difference
  const c2 = { type: 'quote', video: 'Iran', author: 'B', doc_id: 'doc2', context: 'ctx two', quoted_span: 'lazy dog' };
  const rows = [row(1, t[0], { metadata: [c1dup, c2] }), row(2, t[1], { is_focus: true, metadata: [c1, null, 'junk'] }), row(3, t[2], { metadata: null })];
  stubRpc(() => rpcJson(rows));
  const b = await (await handler(mkReq({ qs: `chunk=${rows[1].chunk_id}` }))).json();
  ok(b.citations.length === 2, `2 distinct citations (${b.citations.length})`);
  ok(b.citations[0].chunk_id === rows[1].chunk_id && b.citations[0].doc_id === 'doc1', 'focus chunk citation first');
  ok(b.citations.some((c) => c.video === 'Iran' && c.doc_id === 'doc2'), 'other video kept');
}

// 10. titleFor.
{
  ok(titleFor({ book_title: '  My Book ' }) === 'My Book', 'book_title wins');
  ok(titleFor({ source_url: 'https://www.bbc.com/news/burma-coup-explained.html' }) === 'burma coup explained (bbc.com)', 'url → readable');
  ok(titleFor({ source_url: 'https://example.org/' }) === 'example.org', 'bare host');
  ok(titleFor({}) === 'Untitled source', 'fallback');
}

globalThis.fetch = realFetch;
console.log(`citations-source: ${pass} passed, ${fail} failed`);
for (const f of fails) console.log(`  ✗ ${f}`);
process.exit(fail ? 1 : 0);
