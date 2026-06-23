// Cost guard for the PUBLIC, unauthenticated research-* endpoints.
//
// Each research-* handler runs an expensive deep-research model on EVERY POST
// with NO auth gate (grep: none of api/research-*.js call checkAccess). So an
// unbounded prompt is a real billing vector: a single megabyte prompt to a
// deep-research model costs real money, repeatedly. research-claude (5000) and
// research-clarify (3000) already cap their prompts; research-gemini and
// research-openai-start did NOT. This is the shared cap for the two that were
// missing it — the report endpoints, so they share research-claude's 5000.

export const MAX_RESEARCH_PROMPT = 5000;

// → { ok:true } | { ok:false, status, error }. Mirrors the inline checks the
// two capped siblings already use (empty → 400, oversized/non-string → 413).
export function validateResearchPrompt(prompt, max = MAX_RESEARCH_PROMPT) {
  if (!prompt) return { ok: false, status: 400, error: 'prompt required' };
  if (typeof prompt !== 'string' || prompt.length > max) {
    return { ok: false, status: 413, error: `prompt too long (max ${max} chars)` };
  }
  return { ok: true };
}

// research-openai-start additionally accepts a client-supplied `model` and
// passed it STRAIGHT to OpenAI's Responses API. On a public endpoint that lets
// any caller force the far pricier o3-deep-research instead of the cheap
// o4-mini the UI actually uses. Only allow-listed models are honored; anything
// else (unknown, or the expensive tier) coerces to the cheap default. The UI
// sends no model today, so this is byte-identical for the real path. Extend
// ALLOWED_RESEARCH_MODELS deliberately if a model picker is ever added.
export const DEFAULT_RESEARCH_MODEL = 'o4-mini-deep-research';
export const ALLOWED_RESEARCH_MODELS = ['o4-mini-deep-research'];

export function resolveResearchModel(model) {
  return ALLOWED_RESEARCH_MODELS.includes(model) ? model : DEFAULT_RESEARCH_MODEL;
}
