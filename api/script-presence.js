export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';
import { checkAccess } from './_lib/access.js';

/**
 * Script Library — BASIC PRESENCE (Enterprise Wave 2). "Who else is in this project right now."
 *
 *   POST /api/script-presence  { projectId, holderId, label, color?, sectionId? }   (login-gated)
 *        upserts one script_presence row (PK project_id + holder_id), stamping last_seen=now.
 *        -> { ok: true }
 *   GET  /api/script-presence?project=<slug|uuid>
 *        -> { holders: [ {holderId,label,color,sectionId,lastSeen} ] }  active in the last ~30s
 *
 * `projectId` / `?project=` accept a slug OR a uuid — resolved to the project id server-side, so the
 * library can pass a bare slug it already routes on. Rows older than the active window are simply not
 * returned (they age out naturally); a lightweight best-effort sweep also deletes them so the table
 * stays small. This is the FOUNDATION the soft-lock builds on later — no locking here.
 *
 * DB access uses the service-role key (RLS bypass); script_presence is RLS-locked to interpreter users.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Code',
  'Access-Control-Max-Age': '86400',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A holder is "present" if it heartbeat within this window. The client heartbeats every ~15s, so 30s
// tolerates one missed beat before a holder's dot disappears.
export const ACTIVE_WINDOW_MS = 30_000;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const ref = url.searchParams.get('project') || '';
      if (!ref) return err(400, 'NO_PROJECT', 'project (slug or id) query param required');
      const pid = await resolveProjectId(ref);
      if (!pid) return ok({ holders: [] }); // unknown project → nobody here, not an error
      return await listHolders(pid);
    }

    if (req.method === 'POST') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const v = validateHeartbeat(body);
      if (!v.ok) return err(400, v.code, v.message);
      const pid = await resolveProjectId(v.projectId);
      if (!pid) return err(404, 'NO_PROJECT', 'unknown project');
      return await heartbeat(pid, v);
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* ---------------------------------------------------------------- resolve */

async function resolveProjectId(ref) {
  if (UUID_RE.test(ref)) return ref;
  const r = await sb(`/rest/v1/script_projects?slug=eq.${pgrValue(ref)}&select=id&limit=1`);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows.length ? rows[0].id : null;
}

/* ------------------------------------------------------------------- read */

async function listHolders(pid) {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const r = await sb(
    `/rest/v1/script_presence?project_id=eq.${pgrValue(pid)}&last_seen=gte.${pgrValue(cutoff)}` +
      `&select=holder_id,holder_label,holder_color,section_id,last_seen&order=last_seen.desc`
  );
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  const holders = (Array.isArray(rows) ? rows : []).map((row) => ({
    holderId: row.holder_id,
    label: row.holder_label || '',
    color: row.holder_color || null,
    sectionId: row.section_id || null,
    lastSeen: row.last_seen || null,
  }));
  return ok({ holders });
}

/* ------------------------------------------------------------------ write */

async function heartbeat(pid, { holderId, label, color, sectionId }) {
  const nowIso = new Date().toISOString();
  const rowPayload = {
    project_id: pid,
    holder_id: holderId,
    holder_label: label,
    holder_color: color ?? null,
    section_id: sectionId ?? null,
    last_seen: nowIso,
  };
  // Upsert on the (project_id, holder_id) PK — merge-duplicates so a re-beat updates last_seen in place.
  const up = await sb(`/rest/v1/script_presence?on_conflict=project_id,holder_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rowPayload),
  });
  if (!up.ok) return err(502, 'DB_WRITE', await up.text());

  // Best-effort sweep of this project's stale rows so the table never grows unbounded. Never blocks the
  // heartbeat response on failure.
  try {
    const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
    await sb(`/rest/v1/script_presence?project_id=eq.${pgrValue(pid)}&last_seen=lt.${pgrValue(cutoff)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  } catch {}

  return ok({ ok: true });
}

/* ---------------------------------------------------------------- helpers */

// PURE — validates a heartbeat body. Exported for unit tests.
export function validateHeartbeat(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, code: 'BAD_BODY', message: 'body (object) required' };
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!projectId) return { ok: false, code: 'NO_PROJECT', message: 'projectId required' };
  const holderId = typeof body.holderId === 'string' ? body.holderId.trim() : '';
  if (!holderId) return { ok: false, code: 'NO_HOLDER', message: 'holderId required' };
  if (holderId.length > 200) return { ok: false, code: 'BAD_HOLDER', message: 'holderId too long' };
  let label = typeof body.label === 'string' ? body.label.trim() : '';
  if (label.length > 80) label = label.slice(0, 80);
  let color = null;
  if (body.color != null) {
    const c = String(body.color).trim();
    // Accept a hex color only; ignore anything else rather than store junk.
    if (/^#[0-9a-fA-F]{3,8}$/.test(c)) color = c;
  }
  let sectionId = null;
  if (body.sectionId != null) {
    const s = String(body.sectionId).trim();
    if (s) sectionId = s.slice(0, 200);
  }
  return { ok: true, projectId, holderId, label, color, sectionId };
}

async function sb(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_KEY}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
}

function ok(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export { UUID_RE };
