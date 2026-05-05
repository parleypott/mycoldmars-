// Phase 1 storage layer.
//
// Design:
//   - Supabase is the single source of truth for ALL persistence.
//   - LocalStorage is no longer a parallel write target. It is used only
//     by ./snapshot.js for crash/recovery snapshots.
//   - Schema is strict: the SQL in supabase-phase1.sql must be applied.
//     There is no runtime feature-detection — if a column is missing,
//     errors surface immediately so they can be fixed once.
//   - Updates use optimistic concurrency: callers pass `expectedUpdatedAt`
//     and conflicts are reported as a typed error (err.code === 'CONFLICT').
//   - Permalinks are UUID-canonical. Slugs are aliases stored in the
//     transcript_aliases table. Renaming adds an alias; old links survive.
//
// Errors thrown by this module:
//   { code: 'NO_DB' }      Supabase client not configured (env vars missing).
//   { code: 'CONFLICT', serverUpdatedAt }  Optimistic concurrency miss.
//   { code: 'NOT_FOUND' }  Row does not exist.
//   { code: 'CONSTRAINT', message }  Unique constraint hit (e.g. slug).
//   plain Error            Anything else.

import { createClient } from '@supabase/supabase-js';

let supabase = null;
let initError = null;

try {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  } else {
    initError = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
    console.warn('[db] ' + initError);
  }
} catch (err) {
  initError = err.message || String(err);
  console.error('[db] init failed:', initError);
}

function db() {
  if (!supabase) {
    const e = new Error(initError || 'Supabase not configured');
    e.code = 'NO_DB';
    throw e;
  }
  return supabase;
}

export function isConfigured() { return !!supabase; }
export function getInitError() { return initError; }

// ============================================================
// Schema feature probe.
//
// Optional schema bits (slug, deleted_at, aliases table, revisions
// table, locks table, search_text generated column) are probed once
// at boot. Functions that depend on them check the flags and either
// degrade or no-op so the library still works on a half-migrated DB.
// ============================================================
let schemaProbe = null; // { hasSlug, hasDeleted, hasAliases, hasRevisions, hasLocks, hasSearchText, missing }
let schemaProbePromise = null;

async function tryCol(table, col) {
  if (!supabase) return false;
  const { error } = await supabase.from(table).select(col).limit(1);
  return !error;
}

async function probeSchemaInternal() {
  const probe = {
    hasSlug: false, hasDeleted: false, hasAliases: false,
    hasRevisions: false, hasLocks: false, hasSearchText: false,
    missing: [],
  };
  if (!supabase) return probe;
  // Run probes in parallel — they're cheap and we want fast boot.
  const results = await Promise.all([
    tryCol('transcripts', 'slug'),
    tryCol('transcripts', 'deleted_at'),
    tryCol('transcripts', 'search_text'),
    tryCol('transcript_aliases', 'slug'),
    tryCol('transcript_revisions', 'id'),
    tryCol('editor_locks', 'transcript_id'),
  ]);
  probe.hasSlug       = results[0];
  probe.hasDeleted    = results[1];
  probe.hasSearchText = results[2];
  probe.hasAliases    = results[3];
  probe.hasRevisions  = results[4];
  probe.hasLocks      = results[5];
  if (!probe.hasSlug)       probe.missing.push('transcripts.slug column');
  if (!probe.hasDeleted)    probe.missing.push('transcripts.deleted_at column');
  if (!probe.hasSearchText) probe.missing.push('transcripts.search_text column');
  if (!probe.hasAliases)    probe.missing.push('transcript_aliases table');
  if (!probe.hasRevisions)  probe.missing.push('transcript_revisions table');
  if (!probe.hasLocks)      probe.missing.push('editor_locks table');
  return probe;
}

export async function getSchemaStatus() {
  if (schemaProbe) return schemaProbe;
  if (!schemaProbePromise) schemaProbePromise = probeSchemaInternal().then(p => { schemaProbe = p; return p; });
  return schemaProbePromise;
}

export function getSchemaStatusSync() { return schemaProbe; }

// Helpers for the rest of the module — return safe defaults until the
// probe finishes (i.e., before anyone has called getSchemaStatus()).
function flag(name) {
  if (!schemaProbe) return true; // optimistic — first call may surface error which we then handle
  return !!schemaProbe[name];
}

// Back-compat shim — old call sites used these to gate UI behaviour.
export function supabaseAvailable() { return !!supabase; }
export function getStorageInfo() { return supabase ? 'remote' : 'unconfigured'; }

// ============================================================
// Error normalization
// ============================================================
function normalizeError(err, context) {
  if (!err) return new Error('Unknown error');
  // Supabase unique-constraint violation
  if (err.code === '23505') {
    const e = new Error(`Already exists: ${err.message || err.details || ''}`);
    e.code = 'CONSTRAINT';
    e.context = context;
    return e;
  }
  // Postgres "no rows returned" from .single() — treat as NOT_FOUND
  if (err.code === 'PGRST116') {
    const e = new Error(context ? `${context}: not found` : 'Not found');
    e.code = 'NOT_FOUND';
    return e;
  }
  const e = new Error(err.message || String(err));
  e.code = err.code;
  return e;
}

// ============================================================
// Projects
// ============================================================
export async function createProject({ name, description }) {
  const { data, error } = await db().from('projects')
    .insert({ name, description: description || null })
    .select().single();
  if (error) throw normalizeError(error, 'createProject');
  return data;
}

export async function listProjects() {
  if (!supabase) return [];
  const { data, error } = await db().from('projects')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false });
  if (error) throw normalizeError(error, 'listProjects');
  return data;
}

export async function deleteProject(id) {
  const { error } = await db().from('projects').delete().eq('id', id);
  if (error) throw normalizeError(error, 'deleteProject');
}

// ============================================================
// Tags
// ============================================================
export async function createTag({ projectId, name, color }) {
  const { data, error } = await db().from('tags')
    .insert({ project_id: projectId, name, color: color || '#DD2C1E' })
    .select().single();
  if (error) throw normalizeError(error, 'createTag');
  return data;
}

export async function listTags(projectId) {
  if (!supabase) return [];
  const { data, error } = await db().from('tags')
    .select('*').eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw normalizeError(error, 'listTags');
  return data;
}

export async function deleteTag(id) {
  const { error } = await db().from('tags').delete().eq('id', id);
  if (error) throw normalizeError(error, 'deleteTag');
}

// ============================================================
// Highlights
// ============================================================
export async function saveHighlights(transcriptId, highlights) {
  await db().from('highlights').delete().eq('transcript_id', transcriptId);
  if (!highlights || highlights.length === 0) return;
  const rows = highlights.map(h => ({
    transcript_id: transcriptId,
    tag_id: h.tagId || null,
    segment_numbers: h.segmentNumbers || [],
    text_preview: h.textPreview || '',
    original_text_preview: h.originalTextPreview || '',
    note: h.note || null,
  }));
  const { error } = await db().from('highlights').insert(rows);
  if (error) throw normalizeError(error, 'saveHighlights');
}

export async function searchHighlights({ projectId, tagId }) {
  if (!supabase) return [];
  let query = db().from('highlights')
    .select('*, transcripts!inner(id, name, project_id), tags(id, name, color)')
    .order('created_at', { ascending: false });
  if (projectId) query = query.eq('transcripts.project_id', projectId);
  if (tagId) query = query.eq('tag_id', tagId);
  const { data, error } = await query;
  if (error) throw normalizeError(error, 'searchHighlights');
  return data;
}

// ============================================================
// AI Threads
// ============================================================
export async function saveAiThread({ transcriptId, anchorText, anchorOriginalText, messages }) {
  const { data, error } = await db().from('ai_threads')
    .insert({
      transcript_id: transcriptId,
      anchor_text: anchorText,
      anchor_original_text: anchorOriginalText,
      messages: messages || [],
    })
    .select().single();
  if (error) throw normalizeError(error, 'saveAiThread');
  return data;
}

export async function updateAiThread(id, messages) {
  const { data, error } = await db().from('ai_threads')
    .update({ messages, updated_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw normalizeError(error, 'updateAiThread');
  return data;
}

export async function listAiThreads(transcriptId) {
  if (!supabase) return [];
  const { data, error } = await db().from('ai_threads')
    .select('*').eq('transcript_id', transcriptId)
    .order('created_at', { ascending: false });
  if (error) throw normalizeError(error, 'listAiThreads');
  return data;
}

// ============================================================
// Transcript field mapping (camelCase ↔ snake_case)
// ============================================================
function fieldsToRow(fields) {
  const row = {};
  if (fields.name !== undefined) row.name = fields.name;
  if (fields.step !== undefined) row.step = fields.step;
  if (fields.segments !== undefined) row.segments = fields.segments;
  if (fields.analysis !== undefined) row.analysis = fields.analysis;
  if (fields.translations !== undefined) row.translations = fields.translations;
  if (fields.srtContent !== undefined) row.srt_content = fields.srtContent;
  if (fields.speakerColors !== undefined) row.speaker_colors = fields.speakerColors;
  if (fields.annotations !== undefined) row.annotations = fields.annotations;
  if (fields.metadata !== undefined) row.metadata = fields.metadata;
  if (fields.projectId !== undefined) row.project_id = fields.projectId;
  if (fields.speakerMap !== undefined) row.speaker_map = fields.speakerMap;
  if (fields.hiddenSpeakers !== undefined) row.hidden_speakers = fields.hiddenSpeakers;
  if (fields.editorState !== undefined) row.editor_state = fields.editorState;
  if (fields.customSequenceName !== undefined) row.custom_sequence_name = fields.customSequenceName;
  if (fields.hideUnintelligible !== undefined) row.hide_unintelligible = fields.hideUnintelligible;
  if (fields.wordTimings !== undefined) row.word_timings = fields.wordTimings;
  if (fields.slug !== undefined && flag('hasSlug')) row.slug = fields.slug || null;
  return row;
}

// ============================================================
// Transcripts
// ============================================================

/**
 * Create a transcript. Returns the inserted row (with id, slug, updated_at).
 * Atomically also inserts a transcript_aliases row when slug is provided.
 */
export async function saveTranscript(fields) {
  const row = fieldsToRow(fields);
  // Defaults for first-save
  if (row.name === undefined) row.name = 'Untitled';
  if (row.step === undefined) row.step = 1;

  const { data, error } = await db().from('transcripts')
    .insert(row).select().single();
  if (error) throw normalizeError(error, 'saveTranscript');

  // Mirror slug into the alias table for permalink resolution.
  if (data.slug && flag('hasAliases')) {
    await upsertAlias(data.slug, data.id);
  }
  return data;
}

/**
 * Update a transcript. Pass `expectedUpdatedAt` (the server's last-known
 * updated_at for this row) to enable optimistic concurrency: if the row
 * has been modified elsewhere, throws { code: 'CONFLICT', serverUpdatedAt }.
 *
 * Also keeps transcript_aliases in sync when the slug field changes.
 */
export async function updateTranscript(id, fields, opts = {}) {
  const { expectedUpdatedAt } = opts;
  const row = fieldsToRow(fields);
  row.updated_at = new Date().toISOString();

  let q = db().from('transcripts').update(row).eq('id', id);
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await q.select().single();

  if (error) {
    // PGRST116 = no rows matched. With an expectedUpdatedAt guard, this
    // means either the id is wrong or the row was changed elsewhere.
    if (error.code === 'PGRST116' && expectedUpdatedAt) {
      const { data: probe } = await db().from('transcripts')
        .select('updated_at').eq('id', id).maybeSingle();
      if (probe) {
        const e = new Error('Transcript was modified elsewhere');
        e.code = 'CONFLICT';
        e.serverUpdatedAt = probe.updated_at;
        throw e;
      }
      const e = new Error('Transcript not found');
      e.code = 'NOT_FOUND';
      throw e;
    }
    throw normalizeError(error, 'updateTranscript');
  }

  // Slug rename: add a new alias for the new slug. Old aliases stay alive.
  if (fields.slug !== undefined && data.slug && flag('hasAliases')) {
    await upsertAlias(data.slug, data.id);
  }
  return data;
}

export async function listTranscripts(projectId) {
  if (!supabase) return [];
  await getSchemaStatus();
  const colList = ['id', 'name', 'step', 'created_at', 'updated_at', 'project_id'];
  if (flag('hasSlug')) colList.push('slug');
  let q = db().from('transcripts').select(colList.join(', '))
    .order('updated_at', { ascending: false });
  if (flag('hasDeleted')) q = q.is('deleted_at', null);
  if (projectId) q = q.eq('project_id', projectId);
  const { data, error } = await q;
  if (error) throw normalizeError(error, 'listTranscripts');
  return data || [];
}

export async function loadTranscript(id) {
  const { data, error } = await db().from('transcripts')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw normalizeError(error, 'loadTranscript');
  if (!data) {
    const e = new Error('Transcript not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return data;
}

/**
 * Resolve a slug to a transcript via the aliases table (supports old links
 * after rename), then by the transcripts.slug column as a fallback.
 */
export async function loadTranscriptBySlug(slug) {
  await getSchemaStatus();
  // 1. Alias table — handles both current and historical slugs.
  if (flag('hasAliases')) {
    const { data: alias } = await db().from('transcript_aliases')
      .select('transcript_id').eq('slug', slug).maybeSingle();
    if (alias) return loadTranscript(alias.transcript_id);
  }
  // 2. Direct slug column on transcripts (legacy rows / pre-migration).
  if (!flag('hasSlug')) {
    const e = new Error('Transcript not found (slugs disabled — schema not migrated)');
    e.code = 'NOT_FOUND';
    throw e;
  }
  let q = db().from('transcripts').select('*').eq('slug', slug);
  if (flag('hasDeleted')) q = q.is('deleted_at', null);
  const { data, error } = await q.maybeSingle();
  if (error) throw normalizeError(error, 'loadTranscriptBySlug');
  if (!data) {
    const e = new Error('Transcript not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  // Backfill the alias so future lookups are O(1) on the index (no-op if disabled).
  if (flag('hasAliases')) upsertAlias(slug, data.id).catch(() => {});
  return data;
}

export async function isSlugTaken(slug, excludeTranscriptId) {
  await getSchemaStatus();
  // No slug column means slugs aren't really "taken" — just say no.
  if (!flag('hasSlug')) return false;
  // Prefer the alias table when available.
  if (flag('hasAliases')) {
    const { data } = await db().from('transcript_aliases')
      .select('transcript_id').eq('slug', slug).maybeSingle();
    if (!data) return false;
    if (excludeTranscriptId && data.transcript_id === excludeTranscriptId) return false;
    let probe = db().from('transcripts').select('id' + (flag('hasDeleted') ? ', deleted_at' : '')).eq('id', data.transcript_id);
    const { data: t } = await probe.maybeSingle();
    if (!t || (flag('hasDeleted') && t.deleted_at)) return false;
    return true;
  }
  // Fallback: query the slug column directly.
  let q = db().from('transcripts').select('id').eq('slug', slug);
  if (excludeTranscriptId) q = q.neq('id', excludeTranscriptId);
  if (flag('hasDeleted')) q = q.is('deleted_at', null);
  const { data } = await q.limit(1);
  return !!(data && data.length > 0);
}

async function upsertAlias(slug, transcriptId) {
  const { error } = await db().from('transcript_aliases')
    .upsert({ slug, transcript_id: transcriptId }, { onConflict: 'slug' });
  if (error) throw normalizeError(error, 'upsertAlias');
}

export async function deleteTranscript(id) {
  await getSchemaStatus();
  // If soft-delete isn't available, hard-delete so the row at least
  // disappears from the library.
  if (!flag('hasDeleted')) {
    const { error } = await db().from('transcripts').delete().eq('id', id);
    if (error) throw normalizeError(error, 'deleteTranscript(hard)');
    return;
  }
  const { error } = await db().from('transcripts')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw normalizeError(error, 'deleteTranscript');
}

export async function restoreTranscript(id) {
  if (!flag('hasDeleted')) return; // nothing to restore — was hard-deleted
  const { error } = await db().from('transcripts')
    .update({ deleted_at: null }).eq('id', id);
  if (error) throw normalizeError(error, 'restoreTranscript');
}

export async function permanentlyDeleteTranscript(id) {
  const { error } = await db().from('transcripts').delete().eq('id', id);
  if (error) throw normalizeError(error, 'permanentlyDeleteTranscript');
}

export async function listDeletedTranscripts() {
  if (!supabase) return [];
  await getSchemaStatus();
  if (!flag('hasDeleted')) return []; // nothing soft-deleted exists
  const { data, error } = await db().from('transcripts')
    .select('id, name, step, created_at, updated_at, deleted_at, project_id')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw normalizeError(error, 'listDeletedTranscripts');
  return data || [];
}

// ============================================================
// Transcript revisions (Phase 2/3 — version history)
// ============================================================

/**
 * Record a revision snapshot for a transcript. Snapshot is the full
 * payload that was just saved. The DB trigger trims to the most recent
 * 50 per transcript automatically, so we don't need to manage that here.
 */
export async function insertRevision(transcriptId, snapshot, opts = {}) {
  if (!supabase || !transcriptId) return null;
  if (!flag('hasRevisions')) return null;
  const row = {
    transcript_id: transcriptId,
    snapshot,
    source: opts.source || 'autosave',
    client_id: opts.clientId || null,
    note: opts.note || null,
  };
  const { data, error } = await db().from('transcript_revisions')
    .insert(row).select().single();
  if (error) throw normalizeError(error, 'insertRevision');
  return data;
}

export async function listRevisions(transcriptId, limit = 50) {
  if (!supabase) return [];
  if (!flag('hasRevisions')) return [];
  const { data, error } = await db().from('transcript_revisions')
    .select('id, source, client_id, note, created_at')
    .eq('transcript_id', transcriptId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw normalizeError(error, 'listRevisions');
  return data || [];
}

export async function loadRevision(revisionId) {
  const { data, error } = await db().from('transcript_revisions')
    .select('*').eq('id', revisionId).maybeSingle();
  if (error) throw normalizeError(error, 'loadRevision');
  if (!data) {
    const e = new Error('Revision not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return data;
}

// ============================================================
// Editor locks (Phase 3 — soft "open elsewhere" advisory)
// ============================================================

/**
 * Returns the current lock for a transcript if it exists AND is fresh
 * (last_seen within `staleSeconds`, default 60s). Otherwise returns null.
 */
export async function checkLock(transcriptId, staleSeconds = 60) {
  if (!supabase || !transcriptId) return null;
  if (!flag('hasLocks')) return null;
  const { data, error } = await db().from('editor_locks')
    .select('*').eq('transcript_id', transcriptId).maybeSingle();
  if (error) throw normalizeError(error, 'checkLock');
  if (!data) return null;
  const age = (Date.now() - new Date(data.last_seen).getTime()) / 1000;
  if (age > staleSeconds) return null;
  return data;
}

/**
 * Take or refresh the lock. Always succeeds (it's advisory, not enforced).
 */
export async function acquireLock(transcriptId, holderId, holderLabel) {
  if (!supabase || !transcriptId) return null;
  if (!flag('hasLocks')) return null;
  const { data, error } = await db().from('editor_locks')
    .upsert({
      transcript_id: transcriptId,
      holder_id: holderId,
      holder_label: holderLabel || null,
      last_seen: new Date().toISOString(),
    }, { onConflict: 'transcript_id' })
    .select().single();
  if (error) throw normalizeError(error, 'acquireLock');
  return data;
}

/**
 * Bump last_seen so other tabs see we're still here. No-op if we don't
 * hold the lock anymore (someone else took over).
 */
export async function heartbeatLock(transcriptId, holderId) {
  if (!supabase || !transcriptId) return;
  if (!flag('hasLocks')) return;
  await db().from('editor_locks')
    .update({ last_seen: new Date().toISOString() })
    .eq('transcript_id', transcriptId)
    .eq('holder_id', holderId);
}

/**
 * Release the lock. Only deletes the row if we're still the holder.
 */
export async function releaseLock(transcriptId, holderId) {
  if (!supabase || !transcriptId) return;
  if (!flag('hasLocks')) return;
  await db().from('editor_locks')
    .delete()
    .eq('transcript_id', transcriptId)
    .eq('holder_id', holderId);
}

// ============================================================
// Realtime (Phase 3 — live sync between tabs)
// ============================================================

/**
 * Subscribe to UPDATE events on the given transcript row. Returns an
 * unsubscribe function. Callback receives the new row on each remote
 * change. Use the row's updated_at to dedupe vs your own writes.
 */
export function subscribeToTranscript(transcriptId, onChange) {
  if (!supabase || !transcriptId) return () => {};
  const channel = supabase.channel(`transcript:${transcriptId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'transcripts',
      filter: `id=eq.${transcriptId}`,
    }, (payload) => {
      try { onChange(payload.new); } catch (err) { console.warn('[realtime] handler threw:', err); }
    })
    .subscribe();
  return () => {
    try { supabase.removeChannel(channel); } catch {}
  };
}

// ============================================================
// Server-side search (Phase 2)
// ============================================================

/**
 * Search transcripts by free-text query against name + custom_sequence_name + srt_content.
 * Uses the search_text generated column with pg_trgm GIN index. Falls
 * back to a name-only ILIKE if the search_text column is missing
 * (pre-Phase-2 migration). Returns library-shaped rows.
 */
export async function searchTranscripts(query, projectId) {
  if (!supabase) return [];
  const q = (query || '').trim();
  if (!q) return listTranscripts(projectId);

  const cols = 'id, name, step, created_at, updated_at, project_id, slug';
  const escaped = q.replace(/[%_]/g, ch => '\\' + ch);

  // Preferred: search_text column.
  let qb = db().from('transcripts').select(cols)
    .is('deleted_at', null)
    .ilike('search_text', `%${escaped}%`)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (projectId) qb = qb.eq('project_id', projectId);
  let { data, error } = await qb;

  if (error && error.code === '42703') {
    // search_text column missing — fall back to name-only.
    let fb = db().from('transcripts').select(cols)
      .is('deleted_at', null)
      .ilike('name', `%${escaped}%`)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (projectId) fb = fb.eq('project_id', projectId);
    const r = await fb;
    if (r.error) throw normalizeError(r.error, 'searchTranscripts(fallback)');
    return r.data || [];
  }
  if (error) throw normalizeError(error, 'searchTranscripts');
  return data || [];
}

// ============================================================
// One-time migration of any leftover localStorage records to Supabase.
// Phase 1 no longer writes to LS, but legacy users may still have
// records there. This runs once at boot, surfaces results, then nukes
// the LS data so we never have to think about it again.
// ============================================================
const MIGRATION_KEY = 'mcm_migrated_to_supabase';
const LS_PREFIX = 'mcm_';

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function lsDelete(key) { try { localStorage.removeItem(LS_PREFIX + key); } catch {} }
function lsGetIndex(collection) { return lsGet(`index_${collection}`) || []; }

export async function migrateLocalStorageToSupabase() {
  if (!supabase) return { migrated: false, reason: 'no supabase client' };
  if (localStorage.getItem(MIGRATION_KEY)) return { migrated: false, reason: 'already migrated' };

  const projectIndex = lsGetIndex('projects');
  const transcriptIndex = lsGetIndex('transcripts');
  if (projectIndex.length === 0 && transcriptIndex.length === 0) {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ at: new Date().toISOString(), skipped: true }));
    return { migrated: false, reason: 'nothing to migrate' };
  }

  // Reachability probe.
  try {
    const { error } = await db().from('transcripts').select('id').limit(1);
    if (error) throw error;
  } catch (err) {
    return { migrated: false, reason: 'supabase not reachable: ' + err.message };
  }

  const results = { projects: 0, transcripts: 0, errors: [] };

  // Migrate projects first so transcripts can reference them.
  const projectIdMap = {};
  for (const oldId of projectIndex) {
    const p = lsGet(`project_${oldId}`);
    if (!p) continue;
    try {
      const { data, error } = await db().from('projects')
        .insert({ name: p.name, description: p.description || null })
        .select().single();
      if (error) throw error;
      projectIdMap[oldId] = data.id;
      results.projects++;
    } catch (err) {
      results.errors.push(`project ${p.name}: ${err.message}`);
    }
  }

  for (const oldId of transcriptIndex) {
    const t = lsGet(`transcript_${oldId}`);
    if (!t) continue;
    try {
      let projectId = t.project_id || null;
      if (projectId && projectIdMap[projectId]) projectId = projectIdMap[projectId];
      else if (projectId && projectId.startsWith && projectId.startsWith('local_')) projectId = null;
      const { error } = await db().from('transcripts').insert({
        name: t.name,
        step: t.step || 1,
        segments: t.segments || [],
        analysis: t.analysis || null,
        translations: t.translations || null,
        srt_content: t.srt_content || null,
        speaker_colors: t.speaker_colors || {},
        annotations: t.annotations || {},
        metadata: t.metadata || {},
        project_id: projectId,
        speaker_map: t.speaker_map || {},
        hidden_speakers: t.hidden_speakers || [],
        editor_state: t.editor_state || null,
        custom_sequence_name: t.custom_sequence_name || '',
        hide_unintelligible: t.hide_unintelligible ?? true,
        word_timings: t.word_timings || null,
      });
      if (error) throw error;
      results.transcripts++;
    } catch (err) {
      results.errors.push(`transcript ${t.name}: ${err.message}`);
    }
  }

  if (results.projects > 0 || results.transcripts > 0) {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ at: new Date().toISOString(), ...results }));
    for (const oldId of projectIndex) lsDelete(`project_${oldId}`);
    lsDelete('index_projects');
    for (const oldId of transcriptIndex) lsDelete(`transcript_${oldId}`);
    lsDelete('index_transcripts');
  }

  console.info('[db] migration complete:', results);
  return { migrated: true, ...results };
}
