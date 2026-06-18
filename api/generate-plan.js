// ============================================================================
// /api/generate-plan.js
//
// The "drop a photo, get a beautiful plan fitted to YOUR lot" engine.
//
// POST { photo, boundary, context? }  ->  { image, mimeType, model }
//
//   photo    = the inspiration image (a backyard render/photo of the design)
//   boundary = a to-scale image of the REAL property outline (the lot polygon,
//              + house footprint), drawn at the homeowner's chosen orientation.
//              This is the canvas the plan must fit inside.
//   context  = short facts string (lot dimensions, orientation note).
//
// Unlike analyze-render.js (which tried to EXTRACT vector geometry and failed on
// oblique photos), this generates an IMAGE — a top-down landscape master plan in
// the clean professional site-plan tradition — and constrains it to the real lot
// boundary we hand it. Gemini 2.5 Flash Image (Nano Banana), two reference images.
//
// Runtime: Node serverless. Mirrors api/walden-design.js conventions.
// ============================================================================

import { parseImageInput } from './_lib/walden-image-input.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const IMAGE_MODEL = 'gemini-2.5-flash-image';

const GENPLAN_PROMPT = `You are a landscape architect producing a clean, professional TOP-DOWN SITE PLAN (a measured master plan), in the tradition of a residential landscape construction document — the kind with a soft sage-and-cream palette, simple paver/stone textures, a blue swimming pool, neat circular plant symbols, retaining-wall lines, dimension callouts, and a tidy planting key.

You are given TWO images:
  • IMAGE 1 — THE REAL PROPERTY BOUNDARY. This is the homeowner's actual lot, drawn to scale at the correct orientation, with the house footprint shown. This is GROUND TRUTH and a hard constraint.
  • IMAGE 2 — THE DESIGN INSPIRATION. A photo/render of the backyard design to translate: its pool, spa/hot tub, paved patios, deck, fire-pit area, retaining-wall terraces, and plantings.

═══ THE ONE ABSOLUTE RULE ═══
The plan you draw MUST FIT ENTIRELY INSIDE the real property boundary from IMAGE 1 — matching its exact polygon shape, proportions, and orientation. Keep the property line as the outer edge of the drawing. Keep the house footprint where IMAGE 1 shows it. Lay the backyard design out in the open yard area, nicely composed within the real lot — not spilling past the boundary, not floating in a generic rectangle. If the design from IMAGE 2 is larger than the real yard, scale it down to fit gracefully and keep sensible setbacks from the property line.

═══ WHAT TO DRAW (translate IMAGE 2 into plan view) ═══
A top-down orthographic landscape plan: the swimming pool (rectangular, label its size if reasonable), the spa/hot tub, the stone/paver patio and steps, the upper deck off the house, the gravel fire-pit seating area, the terraced retaining walls (mark "R.W."), and the planting beds/trees/hedges as clean circular plant symbols. Include a small PLANTING KEY box and a dimension line along the bottom showing the lot width. Label major elements simply (POOL, SPA / HOT TUB, UPPER DECK, FIRE PIT, HOUSE).

═══ STYLE ═══
Flat top-down orthographic (no perspective, no 3D, no sky). Light, airy, professional — cream/ivory background, soft greens for planting, warm grey stone, calm blue water, thin confident linework. Clean and legible, like a real landscape architect's presentation sheet. No watercolor looseness — keep it crisp and measured. Orientation matches IMAGE 1 exactly. Do not add a title block logo or signature.`;

async function handleGenPlan(body, apiKey) {
  const photo = parseImageInput(body.photo || body.image);
  const boundary = parseImageInput(body.boundary);
  if (!photo) return jsonError(400, 'Missing `photo` (the design inspiration image).');
  if (!boundary) return jsonError(400, 'Missing `boundary` (the real lot outline image).');
  const MAX = 8 * 1024 * 1024 * 1.4;
  if (photo.dataBase64.length > MAX || boundary.dataBase64.length > MAX) return jsonError(413, 'Image too large — keep under ~8MB.');

  const context = (body.context || '').toString().trim();
  let prompt = GENPLAN_PROMPT;
  if (context) prompt += `\n\nSITE FACTS (use, do not draw as a paragraph): ${context}`;

  const parts = [
    { text: 'IMAGE 1 — REAL PROPERTY BOUNDARY (fit the plan inside this exact shape):' },
    { inlineData: { mimeType: boundary.mimeType, data: boundary.dataBase64 } },
    { text: 'IMAGE 2 — DESIGN INSPIRATION (translate this into the top-down plan):' },
    { inlineData: { mimeType: photo.mimeType, data: photo.dataBase64 } },
    { text: prompt },
  ];

  const result = await callImageGemini(parts, apiKey);
  if (!result.ok) return jsonError(result.status || 502, result.error);
  return jsonResponse({ image: result.image.dataBase64, mimeType: result.image.mimeType, model: IMAGE_MODEL, ms: result.ms });
}

async function callImageGemini(parts, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Gemini fetch threw: ${err.message}`, ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const quota = t.includes('RESOURCE_EXHAUSTED');
    return { ok: false, status: quota ? 429 : res.status, error: quota ? 'Gemini quota exhausted — wait a minute.' : `Gemini ${res.status}: ${t.slice(0, 400)}`, ms };
  }
  const data = await res.json().catch(() => null);
  let image = null, text = '';
  for (const c of (data?.candidates || [])) {
    for (const p of (c?.content?.parts || [])) {
      if (p.inlineData?.data && !image) image = { mimeType: p.inlineData.mimeType || 'image/png', dataBase64: p.inlineData.data };
      else if (p.text) text += p.text;
    }
  }
  if (!image) return { ok: false, status: 502, error: `Gemini returned no image${text ? ': ' + text.slice(0, 200) : ''}`, ms };
  return { ok: true, image, ms };
}

// parseImageInput lives in api/_lib/walden-image-input.js (single source of
// truth) — it normalizes the "image/jpg" spelling to the canonical
// "image/jpeg" Gemini accepts, so a JPEG reference pasted as
// data:image/jpg;base64,... no longer 400s the whole plan generation.

// ── response plumbing (permissive CORS — personal tool) ──
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
function jsonResponse(p, status = 200) { return new Response(JSON.stringify(p), { status, headers: { 'Content-Type': 'application/json', ...CORS } }); }
function jsonError(status, message) { return jsonResponse({ error: message }, status); }

async function innerHandler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return jsonError(405, 'Use POST');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError(500, 'GEMINI_API_KEY not configured');
  let body;
  try { body = await req.json(); } catch { return jsonError(400, 'Invalid JSON body'); }
  return handleGenPlan(body, apiKey);
}

async function buildWebRequest(req) {
  const headers = new Headers();
  for (const [k, val] of Object.entries(req.headers || {})) { if (val == null) continue; headers.set(k, Array.isArray(val) ? val.join(', ') : String(val)); }
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
    try { const webReq = await buildWebRequest(req); const response = await innerHandler(webReq); await sendWebResponse(res, response); }
    catch (e) { console.error('[generate-plan]', e); res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.end(JSON.stringify({ error: 'INTERNAL', message: (e && e.message) || String(e) })); }
    return;
  }
  return innerHandler(req);
}
