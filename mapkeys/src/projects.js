// MapKeys project store — cloud-backed (api/mapkeys-projects) with localStorage
// as the instant offline cache, following the Script Library's project-store
// discipline in a solo-tool-simple shape:
//
//   • The UI reads the cache synchronously (never a blank screen); a background
//     syncFromCloud() merges the cloud list in and fires PROJECTS_CHANGED_EVENT.
//   • Writes are cloud-first (create) or optimistic-cache-then-cloud (rename /
//     move / trash / restore), and every cloud response is read back into the
//     cache — never fire-and-forget.
//   • Each project's full editor state also lives in a per-project cache key
//     (mapkeys_proj_<id>) so reopening is instant and offline-safe; the cloud
//     copy wins only when it is newer than the cache.
//
// The legacy single-map world (mapkeys_layers_v1 + mapkeys_last_camera) is
// adopted ONCE by migrateLegacyIfNeeded() into a real project, so nothing
// Johnny has drawn is ever lost.

export const INDEX_KEY = 'mapkeys_index_v1';
export const MIGRATED_KEY = 'mapkeys_migrated_v1';
export const PROJECTS_CHANGED_EVENT = 'mk-projects-changed';
export const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

const API = '/api/mapkeys-projects';

/* ── slug ─────────────────────────────────────────────────────────────── */

// Same apostrophe-safe slugger as the Script Library (curly variants included).
export function generateSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

export function ensureUniqueSlug(base, excludeId = null) {
  const taken = new Set(
    readIndex().projects
      .filter((r) => r && r.id !== excludeId)
      .map((r) => r && r.slug)
      .filter(Boolean),
  );
  let slug = base || 'untitled';
  if (RESERVED_SLUGS.has(slug)) slug = `${slug}-1`;
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i += 1;
  return `${slug}-${i}`;
}

/* ── cache I/O (always shape-safe) ────────────────────────────────────── */

// In-memory mirror of the index, set on every write. localStorage is
// best-effort persistence — when the origin's 5MB quota is full
// (mycoldmars.com shares it across every tool), setItem throws and a
// cache-only store would "create" projects the router can never find.
// Once anything has been written this session, the mirror is the truth,
// so a dead localStorage can't lose in-session state; the cloud still
// persists across reloads and devices.
let memIndex = null;

export function readIndex() {
  if (memIndex) return memIndex;
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return {
      projects: v && Array.isArray(v.projects) ? v.projects : [],
      folders: v && Array.isArray(v.folders) ? v.folders : [],
    };
  } catch {
    return { projects: [], folders: [] };
  }
}

function writeIndex(idx) {
  memIndex = idx;
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) {
    console.warn('[mapkeys] index persist failed (storage full?) — running from memory + cloud:', e.message);
  }
  return idx;
}

function emitChanged() {
  try { window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT)); } catch {}
}

function stateKey(id) { return `mapkeys_proj_${id}`; }

export function readStateCache(id) {
  try {
    const raw = localStorage.getItem(stateKey(id));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && v.state ? v : null; // { state, savedAt }
  } catch { return null; }
}

export function writeStateCache(id, state) {
  try {
    localStorage.setItem(stateKey(id), JSON.stringify({ state, savedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[mapkeys] project cache write failed (likely quota):', e.message);
  }
}

/* ── queries (synchronous, cache-backed) ──────────────────────────────── */

function ts(v) { const n = Date.parse(v || ''); return Number.isNaN(n) ? 0 : n; }

export function activeProjects() {
  return readIndex().projects
    .filter((r) => r && !r.trashed_at)
    .sort((a, b) => ts(b.updated_at) - ts(a.updated_at));
}

export function trashedProjects() {
  return readIndex().projects
    .filter((r) => r && r.trashed_at)
    .sort((a, b) => ts(b.trashed_at) - ts(a.trashed_at));
}

export function allFolders() {
  return readIndex().folders.slice().sort((a, b) => ts(a.created_at) - ts(b.created_at));
}

export function findBySlug(slug) {
  return readIndex().projects.find((r) => r && r.slug === slug) || null;
}

export function findById(id) {
  return readIndex().projects.find((r) => r && r.id === id) || null;
}

/* ── cloud transport (every call degrades to null) ────────────────────── */

async function api(path, init) {
  try {
    const res = await fetch(`${API}${path || ''}`, init);
    if (!res || !res.ok) return null;
    return await res.json().catch(() => null);
  } catch { return null; }
}

/* ── cloud → cache merge ──────────────────────────────────────────────── */

// Cloud wins for rows it knows about (keyed by id); local-only `local_` rows
// survive so an offline-created map still shows. Folders mirror the cloud list
// wholesale (they only exist via the API).
export function mergeCloud(cloudProjects, cloudFolders) {
  const idx = readIndex();
  const before = JSON.stringify(idx);
  if (Array.isArray(cloudProjects)) {
    const byId = new Map(idx.projects.filter((r) => r && r.id).map((r) => [r.id, r]));
    for (const c of cloudProjects) {
      if (!c || !c.id) continue;
      byId.set(c.id, { ...byId.get(c.id), ...c });
    }
    idx.projects = [...byId.values()];
  }
  if (Array.isArray(cloudFolders)) idx.folders = cloudFolders;
  const changed = JSON.stringify(idx) !== before;
  if (changed) writeIndex(idx);
  return changed;
}

export async function syncFromCloud() {
  const [active, trash] = await Promise.all([api(''), api('?trashed=1')]);
  if (!active && !trash) return false; // offline — cache stays authoritative
  const projects = [...((active && active.projects) || []), ...((trash && trash.projects) || [])];
  const folders = (active && active.folders) || null;
  const changed = mergeCloud(projects, folders);
  if (changed) emitChanged();
  return changed;
}

/* ── CRUD ─────────────────────────────────────────────────────────────── */

function localId() {
  try { return `local_${crypto.randomUUID()}`; } catch {
    return `local_${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }
}

export async function createProject(name, folderId = null, state = {}) {
  const clean = String(name || '').trim() || 'Untitled Map';
  const slug = ensureUniqueSlug(generateSlug(clean));
  const now = new Date().toISOString();
  const body = { slug, name: clean, folder_id: folderId, state };
  const res = await api('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const row = res && res.project
    ? res.project
    : { id: localId(), slug, name: clean, folder_id: folderId, created_at: now, updated_at: now, trashed_at: null };
  const idx = readIndex();
  idx.projects.push(row);
  writeIndex(idx);
  writeStateCache(row.id, state);
  emitChanged();
  return row;
}

export async function createFolder(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const res = await api('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: { name: clean } }),
  });
  const row = res && res.folder
    ? res.folder
    : { id: localId(), name: clean, created_at: new Date().toISOString() };
  const idx = readIndex();
  idx.folders.push(row);
  writeIndex(idx);
  emitChanged();
  return row;
}

// Optimistic local mutate + background cloud PATCH with read-back.
function mutateProject(id, localFields, cloudFields) {
  const idx = readIndex();
  const row = idx.projects.find((r) => r && r.id === id);
  if (!row) return null;
  Object.assign(row, localFields, { updated_at: new Date().toISOString() });
  writeIndex(idx);
  emitChanged();
  if (cloudFields && !String(id).startsWith('local_')) {
    api(`?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloudFields),
    }).then((res) => { if (res && res.project) { mergeCloud([res.project], null); emitChanged(); } });
  }
  return row;
}

export function renameProject(id, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const slug = ensureUniqueSlug(generateSlug(clean), id);
  return mutateProject(id, { name: clean, slug }, { name: clean, slug });
}

/** Local-only updated_at bump (the cloud stamps its own on state saves). */
export function touchProject(id) {
  return mutateProject(id, {}, null);
}

export function moveProject(id, folderId) {
  return mutateProject(id, { folder_id: folderId }, { folder_id: folderId });
}

export function trashProject(id) {
  const iso = new Date().toISOString();
  return mutateProject(id, { trashed_at: iso }, { trashed_at: iso });
}

export function restoreProject(id) {
  return mutateProject(id, { trashed_at: null }, { trashed_at: null });
}

export function renameFolder(id, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const idx = readIndex();
  const row = idx.folders.find((f) => f && f.id === id);
  if (!row) return null;
  row.name = clean;
  writeIndex(idx);
  emitChanged();
  if (!String(id).startsWith('local_')) {
    api(`?kind=folder&id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    });
  }
  return row;
}

export function deleteFolder(id) {
  const idx = readIndex();
  idx.folders = idx.folders.filter((f) => !(f && f.id === id));
  for (const p of idx.projects) if (p && p.folder_id === id) p.folder_id = null;
  writeIndex(idx);
  emitChanged();
  if (!String(id).startsWith('local_')) {
    api(`?kind=folder&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

/* ── project state (open / save) ──────────────────────────────────────── */

/**
 * Load a project's full editor state: instant from the per-project cache, then
 * the cloud copy if it is NEWER than the cache. Returns { state, fresh } where
 * fresh is a promise resolving to a newer cloud state or null.
 */
export function loadProjectState(row) {
  const cached = readStateCache(row.id);
  const fresh = (async () => {
    if (String(row.id).startsWith('local_')) return null;
    const res = await api(`?id=${encodeURIComponent(row.id)}`);
    if (!res || !res.project || !res.project.state) return null;
    const cloud = res.project;
    if (cached && ts(cached.savedAt) >= ts(cloud.updated_at)) return null; // cache is current
    writeStateCache(row.id, cloud.state);
    return cloud.state;
  })();
  return { state: cached ? cached.state : null, fresh };
}

/** Push a project's state to the cloud (the debounced autosave target). */
export async function pushProjectState(id, state) {
  writeStateCache(id, state);
  if (String(id).startsWith('local_')) return false;
  const res = await api(`?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  return !!res;
}

/** Last-gasp save on tab close — sendBeacon survives page teardown. */
export function beaconProjectState(id, state) {
  writeStateCache(id, state);
  if (String(id).startsWith('local_')) return;
  try {
    const blob = new Blob([JSON.stringify({ state })], { type: 'application/json' });
    navigator.sendBeacon(`${API}?id=${encodeURIComponent(id)}`, blob);
  } catch {}
}

/* ── legacy adoption ──────────────────────────────────────────────────── */

/**
 * One-time: fold the pre-library single-map world into a real project. The
 * legacy keys are LEFT IN PLACE (never destroyed) — only a flag marks the
 * adoption so it runs once. Returns the created row or null.
 */
export async function migrateLegacyIfNeeded() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return null;
    const raw = localStorage.getItem('mapkeys_layers_v1');
    if (!raw) { localStorage.setItem(MIGRATED_KEY, 'empty'); return null; }
    const legacy = JSON.parse(raw);
    if (!legacy || typeof legacy !== 'object') { localStorage.setItem(MIGRATED_KEY, 'corrupt'); return null; }
    let camera = null;
    try { camera = JSON.parse(localStorage.getItem('mapkeys_last_camera') || 'null'); } catch {}
    const state = { ...legacy, camera };
    const row = await createProject('My first map', null, state);
    localStorage.setItem(MIGRATED_KEY, row.id);
    return row;
  } catch (e) {
    console.warn('[mapkeys] legacy migration failed:', e.message);
    return null;
  }
}
