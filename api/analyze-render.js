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

const VISION_MODEL = 'gemini-2.5-flash';

const PALETTE = ['pool', 'spa', 'deck', 'patio', 'bed', 'hedge', 'tree', 'firepit', 'path', 'wall'];

// House wall bearing in the EN frame (degrees). The footprint is rotated this
// much off the EN axes; used to build the house's ORIENTED bounding rectangle.
const WALL_BEARING = -9.55;

// Defaults baked in so the endpoint works even if the client omits geometry.
const DEFAULT_HOUSE_EN = [[17,38.5],[-8.8,33.7],[-5.3,15.7],[-6.1,14],[-9.9,13.3],[-6.8,-9.2],[-13.3,-11.7],[-10.2,-27.3],[-3.2,-26.9],[-0.6,-41.9],[29.9,-36.4],[17.2,38.3]];
const DEFAULT_PARCEL_EN = [[73.9,30.7],[-37.9,92.6],[-39.6,88.5],[-82.2,-7.9],[-92.1,-36.4],[-119,-113],[-64.8,-125.4],[77.6,-24],[74.9,-19.3],[72.5,-13.8],[70.6,-8.1],[69.3,-2.3],[68.7,3.6],[68.6,9.6],[69.2,15.6],[70.4,21.4],[73.9,30.7]];

// Standard sizes we snap pools/spas toward (feet). Marked assumed:true.
const SNAP = {
  pool: [[12,24],[14,28],[16,32],[16,36],[18,40],[20,40]],
  spa: [[7,7],[8,8]],
};

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

Be thorough but honest. Only report elements you can actually see. Give a confidence 0..1 per element.`;

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
// Geometry — planar homography (DLT, exactly 4 points) + helpers
// ────────────────────────────────────────────────────────────────────────────

// Solve A x = b for an 8x8 system via Gaussian elimination with partial pivot.
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null; // singular
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Homography mapping 4 source points -> 4 destination points.
// Returns 3x3 matrix (h[8]=1) or null.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solve8(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function applyH(H, p) {
  const [x, y] = p;
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-9) return null;
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

function rot2(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }

// The house's oriented bounding rectangle in EN feet -> 4 corners (CW), built
// by aligning the footprint to its wall bearing.
function houseOrientedQuad(houseEN) {
  const a = -WALL_BEARING * Math.PI / 180;
  const aligned = houseEN.map((p) => rot2(p, a));
  const xs = aligned.map((p) => p[0]), ys = aligned.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const cornersAligned = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]];
  return cornersAligned.map((p) => rot2(p, -a)); // back to EN
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// ────────────────────────────────────────────────────────────────────────────
// Grounding — turn the vision result into EN-feet elements
// ────────────────────────────────────────────────────────────────────────────
function groundElements(vision, houseEN, parcelEN) {
  const imgCorners = (vision.house?.corners || []).slice(0, 4).map((c) => [clamp01(c.x), clamp01(c.y)]);
  if (imgCorners.length < 4) return { elements: [], note: 'no-house-anchor' };

  const houseQuad = houseOrientedQuad(houseEN); // 4 EN corners, CW
  const els = (vision.elements || []).filter((e) => PALETTE.includes(e.type));

  // Try 8 correspondences (4 rotations x 2 windings). Score by parcel containment.
  const rotations = [[0, 1, 2, 3], [1, 2, 3, 0], [2, 3, 0, 1], [3, 0, 1, 2]];
  let best = null;
  for (const flip of [false, true]) {
    const baseQuad = flip ? [houseQuad[0], houseQuad[3], houseQuad[2], houseQuad[1]] : houseQuad;
    for (const order of rotations) {
      const dst = order.map((i) => baseQuad[i]);
      const H = homography(imgCorners, dst);
      if (!H) continue;
      const placed = els.map((e) => groundOne(H, e)).filter(Boolean);
      // score: elements inside parcel, minus wild sizes
      let score = 0;
      for (const p of placed) {
        if (pointInPoly([p.e, p.n], parcelEN)) score += 2; else score -= 1;
        if (p.wFt > 4 && p.wFt < 90 && p.lFt > 4 && p.lFt < 120) score += 0.5; // plausible footprint
      }
      if (!best || score > best.score) best = { H, score, placed };
    }
  }
  if (!best) return { elements: [], note: 'homography-failed' };
  return { elements: best.placed, note: `oriented (score ${best.score.toFixed(1)})` };
}

// One element's image bbox -> EN center/size via the homography.
function groundOne(H, e) {
  const x0 = clamp01(e.x0), y0 = clamp01(e.y0), x1 = clamp01(e.x1), y1 = clamp01(e.y1);
  const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bot = Math.max(y0, y1);
  // ground-contact: project the 4 bottom-ish corners; trees/firepits use full box
  const gp = (e.type === 'tree' || e.type === 'firepit')
    ? { bl: [left, (top + bot) / 2], br: [right, (top + bot) / 2], tl: [left, top], br2: [right, bot] }
    : { bl: [left, bot], br: [right, bot], tl: [left, top], br2: [right, bot] };
  const BL = applyH(H, [left, bot]), BR = applyH(H, [right, bot]), TL = applyH(H, [left, top]), TR = applyH(H, [right, top]);
  if (!BL || !BR || !TL || !TR) return null;
  const center = [(BL[0] + BR[0] + TL[0] + TR[0]) / 4, (BL[1] + BR[1] + TL[1] + TR[1]) / 4];
  let wFt = (dist(BL, BR) + dist(TL, TR)) / 2;
  let lFt = (dist(BL, TL) + dist(BR, TR)) / 2;
  // rotation of the bottom edge relative to EN east
  let rot = Math.atan2(BR[1] - BL[1], BR[0] - BL[0]) * 180 / Math.PI;
  if (!isFinite(wFt) || !isFinite(lFt)) return null;
  wFt = Math.max(2, Math.min(120, wFt));
  lFt = Math.max(2, Math.min(140, lFt));
  let assumed = false;
  if (SNAP[e.type]) {
    const target = nearestSnap(SNAP[e.type], wFt, lFt);
    if (target) { wFt = target[0]; lFt = target[1]; assumed = true; }
  }
  if (e.type === 'tree') { const d = (wFt + lFt) / 2; wFt = d; lFt = d; }
  return {
    type: e.type,
    e: round1(center[0]), n: round1(center[1]),
    wFt: round1(wFt), lFt: round1(lFt),
    rot: Math.round(((rot % 360) + 360) % 360),
    confidence: typeof e.confidence === 'number' ? e.confidence : 0.5,
    assumed,
  };
}

function nearestSnap(list, w, l) {
  const big = Math.max(w, l), small = Math.min(w, l);
  let best = null, bestd = Infinity;
  for (const [a, b] of list) {
    const d = Math.abs(b - big) + Math.abs(a - small);
    if (d < bestd) { bestd = d; best = [a, b]; }
  }
  return best;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const round1 = (v) => Math.round(v * 10) / 10;

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
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: VISION_SCHEMA, maxOutputTokens: 4000 },
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
  const txt = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!txt) return { error: 'Vision returned nothing.' };
  try { return { vision: JSON.parse(txt) }; }
  catch { return { error: 'Vision returned malformed JSON.' }; }
}

function parseImageInput(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(s);
  if (m) return { mimeType: m[1].toLowerCase(), dataBase64: m[2] };
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 32) return { mimeType: 'image/png', dataBase64: s.replace(/\s/g, '') };
  return null;
}

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
