export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';
import { checkAccess, requestUserId } from './_lib/access.js';
import { ACTIVE_LIST_FILTER, softDeleteFields } from './_lib/soft-delete.js';
import { withSentry, captureServerError } from './_lib/sentry.js';

/**
 * Script Library — SHARED PROJECT LIST (Enterprise Wave 2, the #1 multi-user fix).
 *
 * The cloud home for the list of script projects, so a teammate signing in on their own machine sees
 * every project the team made — not just what's in their own browser's localStorage. The library's
 * project-store.js treats this endpoint as the source of truth and keeps localStorage as an OFFLINE
 * CACHE that merges against it (cloud wins for shared visibility; local-only unsynced rows still show).
 *
 *   GET  /api/script-projects            -> { projects: [ {id,slug,title,episode,updated_at,trashed_at,deleted_at} ] }
 *        LOGIN-GATED (checkAccess) as of the Google-Docs link-share wave: the list IS the library
 *        index, and guests with a share link must never receive it. Signed-in teammates are
 *        unaffected — the library's gate.js fetch interceptor injects their JWT on every /api/* call
 *        (and edit-mode ShareToggle only ever runs under the library route, so it rides the same
 *        interceptor). NOTE config is deliberately NOT in the list rows: config is a free-form jsonb
 *        bag teammates write — the library client never reads it off the list (configForProject
 *        derives everything from id/episode/title), so echoing it was pure surface. Authed writers
 *        still get config back on POST/PATCH responses unchanged.
 *        ?trashed=1                       -> the TRASH list (trashed OR soft-deleted rows within the
 *        90-day archive window) instead of the active one. Older rows are ARCHIVED: they stop being
 *        listed but stay in the DB untouched, and PATCH-by-id restore is age-blind. Same login gate.
 *   GET  /api/script-projects?slug=<slug>  -> { project: {id,slug,title,episode,updated_at} | null }
 *        ANONYMOUS, SCOPED single-project resolution — the Google-Docs guest door. Resolves ONE slug
 *        to ONE project WITHOUT ever exposing the list: only a row that is PUBLIC (is_public not
 *        false) and ACTIVE (not trashed / not deleted) resolves; unknown, private, trashed and
 *        malformed slugs all return the SAME calm { project: null } so the response is never a
 *        slug-existence oracle. Minimal fields only — never config, never created_by/deleted_by.
 *   POST /api/script-projects  { slug, title, episode?, config? }   (login-gated)
 *        -> { project }  the created row
 *   PATCH /api/script-projects?id=<uuid>  { title? , slug? , trashed_at? , deleted_at:null? , config? }   (login-gated)
 *        -> { project }  the updated row  (rename / trash / restore / config-update). deleted_at is
 *        accepted ONLY as null — the restore that clears a soft delete. Setting it goes through DELETE.
 *        slug is accepted so a RENAME syncs the new slug to the cloud (the guest ?slug= door and every
 *        teammate's client refresh both read the CLOUD slug — a rename that only pushed the title left
 *        the cloud slug stale and broke shared links). Same shape/reserved guards as create; a collision
 *        with another row's slug returns 409 SLUG_TAKEN (the client keeps its old slug and surfaces it).
 *   DELETE /api/script-projects?id=<uuid>   (login-gated)   SOFT DELETE — recoverable, for EVERYONE
 *        -> { ok:true, id, deleted_at }   stamps deleted_at/deleted_by (and trashed_at if not already
 *        set) via PATCH. NOBODY can hard-delete through this API anymore: the old REST DELETE (which
 *        cascaded script_docs / script_doc_revisions / script_presence via FK) is REMOVED — revision
 *        history is never destroyed, and a soft-deleted project is restorable from the trash list.
 *        Still REFUSED (403) for the seeded burma/palau projects — those are precious and may be
 *        trashed/hidden but never even soft-deleted through this path.
 *
 * READ POSTURE: the ?slug= single-project resolution is the ONLY anonymous read (it serves the
 * Google-Docs guest boot, scoped to one public row). The LIST reads are login-gated like the writes —
 * logged-in teammates already send their Supabase JWT via the gate.js fetch interceptor, so there is
 * nothing to provision. DB access uses the service-role key (bypasses RLS); the
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

// Seeded, precious projects that may be trashed/hidden but NEVER deleted (even softly) through the
// DELETE route. Guarded by SLUG (stable across rename) so Burma's once-lost live doc can't be purged.
const PROTECTED_SLUGS = new Set(['burma', 'palau', 'palau2']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A project slug: lowercase alnum + hyphens, 1-60 chars, no leading/trailing/double hyphen. This is the
// exact SHAPE generateSlug() produces on the client, so a slug that round-trips through the store is
// always valid here. Reserved routing keywords a slug must never shadow (mirrors project-store.js).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

// Columns the client needs — never SELECT * (keeps created_by/deleted_by out of the wire and the
// shape stable). deleted_at rides along so the trash UI can tell "trashed" from "deleted" if it wants.
// The LIST select additionally drops config (see the endpoint doc above): the list is world-readable,
// config is not the world's business, and no list consumer reads it.
const SELECT_COLS = 'id,slug,title,episode,config,created_at,updated_at,trashed_at,deleted_at';
const LIST_COLS = 'id,slug,title,episode,created_at,updated_at,trashed_at,deleted_at,is_public';

// config jsonb write clamp — a free-form object bag still needs a ceiling so one bad client (or a
// prober) can't park megabytes in every row. 64KB is ~400× the biggest real config we store.
export const CONFIG_MAX_BYTES = 64 * 1024;

// PURE — serialized byte size of a config value (what jsonb storage actually costs). Exported for tests.
export function configByteSize(config) {
  try { return new TextEncoder().encode(JSON.stringify(config)).length; } catch { return Infinity; }
}

export default withSentry(async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      // GUEST DOOR — ?slug= resolves ONE public, active project anonymously (never the list).
      const slugParam = url.searchParams.get('slug');
      if (slugParam != null) return await resolvePublicBySlug(slugParam);
      // AUTHED per-project fetch — ?id= returns ONE project WITH its config. The LIST deliberately drops
      // config (world-shaped index; locked by tests), so a teammate's added picker days/sequences ride
      // this login-gated single-project read instead. Same checkAccess gate as the list below.
      const idParam = url.searchParams.get('id');
      if (idParam != null) {
        const denied = await checkAccess(req);
        if (denied) return withCors(denied);
        if (!UUID_RE.test(idParam)) return err(400, 'BAD_ID', 'id (uuid) query param required');
        return await resolveProjectById(idParam);
      }
      // THE LIST IS THE INDEX — login-gated so a share-link guest can never enumerate the library.
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      const trashed = url.searchParams.get('trashed') === '1';
      return await listProjects(trashed);
    }

    if (req.method === 'POST') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      const v = validateCreateBody(body);
      if (!v.ok) return err(v.code === 'CONFIG_TOO_BIG' ? 413 : 400, v.code, v.message);
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
      if (!patch.ok) return err(patch.code === 'CONFIG_TOO_BIG' ? 413 : 400, patch.code, patch.message);
      return await patchProject(id, patch.fields);
    }

    if (req.method === 'DELETE') {
      const denied = await checkAccess(req);
      if (denied) return withCors(denied);
      const id = url.searchParams.get('id') || '';
      if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id (uuid) query param required');
      // WHO is deleting — attribution only (stamps deleted_by); checkAccess above remains the gate.
      const userId = await requestUserId(req);
      return await deleteProject(id, userId);
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    // This catch-all turns any unexpected throw into a clean 500 for the client — which also
    // means withSentry's own catch never fires. Report explicitly so returning a tidy error
    // never means hiding the error from monitoring. (No-op when SENTRY_DSN is unset.)
    await captureServerError(e, { route: 'script-projects' });
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
});

/* -------------------------------------------------------------------- list */

// Trash rows older than this stop appearing in the trash LIST — ARCHIVED, never destroyed (Johnny's
// rule: nothing is ever destroyed). The row + its full revision history stay in the DB untouched,
// and PATCH-by-id (the restore path) is age-blind, so an admin can always bring an archived project
// back. Mirrors TRASH_ARCHIVE_DAYS in scripts-library/src/library-time.js (the client belt).
export const TRASH_ARCHIVE_DAYS = 90;

// PURE — PostgREST filter for the trash list, bounded to the archive window. The archive clock is
// trashed_at (softDeleteFields deliberately preserves it across a later delete), falling back to
// deleted_at for a row that somehow carries only that. `gt` on timestamptz is NULL-safe (SQL NULL
// comparisons are false), so the trashed_at.gt branch also implies not-null. Exported for tests.
export function trashListFilter(nowMs = Date.now()) {
  const cutoff = new Date(nowMs - TRASH_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return `or=(trashed_at.gt.${cutoff},and(trashed_at.is.null,deleted_at.gt.${cutoff}))`;
}

// PURE — the wire shape a GUEST may see for a single public project: identity + title only, never
// config (free-form team jsonb), never is_public/trashed_at bookkeeping, never created_by/deleted_by.
// Exported for tests.
export function publicProjectView(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    episode: row.episode ?? null,
    updated_at: row.updated_at ?? null,
  };
}

// GUEST slug → project resolution (anonymous). One PUBLIC + ACTIVE row or null — and the SAME null
// for unknown / private / trashed / malformed, so an anonymous prober can't distinguish "exists but
// private" from "doesn't exist". Fail-CLOSED on DB trouble (502): unlike the doc GET's fail-open
// is_public check, over-serving here would hand out titles for rows we couldn't verify are public.
async function resolvePublicBySlug(slugRaw) {
  const slug = String(slugRaw || '').trim();
  if (!slug || slug.length > 60 || !SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    return ok({ project: null });
  }
  const r = await sb(
    `/rest/v1/script_projects?slug=eq.${pgrValue(slug)}&is_public=not.is.false&${ACTIVE_LIST_FILTER}` +
    `&select=id,slug,title,episode,updated_at&limit=1`
  );
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  return ok({ project: rows.length ? publicProjectView(rows[0]) : null });
}

// AUTHED single-project resolution BY ID — the full projectView (config included), for a signed-in
// teammate hydrating a project's per-project config on open (picker days/sequences). Unlike the anonymous
// ?slug= door this is behind checkAccess (the caller gated it), so returning config is fine. An unknown /
// deleted id resolves to { project: null } (not a 404) so the client's background hydrate stays a calm no-op.
async function resolveProjectById(id) {
  const r = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}&select=${SELECT_COLS}&limit=1`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  return ok({ project: rows.length ? projectView(rows[0]) : null });
}

async function listProjects(trashed) {
  // ACTIVE = not trashed AND not soft-deleted. TRASH = trashed OR soft-deleted AND still within the
  // 90-day archive window — deleted rows surface in the trash list so the existing client trash UI
  // can show + Restore them; archived rows simply drop off the list (restore-by-id still works).
  const filter = trashed ? trashListFilter() : ACTIVE_LIST_FILTER;
  const r = await sb(`/rest/v1/script_projects?${filter}&select=${LIST_COLS}&order=updated_at.desc`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  return ok({ projects: Array.isArray(rows) ? rows.map(projectListView) : [] });
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
  // A slug PATCH can collide with another row's slug (the DB's unique index). Surface it as 409
  // SLUG_TAKEN exactly like create does, so the client keeps its old slug and reports the conflict
  // calmly instead of silently dropping the rename. (Only slug can trip this; title/config can't.)
  if (upd.status === 409) {
    return err(409, 'SLUG_TAKEN', `slug "${fields.slug ?? ''}" already exists`);
  }
  if (!upd.ok) {
    const text = await upd.text();
    if (/duplicate key|unique constraint|23505/i.test(text)) {
      return err(409, 'SLUG_TAKEN', `slug "${fields.slug ?? ''}" already exists`);
    }
    return err(502, 'DB_WRITE', text);
  }
  const rows = await upd.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_PROJECT', 'unknown project id');
  return ok({ project: projectView(rows[0]) });
}

/* ------------------------------------------------------------------ delete */

// SOFT DELETE — the DELETE verb no longer destroys anything. It stamps deleted_at/deleted_by (and
// trashed_at if the row wasn't already in the trash) via a PATCH, so the project drops out of the
// active list, shows in the trash list, and is ALWAYS restorable (PATCH deleted_at:null). The old
// REST DELETE — whose FK cascade took script_docs + the full append-only script_doc_revisions
// history + presence with it — is deliberately GONE: the audit showed any pool member could erase a
// project's entire history forever, and the standing order is that nobody can. Revisions are never
// deleted through any path in this endpoint. Protected (seeded) slugs still 403 exactly as before.
async function deleteProject(id, userId = null) {
  // Read the target's slug first — the guard is by slug (stable across rename), not by id.
  // trashed_at rides along so an already-trashed row keeps its original trash timestamp.
  const look = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}&select=id,slug,trashed_at&limit=1`);
  if (!look.ok) return err(502, 'DB_READ', await look.text());
  const rows = await look.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_PROJECT', 'unknown project id');
  const slug = rows[0].slug || '';
  if (isProtectedSlug(slug)) {
    return err(403, 'PROTECTED', `"${slug}" is a seeded project and cannot be deleted (trash it instead)`);
  }
  const fields = softDeleteFields(userId, new Date().toISOString(), rows[0].trashed_at || null);
  const upd = await sb(`/rest/v1/script_projects?id=eq.${pgrValue(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  });
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const updated = await upd.json().catch(() => []);
  if (!updated.length) return err(404, 'NO_PROJECT', 'unknown project id');
  return ok({ ok: true, id, deleted_at: fields.deleted_at });
}

/* ---------------------------------------------------------------- helpers */

// PURE — is this slug a seeded/precious project that must never be hard-deleted? Exported for tests.
export function isProtectedSlug(slug) {
  return PROTECTED_SLUGS.has(String(slug || '').trim().toLowerCase());
}

// PURE — the world-readable LIST row: projectView minus config (the free-form jsonb bag stays behind
// the login-gated write/response paths; no list consumer reads it). Exported for tests.
export function projectListView(row) {
  if (!row || typeof row !== 'object') return null;
  const { config, ...rest } = projectView(row) || {};
  return rest;
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
    deleted_at: row.deleted_at ?? null,
    is_public: row.is_public !== false, // NOT NULL default true; only an explicit false is "off"
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

  // config is OPTIONAL — a plain object bag. Reject arrays / scalars so we never store garbage jsonb,
  // and clamp the serialized size (CONFIG_TOO_BIG maps to a 413 in the handler).
  let cfg = {};
  if (body.config != null) {
    if (typeof body.config !== 'object' || Array.isArray(body.config)) {
      return { ok: false, code: 'BAD_CONFIG', message: 'config must be an object' };
    }
    if (configByteSize(body.config) > CONFIG_MAX_BYTES) {
      return { ok: false, code: 'CONFIG_TOO_BIG', message: `config too large (max ${CONFIG_MAX_BYTES} bytes)` };
    }
    cfg = body.config;
  }

  return { ok: true, slug, title, episode, config: cfg };
}

// PURE — whitelists a PATCH body to exactly {title, trashed_at, deleted_at:null, config}. Exported for
// tests. At least one mutable field must be present. trashed_at accepts an ISO string (trash) or null
// (restore). deleted_at is RESTORE-ONLY: null clears a soft delete (and its deleted_by attribution);
// any truthy value is refused — deleting goes through the DELETE verb so deleted_by gets stamped.
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
  if ('slug' in body) {
    // RENAME syncs the regenerated slug up. Same shape + reserved guards as create — the slug the
    // client sends is a generateSlug() output run through ensureUniqueSlug, so it always fits SLUG_RE.
    // Uniqueness is enforced by the DB's slug unique index; patchProject maps that violation to 409.
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return { ok: false, code: 'BAD_SLUG', message: 'slug must be a non-empty string' };
    if (slug.length > 60) return { ok: false, code: 'BAD_SLUG', message: 'slug too long (max 60)' };
    if (!SLUG_RE.test(slug)) return { ok: false, code: 'BAD_SLUG', message: 'slug must be lowercase alnum + hyphens' };
    if (RESERVED_SLUGS.has(slug)) return { ok: false, code: 'RESERVED_SLUG', message: `"${slug}" is a reserved route` };
    fields.slug = slug;
  }
  if ('trashed_at' in body) {
    const t = body.trashed_at;
    if (t === null) fields.trashed_at = null;                       // restore
    else if (typeof t === 'string' && t.trim()) fields.trashed_at = t; // trash (ISO)
    else return { ok: false, code: 'BAD_TRASHED', message: 'trashed_at must be an ISO string or null' };
  }
  if ('deleted_at' in body) {
    if (body.deleted_at !== null) {
      return { ok: false, code: 'BAD_DELETED', message: 'deleted_at can only be cleared (null) — use DELETE to soft-delete' };
    }
    fields.deleted_at = null;   // restore out of soft-delete…
    fields.deleted_by = null;   // …and drop the stale attribution with it
  }
  if ('config' in body) {
    if (body.config == null || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return { ok: false, code: 'BAD_CONFIG', message: 'config must be an object' };
    }
    if (configByteSize(body.config) > CONFIG_MAX_BYTES) {
      return { ok: false, code: 'CONFIG_TOO_BIG', message: `config too large (max ${CONFIG_MAX_BYTES} bytes)` };
    }
    fields.config = body.config;
  }
  if ('is_public' in body) {
    // Link-share status. Only a boolean is accepted; the doc GET reads this to allow/deny logged-out
    // ?read viewers. This PATCH is checkAccess-gated (above), so ONLY a signed-in owner can flip it.
    if (typeof body.is_public !== 'boolean') return { ok: false, code: 'BAD_PUBLIC', message: 'is_public must be a boolean' };
    fields.is_public = body.is_public;
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, code: 'NO_FIELDS', message: 'patch must set title, slug, trashed_at, deleted_at (null), config, or is_public' };
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
