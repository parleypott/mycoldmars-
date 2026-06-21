/**
 * Pure cross-tier matching cores — extracted from cross-tier-matching.mjs so they
 * are unit-testable headlessly (the worker reads .env + constructs the Supabase
 * client + runs main() at module load, so it can't be imported in a test).
 *
 * Logic is byte-identical to the inline copies it replaced.
 */

/**
 * Coerce a stored embedding (as returned by PostgREST) into a clean numeric vector,
 * or null if it can't be trusted. pgvector arrives as a JS array, a JSON string
 * ("[0.1,0.2,...]"), or a paren-wrapped literal ("(0.1,0.2,...)") — accept all three,
 * then GUARANTEE the result is a non-empty array of FINITE numbers.
 *
 * Why the finiteness guard matters: cosineSimilarity below emits NaN for any vector
 * with a non-finite entry (a malformed non-numeric token → NaN, OR a numeric-overflow
 * token like "1e999" → Infinity → Infinity/Infinity = NaN, which the denom>0 guard does
 * NOT catch). A single NaN similarity poisons V8's TimSort comparator in every
 * `.sort((a,b)=>b.similarity-a.similarity)` (script→raw, selects→finished), silently
 * scrambling the match ranking — not just the bad row. So a corrupt embedding must be
 * dropped (null → cosineSimilarity returns 0 → sorts to the bottom) rather than allowed
 * to poison the sort. This mirrors the hardened contract in api/_lib/semantic-search.js
 * (commit 2dfe675); the previous inline copy returned the raw array, leaking NaN/Infinity.
 */
export function parseEmbedding(emb) {
  let arr = null;
  if (Array.isArray(emb)) {
    arr = emb;
  } else if (typeof emb === 'string') {
    try {
      const parsed = JSON.parse(emb);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // not JSON — fall through to the paren-literal parser below
    }
    if (!arr) {
      arr = emb.replace(/[[\]()]/g, '').split(',').map(Number);
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;

  // Coerce each entry through Number (preserves the old tolerance of numeric strings)
  // but reject the whole vector on any non-finite value (NaN or ±Infinity).
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/**
 * Cosine similarity between two embeddings. Returns 0 (never NaN) for a null/mismatched/
 * zero-norm/corrupt vector — parseEmbedding's finiteness guarantee + the denom>0 guard
 * together keep a corrupt embedding from emitting a NaN that would poison the match sort.
 */
export function cosineSimilarity(a, b) {
  const va = parseEmbedding(a);
  const vb = parseEmbedding(b);
  if (!va || !vb || va.length !== vb.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
