// Coverage for mode:'fc-deep' — the batch-grade grounded fact check added 2026-07-17.
// Methodology port of the Kenneth (Newpress Hermes) Iran-citation pipeline: grounding
// quotes are MANDATORY and schema-enforced (no verbatim quote -> no source), claims are
// decomposed and judged separately, and the interactive time-budget language is GONE —
// deep runs in the background where nobody watches a spinner.
//
// Locks four things:
//   1. PAYLOAD SHAPE: fc-deep gets emit_deep_verdict + web_search max_uses 8 + the bigger
//      output ceiling, while shallow fc stays BYTE-COMPATIBLE with its pre-deep payload
//      (writers rely on the quick check mid-draft — regression here is a product break).
//   2. PROMPT DISCIPLINE: the deep prompt carries the HARD GROUNDING RULE, decomposition,
//      the never-guess-authors rubric, date anchoring, and the corpus-first section when
//      vetted chunks ride in — and NONE of the shallow prompt's give-up-early language.
//   3. ROUTING: mode:'fc-deep' runs the full validation path end-to-end (stops at the
//      key guard, proving no crash), and malformed corpus payloads never throw.
//   4. DEADLINE: deep picks the deep timeout branch and returns its own clean JSON 504.

import assert from 'node:assert';
import handler, { deepPrompt, buildPayload, FC_UPSTREAM_TIMEOUT_MS, FC_DEEP_TIMEOUT_MS } from './burma-tk.js';

delete process.env.ANTHROPIC_API_KEY;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  RED:', name); }
}

function mockReq({ method = 'POST', body } = {}) {
  return { method, json: async () => body };
}
async function call(opts) {
  const res = await handler(mockReq(opts));
  let parsed = null;
  try { parsed = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body: parsed };
}

const ARGS = { marker: 'the junta controls about 21% of the country', block: 'B', context: 'C', corpus: [], today: '2026-01-02' };

// ---- 1. payload shape ----
{
  const p = buildPayload('fc-deep', ARGS);
  ok('deep: tool is emit_deep_verdict', p.tools.some((t) => t.name === 'emit_deep_verdict'));
  ok('deep: web_search rides along at max_uses 8', p.tools.some((t) => t.type === 'web_search_20260209' && t.max_uses === 8));
  ok('deep: bigger output ceiling (4000)', p.max_tokens === 4000);
  ok('deep: tool_choice auto (model decides when to stop searching)', p.tool_choice && p.tool_choice.type === 'auto');
  ok('deep: schema REQUIRES claims + sources (grounding is structural)', (() => {
    const tool = p.tools.find((t) => t.name === 'emit_deep_verdict');
    const req = tool.input_schema.required;
    const srcReq = tool.input_schema.properties.sources.items.required;
    return req.includes('claims') && req.includes('sources') && srcReq.includes('quote') && srcReq.includes('label');
  })());

  // Shallow fc payload is UNCHANGED — the writer's quick check keeps its exact contract.
  const shallow = buildPayload('fc', { marker: 'm', block: 'b', context: 'c' });
  ok('shallow fc: still emit_verdict', shallow.tools.some((t) => t.name === 'emit_verdict'));
  ok('shallow fc: still max_uses 3', shallow.tools.some((t) => t.type === 'web_search_20260209' && t.max_uses === 3));
  ok('shallow fc: still max_tokens 2000', shallow.max_tokens === 2000);
}

// ---- 2. prompt discipline ----
{
  const p = deepPrompt(ARGS);
  ok('deep prompt: HARD GROUNDING RULE present', p.includes('HARD GROUNDING RULE'));
  ok('deep prompt: verbatim-quote requirement', /verbatim/i.test(p));
  ok('deep prompt: decomposition step', /DECOMPOSE/.test(p) && /distinct factual claims/.test(p));
  ok('deep prompt: never-guess-authors rubric', /NEVER guess an author/.test(p));
  ok('deep prompt: conflict rule (partly/unclear, both positions)', /CONFLICT RULE/.test(p));
  ok('deep prompt: date anchor injected', p.includes('Today is 2026-01-02'));
  ok('deep prompt: iterative-search license (8 uses)', /up to 8 web_search uses/.test(p) && /search iteratively/.test(p));
  ok('deep prompt ANTI: no "never keep searching"', !/never keep searching/i.test(p));
  ok('deep prompt ANTI: no "at most 3" budget language', !/at most 3/i.test(p));

  const noCorpus = deepPrompt({ ...ARGS, corpus: [] });
  ok('deep prompt: no VETTED section without corpus', !noCorpus.includes('VETTED NEWPRESS SOURCES'));
  const withCorpus = deepPrompt({ ...ARGS, corpus: [{ label: 'Reuters 2024-03-02 — Myanmar fuel crisis', url: 'https://example.com/x', text: 'Fuel queues stretched for blocks in Yangon.' }] });
  ok('deep prompt: corpus renders as VETTED NEWPRESS SOURCES, checked first', withCorpus.includes('VETTED NEWPRESS SOURCES') && withCorpus.includes('[NP-1]') && withCorpus.includes('Fuel queues stretched'));
  ok('deep prompt: corpus-first instruction names kind corpus', /kind: "corpus"/.test(withCorpus));
}

// ---- 3. routing + corpus robustness (no key -> clean 500 at the guard, never a throw) ----
{
  const r = await call({ body: { mode: 'fc-deep', marker: 'the 1962 coup installed Ne Win' } });
  ok('fc-deep routes end-to-end to the key guard (500, not crash/tk-fallthrough)',
    r.status === 500 && r.body && /ANTHROPIC_API_KEY/.test(r.body.error));

  for (const badCorpus of [null, 42, 'nope', { a: 1 }, [null, 42, { label: 9, text: 7, url: [] }, { text: 'x'.repeat(9000) }]]) {
    const rb = await call({ body: { mode: 'fc-deep', marker: 'valid claim', corpus: badCorpus } });
    ok(`fc-deep: malformed corpus ${JSON.stringify(badCorpus).slice(0, 30)} -> still clean 500 key-guard (no throw)`,
      rb.status === 500 && rb.body && /ANTHROPIC_API_KEY/.test(rb.body.error));
  }
}

// ---- 4. deep deadline branch: its own clean JSON 504 ----
{
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.BURMA_TK_TIMEOUT_MS = '60';
  globalThis.fetch = () => new Promise(() => {}); // hang -> deadline wins
  try {
    const rt = await call({ body: { mode: 'fc-deep', marker: 'slow compound claim' } });
    ok('deep: timeout -> 504 clean JSON', rt.status === 504 && rt.body && rt.body.timeout === true);
    ok('deep: timeout message is the deep one (split-the-marker guidance)', /deep check hit the/.test(rt.body.error) && /split the marker/.test(rt.body.error));
  } finally {
    delete process.env.BURMA_TK_TIMEOUT_MS;
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = realFetch;
  }
}

// ---- 5. constants sanity: deep deadline sits under maxDuration with margin, above interactive ----
{
  ok('deadlines: FC_DEEP_TIMEOUT_MS = 240s', FC_DEEP_TIMEOUT_MS === 240_000);
  ok('deadlines: interactive bound unchanged at 50s', FC_UPSTREAM_TIMEOUT_MS === 50_000);
}

assert.ok(true);
console.log(`burma-tk-deep: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
