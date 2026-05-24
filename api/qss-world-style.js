// queen-scarlet-school: per-world art style + canon editor.
//
// GET  /api/qss-world-style?world=<slug>     → { world: {slug, name, art_style, canon_text, ...} }
// PUT  /api/qss-world-style?world=<slug>     → updates art_style + canon_text from body
//      body shape: { art_style: {styleBlock, references, dontList, paper}, canon_text: "..." }
//
// Drives the World Style Hub UI at /universe/<world>/style/.
//
// Reads/writes the public.qss_worlds row keyed by slug. The art_style
// jsonb gets read at draw time by qss-character-card and qss-explorer
// via the loadWorldStyle helper in api/_lib/qss-worlds.js — DB value
// wins, bundled hardcoded defaults are the fallback.

import { checkAccess } from './_lib/access.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

const SELECT_COLS = 'slug,name,short_name,tagline,art_style,canon_text,updated_at';

function sanitizeWorldSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'burgundy') return 'burgundy';
  return 'queen-scarlet';
}

function j(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function sb(method, path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`supabase_${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) {
    const h = new Headers(denied.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(denied.body, { status: denied.status, headers: h });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) return j(500, { error: 'no_db' });

  const url = new URL(req.url);
  const world = sanitizeWorldSlug(url.searchParams.get('world'));

  try {
    if (req.method === 'GET') {
      const rows = await sb('GET', `qss_worlds?slug=eq.${encodeURIComponent(world)}&select=${SELECT_COLS}&limit=1`);
      if (!rows?.length) return j(404, { error: 'world_not_found' });
      return j(200, { world: rows[0] });
    }

    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}));
      const patch = {};
      // Only accept the editable fields. Reject everything else so a
      // typo doesn't accidentally rewrite a column we didn't intend.
      if (body.art_style && typeof body.art_style === 'object') {
        patch.art_style = sanitizeArtStyle(body.art_style);
      }
      if (typeof body.canon_text === 'string') {
        patch.canon_text = String(body.canon_text).slice(0, 20000);
      }
      if (!Object.keys(patch).length) return j(400, { error: 'no_editable_fields' });
      patch.updated_at = new Date().toISOString();
      const rows = await sb('PATCH', `qss_worlds?slug=eq.${encodeURIComponent(world)}&select=${SELECT_COLS}`, patch);
      if (!rows?.length) return j(404, { error: 'world_not_found' });
      return j(200, { world: rows[0] });
    }

    return j(405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error('[qss-world-style]', e);
    return j(500, { error: 'internal', detail: (e?.message || String(e)).slice(0, 300) });
  }
}

// Allowed-field whitelist for art_style. Each field is hard-capped to
// avoid run-away token bombs in the generated prompts. The four fields
// match what qss-character-card and qss-explorer actually read.
function sanitizeArtStyle(raw) {
  const out = {};
  const MAX = 8000;
  for (const k of ['styleBlock', 'references', 'dontList', 'paper']) {
    if (typeof raw[k] === 'string') out[k] = raw[k].slice(0, MAX);
  }
  return out;
}
