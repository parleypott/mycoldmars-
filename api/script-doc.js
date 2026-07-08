export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';
import { checkAccess, requestUserId } from './_lib/access.js';
import { withSentry, captureServerError } from './_lib/sentry.js';

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
 *   GET  /api/script-doc?project=<slug|uuid>            -> { doc, version, updated_by }
 *        ({doc:null,version:0,updated_by:null} empty). updated_by is the auth user id that wrote the
 *        current row (null for pre-attribution rows / access-code writers).
 *   GET  /api/script-doc?project=<slug|uuid>&revisions=1 -> { revisions: [ {id,version,source,created_at,
 *        user_id,user_name,user_color} ] }   METADATA ONLY (no doc bodies), newest first, capped ~50.
 *   GET  /api/script-doc?project=<slug|uuid>&revision=<id> -> { doc, version }  one past revision's full doc
 *   PUT  /api/script-doc?project=<slug|uuid>  { doc, version, baseVersion? }
 *        accepted -> { version }               (also writes a revisions row; stamps updated_by)
 *        stale    -> 409 { doc, version, updated_by }  (the current row + WHO wrote it, so the client
 *                    can tell "my own other tab/session" from "genuinely another person" and only
 *                    raise the ANOTHER-DEVICE banner for the latter — the false-conflict fix)
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

export default withSentry(async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);
  const projectRef = url.searchParams.get('project') || '';
  if (!projectRef) return err(400, 'NO_PROJECT', 'project (slug or id) query param required');

  try {
    if (req.method === 'GET') {
      // Reads are open to anyone who got past the site gate (matches burma-script-doc GET, and the
      // ?read share model). The write path is the one that must be signed in.
      const wantsList = url.searchParams.has('revisions');
      const revisionId = url.searchParams.get('revision');
      const pid = await resolveProjectId(projectRef);
      if (!pid) {
        // Unknown project: an empty history / a not-found single revision / an empty doc — never an error.
        if (wantsList) return ok({ revisions: [] });
        if (revisionId) return err(404, 'NO_REVISION', 'unknown project');
        return ok({ doc: null, version: 0 });
      }
      if (wantsList) return await listRevisions(pid);
      if (revisionId) return await getRevision(pid, revisionId);
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
      // WHO is writing — the JWT's auth user id, or null (access-code path / dev mode / no JWT).
      // Attribution only, never access control: it stamps script_docs.updated_by so a later 409 can
      // tell the refused client whether the conflicting version is its OWN user's work.
      const userId = await requestUserId(req);
      return await putDoc(pid, v, userId);
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    // This catch-all turns any unexpected throw into a clean 500 for the client — which also
    // means withSentry's own catch never fires. Report explicitly so returning a tidy error
    // never means hiding the error from monitoring. (No-op when SENTRY_DSN is unset.)
    await captureServerError(e, { route: 'script-doc' });
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
});

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
  const r = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version,updated_by`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  if (!rows.length) return ok({ doc: null, version: 0, updated_by: null });
  return ok(stalePayload(rows[0], true));
}

/* -------------------------------------------------------- revision history (read) */

// The CLOUD version history — the "restore any past cloud save" backstop. Every accepted PUT appends a
// row to script_doc_revisions, so this is an append-only ledger of every save. We return METADATA ONLY
// (never the ~167KB doc bodies) so the list stays light: id, version, source, created_at, and the
// author resolved to a display name/colour via public.user_profiles when a user_id is attached.
async function listRevisions(pid) {
  const r = await sb(
    `/rest/v1/script_doc_revisions?project_id=eq.${pgrValue(pid)}` +
    `&select=id,version,source,user_id,created_at&order=created_at.desc&limit=${REVISION_LIST_CAP}`
  );
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  const profiles = await resolveProfiles(rows.map((x) => x && x.user_id));
  return ok({ revisions: (Array.isArray(rows) ? rows : []).map((x) => toRevisionView(x, profiles)) });
}

// One past revision's FULL doc (for the actual restore). project_id is part of the filter so a revision
// id can never be pulled across projects, and toRevisionId rejects a non-integer id (revisions.id is a
// bigint) before it ever reaches the query.
async function getRevision(pid, revisionRef) {
  const id = toRevisionId(revisionRef);
  if (id == null) return err(400, 'BAD_REVISION', 'revision id must be a positive integer');
  const r = await sb(
    `/rest/v1/script_doc_revisions?project_id=eq.${pgrValue(pid)}&id=eq.${pgrValue(id)}&select=doc,version&limit=1`
  );
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_REVISION', 'unknown revision for this project');
  return ok({ doc: rows[0].doc ?? null, version: toVersion(rows[0].version) });
}

// Batch-resolve a set of user_ids to their { display_name, color } profiles. Best-effort: any failure
// (missing table, no rows) yields an empty map, so the history still lists — just with bare user ids.
// Returns a plain object keyed by user_id. NEVER throws.
async function resolveProfiles(userIds) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return {};
    const inList = ids.map((u) => pgrValue(u)).join(',');
    const r = await sb(`/rest/v1/user_profiles?user_id=in.(${inList})&select=user_id,display_name,color`);
    if (!r.ok) return {};
    const rows = await r.json().catch(() => []);
    const map = {};
    for (const p of Array.isArray(rows) ? rows : []) {
      if (p && p.user_id) map[p.user_id] = p;
    }
    return map;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ write */

async function putDoc(pid, { doc, version, baseVersion }, userId = null) {
  // Read current stored version to decide accept vs 409. updated_by rides along so a refusal can
  // tell the client WHO wrote the version it lost to (the same-user false-conflict fix).
  const cur = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version,updated_by`);
  if (!cur.ok) return err(502, 'DB_READ', await cur.text());
  const curRows = await cur.json();
  const exists = curRows.length > 0;
  const stored = exists ? toVersion(curRows[0].version) : 0;

  if (!isWriteAcceptable({ version, baseVersion, stored })) {
    return err409(stalePayload(exists ? curRows[0] : null, exists));
  }

  const nowIso = new Date().toISOString();
  // ATTRIBUTION — stamp WHO wrote this version. null is honest "unknown" (access-code / dev-mode
  // writers): the client treats an unknown author as a possibly-different user and keeps the banner.
  const updatedBy = (typeof userId === 'string' && userId) ? userId : null;
  if (!exists) {
    const ins = await sb(`/rest/v1/script_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ project_id: pid, doc, version, updated_by: updatedBy, updated_at: nowIso }),
    });
    if (ins.ok) {
      const row = (await ins.json())[0];
      await appendRevision(pid, doc, version, 'autosave', updatedBy); // history from the very first save
      await touchProject(pid, nowIso);
      return ok({ version: toVersion(row?.version ?? version) });
    }
    // fall through to guarded update on the rare insert race
  }

  // GUARDED UPDATE — the atomic backstop. The guard clause (see updateGuardClause) makes the write
  // itself conditional at the DB, so a concurrent writer that landed between our read above and here
  // makes this a no-op (0 rows) not a stomp — in BOTH the optimistic and the compare-and-swap modes.
  const upd = await sb(
    `/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&${updateGuardClause({ version, baseVersion })}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ doc, version, updated_by: updatedBy, updated_at: nowIso }),
    }
  );
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const updated = await upd.json();
  if (updated.length) {
    await appendRevision(pid, doc, version, 'autosave', updatedBy);
    await touchProject(pid, nowIso);
    return ok({ version: toVersion(updated[0].version) });
  }

  // 0 rows — a concurrent writer won. Re-read and 409 with the current row (incl. its author).
  const re = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version,updated_by`);
  const reRows = re.ok ? await re.json() : [];
  return err409(stalePayload(reRows.length ? reRows[0] : null, reRows.length > 0));
}

// Append-only history. Best-effort: a failed revision write never fails the (already-durable) save —
// but it's the backstop that makes "one bad save can't destroy the last good one" true. user_id
// attributes the revision to its author (the history list already resolves it to a name/colour).
async function appendRevision(pid, doc, version, source = 'autosave', userId = null) {
  try {
    await sb(`/rest/v1/script_doc_revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: pid, doc, version, source, user_id: userId ?? null }),
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

// PURE — shape the current script_docs row into the { doc, version, updated_by } wire payload used by
// BOTH the 409 refusal and the plain GET. updated_by is the auth user id that wrote the stored
// version, or null when unknown (pre-attribution rows, access-code writers, no row). The client's
// same-user conflict check depends on this field: a non-null id matching the signed-in user means
// "your own other tab/session", anything else keeps the full ANOTHER-DEVICE treatment. Exported for tests.
function stalePayload(row, exists) {
  if (!exists || !row || typeof row !== 'object') return { doc: null, version: 0, updated_by: null };
  return {
    doc: row.doc ?? null,
    version: toVersion(row.version),
    updated_by: (typeof row.updated_by === 'string' && row.updated_by) ? row.updated_by : null,
  };
}

// The DB-level guard clause for the guarded UPDATE — this is what makes the write ATOMIC, and it must
// match the mode isWriteAcceptable already vetted in memory:
//   • OPTIMISTIC (no baseVersion): `version=lt.<incoming>` — patch only if the stored version is STILL
//     strictly older than what we're writing. Byte-identical to the original clause; the live client
//     (cloud-sync.js) only ever uses this mode.
//   • COMPARE-AND-SWAP (baseVersion present): `version=eq.<baseVersion>` — a TRUE CAS: patch only if the
//     stored version is STILL exactly the base this client built on. Without it the DB fell back to
//     `lt.<incoming>`, which let a base=4/v=6 writer overwrite an intervening v=5 it never merged — the
//     atomicity the endpoint's own doc-comment promised but the write never enforced. The in-memory
//     isWriteAcceptable check alone can't guarantee it: another writer can land between our read and this
//     PATCH, and only a DB-level `eq.<base>` blocks that race (0 rows -> 409 -> the client adopts).
function updateGuardClause({ version, baseVersion }) {
  const hasBase = baseVersion !== null && baseVersion !== undefined;
  return hasBase
    ? `version=eq.${pgrValue(toVersion(baseVersion))}`
    : `version=lt.${pgrValue(toVersion(version))}`;
}

// Newest-first history is capped so the list stays a light metadata payload (no doc bodies).
const REVISION_LIST_CAP = 50;

// PURE — coerce a `?revision=` ref to a positive integer bigint id, or null if it isn't one. Guards the
// DB filter against slugs / floats / negatives / junk before they reach the query. Exported for tests.
function toRevisionId(ref) {
  if (ref == null) return null;
  const s = String(ref).trim();
  if (!/^[0-9]+$/.test(s)) return null; // strictly digits — no floats, signs, or scientific notation
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// PURE — shape ONE revision row into the light wire view, resolving its author against a profiles map.
// Never leaks the doc body (this view is metadata-only). Exported for tests.
function toRevisionView(row, profiles = {}) {
  if (!row || typeof row !== 'object') return null;
  const uid = row.user_id ?? null;
  const prof = uid && profiles && profiles[uid] ? profiles[uid] : null;
  return {
    id: row.id ?? null,
    version: toVersion(row.version),
    source: row.source ?? null,
    created_at: row.created_at ?? null,
    user_id: uid,
    user_name: prof && prof.display_name != null ? prof.display_name : null,
    user_color: prof && prof.color != null ? prof.color : null,
  };
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

export { toVersion, validatePutBody, isWriteAcceptable, updateGuardClause, UUID_RE, toRevisionId, toRevisionView, REVISION_LIST_CAP, stalePayload };
