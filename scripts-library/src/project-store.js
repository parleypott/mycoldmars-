// The Script Library's LOCAL project index — the disk source of truth for the
// list of script projects. Mirrors the ROLE of translation/src/db.js's projects
// section, but local-first and tiny: one localStorage key holding a JSON ARRAY.
//
// Every read is ARRAY-SAFE (a corrupt / hand-edited / quota-truncated store can
// hold a valid-but-non-array JSON value; the old `JSON.parse(x) || []` returns
// that non-array verbatim and the first `.map`/`for…of` throws — same class as
// translation's ls-index.js `lsGetIndex` fix). Sorting is NaN/missing-safe via
// library-time's recencyKey (a single NaN date poisons V8's TimSort and scrambles
// the whole list). Trash KEEPS un-orderable rows recoverable. Slugs are unique
// against the array and never shadow a reserved routing keyword.

import { recencyKey } from './library-time.js';
import { generateSlug } from './slug.js';

export const INDEX_KEY = 'scripts_index_v1';

// Routing keywords a project slug must never shadow (mirrors the Interpreter's
// RESERVED_ROUTE_KEYWORDS so `#library` can't be hijacked by a doc named "Library").
export const RESERVED_SLUGS = new Set(['library', 'trash', 'new', 'home']);

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

// ── queries ───────────────────────────────────────────────────────────────────

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

// ── CRUD ───────────────────────────────────────────────────────────────────

/** Create a brand-new (episode-less) project row and return it. */
export function createProject(title) {
  const rows = readIndex();
  const now = new Date().toISOString();
  const clean = String(title || '').trim() || 'Untitled Script';
  const row = {
    id: newId(),
    slug: ensureUniqueSlug(generateSlug(clean)),
    title: clean,
    episode: null, // null => configForProject builds a fresh script_<id>_* namespace
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
  };
  rows.push(row);
  writeIndex(rows);
  return row;
}

/** Rename a project (updates title + slug, keeps id). Returns the updated row. */
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
  return row;
}

/** Bump a project's updatedAt (called when its doc is opened/edited). */
export function touchProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  return row;
}

/** Soft-delete: move a project to the trash. */
export function trashProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.trashedAt = new Date().toISOString();
  writeIndex(rows);
  return row;
}

/** Restore a trashed project. */
export function restoreProject(id) {
  const rows = readIndex();
  const row = rows.find((r) => r && r.id === id);
  if (!row) return null;
  row.trashedAt = null;
  row.updatedAt = new Date().toISOString();
  writeIndex(rows);
  return row;
}

/**
 * Purge a trashed project for good: drop the index row AND its local doc keys +
 * IndexedDB recovery DB. storageKeys/dbName are passed in by the caller (derived
 * from configForProject) so this store stays free of engine imports. Best-effort:
 * a failed key/db delete never blocks removing the row.
 */
export function purgeProject(id, { storageKeys = [], dbName = null } = {}) {
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
 * MIGRATION SEEDER. On the very first Script Library load — when the index key is
 * ABSENT (not merely an empty array) — seed exactly two rows, Burma and Palau,
 * with slugs 'burma'/'palau' and episode ids that make configForProject return the
 * PINNED legacy configs (the existing wp01_burma_* / script_palau_* namespaces).
 * So opening either seeded project loads its already-saved doc with ZERO data loss.
 * Idempotent: a present key (even `[]`) is left untouched.
 */
export function seedIfAbsent() {
  let present = true;
  try { present = localStorage.getItem(INDEX_KEY) !== null; } catch { present = true; }
  if (present) return false;
  const now = Date.now();
  const rows = [
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
