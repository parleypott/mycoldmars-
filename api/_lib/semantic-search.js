// Pure cores for Hunter's client-side semantic-search fallback (api/gemini.js
// handleSemanticSearch). When the server-side pgvector RPC is unavailable, the
// proxy pages every stored embedding, parses each one, and ranks them by cosine
// similarity against the query embedding. Both functions live here so they can
// be unit-tested in isolation; gemini.js imports them.

/**
 * Parse a stored embedding (as returned by PostgREST) into a clean numeric
 * vector, or null if it can't be trusted.
 *
 * pgvector columns usually arrive as a JSON string ("[0.1,-0.2,...]"), but can
 * also come back as a JSON array, or in a paren-wrapped literal. We accept all
 * three, then GUARANTEE the result is a non-empty array of finite numbers.
 *
 * Why the finiteness guard matters: the caller ranks rows with
 *   results.sort((a, b) => b.similarity - a.similarity)
 * and cosineSim returns NaN for any vector containing a non-finite entry. A
 * single NaN similarity makes the sort comparator return NaN, which corrupts
 * V8's TimSort ordering — quietly demoting genuinely-relevant clips, not just
 * the bad row. So a malformed embedding must be dropped (null → skipped by the
 * caller) rather than allowed to poison the ranking. The previous version
 * returned the raw JSON.parse result (which could be a scalar/object) and a
 * `[NaN]` fallback array, both of which slipped past the caller's `if (!emb)`
 * guard and reached cosineSim.
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
      // not JSON — fall through to the literal parser below
    }
    if (!arr) {
      arr = emb.replace(/[[\]()]/g, '').split(',').map(Number);
    }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;

  // Coerce each entry through Number (preserves the old tolerance of numeric
  // strings) but reject the whole vector on any non-finite value.
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

/**
 * Cosine similarity of two equal-length numeric vectors. Returns 0 for
 * missing/mismatched/zero-magnitude inputs (a safe "no signal" value that
 * sorts to the bottom). Mathematically unchanged from the inline original.
 */
export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}
