export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';
import { checkAccess } from './_lib/access.js';

/**
 * Script Library — GENERALIZED per-project cloud doc (Enterprise Wave 2).
 *
 * The multi-project, login-gated successor to api/burma-script-doc.js. Where that endpoint hardcodes
 * a single row id ('wp01-burma') and fails open, this one:
 *   • serves ANY project by ?project=<slug|uuid> against public.script_projects / public.script_docs
 *   • REQUIRES sign-in (checkAccess) on the write path — logged-in teammates already send their JWT
 *     via the gate.js fetch interceptor, so no per-device token to provision and nothing to jam
 *   • does a true COMPARE-AND-SWAP when the client sends baseVersion (accept only if the stored
 *     version still equals the base the client built on), falling back to strictly-greater otherwise
 *   • appends every accepted doc to public.script_doc_revisions — an append-only history so no save
 *     can ever destroy the previous version (the "restore forever" backstop)
 *
 *   GET  /api/script-doc?project=<slug|uuid>            -> { doc, version }  ({doc:null,version:0} empty)
 *   PUT  /api/script-doc?project=<slug|uuid>  { doc, version, baseVersion? }
 *        accepted -> { version }               (also writes a revisions row)
 *        stale    -> 409 { doc, version }       (the current row, so the client snapshots-and-adopts)
 *
 * The legacy burma_script_docs row is intentionally NOT touched by this endpoint — it stays as a
 * fallback until the client is fully cut over. DB access uses the service-role key (bypasses RLS);
 * the new tables are RLS-locked to interpreter-access users, so the anon key gets nothing.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Code',
  'Access-Control-Max-Age': '86400',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);
  const projectRef = url.searchParams.get('project') || '';
  if (!projectRef) return err(400, 'NO_PROJECT', 'project (slug or id) query param required');

  try {
    if (req.method === 'GET') {
      // Reads are open to anyone who got past the site gate (matches burma-script-doc GET, and the
      // ?read share model). The write path is the one that must be signed in.
      const pid = await resolveProjectId(projectRef);
      if (!pid) return ok({ doc: null, version: 0 }); // unknown project reads empty, not an error
      return await getDoc(pid);
    }

    if (req.method === 'PUT') {
      // WRITE GATE — must be signed in. checkAccess returns null when authorized (or in dev with no
      // ACCESS_CODE set), or a 401 Response when not. This replaces the never-installed write token:
      // it can't "fail open" the way the token gate did, and a logged-in teammate needs no provisioning.
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);

      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const v = validatePutBody(body);
      if (!v.ok) return err(400, v.code, v.message);

      const pid = await resolveProjectId(projectRef);
      if (!pid) return err(404, 'NO_PROJECT', 'unknown project');
      return await putDoc(pid, v);
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* ---------------------------------------------------------------- resolve */

// A project ref is either a UUID (direct id) or a slug. Returns the project id, or null if unknown.
async function resolveProjectId(ref) {
  if (UUID_RE.test(ref)) return ref;
  const r = await sb(`/rest/v1/script_projects?slug=eq.${pgrValue(ref)}&select=id&limit=1`);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows.length ? rows[0].id : null;
}

/* ------------------------------------------------------------------- read */

async function getDoc(pid) {
  const r = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  if (!rows.length) return ok({ doc: null, version: 0 });
  return ok({ doc: rows[0].doc ?? null, version: toVersion(rows[0].version) });
}

/* ------------------------------------------------------------------ write */

async function putDoc(pid, { doc, version, baseVersion }) {
  // Read current stored version to decide accept vs 409.
  const cur = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version`);
  if (!cur.ok) return err(502, 'DB_READ', await cur.text());
  const curRows = await cur.json();
  const exists = curRows.length > 0;
  const stored = exists ? toVersion(curRows[0].version) : 0;

  if (!isWriteAcceptable({ version, baseVersion, stored })) {
    return err409({ doc: exists ? (curRows[0].doc ?? null) : null, version: stored });
  }

  const nowIso = new Date().toISOString();
  if (!exists) {
    const ins = await sb(`/rest/v1/script_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ project_id: pid, doc, version, updated_at: nowIso }),
    });
    if (ins.ok) {
      const row = (await ins.json())[0];
      await appendRevision(pid, doc, version); // history from the very first save
      await touchProject(pid, nowIso);
      return ok({ version: toVersion(row?.version ?? version) });
    }
    // fall through to guarded update on the rare insert race
  }

  // GUARDED UPDATE — atomic backstop. Only patch when stored is still strictly less than incoming, so
  // a concurrent writer that landed between our read and here makes this a no-op (0 rows) not a stomp.
  const upd = await sb(
    `/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&version=lt.${pgrValue(version)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ doc, version, updated_at: nowIso }),
    }
  );
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const updated = await upd.json();
  if (updated.length) {
    await appendRevision(pid, doc, version);
    await touchProject(pid, nowIso);
    return ok({ version: toVersion(updated[0].version) });
  }

  // 0 rows — a concurrent writer won. Re-read and 409 with the current row.
  const re = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version`);
  const reRows = re.ok ? await re.json() : [];
  const reStored = reRows.length ? toVersion(reRows[0].version) : 0;
  return err409({ doc: reRows.length ? (reRows[0].doc ?? null) : null, version: reStored });
}

// Append-only history. Best-effort: a failed revision write never fails the (already-durable) save —
// but it's the backstop that makes "one bad save can't destroy the last good one" true.
async function appendRevision(pid, doc, version, source = 'autosave') {
  try {
    await sb(`/rest/v1/script_doc_revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: pid, doc, version, source }),
    });
  } catch {}
}

async function touchProject(pid, iso) {
  try {
    await sb(`/rest/v1/script_projects?id=eq.${pgrValue(pid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: iso }),
    });
  } catch {}
}

/* ---------------------------------------------------------------- helpers */

function toVersion(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function validatePutBody(body) {
  const doc = body?.doc;
  if (doc == null || typeof doc !== 'object') {
    return { ok: false, code: 'BAD_DOC', message: 'doc (object) required' };
  }
  const version = toVersion(body?.version);
  if (!(version > 0)) {
    return { ok: false, code: 'BAD_VERSION', message: 'version (positive integer) required' };
  }
  // baseVersion is OPTIONAL. When present it enables true compare-and-swap (accept only if the stored
  // version still equals what this client built on). Absent -> strictly-greater optimistic rule.
  const hasBase = body?.baseVersion !== undefined && body?.baseVersion !== null;
  const baseVersion = hasBase ? toVersion(body.baseVersion) : null;
  return { ok: true, doc, version, baseVersion };
}

// THE data-integrity contract. With baseVersion: strict compare-and-swap (the client must have built
// on the current stored version) AND the new version must advance past it. Without: strictly-greater
// optimistic rule (an empty/older/equal client can never overwrite newer cloud work).
function isWriteAcceptable({ version, baseVersion, stored }) {
  const v = toVersion(version);
  const s = toVersion(stored);
  if (baseVersion !== null && baseVersion !== undefined) {
    return toVersion(baseVersion) === s && v > s;
  }
  return v > s;
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
function err409(current) {
  return new Response(JSON.stringify({ error: { code: 'STALE', message: 'stored version is newer' }, ...current }), {
    status: 409, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
// checkAccess returns a bare 401 Response with no CORS headers; re-wrap it so the browser can read it.
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export { toVersion, validatePutBody, isWriteAcceptable, UUID_RE };
