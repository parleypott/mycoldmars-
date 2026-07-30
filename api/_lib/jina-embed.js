// Query-side embedder for the newpress citations RAG (rag.chunks).
//
// THE ONE HARD INVARIANT: the corpus was embedded with Jina v3
// (model=jina-embeddings-v3, task=retrieval.passage). A query MUST be embedded
// with the SAME model and the QUERY task (retrieval.query) — v3 is an
// asymmetric retrieval pair. Swap in Gemini/OpenAI here and the query vector
// lands in a different coordinate space, so cosine similarity against the stored
// vectors is noise, not signal. Never change the model in this file.
//
// Returns a 1024-dim numeric vector, or THROWS. It never returns an empty/short
// vector on failure — a silent bad vector would rank the whole corpus against
// garbage, which is worse than a visible 502 at the endpoint.

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const MODEL = 'jina-embeddings-v3';
const DIM = 1024;
const MAX_CHARS = 8000; // matches the corpus builder's per-chunk cap
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed one query string into a 1024-dim vector with Jina v3 (retrieval.query).
 * Retries transient failures (429 / 5xx / network) with linear backoff; treats
 * other 4xx as terminal (bad key / bad request won't fix on retry); THROWS when
 * retries are exhausted or the response shape is wrong.
 */
export async function embedQuery(text, {
  task = 'retrieval.query',
  apiKey = process.env.JINA_API_KEY,
  attempts = 3,
  deadlineMs = 18000, // bound TOTAL embed time under the Vercel edge budget so a
                      // Jina 429/5xx surfaces as the handler's clean 502, not a
                      // platform timeout (4×20s+backoff previously ran ~89s).
} = {}) {
  if (!apiKey) throw new Error('JINA_API_KEY is not set');
  const input = String(text ?? '').slice(0, MAX_CHARS);
  if (!input.trim()) throw new Error('embedQuery: empty text');

  const start = Date.now();
  const remaining = () => deadlineMs - (Date.now() - start);
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    if (remaining() <= 1500) break; // not enough budget left for another try
    try {
      const res = await fetch(JINA_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, task, input: [input] }),
        signal: AbortSignal.timeout(Math.min(9000, remaining())),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`jina ${res.status}`);
        const backoff = Math.min(1200 * (a + 1), remaining() - 1000);
        if (backoff <= 0) break;
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`jina ${res.status}: ${t.slice(0, 160)}`); // terminal 4xx
      }
      const j = await res.json();
      const emb = j?.data?.[0]?.embedding;
      if (!Array.isArray(emb) || emb.length !== DIM || !emb.every(Number.isFinite)) {
        throw new Error(`jina: unexpected response (${j?.detail || 'no/non-finite embedding'})`);
      }
      return emb;
    } catch (e) {
      lastErr = e;
      // terminal 4xx (bad key, bad request) shouldn't burn all attempts
      if (String(e?.message || '').startsWith('jina 4')) break;
      const backoff = Math.min(1200 * (a + 1), remaining() - 1000);
      if (a === attempts - 1 || backoff <= 0) break;
      await sleep(backoff);
    }
  }
  throw lastErr ?? new Error('embedQuery failed');
}

export const JINA_QUERY_DIM = DIM;
