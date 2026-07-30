// Fact-check retrieval for the script tools.
//
// Embeds a claim with Jina v3 (retrieval.query) and runs a cosine kNN over the
// newpress citations RAG (rag.chunks — 179,782 chunks across 167 videos, from
// ~7,000 sources) via the public.search_rag_chunks pgvector RPC. Returns
// provenance-carrying matches (video, source URL, book, quoted span, similarity)
// so a script author can see the actual sources behind a claim.
//
// Gated (checkAccess) + per-IP rate limited: the corpus is internal /
// copyrighted and every accepted call spends a Jina query embedding, so this is
// never a public, ungated cost hole. Mirrors the Hunter semantic-search pattern
// in api/gemini.js (PostgREST RPC + service key) — this is the citations analog.
//
// POST body: { query | claim: string, limit?: 1..50=12, video?: string,
//              citedOnly?: bool, minSimilarity?: 0..1 }
// 200 → { matches: [...], total, query }

import { checkAccess } from './_lib/access.js';
import { readJsonBody } from './_lib/read-json-body.js';
import { checkRateLimit } from './_lib/rate-limit.js';
import { embedQuery } from './_lib/jina-embed.js';

export const config = { runtime: 'edge' };

// Per-IP cost guard. Each accepted POST spends one Jina query embedding; the
// access gate is the auth boundary, this bounds spend per caller. Shared bounded
// limiter (the backing Map can't grow without bound). 30 calls / 60s / IP.
const _bucket = new Map();
const RATE_LIMIT_PER_MIN = 30;
const RATE_WINDOW_MS = 60_000;

function extractIp(req) {
  try {
    const h = req.headers;
    const v = (typeof h?.get === 'function')
      ? (h.get('x-forwarded-for') || h.get('x-real-ip') || '')
      : (h?.['x-forwarded-for'] || h?.['x-real-ip'] || '');
    return (v || '').split(',')[0].trim() || null;
  } catch { return null; }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Access gate (shared x-access-code secret OR a verified Supabase JWT).
  const gate = await checkAccess(req);
  if (gate) return gate;

  // Cost guard AFTER auth, BEFORE the embedding spend.
  if (!checkRateLimit(_bucket, extractIp(req), Date.now(), { limit: RATE_LIMIT_PER_MIN, windowMs: RATE_WINDOW_MS })) {
    return json({ error: 'Too many requests. Wait a minute.' }, 429);
  }

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const body = parsed.body;

  const query = typeof body.query === 'string' ? body.query.trim()
    : typeof body.claim === 'string' ? body.claim.trim() : '';
  if (!query) return json({ error: 'query is required' }, 400);

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: 'Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)' }, 500);
  }

  // FEATURE GATE — sits with the other config checks, before the paid embed (same
  // principle test 7 locks for Supabase: never spend on an unconfigured server).
  //
  // This used to fall through to embedQuery(), which throws 'JINA_API_KEY is not set'
  // and was caught below as a 502. Wrong twice over: 502 means an UPSTREAM call failed
  // and retrying might work, but a missing env var can NEVER succeed until someone sets
  // it — so a Verify All batch fired one doomed request per claim and filled the console
  // with 502s (observed in production 2026-07-30). 501 + <feature>_not_configured is the
  // repo idiom (asana-progress, prawn), and is distinguishable enough that the client
  // latches off after a single hit instead of asking N times.
  if (!process.env.JINA_API_KEY) {
    return json({ error: 'retrieval_not_configured', message: 'JINA_API_KEY is not set on the server.' }, 501);
  }

  const limit = Math.max(1, Math.min(Number(body.limit) || 12, 50));
  const filterVideo = (typeof body.video === 'string' && body.video.trim()) ? body.video.trim() : null;
  const citedOnly = body.citedOnly === true;
  const msRaw = Number(body.minSimilarity); // coerce first (accept "0.5"), then finiteness-gate
  const minSimilarity = Number.isFinite(msRaw) ? Math.max(0, Math.min(msRaw, 1)) : 0;

  // 1. Embed the claim with Jina v3 (query side) — SAME model the corpus used.
  let queryEmbedding;
  try {
    queryEmbedding = await embedQuery(query);
  } catch (e) {
    return json({ error: `embedding failed: ${String(e?.message || e).slice(0, 160)}` }, 502);
  }

  // 2. Cosine kNN over rag.chunks via the pgvector RPC (service key bypasses RLS).
  let rows;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/search_rag_chunks`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query_embedding: `[${queryEmbedding.join(',')}]`,
        match_count: limit,
        match_threshold: minSimilarity,
        filter_video: filterVideo,
        cited_only: citedOnly,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return json({ error: `search failed: supabase ${res.status}: ${t.slice(0, 200)}` }, 502);
    }
    rows = await res.json();
  } catch (e) {
    return json({ error: `search failed: ${String(e?.message || e).slice(0, 160)}` }, 502);
  }
  if (!Array.isArray(rows)) return json({ error: 'search returned unexpected shape' }, 502);

  // 3. Shape provenance-carrying matches. metadata is the citations[] array
  //    (each: { video, doc_id, quoted_span, context }); surface the first span.
  const matches = rows.map((r) => {
    const cite = Array.isArray(r.metadata) ? r.metadata[0] : null;
    return {
      chunkId: r.chunk_id,
      similarity: typeof r.similarity === 'number' ? Number(r.similarity.toFixed(4)) : r.similarity,
      video: r.video,
      sourceUrl: r.source_url,
      bookTitle: r.book_title,
      accessMethod: r.access_method,
      cited: r.cited,
      nCitations: r.n_citations,
      quotedSpan: cite?.quoted_span ?? null, // first cited span (convenience)
      context: cite?.context ?? null,
      citations: Array.isArray(r.metadata)   // ALL cited spans for this chunk (n_citations may be >1)
        ? r.metadata.map((c) => ({ video: c?.video ?? null, quotedSpan: c?.quoted_span ?? null, context: c?.context ?? null }))
        : [],
      text: typeof r.text === 'string' ? r.text.slice(0, 1200) : r.text,
    };
  });

  return json({ matches, total: matches.length, query });
}
