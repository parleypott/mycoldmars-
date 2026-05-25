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

THE TOP-LINE DOCTRINE (read this before scoring anything):
The family has clarified — as of 2026-05-25 — that CONNECTION TO THE VILLAGE is the single most important thing about this move. They want a home where you can walk or bike to town on safe streets, walk to a trail from the door, and drive to the train in under 8 minutes (ideally walk to it). They are EXPLICITLY willing to trade lot size, square footage, and budget headroom to get this. A 0.4-acre home two blocks from the village green beats a 2-acre estate at the end of a shoulderless 35mph county road. This now outweighs everything except Henry's school fit.

Your job: read the family criteria doctrine + the pin data + saved memory items, then output STRICT JSON with a 0-100 total score and a per-criterion breakdown.

OUTPUT FORMAT (strict JSON, no markdown, no commentary):
{
  "total": <0-100 integer>,
  "breakdown": {
    "villageConnectionFit": { "score": <0-100>, "note": "<one sentence covering walkability + bikeability + train drive-time + trail walk-access for THIS address>" },
    "schoolFit": { "score": <0-100>, "note": "<one short sentence on the district fit, especially for Henry>" },
    "henryFit": { "score": <0-100>, "note": "<sensory + autism-support fit, one sentence — noise, busy roads, calm vs overwhelming environment>" },
    "ollieFit": { "score": <0-100>, "note": "<elementary/middle fit for neurotypical 9yo: choir/sports/STEM, one sentence>" },
    "creativeClassFit": { "score": <0-100>, "note": "<does this neighborhood feel right for a creative-professional family with a public-figure spouse, one sentence>" },
    "commuteFit": { "score": <0-100>, "note": "<NYC train time itself (separate from drive-to-station), one sentence>" },
    "priceFit": { "score": <0-100>, "note": "<value vs family budget envelope, one sentence>" },
    "lotFit": { "score": <0-100>, "note": "<lot size for ADU/pool/fenced area — but REMEMBER the family deprioritized this on 2026-05-25; a small village lot is fine if connection is great, one sentence>" }
  },
  "rationale": "<2-3 sentence honest top-line: what's strongest, what's the load-bearing concern. LEAD with connection-to-village assessment.>",
  "topStrength": "<single phrase>",
  "topConcern": "<single phrase>"
}

Scoring discipline:
- 90+ = exceptional fit. Reserve for truly great matches that nail village connection AND school.
- 75-89 = strong fit, minor concerns
- 60-74 = workable, real trade-offs
- 45-59 = significant concerns (often: connection failure even when other things are strong)
- <45 = bad fit, structural problem

WEIGHTING (apply these in your head when computing total — do not output the math):
- villageConnectionFit: 27% — THE HEADLINE
- schoolFit + henryFit + ollieFit combined: 31%
- creativeClassFit: 10%
- commuteFit (train itself): 5%
- priceFit: variable but capped at ~10% influence
- lotFit: only ~2% — almost never load-bearing now
- Other minor factors fold into rationale

HARD RULES:
- If villageConnectionFit < 40 → cap total at 65 regardless of other scores. The home is "disconnected" — flag this in topConcern.
- If schoolFit < 30 → cap total at 55. Henry's school must work.
- If creativeClassFit ≤ 20 → flag in topConcern even if total is high (cultural mismatch like Scarsdale/Bronxville).

DATA INTERPRETATION:
- pin.train.walkMin tells you walk time from home to nearest station. If under 12, that's a 5/5 connection-train-leg. If over 30, suggests driving — estimate drive time as miles * ~1.8 (suburban speeds) or use 5 min if no specific info.
- pin.train.miles is the straight-line / driving miles to the station.
- pin.trail tells you nearest named trail and miles.
- pin.address — use your knowledge of Westchester villages to estimate walk-to-village. Pleasantville center, Irvington Main St, Hastings village, Croton upper village, Chappaqua Hamlet, Bedford Village, etc. each have distinct walkability patterns. Streets like North/South/Wood Lane in Bedford = rural, no sidewalks. Streets near "Center" or "Memorial Plaza" or numbered Main blocks = village core.
- pin.compass.description sometimes mentions "walk to train" or "stroll to village" — weight those.
- If schoolDistrict is missing, schoolFit gets a low score (~40).
- If price is missing, treat asking price as price. If both missing, priceFit = null.

Be honest, not generous. Do NOT output anything except the JSON object.`;

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
