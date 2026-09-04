export const config = { runtime: 'edge' };

/**
 * MapKeys — project library (folders + projects + full editor state).
 *
 * The cloud home for MapKeys maps, mirroring the Script Library's shape but
 * deliberately simpler: MapKeys is a solo tool, so (like nile-flights-state)
 * this endpoint sits behind no login gate. The state blob is the editor's full
 * snapshot — layers, shapes, keyframes, old-map overlays, camera — one jsonb
 * per project, last-write-wins.
 *
 *   GET    /api/mapkeys-projects                  -> { projects:[…meta], folders:[…] }  (active)
 *   GET    /api/mapkeys-projects?trashed=1        -> trashed project metas
 *   GET    /api/mapkeys-projects?slug=x | ?id=u   -> { project } WITH state
 *   POST   /api/mapkeys-projects  { slug,name,folder_id?,state? } -> { project } (created)
 *   POST   /api/mapkeys-projects  { folder:{ name } }             -> { folder }  (created)
 *   POST   /api/mapkeys-projects?id=u  { state }  -> { ok }   (state save — sendBeacon-friendly)
 *   PATCH  /api/mapkeys-projects?id=u  { name?, slug?, folder_id?, state?, trashed_at? } -> { project }
 *   PATCH  /api/mapkeys-projects?kind=folder&id=u { name } -> { folder }
 *   DELETE /api/mapkeys-projects?id=u             -> soft-trash (stamps trashed_at; restore via PATCH)
 *   DELETE /api/mapkeys-projects?kind=folder&id=u -> removes the folder; its projects become unfiled
 *                                                     (FK on delete set null) — projects are never touched.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Routing keywords a project slug must never shadow (mirrors mapkeys/src/projects.js).
const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

// Keyframed KML routes can be hefty, but 4 MB of jsonb is far past any real map.
const MAX_STATE_BYTES = 4 * 1024 * 1024;

// List views never ship the state blob — metas keep the library paint light.
const META_COLS = 'id,slug,name,folder_id,created_at,updated_at,trashed_at';
const FULL_COLS = `${META_COLS},state`;
const FOLDER_COLS = 'id,name,created_at,updated_at';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  const kind = url.searchParams.get('kind') || 'project';

  try {
    if (req.method === 'GET') {
      const slug = url.searchParams.get('slug') || '';
      if (id || slug) return await getProject(id, slug);
      return await listAll(url.searchParams.get('trashed') === '1');
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      if (id) {
        if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id must be a uuid');
        return await saveState(id, body);
      }
      if (body && body.folder) return await createFolder(body.folder);
      const v = validateCreateBody(body);
      if (!v.ok) return err(400, v.code, v.message);
      return await createProject(v);
    }

    if (req.method === 'PATCH') {
      if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id (uuid) query param required');
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      if (kind === 'folder') {
        const name = cleanName(body && body.name);
        if (!name) return err(400, 'BAD_NAME', 'name required');
        return await patchRow('mapkeys_folders', id, { name }, FOLDER_COLS, 'folder');
      }
      const patch = buildPatch(body);
      if (!patch.ok) return err(400, patch.code, patch.message);
      return await patchRow('mapkeys_projects', id, patch.fields, FULL_COLS, 'project');
    }

    if (req.method === 'DELETE') {
      if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id (uuid) query param required');
      if (kind === 'folder') return await deleteFolder(id);
      // Projects are never hard-deleted — trash is a stamp, restore is PATCH trashed_at:null.
      return await patchRow('mapkeys_projects', id, { trashed_at: new Date().toISOString() }, META_COLS, 'project');
    }

    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* ------------------------------------------------------------------ reads */

async function listAll(trashed) {
  const filter = trashed ? 'trashed_at=not.is.null' : 'trashed_at=is.null';
  const [pr, fr] = await Promise.all([
    sb(`/rest/v1/mapkeys_projects?${filter}&select=${META_COLS}&order=updated_at.desc`),
    sb(`/rest/v1/mapkeys_folders?select=${FOLDER_COLS}&order=created_at.asc`),
  ]);
  if (!pr.ok) return err(502, 'DB_READ', await pr.text());
  if (!fr.ok) return err(502, 'DB_READ', await fr.text());
  const projects = await pr.json().catch(() => []);
  const folders = await fr.json().catch(() => []);
  return ok({
    projects: Array.isArray(projects) ? projects : [],
    folders: Array.isArray(folders) ? folders : [],
  });
}

async function getProject(id, slug) {
  let filter;
  if (id) {
    if (!UUID_RE.test(id)) return err(400, 'BAD_ID', 'id must be a uuid');
    filter = `id=eq.${encodeURIComponent(id)}`;
  } else {
    if (!SLUG_RE.test(slug)) return err(400, 'BAD_SLUG', 'malformed slug');
    filter = `slug=eq.${encodeURIComponent(slug)}`;
  }
  const r = await sb(`/rest/v1/mapkeys_projects?${filter}&select=${FULL_COLS}&limit=1`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json().catch(() => []);
  if (!rows.length) return err(404, 'NO_PROJECT', 'unknown project');
  return ok({ project: rows[0] });
}

/* ----------------------------------------------------------------- writes */

async function createProject({ slug, name, folder_id, state }) {
  const ins = await sb('/rest/v1/mapkeys_projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ slug, name, folder_id: folder_id ?? null, state: state ?? {} }),
  });
  if (ins.status === 409) return err(409, 'SLUG_TAKEN', `slug "${slug}" already exists`);
  if (!ins.ok) {
    const text = await ins.text();
    if (/duplicate key|unique constraint|23505/i.test(text)) {
      return err(409, 'SLUG_TAKEN', `slug "${slug}" already exists`);
    }
    return err(502, 'DB_WRITE', text);
  }
  const row = (await ins.json())[0];
  return ok({ project: row }, 201);
}

async function createFolder(folder) {
  const name = cleanName(folder && folder.name);
  if (!name) return err(400, 'BAD_NAME', 'folder name required');
  const ins = await sb('/rest/v1/mapkeys_folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  });
  if (!ins.ok) return err(502, 'DB_WRITE', await ins.text());
  const row = (await ins.json())[0];
  return ok({ folder: row }, 201);
}

// State-only save (the autosave hot path; also the sendBeacon target on tab close).
//
// Compare-and-swap: when the client sends baseUpdatedAt (the cloud stamp it
// last saw), the write only lands if the row still carries that stamp. A
// mismatch returns 409 WITH the current row so the client can merge instead
// of clobbering — a stale tab must never silently delete what another writer
// added. Clients that omit baseUpdatedAt (old bundles, beacons) keep the
// legacy unconditional write.
async function saveState(id, body) {
  const v = validateState(body && body.state);
  if (!v.ok) return err(400, v.code, v.message);
  const base = typeof body.baseUpdatedAt === 'string' && body.baseUpdatedAt.trim()
    ? body.baseUpdatedAt.trim()
    : null;
  if (!base) {
    return await patchRow('mapkeys_projects', id, { state: v.state }, 'id,updated_at', 'project');
  }
  const upd = await sb(
    `/rest/v1/mapkeys_projects?id=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(base)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ state: v.state, updated_at: new Date().toISOString() }),
    },
  );
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const rows = await upd.json().catch(() => []);
  if (rows.length) {
    return ok({ project: { id: rows[0].id, updated_at: rows[0].updated_at } });
  }
  // Nothing matched: either the stamp moved (conflict) or the id is unknown.
  const cur = await sb(`/rest/v1/mapkeys_projects?id=eq.${encodeURIComponent(id)}&select=${FULL_COLS}&limit=1`);
  if (!cur.ok) return err(502, 'DB_READ', await cur.text());
  const curRows = await cur.json().catch(() => []);
  if (!curRows.length) return err(404, 'NOT_FOUND', 'unknown project id');
  return new Response(
    JSON.stringify({ error: { code: 'CONFLICT', message: 'state changed since baseUpdatedAt' }, project: curRows[0] }),
    { status: 409, headers: { 'Content-Type': 'application/json', ...CORS } },
  );
}

async function patchRow(table, id, fields, cols, keyName) {
  const upd = await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
  if (upd.status === 409) return err(409, 'SLUG_TAKEN', 'slug already exists');
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const rows = await upd.json().catch(() => []);
  if (!rows.length) return err(404, 'NOT_FOUND', `unknown ${keyName} id`);
  const view = {};
  for (const c of cols.split(',')) view[c] = rows[0][c] ?? null;
  return ok({ [keyName]: view });
}

async function deleteFolder(id) {
  // FK is ON DELETE SET NULL — the folder's projects survive as unfiled.
  const del = await sb(`/rest/v1/mapkeys_folders?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!del.ok) return err(502, 'DB_WRITE', await del.text());
  const rows = await del.json().catch(() => []);
  if (!rows.length) return err(404, 'NOT_FOUND', 'unknown folder id');
  return ok({ ok: true, id });
}

/* -------------------------------------------------------------- validators */

function cleanName(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 ? s : '';
}

// PURE — exported for unit tests.
export function validateCreateBody(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, code: 'BAD_BODY', message: 'body (object) required' };
  }
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug || slug.length > 60 || !SLUG_RE.test(slug)) {
    return { ok: false, code: 'BAD_SLUG', message: 'slug must be lowercase alnum + hyphens (max 60)' };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, code: 'RESERVED_SLUG', message: `"${slug}" is a reserved route` };
  const name = cleanName(body.name);
  if (!name) return { ok: false, code: 'BAD_NAME', message: 'name required (max 200)' };
  const folder_id = body.folder_id == null ? null : String(body.folder_id);
  if (folder_id !== null && !UUID_RE.test(folder_id)) {
    return { ok: false, code: 'BAD_FOLDER', message: 'folder_id must be a uuid or null' };
  }
  const st = validateState(body.state == null ? {} : body.state);
  if (!st.ok) return st;
  return { ok: true, slug, name, folder_id, state: st.state };
}

// PURE — exported for unit tests. A state blob must be a plain object under the byte cap.
export function validateState(state) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, code: 'BAD_STATE', message: 'state must be an object' };
  }
  let bytes = 0;
  try { bytes = JSON.stringify(state).length; } catch {
    return { ok: false, code: 'BAD_STATE', message: 'state must be JSON-serializable' };
  }
  if (bytes > MAX_STATE_BYTES) {
    return { ok: false, code: 'STATE_TOO_BIG', message: `state is ${bytes} bytes (max ${MAX_STATE_BYTES})` };
  }
  return { ok: true, state };
}

// PURE — exported for unit tests. Whitelist a project PATCH.
export function buildPatch(body) {
  if (body == null || typeof body !== 'object') {
    return { ok: false, code: 'BAD_BODY', message: 'body (object) required' };
  }
  const fields = {};
  if ('name' in body) {
    const name = cleanName(body.name);
    if (!name) return { ok: false, code: 'BAD_NAME', message: 'name must be a non-empty string (max 200)' };
    fields.name = name;
  }
  if ('slug' in body) {
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug || slug.length > 60 || !SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
      return { ok: false, code: 'BAD_SLUG', message: 'slug must be lowercase alnum + hyphens, not reserved' };
    }
    fields.slug = slug;
  }
  if ('folder_id' in body) {
    if (body.folder_id === null) fields.folder_id = null;
    else if (UUID_RE.test(String(body.folder_id))) fields.folder_id = String(body.folder_id);
    else return { ok: false, code: 'BAD_FOLDER', message: 'folder_id must be a uuid or null' };
  }
  if ('state' in body) {
    const st = validateState(body.state);
    if (!st.ok) return st;
    fields.state = st.state;
  }
  if ('trashed_at' in body) {
    const t = body.trashed_at;
    if (t === null) fields.trashed_at = null;                          // restore
    else if (typeof t === 'string' && t.trim()) fields.trashed_at = t; // trash (ISO)
    else return { ok: false, code: 'BAD_TRASHED', message: 'trashed_at must be an ISO string or null' };
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, code: 'NO_FIELDS', message: 'patch must set name, slug, folder_id, state, or trashed_at' };
  }
  return { ok: true, fields };
}

/* ---------------------------------------------------------------- plumbing */

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

export { SLUG_RE, RESERVED_SLUGS, UUID_RE, MAX_STATE_BYTES };
