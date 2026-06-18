// Pure cores for the QSS "Let's touch base" story-guide endpoint
// (api/qss-touch-base.js). Extracted verbatim so they can be unit-tested
// headlessly and mutation-locked. No behavior change — the handler imports
// these and the live request path is identical.
//
// Two responsibilities live here:
//   1. PROMPT CONTEXT builders — buildTrimmedBlocks + buildSpine turn the
//      story's blocks into the two views the model reads (the full-text
//      view for tone/voice, and the numbered spine Henry sees on screen).
//   2. RESPONSE normalizer — normalizeTouchBase is the load-bearing guarantee
//      that the client never has to guard for missing fields. It clamps,
//      validates, and shapes whatever the model returned into a safe object.

const ALLOWED_STATUS = new Set(['present', 'partial', 'missing']);

// Full text of each block, led by its "what happens" summary when the
// client provided one. Each block text capped at 800 chars; the whole view
// capped at 30k so the prompt can't blow up.
export function buildTrimmedBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list
    .map((b, i) => {
      const text = String(b?.text || '').slice(0, 800);
      const summary = String(b?.summary || '').trim();
      const head = summary ? `Block ${i + 1} (what happens: ${summary})` : `Block ${i + 1}`;
      return `${head}: ${text}`;
    })
    .join('\n\n')
    .slice(0, 30_000);
}

// The spine-only view — a clean numbered list of each block's summary, in
// order. This is the structure Henry sees in the story panel. Capped 4k.
export function buildSpine(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return list
    .map((b, i) => `${i + 1}. ${String(b?.summary || '').trim() || '(no summary yet)'}`)
    .join('\n')
    .slice(0, 4_000);
}

// Normalize / validate the model's reply so the client never has to guard
// for missing fields. Returns { summary, concern, ingredients, suggestions }.
export function normalizeTouchBase(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};

  const ingredients = Array.isArray(p.ingredients) ? p.ingredients : [];
  const safeIngredients = ingredients
    .filter(i => i && typeof i === 'object')
    .map(i => ({
      key: String(i.key || '').slice(0, 32),
      name: String(i.name || '').slice(0, 80),
      status: ALLOWED_STATUS.has(i.status) ? i.status : 'partial',
      note: String(i.note || '').slice(0, 200),
    }))
    .slice(0, 12);

  const suggestions = Array.isArray(p.suggestions) ? p.suggestions : [];
  const safeSuggestions = suggestions
    .filter(s => typeof s === 'string' && s.trim())
    .map(s => s.trim().slice(0, 300))
    .slice(0, 4);

  const summary = String(p.summary || '').slice(0, 1200);
  const concern = (typeof p.concern === 'string' && p.concern.trim())
    ? p.concern.trim().slice(0, 400)
    : null;

  return { summary, concern, ingredients: safeIngredients, suggestions: safeSuggestions };
}
