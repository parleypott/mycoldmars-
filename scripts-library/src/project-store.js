// The Script Library's project index — now CLOUD-BACKED with localStorage as an OFFLINE CACHE.
//
// Wave 2 (multi-user): the list of script projects lives in the cloud (api/script-projects) so a
// teammate signing in on their own machine sees every project the team made. localStorage
// (scripts_index_v1) is kept as the instant, offline-first CACHE: the UI always reads it synchronously,
// and a background sync merges the cloud list in (cloud wins for shared visibility; local-only unsynced
// rows still show). If the API is unreachable, the cache is authoritative and the app still works —
// NEVER a blank screen.
//
// The cache stays ARRAY-SAFE (a corrupt / hand-edited / quota-truncated store can hold a valid-but-
// non-array JSON value; the old `JSON.parse(x) || []` returns that non-array verbatim and the first
// `.map`/`for…of` throws). Sorting is NaN/missing-safe via library-time's recencyKey. Trash KEEPS
// un-orderable rows recoverable. Slugs are unique against the array and never shadow a reserved keyword.
//
// MERGE DISCIPLINE (the audit's rule): the cloud sync NEVER clobbers the whole list. It merges row by
// row, keyed by cloudId (stable across rename), adopting the seeded legacy rows by slug ONCE. Writes go
// cloud-first (create) or optimistic-cache-then-cloud (rename/trash/restore), and the returned cloud row
// is read back into the cache — never a fire-and-forget that leaves the cache guessing.

import { recencyKey } from './library-time.js';
import { generateSlug } from './slug.js';

export const INDEX_KEY = 'scripts_index_v1';
// Tombstone set of cloudIds the user purged locally, so a background cloud merge can't resurrect them.
// (True multi-user cloud-purge is deferred to a later wave; this keeps THIS device consistent.)
const PURGED_KEY = 'scripts_purged_v1';

const API = '/api/script-projects';

// Routing keywords a project slug must never shadow (mirrors the Interpreter's RESERVED_ROUTE_KEYWORDS
// so `#library` can't be hijacked by a doc named "Library"). Kept in sync with api/script-projects.js.
export const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

// Fired after a background cloud sync merges new rows into the cache, so the library view can refresh.
export const PROJECTS_CHANGED_EVENT = 'sl-projects-changed';

// ── array-safe index I/O ──────────────────────────────────────────────────────

/** Read the index. GUARANTEES an array — any non-array/corrupt store degrades to []. */
export function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeIndex(rows) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch {}
  return rows;
}

function readPurged() {
  try {
    const raw = localStorage.getItem(PURGED_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
function addPurged(cloudId) {
  if (!cloudId) return;
  try {
    const s = readPurged();
    s.add(cloudId);
    localStorage.setItem(PURGED_KEY, JSON.stringify([...s]));
  } catch {}
}

function emitChanged() {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT));
    }
  } catch {}
}

// ── queries (synchronous, cache-backed — the UI never blocks on the network) ───────────────────────

/** Active (non-trashed) projects, newest-edited first. NaN-safe sort. */
export function activeProjects() {
  return readIndex()
    .filter((r) => r && !r.trashedAt)
    .sort((a, b) => recencyKey(b && b.updatedAt) - recencyKey(a && a.updatedAt));
}

/** Trashed projects, most-recently-trashed first. Un-orderable rows KEPT (recencyKey→0). */
export function trashedProjects() {
  return readIndex()
    .filter((r) => r && r.trashedAt)
    .sort((a, b) => recencyKey(b && b.trashedAt) - recencyKey(a && a.trashedAt));
}

export function findBySlug(slug) {
  return readIndex().find((r) => r && r.slug === slug) || null;
}

export function findById(id) {
  return readIndex().find((r) => r && r.id === id) || null;
}

// ── identity ────────────────────────────────────────────────────────────────

/** `local_`-prefixed id — matches the engine's local_* id convention, needs no server. */
function newId() {
  let rand;
  try {
    rand = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  } catch {
    rand = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }
  return `local_${rand}`;
}

/**
 * A slug unique against the current index, and never a reserved routing keyword.
 * Appends -2, -3… on collision; prefixes a reserved base with -1 (mirrors the
 * Interpreter's ensureUniqueSlug). excludeId lets a rename keep its own slug.
 */
export function ensureUniqueSlug(base, excludeId = null) {
  const taken = new Set(
    readIndex()
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

// ── cloud transport (thin; every call degrades gracefully to null on any failure) ──────────────────

async function apiList(trashed) {
  try {
    const res = await fetch(trashed ? `${API}?trashed=1` : API, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && Array.isArray(body.projects) ? body.projects : null;
  } catch { return null; }
}

async function apiCreate(payload) {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && body.project ? body.project : null;
  } catch { return null; }
}

async function apiPatch(cloudId, fields) {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(cloudId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && body.project ? body.project : null;
  } catch { return null; }
}

// HARD DELETE a cloud project row — the true multi-user purge (gone for ALL teammates, not just a local
// tombstone). Resolves to true on a 2xx, false on any failure (offline / 403 protected / unknown). NEVER
// throws — the caller has already removed the row locally and tombstoned it, so a failed cloud delete just
// means the row stays for other devices until a retry; THIS device is already consistent.
async function apiDelete(cloudId) {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(cloudId)}`, { method: 'DELETE' });
    return !!(res && res.ok);
  } catch { return false; }
}

// Seeded, precious projects that must never be hard-deleted (mirrors PROTECTED_SLUGS in
// api/script-projects.js). The server refuses these with 403 too — this is the belt-and-suspenders
// client guard so we don't even fire a doomed DELETE for burma/palau.
const PROTECTED_SLUGS = new Set(['burma', 'palau', 'palau2']);

// ── cloud → cache MERGE (row by row; never a whole-list clobber) ────────────────────────────────────

/**
 * Merge a batch of cloud rows into the local cache. Keyed by cloudId (stable across rename); the seeded
 * legacy rows (burma/palau) are adopted ONCE by slug so they LINK to their existing cloud row instead of
 * duplicating. Cloud wins for the shared fields (title, trashedAt, updatedAt); the local id/episode/slug
 * are preserved so a legacy row keeps its pinned namespace and a locally-renamed slug isn't reverted.
 * Purged cloudIds are filtered out (tombstone). Returns true if the cache changed.
 */
export function mergeCloudRows(cloudRows) {
  if (!Array.isArray(cloudRows) || !cloudRows.length) return false;
  const purged = readPurged();
  const cache = readIndex();
  const result = cache.map((r) => ({ ...r }));

  const byCloudId = new Map();
  const bySlugUnlinked = new Map(); // rows WITHOUT a cloudId, for the one-time legacy adoption
  for (const r of result) {
    if (!r) continue;
    if (r.cloudId) byCloudId.set(r.cloudId, r);
    else if (r.slug) bySlugUnlinked.set(r.slug, r);
  }

  const before = JSON.stringify(result);

  for (const c of cloudRows) {
    if (!c || !c.id) continue;
    if (purged.has(c.id)) continue; // never resurrect a locally-purged project

    let row = byCloudId.get(c.id) || bySlugUnlinked.get(c.slug) || null;
    if (row) {
      const wasUnlinked = !row.cloudId;
      row.cloudId = c.id;
      row.title = c.title != null ? c.title : row.title;
      // Keep the local episode (legacy pin) if present; otherwise adopt the cloud's.
      row.episode = row.episode ?? (c.episode ?? null);
      row.trashedAt = c.trashed_at ?? null;
      if (c.updated_at) row.updatedAt = c.updated_at;
      byCloudId.set(c.id, row);
      if (wasUnlinked && row.slug) bySlugUnlinked.delete(row.slug);
    } else {
      row = {
        id: c.id,          // a teammate's project: the cloud UUID IS its id (drives its script_<id>_* namespace + cloud.api)
        cloudId: c.id,
        slug: c.slug,
        title: c.title,
        episode: c.episode ?? null,
        createdAt: c.created_at || new Date().toISOString(),
        updatedAt: c.updated_at || new Date().toISOString(),
        trashedAt: c.trashed_at ?? null,
      };
      result.push(row);
      byCloudId.set(c.id, row);
    }
  }

  const changed = JSON.stringify(result) !== before;
  if (changed) writeIndex(result);
  return changed;
}

/**
 * Fetch the cloud project lists (active + trashed) and merge them into the cache. Fire this in the
 * BACKGROUND from the library view; it emits PROJECTS_CHANGED_EVENT if the cache changed so the view can
 * refresh. Resilient: if the API is unreachable, the cache is left untouched and the app keeps working
 * from it. NEVER throws.
 */
export async function syncFromCloud() {
  const [active, trashed] = await Promise.all([apiList(false), apiList(true)]);
  if (active == null && trashed == null) return false; // fully offline — keep the cache as-is
  const rows = [...(active || []), ...(trashed || [])];
  const changed = mergeCloudRows(rows);
  if (changed) emitChanged();
  return changed;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Create a brand-new (episode-less) project. CLOUD-FIRST: try to create the shared cloud row so the
 * project is instantly visible to teammates AND gets a real cloud id (which drives its cloud doc
 * namespace + /api/script-doc path). If the API is unreachable, fall back to a `local_`-id row so the
 * app still works offline (that project stays device-local until a future sync). Returns the cache row.
 */
export async function createProject(title) {
  const now = new Date().toISOString();
  const clean = String(title || '').trim() || 'Untitled Script';
  const slug = ensureUniqueSlug(generateSlug(clean));

  const cloud = await apiCreate({ slug, title: clean, episode: null, config: {} });

  let row;
  if (cloud && cloud.id) {
    row = {
      id: cloud.id,           // the cloud UUID is the canonical id — drives script_<id>_* + ?project=<id>
      cloudId: cloud.id,
      slug: cloud.slug || slug,
      title: cloud.title || clean,
      episode: null,
      createdAt: cloud.created_at || now,
      updatedAt: cloud.updated_at || now,
      trashedAt: null,
    };
  } else {
    // Offline / API down — a local-only project. It still opens and saves locally; its doc lives in the
    // script_<local_id>_* namespace and the cloud pill will honestly read "saved on this device".
    row = {
      id: newId(),
      slug,
      title: clean,
      episode: null,
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
    };
  }

  const rows = readIndex();
  rows.push(row);
  writeIndex(rows);
  return row;
}

/** Rename a project (updates title + slug, keeps id). Optimistic cache write, then cloud PATCH. */
export function renameProject(id, title) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  const clean = String(title || '').trim();
  if (clean) {
    row.title = clean;
    row.slug = ensureUniqueSlug(generateSlug(clean), id);
  }
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  // Sync the title to the cloud (slug stays local-authoritative — the doc path/merge key is cloudId).
  if (clean && row.cloudId) {
    apiPatch(row.cloudId, { title: clean }).then((c) => { if (c) reconcileCloudRow(id, c); });
  }
  return row;
}

/** Bump a project's updatedAt (called when its doc is opened/edited). Local-only; cheap. */
export function touchProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  return row;
}

/** Soft-delete: move a project to the trash. Optimistic cache write, then cloud PATCH. */
export function trashProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  const iso = new Date().toISOString();
  row.trashedAt = iso;
  writeIndex(rows);
  if (row.cloudId) apiPatch(row.cloudId, { trashed_at: iso }).then((c) => { if (c) reconcileCloudRow(id, c); });
  return row;
}

/** Restore a trashed project. Optimistic cache write, then cloud PATCH. */
export function restoreProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.trashedAt = null;
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  if (row.cloudId) apiPatch(row.cloudId, { trashed_at: null }).then((c) => { if (c) reconcileCloudRow(id, c); });
  return row;
}

// Read a cloud row back into the cache after a write, so the cache mirrors what the server stored (the
// "read-back after write" discipline). Keyed by local id; NEVER throws.
function reconcileCloudRow(localId, cloudRow) {
  try {
    const rows = readIndex();
    const row = rows.find((r) => r && r.id === localId);
    if (!row || !cloudRow) return;
    row.cloudId = cloudRow.id || row.cloudId;
    row.title = cloudRow.title != null ? cloudRow.title : row.title;
    row.trashedAt = cloudRow.trashed_at ?? row.trashedAt;
    if (cloudRow.updated_at) row.updatedAt = cloudRow.updated_at;
    writeIndex(rows);
    emitChanged();
  } catch {}
}

/**
 * Purge a trashed project for good: drop the index row AND its local doc keys + IndexedDB recovery DB,
 * AND — now — hard-delete the shared cloud row so the project is gone for ALL teammates, not just a local
 * tombstone. storageKeys/dbName are passed in by the caller (derived from configForProject) so this store
 * stays free of engine imports. Best-effort: a failed key/db delete never blocks removing the row.
 *
 * Cloud purge: fired in the BACKGROUND (fire-and-forget) via the DELETE route, which cascades the doc +
 * full revision history + presence. The cloudId is ALSO tombstoned so that even if the cloud DELETE is
 * unreachable right now, a background sync can't resurrect the row on THIS device — the local fallback
 * keeps this device consistent while the server-side removal catches up. The seeded burma/palau projects
 * are NEVER hard-deleted (guarded here AND server-side); they can still be trashed/hidden locally.
 */
export function purgeProject(id, { storageKeys = [], dbName = null } = {}) {
  const target = readIndex().find((r) => r && r.id === id);
  // Fire the true multi-user cloud DELETE first (background) — but NEVER for a seeded/protected project.
  if (target && target.cloudId && !PROTECTED_SLUGS.has(String(target.slug || '').toLowerCase())) {
    addPurged(target.cloudId); // tombstone so a sync can't resurrect it on THIS device regardless
    try { apiDelete(target.cloudId); } catch {}
  } else if (target && target.cloudId) {
    // Protected (burma/palau): still tombstone locally so it hides here, but do NOT attempt a cloud delete.
    addPurged(target.cloudId);
  }
  const rows = readIndex().filter((r) => !(r && r.id === id));
  writeIndex(rows);
  for (const k of storageKeys) {
    try { localStorage.removeItem(k); } catch {}
  }
  if (dbName) {
    try { globalThis.indexedDB && globalThis.indexedDB.deleteDatabase(dbName); } catch {}
  }
  return rows;
}

// ── one-time seeder ───────────────────────────────────────────────────────────

/**
 * MIGRATION SEEDER. On the very first Script Library load — when the index key is ABSENT (not merely an
 * empty array) — seed the pinned legacy rows — Burma, Palau and Palau V2 — with slugs 'burma'/'palau'/'palau2' and episode ids that
 * make configForProject return the PINNED legacy configs (the existing wp01_burma_* / script_palau_*
 * namespaces). So opening either seeded project loads its already-saved doc with ZERO data loss. These
 * rows carry NO cloudId — the first syncFromCloud() adopts them by slug and LINKS them to their existing
 * cloud rows (burma/palau) rather than creating duplicates. Idempotent: a present key (even `[]`) is
 * left untouched.
 */
export function seedIfAbsent() {
  let present = true;
  try { present = localStorage.getItem(INDEX_KEY) !== null; } catch { present = true; }
  if (present) return false;
  const now = Date.now();
  const rows = [
    {
      id: 'local_seed_palau2',
      slug: 'palau2',
      title: 'Palau V2',
      episode: 'palau2',
      createdAt: new Date(now - 500).toISOString(),
      updatedAt: new Date(now + 500).toISOString(),
      trashedAt: null,
    },
    {
      id: 'local_seed_palau',
      slug: 'palau',
      title: 'Palau — The Human Element',
      episode: 'palau',
      createdAt: new Date(now - 1000).toISOString(),
      updatedAt: new Date(now).toISOString(),
      trashedAt: null,
    },
    {
      id: 'local_seed_burma',
      slug: 'burma',
      title: 'Burma — The Human Element',
      episode: 'burma',
      createdAt: new Date(now - 2000).toISOString(),
      updatedAt: new Date(now - 1000).toISOString(),
      trashedAt: null,
    },
  ];
  writeIndex(rows);
  return true;
}
