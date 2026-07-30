// Corpus retrieval — the seam fc-deep left open, now wired to the citations RAG.
//
// fc-deep (api/burma-tk.js) accepts body.corpus: up to 12 {label, text, url}
// triples that deepPrompt renders as "VETTED NEWPRESS SOURCES — CHECK THESE
// FIRST", and the tool schema lets the model tag anything it grounds there as
// kind:'corpus'. Until now nothing populated that array — the batch engine
// called a corpusFor() seam that was always undefined. This module fills it from
// POST /api/citations-search (Jina v3 retrieval.query embedding → pgvector kNN
// over rag.chunks: 179,782 chunks / ~7,000 sources / 167 videos).
//
// DEGRADE, NEVER BLOCK. Retrieval is an enhancement on top of a fact-check that
// already works web-only. Every failure path — endpoint missing, 401 gate, 429
// rate limit, 502 upstream, timeout, malformed body — resolves to [] so the
// fc-deep request still goes out. A corpus miss must never cost a verification.
//
// The pure halves (labelFor / toCorpusChunks) are exported separately from the
// fetching half (makeCorpusFor) so the reshaping contract is unit-testable with
// no network, matching the repo's mutation-locked-pure-core idiom.

export const CORPUS_ENDPOINT = '/api/citations-search';
export const CORPUS_LIMIT = 12; // fc-deep clips to 12 server-side; ask for exactly that
export const CORPUS_MIN_SIMILARITY = 0.35; // below this a chunk is noise, not evidence
export const CORPUS_TIMEOUT_MS = 12_000; // generous for one embed+kNN, trivial against the 240s deep budget

// Host for a label when a chunk has no book title (most web sources).
export function hostOf(url) {
  if (typeof url !== 'string' || !url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The provenance line the model sees and echoes back when it cites kind:'corpus'.
// Newpress-first by design: the point of the corpus is that THIS team already
// vetted and footnoted the source in a named video, so the label carries that.
export function labelFor(match) {
  const m = match || {};
  const title = (typeof m.bookTitle === 'string' && m.bookTitle.trim())
    || hostOf(m.sourceUrl)
    || 'Newpress vetted source';
  const video = typeof m.video === 'string' && m.video.trim() ? m.video.trim() : '';
  const base = video ? `${title} — cited in Newpress "${video}"` : title;
  return base.slice(0, 200);
}

// citations-search match[] → the {label, text, url} shape deepPrompt renders.
// Drops textless rows (a chunk with no text cannot ground a quote) and anything
// under the similarity floor, then clips to the server's own ceiling.
export function toCorpusChunks(matches, { limit = CORPUS_LIMIT, minSimilarity = CORPUS_MIN_SIMILARITY } = {}) {
  if (!Array.isArray(matches)) return [];
  return matches
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .filter((m) => typeof m.similarity !== 'number' || m.similarity >= minSimilarity)
    .slice(0, limit)
    .map((m) => ({
      label: labelFor(m),
      text: m.text.slice(0, 1500),
      url: typeof m.sourceUrl === 'string' ? m.sourceUrl.slice(0, 300) : '',
    }));
}

// Build the corpusFor(run) function the batch engine and the dock both take.
// Returns an ASYNC fn — callers must await it (verify-all-core does).
export function makeCorpusFor({
  fetchImpl,
  endpoint = CORPUS_ENDPOINT,
  limit = CORPUS_LIMIT,
  minSimilarity = CORPUS_MIN_SIMILARITY,
  timeoutMs = CORPUS_TIMEOUT_MS,
  onError,
} = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return async function corpusFor(run) {
    const query = (run && typeof run.text === 'string' ? run.text : '').trim();
    if (!query) return [];
    // Own AbortController per call: the batch's per-run controller governs the
    // fc-deep request, not this pre-flight. Retrieval must not hold a slot open.
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const killer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, minSimilarity }),
        signal: ac ? ac.signal : undefined,
      });
      const raw = await res.text();
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { return []; }
      if (!res.ok || data.error) {
        if (onError) onError(data.error || `HTTP ${res.status}`);
        return [];
      }
      return toCorpusChunks(data.matches, { limit, minSimilarity });
    } catch (e) {
      // Includes the abort. Silent by default — the fact-check proceeds web-only.
      if (onError) onError(String((e && e.message) || e));
      return [];
    } finally {
      if (killer) clearTimeout(killer);
    }
  };
}
