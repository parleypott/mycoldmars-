// ============================================================================
// /api/walden-design.js
//
// Backend for the 35 Walden Road landscape-design studio tool. Two modes:
//
//   mode:'chat'   → landscape-design collaborator. Gemini text model with
//                   FUNCTION CALLING (tool declarations) returns structured
//                   design operations the front-end applies to the plan.
//                   Returns { reply, ops }.
//
//   mode:'render' → watercolor masterplan renderer. Gemini 2.5 Flash Image
//                   (Nano Banana) takes the current plan image as a reference
//                   and restyles it as a loose, atmospheric presentation board
//                   WITHOUT moving the geometry. Returns { image, model }.
//
// The site geometry (property line, setbacks, house footprint) is real-feet
// truth handled client-side. The AI reasons in the LOCAL SITE FRAME (feet,
// rotated by gridBearing so axis-aligned == squared-to-house). It NEVER
// touches lng/lat — it only emits {cx,cy,wFt,lFt,rot} ops, and the render
// layer only restyles, never relocates.
//
// Runtime: Node serverless (image gen needs to run past the edge cap).
// Pattern matched from ~/playground/mycoldmars/api/nano-banana.js.
// ============================================================================

export const config = { runtime: 'nodejs', maxDuration: 300 };

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// Element vocabulary the model is allowed to place. Keep this in sync with
// the front-end palette. type = primitive shape family; kind = sub-style.
const ELEMENT_TYPES = {
  pool: ['rect', 'oval'],
  spa: ['rect', 'oval'],
  deck: ['rect', 'polygon'],
  patio: ['rect', 'polygon'],
  bed: ['rect', 'oval', 'polygon'],   // planting bed
  hedge: ['line', 'rect'],
  tree: ['point'],
  firepit: ['oval', 'rect'],
  path: ['line'],
};

// ────────────────────────────────────────────────────────────────────────────
// System prompt — the design collaborator's brain.
// ────────────────────────────────────────────────────────────────────────────
const CHAT_SYSTEM = `You are the landscape-design collaborator for a real property at 35 Walden Road, Tarrytown NY. You sit beside the homeowner and help shape the backyard — pools, patios, planting, trees, paths — by actually placing and moving real elements on the plan.

You are thoughtful, warm, and plain-spoken. No jargon. No salesy language. Talk like a smart designer-friend leaning over the drawing: "let's float the pool off the back wall so there's room for a lawn," not "the aquatic feature shall be positioned to optimize spatial flow." Short, clear, kind.

═══ HOW THE SITE WORKS (READ CAREFULLY) ═══

You reason in a LOCAL SITE FRAME measured in FEET, anchored to the house:
  • Origin (0,0) = the center of the house footprint.
  • +x = grid-east, running ALONG the back wall of the house.
  • +y = grid-north, running AWAY from the back wall (deeper into the yard).
  • The frame is already rotated so that "axis-aligned" means "squared to the house walls." rot = 0 means perfectly square to the house. rot is in degrees, positive = counter-clockwise, relative to the grid.

So when someone says "a 12 by 30 pool, 18 feet off the back wall, squared to the house," that becomes a rectangle:
  • wFt = 12, lFt = 30 (width across, length along)
  • rot = 0 (squared to house)
  • cy = (distance from house center to back wall) + 18 + (lFt / 2)   ← you place its CENTER, so add half its length
  • cx = 0 (centered on the house) unless they say otherwise

You are given the current plan as JSON: parcel outline, house footprint, setbacks (structure + pool, in feet), gridBearing, and the existing elements (each with id, type, kind, name, cx, cy, wFt, lFt, rot — all in local feet). Use the house dimensions in that JSON to compute "off the back wall" distances. If the house extent isn't obvious, assume the back wall sits about half the house's depth from the origin and say what you assumed.

═══ SETBACKS — RESPECT THEM ═══

Structures (decks, patios, large built things) must stay inside the structure setback. Pools/spas have their own (usually stricter) setback. If a request would push something past a setback or off the parcel, place it as close as you reasonably can AND say so plainly: "I nudged the pool in a couple feet so it clears the side setback." Never silently violate a setback. Never pretend a setback doesn't exist.

═══ HOW YOU RESPOND ═══

Every turn you do TWO things:
  1) Talk to the homeowner in 1-3 short, warm sentences — what you did and why. Name the real moves. If you made a judgment call (centered it, squared it, pulled it off a setback), say so.
  2) Emit the actual design operations as TOOL CALLS so the plan updates.

You have these tools. Call as many as the request needs, in order:
  • add_element(type, kind, name, cx, cy, wFt, lFt, rot) — place a new element. cx,cy,wFt,lFt in feet; rot in degrees (0 = squared to house). For trees, wFt=lFt=canopy diameter. For paths/hedges (lines), wFt = width, lFt = length.
  • move_element(id, cx, cy) — relocate an existing element's center.
  • resize_element(id, wFt, lFt) — change footprint size.
  • rotate_element(id, rot) — spin it (degrees, 0 = squared to house).
  • delete_element(id) — remove it.
  • rename_element(id, name) — give it a clearer label.

VALID type values: pool, spa, deck, patio, bed, hedge, tree, firepit, path.
VALID kind values by type:
  pool: rect | oval     spa: rect | oval
  deck: rect | polygon  patio: rect | polygon
  bed: rect | oval | polygon
  hedge: line | rect    tree: point
  firepit: oval | rect  path: line

To MOVE/RESIZE/ROTATE/DELETE/RENAME an existing element you MUST use its real id from the plan JSON. If the homeowner refers to "the pool" and there's exactly one pool, use that one. If it's ambiguous (two beds, "the bed"), ask which one in your reply and don't guess.

The homeowner may attach REFERENCE PHOTOS — a pool style they like, a shot of their actual yard, a mood board, a planting they want. Look at them carefully and let them inform what you place and how you describe it ("going off that kidney-shape reference, I'll set a freeform pool…"). Reference their photos by what you actually see in them.

If they just want to talk through ideas and not place anything yet, that's fine — reply warmly and emit no tool calls. Don't place things they didn't ask for. But when they DO ask for something concrete, always emit the tool calls — don't just describe it.

Be decisive and specific. Real numbers, real placements. This is a working design tool, not a brochure.`;

// Gemini function-calling tool declarations. The model returns functionCall
// parts which we map straight to ops.
const TOOL_DECLARATIONS = [
  {
    name: 'add_element',
    description: 'Place a new landscape element on the plan, positioned in the local site frame (feet, rot=0 means squared to the house).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: Object.keys(ELEMENT_TYPES), description: 'Element family.' },
        kind: { type: 'string', description: 'Sub-style, e.g. rect, oval, line, polygon, point.' },
        name: { type: 'string', description: 'Short human label, e.g. "Main pool".' },
        cx: { type: 'number', description: 'Center X in local feet (+x = grid-east, along the back wall).' },
        cy: { type: 'number', description: 'Center Y in local feet (+y = grid-north, away from the back wall).' },
        wFt: { type: 'number', description: 'Width in feet (across). For trees, canopy diameter. For lines, line width.' },
        lFt: { type: 'number', description: 'Length in feet (along). For lines, line length.' },
        rot: { type: 'number', description: 'Rotation in degrees, 0 = squared to house, positive = counter-clockwise.' },
      },
      required: ['type', 'kind', 'cx', 'cy', 'wFt', 'lFt'],
    },
  },
  {
    name: 'move_element',
    description: 'Move an existing element to a new center, in local feet.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element id from the plan JSON.' },
        cx: { type: 'number', description: 'New center X in local feet.' },
        cy: { type: 'number', description: 'New center Y in local feet.' },
      },
      required: ['id', 'cx', 'cy'],
    },
  },
  {
    name: 'resize_element',
    description: 'Resize an existing element.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element id from the plan JSON.' },
        wFt: { type: 'number', description: 'New width in feet.' },
        lFt: { type: 'number', description: 'New length in feet.' },
      },
      required: ['id', 'wFt', 'lFt'],
    },
  },
  {
    name: 'rotate_element',
    description: 'Rotate an existing element. 0 = squared to house.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element id from the plan JSON.' },
        rot: { type: 'number', description: 'New rotation in degrees.' },
      },
      required: ['id', 'rot'],
    },
  },
  {
    name: 'delete_element',
    description: 'Remove an existing element from the plan.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element id from the plan JSON.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'rename_element',
    description: 'Rename an existing element.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The element id from the plan JSON.' },
        name: { type: 'string', description: 'New label.' },
      },
      required: ['id', 'name'],
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// CHAT MODE
// ────────────────────────────────────────────────────────────────────────────
async function handleChat(body, apiKey) {
  const message = (body.message || '').toString().trim();
  if (!message) return jsonError(400, 'Missing message');

  const plan = sanitizePlan(body.plan);
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];

  const planBlock = `

═══ CURRENT PLAN (LOCAL SITE FRAME, FEET) ═══
${JSON.stringify(plan, null, 2)}
═══ END PLAN ═══

When you reference an existing element for move/resize/rotate/delete/rename, use its exact "id" from the list above.`;

  const systemText = CHAT_SYSTEM + planBlock;

  const contents = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.content || '') }],
  }));
  // The homeowner can attach reference photos (a pool style, their real yard, a mood board).
  const userParts = [{ text: message }];
  const imgs = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  for (const im of imgs) {
    const p = parseImageInput(im);
    if (p && p.dataBase64.length < 8 * 1024 * 1024 * 1.4) {
      userParts.push({ inlineData: { mimeType: p.mimeType, data: p.dataBase64 } });
    }
  }
  contents.push({ role: 'user', parts: userParts });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemText }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    // AUTO lets the model both talk AND call tools in one turn.
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.6, maxOutputTokens: 4000 },
  };

  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status !== 429 && res.status !== 503)) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 4000));
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const isQuota = errText.includes('RESOURCE_EXHAUSTED');
    return jsonError(
      isQuota ? 429 : (res.status || 502),
      isQuota ? 'Gemini quota exhausted — wait a minute and try again' : `Gemini ${res.status}: ${errText.slice(0, 500)}`
    );
  }

  const data = await res.json().catch(() => null);
  if (!data) return jsonError(502, 'Gemini returned a non-JSON response');

  const parts = data.candidates?.[0]?.content?.parts || [];

  // Collect prose + tool calls from the response parts.
  let reply = '';
  const ops = [];
  for (const p of parts) {
    if (p.text) reply += (reply ? '\n' : '') + p.text;
    if (p.functionCall) {
      const op = functionCallToOp(p.functionCall);
      if (op) ops.push(op);
    }
  }

  // Fallback path: some responses bury ops in a fenced JSON block in the
  // text rather than as functionCall parts. Parse those too, and strip the
  // block from the visible reply.
  if (!ops.length) {
    const { cleanReply, parsedOps } = extractOpsFromText(reply);
    if (parsedOps.length) {
      reply = cleanReply;
      ops.push(...parsedOps);
    }
  }

  // Normalize/validate every op before it leaves the server.
  const cleanOps = ops.map(normalizeOp).filter(Boolean);

  if (!reply.trim()) {
    reply = cleanOps.length
      ? 'Done — updated the plan.'
      : 'Tell me what you want to place or change and I\'ll put it on the plan.';
  }

  return jsonResponse({ reply: reply.trim(), ops: cleanOps, model: TEXT_MODEL });
}

// Map a Gemini functionCall { name, args } to our op shape.
function functionCallToOp(fc) {
  const name = fc?.name;
  const a = fc?.args || {};
  if (!name) return null;
  switch (name) {
    case 'add_element':
      return { op: 'add', type: a.type, kind: a.kind, name: a.name, cx: a.cx, cy: a.cy, wFt: a.wFt, lFt: a.lFt, rot: a.rot };
    case 'move_element':
      return { op: 'move', id: a.id, cx: a.cx, cy: a.cy };
    case 'resize_element':
      return { op: 'resize', id: a.id, wFt: a.wFt, lFt: a.lFt };
    case 'rotate_element':
      return { op: 'rotate', id: a.id, rot: a.rot };
    case 'delete_element':
      return { op: 'delete', id: a.id };
    case 'rename_element':
      return { op: 'rename', id: a.id, name: a.name };
    default:
      return null;
  }
}

// Validate + coerce one op. Returns null if it's unusable.
function normalizeOp(o) {
  if (!o || typeof o !== 'object') return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  switch (o.op) {
    case 'add': {
      const type = String(o.type || '').toLowerCase();
      if (!ELEMENT_TYPES[type]) return null;
      let kind = String(o.kind || '').toLowerCase();
      const allowed = ELEMENT_TYPES[type];
      if (!allowed.includes(kind)) kind = allowed[0]; // snap to a valid default
      const cx = num(o.cx), cy = num(o.cy), wFt = num(o.wFt), lFt = num(o.lFt);
      if (cx === null || cy === null || wFt === null || lFt === null) return null;
      return {
        op: 'add',
        type,
        kind,
        name: String(o.name || defaultName(type)).slice(0, 60),
        cx, cy,
        wFt: Math.abs(wFt),
        lFt: Math.abs(lFt),
        rot: num(o.rot) ?? 0,
      };
    }
    case 'move': {
      if (!o.id) return null;
      const cx = num(o.cx), cy = num(o.cy);
      if (cx === null || cy === null) return null;
      return { op: 'move', id: String(o.id), cx, cy };
    }
    case 'resize': {
      if (!o.id) return null;
      const wFt = num(o.wFt), lFt = num(o.lFt);
      if (wFt === null || lFt === null) return null;
      return { op: 'resize', id: String(o.id), wFt: Math.abs(wFt), lFt: Math.abs(lFt) };
    }
    case 'rotate': {
      if (!o.id) return null;
      const rot = num(o.rot);
      if (rot === null) return null;
      return { op: 'rotate', id: String(o.id), rot };
    }
    case 'delete':
      return o.id ? { op: 'delete', id: String(o.id) } : null;
    case 'rename':
      return o.id && o.name ? { op: 'rename', id: String(o.id), name: String(o.name).slice(0, 60) } : null;
    default:
      return null;
  }
}

function defaultName(type) {
  const labels = {
    pool: 'Pool', spa: 'Spa', deck: 'Deck', patio: 'Patio', bed: 'Planting bed',
    hedge: 'Hedge', tree: 'Tree', firepit: 'Fire pit', path: 'Path',
  };
  return labels[type] || 'Element';
}

// Trim the incoming plan to the fields the model needs.
function sanitizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const elements = Array.isArray(p.elements)
    ? p.elements.slice(0, 200).map((e) => ({
        id: String(e.id ?? ''),
        type: e.type,
        kind: e.kind,
        name: e.name,
        cx: e.cx, cy: e.cy, wFt: e.wFt, lFt: e.lFt, rot: e.rot,
      }))
    : [];
  return {
    units: 'feet',
    gridBearing: p.gridBearing ?? 0,
    house: p.house ?? null,
    parcel: p.parcel ?? null,
    setbacks: p.setbacks ?? null,
    elements,
  };
}

// Fallback parser: pull a fenced ```ops / ```json array of operations out of
// the model's text when it didn't use real function calls.
function extractOpsFromText(reply) {
  const fenceRe = /```(?:ops|json)?\s*\n([\s\S]*?)\n```/gi;
  const out = [];
  let cleanReply = reply;
  const ranges = [];
  let m;
  while ((m = fenceRe.exec(reply)) !== null) {
    const parsed = tryParseOpsArray(m[1].trim());
    if (parsed.length) {
      out.push(...parsed);
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  for (const [s, e] of ranges.reverse()) cleanReply = cleanReply.slice(0, s) + cleanReply.slice(e);
  return { cleanReply: cleanReply.replace(/\n{3,}/g, '\n\n').trim(), parsedOps: out };
}

function tryParseOpsArray(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); // strip trailing commas
    } catch {
      return [];
    }
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const ops = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    if (item.op) { ops.push(item); continue; }
    if (item.name && item.args) {
      const o = functionCallToOp(item);
      if (o) ops.push(o);
      continue;
    }
    for (const key of Object.keys(item)) {
      const o = functionCallToOp({ name: key, args: item[key] });
      if (o) ops.push(o);
    }
  }
  return ops;
}

// ────────────────────────────────────────────────────────────────────────────
// RENDER MODE — watercolor masterplan
// ────────────────────────────────────────────────────────────────────────────
const RENDER_PROMPT = `You are a landscape-architecture illustrator producing a hand-painted WATERCOLOR MASTERPLAN — a top-down orthographic site plan repainted in the presentation-board tradition of Hargreaves Associates, SWA Group, and James Corner Field Operations. Think of the loose competition boards those studios hang in a gallery review: wet-on-wet pigment washes, soft bleeding edges, color that breathes rather than fills.

I am giving you ONE source image: a precise, georeferenced site plan of a real residential property. It is GROUND TRUTH. Treat it like a surveyor's drawing you are tracing over on watercolor paper.

═══ ABSOLUTE RULE — GEOMETRY IS LOCKED ═══
You are RESTYLING, not redesigning. Preserve with pixel-level fidelity: the property line and its exact shape, every vertex and angle; the house footprint (exact position, size, rotation); the setback lines; every pool, deck, patio, planting bed, hedge, path, tree, and fire pit — at the EXACT position, size, scale, and orientation shown. Do NOT move, resize, rotate, add, delete, duplicate, or "improve" any element. Do NOT invent landscaping that isn't in the source. Do NOT change the boundary. The output must register perfectly on top of the input.

═══ VIEW ═══
Strict top-down orthographic plan view (looking straight down, zero perspective). No 3D, no axonometric tilt, no horizon, no sky, no people, no cars. Orientation stays exactly as the source. Flat plan only.

═══ THE WATERCOLOR LANGUAGE ═══
• PAPER: warm cold-press watercolor paper, faint tooth showing through, base tone like aged ivory (#f4efe4), never pure white.
• PLANTING: loose layered washes of soft sage, olive, muted spring green — pigment pooling darker at bed edges (the watercolor "bloom"), translucent in the center, bleeding gently into one another. Never flat fills, never CAD hatching.
• TREES: hand-drawn canopies as dappled stippled circular washes — two or three green tones layered, a soft shadow offset to one side, organic and slightly irregular. NOT clip-art symbols.
• HEDGES: denser cooler green ribbons with a soft drop-shadow edge so they read as low green walls.
• WATER (pools/spa): translucent cerulean-to-teal wash, palest in the middle, a thin darker rim, the faintest ripple. Luminous, not opaque.
• HARDSCAPE (decks, patios, paths): warm muted stone — sand, taupe, soft terracotta — gravel as sandy ochre stipple, wood decks as warm tan with a hint of plank direction, stone patios as cool grey-beige. Edges as elegant thin slightly-imperfect hand-inked warm-grey lines, never heavy black CAD strokes.
• FIRE PIT: a small warm terracotta/charcoal accent.
• LINEWORK: property line as a refined fine warm-grey/sepia line; setback as a lighter dotted line; house footprint as a clean warm-grey outline with a pale neutral fill (it's a building, not a garden). Thin and confident.
• LIGHT & AIR: atmospheric and airy, soft diffuse light, gentle shadow washes off trees and house for depth. Generous breathing room. Restraint over saturation.

═══ MOOD ═══
A gallery concept board, not a CAD plotter print. Emotional, beautiful, confident, restrained — painted by a person with a loaded brush and excellent taste. Loose where nature lives, precise where the architecture lives. Do NOT add labels, dimensions, text, scale bars, north arrows, or UI chrome. Just the painting. Preserve the aspect ratio and framing of the reference.`;

async function handleRender(body, apiKey) {
  const ref = parseImageInput(body.image);
  if (!ref) return jsonError(400, 'Missing or invalid `image` (expected a base64 data URL or raw base64 PNG)');

  const MAX_REF_BYTES = 8 * 1024 * 1024;
  if (ref.dataBase64.length > MAX_REF_BYTES * 1.4) {
    return jsonError(413, 'Plan image too large — keep it under ~8MB.');
  }

  const instruction = (body.instruction || '').toString().trim();
  const styleHint = (body.style || '').toString().trim();
  const context = (body.context || '').toString().trim();

  let prompt = RENDER_PROMPT;
  if (context) prompt += `\n\nSITE FACTS (for your reference, do not draw as text): ${context}`;
  if (styleHint) prompt += `\n\nSTYLE EMPHASIS: ${styleHint}`;
  if (instruction) prompt += `\n\nADDITIONAL DIRECTION (apply as styling only — never move the geometry): ${instruction}`;

  const refPart = { inlineData: { mimeType: ref.mimeType, data: ref.dataBase64 } };
  const textPart = { text: prompt };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

  async function callGemini(parts, label) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
    } catch (err) {
      return { ok: false, status: 0, error: `Gemini fetch threw (${label}): ${err.message}`, ms: Date.now() - t0 };
    }
    const ms = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: `Gemini ${res.status} (${label}): ${errText.slice(0, 600)}`, ms };
    }
    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, status: 502, error: `Gemini non-JSON (${label})`, ms };
    let image = null;
    let text = '';
    for (const c of (data.candidates || [])) {
      for (const p of (c?.content?.parts || [])) {
        if (p.inlineData?.data && !image) {
          image = { mimeType: p.inlineData.mimeType || 'image/png', dataBase64: p.inlineData.data };
        } else if (p.text) {
          text += (text ? '\n' : '') + p.text;
        }
      }
    }
    if (!image) {
      return { ok: false, status: 502, error: `Gemini returned no image (${label})${text ? ': ' + text.slice(0, 300) : ''}`, ms };
    }
    return { ok: true, image, text, ms };
  }

  let result = await callGemini([refPart, textPart], 'with-ref');
  if (!result.ok) {
    console.warn(`[walden-design] render with-ref failed (${result.ms}ms, status ${result.status}): ${String(result.error).slice(0, 200)} — retrying without ref`);
    result = await callGemini([textPart], 'no-ref retry');
  }
  if (!result.ok) return jsonError(result.status || 502, result.error);

  return jsonResponse({
    image: result.image.dataBase64,
    mimeType: result.image.mimeType,
    model: IMAGE_MODEL,
    ms: result.ms,
  });
}

function parseImageInput(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  const dataUrl = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(s);
  if (dataUrl) {
    return { mimeType: dataUrl[1].toLowerCase(), dataBase64: dataUrl[2] };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 32) {
    return { mimeType: 'image/png', dataBase64: s.replace(/\s/g, '') };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// HELPERS — JSON responses with permissive CORS (personal tool).
// ────────────────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function jsonError(status, message) {
  return jsonResponse({ error: message }, status);
}

// Inner handler — Web Request in, Web Response out.
async function innerHandler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed — use POST');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return jsonError(500, 'GEMINI_API_KEY not configured');

  let body;
  try { body = await req.json(); }
  catch { return jsonError(400, 'Invalid JSON body'); }

  const mode = body.mode === 'render' ? 'render' : body.mode === 'chat' ? 'chat' : null;
  if (!mode) return jsonError(400, "Missing or invalid `mode` — expected 'chat' or 'render'");

  if (mode === 'render') return handleRender(body, apiKey);
  return handleChat(body, apiKey);
}

// ────────────────── Vercel Node adapter ──────────────────
async function buildWebRequest(req) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const url = `${proto}://${host}${req.url || '/'}`;
  let body;
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.body !== undefined && req.body !== null) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      body = await new Promise((resolve, reject) => {
        let buf = '';
        req.on('data', (chunk) => { buf += chunk; });
        req.on('end', () => resolve(buf));
        req.on('error', reject);
      });
    }
  }
  return new Request(url, { method, headers, body: body || undefined });
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) res.setHeader(k, v);
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

export default async function handler(req, res) {
  // Express-style — Node runtime
  if (res !== undefined) {
    try {
      const webReq = await buildWebRequest(req);
      const response = await innerHandler(webReq);
      await sendWebResponse(res, response);
    } catch (e) {
      console.error('[walden-design]', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ error: 'INTERNAL', message: (e && e.message) || String(e) }));
    }
    return;
  }
  // Web-style — Edge runtime (safety, in case runtime config is overridden)
  return innerHandler(req);
}
