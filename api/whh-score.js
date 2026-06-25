import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

// Cache schema version. Bump this string to invalidate all cached scores
// (e.g. when the system prompt below changes in a way that should re-score).
const SCORE_PROMPT_VERSION = 'v1-2026-06-06';

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.QSS_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.QSS_SUPABASE_SERVICE_KEY ||
  '';

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Derive the cache key for a score request.
//
// CRITICAL: the key folds in the FULL system prompt, not just the manually-bumped
// SCORE_PROMPT_VERSION string. The version string is now a belt-and-suspenders
// manual override; the real invalidation is automatic — any edit to the scoring
// doctrine (weights, hard rules, breakdown keys, the village-connection text)
// changes `systemPrompt` and therefore the key, so stale pre-edit scores can
// never be served. Before this, the key ignored the system prompt entirely and
// relied solely on a human remembering to bump the version on every prompt edit
// — one forgotten bump = silently wrong scores on a live house hunt.
//
// Separators are U+0000 (can't appear in the prompt/text) so the three fields
// can't bleed into each other and forge a collision.
export async function computeScoreCacheKey(promptVersion, systemPrompt, userMsg) {
  return sha256Hex(`${promptVersion}\u0000${systemPrompt}\u0000${userMsg}`);
}

// Deterministically enforce the documented HARD-RULE score caps.
//
// The system prompt instructs Claude to apply these caps "in your head", but
// LLMs are unreliable at arithmetic constraints — a model that scores
// villageConnectionFit at 35 yet returns total 80 silently violates Johnny's
// stated doctrine on a real-money house hunt. Enforce the caps in code so the
// contract holds regardless of the model's arithmetic. This only ever LOWERS a
// total that breaks a stated rule; it never invents or raises a score, and is
// byte-identical for any already-compliant payload.
//
//   - villageConnectionFit < 40  → total capped at 65
//   - schoolFit            < 30  → total capped at 55
//
// Each breakdown entry is { score, note }; a missing/non-numeric score skips its
// cap (conservative — never fabricates a cap from a bad field).
export function enforceScoreCaps(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const b = parsed.breakdown;
  if (!b || typeof b !== 'object') return parsed;
  if (typeof parsed.total !== 'number' || !Number.isFinite(parsed.total)) return parsed;

  const scoreOf = (k) =>
    b[k] && typeof b[k].score === 'number' && Number.isFinite(b[k].score)
      ? b[k].score
      : null;

  const village = scoreOf('villageConnectionFit');
  const school = scoreOf('schoolFit');

  let capped = parsed.total;
  if (village !== null && village < 40) capped = Math.min(capped, 65);
  if (school !== null && school < 30) capped = Math.min(capped, 55);

  if (capped === parsed.total) return parsed;
  return { ...parsed, total: capped };
}

async function readCache(cacheKey) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/whh_score_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=payload`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json',
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.payload || null;
  } catch {
    return null;
  }
}

async function writeCache(cacheKey, payload, pinAddress) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/whh_score_cache?on_conflict=cache_key`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        cache_key: cacheKey,
        payload,
        pin_address: pinAddress || null,
        model: 'claude-sonnet-4-6',
      }),
    });
  } catch {
    /* cache write best-effort */
  }
}

/**
 * Westchester House Hunter — per-home scoring against the family-criteria doctrine.
 *
 *   POST /api/whh-score
 *   body: { pin, familyCriteria, memory, allPinsCount }
 *
 * Returns:
 *   { total: 0-100,
 *     breakdown: { villageConnectionFit, schoolFit, henryFit, ollieFit, creativeClassFit, commuteFit, priceFit, lotFit },
 *     rationale: "2-3 sentence honest take", topStrength, topConcern }
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

  // Cache lookup — identical (system version + user message) deterministically
  // produces the same Claude response, so short-circuit if we've seen this exact
  // prompt before. ?force=1 in the query string bypasses the cache.
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const cacheKey = await computeScoreCacheKey(SCORE_PROMPT_VERSION, system, userMsg);
  if (!force) {
    const hit = await readCache(cacheKey);
    if (hit) {
      // Enforce hard-rule caps on read too — corrects any stale score cached
      // before this guard existed (or by a model that ignored the caps).
      const cappedHit = enforceScoreCaps(hit);
      return new Response(JSON.stringify({ ...cappedHit, _ts: Date.now(), _cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }
  }

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
  // Enforce the documented hard-rule caps deterministically before caching, so
  // the stored value (and every future cache hit) already honors the doctrine.
  parsed = enforceScoreCaps(parsed);
  // Best-effort cache write — don't block the response on it.
  writeCache(cacheKey, parsed, pin.address);
  return new Response(JSON.stringify({ ...parsed, _ts: Date.now(), _cached: false }), {
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
