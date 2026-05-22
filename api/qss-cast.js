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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const denied = checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return jsonError(500, 'NO_DB', 'Supabase credentials not configured');
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    if (req.method === 'GET') return await handleList();
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (action === 'upsert')      return await handleUpsert(body);
      if (action === 'upsert-many') return await handleUpsertMany(body);
      if (action === 'delete')      return await handleDelete(body);
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

async function handleList() {
  const rows = await sb('GET', `qss_cast?select=${SELECT_COLS}&order=updated_at.desc&limit=500`);
  const characters = (rows || []).map(r => rowToCard(r));
  return jsonOk({ characters });
}

async function handleUpsert(body) {
  const card = sanitizeCard(body?.card);
  if (!card) return jsonError(400, 'BAD_CARD', 'card with name required');
  const row = cardToRow(card);
  await sb('POST', `qss_cast?on_conflict=name_key&select=${SELECT_COLS}`, row, {
    returnRepresentation: true,
    prefer: 'resolution=merge-duplicates',
  });
  return jsonOk({ ok: true });
}

async function handleUpsertMany(body) {
  const cards = Array.isArray(body?.cards) ? body.cards : [];
  if (!cards.length) return jsonOk({ ok: true, upserted: 0 });
  const rows = cards.map(sanitizeCard).filter(Boolean).map(cardToRow);
  if (!rows.length) return jsonOk({ ok: true, upserted: 0 });
  await sb('POST', `qss_cast?on_conflict=name_key`, rows, {
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return jsonOk({ ok: true, upserted: rows.length });
}

async function handleDelete(body) {
  const name = String(body?.name || '').trim();
  if (!name) return jsonError(400, 'BAD_NAME', 'name required');
  const key = name.toLowerCase();
  await sb('DELETE', `qss_cast?name_key=eq.${encodeURIComponent(key)}`);
  return jsonOk({ ok: true });
}

// ────────────────────── sanitize / row mapping ──────────────────────

function sanitizeCard(c) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name || '').trim();
  if (!name) return null;
  const MAX_PORTRAITS = 10;
  const MAX_IMAGE_BYTES = 600 * 1024;
  const MAX_CHAT = 200;
  const MAX_APPS = 80;
  const MAX_LEN = 1200;

  const portraits = Array.isArray(c.portraits) ? c.portraits.filter(p => p && typeof p === 'object').slice(-MAX_PORTRAITS) : [];
  const cleanPortraits = [];
  for (const p of portraits) {
    const dataBase64 = typeof p.dataBase64 === 'string' ? p.dataBase64 : '';
    if (!dataBase64) continue;
    if (dataBase64.length > MAX_IMAGE_BYTES * 1.4) continue;
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
