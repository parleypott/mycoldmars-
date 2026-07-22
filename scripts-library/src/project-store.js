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

import { recencyKey, isArchivedTrash } from './library-time.js';
import { generateSlug } from './slug.js';

export const INDEX_KEY = 'scripts_index_v1';
// Tombstone set of cloudIds the user purged locally, so a background cloud merge can't resurrect them.
// (True multi-user cloud-purge is deferred to a later wave; this keeps THIS device consistent.)
const PURGED_KEY = 'scripts_purged_v1';

const API = '/api/script-projects';

// Routing keywords a project slug must never shadow (mirrors the Interpreter's RESERVED_ROUTE_KEYWORDS
// so `#library` can't be hijacked by a doc named "Library"). Kept in sync with api/script-projects.js.
export const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

// The slug SHAPE the server enforces (SLUG_RE in api/script-projects.js). Cross-checked against the
// server copy by reserved-slug-parity.test.mjs — kept here so the client can validate a slug BEFORE
// pushing it to the cloud (the drift-heal push) instead of firing a doomed PATCH.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Is this slug safe to PATCH up to the cloud? Right shape, in-bounds length, not a reserved route.
function isPushableSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 60
    && SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

// Fired after a background cloud sync merges new rows into the cache, so the library view can refresh.
export const PROJECTS_CHANGED_EVENT = 'sl-projects-changed';

// Fired when a rename's regenerated slug collided with another project's slug in the cloud (409). The
// rename keeps the OLD slug on both sides (nothing drifts); a live view can show a calm note. detail:
// { id, slug } — the local id and the slug that was refused.
export const SLUG_CONFLICT_EVENT = 'sl-slug-conflict';

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

// Which projects have already had ONE drift-heal attempt this browser session. sessionStorage (not
// localStorage) so it survives the reload an "open" triggers but resets on a genuinely new session —
// exactly "one heal attempt per project per session". Array-safe like the other stores.
const SLUG_HEAL_KEY = 'scripts_slug_heal_v1';
function readHealAttempted() {
  try {
    const raw = sessionStorage.getItem(SLUG_HEAL_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
function markHealAttempted(cloudId) {
  if (!cloudId) return;
  try {
    const s = readHealAttempted();
    s.add(cloudId);
    sessionStorage.setItem(SLUG_HEAL_KEY, JSON.stringify([...s]));
  } catch {}
}

// ── queries (synchronous, cache-backed — the UI never blocks on the network) ───────────────────────

/** Active (non-trashed, non-deleted) projects, newest-edited first. NaN-safe sort. */
export function activeProjects() {
  return readIndex()
    .filter((r) => r && !r.trashedAt && !r.deletedAt)
    .sort((a, b) => recencyKey(b && b.updatedAt) - recencyKey(a && a.updatedAt));
}

/** Trashed OR soft-deleted projects still within the 90-day archive window, most-recently-trashed
 *  first. Un-orderable rows KEPT (recencyKey→0); a row with NO parseable trash clock is also kept
 *  (never hide what you can't date). Rows past the window are ARCHIVED — hidden here (the server's
 *  trash list already excludes them; this is the offline-cache belt) but NOT destroyed: the cloud
 *  row + full revision history survive, and restoreProject / an admin PATCH still works (age-blind).
 *  Soft-deleted rows belong in the trash view — "deleted" is recoverable now, never gone. */
export function trashedProjects(now = Date.now()) {
  return readIndex()
    .filter((r) => r && (r.trashedAt || r.deletedAt))
    .filter((r) => !isArchivedTrash(r.trashedAt || r.deletedAt, now))
    .sort((a, b) => recencyKey(b && (b.trashedAt || b.deletedAt)) - recencyKey(a && (a.trashedAt || a.deletedAt)));
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

// PATCH that keeps the HTTP status — the slug paths (rename, drift-heal) need to tell a 409 slug
// collision (adopt the cloud slug / keep the old one) apart from a plain offline/5xx failure (retry
// later). apiPatch above stays the thin null-or-row helper the trash/restore callers use. NEVER throws.
async function apiPatchRaw(cloudId, fields) {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(cloudId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return {
      ok: !!(res && res.ok),
      status: res ? res.status : 0,
      project: body && body.project ? body.project : null,
      error: body && body.error ? body.error : null,
    };
  } catch { return { ok: false, status: 0, project: null, error: null }; }
}

// SOFT-delete a cloud project row. The server's DELETE verb no longer destroys anything — it stamps
// deleted_at/deleted_by, so the project drops off everyone's active list but stays restorable (its doc
// + full revision history survive; the hard-DELETE/FK-cascade path was removed server-side after the
// audit). Resolves to true on a 2xx, false on any failure (offline / 403 protected / unknown). NEVER
// throws — the caller has already removed the row locally and tombstoned it, so a failed cloud delete
// just means the row stays visible for other devices until a retry; THIS device is already consistent.
async function apiDelete(cloudId) {
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(cloudId)}`, { method: 'DELETE' });
    return !!(res && res.ok);
  } catch { return false; }
}

// Seeded, precious projects that must never be deleted — even softly (mirrors PROTECTED_SLUGS in
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
      row.deletedAt = c.deleted_at ?? null;
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
        deletedAt: c.deleted_at ?? null,
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

/**
 * Rename a project (updates title + slug, keeps id). Optimistic cache write, then cloud PATCH of BOTH
 * the title AND the regenerated slug.
 *
 * The slug sync is the fix for SLUG DRIFT: guest ?slug= links resolve via the CLOUD slug, and every
 * teammate's client refreshes its slug from the cloud list — so a rename that pushed only the title
 * (as this did before) left the cloud slug stale. The renamer's own browser looked fine (its local
 * index + URL carried the new slug), but shared links broke and teammates held a different slug than
 * the owner shared. Now the new slug goes up with the title.
 *
 * The PATCH is fired before the caller's reload (masthead path) so the request reaches the server even
 * though its .then() won't run post-navigation — the happy path lands both fields server-side. On the
 * rare cloud 409 (the slug is taken by a teammate project not present in THIS index, so ensureUniqueSlug
 * couldn't dedupe against it): revert the local slug to the previous one so BOTH sides keep the old slug
 * (nothing drifts), still land the title so the rename isn't lost, and fire SLUG_CONFLICT_EVENT for any
 * live view. Any other failure (offline / 5xx) leaves the optimistic title+slug in the cache; the next
 * signed-in open reconciles the slug against the cloud via healSlugDrift. Never wedges.
 */
export function renameProject(id, title) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  const clean = String(title || '').trim();
  const prevSlug = row.slug;
  if (clean) {
    row.title = clean;
    row.slug = ensureUniqueSlug(generateSlug(clean), id);
  }
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  if (clean && row.cloudId) {
    const cloudId = row.cloudId;
    const newSlug = row.slug;
    apiPatchRaw(cloudId, { title: clean, slug: newSlug }).then((res) => {
      if (res.ok && res.project) { reconcileCloudRow(id, res.project); return; }
      if (res.status === 409) {
        // Cloud slug collision — keep the OLD slug on both sides, still land the title, surface calmly.
        revertSlugKeepTitle(id, prevSlug);
        apiPatchRaw(cloudId, { title: clean }).then((r2) => { if (r2.ok && r2.project) reconcileCloudRow(id, r2.project); });
        emitSlugConflict(id, newSlug);
      }
    });
  }
  return row;
}

// Undo an optimistic slug change (keeping the new title) after a cloud 409 — the cloud kept the OLD
// slug, so the cache must too or guest links / teammate refreshes drift. NEVER throws.
function revertSlugKeepTitle(localId, prevSlug) {
  try {
    const rows = readIndex();
    const row = rows.find((r) => r && r.id === localId);
    if (!row) return;
    row.slug = prevSlug;
    writeIndex(rows);
    emitChanged();
  } catch {}
}

function emitSlugConflict(localId, attemptedSlug) {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(SLUG_CONFLICT_EVENT, { detail: { id: localId, slug: attemptedSlug } }));
    }
  } catch {}
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

/** Restore a trashed OR soft-deleted project. Optimistic cache write, then cloud PATCH. Clears BOTH
 *  flags (the server accepts deleted_at only as null — the restore) so Restore always wins. */
export function restoreProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.trashedAt = null;
  row.deletedAt = null;
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  if (row.cloudId) apiPatch(row.cloudId, { trashed_at: null, deleted_at: null }).then((c) => { if (c) reconcileCloudRow(id, c); });
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
    if ('deleted_at' in cloudRow) row.deletedAt = cloudRow.deleted_at ?? null;
    if (cloudRow.updated_at) row.updatedAt = cloudRow.updated_at;
    writeIndex(rows);
    emitChanged();
  } catch {}
}

/**
 * DRIFT HEAL — reconcile a project's cloud slug with the local one on a signed-in OPEN. Renames done
 * BEFORE the slug-sync fix pushed only the title, leaving the cloud SLUG stale — so guest ?slug= links
 * (which resolve via the cloud slug) broke and teammates refreshed to a different slug than the owner
 * shared. On open we compare the LOCAL slug (which is the slug in THIS user's URL — they navigated here
 * by it) against the cloud slug for the same project id:
 *   • in sync                         → nothing to do
 *   • local ≠ cloud, local pushable   → push the LOCAL slug up (the owner's URL is the shared one), so
 *                                       the cloud — the guest/teammate source of truth — matches it
 *   • push rejected (409 collision / not pushable) → adopt the CLOUD slug locally instead, never wedge
 *
 * At most ONE attempt per project per browser session (sessionStorage). Quiet console.info logging, no
 * loop. Resolves { action: 'insync'|'pushed'|'adopted'|'skip', slug? } so the caller (boot.openProject)
 * can realign the URL + route state when we adopt the cloud slug. Fire-and-forget; NEVER throws.
 *
 * Only meaningful for a signed-in session with a real cloud row: apiList is login-gated (the gate.js
 * interceptor carries the JWT), a guest never calls this, and a local-only (no cloudId) project has no
 * cloud slug to drift against.
 */
export async function healSlugDrift(row) {
  try {
    if (!row || !row.cloudId || !row.slug) return { action: 'skip' };
    if (readHealAttempted().has(row.cloudId)) return { action: 'skip' };

    const list = await apiList(false);
    if (!Array.isArray(list)) return { action: 'skip' };            // offline — don't burn the attempt
    const cloudRow = list.find((c) => c && c.id === row.cloudId);
    if (!cloudRow || !cloudRow.slug) return { action: 'skip' };     // not an active cloud row — nothing to heal

    markHealAttempted(row.cloudId);                                 // a real check ran; don't repeat this session
    if (cloudRow.slug === row.slug) return { action: 'insync' };

    const localSlug = row.slug;
    if (isPushableSlug(localSlug)) {
      const res = await apiPatchRaw(row.cloudId, { slug: localSlug });
      if (res.ok && res.project && res.project.slug === localSlug) {
        reconcileCloudRow(row.id, res.project);
        console.info('[slug-heal] pushed local slug to cloud', row.cloudId, localSlug);
        return { action: 'pushed', slug: localSlug };
      }
      console.info('[slug-heal] local push rejected, adopting cloud slug', row.cloudId, res.status, cloudRow.slug);
    }
    adoptCloudSlug(row.id, cloudRow.slug);
    return { action: 'adopted', slug: cloudRow.slug };
  } catch { return { action: 'skip' }; }
}

// Take the cloud slug as local truth (the heal fallback — cloud is truth for guests). Updates the
// cache row's slug and notifies; the caller realigns the URL. NEVER throws.
function adoptCloudSlug(localId, cloudSlug) {
  try {
    const rows = readIndex();
    const row = rows.find((r) => r && r.id === localId);
    if (!row || !cloudSlug) return;
    row.slug = cloudSlug;
    writeIndex(rows);
    emitChanged();
  } catch {}
}

/**
 * "Delete forever" — DEFANGED. Nobody can hard-delete anymore (Johnny's order after the audit found
 * any pool member could cascade away a project's entire revision history). This now means "remove
 * from MY trash view": the index row is dropped and the cloudId tombstoned so a background sync
 * can't resurrect it on THIS device — but NOTHING is destroyed:
 *   • the cloud DELETE it fires is a SOFT delete server-side (stamps deleted_at/deleted_by; the doc
 *     and its full append-only revision history survive and the row stays restorable from any
 *     teammate's trash view — or by an admin clearing deleted_at)
 *   • the local doc keys and the IndexedDB recovery DB are NO LONGER deleted. The storageKeys/dbName
 *     args are still accepted (callers pass them) but deliberately IGNORED — for a never-synced
 *     local_ project those bytes are the ONLY copy in existence, and even for a synced one they are
 *     the offline recovery layer. Orphaned local data is a cheap price for un-losable scripts.
 * The seeded burma/palau projects never even fire the (soft) cloud delete; they just hide locally.
 */
export function purgeProject(id, { storageKeys = [], dbName = null } = {}) { // eslint-disable-line no-unused-vars
  const target = readIndex().find((r) => r && r.id === id);
  // Fire the cloud SOFT delete first (background) — but NEVER for a seeded/protected project.
  if (target && target.cloudId && !PROTECTED_SLUGS.has(String(target.slug || '').toLowerCase())) {
    addPurged(target.cloudId); // tombstone so a sync can't resurrect it on THIS device regardless
    try { apiDelete(target.cloudId); } catch {}
  } else if (target && target.cloudId) {
    // Protected (burma/palau): still tombstone locally so it hides here, but do NOT attempt a cloud delete.
    addPurged(target.cloudId);
  }
  const rows = readIndex().filter((r) => !(r && r.id === id));
  writeIndex(rows);
  // Local doc keys + recovery DB intentionally left in place — see the doc comment above.
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
