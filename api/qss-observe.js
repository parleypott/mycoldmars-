import { checkAccess } from './_lib/access.js';
import { blockSignals } from './_lib/qss-signals.js';

export const config = { runtime: 'edge', maxDuration: 10 };

const SUPABASE_URL = process.env.QSS_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.QSS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-code',
};

/**
 * Log a behavioral observation. Server enriches with derived signals
 * (character mentions, sentence count, escalation score, etc.) before insert.
 *
 *   POST /api/qss-observe
 *   {
 *     story_id?: uuid,
 *     story_name: string,
 *     event: 'block_added' | 'block_deleted' | 'block_reordered'
 *          | 'direction_picked' | 'direction_rejected'
 *          | 'option_added' | 'option_rejected' | 'options_rejected_all'
 *          | 'own_block_added'
 *          | 'session_start' | 'rules_changed',
 *     payload: { text?, title?, vibe?, ... }
 *   }
 *
 * Fire-and-forget from the client — the response is just {ok:true} so the
 * observation never blocks UI.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const denied = await checkAccess(req);
  if (denied) return withCors(denied);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json(503, { error: 'NO_DB' });
  }

  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: 'BAD_JSON' }); }

  const event = (body.event || '').toString().trim();
  if (!event) return json(400, { error: 'event required' });

  const row = {
    story_id: body.story_id || null,
    story_name: (body.story_name || '').toString().slice(0, 200) || null,
    event,
    payload: body.payload || {},
    signals: deriveSignals(event, body.payload || {}, body.context || {}),
  };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/qss_observations`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const txt = await res.text();
      if (/Could not find the table|relation .* does not exist|PGRST205/.test(txt)) {
        return json(503, { error: 'MIGRATION_PENDING', message: 'Apply supabase/migrations/016_qss_observations.sql' });
      }
      return json(502, { error: 'DB', detail: txt.slice(0, 300) });
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: 'INTERNAL', message: e.message });
  }
}

export function deriveSignals(event, payload, context) {
  // The block_added / own_block_added / option_added events all involve a
  // text body that's worth full-signal extraction.
  const text =
    payload.text ||
    payload.option_text ||
    payload.block_text ||
    '';
  const extras = Array.isArray(context.bibleCharacters) ? context.bibleCharacters : [];
  if (event === 'block_added' || event === 'own_block_added' || event === 'option_added') {
    const sig = blockSignals(text, { extraCharacters: extras });
    if (event === 'own_block_added') sig.origin = 'kid';
    else if (payload.from === 'direction') sig.origin = 'direction';
    else sig.origin = 'option';
    if (payload.direction) sig.direction_title = payload.direction;
    return sig;
  }
  if (event === 'direction_picked' || event === 'direction_rejected') {
    return {
      title: payload.title || '',
      vibe: payload.vibe || '',
      description: payload.description || '',
    };
  }
  if (event === 'option_rejected' || event === 'options_rejected_all') {
    return { kind: payload.kind || '', preview: (text || '').slice(0, 200) };
  }
  return { ...payload };
}

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
