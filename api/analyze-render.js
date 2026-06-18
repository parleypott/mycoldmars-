// ============================================================================
// /api/analyze-render.js
//
// The "drop a photo, get a to-scale plan" brain for the 35 Walden studio.
//
// POST { image, houseEN?, parcelEN? }  ->  { reply, elements:[...], view, debug }
//
// Pipeline:
//   1. PERCEPTION — Gemini 2.5 Flash (vision, JSON schema) looks at the dropped
//      render/photo as a surveyor: finds the HOUSE and its 4 ground corners,
//      then every landscape element's ground-footprint bbox — all in IMAGE
//      FRACTIONS (0..1). Vision is NEVER asked for feet.
//   2. METRIC GROUNDING — deterministic JS. We know the real house footprint in
//      EN feet (the rosetta stone, FIXED). We solve a planar HOMOGRAPHY mapping
//      the house's 4 image corners -> the house's 4 real EN corners, then push
//      every element's ground-contact point through it to land in EN feet. The
//      house + parcel never move; we fit the photo TO them.
//   3. ORIENTATION — a photo has no compass, so the image<->EN corner pairing is
//      ambiguous. We try all 8 rotations/flips, score each by how many elements
//      land inside the real parcel, and keep the best. Auto-resolves rotation.
//
// Output elements are { type, e, n, wFt, lFt, rot, confidence } in EN feet,
// matching the studio's element model. Everything is a best-guess the user
// drags to fix — so we bias toward plausible, in-bounds placements.
//
// Runtime: Node serverless. Mirrors api/walden-design.js conventions.
// ============================================================================

export const config = { runtime: 'nodejs', maxDuration: 300 };

// Pure geometry + metric-grounding core (planar homography, element grounding).
// Extracted to api/_lib/render-geometry.js so it can be unit-tested headlessly.
import { PALETTE, groundElements } from './_lib/render-geometry.js';
import { parseImageInput } from './_lib/walden-image-input.js';

const VISION_MODEL = 'gemini-2.5-flash';

// Defaults baked in so the endpoint works even if the client omits geometry.
const DEFAULT_HOUSE_EN = [[17,38.5],[-8.8,33.7],[-5.3,15.7],[-6.1,14],[-9.9,13.3],[-6.8,-9.2],[-13.3,-11.7],[-10.2,-27.3],[-3.2,-26.9],[-0.6,-41.9],[29.9,-36.4],[17.2,38.3]];
const DEFAULT_PARCEL_EN = [[73.9,30.7],[-37.9,92.6],[-39.6,88.5],[-82.2,-7.9],[-92.1,-36.4],[-119,-113],[-64.8,-125.4],[77.6,-24],[74.9,-19.3],[72.5,-13.8],[70.6,-8.1],[69.3,-2.3],[68.7,3.6],[68.6,9.6],[69.2,15.6],[70.4,21.4],[73.9,30.7]];

// ────────────────────────────────────────────────────────────────────────────
// Vision prompt + schema
// ────────────────────────────────────────────────────────────────────────────
const VISION_SYSTEM = `You are a land surveyor tracing a residential property from a single image (a render, a sketch, an aerial, or a photo of a backyard). Your job is to produce a precise visual inventory — you do NOT invent anything, you only report what is actually visible.

THE HOUSE IS YOUR ANCHOR. First, locate the main house/building. Report its 4 ground-level outer corners (where the walls meet the ground) as image fractions. Go in consistent order around the building. If the whole house isn't visible, give your best estimate of the 4 corners of its footprint — this is critical, everything else is measured against it.

Then inventory every LANDSCAPE element you can see on the ground, each as a ground-footprint bounding box (the patch of ground it covers, not its height) in image fractions:
- pool, spa (hot tub), deck (raised wood), patio (stone/pavers on grade), bed (planting bed/garden), hedge (clipped green wall/row), tree (canopy — box the canopy), firepit, path (walkway), wall (retaining/garden wall).
Map anything you see to the closest of those types. Skip the house itself, the lawn, fences, furniture, people, cars, sky.

ALL COORDINATES are image fractions: x from 0 (left) to 1 (right), y from 0 (top) to 1 (bottom). The bottom edge of each element's box should sit where it touches the ground.

Also report 'view': 'top_down' (plan/satellite straight down), 'aerial_oblique' (tilted bird's-eye), or 'eye_level' (ground photo).

Be thorough but honest. Only report elements you can actually see. Give a confidence 0..1 per element. Report the most significant elements, up to about 25 — prioritize big hardscape (pool, spa, patio, deck) and major plantings/trees over tiny repeated details. Keep the optional 'note' very short or omit it.`;

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    view: { type: 'string', enum: ['top_down', 'aerial_oblique', 'eye_level'] },
    house: {
      type: 'object',
      properties: {
        corners: {
          type: 'array',
          description: 'Exactly 4 outer ground corners of the house, in order around it.',
          items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
        },
        visible: { type: 'boolean' },
      },
      required: ['corners'],
    },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: PALETTE },
          x0: { type: 'number' }, y0: { type: 'number' },
          x1: { type: 'number' }, y1: { type: 'number' },
          confidence: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['type', 'x0', 'y0', 'x1', 'y1'],
      },
    },
    reply: { type: 'string', description: 'One or two warm sentences: what you found.' },
  },
  required: ['house', 'elements'],
};

// ────────────────────────────────────────────────────────────────────────────
// Vision call
// ────────────────────────────────────────────────────────────────────────────
async function callVision(image, apiKey) {
  const img = parseImageInput(image);
  if (!img) return { error: 'Missing or invalid `image` (expected a base64 data URL).' };
  if (img.dataBase64.length > 8 * 1024 * 1024 * 1.4) return { error: 'Image too large — keep it under ~8MB.' };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent`;
  const payload = {
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: img.mimeType, data: img.dataBase64 } },
      { text: 'Survey this property. Anchor on the house (4 ground corners), then inventory every landscape element as a ground-footprint bbox. Image fractions only.' },
    ] }],
    systemInstruction: { parts: [{ text: VISION_SYSTEM }] },
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: VISION_SCHEMA, maxOutputTokens: 12000 },
  };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const quota = t.includes('RESOURCE_EXHAUSTED');
    return { error: quota ? 'Gemini quota exhausted — wait a minute.' : `Gemini ${res.status}: ${t.slice(0, 300)}` };
  }
  const data = await res.json().catch(() => null);
  const cand = data?.candidates?.[0];
  const txt = cand?.content?.parts?.map((p) => p.text || '').join('') || '';
  const finish = cand?.finishReason || '';
  if (!txt) return { error: `Vision returned nothing${finish ? ' (' + finish + ')' : ''}.` };
  const vision = parseVisionTolerant(txt);
  if (!vision) return { error: `Vision returned unrecoverable JSON (${finish || 'parse fail'}).` };
  vision._finish = finish;
  return { vision };
}

// Tolerant parse: handles markdown fences AND truncated responses (MAX_TOKENS)
// by salvaging the house anchor + every complete element object.
function parseVisionTolerant(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(s); } catch (_) { /* fall through to salvage */ }
  const out = { house: { corners: [] }, elements: [], reply: '' };
  // house corners — first "corners":[ ... ]
  const hm = s.match(/"corners"\s*:\s*\[([\s\S]*?)\]/);
  if (hm) {
    const cs = [...hm[1].matchAll(/\{[^{}]*?"x"\s*:\s*(-?[\d.]+)[^{}]*?"y"\s*:\s*(-?[\d.]+)[^{}]*?\}/g)];
    out.house.corners = cs.map((m) => ({ x: +m[1], y: +m[2] }));
  }
  // every flat object that has an x0 + a type → an element (no nesting, so [^{}] is safe)
  const objs = [...s.matchAll(/\{[^{}]*\}/g)];
  for (const m of objs) {
    if (!/"x0"/.test(m[0]) || !/"type"/.test(m[0])) continue;
    try { out.elements.push(JSON.parse(m[0])); } catch (_) { /* skip partial */ }
  }
  const vm = s.match(/"view"\s*:\s*"([a-z_]+)"/); if (vm) out.view = vm[1];
  const rm = s.match(/"reply"\s*:\s*"([^"]*)"/); if (rm) out.reply = rm[1];
  return (out.house.corners.length >= 3 || out.elements.length) ? out : null;
}

// parseImageInput lives in api/_lib/walden-image-input.js (single source of
// truth) — it normalizes "image/jpg" to the canonical "image/jpeg" Gemini
// accepts, so a JPEG pasted as data:image/jpg;base64,... no longer 400s the
// whole vision survey.

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────
async function handle(body, apiKey) {
  const houseEN = Array.isArray(body.houseEN) && body.houseEN.length >= 4 ? body.houseEN : DEFAULT_HOUSE_EN;
  const parcelEN = Array.isArray(body.parcelEN) && body.parcelEN.length >= 4 ? body.parcelEN : DEFAULT_PARCEL_EN;

  const v = await callVision(body.image, apiKey);
  if (v.error) return jsonError(502, v.error);

  const { elements, note } = groundElements(v.vision, houseEN, parcelEN);
  const visionReply = (v.vision.reply || '').toString().trim();
  const view = v.vision.view || 'unknown';
  const lowConf = elements.filter((e) => (e.confidence || 0) < 0.5).length;

  let reply = visionReply || `Traced ${elements.length} element${elements.length === 1 ? '' : 's'} onto your lot.`;
  if (view === 'eye_level') reply += ' (Ground-level photo — placements are rough; drag to fix.)';
  else if (lowConf) reply += ` ${lowConf} are low-confidence guesses — drag them where they belong.`;

  return jsonResponse({ reply, elements, view, note, model: VISION_MODEL });
}

// ────────────────────────────────────────────────────────────────────────────
// Response plumbing (permissive CORS — personal tool)
// ────────────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
function jsonResponse(p, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(status, message) { return jsonResponse({ error: message }, status); }

async function innerHandler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonError(405, 'Use POST');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError(500, 'GEMINI_API_KEY not configured');
  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  return handle(body, apiKey);
}

// Vercel Node adapter (matches walden-design.js)
async function buildWebRequest(req) {
  const headers = new Headers();
  for (const [k, val] of Object.entries(req.headers || {})) {
    if (val == null) continue;
    headers.set(k, Array.isArray(val) ? val.join(', ') : String(val));
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const url = `${proto}://${host}${req.url || '/'}`;
  let body;
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined && req.body !== null) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    else body = await new Promise((resolve, reject) => { let buf = ''; req.on('data', (c) => { buf += c; }); req.on('end', () => resolve(buf)); req.on('error', reject); });
  }
  return new Request(url, { method, headers, body: body || undefined });
}
async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  for (const [k, val] of response.headers) res.setHeader(k, val);
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}
export default async function handler(req, res) {
  if (res !== undefined) {
    try {
      const webReq = await buildWebRequest(req);
      const response = await innerHandler(webReq);
      await sendWebResponse(res, response);
    } catch (e) {
      console.error('[analyze-render]', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ error: 'INTERNAL', message: (e && e.message) || String(e) }));
    }
    return;
  }
  return innerHandler(req);
}
