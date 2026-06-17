// Walden landscape-studio — pure op parsing/validation.
//
// The /api/walden-design chat endpoint asks Gemini (with function calling) for
// structured design operations and applies them to the plan. This module is the
// pure, side-effect-free core of that pipeline: it turns a Gemini functionCall —
// or a fenced ops array in the model's prose — into a validated op the front-end
// can apply, and trims an incoming plan down to the fields the model needs.
//
// Extracted from walden-design.js so it can be unit-tested headlessly. The
// endpoint imports everything here; this file is the single source of truth for
// ELEMENT_TYPES and the op shapes.
//
// RETAINING-WALL HEIGHT (the bug this extraction fixed): 35 Walden is an
// explicitly terraced site, and the `wall` element carries two load-bearing
// properties the rest of the tool is built around — `heightFt` (how much grade
// the wall holds; drives the >4ft "needs an engineer" warning and the terracing
// advice) and `levelFt` (the top terrace level). The client models both, the
// inspector exposes both, and planSummary() even round-trips both INTO the model.
// But the op pipeline used to DROP them: add_element had no height param, and
// neither functionCallToOp nor normalizeOp carried them. So the AI collaborator
// could place a wall but never set its height or terrace level — the one decision
// a retaining wall exists to make. They are now carried through the add path.

export const ELEMENT_TYPES = {
  pool: ['rect', 'oval'],
  spa: ['rect', 'oval'],
  deck: ['rect', 'polygon'],
  patio: ['rect', 'polygon'],
  bed: ['rect', 'oval', 'polygon'],   // planting bed
  hedge: ['line', 'rect'],
  tree: ['point'],
  firepit: ['oval', 'rect'],
  path: ['line'],
  wall: ['line'],   // retaining wall — line with a heightFt + levelFt
};

// Map a Gemini functionCall { name, args } to our op shape.
export function functionCallToOp(fc) {
  const name = fc?.name;
  const a = fc?.args || {};
  if (!name) return null;
  switch (name) {
    case 'add_element': {
      const op = { op: 'add', type: a.type, kind: a.kind, name: a.name, cx: a.cx, cy: a.cy, wFt: a.wFt, lFt: a.lFt, rot: a.rot };
      // Carry the retaining-wall properties only when the model supplied them,
      // so a non-wall add stays byte-identical to its old shape.
      if (a.heightFt != null) op.heightFt = a.heightFt;
      if (a.levelFt != null) op.levelFt = a.levelFt;
      return op;
    }
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
export function normalizeOp(o) {
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
      const out = {
        op: 'add',
        type,
        kind,
        name: String(o.name || defaultName(type)).slice(0, 60),
        cx, cy,
        wFt: Math.abs(wFt),
        lFt: Math.abs(lFt),
        rot: num(o.rot) ?? 0,
      };
      // Retaining-wall grade properties — preserved only when provided, so the
      // common non-wall add never gains a spurious heightFt:0. A wall can't hold
      // negative grade, so clamp height to its magnitude; levelFt is a signed
      // elevation (a terrace can sit below house datum) so it stays as-is.
      const heightFt = num(o.heightFt);
      if (heightFt !== null) out.heightFt = Math.abs(heightFt);
      const levelFt = num(o.levelFt);
      if (levelFt !== null) out.levelFt = levelFt;
      return out;
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

export function defaultName(type) {
  const labels = {
    pool: 'Pool', spa: 'Spa', deck: 'Deck', patio: 'Patio', bed: 'Planting bed',
    hedge: 'Hedge', tree: 'Tree', firepit: 'Fire pit', path: 'Path',
    wall: 'Retaining wall',
  };
  return labels[type] || 'Element';
}

// Trim the incoming plan to the fields the model needs.
export function sanitizePlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const elements = Array.isArray(p.elements)
    ? p.elements.slice(0, 200).map((e) => ({
        id: String(e.id ?? ''),
        type: e.type,
        kind: e.kind,
        name: e.name,
        cx: e.cx, cy: e.cy, wFt: e.wFt, lFt: e.lFt, rot: e.rot,
        // Keep the wall grade properties so the model can SEE the height/level
        // of walls already on the plan (it reasons about terracing from them).
        ...(e.heightFt != null ? { heightFt: e.heightFt } : {}),
        ...(e.levelFt != null ? { levelFt: e.levelFt } : {}),
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
export function extractOpsFromText(reply) {
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

export function tryParseOpsArray(raw) {
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
