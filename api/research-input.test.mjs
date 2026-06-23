// Cost-guard lock for the PUBLIC, unauthenticated research-* endpoints.
//
// research-openai-start + research-gemini run an expensive deep-research model
// on every POST with NO auth gate. They were missing the prompt-length cap their
// siblings (research-claude 5000, research-clarify 3000) have, and openai-start
// passed a client-supplied `model` straight to OpenAI (force the pricier
// o3-deep-research). This locks the shared cost guard + the model coercion.
//
// Imports the REAL shipped helpers AND drives the REAL handler default exports
// end-to-end with mock Requests + a stubbed global.fetch (NO real network call).

import {
  validateResearchPrompt,
  resolveResearchModel,
  MAX_RESEARCH_PROMPT,
  DEFAULT_RESEARCH_MODEL,
  ALLOWED_RESEARCH_MODELS,
} from './_lib/research-input.js';

let pass = 0, fail = 0;
const eq = (a, b, m) => { if (a === b) pass++; else { fail++; console.error(`FAIL ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); } };
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL ${m}`); } };

// ── validateResearchPrompt ──────────────────────────────────────────────────
eq(validateResearchPrompt('a real question').ok, true, 'valid prompt ok');
eq(validateResearchPrompt('').ok, false, 'empty not ok');
eq(validateResearchPrompt('').status, 400, 'empty → 400');
eq(validateResearchPrompt('').error, 'prompt required', 'empty error');
eq(validateResearchPrompt(undefined).status, 400, 'undefined → 400');
eq(validateResearchPrompt(null).status, 400, 'null → 400');

// non-string → 413 (typeof guard)
eq(validateResearchPrompt(12345).ok, false, 'number not ok');
eq(validateResearchPrompt(12345).status, 413, 'number → 413');
eq(validateResearchPrompt({ x: 1 }).status, 413, 'object → 413');
eq(validateResearchPrompt(['a']).status, 413, 'array → 413');

// length cap boundary
eq(validateResearchPrompt('x'.repeat(MAX_RESEARCH_PROMPT)).ok, true, 'exactly-at-cap ok');
eq(validateResearchPrompt('x'.repeat(MAX_RESEARCH_PROMPT + 1)).ok, false, 'one-over not ok');
eq(validateResearchPrompt('x'.repeat(MAX_RESEARCH_PROMPT + 1)).status, 413, 'one-over → 413');
ok(/max 5000 chars/.test(validateResearchPrompt('x'.repeat(MAX_RESEARCH_PROMPT + 1)).error), 'over-cap error names the limit');
eq(validateResearchPrompt('short', 3).ok, false, 'custom max honored (over)');
eq(validateResearchPrompt('ab', 3).ok, true, 'custom max honored (under)');
eq(MAX_RESEARCH_PROMPT, 5000, 'cap matches research-claude');

// ── resolveResearchModel ────────────────────────────────────────────────────
eq(resolveResearchModel(undefined), DEFAULT_RESEARCH_MODEL, 'no model → default');
eq(resolveResearchModel(''), DEFAULT_RESEARCH_MODEL, 'empty → default');
eq(resolveResearchModel(null), DEFAULT_RESEARCH_MODEL, 'null → default');
eq(resolveResearchModel('o4-mini-deep-research'), 'o4-mini-deep-research', 'allowed model kept');
// the headline cost block: the expensive model coerces to the cheap default
eq(resolveResearchModel('o3-deep-research'), DEFAULT_RESEARCH_MODEL, 'o3 coerced to default (cost block)');
eq(resolveResearchModel('gpt-5'), DEFAULT_RESEARCH_MODEL, 'arbitrary model coerced');
eq(resolveResearchModel('O4-MINI-DEEP-RESEARCH'), DEFAULT_RESEARCH_MODEL, 'case-sensitive allow-list (uppercase coerced)');
ok(ALLOWED_RESEARCH_MODELS.includes(DEFAULT_RESEARCH_MODEL), 'default is itself allowed');
ok(!ALLOWED_RESEARCH_MODELS.includes('o3-deep-research'), 'expensive model not on allow-list');

// INLINE RED PROOF — reconstruct the OLD openai-start model logic and show it
// passed the expensive model straight through, while resolveResearchModel blocks it.
const oldResolve = (model) => model || 'o4-mini-deep-research';
eq(oldResolve('o3-deep-research'), 'o3-deep-research', 'RED: old logic leaked o3');
ok(resolveResearchModel('o3-deep-research') !== 'o3-deep-research', 'fixed logic does NOT leak o3');

// ── END-TO-END handler proof (mock Requests + stubbed fetch, no network) ─────
const mkReq = (method, body) => ({
  method,
  async json() {
    if (typeof body === 'string') return JSON.parse(body); // may throw → readJsonBody catches
    return body;
  },
});

const { default: openaiStart } = await import('./research-openai-start.js');
const { default: geminiHandler } = await import('./research-gemini.js');

// capture-fetch: intercept the upstream call, assert on its body, return a fake
let lastFetch = null;
const installFetch = (fakeJson, fakeOk = true) => {
  global.fetch = async (url, opts) => {
    lastFetch = { url, body: opts && opts.body ? JSON.parse(opts.body) : null };
    return {
      ok: fakeOk,
      status: fakeOk ? 200 : 500,
      async json() { return fakeJson; },
      async text() { return JSON.stringify(fakeJson); },
    };
  };
};

// openai-start: GET → 405
eq((await openaiStart(mkReq('GET'))).status, 405, 'openai-start GET → 405');
// empty body prompt → 400 (no network)
lastFetch = null; installFetch({ id: 'x', status: 'queued' });
eq((await openaiStart(mkReq('POST', { prompt: '' }))).status, 400, 'openai-start empty → 400');
ok(lastFetch === null, 'openai-start 400 makes NO fetch');
// over-cap prompt → 413 (no network)
lastFetch = null;
eq((await openaiStart(mkReq('POST', { prompt: 'x'.repeat(6000) }))).status, 413, 'openai-start over-cap → 413');
ok(lastFetch === null, 'openai-start 413 makes NO fetch');
// THE COST BLOCK, end-to-end: client asks for o3 → OpenAI receives the cheap default
lastFetch = null; installFetch({ id: 'job_abc', status: 'queued' });
const r1 = await openaiStart(mkReq('POST', { prompt: 'who governs Taiwan?', model: 'o3-deep-research' }));
eq(r1.status, 200, 'openai-start valid → 200');
ok(lastFetch !== null, 'openai-start valid reaches fetch');
eq(lastFetch.body.model, 'o4-mini-deep-research', 'COST BLOCK: o3 request sent o4-mini to OpenAI');
// no model field → default
lastFetch = null;
await openaiStart(mkReq('POST', { prompt: 'a question' }));
eq(lastFetch.body.model, 'o4-mini-deep-research', 'no model → default sent');
// malformed body → 400 (readJsonBody), no network
lastFetch = null;
eq((await openaiStart(mkReq('POST', 'not json{'))).status, 400, 'openai-start malformed → 400');
ok(lastFetch === null, 'openai-start malformed makes NO fetch');
// JSON-null body → 400, no network
lastFetch = null;
eq((await openaiStart(mkReq('POST', null))).status, 400, 'openai-start null body → 400');
ok(lastFetch === null, 'openai-start null body makes NO fetch');

// gemini: GET → 405
eq((await geminiHandler(mkReq('GET'))).status, 405, 'gemini GET → 405');
// over-cap → 413 (no network) — needs the cost guard to run BEFORE the key check
process.env.GEMINI_API_KEY = 'test-key';
lastFetch = null; installFetch({ candidates: [{ content: { parts: [{ text: '# Report' }] } }] });
eq((await geminiHandler(mkReq('POST', { prompt: 'x'.repeat(6000) }))).status, 413, 'gemini over-cap → 413');
ok(lastFetch === null, 'gemini 413 makes NO fetch');
// empty → 400, no network
lastFetch = null;
eq((await geminiHandler(mkReq('POST', { prompt: '' }))).status, 400, 'gemini empty → 400');
ok(lastFetch === null, 'gemini empty makes NO fetch');
// valid → reaches Gemini
lastFetch = null;
const rg = await geminiHandler(mkReq('POST', { prompt: 'a question' }));
eq(rg.status, 200, 'gemini valid → 200');
ok(lastFetch !== null && /generativelanguage/.test(lastFetch.url), 'gemini valid reaches Gemini fetch');

console.log(`\nresearch-input: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
