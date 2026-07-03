export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';
import { checkAccess } from './_lib/access.js';

/**
 * Script Library — SHARED PROJECT LIST (Enterprise Wave 2, the #1 multi-user fix).
 *
 * The cloud home for the list of script projects, so a teammate signing in on their own machine sees
 * every project the team made — not just what's in their own browser's localStorage. The library's
 * project-store.js treats this endpoint as the source of truth and keeps localStorage as an OFFLINE
 * CACHE that merges against it (cloud wins for shared visibility; local-only unsynced rows still show).
 *
 *   GET  /api/script-projects            -> { projects: [ {id,slug,title,episode,config,updated_at,trashed_at} ] }
 *        ?trashed=1                       -> the TRASHED list instead of the active one
 *   POST /api/script-projects  { slug, title, episode?, config? }   (login-gated)
 *        -> { project }  the created row
 *   PATCH /api/script-projects?id=<uuid>  { title? , trashed_at? , config? }   (login-gated)
 *        -> { project }  the updated row  (rename / trash / restore / config-update)
 *   DELETE /api/script-projects?id=<uuid>   (login-gated)   HARD DELETE — gone for EVERYONE
 *        -> { ok:true, id }   also cascades script_docs / script_doc_revisions / script_presence (FK
 *        on delete cascade). REFUSED (403) for the seeded burma/palau projects — those are precious and
 *        may be trashed/hidden but NEVER hard-deleted through this path.
 *
 * READS are open to anyone past the site gate (same posture as api/script-doc.js GET). WRITES require a
 * signed-in session — logged-in teammates already send their Supabase JWT via the gate.js fetch
 * interceptor, so there is nothing to provision. DB access uses the service-role key (bypasses RLS); the
 * script_projects table is RLS-locked to interpreter-access users, so the anon key gets nothing.
 *
 * This endpoint NEVER touches script_docs / script_doc_revisions — the per-doc storage is api/script-doc.js's
 * job and Burma's precious doc is not in scope here. It only manages the project LIST rows.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Code',
  'Access-Control-Max-Age': '86400',
};

// Seeded, precious projects that may be trashed/hidden but NEVER hard-deleted through the DELETE route.
// Guarded by SLUG (stable across rename) so Burma's once-lost live doc can't be purged for everyone.
const PROTECTED_SLUGS = new Set(['burma', 'palau', 'palau2']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A project slug: lowercase alnum + hyphens, 1-60 chars, no leading/trailing/double hyphen. This is the
// exact SHAPE generateSlug() produces on the client, so a slug that round-trips through the store is
// always valid here. Reserved routing keywords a slug must never shadow (mirrors project-store.js).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

// Columns the client needs — never SELECT * (keeps created_by out of the wire and the shape stable).
const SELECT_COLS = 'id,slug,title,episode,config,created_at,updated_at,trashed_at';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const trashed = url.searchParams.get('trashed') === '1';
      return await listProjects(trashed);
    }

    if (req.method === 'POST') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const v = validateCreateBody(body);
      if (!v.ok) return err(400, v.code, v.message);
      return await createProject(v);
    }

    if (req.method === 'PATCH') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id (uuid) query param required');
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const patch = buildPatch(body);
      if (!patch.ok) return err(400, patch.code, patch.message);
      return await patchProject(id, patch.fields);
    }

    if (req.method === 'DELETE') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id (uuid) query param required');
      return await deleteProject(id);
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* -------------------------------------------------------------------- list */

async function listProjects(trashed) {
  const filter = trashed ? 'trashed_at=not.is.null' : 'trashed_at=is.null';
  const r = await sb(`/rest/v1/script_projects?${filter}&select=${SELECT_COLS}&order=updated_at.desc`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  return ok({ projects: Array.isArray(rows) ? rows.map(projectView) : [] });
}

/* ------------------------------------------------------------------ create */

async function createProject({ slug, title, episode, config }) {
  const payload = {
    slug,
    title,
    episode: episode ?? null,
    config: config ?? {},
  };
  const ins = await sb(`/rest/v1/script_projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (ins.status === 409) {
    return err(409, 'SLUG_TAKEN', `slug "${slug}" already exists`);
  }
  if (!ins.ok) {
    const text = await ins.text();
    // Postgres unique-violation surfaces as a 409 from PostgREST, but be defensive about the message too.
    if (/duplicate key|unique constraint|23505/i.test(text)) {
      return err(409, 'SLUG_TAKEN', `slug "${slug}" already exists`);
    }
    return err(502, 'DB_WRITE', text);
  }
  const row = (await ins.json())[0];
  return ok({ project: projectView(row) }, 201);
}

/* ------------------------------------------------------------------- patch */

async function patchProject(id, fields) {
  const upd = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const rows = await upd.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_PROJECT', 'unknown project id');
  return ok({ project: projectView(rows[0]) });
}

/* ------------------------------------------------------------------ delete */

// HARD DELETE — removes the project row for EVERYONE (true multi-user purge). The FK on delete cascade
// on script_docs / script_doc_revisions / script_presence means the doc, its full revision history, and
// any presence rows go with it. We first read the row's slug to enforce the protected-slug guard: the
// seeded burma/palau projects are precious (Burma's once-lost live doc) and must never be purgeable this
// way. An unknown id 404s (idempotent-ish: nothing to delete). NEVER deletes a protected project.
async function deleteProject(id) {
  // Read the target's slug first — the guard is by slug (stable across rename), not by id.
  const look = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}&select=id,slug&limit=1`);
  if (!look.ok) return err(502, 'DB_READ', await look.text());
  const rows = await look.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_PROJECT', 'unknown project id');
  const slug = rows[0].slug || '';
  if (isProtectedSlug(slug)) {
    return err(403, 'PROTECTED', `"${slug}" is a seeded project and cannot be hard-deleted (trash it instead)`);
  }
  const del = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (!del.ok) return err(502, 'DB_WRITE', await del.text());
  return ok({ ok: true, id });
}

/* ---------------------------------------------------------------- helpers */

// PURE — is this slug a seeded/precious project that must never be hard-deleted? Exported for tests.
export function isProtectedSlug(slug) {
  return PROTECTED_SLUGS.has(String(slug || '').trim().toLowerCase());
}

// Trim a DB row down to the wire shape the client consumes (never leak created_by).
function projectView(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    episode: row.episode ?? null,
    config: row.config ?? {},
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    trashed_at: row.trashed_at ?? null,
  };
}

// PURE — validates a create body. Exported for unit tests (no Request / DB needed).
export function validateCreateBody(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, code: 'BAD_BODY', message: 'body (object) required' };
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug) return { ok: false, code: 'BAD_SLUG', message: 'slug required' };
  if (slug.length > 60) return { ok: false, code: 'BAD_SLUG', message: 'slug too long (max 60)' };
  if (!SLUG_RE.test(slug)) return { ok: false, code: 'BAD_SLUG', message: 'slug must be lowercase alnum + hyphens' };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, code: 'RESERVED_SLUG', message: `"${slug}" is a reserved route` };

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, code: 'BAD_TITLE', message: 'title required' };
  if (title.length > 300) return { ok: false, code: 'BAD_TITLE', message: 'title too long (max 300)' };

  // episode is OPTIONAL — null for a brand-new project, a legacy id ('burma'|'palau') otherwise.
  const episode = body.episode == null ? null : String(body.episode).trim() || null;

  // config is OPTIONAL — a plain object bag. Reject arrays / scalars so we never store garbage jsonb.
  let cfg = {};
  if (body.config != null) {
    if (typeof body.config !== 'object' || Array.isArray(body.config)) {
      return { ok: false, code: 'BAD_CONFIG', message: 'config must be an object' };
    }
    cfg = body.config;
  }

  return { ok: true, slug, title, episode, config: cfg };
}

// PURE — whitelists a PATCH body to exactly {title, trashed_at, config}. Exported for tests. At least one
// mutable field must be present. trashed_at accepts an ISO string (trash) or null (restore).
export function buildPatch(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, code: 'BAD_BODY', message: 'body (object) required' };
  }
  const fields = {};
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return { ok: false, code: 'BAD_TITLE', message: 'title must be a non-empty string' };
    if (title.length > 300) return { ok: false, code: 'BAD_TITLE', message: 'title too long (max 300)' };
    fields.title = title;
  }
  if ('trashed_at' in body) {
    const t = body.trashed_at;
    if (t === null) fields.trashed_at = null;                       // restore
    else if (typeof t === 'string' && t.trim()) fields.trashed_at = t; // trash (ISO)
    else return { ok: false, code: 'BAD_TRASHED', message: 'trashed_at must be an ISO string or null' };
  }
  if ('config' in body) {
    if (body.config == null || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return { ok: false, code: 'BAD_CONFIG', message: 'config must be an object' };
    }
    fields.config = body.config;
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, code: 'NO_FIELDS', message: 'patch must set title, trashed_at, or config' };
  }
  return { ok: true, fields };
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
// checkAccess returns a bare 401 Response with no CORS headers; re-wrap it so the browser can read it.
function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export { SLUG_RE, RESERVED_SLUGS, UUID_RE, projectView, PROTECTED_SLUGS };
