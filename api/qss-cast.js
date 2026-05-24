// queen-scarlet-school: GLOBAL character cast endpoint.
//
// Cast characters are shared across every story Henry writes. Storage is a
// single Postgres table (qss_cast, migration 018) keyed by lowercased name
// so dedup happens at the DB level.
//
// Endpoints:
//   GET  /api/qss-cast                       → { characters: [...] }
//   POST /api/qss-cast?action=upsert         → { card }       → 200 / 503
//   POST /api/qss-cast?action=upsert-many    → { cards: [] }  → 200 / 503
//   POST /api/qss-cast?action=delete         → { name }       → 200 / 503
//
// Pre-migration behavior (table missing): returns 503 MIGRATION_NEEDED with
// a clear message. The client treats that as "stay on localStorage until
// migration's applied" — no crash, no banner spam.
//
// Auth: same x-access-code perimeter as the rest of /api/qss-*.

import { checkAccess } from './_lib/access.js';

// Edge runtime. The missing-await bug on checkAccess below was killing
// every request with a 500 because the async checkAccess Promise was
// truthy, hitting the withCors-on-Promise path. Now fixed. We stay on
// edge because: (a) calls go to Supabase PostgREST and complete in
// well under 5s, (b) Edge req.url is a full URL while Node would
// give us just a path which breaks `new URL(req.url)`.
export const config = { runtime: 'edge' };

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const SELECT_COLS = 'name_key,name,synopsis,visual_notes,portraits,primary_portrait_id,chat,story_appearances,generated_at,updated_at';
// Thin select for handleList — omits the portraits JSONB column so the
// 8 s statement timeout doesn't fire when portraits weigh ~70 MB total.
// handleList synthesizes a thin portraits=[{id: primary_portrait_id}]
// from primary_portrait_id; the client lazy-loads bytes via
// ?action=portrait. See handleList for the full rationale.
const LIST_BASE_COLS = 'name_key,name,synopsis,visual_notes,primary_portrait_id,chat,story_appearances,generated_at,updated_at';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonError(500, 'NO_DB', 'Supabase credentials not configured');
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  // World isolation — cast characters live per-world. Pre-migration legacy
  // rows have world_slug NULL and are treated as queen-scarlet so existing
  // data survives.
  const world = sanitizeWorldSlug(url.searchParams.get('world') || url.searchParams.get('world_slug'));

  try {
    if (req.method === 'GET') {
      if (action === 'portrait') return await handlePortrait(url, world);
      return await handleList(world);
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const bodyWorld = sanitizeWorldSlug(body?.world_slug || body?.world || world);
      if (action === 'upsert')      return await handleUpsert(body, bodyWorld);
      if (action === 'upsert-many') return await handleUpsertMany(body, bodyWorld);
      if (action === 'delete')      return await handleDelete(body, bodyWorld);
      return jsonError(400, 'BAD_ACTION', `Unknown action: ${action}`);
    }
    return new Response('Method not allowed', { status: 405, headers: CORS });
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.code === '42P01' || e?.code === 'PGRST205' || /Could not find the table/i.test(msg) || /relation "?qss_cast"? does not exist/i.test(msg)) {
      return jsonError(503, 'MIGRATION_NEEDED_018',
        'The qss_cast table does not exist yet. Apply supabase/migrations/018_qss_cast.sql in the Supabase SQL editor. Until then the cast saves locally only.');
    }
    console.error('[qss-cast]', e);
    return jsonError(500, 'INTERNAL', msg.slice(0, 400));
  }
}

// ────────────────────── handlers ──────────────────────

async function handleList(world) {
  // World filter: queen-scarlet (default) sees its own rows AND legacy
  // NULL rows; other worlds see ONLY their own rows.
  const worldFilter = world === 'queen-scarlet'
    ? `or=(world_slug.eq.queen-scarlet,world_slug.is.null)`
    : `world_slug=eq.${encodeURIComponent(world)}`;
  // SKIP the portraits JSONB column entirely on this query. Each portrait
  // is ~2 MB base64; with 17 cards × 2 portraits the column alone is
  // 70 MB and Postgres aborts at the 8 s statement timeout before
  // PostgREST even starts streaming. Stripping in the Edge function isn't
  // enough — the bytes still have to cross the wire from PG → PostgREST.
  // LIST_BASE_COLS deliberately omits `portraits`.
  //
  // The client needs SOMETHING in portraits[] so its orphan-recovery
  // doesn't fire and wipe the row. We synthesize a 1-element
  // portraits=[{id: primary_portrait_id}] (no dataBase64) so the
  // cross-device cloud-hydrate path can fetch the bytes via
  // ?action=portrait. Non-primary (loved) portraits are NOT surfaced
  // here — a follow-up `?action=portraits-meta` is needed for that.
  // For now, primary is what makes the cast page render.
  let rows;
  try {
    rows = await sb('GET', `qss_cast?select=${LIST_BASE_COLS},world_slug&${worldFilter}&order=updated_at.desc&limit=500`);
  } catch (e) {
    if (/world_slug/i.test(e?.message || '') && /column.*does not exist|schema cache/i.test(e?.message || '')) {
      rows = await sb('GET', `qss_cast?select=${LIST_BASE_COLS}&order=updated_at.desc&limit=500`);
    } else {
      throw e;
    }
  }
  const characters = (rows || []).map(r => ({
    name: r.name,
    synopsis: r.synopsis || '',
    visual_notes: r.visual_notes || '',
    portraits: r.primary_portrait_id
      ? [{ id: r.primary_portrait_id, mime: 'image/png', generated_at: Date.now(), note: '', loved: false }]
      : [],
    primary_portrait_id: r.primary_portrait_id || null,
    chat: Array.isArray(r.chat) ? r.chat : [],
    story_appearances: Array.isArray(r.story_appearances) ? r.story_appearances : [],
    generated_at: r.generated_at ? new Date(r.generated_at).getTime() : Date.now(),
    updated_at: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  }));
  return jsonOk({ characters });
}

// Fetch a single portrait's bytes for lazy cross-device hydration. Cheap —
// one row select, one portrait, one ~2 MB response. Client only calls this
// when IDB doesn't have the bytes.
async function handlePortrait(url, world) {
  const name = (url.searchParams.get('name') || '').trim();
  const id = (url.searchParams.get('id') || '').trim();
  if (!name || !id) return jsonError(400, 'BAD_REQUEST', 'name and id are required');
  const key = name.toLowerCase();
  const worldFilter = world === 'queen-scarlet'
    ? `or=(world_slug.eq.queen-scarlet,world_slug.is.null)`
    : `world_slug=eq.${encodeURIComponent(world)}`;
  const rows = await sb('GET', `qss_cast?select=portraits&name_key=eq.${encodeURIComponent(key)}&${worldFilter}&limit=1`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return jsonError(404, 'NOT_FOUND', 'card not found');
  const p = Array.isArray(row.portraits) ? row.portraits.find(p => p?.id === id) : null;
  if (!p || !p.dataBase64) return jsonError(404, 'NO_PORTRAIT', 'portrait not found or missing bytes');
  return jsonOk({
    id: p.id, mime: p.mime || 'image/png', dataBase64: p.dataBase64,
    generated_at: p.generated_at || Date.now(), note: p.note || '', loved: !!p.loved,
  });
}

async function handleUpsert(body, world) {
  const card = sanitizeCard(body?.card);
  if (!card) return jsonError(400, 'BAD_CARD', 'card with name required');
  const merged = await mergeWithExisting(card, world);
  const row = cardToRow(merged);
  row.world_slug = world;
  await sb('POST', `qss_cast?on_conflict=name_key,world_slug&select=${SELECT_COLS}`, row, {
    returnRepresentation: true,
    prefer: 'resolution=merge-duplicates',
  });
  return jsonOk({ ok: true });
}

async function handleUpsertMany(body, world) {
  const cards = Array.isArray(body?.cards) ? body.cards : [];
  if (!cards.length) return jsonOk({ ok: true, upserted: 0 });
  const sanitized = cards.map(sanitizeCard).filter(Boolean);
  if (!sanitized.length) return jsonOk({ ok: true, upserted: 0 });
  // Merge each incoming card against the existing row for the same
  // (name_key, world_slug). This is the BACKSTOP against a buggy client
  // that sends a thin (unhydrated) card up — without this, the server
  // would happily overwrite a row with full portraits using a row whose
  // portraits[] is empty because dataBase64 was still in IDB. Johnny has
  // reported the resulting "every visit redraws every character" 15+
  // times. Now: server NEVER reduces portrait count, NEVER drops
  // visual_notes, NEVER drops loved flags. Generation-only paths still
  // add new portraits (since merge keeps both sides). Explicit deletes
  // go through DELETE, not upsert.
  const merged = await Promise.all(sanitized.map(c => mergeWithExisting(c, world)));
  const rows = merged.map(cardToRow);
  for (const r of rows) r.world_slug = world;
  await sb('POST', `qss_cast?on_conflict=name_key,world_slug`, rows, {
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return jsonOk({ ok: true, upserted: rows.length });
}

// Fetch the existing row for this (name_key, world_slug) and merge the
// incoming sanitized card with it. Merge rules — preservation wins:
//   - portraits[]: union by id. Existing entries that aren't in the
//     incoming card are preserved. Incoming entries new to this id are
//     added. Same id: incoming wins on `loved` and `note`, existing
//     wins on `dataBase64`/`mime` (never overwrite real bytes with
//     missing bytes — the whole bug).
//   - primary_portrait_id: incoming if it points to a portrait still in
//     the merged set, else existing if valid, else fall back to last.
//   - visual_notes / synopsis: incoming if non-empty, else existing.
//   - chat: union, dedup by id, sorted by ts (preserves history).
//   - story_appearances: union by story_id, last_seen_at wins.
//   - generated_at: max(incoming, existing).
//
// If the existing row is absent (new character), return the incoming
// card untouched.
async function mergeWithExisting(card, world) {
  const key = card.name.toLowerCase();
  let existing = null;
  try {
    const rows = await sb(
      'GET',
      `qss_cast?select=${SELECT_COLS}&name_key=eq.${encodeURIComponent(key)}&world_slug=eq.${encodeURIComponent(world)}&limit=1`,
    );
    if (Array.isArray(rows) && rows[0]) existing = rows[0];
  } catch (e) {
    // If the lookup fails (e.g. world_slug column missing pre-021), fall
    // back to a name-only lookup so we still preserve data on legacy
    // schemas. Worst case we miss the merge and fall through to the
    // original (destructive) behavior — same as before this fix, so
    // never strictly worse.
    if (/world_slug/i.test(e?.message || '') && /column.*does not exist|schema cache/i.test(e?.message || '')) {
      try {
        const rows = await sb(
          'GET',
          `qss_cast?select=${SELECT_COLS}&name_key=eq.${encodeURIComponent(key)}&limit=1`,
        );
        if (Array.isArray(rows) && rows[0]) existing = rows[0];
      } catch {}
    }
  }
  if (!existing) return card;

  const existingPortraits = Array.isArray(existing.portraits) ? existing.portraits : [];
  const incomingPortraits = Array.isArray(card.portraits) ? card.portraits : [];

  // Union by id. Incoming wins on metadata except dataBase64/mime where
  // existing always wins (the indestructible byte-preservation rule).
  const byId = new Map();
  for (const p of existingPortraits) {
    if (p && p.id) byId.set(p.id, { ...p });
  }
  for (const p of incomingPortraits) {
    if (!p || !p.id) continue;
    const prior = byId.get(p.id);
    if (!prior) {
      // Brand new portrait — accept only if it carries bytes. A
      // dataBase64-less portrait id has no value without the body, and
      // accepting it would re-introduce the original bug at the
      // single-portrait level.
      if (p.dataBase64) byId.set(p.id, { ...p });
      continue;
    }
    // Same id on both sides — preserve existing bytes; let incoming
    // refresh love/note/generated_at.
    byId.set(p.id, {
      ...prior,
      // dataBase64/mime: existing wins (prior is server-stored, must
      // not be replaced with whatever the client happened to ship).
      dataBase64: prior.dataBase64 || p.dataBase64 || '',
      mime: prior.mime || p.mime || 'image/png',
      loved: typeof p.loved === 'boolean' ? p.loved : !!prior.loved,
      note: typeof p.note === 'string' && p.note ? p.note : (prior.note || ''),
      generated_at: typeof p.generated_at === 'number' ? p.generated_at : (prior.generated_at || Date.now()),
    });
  }
  const mergedPortraits = Array.from(byId.values()).filter(p => p && p.dataBase64);

  // primary: prefer incoming if still valid; else existing if valid;
  // else last in merged.
  const hasId = id => id && mergedPortraits.some(p => p.id === id);
  let primary = null;
  if (hasId(card.primary_portrait_id)) primary = card.primary_portrait_id;
  else if (hasId(existing.primary_portrait_id)) primary = existing.primary_portrait_id;
  else if (mergedPortraits.length) primary = mergedPortraits[mergedPortraits.length - 1].id;

  // chat: union by id, sort by ts ascending, hard-cap at 200 like sanitizeCard.
  const chatById = new Map();
  for (const m of Array.isArray(existing.chat) ? existing.chat : []) {
    if (m && m.id) chatById.set(m.id, m);
  }
  for (const m of Array.isArray(card.chat) ? card.chat : []) {
    if (m && m.id) chatById.set(m.id, m);
  }
  const mergedChat = Array.from(chatById.values())
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .slice(-200);

  // story_appearances: union by story_id, most-recent last_seen_at wins.
  const appsById = new Map();
  for (const a of Array.isArray(existing.story_appearances) ? existing.story_appearances : []) {
    if (a && a.story_id) appsById.set(a.story_id, a);
  }
  for (const a of Array.isArray(card.story_appearances) ? card.story_appearances : []) {
    if (!a || !a.story_id) continue;
    const prior = appsById.get(a.story_id);
    if (!prior || (a.last_seen_at || 0) >= (prior.last_seen_at || 0)) appsById.set(a.story_id, a);
  }
  const mergedApps = Array.from(appsById.values());

  return {
    name: card.name,
    synopsis: (card.synopsis || '').length ? card.synopsis : (existing.synopsis || ''),
    visual_notes: (card.visual_notes || '').length ? card.visual_notes : (existing.visual_notes || ''),
    portraits: mergedPortraits,
    primary_portrait_id: primary,
    chat: mergedChat,
    story_appearances: mergedApps,
    generated_at: Math.max(
      typeof card.generated_at === 'number' ? card.generated_at : 0,
      existing.generated_at ? new Date(existing.generated_at).getTime() : 0,
    ) || Date.now(),
  };
}

async function handleDelete(body, world) {
  const name = String(body?.name || '').trim();
  if (!name) return jsonError(400, 'BAD_NAME', 'name required');
  const key = name.toLowerCase();
  // Scope delete to this world so deleting Burgundy's "Kevin" doesn't
  // nuke QSS's "Kevin".
  await sb('DELETE', `qss_cast?name_key=eq.${encodeURIComponent(key)}&world_slug=eq.${encodeURIComponent(world)}`);
  return jsonOk({ ok: true });
}

function sanitizeWorldSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (slug === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

// ────────────────────── sanitize / row mapping ──────────────────────

function sanitizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name || '').trim();
  if (!name) return null;
  const MAX_PORTRAITS = 10;
  // Portrait base64 size cap. Nano Banana / Gemini portraits routinely hit
  // ~2 MB base64 (≈1.5 MB binary, ~1000×1500 PNG). The previous 600 KB
  // cap silently dropped EVERY portrait via the `continue` below — server
  // wrote the row with portraits=[], returned 200 OK, Henry saw empty
  // cards on every reload. THAT was the actual save-doesn't-stick bug.
  // 3 MB raw allows ~4 MB base64; Vercel Edge body cap is 4.5 MB so the
  // client must chunk batches (see flushCloudPush).
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const MAX_CHAT = 200;
  const MAX_APPS = 80;
  const MAX_LEN = 1200;

  const portraits = Array.isArray(c.portraits) ? c.portraits.filter(p => p && typeof p === 'object').slice(-MAX_PORTRAITS) : [];
  const cleanPortraits = [];
  for (const p of portraits) {
    const dataBase64 = typeof p.dataBase64 === 'string' ? p.dataBase64 : '';
    if (!dataBase64) continue;
    if (dataBase64.length > MAX_IMAGE_BYTES * 1.4) {
      // Loud so the next regression surfaces immediately instead of
      // silently dropping every portrait again.
      console.warn('[qss-cast sanitize] dropping oversize portrait', {
        cardName: name, portraitId: p.id, bytes: dataBase64.length, cap: MAX_IMAGE_BYTES * 1.4,
      });
      continue;
    }
    cleanPortraits.push({
      id: String(p.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 12),
      mime: String(p.mime || 'image/png').slice(0, 32),
      dataBase64,
      generated_at: typeof p.generated_at === 'number' ? p.generated_at : Date.now(),
      note: String(p.note || '').slice(0, 200),
      loved: !!p.loved,
    });
  }
  let primary = String(c.primary_portrait_id || '').slice(0, 64);
  if (primary && !cleanPortraits.find(p => p.id === primary)) primary = '';
  if (!primary && cleanPortraits.length) primary = cleanPortraits[cleanPortraits.length - 1].id;

  const chat = Array.isArray(c.chat) ? c.chat.slice(-MAX_CHAT).filter(m => m && typeof m === 'object').map(m => ({
    id: String(m.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 12),
    role: m.role === 'wordy' || m.role === 'assistant' ? 'wordy' : 'kid',
    content: String(m.content || '').slice(0, 4000),
    ts: typeof m.ts === 'number' ? m.ts : Date.now(),
  })) : [];

  const apps = Array.isArray(c.story_appearances) ? c.story_appearances.slice(0, MAX_APPS).filter(a => a && typeof a === 'object').map(a => ({
    story_id: String(a.story_id || '').slice(0, 64) || null,
    story_name: String(a.story_name || '').slice(0, 200),
    intro_block: Number(a.intro_block) || null,
    current_state: String(a.current_state || '').slice(0, 400),
    last_seen_at: typeof a.last_seen_at === 'number' ? a.last_seen_at : Date.now(),
  })) : [];

  return {
    name,
    synopsis: String(c.synopsis || '').slice(0, MAX_LEN),
    visual_notes: String(c.visual_notes || '').slice(0, MAX_LEN),
    portraits: cleanPortraits,
    primary_portrait_id: primary || null,
    chat,
    story_appearances: apps,
    generated_at: typeof c.generated_at === 'number' ? c.generated_at : Date.now(),
  };
}

function cardToRow(card) {
  return {
    name_key: card.name.toLowerCase(),
    name: card.name,
    synopsis: card.synopsis,
    visual_notes: card.visual_notes,
    portraits: card.portraits,
    primary_portrait_id: card.primary_portrait_id,
    chat: card.chat,
    story_appearances: card.story_appearances,
    generated_at: new Date(card.generated_at).toISOString(),
  };
}

function rowToCard(r) {
  return {
    name: r.name,
    synopsis: r.synopsis || '',
    visual_notes: r.visual_notes || '',
    portraits: Array.isArray(r.portraits) ? r.portraits : [],
    primary_portrait_id: r.primary_portrait_id || null,
    chat: Array.isArray(r.chat) ? r.chat : [],
    story_appearances: Array.isArray(r.story_appearances) ? r.story_appearances : [],
    generated_at: r.generated_at ? new Date(r.generated_at).getTime() : Date.now(),
    updated_at: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
  };
}

// ────────────────────── supabase REST helper ──────────────────────

async function sb(method, path, payload, opts = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.returnRepresentation) headers['Prefer'] = 'return=representation';
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch {} }
  if (!res.ok) {
    const err = new Error(data?.message || text || `Supabase ${res.status}`);
    err.code = data?.code || `HTTP_${res.status}`;
    err.details = data?.details;
    throw err;
  }
  return data;
}

// ────────────────────── response helpers ──────────────────────

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function jsonError(status, code, message, extra = null) {
  return new Response(JSON.stringify({ error: code, message, ...(extra || {}) }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
