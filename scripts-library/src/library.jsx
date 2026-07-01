// The Script Library landing — mirrors the Interpreter's library view, in the
// Cartridges aesthetic (cream paper, mono chrome, FLAT, no shadow). A searchable
// grid of project cards (title · kind · last-edited relative time), a prominent
// "New script" action, inline rename, and a trash view with restore + purge.
//
// LOCAL-FIRST: all state comes from project-store (localStorage). Opening a project
// hands off to boot.jsx via the URL hash (the URL is the source of truth). Purge
// derives the project's storage keys + recovery DB name from configForProject so a
// forever-delete also clears the doc + IndexedDB, not just the index row.

import { render } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import {
  activeProjects,
  trashedProjects,
  createProject,
  renameProject,
  trashProject,
  restoreProject,
  purgeProject,
  findById,
} from './project-store.js';
import { configForProject, storageKeysForConfig, recoveryDbNameForConfig } from './config-for-project.js';
import { relativeTimeFrom, trashDaysLeft } from './library-time.js';

// Open a project by writing the URL hash. boot.jsx's route reconciler mounts the
// engine for that slug (reload-to-hash — the engine is a singleton).
function openSlug(slug) {
  window.location.hash = encodeURIComponent(slug);
}

// Human label for a project's kind — legacy episode or a generic new script.
function kindLabel(row) {
  if (row.episode === 'burma') return 'WP·01 · BURMA';
  if (row.episode === 'palau') return 'WP·02 · PALAU';
  return 'SCRIPT';
}

function LibraryApp() {
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all'); // 'all' | 'trash'
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const active = useMemo(() => activeProjects(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trashed = useMemo(() => trashedProjects(), [tick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = view === 'trash' ? trashed : active;
    if (!q) return rows;
    return rows.filter((r) => String(r.title || '').toLowerCase().includes(q));
  }, [query, view, active, trashed]);

  const onNew = useCallback(() => {
    const row = createProject('Untitled Script');
    openSlug(row.slug);
  }, []);

  const startRename = useCallback((row) => {
    setEditingId(row.id);
    setDraftTitle(row.title || '');
  }, []);

  const commitRename = useCallback(() => {
    if (editingId) renameProject(editingId, draftTitle);
    setEditingId(null);
    setDraftTitle('');
    refresh();
  }, [editingId, draftTitle, refresh]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setDraftTitle('');
  }, []);

  const onTrash = useCallback((row) => { trashProject(row.id); refresh(); }, [refresh]);
  const onRestore = useCallback((row) => { restoreProject(row.id); refresh(); }, [refresh]);

  const onPurge = useCallback((row) => {
    const fresh = findById(row.id) || row;
    const ok = window.confirm(`Delete "${fresh.title}" forever? This clears its saved doc and recovery history.`);
    if (!ok) return;
    let storageKeys = [];
    let dbName = null;
    try {
      const cfg = configForProject(fresh);
      storageKeys = storageKeysForConfig(cfg);
      dbName = recoveryDbNameForConfig(cfg);
    } catch {}
    purgeProject(row.id, { storageKeys, dbName });
    refresh();
  }, [refresh]);

  const isTrash = view === 'trash';

  return (
    <div class="sl-page">
      <div class="sl-frame">
        <span class="sl-screw tl"><i /></span>
        <span class="sl-screw tr"><i /></span>
        <span class="sl-screw bl"><i /></span>
        <span class="sl-screw br"><i /></span>

        <header class="sl-head">
          <div class="sl-id">
            <span class="sl-wordmark">SCRIPTS</span>
            <span class="sl-fig">fig.05 — SCRIPT LIBRARY</span>
          </div>
          <div class="sl-sub">The Human Element · local script projects</div>
        </header>

        <div class="sl-toolbar">
          <div class="sl-tabs">
            <button
              class={`sl-tab${!isTrash ? ' is-active' : ''}`}
              onClick={() => { setView('all'); setQuery(''); }}
            >LIBRARY <span class="sl-count">{active.length}</span></button>
            <button
              class={`sl-tab${isTrash ? ' is-active' : ''}`}
              onClick={() => { setView('trash'); setQuery(''); }}
            >TRASH <span class="sl-count">{trashed.length}</span></button>
          </div>
          <input
            class="sl-search"
            type="search"
            placeholder={isTrash ? 'Search trash…' : 'Search scripts…'}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          {!isTrash && (
            <button class="sl-new" onClick={onNew}>＋ New script</button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div class="sl-empty">
            {isTrash
              ? <><div class="sl-empty-title">Trash is empty.</div><div class="sl-empty-sub">Deleted scripts wait here for 30 days.</div></>
              : query.trim()
                ? <><div class="sl-empty-title">No scripts match “{query.trim()}”.</div><div class="sl-empty-sub">Try a different search.</div></>
                : <><div class="sl-empty-title">No scripts yet.</div><div class="sl-empty-sub">Start one with <button class="sl-inline-new" onClick={onNew}>＋ New script</button>.</div></>}
          </div>
        ) : (
          <div class="sl-grid">
            {filtered.map((row) => (
              <div class="sl-card" key={row.id} data-slug={row.slug}>
                <button
                  class="sl-card-open"
                  disabled={isTrash}
                  onClick={() => !isTrash && openSlug(row.slug)}
                  title={isTrash ? 'Restore to open' : `Open ${row.title}`}
                >
                  <span class="sl-card-kind">{kindLabel(row)}</span>
                  {editingId === row.id ? (
                    <input
                      class="sl-card-rename"
                      value={draftTitle}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setDraftTitle(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <span class="sl-card-title">{row.title}</span>
                  )}
                  <span class="sl-card-time">
                    {isTrash
                      ? (() => { const d = trashDaysLeft(row.trashedAt); return d === null ? 'in trash' : `${d}d left`; })()
                      : `edited ${relativeTimeFrom(row.updatedAt)}`}
                  </span>
                </button>

                <div class="sl-card-actions">
                  {isTrash ? (
                    <>
                      <button class="sl-act" onClick={() => onRestore(row)}>Restore</button>
                      <button class="sl-act sl-act-danger" onClick={() => onPurge(row)}>Delete forever</button>
                    </>
                  ) : (
                    <>
                      <button class="sl-act" onClick={() => startRename(row)}>Rename</button>
                      <button class="sl-act sl-act-danger" onClick={() => onTrash(row)}>Trash</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Mount the library landing into a root element (called by boot.jsx). */
export function mountLibrary(rootEl) {
  render(<LibraryApp />, rootEl);
}

export default LibraryApp;
