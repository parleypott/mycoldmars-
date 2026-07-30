// Lock for api/_lib/jina-embed.js — the query-side embedder for the newpress
// citations RAG. embedQuery's RESPONSE-SHAPE VALIDATION is the single
// load-bearing invariant standing between "Jina returns garbage" and two real
// failure modes downstream in api/citations-search.js:
//   1. INJECTION-PROOFING — the endpoint builds a pgvector literal with
//      `[${queryEmbedding.join(',')}]`; the `emb.every(Number.isFinite)` +
//      `emb.length !== DIM` guard is what guarantees every element is a finite
//      number, so a non-numeric can never land inside that SQL literal.
//   2. NOISE-RANKING — a silently-returned short/garbage vector would rank the
//      WHOLE corpus against noise (worse than a visible 502). The guard forces
//      a THROW, which the endpoint turns into a clean 502.
// These paths need no network — they hinge on validating a stubbed response —
// so they belong in the suite (the endpoint test deliberately stops at the
// pre-spend guards and leaves the live embed "out of band").
//
// Run: bun api/_lib/jina-embed.test.mjs   (auto-discovered by `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { embedQuery, JINA_QUERY_DIM } from './jina-embed.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
async function threw(fn) { try { await fn(); return false; } catch { return true; } }

const DIM = JINA_QUERY_DIM; // 1024
const finiteVec = (n = DIM) => Array.from({ length: n }, (_, i) => (i % 7) * 0.013 - 0.041);

// Response-like stub matching what embedQuery reads: status, ok, json(), text().
function mkRes(status, jsonBody, textBody) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return jsonBody; },
    async text() { return textBody ?? JSON.stringify(jsonBody ?? ''); },
  };
}

const realFetch = globalThis.fetch;
// Every test installs its own stub; nothing here ever reaches the real Jina API.
function stubFetch(fn) { globalThis.fetch = fn; }

try {
  // 1. Happy path: a valid 1024-finite-float embedding is returned verbatim.
  {
    const emb = finiteVec();
    stubFetch(async () => mkRes(200, { data: [{ embedding: emb }] }));
    const out = await embedQuery('a claim to check', { apiKey: 'k' });
    ok(Array.isArray(out) && out.length === DIM, `happy: returns ${DIM}-vec (len ${out?.length})`);
    ok(out.every(Number.isFinite), 'happy: every element finite');
    ok(out[5] === emb[5] && out[1023] === emb[1023], 'happy: values passed through unchanged');
  }

  // 2. WRONG LENGTH → throws (the DIM guard). A 512-dim vector can't cosine
  //    against 1024-dim stored vectors; returning it would rank against noise.
  {
    stubFetch(async () => mkRes(200, { data: [{ embedding: finiteVec(512) }] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'wrong length (512) → throws');
  }

  // 3. NON-FINITE element → throws (the Number.isFinite guard). THE load-bearing
  //    case: a NaN/Infinity in the array is exactly what would poison the
  //    pgvector literal / silently rank against garbage. Remove the guard in
  //    jina-embed.js and THIS goes RED (the bad vector is returned, not thrown).
  {
    const bad = finiteVec(); bad[42] = NaN;
    stubFetch(async () => mkRes(200, { data: [{ embedding: bad }] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'NaN element → throws');

    const bad2 = finiteVec(); bad2[7] = Infinity;
    stubFetch(async () => mkRes(200, { data: [{ embedding: bad2 }] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'Infinity element → throws');
  }

  // 4. MISSING / NON-ARRAY embedding → throws (no silent empty vector).
  {
    stubFetch(async () => mkRes(200, { data: [{}] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'no embedding field → throws');
    stubFetch(async () => mkRes(200, { data: [] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'empty data array → throws');
    stubFetch(async () => mkRes(200, { data: [{ embedding: 'not-an-array' }] }));
    ok(await threw(() => embedQuery('x', { apiKey: 'k' })), 'non-array embedding → throws');
  }

  // 5. Empty / whitespace input → throws BEFORE any fetch (no wasted spend).
  {
    let called = 0;
    stubFetch(async () => { called++; return mkRes(200, { data: [{ embedding: finiteVec() }] }); });
    ok(await threw(() => embedQuery('   ', { apiKey: 'k' })), 'whitespace text → throws');
    ok(await threw(() => embedQuery('', { apiKey: 'k' })), 'empty text → throws');
    ok(await threw(() => embedQuery(null, { apiKey: 'k' })), 'null text → throws');
    ok(called === 0, 'empty text never reached fetch (no spend)');
  }

  // 6. Missing API key → throws BEFORE any fetch.
  {
    let called = 0;
    stubFetch(async () => { called++; return mkRes(200, {}); });
    ok(await threw(() => embedQuery('hi', { apiKey: '' })), 'no api key → throws');
    ok(called === 0, 'no api key never reached fetch');
  }

  // 7. Terminal 4xx (bad key / bad request) → throws, and does NOT burn all
  //    attempts (a 4xx won't fix on retry — it breaks after ONE call).
  {
    let called = 0;
    stubFetch(async () => { called++; return mkRes(400, { detail: 'bad request' }, 'bad request'); });
    ok(await threw(() => embedQuery('hi', { apiKey: 'k', attempts: 3 })), 'terminal 400 → throws');
    ok(called === 1, `terminal 4xx breaks after ONE attempt (got ${called})`);
  }

  // 8. Transient 429 → retries and can succeed on a later attempt.
  {
    let called = 0;
    stubFetch(async () => {
      called++;
      return called === 1 ? mkRes(429, { detail: 'rate limited' }) : mkRes(200, { data: [{ embedding: finiteVec() }] });
    });
    const out = await embedQuery('hi', { apiKey: 'k', attempts: 3 });
    ok(Array.isArray(out) && out.length === DIM, '429 then 200: retried to success');
    ok(called === 2, `429 retried exactly once before success (got ${called})`);
  }

  // 9. SOURCE-LOCK: pin the two guards in place so a refactor that weakens either
  //    (e.g. drops Number.isFinite, or loosens length !== DIM) is caught here even
  //    if a behavioral assertion above is later edited. Behavioral tests 2/3 are
  //    the mutation proof; this makes the intent non-removable.
  {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'jina-embed.js'), 'utf8');
    ok(/emb\.every\(Number\.isFinite\)/.test(src), 'source keeps the every(Number.isFinite) guard');
    ok(/emb\.length\s*!==\s*DIM/.test(src), 'source keeps the length !== DIM guard');
  }
} finally {
  globalThis.fetch = realFetch;
}

if (fail) { console.error(`jina-embed: ${pass} passed, ${fail} FAILED`); for (const f of fails) console.error('  ✗', f); process.exit(1); }
console.log(`jina-embed: ${pass} passed, 0 failed`);
