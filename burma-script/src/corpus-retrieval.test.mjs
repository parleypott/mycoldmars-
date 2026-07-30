// Coverage for corpus-retrieval.js — the wiring between the citations RAG and
// fc-deep's body.corpus seam. fetch is injected, so these prove the contracts
// with no network:
//
//   1. RESHAPING: citations-search match[] → the {label, text, url} triples
//      deepPrompt renders, with the server's own ceilings respected (12 chunks,
//      1500 char text, 200 char label, 300 char url).
//   2. PROVENANCE: the label carries the Newpress video the source was cited in —
//      that's the whole point of preferring the corpus over the open web.
//   3. DEGRADE-NEVER-BLOCK: every failure path (HTTP error, {error}, malformed
//      body, thrown fetch, abort) resolves to [] rather than propagating.
//   4. ENGINE CONTRACT: verify-all-core AWAITS corpusFor and puts the result on
//      body.corpus; a corpusFor that rejects degrades the run to web-only and the
//      run still SUCCEEDS (a RAG outage must not read as a failed fact-check).

import assert from 'node:assert';
import {
  hostOf, labelFor, toCorpusChunks, makeCorpusFor,
  CORPUS_LIMIT, CORPUS_MIN_SIMILARITY, CORPUS_ENDPOINT, retrievalDisabled, resetRetrievalLatch,
} from './corpus-retrieval.js';
import { runVerifyAll } from './verify-all-core.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  RED:', name); }
}

const M = (over = {}) => ({
  text: 'Burma was annexed in stages across three Anglo-Burmese wars.',
  similarity: 0.8, video: 'Why Myanmar Is Collapsing', sourceUrl: 'https://www.reuters.com/x',
  bookTitle: null, ...over,
});

// ── 1. hostOf ───────────────────────────────────────────────────────────────
ok('hostOf strips www', hostOf('https://www.reuters.com/a/b') === 'reuters.com');
ok('hostOf keeps a bare host', hostOf('https://apnews.com/x') === 'apnews.com');
ok('hostOf on garbage returns empty', hostOf('not a url') === '');
ok('hostOf on empty returns empty', hostOf('') === '');
ok('hostOf on non-string returns empty', hostOf(null) === '');

// ── 2. labelFor — provenance ────────────────────────────────────────────────
ok('labelFor prefers the book title',
  labelFor(M({ bookTitle: 'The Hidden History of Burma' })).startsWith('The Hidden History of Burma'));
ok('labelFor falls back to the hostname', labelFor(M()).startsWith('reuters.com'));
ok('labelFor names the Newpress video', labelFor(M()).includes('Why Myanmar Is Collapsing'));
ok('labelFor without a video omits the cited-in clause',
  labelFor(M({ video: null })) === 'reuters.com');
ok('labelFor with nothing usable still returns a label',
  labelFor({}) === 'Newpress vetted source');
ok('labelFor clips to 200', labelFor(M({ bookTitle: 'T'.repeat(500) })).length === 200);

// ── 3. toCorpusChunks — reshaping ───────────────────────────────────────────
const shaped = toCorpusChunks([M()]);
ok('shape: exactly label/text/url', JSON.stringify(Object.keys(shaped[0])) === '["label","text","url"]');
ok('shape: text carried through', shaped[0].text.startsWith('Burma was annexed'));
ok('shape: url carried through', shaped[0].url === 'https://www.reuters.com/x');
ok('non-array input returns []', toCorpusChunks(null).length === 0);
ok('undefined input returns []', toCorpusChunks(undefined).length === 0);
ok('textless rows are dropped', toCorpusChunks([M({ text: '' }), M({ text: '   ' })]).length === 0);
ok('missing-text rows are dropped', toCorpusChunks([{ similarity: 0.9 }]).length === 0);
ok('below-floor similarity is dropped',
  toCorpusChunks([M({ similarity: CORPUS_MIN_SIMILARITY - 0.01 })]).length === 0);
ok('at-floor similarity is kept',
  toCorpusChunks([M({ similarity: CORPUS_MIN_SIMILARITY })]).length === 1);
ok('rows with no similarity number are kept (server already thresholded)',
  toCorpusChunks([M({ similarity: undefined })]).length === 1);
ok('clips to CORPUS_LIMIT',
  toCorpusChunks(Array.from({ length: 40 }, () => M())).length === CORPUS_LIMIT);
ok('CORPUS_LIMIT matches the fc-deep server ceiling', CORPUS_LIMIT === 12);
ok('text clipped to 1500 (fc-deep clips there too)',
  toCorpusChunks([M({ text: 'x'.repeat(5000) })])[0].text.length === 1500);
ok('url clipped to 300',
  toCorpusChunks([M({ sourceUrl: `https://e.com/${'p'.repeat(900)}` })])[0].url.length === 300);
ok('non-string url becomes empty', toCorpusChunks([M({ sourceUrl: null })])[0].url === '');

// ── 4. makeCorpusFor — happy path ───────────────────────────────────────────
const okFetch = (body, status = 200) => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  f.calls = calls;
  return f;
};

{
  const f = okFetch({ matches: [M(), M({ text: 'second chunk' })] });
  const corpusFor = makeCorpusFor({ fetchImpl: f });
  const out = await corpusFor({ text: 'Burma was annexed in 1826.' });
  ok('happy path returns shaped chunks', out.length === 2 && out[0].label.includes('reuters.com'));
  ok('posts to the citations endpoint', f.calls[0].url === CORPUS_ENDPOINT);
  ok('sends the run text as query', f.calls[0].body.query === 'Burma was annexed in 1826.');
  ok('requests the fc-deep ceiling', f.calls[0].body.limit === CORPUS_LIMIT);
  ok('sends Content-Type json', f.calls[0].init.headers['Content-Type'] === 'application/json');
  ok('method is POST', f.calls[0].init.method === 'POST');
}

// ── 5. makeCorpusFor — degrade, never block ─────────────────────────────────
{
  const f = okFetch({ matches: [M()] });
  const corpusFor = makeCorpusFor({ fetchImpl: f });
  ok('empty run text short-circuits to []', (await corpusFor({ text: '   ' })).length === 0);
  ok('empty run text spends no fetch', f.calls.length === 0);
  ok('missing run object returns []', (await corpusFor(undefined)).length === 0);
}
{
  const errs = [];
  const corpusFor = makeCorpusFor({ fetchImpl: okFetch({ error: 'rate limited' }, 429), onError: (e) => errs.push(e) });
  ok('429 degrades to []', (await corpusFor({ text: 'q' })).length === 0);
  ok('429 surfaces via onError', errs[0] === 'rate limited');
}
{
  const corpusFor = makeCorpusFor({ fetchImpl: okFetch({ error: 'search failed: supabase 502' }, 200) });
  ok('200 with {error} degrades to []', (await corpusFor({ text: 'q' })).length === 0);
}
{
  const f = async () => ({ ok: true, status: 200, text: async () => '<html>gateway timeout</html>' });
  ok('non-JSON body degrades to []', (await makeCorpusFor({ fetchImpl: f })({ text: 'q' })).length === 0);
}
{
  const f = async () => ({ ok: true, status: 200, text: async () => '' });
  ok('empty body degrades to []', (await makeCorpusFor({ fetchImpl: f })({ text: 'q' })).length === 0);
}
{
  const f = async () => { throw new Error('network down'); };
  const errs = [];
  ok('thrown fetch degrades to []', (await makeCorpusFor({ fetchImpl: f, onError: (e) => errs.push(e) })({ text: 'q' })).length === 0);
  ok('thrown fetch surfaces via onError', errs[0].includes('network down'));
}
{
  const f = (url, init) => new Promise((_res, rej) => {
    if (init.signal) init.signal.addEventListener('abort', () => rej(new Error('aborted')));
  });
  const started = Date.now();
  const out = await makeCorpusFor({ fetchImpl: f, timeoutMs: 30 })({ text: 'q' });
  ok('timeout aborts and degrades to []', out.length === 0);
  ok('timeout fires on its own bound, not the batch deadline', Date.now() - started < 3000);
}
{
  const f = okFetch({ matches: 'not-an-array' });
  ok('malformed matches degrades to []', (await makeCorpusFor({ fetchImpl: f })({ text: 'q' })).length === 0);
}

// ── 6. ENGINE CONTRACT — verify-all-core awaits and degrades ────────────────
const R = (text) => ({ text, from: 1, to: 2, block: 'B', context: 'C' });
function memStorage() {
  let map = {};
  return { load: () => JSON.parse(JSON.stringify(map)), save: (m) => { map = JSON.parse(JSON.stringify(m)); }, peek: () => map };
}
const verdictFetch = (sink) => async (_url, init) => {
  sink.push(JSON.parse(init.body));
  return { ok: true, status: 200, text: async () => JSON.stringify({ verdict: 'true', finding: 'f', claims: [], sources: [] }) };
};

{
  // An ASYNC corpusFor must be awaited — the pre-fix sync call handed Array.isArray a
  // Promise, so every chunk was silently dropped. This is the regression lock.
  const sent = [];
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('claim one')],
    fetchImpl: verdictFetch(sent),
    storage,
    corpusFor: async () => [{ label: 'L', text: 'T', url: 'U' }],
  });
  ok('async corpusFor is AWAITED into body.corpus',
    Array.isArray(sent[0].corpus) && sent[0].corpus.length === 1 && sent[0].corpus[0].label === 'L');
  ok('the run still succeeds with a corpus', !storage.peek()['claim one'].verdictError);
}
{
  const sent = [];
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('claim two')],
    fetchImpl: verdictFetch(sent),
    storage,
    corpusFor: async () => { throw new Error('RAG down'); },
  });
  ok('a REJECTING corpusFor leaves body.corpus unset (web-only)', sent[0].corpus === undefined);
  ok('a REJECTING corpusFor does NOT fail the run', !storage.peek()['claim two'].verdictError);
  ok('a REJECTING corpusFor still records the verdict', storage.peek()['claim two'].verdict.verdict === 'true');
}
{
  const sent = [];
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('claim three')],
    fetchImpl: verdictFetch(sent),
    storage,
    corpusFor: () => { throw new Error('sync boom'); },
  });
  ok('a SYNC-throwing corpusFor does not fail the run', !storage.peek()['claim three'].verdictError);
}
{
  const sent = [];
  await runVerifyAll({
    runs: [R('claim four')], fetchImpl: verdictFetch(sent), storage: memStorage(),
    corpusFor: async () => [],
  });
  ok('an empty corpus omits the key entirely', sent[0].corpus === undefined);
}

// ── 7. corpusUsed marker — grounded vs web-only must be distinguishable ─────
{
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('claim six')], fetchImpl: verdictFetch([]), storage,
    corpusFor: async () => [{ label: 'L', text: 'T', url: 'U' }, { label: 'L2', text: 'T2', url: '' }],
  });
  ok('corpusUsed records how many chunks reached the model', storage.peek()['claim six'].corpusUsed === 2);
}
{
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('claim seven')], fetchImpl: verdictFetch([]), storage,
    corpusFor: async () => { throw new Error('RAG down'); },
  });
  ok('a degraded run is marked corpusUsed:0, not left ambiguous', storage.peek()['claim seven'].corpusUsed === 0);
}
{
  const storage = memStorage();
  await runVerifyAll({ runs: [R('claim eight')], fetchImpl: verdictFetch([]), storage, corpusFor: null });
  ok('web-only opt-out is marked corpusUsed:0', storage.peek()['claim eight'].corpusUsed === 0);
}
{
  const sent = [];
  await runVerifyAll({ runs: [R('claim five')], fetchImpl: verdictFetch(sent), storage: memStorage(), corpusFor: null });
  ok('corpusFor:null is the web-only opt-out', sent[0].corpus === undefined);
}

// ── 8. 501 LATCH — an unprovisioned deployment reports once, not once per claim ──
{
  resetRetrievalLatch();
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    return { ok: false, status: 501, text: async () => JSON.stringify({ error: 'retrieval_not_configured' }) };
  };
  const errs = [];
  const corpusFor = makeCorpusFor({ fetchImpl: f, onError: (e) => errs.push(e) });

  ok('501 degrades to []', (await corpusFor({ text: 'claim one' })).length === 0);
  ok('501 sets the latch', retrievalDisabled() === true);
  ok('501 reports once', errs.length === 1 && /not configured/i.test(errs[0]));

  // The whole point: the next 9 claims must not each fire a doomed request.
  for (let i = 0; i < 9; i++) await corpusFor({ text: `claim ${i + 2}` });
  ok('latched: no further fetches for the rest of the batch', calls.length === 1);
  ok('latched: no further error reports', errs.length === 1);
  ok('latched calls still return []', (await corpusFor({ text: 'x' })).length === 0);

  resetRetrievalLatch();
  ok('reset re-probes (a reload picks the key up with no code change)', retrievalDisabled() === false);
}
{
  // A transient failure must NOT latch — the next claim may well succeed.
  resetRetrievalLatch();
  const calls = [];
  const f = async (url) => { calls.push(url); return { ok: false, status: 502, text: async () => JSON.stringify({ error: 'upstream boom' }) }; };
  const corpusFor = makeCorpusFor({ fetchImpl: f });
  await corpusFor({ text: 'a' }); await corpusFor({ text: 'b' });
  ok('502 does NOT latch — transient errors stay per-call', retrievalDisabled() === false);
  ok('502 keeps trying each claim', calls.length === 2);
  resetRetrievalLatch();
}
{
  resetRetrievalLatch();
  const calls = [];
  const f = async (url) => { calls.push(url); return { ok: false, status: 429, text: async () => JSON.stringify({ error: 'Too many requests. Wait a minute.' }) }; };
  const corpusFor = makeCorpusFor({ fetchImpl: f });
  await corpusFor({ text: 'a' }); await corpusFor({ text: 'b' });
  ok('429 does NOT latch — the budget refills', retrievalDisabled() === false);
  ok('429 keeps trying each claim', calls.length === 2);
  resetRetrievalLatch();
}

assert.ok(true);
console.log(`corpus-retrieval: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
