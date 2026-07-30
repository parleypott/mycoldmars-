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
// Deep is ON by default now (the 2026-07-30 "platform clamp" turned out to be an Anthropic
// spend cap — see the DEEP-MODE KILL SWITCH note in burma-tk.js). Make sure no stray
// FC_DEEP_DISABLED from the environment turns it off under the tests.
delete process.env.FC_DEEP_DISABLED;

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


// ---- 6. DEEP-MODE PLATFORM GATE (incident 2026-07-30) ----
// Without FC_DEEP_ENABLED, fc-deep must 501 — NOT 502, and NOT reach Anthropic.
// The 501 is what lets the batch stop on the first hit instead of grinding every claim.
{
  const saved = process.env.FC_DEEP_DISABLED;
  process.env.FC_DEEP_DISABLED = '1';
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const r = await call({ body: { mode: 'fc-deep', marker: 'Burma was annexed in 1826.' } });
    ok('gate: fc-deep with FC_DEEP_DISABLED -> 501', r.status === 501);
    ok('gate: body carries the latchable sentinel', r.body && r.body.error === 'deep_unavailable');
    ok('gate: message says it is switched off', r.body && /switched off/i.test(r.body.message || ''));
    ok('gate: message reassures the shallow check still works', r.body && /VERIFY CLAIM/i.test(r.body.message || ''));

    // THE POINT OF THE PLACEMENT: a doomed deep call must not consume a token from the
    // bucket the writers' interactive check shares. Fire more than RL_BURST of them; the
    // shallow path must still be servable afterwards.
    for (let i = 0; i < 25; i++) await call({ body: { mode: 'fc-deep', marker: `claim ${i}` } });
    const shallow = await call({ body: { mode: 'fc', marker: 'a shallow claim' } });
    ok('gate: 25 gated deep calls do NOT rate-limit the shallow path', shallow.status !== 429);
  } finally {
    if (saved !== undefined) process.env.FC_DEEP_DISABLED = saved; else delete process.env.FC_DEEP_DISABLED;
    delete process.env.ANTHROPIC_API_KEY;
  }
}

// ---- 7. gate does not touch the shallow modes ----
{
  const saved = process.env.FC_DEEP_DISABLED;
  process.env.FC_DEEP_DISABLED = '1';
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await call({ body: { mode: 'fc', marker: 'still works' } });
    ok('gate: shallow fc is NOT gated (fails on the missing key, not 501)', r.status !== 501);
  } finally {
    if (saved !== undefined) process.env.FC_DEEP_DISABLED = saved; else delete process.env.FC_DEEP_DISABLED;
  }
}


// ---- 8. ANTHROPIC KEY FAILOVER (2026-07-30: primary spend cap emptied mid-fact-check) ----
{
  const realFetch = globalThis.fetch;
  const savedPrimary = process.env.ANTHROPIC_API_KEY;
  const savedBackup = process.env.ANTHROPIC_API_KEY_BACKUP;
  process.env.ANTHROPIC_API_KEY = 'primary-key';
  process.env.ANTHROPIC_API_KEY_BACKUP = 'backup-key';
  process.env.BURMA_TK_TIMEOUT_MS = '2000';

  const okBody = JSON.stringify({ content: [{ type: 'tool_use', name: 'emit_verdict', input: { verdict: 'true', finding: 'f', suggestedEdit: 'e', sources: [] } }] });
  const mk = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body, clone() { return this; }, json: async () => JSON.parse(body) });

  // A quota 400 on the primary must roll over to the backup and SUCCEED.
  {
    const keys = [];
    globalThis.fetch = async (_u, init) => {
      keys.push(init.headers['x-api-key']);
      if (init.headers['x-api-key'] === 'primary-key') {
        return mk(400, JSON.stringify({ error: { message: 'You have reached your specified API usage limits. You will regain access on 2026-08-01 at 00:00 UTC.' } }));
      }
      return mk(200, okBody);
    };
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: quota 400 rolls over to the backup key', keys.length === 2 && keys[0] === 'primary-key' && keys[1] === 'backup-key');
    ok('failover: the request then SUCCEEDS on the backup', r.status === 200);
    // The whole point of usedBackupKey: a run that quietly moved to the second card and
    // SUCCEEDED must NOT look identical to a normal one — surface the flag so the operator
    // sees the primary draining while the backup still carries the batch.
    ok('failover: a successful backup run surfaces usedBackupKey on the SUCCESS response', r.body && r.body.usedBackupKey === true);
  }

  // The normal path (primary key works) must stay byte-identical: no usedBackupKey field.
  {
    globalThis.fetch = async () => mk(200, okBody);
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: a normal primary success does NOT carry usedBackupKey', r.status === 200 && r.body && !('usedBackupKey' in r.body));
  }

  // A malformed-request 400 must NOT failover — it fails identically on any key.
  {
    const keys = [];
    globalThis.fetch = async (_u, init) => { keys.push(init.headers['x-api-key']); return mk(400, JSON.stringify({ error: { message: 'messages.0.content: expected array' } })); };
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: a plain 400 does NOT burn the backup key', keys.length === 1);
    ok('failover: plain 400 surfaces as 422, not 502', r.status === 422);
  }

  // 429 and 401 are account-shaped -> failover.
  for (const st of [429, 401]) {
    const keys = [];
    globalThis.fetch = async (_u, init) => { keys.push(init.headers['x-api-key']); return init.headers['x-api-key'] === 'primary-key' ? mk(st, '{}') : mk(200, okBody); };
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok(`failover: ${st} rolls over`, keys.length === 2 && r.status === 200);
  }

  // 5xx is Anthropic being unwell, not this key.
  {
    const keys = [];
    globalThis.fetch = async (_u, init) => { keys.push(init.headers['x-api-key']); return mk(503, 'upstream down'); };
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: 5xx does NOT failover (not a key problem)', keys.length === 1);
    ok('failover: 5xx stays 502', r.status === 502);
  }

  // Both cards refused -> report it, so nobody tops up the wrong account.
  {
    globalThis.fetch = async () => mk(400, JSON.stringify({ error: { message: 'You have reached your specified API usage limits.' } }));
    const r = await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: both refused -> triedBackupKey flagged', r.body && r.body.triedBackupKey === true);
    ok('failover: both refused -> the real message survives', r.body && /usage limits/i.test(r.body.message || ''));
  }

  // No backup configured -> behave exactly as before.
  {
    delete process.env.ANTHROPIC_API_KEY_BACKUP;
    const keys = [];
    globalThis.fetch = async (_u, init) => { keys.push(init.headers['x-api-key']); return mk(400, JSON.stringify({ error: { message: 'usage limits' } })); };
    await call({ body: { mode: 'fc', marker: 'a claim' } });
    ok('failover: no backup configured -> exactly one call', keys.length === 1);
  }

  globalThis.fetch = realFetch;
  if (savedPrimary !== undefined) process.env.ANTHROPIC_API_KEY = savedPrimary; else delete process.env.ANTHROPIC_API_KEY;
  if (savedBackup !== undefined) process.env.ANTHROPIC_API_KEY_BACKUP = savedBackup; else delete process.env.ANTHROPIC_API_KEY_BACKUP;
  delete process.env.BURMA_TK_TIMEOUT_MS;
}

assert.ok(true);
console.log(`burma-tk-deep: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
