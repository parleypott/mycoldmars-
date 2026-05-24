import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

/**
 * Westchester House Hunter — per-home scoring against the family-criteria doctrine.
 *
 *   POST /api/whh-score
 *   body: { pin, familyCriteria, memory, allPinsCount }
 *
 * Returns:
 *   { total: 0-100,
 *     breakdown: { schoolFit, commuteFit, priceFit, sensoryFit, creativeClassFit, henryFit, ollieFit, neighborhoodFit, valueFit },
 *     rationale: "2-3 sentence honest take" }
 *
 * Calls Claude Sonnet 4.6 with the family doctrine + school profile + pin data,
 * gets back strict JSON. Cached client-side on pin.score.
 */

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed', 'POST only');
  const denied = await checkAccess(req);
  if (denied) return denied;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonError(500, 'misconfigured', 'ANTHROPIC_API_KEY missing');

  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'bad_body', 'invalid JSON'); }
  const { pin, familyCriteria, memory } = body || {};
  if (!pin || !pin.address) return jsonError(400, 'missing_pin', 'pin with address required');

  const system = `You are scoring a single home for Johnny Harris's family house hunt in Westchester, NY. The family: Johnny (filmmaker, creative-professional), spouse, Henry (13yo autistic 2e), Ollie (9yo neurotypical), Remi (Brittany spaniel). They're moving from Falls Church, VA to the NYC metro.

Your job: read the family criteria doctrine + the pin data + saved memory items, then output STRICT JSON with a 0-100 total score and a per-criterion breakdown.

OUTPUT FORMAT (strict JSON, no markdown, no commentary):
{
  "total": <0-100 integer>,
  "breakdown": {
    "schoolFit": { "score": <0-100>, "note": "<one short sentence>" },
    "henryFit": { "score": <0-100>, "note": "<sensory + autism-support fit, one sentence>" },
    "ollieFit": { "score": <0-100>, "note": "<elementary/middle fit for neurotypical 9yo, one sentence>" },
    "commuteFit": { "score": <0-100>, "note": "<NYC commute viability, one sentence>" },
    "priceFit": { "score": <0-100>, "note": "<value vs family budget envelope, one sentence>" },
    "sensoryFit": { "score": <0-100>, "note": "<noise / busy roads / Henry-sensitive factors, one sentence>" },
    "creativeClassFit": { "score": <0-100>, "note": "<does this neighborhood feel right for a creative family, one sentence>" },
    "valueFit": { "score": <0-100>, "note": "<bang for buck vs comparable homes in dataset, one sentence>" }
  },
  "rationale": "<2-3 sentence honest top-line: what's strongest, what's the load-bearing concern>",
  "topStrength": "<single phrase>",
  "topConcern": "<single phrase>"
}

Scoring discipline:
- 90+ = exceptional fit. Reserve for truly great matches.
- 75-89 = strong fit, minor concerns
- 60-74 = workable, real trade-offs
- 45-59 = significant concerns
- <45 = bad fit, structural problem

Be honest, not generous. If schoolDistrict is missing, schoolFit gets a low score (~40). If price is missing, treat asking price as price. If both missing, priceFit = null and total reflects uncertainty.

Weight schoolFit and henryFit heaviest (per the doctrine). Commute matters but is partly fixable. Price matters but is partly negotiable.

Do NOT output anything except the JSON object.`;

  const userMsg = `FAMILY CRITERIA DOCTRINE:
${familyCriteria || '(not provided — use general best-fit reasoning for a creative-professional family with autistic teen + neurotypical 9yo)'}

SAVED MEMORY (preferences/considerations Johnny has flagged):
${memory && memory.length ? memory.map((m, i) => `${i+1}. ${m.text || m}`).join('\n') : '(none yet)'}

HOME TO SCORE:
${JSON.stringify(pin, null, 0)}

Score this home now. Output the JSON object and nothing else.`;

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
  } catch (err) {
    return jsonError(502, 'anthropic_unreachable', err?.message || String(err));
  }
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    return jsonError(response.status, 'anthropic_error', txt.slice(0, 400));
  }
  const data = await response.json();
  const raw = data?.content?.[0]?.text || '';
  // Strip any ```json fences if Claude wrapped (shouldn't, but defensive)
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { return jsonError(502, 'parse_failed', 'Claude returned non-JSON: ' + cleaned.slice(0, 200)); }
  return new Response(JSON.stringify({ ...parsed, _ts: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
  });
}

function jsonError(status, error, message) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
