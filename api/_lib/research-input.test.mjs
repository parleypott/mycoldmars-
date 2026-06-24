// Lock for research-input.js — the cost guard + model allowlist that protect
// the PUBLIC, UNAUTHENTICATED research-* endpoints (api/research-gemini.js and
// api/research-openai-start.js both import these, no checkAccess in front).
//
// Why this matters: each handler runs an EXPENSIVE deep-research model on every
// POST with no auth. Two real billing/abuse vectors live here:
//   1) validateResearchPrompt — caps prompt size (empty -> 400, oversized /
//      non-string -> 413). Loosen it and a megabyte prompt to a deep-research
//      model becomes a repeatable money drain.
//   2) resolveResearchModel — only the cheap allow-listed model is honored; a
//      client-supplied `model` (research-openai-start accepts one and passes it
//      straight to OpenAI) that names the pricier o3 tier must coerce to the
//      cheap default. Break the allowlist and any caller forces the expensive
//      model on a public endpoint.
//
// Shipped with a documented contract but NO test. Imports the REAL shipped
// exports — no mirror, can't drift.
import {
  validateResearchPrompt,
  resolveResearchModel,
  MAX_RESEARCH_PROMPT,
  DEFAULT_RESEARCH_MODEL,
  ALLOWED_RESEARCH_MODELS,
} from './research-input.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── Constants pinned (a careless edit to the cap or the cheap default trips here) ──
eq(MAX_RESEARCH_PROMPT, 5000, 'prompt cap is 5000 chars');
eq(DEFAULT_RESEARCH_MODEL, 'o4-mini-deep-research', 'default model is the cheap tier');
eq(Array.isArray(ALLOWED_RESEARCH_MODELS), true, 'allowlist is an array');
eq(ALLOWED_RESEARCH_MODELS.length, 1, 'exactly one model allow-listed');
ok(ALLOWED_RESEARCH_MODELS.includes('o4-mini-deep-research'), 'cheap model is on the allowlist');
ok(!ALLOWED_RESEARCH_MODELS.includes('o3-deep-research'), 'expensive o3 tier is NOT allow-listed');

// ── validateResearchPrompt: empty / falsy → 400 "prompt required" ──
for (const [v, label] of [['', 'empty string'], [null, 'null'], [undefined, 'undefined'], [0, 'zero']]) {
  const r = validateResearchPrompt(v);
  eq(r.ok, false, `${label} → not ok`);
  eq(r.status, 400, `${label} → 400`);
  ok(/required/i.test(r.error), `${label} → "prompt required"`);
}

// ── validateResearchPrompt: non-string truthy → 413 (never sneaks past as valid) ──
for (const [v, label] of [[{}, 'object'], [123, 'number'], [['x'], 'array'], [true, 'boolean true']]) {
  const r = validateResearchPrompt(v);
  eq(r.ok, false, `non-string ${label} → not ok`);
  eq(r.status, 413, `non-string ${label} → 413`);
}

// ── validateResearchPrompt: oversized string → 413 ──
{
  const over = 'a'.repeat(MAX_RESEARCH_PROMPT + 1);
  const r = validateResearchPrompt(over);
  eq(r.ok, false, 'max+1 chars → not ok');
  eq(r.status, 413, 'max+1 chars → 413');
  ok(/max 5000/.test(r.error), 'oversize error names the limit');
}

// ── Boundary: exactly max is allowed, max-1 allowed, a normal prompt allowed ──
{
  const atMax = 'a'.repeat(MAX_RESEARCH_PROMPT);
  eq(validateResearchPrompt(atMax).ok, true, 'exactly max chars → ok (off-by-one guard)');
  eq(validateResearchPrompt('a'.repeat(MAX_RESEARCH_PROMPT - 1)).ok, true, 'max-1 chars → ok');
  const r = validateResearchPrompt('what are the geopolitics of Taiwan?');
  eq(r.ok, true, 'normal prompt → ok');
  eq(r.status, undefined, 'ok result carries no status');
}

// ── Custom max arg is honored (siblings can pass their own, e.g. research-claude 5000) ──
{
  eq(validateResearchPrompt('abcd', 3).ok, false, 'len 4 over custom max 3 → not ok');
  eq(validateResearchPrompt('abcd', 3).status, 413, 'custom over-cap → 413');
  eq(validateResearchPrompt('abc', 3).ok, true, 'len 3 at custom max 3 → ok');
}

// ── resolveResearchModel: allow-listed passes; everything else coerces to cheap default ──
eq(resolveResearchModel('o4-mini-deep-research'), 'o4-mini-deep-research', 'allow-listed model passes through');
eq(resolveResearchModel('o3-deep-research'), DEFAULT_RESEARCH_MODEL, 'expensive o3 tier coerced to cheap default');
eq(resolveResearchModel('gpt-4o'), DEFAULT_RESEARCH_MODEL, 'unknown model coerced to cheap default');
eq(resolveResearchModel(undefined), DEFAULT_RESEARCH_MODEL, 'no model (UI default) → cheap default');
eq(resolveResearchModel(null), DEFAULT_RESEARCH_MODEL, 'null model → cheap default');
eq(resolveResearchModel(''), DEFAULT_RESEARCH_MODEL, 'empty model → cheap default');
eq(resolveResearchModel({ model: 'o4-mini-deep-research' }), DEFAULT_RESEARCH_MODEL, 'object (not a string) → cheap default');
eq(resolveResearchModel('O4-MINI-DEEP-RESEARCH'), DEFAULT_RESEARCH_MODEL, 'case-mismatch is NOT allow-listed → cheap default');

console.log(`\nresearch-input: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
