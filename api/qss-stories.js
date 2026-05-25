import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge', maxDuration: 30 };

/**
 * Queen Scarlet's School — story library API.
 *
 * Reuses the interpreter's reliability playbook:
 *   - Supabase is the source of truth.
 *   - Optimistic concurrency on update — caller passes expectedUpdatedAt;
 *     server enforces it. On miss, returns 409 with serverUpdatedAt so the
 *     client can resync.
 *   - Soft delete via deleted_at.
 *   - Typed errors: NO_DB / CONFLICT / NOT_FOUND / NAME_TAKEN.
 *   - Idempotent operations where possible.
 *
 * Endpoints (single function, action dispatched by ?action= and method):
 *   GET  /api/qss-stories?action=list[&trash=1]    → { stories: [...] }
 *   GET  /api/qss-stories?action=get&id=...        → { story: {...} }
 *   POST /api/qss-stories?action=save              → { story: {...} }
 *     body: { id?, name, bible?, rules?, blocks?, chat?, suggestions?,
 *             cover_image?, expectedUpdatedAt? }
 *   POST /api/qss-stories?action=rename            → { story: {...} }
 *     body: { id, name, expectedUpdatedAt? }
 *   POST /api/qss-stories?action=duplicate         → { story: {...} }
 *     body: { id, newName? }
 *   POST /api/qss-stories?action=delete            → { ok: true }
 *     body: { id }      (soft delete)
 *   POST /api/qss-stories?action=restore           → { story: {...} }
 *     body: { id }
 *   POST /api/qss-stories?action=hard-delete       → { ok: true }
 *     body: { id }      (purge — soft-deleted rows only, for safety)
 */

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Columns we want back from a story select. Order matters for stable diffs.
// character_cards / freestyle_chat / freestyle_themes may not exist until
// their migrations are applied — server falls back via the sb() helper
// if Postgres complains.
const SELECT_COLS = 'id,name,bible,rules,blocks,chat,suggestions,cover_image,arc_context,character_cards,freestyle_chat,freestyle_themes,world_slug,deleted_at,created_at,updated_at';
// Columns the sb() fallback is allowed to strip on a PostgREST schema-cache
// hiccup. world_slug used to live here — but migration 021 has shipped for
// a long time and the column is now load-bearing for world isolation. A
// stale schema-cache error on ANY column would trigger this whole list to
// be stripped, which silently wrote world_slug=null and made stories vanish
// from their world's library (THE bug). Keep world_slug OFF this list so a
// schema hiccup hard-fails the save instead of corrupting the row.
const OPTIONAL_COLS = ['character_cards', 'freestyle_chat', 'freestyle_themes'];
// world_slug is REQUIRED — never strip it. Listed here only so the missing-
// col regex can distinguish "real missing world_slug" (escalate, don't strip)
// from the optional cols above.
const REQUIRED_COLS = ['world_slug'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
  // Preflight — allow Desktop / file:// checklist page + any other origin
  // to reach the api. The bearer guard still enforces actual access.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonError(500, 'NO_DB', 'Supabase env vars not configured on the server');
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || (req.method === 'GET' ? 'list' : '');

  try {
    if (req.method === 'GET') {
      if (action === 'list') return await handleList(url);
      if (action === 'get')  return await handleGet(url);
      return jsonError(400, 'BAD_ACTION', `Unknown GET action: ${action}`);
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      switch (action) {
        case 'save':        return await handleSave(body);
        case 'rename':      return await handleRename(body);
        case 'duplicate':   return await handleDuplicate(body);
        case 'delete':      return await handleSoftDelete(body);
        case 'restore':     return await handleRestore(body);
        case 'hard-delete': return await handleHardDelete(body);
        default: return jsonError(400, 'BAD_ACTION', `Unknown POST action: ${action}`);
      }
    }
    return new Response('Method not allowed', { status: 405 });
  } catch (e) {
    const msg = e?.message || String(e);

    // ORDER MATTERS: check column-missing forms BEFORE table-missing forms,
    // because PostgREST conflates the two — column-missing messages
    // mention "of relation X" and "schema cache" which both spuriously
    // match the broader table-not-exist regexes.
    //
    // Column-missing fingerprints across PostgREST versions:
    //   42703  + "column \"X\" of relation \"Y\" does not exist"
    //   PGRST204 + "Could not find the 'X' column of 'Y' in the schema cache"
    if (
      e?.code === '42703' ||
      e?.code === 'PGRST204' ||
      e?.colName ||                              // set by sb() retry on column-missing
      /column .* does not exist/i.test(msg) ||
      /Could not find the .* column/i.test(msg)
    ) {
      const colName = e?.colName
        || /column [\"']?([\w_]+)/i.exec(msg)?.[1]
        || /'([\w_]+)' column of/i.exec(msg)?.[1]
        || 'optional column';
      const migration = colName === 'character_cards' ? '016_qss_character_cards.sql'
                      : colName === 'freestyle_chat' || colName === 'freestyle_themes' ? '017_qss_freestyle.sql'
                      : 'the latest migration in supabase/migrations/';
      return jsonError(503, 'COLUMN_MISSING',
        `The ${colName} column doesn't exist yet — apply ${migration} in the Supabase SQL editor. Until then non-essential data saves locally only.`);
    }

    // Real table-missing — qss_stories itself doesn't exist.
    if (
      e?.code === '42P01' ||
      e?.code === 'PGRST205' ||
      /Could not find the table/i.test(msg) ||
      /relation "?qss_stories"? does not exist/i.test(msg) ||
      // Match the table-cache variant but NOT the column-cache variant
      // (the column-cache one says "column X of Y in the schema cache",
      // never "table Y in the schema cache"). Anchor on "the table".
      /table .* schema cache/i.test(msg)
    ) {
      return jsonError(503, 'MIGRATION_PENDING',
        'The qss_stories table does not exist yet. Apply supabase/migrations/015_qss_stories.sql in the Supabase SQL editor.');
    }

    if (e?.code === '23505') {
      return jsonError(409, 'NAME_TAKEN', 'Another story already uses that name. Pick a different one.');
    }
    console.error('[qss-stories]', e);
    return jsonError(500, 'INTERNAL', msg.slice(0, 400));
  }
}

// ────────────────────── handlers ──────────────────────

async function handleList(url) {
  const includeTrash = url.searchParams.get('trash') === '1';
  // World isolation — each world's library is independent. Default world
  // (queen-scarlet) sees legacy NULL-world rows; other worlds only see
  // their own rows.
  const world = (url.searchParams.get('world') || url.searchParams.get('world_slug') || 'queen-scarlet').toLowerCase();
  // We need `blocks` in the SELECT so we can compute block_count
  // server-side. The PostgREST inline computed-column syntax
  // (block_count:blocks->jsonb_array_length) silently returned NULL on
  // this deployment, which caused EVERY story to display "0 blocks" in
  // the library — making Johnny think his work was gone. Pulling the raw
  // blocks payload and counting in JS is the reliable path. We strip
  // blocks from the response so the wire stays lean.
  const cols = 'id,name,deleted_at,created_at,updated_at,cover_image,world_slug,blocks';
  const filter = includeTrash ? 'deleted_at=not.is.null' : 'deleted_at=is.null';
  const worldFilter = world === 'queen-scarlet'
    ? `or=(world_slug.eq.queen-scarlet,world_slug.is.null)`
    : `world_slug=eq.${encodeURIComponent(world)}`;
  const params = new URLSearchParams({
    select: cols,
    [filter.split('=')[0]]: filter.split('=').slice(1).join('='),
    order: 'updated_at.desc',
    limit: '500',
  });
  const queryStr = params.toString() + `&${worldFilter}`;

  let data;
  try {
    data = await sb('GET', `qss_stories?${queryStr}`);
  } catch (e) {
    if (/world_slug/i.test(e?.message || '') && /column.*does not exist|schema cache/i.test(e?.message || '')) {
      // Migration 021 not applied yet — fall back to no world filter.
      const fallback = new URLSearchParams({
        select: 'id,name,deleted_at,created_at,updated_at,cover_image,blocks',
        [filter.split('=')[0]]: filter.split('=').slice(1).join('='),
        order: 'updated_at.desc',
        limit: '500',
      });
      data = await sb('GET', `qss_stories?${fallback}`);
    } else {
      throw e;
    }
  }
  const stories = (data || []).map(r => ({
    id: r.id,
    name: r.name,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    cover_image: r.cover_image || null,
    // Compute block_count from the raw blocks payload — the PostgREST
    // inline jsonb_array_length aliased select returned NULL on prod,
    // so we count here. blocks itself is NOT shipped to the client (it's
    // potentially multi-KB per story; opening a story still does a full
    // ?action=get fetch).
    block_count: Array.isArray(r.blocks) ? r.blocks.length : 0,
    world_slug: r.world_slug || 'queen-scarlet',
  }));
  return jsonOk({ stories });
}

async function handleGet(url) {
  const id = url.searchParams.get('id');
  if (!id) return jsonError(400, 'BAD_REQUEST', 'Missing id');
  const rows = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}&limit=1`);
  if (!rows?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
  return jsonOk({ story: rows[0] });
}

async function handleSave(body) {
  const name = (body.name || '').toString().trim();
  if (!name) return jsonError(400, 'BAD_REQUEST', 'name is required');

  const worldSlug = sanitizeWorldSlug(body.world_slug || body.world);

  const payload = {
    name,
    bible: typeof body.bible === 'string' ? body.bible : undefined,
    rules: body.rules ?? undefined,
    blocks: Array.isArray(body.blocks) ? sanitizeBlocks(body.blocks) : undefined,
    chat: Array.isArray(body.chat) ? sanitizeChat(body.chat) : undefined,
    suggestions: Array.isArray(body.suggestions) ? body.suggestions : undefined,
    cover_image: body.cover_image === null ? null : (typeof body.cover_image === 'string' ? body.cover_image : undefined),
    character_cards: Array.isArray(body.character_cards) ? sanitizeCharacterCards(body.character_cards) : undefined,
    freestyle_chat:   Array.isArray(body.freestyle_chat)   ? sanitizeFreestyleChat(body.freestyle_chat)     : undefined,
    freestyle_themes: Array.isArray(body.freestyle_themes) ? sanitizeFreestyleThemes(body.freestyle_themes) : undefined,
    world_slug: worldSlug,
  };
  // Drop undefineds so we send a partial update.
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  if (body.id) {
    // UPDATE with optimistic concurrency.
    const id = body.id;
    const expected = body.expectedUpdatedAt;
    let query = `qss_stories?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`;
    if (expected) query += `&updated_at=eq.${encodeURIComponent(expected)}`;
    const rows = await sb('PATCH', query, payload, { returnRepresentation: true });
    if (!rows?.length) {
      // Either id is wrong or row changed elsewhere. Probe to disambiguate.
      const probe = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(id)}&select=id,updated_at,deleted_at&limit=1`);
      if (!probe?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
      return jsonError(409, 'CONFLICT', 'Story was modified elsewhere', { serverUpdatedAt: probe[0].updated_at });
    }
    assertWorldSlugPersisted(rows[0], worldSlug);
    return jsonOk({ story: rows[0] });
  }

  // INSERT (new story).
  const rows = await sb('POST', `qss_stories?select=${SELECT_COLS}`, payload, { returnRepresentation: true });
  assertWorldSlugPersisted(rows[0], worldSlug);
  return jsonOk({ story: rows[0] });
}

// Invariant: the returned row must carry the world_slug we sent. If it
// doesn't, something silently stripped it (the old OPTIONAL_COLS retry
// path was THE culprit). Refuse to lie to the client — surface the
// regression loudly so it can't sit in the DB unnoticed for weeks.
function assertWorldSlugPersisted(row, sentSlug) {
  if (!row) return;
  if (row.world_slug === sentSlug) return;
  console.error('[qss-stories] world_slug regression', {
    sent: sentSlug,
    stored: row.world_slug,
    id: row.id,
    name: row.name,
  });
  const e = new Error(`world_slug silently dropped on save (sent=${sentSlug}, stored=${row.world_slug ?? 'null'}). Refusing to return success.`);
  e.code = 'WORLD_SLUG_REGRESSION';
  throw e;
}

// Whitelist active world slugs — anything else falls back to queen-scarlet
// (the default) so a malformed client can't poison the world_slug column.
function sanitizeWorldSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (slug === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

async function handleRename(body) {
  const id = body.id;
  const name = (body.name || '').toString().trim();
  if (!id || !name) return jsonError(400, 'BAD_REQUEST', 'id and name are required');
  let q = `qss_stories?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`;
  if (body.expectedUpdatedAt) q += `&updated_at=eq.${encodeURIComponent(body.expectedUpdatedAt)}`;
  const rows = await sb('PATCH', q, { name }, { returnRepresentation: true });
  if (!rows?.length) {
    const probe = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(id)}&select=id,updated_at&limit=1`);
    if (!probe?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
    return jsonError(409, 'CONFLICT', 'Story was modified elsewhere', { serverUpdatedAt: probe[0].updated_at });
  }
  return jsonOk({ story: rows[0] });
}

async function handleDuplicate(body) {
  const id = body.id;
  if (!id) return jsonError(400, 'BAD_REQUEST', 'id is required');
  const source = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}&limit=1`);
  if (!source?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
  const src = source[0];
  const baseName = (body.newName || `${src.name} (copy)`).toString().trim();
  // Try the requested name, then escalate with (2), (3), ... if taken.
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? baseName : `${baseName} (${n + 1})`;
    const payload = {
      name: candidate,
      bible: src.bible || '',
      rules: src.rules || {},
      blocks: src.blocks || [],
      chat: src.chat || [],
      suggestions: src.suggestions || [],
      cover_image: src.cover_image || null,
      world_slug: sanitizeWorldSlug(src.world_slug),
    };
    try {
      const rows = await sb('POST', `qss_stories?select=${SELECT_COLS}`, payload, { returnRepresentation: true });
      return jsonOk({ story: rows[0] });
    } catch (e) {
      if (e?.code === '23505') continue;
      throw e;
    }
  }
  return jsonError(409, 'NAME_TAKEN', 'Couldn\'t find an available name after 50 tries');
}

async function handleSoftDelete(body) {
  if (!body.id) return jsonError(400, 'BAD_REQUEST', 'id is required');
  await sb('PATCH', `qss_stories?id=eq.${encodeURIComponent(body.id)}`, { deleted_at: new Date().toISOString() });
  return jsonOk({ ok: true });
}

async function handleRestore(body) {
  if (!body.id) return jsonError(400, 'BAD_REQUEST', 'id is required');
  const rows = await sb('PATCH', `qss_stories?id=eq.${encodeURIComponent(body.id)}&select=${SELECT_COLS}`, { deleted_at: null }, { returnRepresentation: true });
  if (!rows?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
  return jsonOk({ story: rows[0] });
}

async function handleHardDelete(body) {
  if (!body.id) return jsonError(400, 'BAD_REQUEST', 'id is required');
  // Only allow hard-delete on rows already soft-deleted — guards against
  // accidental purges from a stale client.
  const probe = await sb('GET', `qss_stories?id=eq.${encodeURIComponent(body.id)}&select=id,deleted_at&limit=1`);
  if (!probe?.length) return jsonError(404, 'NOT_FOUND', 'Story not found');
  if (!probe[0].deleted_at) return jsonError(409, 'NOT_TRASH', 'Soft-delete the story first');
  await sb('DELETE', `qss_stories?id=eq.${encodeURIComponent(body.id)}`);
  return jsonOk({ ok: true });
}

// ────────────────────── supabase REST helper ──────────────────────

async function sb(method, path, payload, opts = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  // Ask PostgREST to return the modified row(s) when we want them.
  if (opts.returnRepresentation) headers['Prefer'] = 'return=representation';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON; keep null */ }
  }
  if (!res.ok) {
    const err = new Error(data?.message || text || `Supabase ${res.status}`);
    err.code = data?.code || `HTTP_${res.status}`;
    err.details = data?.details;
    err.hint = data?.hint;

    // OPTIONAL-COLUMN FALLBACK
    //
    // PostgREST reports a missing JSONB column in TWO different ways
    // depending on whether the column appears in `?select=` (returns code
    // '42703') or only in the JSON body (returns code 'PGRST204' with
    // message "Could not find the 'X' column of 'qss_stories' in the
    // schema cache"). Both forms also mention 'schema cache' which causes
    // a separate table-not-exist regex to spuriously fire — so we have
    // to detect BOTH variants here and short-circuit the retry before
    // anything mistakes a missing column for a missing table.
    const errMsg = (err.message || '').toString();
    const missingColMatch = /(?:column "([\w_]+)" of relation|column .* "([\w_]+)" does not exist|column '([\w_]+)' of|"([\w_]+)" column of)/i.exec(errMsg);
    const missingColName = missingColMatch && (missingColMatch[1] || missingColMatch[2] || missingColMatch[3] || missingColMatch[4]) || '';
    // If the missing column is REQUIRED (e.g. world_slug), refuse to fall
    // back. Stripping it would silently write a corrupt row. Surface the
    // schema error so a human can fix the migration. THE bug we shipped:
    // a stale schema-cache warning about character_cards caused world_slug
    // to be stripped too, persisting world_slug=null and making the story
    // disappear from its world's library.
    if (missingColName && REQUIRED_COLS.includes(missingColName)) {
      const e2 = new Error(`REQUIRED column "${missingColName}" reported missing — refusing to strip. Apply migration 021 (qss_worlds_and_canon).`);
      e2.code = 'REQUIRED_COL_MISSING';
      e2.colName = missingColName;
      throw e2;
    }

    const isColMissing = err.code === '42703'
      || err.code === 'PGRST204'
      || /column .* does not exist/i.test(errMsg)
      || /Could not find the .* column/i.test(errMsg)
      || (missingColName && OPTIONAL_COLS.includes(missingColName));

    if (isColMissing) {
      let strippedPath = path;
      let strippedPayload = payload;
      let touched = false;
      // Strip every OPTIONAL_COL from path + payload — cheaper than
      // figuring out which one triggered it, and harmless if a col
      // is absent.
      for (const col of OPTIONAL_COLS) {
        if (strippedPath && strippedPath.includes(col)) {
          strippedPath = strippedPath
            .replace(new RegExp(`,${col}\\b`, 'g'), '')
            .replace(new RegExp(`\\b${col},`, 'g'), '')
            .replace(new RegExp(`\\b${col}\\b`, 'g'), '');
          touched = true;
        }
        if (strippedPayload && typeof strippedPayload === 'object' && col in strippedPayload) {
          strippedPayload = { ...strippedPayload };
          delete strippedPayload[col];
          touched = true;
        }
      }
      if (touched) {
        const retryRes = await fetch(`${SUPABASE_URL}/rest/v1/${strippedPath}`, {
          method,
          headers,
          body: strippedPayload !== undefined ? JSON.stringify(strippedPayload) : undefined,
        });
        const retryText = await retryRes.text();
        let retryData = null;
        if (retryText) { try { retryData = JSON.parse(retryText); } catch {} }
        if (retryRes.ok) return retryData;
        // Retry also failed — surface a precise column-missing error
        // so the dispatcher can route to COLUMN_MISSING (not the
        // misleading MIGRATION_PENDING).
        const e2 = new Error(`column ${missingColName || 'optional col'} missing after retry: ${retryText.slice(0, 200)}`);
        e2.code = '42703';
        e2.colName = missingColName;
        throw e2;
      }
    }

    throw err;
  }
  return data;
}

// ────────────────────── sanitizers ──────────────────────

// Sanitize blocks before persisting.
//
// CRITICAL HISTORY (same shape as the cast portrait fix): this
// function previously stripped __image and __cues on every save with
// the comment "they live in localStorage as base64 — too big for
// cloud rows". That was true for the OLD design where images were
// inline base64. The new Storybook design moved per-cue images to
// Supabase Storage (qss-scenes bucket) and stores only the URL on
// b.__image / b.__cues[i].image. The old sanitizer kept stripping
// them, so every save deleted the URLs, every load got back blocks
// with no image refs, and every Storybook open re-generated all
// images from scratch. Henry described the same bug class on the
// cast page ("you fixed it forever last time"). The fix is the same
// pattern: preserve the full shape with hard byte caps so a runaway
// story can't crash the row.
function sanitizeBlocks(blocks) {
  const MAX_BLOCKS = 200;
  const MAX_TEXT = 12_000;
  const MAX_SUMMARY = 240;
  const MAX_CUES_PER_BLOCK = 24;
  const MAX_URL_LEN = 2000;
  const MAX_SOURCE_TEXT = 1500;
  // BUMPED 2026-05-25 — old 600KB cap was silently dropping nano-banana
  // jpegs (~1.3MB) when Supabase Storage upload failed. New 2.5MB cap
  // ensures a fresh variation NEVER vanishes from the save, even if the
  // CDN upload didn't complete. Total per-story cap raised to 8MB to
  // keep multi-image stories safe.
  const MAX_INLINE_IMG_BYTES = 2.5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
  let totalBytes = 0;
  const out = [];
  for (const b of (blocks || []).slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== 'object') continue;
    const id = b.id;
    if (!id) continue;
    const cleanImage = (im) => {
      if (!im || typeof im !== 'object') return undefined;
      const o = {};
      if (typeof im.url === 'string' && im.url.length <= MAX_URL_LEN) o.url = im.url;
      if (typeof im.mimeType === 'string' && im.mimeType.length <= 64) o.mimeType = im.mimeType;
      // Only keep inline base64 if no URL is present (fallback path)
      if (!o.url && typeof im.dataBase64 === 'string' && im.dataBase64.length <= MAX_INLINE_IMG_BYTES) {
        const sz = im.dataBase64.length;
        if (totalBytes + sz <= MAX_TOTAL_BYTES) {
          o.dataBase64 = im.dataBase64;
          totalBytes += sz;
        }
      }
      return (o.url || o.dataBase64) ? o : undefined;
    };
    const cleanVariations = (variations) => {
      if (!Array.isArray(variations)) return undefined;
      const MAX_VARIATIONS = 12;
      // LOVED-AWARE PRUNING — if we have more than MAX_VARIATIONS, keep
      // every LOVED variation + the most recent unloved ones, oldest
      // unloved get dropped first. Stable sort: preserve original order.
      let working = variations.slice();
      if (working.length > MAX_VARIATIONS) {
        const loved = working.filter(v => v?.loved);
        const unloved = working.filter(v => !v?.loved);
        const keepUnlovedCount = Math.max(0, MAX_VARIATIONS - loved.length);
        // Keep the MOST RECENT unloved (last in array). Drop oldest.
        const keptUnloved = unloved.slice(-keepUnlovedCount);
        // Re-merge preserving original order
        const keepSet = new Set([...loved, ...keptUnloved].map(v => v.id));
        working = variations.filter(v => keepSet.has(v.id));
      }
      const out = [];
      for (const v of working) {
        if (!v || typeof v !== 'object' || !v.id) continue;
        const item = {
          id: String(v.id).slice(0, 80),
          mimeType: typeof v.mimeType === 'string' ? v.mimeType.slice(0, 64) : undefined,
          created_at: Number.isFinite(v.created_at) ? v.created_at : Date.now(),
        };
        if (typeof v.url === 'string' && v.url.length <= MAX_URL_LEN) item.url = v.url;
        if (!item.url && typeof v.dataBase64 === 'string' && v.dataBase64.length <= MAX_INLINE_IMG_BYTES) {
          if (totalBytes + v.dataBase64.length <= MAX_TOTAL_BYTES) {
            item.dataBase64 = v.dataBase64;
            totalBytes += v.dataBase64.length;
          }
        }
        if (v.loved) item.loved = true;
        if (typeof v.riff === 'string' && v.riff.length) item.riff = v.riff.slice(0, 600);
        if (item.url || item.dataBase64) out.push(item);
      }
      return out.length ? out : undefined;
    };
    const cleanCues = (cues) => {
      if (!Array.isArray(cues)) return undefined;
      const list = [];
      for (const c of cues.slice(0, MAX_CUES_PER_BLOCK)) {
        if (!c || typeof c !== 'object' || !c.id) continue;
        const item = {
          id: String(c.id).slice(0, 80),
          offset: Number.isFinite(c.offset) ? Math.max(0, Math.floor(c.offset)) : 0,
          auto: !!c.auto,
        };
        if (typeof c.source_text === 'string') item.source_text = c.source_text.slice(0, MAX_SOURCE_TEXT);
        if (typeof c.label === 'string') item.label = c.label.slice(0, 120);
        if (typeof c.why === 'string') item.why = c.why.slice(0, 240);
        const img = cleanImage(c.image);
        if (img) item.image = img;
        // NEW — variations carousel + active pointer
        const vars = cleanVariations(c.variations);
        if (vars) item.variations = vars;
        if (typeof c.active_variation_id === 'string') {
          item.active_variation_id = c.active_variation_id.slice(0, 80);
        }
        list.push(item);
      }
      return list.length ? list : undefined;
    };
    const blk = {
      id,
      text: typeof b.text === 'string' ? b.text.slice(0, MAX_TEXT) : '',
    };
    if (typeof b.summary === 'string' && b.summary.trim()) {
      blk.summary = b.summary.slice(0, MAX_SUMMARY);
    }
    const img = cleanImage(b.__image);
    if (img) blk.__image = img;
    const cues = cleanCues(b.__cues);
    if (cues) blk.__cues = cues;
    if (typeof b.__sceneBreaksScanned === 'string' && b.__sceneBreaksScanned.length <= 32) {
      blk.__sceneBreaksScanned = b.__sceneBreaksScanned;
    }
    // Kept for backwards-compat with anything reading has_image
    blk.has_image = !!img;
    out.push(blk);
  }
  return out;
}

// Sanitize character cards before persisting. Each card is bounded so a
// rogue payload can't blow past Postgres's 8 MB row limit. Drop entries
// with no name; coerce image payload; clamp synopsis length.
//
// CRITICAL HISTORY: this function previously stripped portraits[],
// visual_notes, chat, primary_portrait_id, and loved flags on every save.
// The cast page calls /api/qss-stories?action=save with the full shape,
// the server wrote back the stripped shape, and the main tool's
// hydrateFromServer then overwrote in-memory cards with the lossy
// version — destroying portrait history, loved flags, and visual notes
// on round-trip. Now preserved with hard caps so a runaway story can't
// crash the row.
function sanitizeCharacterCards(cards) {
  const MAX_CARDS = 24;
  const MAX_SYNOPSIS = 1200;
  const MAX_VISUAL_NOTES = 600;
  const MAX_IMAGE_BYTES = 600 * 1024;       // ~600 KB base64 (per-image)
  const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024; // ~3.5 MB total across all cards
  const MAX_PORTRAITS_PER_CARD = 10;
  const MAX_CHAT_TURNS = 50;
  const MAX_CHAT_LEN = 1200;
  const out = [];
  let totalBytes = 0;
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.name || '').trim();
    if (!name) continue;
    const synopsis = String(c.synopsis || '').slice(0, MAX_SYNOPSIS);
    const visual_notes = String(c.visual_notes || '').slice(0, MAX_VISUAL_NOTES);
    let image = null;
    if (c.image && typeof c.image === 'object') {
      const dataBase64 = typeof c.image.dataBase64 === 'string' ? c.image.dataBase64 : '';
      if (dataBase64 && dataBase64.length <= MAX_IMAGE_BYTES) {
        image = {
          mime: String(c.image.mime || 'image/png').slice(0, 32),
          dataBase64,
        };
      }
    }
    // Portraits — preserve full history (Henry refines characters over
    // many redraws). Drop any portrait whose base64 exceeds the per-image
    // cap or stop accumulating once we exceed the total byte budget.
    const portraits = [];
    const rawPortraits = Array.isArray(c.portraits) ? c.portraits.slice(-MAX_PORTRAITS_PER_CARD) : [];
    for (const p of rawPortraits) {
      if (!p || typeof p !== 'object') continue;
      const dataBase64 = typeof p.dataBase64 === 'string' ? p.dataBase64 : '';
      if (!dataBase64 || dataBase64.length > MAX_IMAGE_BYTES) continue;
      if (totalBytes + dataBase64.length > MAX_TOTAL_BYTES) break;
      totalBytes += dataBase64.length;
      portraits.push({
        id: String(p.id || '').slice(0, 32),
        mime: String(p.mime || 'image/png').slice(0, 32),
        dataBase64,
        generated_at: Number(p.generated_at) || Date.now(),
        note: typeof p.note === 'string' ? p.note.slice(0, 200) : '',
        loved: !!p.loved,
      });
    }
    // Chat — last N turns only, with per-turn cap. Wordy <-> Henry on this
    // character's "what should they look like" thread.
    const chat = [];
    const rawChat = Array.isArray(c.chat) ? c.chat.slice(-MAX_CHAT_TURNS) : [];
    for (const m of rawChat) {
      if (!m || typeof m !== 'object') continue;
      chat.push({
        id: String(m.id || '').slice(0, 32),
        role: m.role === 'wordy' ? 'wordy' : 'henry',
        content: String(m.content || '').slice(0, MAX_CHAT_LEN),
        ts: Number(m.ts) || Date.now(),
      });
    }
    out.push({
      name,
      synopsis,
      visual_notes,
      image,
      portraits,
      primary_portrait_id: typeof c.primary_portrait_id === 'string' ? c.primary_portrait_id.slice(0, 32) : null,
      chat,
      generated_at: typeof c.generated_at === 'number' ? c.generated_at : Date.now(),
      current_state: typeof c.current_state === 'string' ? c.current_state.slice(0, 400) : '',
      intro_block: Number(c.intro_block) || null,
    });
    if (out.length >= MAX_CARDS) break;
    if (totalBytes > MAX_TOTAL_BYTES) break;
  }
  return out;
}

// Freestyle chat is a flat list of {id, role, content, ts}. Bounded so a
// chatty session can't push the row past 8 MB.
function sanitizeFreestyleChat(arr) {
  const MAX_TURNS = 200;
  const MAX_LEN = 4000;
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'wordy' || m.role === 'assistant' ? 'wordy' : 'kid';
    const content = String(m.content || '').slice(0, MAX_LEN);
    if (!content.trim()) continue;
    out.push({
      id: String(m.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 10),
      role,
      content,
      ts: typeof m.ts === 'number' ? m.ts : Date.now(),
    });
    if (out.length >= MAX_TURNS) break;
  }
  return out;
}

// Captured themes — just labels + notes; bounded.
function sanitizeFreestyleThemes(arr) {
  const MAX = 80;
  const out = [];
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue;
    const label = String(t.label || '').trim().slice(0, 80);
    if (!label) continue;
    out.push({
      id: String(t.id || '').slice(0, 64) || Math.random().toString(36).slice(2, 10),
      label,
      note: String(t.note || '').trim().slice(0, 240),
      captured_at: typeof t.captured_at === 'number' ? t.captured_at : Date.now(),
      promoted: !!t.promoted,
    });
    if (out.length >= MAX) break;
  }
  return out;
}

// Strip image bytes from chat turns (options with their text are kept;
// any embedded image payloads are dropped).
function sanitizeChat(chat) {
  return chat.map(t => {
    const out = { id: t.id, role: t.role };
    if (typeof t.content === 'string') out.content = t.content;
    if (t.kind) out.kind = t.kind;
    if (t.sceneId) out.sceneId = t.sceneId;
    if (Array.isArray(t.options)) {
      out.options = t.options.map(o => ({
        id: o.id,
        kind: o.kind || '',
        text: typeof o.text === 'string' ? o.text : '',
        added: !!o.added,
      }));
    }
    return out;
  });
}

// ────────────────────── response helpers ──────────────────────

function jsonOk(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
function jsonError(status, code, message, extra = null) {
  return new Response(JSON.stringify({ error: code, message, ...(extra || {}) }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
// Wrap a pre-built Response (e.g. the access-denied one) with CORS headers
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
