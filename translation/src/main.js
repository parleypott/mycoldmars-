import { parseCSV, getStats, cleanSpeakerName, buildSpeakerMap, isGenericSpeaker, getSequenceMetadata } from './csv-parser.js';
import { parseJSON } from './json-parser.js';
import { parseTrintHTML } from './trint-html-parser.js';
import { chattyStart, chattyEnd, SUMMARY_PHRASES } from './chatty-loader.js';
import { formatPreciseTimecode, parseTimecodeToSeconds } from './timecode-utils.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';
import { saveTranscript, updateTranscript, listTranscripts, loadTranscript, loadTranscriptBySlug, isSlugTaken, deleteTranscript, restoreTranscript, permanentlyDeleteTranscript, listDeletedTranscripts, createProject, listProjects, deleteProject, supabaseAvailable, getStorageInfo, migrateLocalStorageToSupabase, isConfigured as isDbConfigured, getInitError as getDbInitError, insertRevision, listRevisions, loadRevision, checkLock, acquireLock, heartbeatLock, releaseLock, subscribeToTranscript, searchTranscripts, getSchemaStatus } from './db.js';
import { saveSnapshot, loadSnapshot, clearSnapshot, isSnapshotNewerThan } from './snapshot.js';
import { mountEditor } from './editor/mount.js';
import { buildEditorDocument, getDismissedSegmentNumbers } from './editor/document-builder.js';
import { mountTagSearch } from './tags/mount.js';
import { mountCopilot } from './copilot/mount.js';
import { buildPremiereXML, buildPremiereSequenceXML, buildSacredSequencerXML } from './export/premiere-xml.js';
import { buildPremiereScript } from './export/premiere-script.js';
import { exportHighlightsPDF } from './export/pdf-export.js';
import { exportSummaryText } from './export/summary-export.js';
import { extractHighlightsFromEditor } from './editor/document-builder.js';
import { buildAutoSummaryPrompt } from './copilot/copilot-prompts.js';
import { initSotHunter, setSotHunterVisible } from './sot-hunter.js';
import { initCommandPalette, openCommandPalette } from './command-palette.js';
import { initFallingGlyphs, startFallingGlyphs, stopFallingGlyphs } from './falling-glyphs.js';

// ── State ──
let segments = [];
let analysis = null;     // { narrative_summary, language_map, themes, questions, generic_segments }
let translations = [];    // [{ number, original, translated, language, kept_original, unintelligible }]
let srtContent = '';
let currentStep = 1;
let currentTranscriptId = null;
let currentTranscriptName = '';
let speakerColors = {};
let annotations = {};
let speakerMap = {};          // { raw CSV name: clean display name }
let hiddenSpeakers = [];      // raw speaker names hidden by default
let showAllSpeakers = false;  // toggle for showing hidden speakers
let hideUnintelligible = true; // hide unintelligible segments from SRT/editor/reader
let customSequenceName = '';   // user-editable sequence name (overrides auto-detected)
let currentProjectId = null;
let projects = [];
let editorState = null;       // Tiptap JSON document
let editorInstance = null;    // mounted editor reference
let editorDirty = false;      // true when editor has unsaved changes not yet synced to translations[]
let currentSummary = null;    // auto-generated chronological summary
let rawSummary = null;        // raw AI output before timecode enrichment
let summaryBullets = [];      // parsed bullet data: [{ id, rawText, enrichedText, segmentStart, segmentEnd }]
let interestVotes = {};       // { segNum: 'interested' | 'not-interested' }
let wordTimingsMap = null;    // JSON word-level timings: { segNum: { start, end } }
let currentSlug = null;       // clean URL slug for permalink
let lastServerUpdatedAt = null; // last updated_at the server confirmed for this transcript (optimistic concurrency)
let libraryCurrentProject = null;  // null = root (show all projects + unsorted)
let librarySortKey = 'updated_at';
let librarySortAsc = false;
const librarySelected = new Set(); // ids of currently-selected transcripts (for bulk ops)
let libraryCache = null;           // { transcripts, projects, deleted, ts }
const LIBRARY_CACHE_TTL = 5000;
const LIBRARY_CACHE_LS_KEY = 'np_library_cache_v3';

// Persist library snapshots to localStorage so a hard refresh shows the
// previous list instantly (stale-while-revalidate). The freshness check
// still runs against ts, just from disk instead of memory.
function loadLibraryCacheFromDisk() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}

function saveLibraryCacheToDisk(cache) {
  try {
    // Cap to 200 transcripts in the snapshot to keep localStorage small.
    const trimmed = {
      ts: cache.ts,
      transcripts: (cache.transcripts || []).slice(0, 200),
      projects: cache.projects || [],
      deleted: (cache.deleted || []).slice(0, 50),
    };
    localStorage.setItem(LIBRARY_CACHE_LS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota errors — cache is a perf nicety, not load-bearing.
  }
}

const SPEAKER_PALETTE = [
  '#DD2C1E', '#004CFF', '#0D5921', '#FFBF00',
  '#520004', '#412C27', '#6B5CE7', '#E85D04'
];

const STEP_LABELS = ['', 'Upload', 'Analyze', 'Clarify', 'Translate', 'Edit'];

// ── DOM refs ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dropZone = $('#drop-zone');
const fileInput = $('#file-input');
const uploadPreview = $('#upload-preview');
const transcriptBody = $('#transcript-table tbody');
const btnAnalyze = $('#btn-analyze');
const btnToClarify = $('#btn-to-clarify');
const btnTranslate = $('#btn-translate');
const btnExport = $('#btn-export');
const btnDownload = $('#btn-download');
const btnCopy = $('#btn-copy');
const btnLibrary = $('#btn-library');
const libraryView = $('#library-view');
const libraryList = $('#library-list');
const libraryEmpty = $('#library-empty');
const stepsNav = $('.steps');
const btnSpeakerToggle = $('#btn-speaker-toggle');
const btnNewProject = $('#btn-new-project');
const transcriptTitleEl = $('#transcript-title');

// ── Step navigation ──
let libraryShowing = false;

function goToStep(n) {
  currentStep = n;
  if (segments.length > 0) debouncedAutoSave();

  // Hide library if showing
  if (libraryShowing) {
    libraryView.classList.remove('active');
    libraryShowing = false;
  }

  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`#step-${n}`).classList.add('active');

  $$('.steps .step').forEach(s => {
    const sn = parseInt(s.dataset.step);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });

  // Home page (Step 1): hide header & steps nav, show home hero
  const header = $('header');
  const homeHero = $('#home-hero');
  if (n === 1) {
    if (header) header.classList.add('hidden');
    stepsNav.classList.add('hidden');
    if (homeHero) homeHero.classList.remove('hidden');
    startFallingGlyphs();
  } else {
    if (header) header.classList.remove('hidden');
    stepsNav.classList.remove('hidden');
    if (homeHero) homeHero.classList.add('hidden');
    stopFallingGlyphs();
  }

  // SOT HUNTER lives on the editor (Step 5) where transcript + editor are live.
  setSotHunterVisible(n === 5 && segments.length > 0);
}

function showLibrary() {
  flushPendingSave();
  stopFallingGlyphs();
  librarySelected.clear();
  libraryShowing = true;
  $$('.panel').forEach(p => p.classList.remove('active'));
  const header = $('header');
  if (header) header.classList.remove('hidden');
  stepsNav.classList.add('hidden');
  libraryView.classList.add('active');
  const homeHero = $('#home-hero');
  if (homeHero) homeHero.classList.add('hidden');
  setSotHunterVisible(false);
  fetchLibrary();
}

// ── Library ──
//
// Phase 1: always revalidate against Supabase when entering the library.
// The disk cache is shown instantly while the fetch is in flight (so the
// list pops up in <100ms), but it is NEVER trusted as the final answer.
// If the fetch fails, we surface a visible error banner — no more silent
// ghost rows that fail when clicked.
async function fetchLibrary() {
  // Stale-while-revalidate: paint the disk cache immediately if we have
  // it, then always re-fetch from Supabase.
  let renderedFromDisk = false;
  const disk = loadLibraryCacheFromDisk();
  if (disk && (disk.transcripts?.length || disk.projects?.length)) {
    projects = disk.projects || [];
    renderLibrary(disk.transcripts, disk.projects, disk.deleted);
    renderedFromDisk = true;
  } else {
    renderLibrarySkeleton();
  }

  let transcripts = [];
  let p = [];
  try {
    [p, transcripts] = await Promise.all([listProjects(), listTranscripts()]);
    projects = p;
    const deletedSoFar = libraryCache?.deleted || disk?.deleted || [];
    libraryCache = { transcripts, projects, deleted: deletedSoFar, ts: Date.now() };
    renderLibrary(transcripts, projects, deletedSoFar);
    saveLibraryCacheToDisk(libraryCache);
    clearLibraryError();
  } catch (err) {
    console.error('Failed to load library:', err);
    showLibraryError(err, renderedFromDisk);
    return;
  }

  // Fetch deleted transcripts in the background — only matters at root.
  try {
    const deleted = await listDeletedTranscripts();
    libraryCache = { ...libraryCache, deleted, ts: Date.now() };
    saveLibraryCacheToDisk(libraryCache);
    if (libraryShowing && !libraryCurrentProject) {
      renderLibrary(transcripts, projects, deleted);
    }
  } catch (err) {
    console.warn('Could not load deleted transcripts:', err);
  }
}

function updateBulkActionBar() {
  let bar = document.getElementById('lib-bulk-bar');
  if (librarySelected.size === 0) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'lib-bulk-bar';
    bar.className = 'lib-bulk-bar';
    libraryView.insertBefore(bar, libraryView.firstChild);
  }
  const count = librarySelected.size;
  const projectOptions = ['<option value="">— Move to —</option>',
    '<option value="__unsorted">Unsorted (no folder)</option>',
    ...projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)].join('');
  bar.innerHTML = `
    <div class="lib-bulk-text">${count} selected</div>
    <select id="lib-bulk-move">${projectOptions}</select>
    <button class="np-button" id="lib-bulk-delete">Delete</button>
    <button class="np-button" id="lib-bulk-clear">Clear</button>
  `;
  document.getElementById('lib-bulk-move').addEventListener('change', async (e) => {
    const target = e.target.value;
    if (!target) return;
    const projectId = target === '__unsorted' ? null : target;
    const ids = Array.from(librarySelected);
    e.target.disabled = true;
    try {
      await Promise.all(ids.map(id => updateTranscript(id, { projectId })));
      librarySelected.clear();
      invalidateLibraryCache();
      await fetchLibrary();
    } catch (err) {
      alert('Move failed: ' + (err.message || String(err)));
    } finally {
      e.target.disabled = false;
    }
  });
  document.getElementById('lib-bulk-delete').addEventListener('click', async () => {
    const ids = Array.from(librarySelected);
    if (!confirm(`Delete ${ids.length} transcript${ids.length === 1 ? '' : 's'}? You can restore from Recently Deleted.`)) return;
    try {
      await Promise.all(ids.map(id => deleteTranscript(id)));
      librarySelected.clear();
      invalidateLibraryCache();
      await fetchLibrary();
    } catch (err) {
      alert('Delete failed: ' + (err.message || String(err)));
    }
  });
  document.getElementById('lib-bulk-clear').addEventListener('click', () => {
    librarySelected.clear();
    libraryList.querySelectorAll('.lib-row-check').forEach(b => { b.checked = false; });
    libraryList.querySelectorAll('.lib-row--checked').forEach(r => r.classList.remove('lib-row--checked'));
    updateBulkActionBar();
  });
}

function showLibraryError(err, hasStaleData) {
  let banner = document.getElementById('library-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'library-error-banner';
    banner.className = 'library-error-banner';
    libraryView.insertBefore(banner, libraryView.firstChild);
  }
  const detail = err?.message || String(err);
  const stalenote = hasStaleData
    ? 'Showing your last cached list — some items may be out of date or no longer exist.'
    : 'Could not load your library.';
  banner.innerHTML = `
    <div class="library-error-banner-text">
      <strong>Library refresh failed.</strong> ${escapeHtmlSafe(stalenote)}
      <div class="library-error-banner-detail">${escapeHtmlSafe(detail)}</div>
    </div>
    <button class="np-button" id="library-error-retry">Retry</button>
  `;
  document.getElementById('library-error-retry').addEventListener('click', () => fetchLibrary());
}

function clearLibraryError() {
  const banner = document.getElementById('library-error-banner');
  if (banner) banner.remove();
}

function renderLibrarySkeleton() {
  libraryEmpty.classList.add('hidden');
  const placeholder = `
    <div class="lib-row lib-row--skeleton"><div class="lib-col lib-col--name"><span class="lib-skeleton-pill" style="width:62%"></span></div><div class="lib-col lib-col--step"><span class="lib-skeleton-pill" style="width:60%"></span></div><div class="lib-col lib-col--date"><span class="lib-skeleton-pill" style="width:70%"></span></div></div>
  `;
  libraryList.innerHTML = placeholder.repeat(6);
}

function invalidateLibraryCache() {
  libraryCache = null;
  try { localStorage.removeItem(LIBRARY_CACHE_LS_KEY); } catch {}
}

function renderLibrary(transcripts, projectsList, deletedTranscripts) {
  if ((!transcripts || transcripts.length === 0) && (!projectsList || projectsList.length === 0) && (!deletedTranscripts || deletedTranscripts.length === 0)) {
    libraryList.innerHTML = '';
    libraryEmpty.classList.remove('hidden');
    return;
  }

  libraryEmpty.classList.add('hidden');
  renderBreadcrumb();

  const rows = [];

  if (!libraryCurrentProject) {
    // ROOT VIEW: folders first, then unsorted transcripts
    for (const proj of (projectsList || [])) {
      const count = (transcripts || []).filter(t => t.project_id === proj.id).length;
      rows.push(renderFolderRow(proj, count));
    }
    // Unsorted transcripts (no project)
    const unsorted = (transcripts || []).filter(t => !t.project_id);
    for (const t of sortTranscripts(unsorted)) {
      rows.push(renderFileRow(t));
    }
  } else {
    // PROJECT VIEW: transcripts in this project only
    const items = (transcripts || []).filter(t => t.project_id === libraryCurrentProject);
    for (const t of sortTranscripts(items)) {
      rows.push(renderFileRow(t));
    }
  }

  // Recently Deleted section (only at root)
  if (!libraryCurrentProject) {
    const deleted = (deletedTranscripts || []).filter(t => {
      const deletedAt = new Date(t.deleted_at).getTime();
      return Date.now() - deletedAt < 30 * 24 * 60 * 60 * 1000;
    });
    if (deleted.length > 0) {
      rows.push(`<div class="lib-deleted-section">
        <button class="lib-deleted-toggle" id="deleted-toggle">
          <span class="np-eyebrow">Recently Deleted</span>
          <span class="lib-deleted-count">${deleted.length}</span>
        </button>
        <div class="lib-deleted-list hidden" id="deleted-list">
          ${deleted.map(t => {
            const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / (24 * 60 * 60 * 1000)));
            return `<div class="lib-row lib-row--deleted" data-id="${t.id}">
              <div class="lib-col lib-col--name">
                <span class="lib-icon">&#128220;</span>
                <span class="lib-name lib-name--deleted">${esc(t.name)}</span>
                <span class="lib-deleted-days">${daysLeft}d left</span>
              </div>
              <div class="lib-col lib-col--step"></div>
              <div class="lib-col lib-col--date"></div>
              <div class="lib-col lib-col--actions">
                <button class="lib-restore-btn" data-id="${t.id}">Restore</button>
                <button class="lib-row-delete" data-id="${t.id}">&times;</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`);
    }
  }

  libraryList.innerHTML = rows.join('');
  wireLibraryEvents();
  wireLibraryDragAndDrop();
}

function renderFolderRow(proj, count) {
  return `
    <div class="lib-row lib-row--folder" data-project-id="${proj.id}" data-droppable="true">
      <div class="lib-col lib-col--name">
        <span class="lib-icon">&#128193;</span>
        <span class="lib-name">${esc(proj.name)}</span>
        <span class="lib-count">${count}</span>
      </div>
      <div class="lib-col lib-col--step"></div>
      <div class="lib-col lib-col--date">${relativeTime(proj.created_at)}</div>
      <div class="lib-col lib-col--actions">
        <button class="lib-row-delete" data-project-id="${proj.id}">&times;</button>
      </div>
    </div>`;
}

function renderFileRow(t) {
  const isActive = t.id === currentTranscriptId;
  const stepLabel = STEP_LABELS[t.step] || 'Upload';
  const isChecked = librarySelected.has(t.id);
  return `
    <div class="lib-row lib-row--file ${isActive ? 'lib-row--active' : ''} ${isChecked ? 'lib-row--checked' : ''}"
         data-id="${t.id}" data-project-id="${t.project_id || ''}" draggable="true">
      <div class="lib-col lib-col--name">
        <input type="checkbox" class="lib-row-check" data-id="${t.id}" ${isChecked ? 'checked' : ''} aria-label="Select">
        <span class="lib-icon">&#128220;</span>
        <span class="lib-name" data-id="${t.id}">${esc(t.name)}</span>
      </div>
      <div class="lib-col lib-col--step">${stepLabel}</div>
      <div class="lib-col lib-col--date">${relativeTime(t.updated_at)}</div>
      <div class="lib-col lib-col--actions">
        <button class="lib-row-delete" data-id="${t.id}">&times;</button>
      </div>
    </div>`;
}

function renderBreadcrumb() {
  const crumbEl = document.querySelector('.lib-breadcrumb');
  if (!crumbEl) return;
  let html = `<button class="lib-crumb lib-crumb--root" data-id="">My Library</button>`;
  if (libraryCurrentProject) {
    const proj = projects.find(p => p.id === libraryCurrentProject);
    if (proj) {
      html += ` <span class="lib-crumb-sep">&rsaquo;</span> `;
      html += `<span class="lib-crumb--current">${esc(proj.name)}</span>`;
    }
  }
  crumbEl.innerHTML = html;
  crumbEl.querySelector('.lib-crumb--root')?.addEventListener('click', () => {
    libraryCurrentProject = null;
    fetchLibrary(true);
  });
}

function sortTranscripts(items) {
  return [...items].sort((a, b) => {
    let va = a[librarySortKey], vb = b[librarySortKey];
    if (librarySortKey === 'name') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
    if (va < vb) return librarySortAsc ? -1 : 1;
    if (va > vb) return librarySortAsc ? 1 : -1;
    return 0;
  });
}

function wireLibraryEvents() {
  // Click file rows to load
  libraryList.querySelectorAll('.lib-row--file').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't load if clicking delete, checkbox, or name (for inline rename)
      if (e.target.closest('.lib-row-delete') || e.target.closest('.lib-name') || e.target.closest('.lib-row-check')) return;
      handleLoad(row.dataset.id);
    });
  });

  // Bulk-select checkboxes.
  libraryList.querySelectorAll('.lib-row-check').forEach(box => {
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) librarySelected.add(id);
      else librarySelected.delete(id);
      updateBulkActionBar();
      // Just toggle the row class without re-rendering everything.
      const row = e.target.closest('.lib-row--file');
      if (row) row.classList.toggle('lib-row--checked', e.target.checked);
    });
  });
  updateBulkActionBar();

  // Click file name to load (single click)
  libraryList.querySelectorAll('.lib-row--file .lib-name').forEach(el => {
    el.addEventListener('click', () => handleLoad(el.dataset.id));
  });

  // Double-click name for inline rename
  libraryList.querySelectorAll('.lib-row--file .lib-name').forEach(el => {
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(el);
    });
  });

  // Click folder rows to enter
  libraryList.querySelectorAll('.lib-row--folder').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.lib-row-delete')) return;
      libraryCurrentProject = row.dataset.projectId;
      fetchLibrary(true);
    });
  });

  // Delete buttons — files
  libraryList.querySelectorAll('.lib-row--file .lib-row-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDelete(btn.closest('.lib-row').dataset.id);
    });
  });

  // Delete buttons — folders
  libraryList.querySelectorAll('.lib-row--folder .lib-row-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteProject(btn.dataset.projectId);
      invalidateLibraryCache();
      fetchLibrary(true);
    });
  });

  // Sortable column headers
  document.querySelectorAll('.lib-table-header .lib-col[data-sort]').forEach(col => {
    col.addEventListener('click', () => {
      const key = col.dataset.sort;
      if (librarySortKey === key) {
        librarySortAsc = !librarySortAsc;
      } else {
        librarySortKey = key;
        librarySortAsc = key === 'name'; // name ascending by default, dates descending
      }
      // Update sort indicator
      document.querySelectorAll('.lib-table-header .lib-col').forEach(c => c.classList.remove('lib-col--sorted-asc', 'lib-col--sorted-desc'));
      col.classList.add(librarySortAsc ? 'lib-col--sorted-asc' : 'lib-col--sorted-desc');
      fetchLibrary(); // re-render with cache
    });
  });

  // Search filter — first does a fast client-side name filter for
  // instant feedback, then debounces a server-side full-text search
  // (matches transcript names + sequence names + SRT/translation text)
  // and replaces the result list with the matches.
  const searchInput = $('#library-search');
  if (searchInput) {
    let serverSearchTimer = null;
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      // Instant client-side: hide rows whose name doesn't match.
      const ql = q.toLowerCase();
      libraryList.querySelectorAll('.lib-row').forEach(row => {
        const name = row.querySelector('.lib-name')?.textContent?.toLowerCase() || '';
        row.style.display = (!q || name.includes(ql)) ? '' : 'none';
      });
      // Debounced server-side search.
      clearTimeout(serverSearchTimer);
      if (!q) return; // empty query → revert to full list (handled by next fetchLibrary)
      serverSearchTimer = setTimeout(async () => {
        try {
          const matches = await searchTranscripts(q, libraryCurrentProject || undefined);
          // Render only matches, preserving folder section so user keeps context.
          libraryList.innerHTML = '';
          for (const t of matches) libraryList.insertAdjacentHTML('beforeend', renderFileRow(t));
          wireLibraryEvents();
        } catch (err) {
          console.warn('Search failed, keeping client-side filter:', err.message);
        }
      }, 250);
    });
  }

  // Recently Deleted toggle
  const deletedToggle = document.getElementById('deleted-toggle');
  const deletedListEl = document.getElementById('deleted-list');
  if (deletedToggle && deletedListEl) {
    deletedToggle.addEventListener('click', () => deletedListEl.classList.toggle('hidden'));
  }

  // Restore buttons
  libraryList.querySelectorAll('.lib-restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await restoreTranscript(btn.dataset.id);
      invalidateLibraryCache();
      fetchLibrary(true);
    });
  });

  // Permanent delete buttons (in deleted section)
  libraryList.querySelectorAll('.lib-row--deleted .lib-row-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await permanentlyDeleteTranscript(btn.dataset.id);
      invalidateLibraryCache();
      fetchLibrary(true);
    });
  });
}

function startInlineRename(el) {
  const id = el.dataset.id;
  const oldName = el.textContent;
  let done = false;
  el.contentEditable = true;
  el.classList.add('lib-name--editing');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function commit() {
    if (done) return;
    done = true;
    el.contentEditable = false;
    el.classList.remove('lib-name--editing');
    const newName = el.textContent.trim();
    if (newName && newName !== oldName) {
      updateTranscript(id, { name: newName });
      if (id === currentTranscriptId) {
        currentTranscriptName = newName;
        updateTranscriptTitle();
      }
      invalidateLibraryCache();
    } else {
      el.textContent = oldName;
    }
  }

  function cancel() {
    if (done) return;
    done = true;
    el.textContent = oldName;
    el.contentEditable = false;
    el.classList.remove('lib-name--editing');
  }

  el.addEventListener('keydown', function handler(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); el.removeEventListener('keydown', handler); }
    if (e.key === 'Escape') { cancel(); el.removeEventListener('keydown', handler); }
  });
  el.addEventListener('blur', commit, { once: true });
}

function wireLibraryDragAndDrop() {
  let dragId = null;

  libraryList.querySelectorAll('.lib-row--file[draggable]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      dragId = row.dataset.id;
      row.classList.add('lib-row--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('lib-row--dragging');
      libraryList.querySelectorAll('.lib-row--drop-target').forEach(r => r.classList.remove('lib-row--drop-target'));
      dragId = null;
    });
  });

  // Drop targets: folder rows
  libraryList.querySelectorAll('.lib-row--folder[data-droppable]').forEach(folder => {
    folder.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      folder.classList.add('lib-row--drop-target');
    });
    folder.addEventListener('dragleave', () => {
      folder.classList.remove('lib-row--drop-target');
    });
    folder.addEventListener('drop', async (e) => {
      e.preventDefault();
      folder.classList.remove('lib-row--drop-target');
      const fileId = e.dataTransfer.getData('text/plain');
      if (!fileId) return;
      const projectId = folder.dataset.projectId;
      await updateTranscript(fileId, { projectId });
      invalidateLibraryCache();
      fetchLibrary(true);
    });
  });

  // Drop on breadcrumb root to un-assign from project
  const rootCrumb = document.querySelector('.lib-crumb--root');
  if (rootCrumb) {
    rootCrumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      rootCrumb.classList.add('lib-crumb--drop-target');
    });
    rootCrumb.addEventListener('dragleave', () => {
      rootCrumb.classList.remove('lib-crumb--drop-target');
    });
    rootCrumb.addEventListener('drop', async (e) => {
      e.preventDefault();
      rootCrumb.classList.remove('lib-crumb--drop-target');
      const fileId = e.dataTransfer.getData('text/plain');
      if (!fileId) return;
      await updateTranscript(fileId, { projectId: null });
      invalidateLibraryCache();
      fetchLibrary(true);
    });
  }
}

function relativeTime(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Transcript title in header ──
function updateTranscriptTitle() {
  if (!transcriptTitleEl) return;
  transcriptTitleEl.textContent = currentTranscriptName || '';
  transcriptTitleEl.title = currentTranscriptName ? 'Double-click to rename' : '';
}

if (transcriptTitleEl) {
  transcriptTitleEl.addEventListener('dblclick', () => {
    if (!currentTranscriptId) return;
    let done = false;
    transcriptTitleEl.contentEditable = true;
    transcriptTitleEl.classList.add('transcript-title--editing');
    transcriptTitleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(transcriptTitleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    function commitTitle() {
      if (done) return;
      done = true;
      transcriptTitleEl.contentEditable = false;
      transcriptTitleEl.classList.remove('transcript-title--editing');
      const newName = transcriptTitleEl.textContent.trim();
      if (newName && newName !== currentTranscriptName) {
        currentTranscriptName = newName;
        updateTranscript(currentTranscriptId, { name: newName });
        invalidateLibraryCache();
      } else {
        transcriptTitleEl.textContent = currentTranscriptName;
      }
    }

    transcriptTitleEl.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') { e.preventDefault(); commitTitle(); transcriptTitleEl.removeEventListener('keydown', handler); }
      if (e.key === 'Escape') { done = true; transcriptTitleEl.textContent = currentTranscriptName; transcriptTitleEl.contentEditable = false; transcriptTitleEl.classList.remove('transcript-title--editing'); transcriptTitleEl.removeEventListener('keydown', handler); }
    });
    transcriptTitleEl.addEventListener('blur', commitTitle, { once: true });
  });
}

// Apply a server transcript row to our global state vars. Used by both
// the regular load path and the snapshot-restore path.
function applyTranscriptToState(t) {
  segments = t.segments || [];
  analysis = t.analysis || null;
  translations = t.translations || [];
  srtContent = t.srt_content || '';
  speakerColors = t.speaker_colors || {};
  annotations = t.annotations || {};
  speakerMap = t.speaker_map || {};
  hiddenSpeakers = t.hidden_speakers || [];
  hideUnintelligible = t.hide_unintelligible ?? true;
  customSequenceName = t.custom_sequence_name || '';
  currentProjectId = t.project_id || null;
  editorState = t.editor_state || null;
  wordTimingsMap = t.wordTimings || t.word_timings || null;
  currentTranscriptId = t.id;
  currentTranscriptName = t.name;
  currentSlug = t.slug || null;
}

// Overlay a snapshot's gatherState()-shape payload onto our state vars.
// Run this AFTER applyTranscriptToState(serverRow) so that id/slug/etc.
// stay correct but the local content (which is newer) wins.
function applySnapshotPayload(payload) {
  if (!payload) return;
  if (payload.segments !== undefined) segments = payload.segments;
  if (payload.analysis !== undefined) analysis = payload.analysis;
  if (payload.translations !== undefined) translations = payload.translations;
  if (payload.srtContent !== undefined) srtContent = payload.srtContent;
  if (payload.speakerColors !== undefined) speakerColors = payload.speakerColors;
  if (payload.annotations !== undefined) annotations = payload.annotations;
  if (payload.speakerMap !== undefined) speakerMap = payload.speakerMap;
  if (payload.hiddenSpeakers !== undefined) hiddenSpeakers = payload.hiddenSpeakers;
  if (payload.hideUnintelligible !== undefined) hideUnintelligible = payload.hideUnintelligible;
  if (payload.customSequenceName !== undefined) customSequenceName = payload.customSequenceName;
  if (payload.editorState !== undefined) editorState = payload.editorState;
  if (payload.wordTimings !== undefined) wordTimingsMap = payload.wordTimings;
  if (payload.metadata) {
    if (payload.metadata.summary !== undefined) currentSummary = payload.metadata.summary ? enrichSummaryWithTimecodes(payload.metadata.summary) : null;
    if (payload.metadata.rawSummary !== undefined) rawSummary = payload.metadata.rawSummary;
    if (payload.metadata.summaryBullets !== undefined) summaryBullets = payload.metadata.summaryBullets;
    if (payload.metadata.interestVotes !== undefined) interestVotes = payload.metadata.interestVotes;
    if (payload.metadata.workshop !== undefined) workshopState = payload.metadata.workshop;
  }
}

// Modal: ask the user whether to restore a local snapshot that's newer
// than the server's copy. Resolves true if they want to restore.
function promptSnapshotRestore(serverRow, snap) {
  return new Promise((resolve) => {
    const existing = document.getElementById('snapshot-restore-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'snapshot-restore-modal';
    modal.className = 'np-modal';
    const serverWhen = serverRow.updated_at ? new Date(serverRow.updated_at).toLocaleString() : 'unknown';
    const snapWhen = snap.savedAt ? new Date(snap.savedAt).toLocaleString() : 'unknown';
    modal.innerHTML = `
      <div class="np-modal-backdrop"></div>
      <div class="np-modal-card" style="max-width: 540px;">
        <div class="np-modal-header">
          <h3 class="np-modal-title">Newer local copy found</h3>
        </div>
        <p style="font-family: var(--np-font-mono); font-size: 13px; line-height: 1.5; margin-bottom: 14px;">Your browser has a newer snapshot of <b>${escapeHtmlSafe(serverRow.name)}</b> than the cloud. This usually means a previous save didn't reach the server.</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 22px; font-family: var(--np-font-mono); font-size: 12px;">
          <div><div style="font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--np-sepia); margin-bottom: 4px;">Cloud</div><div>${escapeHtmlSafe(serverWhen)}</div></div>
          <div><div style="font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--np-sepia); margin-bottom: 4px;">Local snapshot</div><div>${escapeHtmlSafe(snapWhen)}</div></div>
        </div>
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="np-button" id="snap-discard">Use cloud version</button>
          <button class="np-button np-button--primary" id="snap-restore">Restore local</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('snap-discard').addEventListener('click', () => { modal.remove(); resolve(false); });
    document.getElementById('snap-restore').addEventListener('click', () => { modal.remove(); resolve(true); });
  });
}

async function handleLoad(id) {
  try {
    const t = await loadTranscript(id);

    // Snapshot recovery: if we have a newer local snapshot than what the
    // server returned, ask the user whether to restore it. Common scenario:
    // the previous save attempt failed (network blip, tab closed mid-save),
    // and the server holds an older copy than what's in this browser.
    const snap = loadSnapshot(t.id);
    if (snap && isSnapshotNewerThan(snap, t.updated_at)) {
      const restore = await promptSnapshotRestore(t, snap);
      if (restore) {
        applyTranscriptToState(t);
        applySnapshotPayload(snap.payload);
        lastServerUpdatedAt = t.updated_at; // server still on the older version
        rememberLastTranscript(t.id);
        finishLoadRender(t, /*step override*/ undefined);
        teardownEditingSession();
        ensureRealtimeSubscription();
        maybeAcquireLock();
        markDirty();
        debouncedAutoSave();
        return;
      }
      clearSnapshot(t.id);
    }

    applyTranscriptToState(t);
    lastServerUpdatedAt = t.updated_at;
    rememberLastTranscript(t.id);
    finishLoadRender(t);
    // Phase 3: subscribe to remote updates and try to acquire the editor lock.
    teardownEditingSession();
    ensureRealtimeSubscription();
    maybeAcquireLock();
  } catch (err) {
    console.error('Failed to load transcript:', err);
    showError('Failed to load transcript: ' + err.message);
  }
}

// Common post-load rendering: title, editor mount reset, metadata, step nav.
// Used by both the regular load path and snapshot-restore path.
function finishLoadRender(t) {
  updateTranscriptTitle();
  syncEditorColors();
  const editorMount = $('#editor-mount');
  if (editorMount) editorMount.innerHTML = '';
  editorInstance = null;

  const meta = t.metadata || {};
  if (meta.editorialFocus) {
    const ef = $('#editorial-focus');
    if (ef) ef.value = meta.editorialFocus;
  }
  // Snapshot-restore path may have already populated these from the snapshot;
  // only fall back to server metadata if they're empty.
  if (currentSummary == null && meta.summary) currentSummary = enrichSummaryWithTimecodes(meta.summary);
  if (rawSummary == null && meta.rawSummary) rawSummary = meta.rawSummary;
  if ((!summaryBullets || summaryBullets.length === 0) && meta.summaryBullets) summaryBullets = meta.summaryBullets;
  if (Object.keys(interestVotes || {}).length === 0 && meta.interestVotes) interestVotes = meta.interestVotes;
  if (workshopState == null && meta.workshop) workshopState = meta.workshop;
  unmountWorkshop();

  if (summaryBullets.length === 0 && rawSummary) {
    summaryBullets = parseSummaryBullets(rawSummary);
    attachEnrichedTextToBullets();
  } else if (summaryBullets.length === 0 && currentSummary) {
    summaryBullets = parseSummaryBulletsFromEnriched(currentSummary);
  }

  const step = t.step || 1;

  if (segments.length > 0) renderTranscript();
  if (analysis) {
    renderAnalysis();
    renderClarifyStep();
    if (meta.clarifications && analysis.questions) {
      const answers = meta.clarifications;
      $$('#questions-list .question-card').forEach(card => {
        const qid = card.dataset.qid;
        const match = answers.find(a => a.id === qid);
        if (match) {
          const ta = card.querySelector('textarea');
          if (ta) ta.value = match.answer;
        }
      });
    }
  }
  if (translations.length > 0) renderTranslations();
  if (srtContent) $('#srt-preview').textContent = srtContent;

  goToStep(step);
  if (step === 5) switchView('editor');
}

async function handleDelete(id) {
  try {
    await deleteTranscript(id);
    if (currentTranscriptId === id) {
      currentTranscriptId = null;
      currentTranscriptName = '';
    }
    fetchLibrary();
  } catch (err) {
    console.error('Failed to delete:', err);
  }
}

// ── Save (auto-save only, no manual save button) ──

function gatherState(name) {
  const editorialFocus = $('#editorial-focus')?.value?.trim() || '';
  const clarifications = gatherClarifications();

  return {
    name: name || currentTranscriptName,
    step: currentStep,
    segments,
    analysis,
    translations,
    srtContent,
    speakerColors,
    annotations,
    speakerMap,
    hiddenSpeakers,
    hideUnintelligible,
    customSequenceName,
    projectId: currentProjectId,
    editorState,
    wordTimings: wordTimingsMap,
    metadata: {
      editorialFocus,
      clarifications,
      summary: currentSummary,
      rawSummary,
      summaryBullets,
      interestVotes,
      workshop: workshopState,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Save state machine + queue (Phase 1)
//
// One transcript, one save in flight at a time. If a new save request
// arrives while one is already going, it replaces the queued payload — so
// the next save is always the latest state, never a stale one.
//
// Updates use optimistic concurrency: we track lastServerUpdatedAt and
// pass it to updateTranscript. If the server's row was changed elsewhere
// (other tab, another device), the save returns CONFLICT and we surface
// a modal instead of clobbering.
//
// On every successful save, we mirror the payload to localStorage via
// snapshot.js so we always have a recovery copy if the cloud loses one.
//
// States: clean → dirty → saving → saved | conflict | error
// ──────────────────────────────────────────────────────────────────────────

const saveStatusEl = document.getElementById('save-status');
let saveStatusTimer = null;
let savedAgoTicker = null;
let lastSavedAt = null;    // Date.now() of the last successful save
let lastSaveError = null;
let saveState = 'clean';   // clean | dirty | saving | saved | conflict | error
let saveInFlight = false;  // is a save request currently awaiting response
let pendingSave = false;   // is a debounce timer queued
let nextSavePending = false; // is another save needed after the in-flight one finishes
let debouncedAutoSaveTimer = null;
const AUTOSAVE_DEBOUNCE_MS = 3000;
const CLIENT_ID = (() => {
  try {
    let id = localStorage.getItem('mcm_client_id');
    if (!id) {
      id = 'tab_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
      localStorage.setItem('mcm_client_id', id);
    }
    return id;
  } catch { return 'tab_' + Math.random().toString(36).slice(2); }
})();
const CLIENT_LABEL = (() => {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  let os = 'Mac';
  if (/Win/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua) && !/Android/.test(ua)) os = 'Linux';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  return `${browser} on ${os}`;
})();

function relativeAgo(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function refreshSavedLabel() {
  if (saveState !== 'saved' || !saveStatusEl || lastSavedAt == null) return;
  const elapsed = Date.now() - lastSavedAt;
  saveStatusEl.innerHTML = `<span class="save-dot"></span>Saved ${relativeAgo(elapsed)}`;
}

function setSaveState(state, detail) {
  saveState = state;
  if (!saveStatusEl) return;
  clearTimeout(saveStatusTimer);
  if (savedAgoTicker) { clearInterval(savedAgoTicker); savedAgoTicker = null; }
  saveStatusEl.classList.remove('save-status--error', 'save-status--fade', 'save-status--saving', 'save-status--saved', 'save-status--conflict', 'save-status--dirty');
  saveStatusEl.style.cursor = '';
  saveStatusEl.title = '';

  if (state === 'clean') {
    saveStatusEl.innerHTML = '';
  } else if (state === 'dirty') {
    saveStatusEl.classList.add('save-status--dirty');
    saveStatusEl.innerHTML = '<span class="save-dot"></span>Unsaved';
    saveStatusEl.title = 'Press ⌘S to save now';
  } else if (state === 'saving') {
    saveStatusEl.classList.add('save-status--saving');
    saveStatusEl.innerHTML = '<span class="save-dot"></span>Saving…';
  } else if (state === 'saved') {
    saveStatusEl.classList.add('save-status--saved');
    lastSavedAt = Date.now();
    refreshSavedLabel();
    // Re-render the relative time every 15 seconds so "Saved 2 min ago" stays current.
    savedAgoTicker = setInterval(refreshSavedLabel, 15000);
  } else if (state === 'conflict') {
    saveStatusEl.classList.add('save-status--error');
    saveStatusEl.innerHTML = '<span class="save-dot"></span>Conflict · click to resolve';
    saveStatusEl.style.cursor = 'pointer';
    saveStatusEl.title = 'This transcript was modified elsewhere — click to resolve';
  } else if (state === 'error') {
    lastSaveError = detail?.message || String(detail) || 'Unknown error';
    saveStatusEl.classList.add('save-status--error');
    saveStatusEl.innerHTML = '<span class="save-dot"></span>Save failed · click for details';
    saveStatusEl.style.cursor = 'pointer';
    saveStatusEl.title = 'Click to see the error and retry';
  }
}

function markDirty() {
  if (saveState !== 'saving' && saveState !== 'conflict' && saveState !== 'error') {
    setSaveState('dirty');
  }
}

// Public entry points used throughout the app.
function debouncedAutoSave() {
  if (!currentTranscriptId && segments.length === 0) return; // nothing to save
  clearTimeout(debouncedAutoSaveTimer);
  pendingSave = true;
  markDirty();
  debouncedAutoSaveTimer = setTimeout(() => {
    pendingSave = false;
    debouncedAutoSaveTimer = null;
    runSaveOnce();
  }, AUTOSAVE_DEBOUNCE_MS);
}

// Force any pending/queued save to fire immediately. Returns the save
// promise so callers can await before navigating away.
async function flushPendingSave() {
  clearTimeout(debouncedAutoSaveTimer);
  debouncedAutoSaveTimer = null;
  pendingSave = false;
  return runSaveOnce({ awaitInFlight: true });
}

// Manual save (Cmd-S / Ctrl-S). Same as flush, but tagged so revisions
// know it was an explicit user action (useful in the history UI).
async function manualSave() {
  clearTimeout(debouncedAutoSaveTimer);
  debouncedAutoSaveTimer = null;
  pendingSave = false;
  return runSaveOnce({ source: 'manual', awaitInFlight: true });
}

async function runSaveOnce(opts = {}) {
  if (viewOnly) return; // editor is locked elsewhere; we're not allowed to write
  // If something is already in flight, just mark that another save is
  // needed when it finishes. Latest state wins.
  if (saveInFlight) {
    nextSavePending = true;
    if (opts.awaitInFlight) {
      // Wait until the chain settles.
      while (saveInFlight || nextSavePending) {
        await new Promise(r => setTimeout(r, 30));
      }
    }
    return;
  }
  saveInFlight = true;
  setSaveState('saving');
  try {
    const payload = gatherState();
    payload.metadata = { ...payload.metadata, segmentCount: segments.length };

    let savedRow;
    if (currentTranscriptId) {
      savedRow = await updateTranscript(currentTranscriptId, payload, { expectedUpdatedAt: lastServerUpdatedAt });
      lastServerUpdatedAt = savedRow.updated_at;
      saveSnapshot(currentTranscriptId, payload, savedRow.updated_at);
    } else {
      const name = currentTranscriptName || generateAutoName();
      payload.name = name;
      const baseSlug = generateSlug(name);
      payload.slug = await ensureUniqueSlug(baseSlug);
      savedRow = await saveTranscript(payload);
      currentTranscriptId = savedRow.id;
      currentTranscriptName = name;
      currentSlug = savedRow.slug || payload.slug;
      lastServerUpdatedAt = savedRow.updated_at;
      rememberLastTranscript(savedRow.id);
      setPermalinkHash(currentSlug);
      updateTranscriptTitle();
      saveSnapshot(currentTranscriptId, payload, savedRow.updated_at);
      // Subscribe to remote updates as soon as we have an id.
      ensureRealtimeSubscription();
    }
    // Cheap insurance: write a revision row. Trigger trims to last 50 per transcript.
    insertRevision(currentTranscriptId, payload, { source: opts.source || 'autosave', clientId: CLIENT_ID })
      .catch(err => console.warn('Could not write revision:', err.message));
    setSaveState('saved');
    invalidateLibraryCache();
  } catch (err) {
    console.error('Save failed:', err);
    if (err && err.code === 'CONFLICT') {
      setSaveState('conflict', err);
    } else {
      setSaveState('error', err);
    }
  } finally {
    saveInFlight = false;
    if (nextSavePending) {
      nextSavePending = false;
      // Tail-call the next save — but only if we're not in an error state
      // (don't auto-retry into the same failure).
      if (saveState !== 'error' && saveState !== 'conflict') {
        runSaveOnce();
      }
    }
  }
}

// Click handler on the save status pill — opens conflict or error UI.
if (saveStatusEl) {
  saveStatusEl.addEventListener('click', () => {
    if (saveState === 'conflict') openConflictModal();
    else if (saveState === 'error') openSaveErrorModal();
  });
}

function openSaveErrorModal() {
  const errMsg = lastSaveError || '(no error message captured)';
  let modal = document.getElementById('save-error-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'save-error-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close-save-err></div>
    <div class="np-modal-card" style="max-width: 560px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title" style="color: var(--np-red);">Save Failed</h3>
        <button class="np-modal-close" data-close-save-err aria-label="Close">×</button>
      </div>
      <p style="font-family: var(--np-font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--np-sepia); margin-bottom: 6px;">Error</p>
      <pre style="background: rgba(221,44,30,0.06); border: 1px solid rgba(221,44,30,0.3); border-radius: 2px; padding: 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: var(--np-red); margin-bottom: 20px;">${escapeHtmlSafe(errMsg)}</pre>

      <p style="font-family: var(--np-font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--np-sepia); margin-bottom: 6px;">Recovery</p>
      <p style="font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia); margin-bottom: 20px; line-height: 1.5;">A local snapshot of your last successful save is kept in your browser. If retry fails, your work isn't lost.</p>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="np-button" data-close-save-err>Close</button>
        <button class="np-button np-button--primary" id="save-retry-btn">Retry save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-save-err]').forEach(el => {
    el.addEventListener('click', () => modal.remove());
  });
  document.getElementById('save-retry-btn').addEventListener('click', () => {
    modal.remove();
    runSaveOnce();
  });
}

function openConflictModal() {
  let modal = document.getElementById('save-conflict-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'save-conflict-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close-conflict></div>
    <div class="np-modal-card" style="max-width: 560px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title" style="color: var(--np-red);">Save Conflict</h3>
        <button class="np-modal-close" data-close-conflict aria-label="Close">×</button>
      </div>
      <p style="font-family: var(--np-font-mono); font-size: 13px; line-height: 1.5; margin-bottom: 18px;">This transcript was modified somewhere else (another tab, another device, or a teammate). Your unsaved changes are still here in this tab.</p>
      <p style="font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia); margin-bottom: 20px; line-height: 1.5;"><b>Keep mine</b> overwrites the server with your version.<br/><b>Reload theirs</b> discards your local changes and pulls the latest from the cloud.</p>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="np-button" data-close-conflict>Cancel</button>
        <button class="np-button" id="conflict-reload-btn">Reload theirs</button>
        <button class="np-button np-button--primary" id="conflict-overwrite-btn">Keep mine</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-conflict]').forEach(el => {
    el.addEventListener('click', () => modal.remove());
  });
  // "Keep mine" — re-fetch server to learn its updated_at, then save with it.
  document.getElementById('conflict-overwrite-btn').addEventListener('click', async () => {
    modal.remove();
    try {
      const fresh = await loadTranscript(currentTranscriptId);
      lastServerUpdatedAt = fresh.updated_at;
      runSaveOnce();
    } catch (err) {
      setSaveState('error', err);
    }
  });
  // "Reload theirs" — discard local edits and reload from server.
  document.getElementById('conflict-reload-btn').addEventListener('click', () => {
    modal.remove();
    handleLoad(currentTranscriptId);
  });
}

function getSeqMeta() {
  const meta = getSequenceMetadata(segments);
  if (customSequenceName) {
    meta.sequenceName = customSequenceName;
  }
  return meta;
}

function handleSequenceNameChange(newName) {
  customSequenceName = newName;
  // Also update the step-2 input if visible
  const seqInput = $('#sequence-name-input');
  if (seqInput) seqInput.value = newName;
  // Immediately re-render editor with updated sequenceInfo
  updateSyncDirtyIndicator();
  debouncedAutoSave();
}

function generateAutoName() {
  const seqMeta = getSeqMeta();
  const speaker = seqMeta.primarySpeaker || 'Untitled';
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${speaker} — ${date}`;
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

const RESERVED_SLUGS = ['sequencer'];

async function ensureUniqueSlug(base, excludeId) {
  let slug = RESERVED_SLUGS.includes(base) ? `${base}-1` : base;
  let i = 2;
  while (await isSlugTaken(slug, excludeId)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

// `autoSave`, `debouncedAutoSave`, and `flushPendingSave` are now defined
// up in the save state machine block. The helpers below preserve the
// only piece of behaviour that lived only here: the beforeunload warning.

// Compatibility alias for any older callers — equivalent to runSaveOnce.
async function autoSave() { return runSaveOnce(); }

// Warn before closing the tab if a save is still pending or in flight.
window.addEventListener('beforeunload', (e) => {
  if (pendingSave || saveInFlight) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

// Manual save shortcut: ⌘S / Ctrl-S. Catches the keystroke globally so
// the user can save from anywhere — editor, library, modal — without
// the browser's "Save Page As" dialog popping up.
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
    if (!currentTranscriptId && segments.length === 0) return; // nothing to save
    e.preventDefault();
    manualSave();
  }
});

// ── Library button ──
btnLibrary.addEventListener('click', showLibrary);

// ── Editorial focus — save on blur ──
$('#editorial-focus')?.addEventListener('blur', () => debouncedAutoSave());

// ── Interest vote handler ──
function handleInterestVote(segNums, type) {
  // type: 'interested' | 'not-interested' | null (clear)
  const newVotes = { ...interestVotes };
  for (const num of segNums) {
    if (type === null) {
      delete newVotes[num];
    } else {
      newVotes[num] = type;
    }
  }
  interestVotes = newVotes;

  // Update just the interest votes without full re-render (preserves summary panel state)
  if (editorInstance) {
    editorInstance.update({
      interestVotes,
      summaryBullets,
    });
  }
  debouncedAutoSave();
}

// ── Backfill startTime for saved editor states missing timecodes ──
function backfillStartTimes(state, segs) {
  if (!state?.content || !segs?.length) return;
  for (const block of state.content) {
    if (block.type !== 'speakerBlock' || block.attrs?.startTime) continue;
    // Find the first segment number in this block's paragraph content
    const para = block.content?.[0];
    if (!para?.content) continue;
    for (const textNode of para.content) {
      const segMark = textNode.marks?.find(m => m.type === 'segment');
      if (segMark?.attrs?.start) {
        block.attrs.startTime = segMark.attrs.start;
        break;
      }
    }
  }
}

// ── Editor instance update helper (DRY) ──
function updateEditorInstance() {
  if (!editorInstance) return;
  const seqMeta = getSeqMeta();
  editorInstance.update({
    initialContent: editorState,
    projectId: currentProjectId,
    summary: currentSummary,
    summaryBullets,
    interestVotes,
    sequenceInfo: seqMeta,
    speakerColors,
    speakerMap,
    editorDirty,
    onSpeakerMapChange: (rawName, newCleanName) => {
      speakerMap[rawName] = newCleanName;
    },
    onUpdate: (json) => {
      editorState = json;
      editorDirty = true;
      debouncedAutoSave();
    },
    onSync: (arg) => {
      if (arg && typeof arg === 'object' && !Array.isArray(arg) && arg.kind === 'smart') {
        const count = smartSyncSelection(arg.segNums, arg.fullText);
        showSyncFeedback(count, arg.segNums);
      } else {
        const count = syncEditorToTranslations(arg);
        showSyncFeedback(count, arg);
      }
      autoSave();
    },
    onSequenceNameChange: handleSequenceNameChange,
    onAskAI: (selection) => {
      openCopilot(selection);
    },
    onInterestVote: handleInterestVote,
    onRegenerateSummary: () => generateAutoSummary(),
    onOpenHistory: () => openRevisionHistory(),
  });
}

// ── Search button ──
let searchMounted = false;
$('#btn-search')?.addEventListener('click', () => {
  // Toggle search view
  const searchView = $('#search-view');
  if (searchView.classList.contains('active')) {
    searchView.classList.remove('active');
    stepsNav.classList.remove('hidden');
    return;
  }

  $$('.panel').forEach(p => p.classList.remove('active'));
  stepsNav.classList.add('hidden');
  searchView.classList.add('active');

  if (!searchMounted) {
    mountTagSearch($('#search-mount'), {
      onNavigate: (result) => {
        if (result.transcripts?.id) handleLoad(result.transcripts.id);
      },
      onClose: () => {
        searchView.classList.remove('active');
        stepsNav.classList.remove('hidden');
        goToStep(currentStep);
      },
    });
    searchMounted = true;
  }
});

// ── Sacred Sequencer ──
let seqSoundbites = [];
let seqAddingMore = false;
let seqSourceXML = null; // parsed Premiere XML for nested sequence with real media

/* ── Aurora: 3 spring-eased gauzy lights that follow the mouse, idle-drift when still.
   Each light has its own stiffness/damping so they don't move in lockstep — that's
   what makes it feel organic instead of like the cursor dragging a single blob. */
let seqAuroraRAF = null;
let seqAuroraOnMove = null;
let seqAuroraOnLeave = null;

function startSeqAurora() {
  const view = document.getElementById('sequencer-view');
  const lights = view.querySelectorAll('.seq-aurora');
  if (!lights.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Per-light state: target = where it wants to be; current = where it is now.
  // Soft, slow tracking — the cursor influence is gentle, not magnetic.
  const cfg = [
    { stiffness: 0.012, damping: 0.88, idleAmp: 0.10, idleSpeed: 0.00010, idlePhase: 0,   mouseInfluence: 0.35 },
    { stiffness: 0.008, damping: 0.90, idleAmp: 0.14, idleSpeed: 0.00006, idlePhase: 2.5, mouseInfluence: 0.25 },
  ];
  const state = Array.from(lights).map((el, i) => ({
    el,
    cfg: cfg[i] || cfg[0],
    cx: window.innerWidth / 2,
    cy: window.innerHeight * 0.58,
    vx: 0, vy: 0,
    tx: window.innerWidth / 2,
    ty: window.innerHeight * 0.58,
  }));

  // Targets are the mouse — but each light gets a small offset so they don't stack.
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight * 0.58;
  let mouseSeen = false;
  let lastMoveAt = 0;

  seqAuroraOnMove = (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseSeen = true;
    lastMoveAt = performance.now();
  };
  seqAuroraOnLeave = () => { mouseSeen = false; };

  view.addEventListener('pointermove', seqAuroraOnMove, { passive: true });
  view.addEventListener('pointerleave', seqAuroraOnLeave, { passive: true });

  if (reduce) {
    // Reduced motion: pin lights to centred positions, no animation.
    state.forEach((s, i) => {
      const el = s.el;
      el.style.transform = `translate3d(${s.cx - 300}px, ${s.cy - 300}px, 0)`;
    });
    return;
  }

  const start = performance.now();
  function tick(now) {
    const t = now - start;
    const idleWeight = mouseSeen
      ? Math.min(1, Math.max(0, 1 - (now - lastMoveAt) / 2200))
      : 0; // idleWeight: 1 right after a move, 0 after 2.2s still — blends mouse into idle

    state.forEach((s, i) => {
      const { stiffness, damping, idleAmp, idleSpeed, idlePhase, mouseInfluence } = s.cfg;

      // Idle Lissajous: each light traces its own slow loop centred near the sun
      const idleX = window.innerWidth  * (0.5 + idleAmp * Math.sin(t * idleSpeed + idlePhase));
      const idleY = window.innerHeight * (0.55 + idleAmp * 0.4 * Math.cos(t * idleSpeed * 1.3 + idlePhase));

      // Pull only PARTIALLY toward the mouse — the cursor nudges the drift, doesn't own it
      const pullX = mouseSeen ? (idleX + (mouseX - idleX) * mouseInfluence) : idleX;
      const pullY = mouseSeen ? (idleY + (mouseY - idleY) * mouseInfluence) : idleY;

      s.tx = pullX * idleWeight + idleX * (1 - idleWeight);
      s.ty = pullY * idleWeight + idleY * (1 - idleWeight);

      // Spring step: F = stiffness * (target - current); v += F; v *= damping; current += v
      const fx = (s.tx - s.cx) * stiffness;
      const fy = (s.ty - s.cy) * stiffness;
      s.vx = (s.vx + fx) * damping;
      s.vy = (s.vy + fy) * damping;
      s.cx += s.vx;
      s.cy += s.vy;

      // translate3d nudges hardware acceleration; 600px box, so subtract 300 to centre
      s.el.style.transform = `translate3d(${s.cx - 300}px, ${s.cy - 300}px, 0)`;
    });

    seqAuroraRAF = requestAnimationFrame(tick);
  }
  seqAuroraRAF = requestAnimationFrame(tick);
}

function stopSeqAurora() {
  if (seqAuroraRAF) cancelAnimationFrame(seqAuroraRAF);
  seqAuroraRAF = null;
  const view = document.getElementById('sequencer-view');
  if (view) {
    if (seqAuroraOnMove) view.removeEventListener('pointermove', seqAuroraOnMove);
    if (seqAuroraOnLeave) view.removeEventListener('pointerleave', seqAuroraOnLeave);
  }
  seqAuroraOnMove = null;
  seqAuroraOnLeave = null;
}

function showSequencer() {
  flushPendingSave();
  stopFallingGlyphs();
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sequencer-view').classList.remove('hidden');
  document.body.style.background = '#0a0526';
  startSeqAurora();
  setPermalinkHash('sequencer');
}

function exitSequencer() {
  document.getElementById('sequencer-view').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.body.style.background = '';
  stopSeqAurora();
  // Reset sequencer state
  seqSoundbites = [];
  seqAddingMore = false;
  seqSourceXML = null;
  $('#seq-xml-status').textContent = '';
  $('#seq-arrange').classList.add('hidden');
  $('#seq-confirm').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  $('#seq-input').value = '';
  // Restore transcript hash or clear
  if (currentSlug || currentTranscriptId) {
    setPermalinkHash(currentSlug || currentTranscriptId);
  } else {
    clearPermalinkHash();
  }
}

/**
 * Parse soundbites from pasted text. Tolerates several common formats:
 *
 *   F1 (canonical):
 *     [SEQUENCE | 00:00:01 → 00:00:05] text...
 *
 *   F2 (transcription service, in/out + duration at end):
 *     SEQUENCE - SPEAKER: [00:00:01] text... [00:00:05][4.0]
 *     SEQUENCE: [00:00:01] text... [00:00:05][4.0]
 *
 *   F3 (single-timecode, no end — uncuttable, flagged):
 *     SEQUENCE - SPEAKER: [00:00:01] text...
 *
 *   F4 (filename + Speaker N (TC), no end — uncuttable, flagged):
 *     260316-04-102-FISHERMAN.mp4
 *     FISHERMAN Speaker 6 (00:58:58.16) text...
 *
 * Returns { bites, skipped } — bites are cuttable; skipped is a list of
 * { raw, reason } for lines we recognized but couldn't extract an end TC from.
 */
function parseSoundbites(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const bites = [];
  const skipped = [];

  // F1
  const f1 = /^\[([^|]+?)\s*\|\s*([0-9:.,]+)\s*→\s*([0-9:.,]+)\]\s*(.+)/;
  // F2: prefix: [start] text [end][duration?]
  //   prefix can be "260304-0439-Chihhao Yu" or "01 MIKAEL ANTELL" or "Mars Study - JOHNNY"
  const f2 = /^(.+?):\s*\[([0-9:.,]+)\]\s*(.+?)\s*\[([0-9:.,]+)\](?:\[[0-9.]+\])?\s*$/;
  // F3: prefix: [start] text   (no end timecode at all)
  const f3 = /^(.+?):\s*\[([0-9:.,]+)\]\s*(.+)$/;
  // F4 header: "<sequence>.mp4"
  const f4Header = /^(.+?\.mp4)$/i;
  // F4 body: "SPEAKER Speaker N (TC)"
  const f4Body = /^.+?\s+Speaker\s+\d+\s+\(([0-9:.,]+)\)/i;

  // Track context for F4 (the .mp4 line precedes the speaker line).
  let f4Prefix = null;

  for (const line of lines) {
    // F1
    let m = line.match(f1);
    if (m) {
      bites.push({
        id: crypto.randomUUID(),
        prefix: m[1].trim(),
        start: m[2].trim(),
        end: m[3].trim(),
        text: m[4].trim(),
      });
      f4Prefix = null;
      continue;
    }

    // F2
    m = line.match(f2);
    if (m) {
      bites.push({
        id: crypto.randomUUID(),
        prefix: m[1].trim(),
        start: m[2].trim(),
        end: m[4].trim(),
        text: m[3].trim(),
      });
      f4Prefix = null;
      continue;
    }

    // F4 — filename header, remember it for the next line
    m = line.match(f4Header);
    if (m) {
      f4Prefix = m[1].replace(/\.mp4$/i, '').trim();
      continue;
    }

    // F4 body
    m = line.match(f4Body);
    if (m && f4Prefix) {
      skipped.push({ raw: line, reason: 'no end timecode — only a single timestamp', prefix: f4Prefix });
      f4Prefix = null;
      continue;
    }

    // F3 — single TC, no end
    m = line.match(f3);
    if (m) {
      skipped.push({ raw: line, reason: 'no end timecode — only a single timestamp', prefix: m[1].trim() });
      f4Prefix = null;
      continue;
    }

    // Unrecognized — silent skip
    f4Prefix = null;
  }

  return { bites, skipped };
}

function extractSacredName(prefix) {
  // Strip "- SPEAKER" suffix: "Mars Study - JOHN" → "Mars Study"
  return prefix.replace(/\s*-\s*[A-Z][A-Z0-9 ]*$/i, '').trim() || prefix;
}

function detectSacredSequence(bites) {
  // Count sequence names by frequency — the most common one is the sacred sequence
  const counts = {};
  for (const b of bites) {
    const name = extractSacredName(b.prefix);
    counts[name] = (counts[name] || 0) + 1;
  }
  let best = '', bestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) { best = name; bestCount = count; }
  }
  return { name: best, count: bestCount, total: bites.length };
}

function detectAllSequences(bites) {
  const map = {};
  for (const b of bites) {
    const name = extractSacredName(b.prefix);
    if (!map[name]) map[name] = { name, count: 0 };
    map[name].count++;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

function formatDuration(bites) {
  let totalSec = 0;
  for (const b of bites) {
    const parts = (tc) => {
      const p = tc.replace(',', '.').split(':');
      if (p.length === 3) return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2]);
      if (p.length === 2) return parseInt(p[0]) * 60 + parseFloat(p[1]);
      return parseFloat(p[0]) || 0;
    };
    totalSec += Math.max(0, parts(b.end) - parts(b.start));
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function tcToFrameNotation(tc, fps) {
  const parts = tc.replace(',', '.').split(':');
  let h = 0, m = 0, secStr = '0';
  if (parts.length === 3) { h = parseInt(parts[0]) || 0; m = parseInt(parts[1]) || 0; secStr = parts[2]; }
  else if (parts.length === 2) { m = parseInt(parts[0]) || 0; secStr = parts[1]; }
  else { secStr = parts[0]; }

  const dotIdx = secStr.indexOf('.');
  const s = parseInt(dotIdx >= 0 ? secStr.slice(0, dotIdx) : secStr) || 0;
  const frac = dotIdx >= 0 ? parseFloat('0' + secStr.slice(dotIdx)) : 0;
  const frames = Math.floor(frac * fps);
  const ff = frames.toString().padStart(2, '0');

  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${ff}`;
  return `${m}:${s.toString().padStart(2, '0')}:${ff}`;
}

function parsePremiereXML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const seqEl = doc.querySelector('sequence');
  if (!seqEl) return null;

  const sequenceName = seqEl.querySelector('name')?.textContent || '';
  const duration = parseInt(seqEl.querySelector('duration')?.textContent) || 0;
  const timebase = parseInt(seqEl.querySelector('rate > timebase')?.textContent) || 24;
  const ntsc = (seqEl.querySelector('rate > ntsc')?.textContent || '').toUpperCase() === 'TRUE';

  // Serialize the full <sequence> element back to raw XML string
  const serializer = new XMLSerializer();
  const sequenceXML = serializer.serializeToString(seqEl);

  return { sequenceXML, sequenceName, duration, timebase, ntsc };
}

function renderSeqSources() {
  const list = $('#seq-source-list');
  if (!list) return;
  const sources = detectAllSequences(seqSoundbites);
  if (sources.length === 0) {
    list.innerHTML = '<span class="seq-source-empty">No sources detected.</span>';
    return;
  }
  list.innerHTML = sources.map(s =>
    `<span class="seq-source-chip"><span class="seq-source-name">${escapeHtmlSafe(s.name)}</span><span class="seq-source-count">${s.count}×</span></span>`
  ).join('');
}

function escapeHtmlSafe(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSeqBlocks() {
  const container = $('#seq-blocks');
  const status = $('#seq-status');
  const sources = detectAllSequences(seqSoundbites);
  const seqLabel = sources.length === 1
    ? `1 sequence`
    : `${sources.length} sequences`;
  status.textContent = `${seqSoundbites.length} soundbite${seqSoundbites.length !== 1 ? 's' : ''} · ${seqLabel} · ~${formatDuration(seqSoundbites)} total`;
  renderSeqSources();

  const currentFps = parseFloat($('#seq-fps')?.value) || 23.976;
  container.innerHTML = seqSoundbites.map(b => `
    <div class="seq-block" draggable="true" data-id="${b.id}">
      <div class="seq-block-handle">⠿</div>
      <div class="seq-block-body">
        <div class="seq-block-time">${tcToFrameNotation(b.start, currentFps)} → ${tcToFrameNotation(b.end, currentFps)}</div>
        <div class="seq-block-text">${b.text}</div>
      </div>
      <button class="seq-block-remove" data-id="${b.id}">×</button>
    </div>
  `).join('');

  // Remove buttons
  container.querySelectorAll('.seq-block-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      seqSoundbites = seqSoundbites.filter(b => b.id !== btn.dataset.id);
      renderSeqBlocks();
    });
  });

  // Drag and drop
  let dragId = null;

  container.querySelectorAll('.seq-block').forEach(block => {
    block.addEventListener('dragstart', (e) => {
      dragId = block.dataset.id;
      block.classList.add('seq-block--dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    block.addEventListener('dragend', () => {
      block.classList.remove('seq-block--dragging');
      container.querySelectorAll('.seq-block').forEach(b => b.classList.remove('seq-block--drop-indicator'));
      dragId = null;
    });
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    container.querySelectorAll('.seq-block').forEach(b => b.classList.remove('seq-block--drop-indicator'));
    const target = getDragTarget(container, e.clientY);
    if (target && target.dataset.id !== dragId) {
      target.classList.add('seq-block--drop-indicator');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragId) return;
    const target = getDragTarget(container, e.clientY);
    if (!target || target.dataset.id === dragId) return;

    const fromIdx = seqSoundbites.findIndex(b => b.id === dragId);
    const toIdx = seqSoundbites.findIndex(b => b.id === target.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const [item] = seqSoundbites.splice(fromIdx, 1);
    seqSoundbites.splice(toIdx, 0, item);
    renderSeqBlocks();
  });
}

function getDragTarget(container, y) {
  const blocks = [...container.querySelectorAll('.seq-block:not(.seq-block--dragging)')];
  let closest = null;
  let closestDist = Infinity;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const dist = Math.abs(y - mid);
    if (dist < closestDist) {
      closestDist = dist;
      closest = block;
    }
  }
  return closest;
}

$('#btn-sequencer').addEventListener('click', showSequencer);
$('#seq-exit-btn').addEventListener('click', exitSequencer);

// Home page quick-links — bound BOTH directly AND via document delegation
// so they fire even if the direct binding misses (e.g. element re-rendered,
// SVG child intercepts, etc).
const homeLibBtn = $('#home-library-btn');
if (homeLibBtn) homeLibBtn.addEventListener('click', showLibrary);
const homeSeqBtn = $('#home-sequencer-btn');
if (homeSeqBtn) homeSeqBtn.addEventListener('click', showSequencer);
document.addEventListener('click', (e) => {
  if (e.target.closest('#home-library-btn')) { e.preventDefault(); showLibrary(); }
  else if (e.target.closest('#home-sequencer-btn')) { e.preventDefault(); showSequencer(); }
});

$('#seq-parse-btn').addEventListener('click', () => {
  const raw = $('#seq-input').value;
  const hint = $('#seq-parse-hint');
  const { bites: newBites, skipped } = parseSoundbites(raw);

  if (newBites.length === 0 && skipped.length === 0) {
    hint.textContent = 'No soundbites found. Look for lines like [Name | 00:00:00 → 00:01:00] text...';
    hint.classList.remove('hidden');
    return;
  }

  if (skipped.length > 0) {
    const sample = skipped.slice(0, 3).map(s => `• ${s.prefix || '(unknown)'} — ${s.reason}`).join('\n');
    const more = skipped.length > 3 ? `\n…and ${skipped.length - 3} more` : '';
    hint.textContent =
      `Skipped ${skipped.length} line${skipped.length !== 1 ? 's' : ''} that have no end timecode (can't cut without an out-point):\n${sample}${more}`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }

  if (newBites.length === 0) return;

  if (seqAddingMore) {
    // Append to existing list, skip confirmation
    seqSoundbites = seqSoundbites.concat(newBites);
    seqAddingMore = false;
    $('#seq-input').value = '';
    $('#seq-paste').classList.add('hidden');
    $('#seq-arrange').classList.remove('hidden');
    renderSeqBlocks();
    return;
  }

  // First parse — detect all sequences and show checklist
  seqSoundbites = newBites;
  const sequences = detectAllSequences(seqSoundbites);
  const total = seqSoundbites.length;

  $('#seq-confirm-detail').textContent = `Found ${total} soundbite${total !== 1 ? 's' : ''} across ${sequences.length} sequence${sequences.length !== 1 ? 's' : ''}`;

  const listEl = $('#seq-sequence-list');
  listEl.innerHTML = sequences.map((seq, i) => `
    <label class="seq-sequence-row">
      <input type="checkbox" value="${esc(seq.name)}" checked>
      <span class="seq-sequence-name">${esc(seq.name)}</span>
      <span class="seq-sequence-count">${seq.count} soundbite${seq.count !== 1 ? 's' : ''}</span>
    </label>
  `).join('');

  $('#seq-paste').classList.add('hidden');
  $('#seq-confirm').classList.remove('hidden');
});

$('#seq-confirm-yes').addEventListener('click', () => {
  // Read checked sequences from checklist
  const checked = [...$$('#seq-sequence-list input[type="checkbox"]:checked')].map(cb => cb.value);
  if (checked.length === 0) return;

  // Filter soundbites to only include checked sequences
  seqSoundbites = seqSoundbites.filter(b => checked.includes(extractSacredName(b.prefix)));

  // Sacred name = most frequent checked sequence (first in list since sorted by count)
  const sacredName = checked[0] || 'Sacred Sequence';
  $('#seq-name').value = sacredName;
  $('#seq-output-name').value = sacredName + '_Sacred Selects';

  $('#seq-confirm').classList.add('hidden');
  $('#seq-arrange').classList.remove('hidden');
  renderSeqBlocks();
});

$('#seq-confirm-back').addEventListener('click', () => {
  $('#seq-confirm').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  seqSoundbites = [];
});

$('#seq-add-more-btn').addEventListener('click', () => {
  seqAddingMore = true;
  $('#seq-arrange').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  $('#seq-input').value = '';
  $('#seq-input').focus();
});

$('#seq-back-btn').addEventListener('click', () => {
  $('#seq-arrange').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  $('#seq-input').value = '';
  seqSoundbites = [];
  seqAddingMore = false;
  seqSourceXML = null;
  $('#seq-xml-status').textContent = '';
});

$('#seq-export-jsx-btn').addEventListener('click', () => {
  if (seqSoundbites.length === 0) return;

  const sacredSequenceName = $('#seq-name').value.trim() || 'Sacred Sequence';
  const outputName = $('#seq-output-name').value.trim() || sacredSequenceName + '_Sacred Selects';
  const fps = parseFloat($('#seq-fps').value) || 23.976;
  const gapFrames = parseInt($('#seq-gap').value) || 12;
  const gapSeconds = gapFrames / fps;

  // Convert soundbites to seconds for the Premiere extension
  const tcToSec = (tc) => {
    const parts = tc.replace(',', '.').split(':');
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    return parseFloat(parts[0]) || 0;
  };

  const payload = {
    sacredSequenceName,
    outputName,
    gapSeconds,
    soundbites: seqSoundbites.map((b, i) => ({
      sequenceName: extractSacredName(b.prefix) || sacredSequenceName,
      inSec: tcToSec(b.start),
      outSec: tcToSec(b.end),
      name: b.prefix || 'Soundbite ' + (i + 1),
    })),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${outputName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#seq-export-btn').addEventListener('click', () => {
  if (seqSoundbites.length === 0) return;

  // FCP XML import in Premiere always creates a NEW sequence project item
  // for every <sequence> element with a body — there's no XML mechanism to
  // reference an existing sequence by name. So this path always duplicates
  // the sacred sequence on import. Make the user opt in explicitly.
  const confirmed = confirm(
    'Heads up: importing this XML into Premiere will create a DUPLICATE of the sacred sequence in your project.\n\n' +
    'This is a limitation of the FCP XML format — there is no way to reference an existing sequence by name.\n\n' +
    'For nest-by-reference (single source of truth), cancel and use "Export for Premiere" with the Sacred Sequencer panel instead.\n\n' +
    'Continue with XML export anyway?'
  );
  if (!confirmed) return;

  const sacredSequenceName = $('#seq-name').value.trim() || 'Sacred Sequence';
  const outputName = $('#seq-output-name').value.trim() || sacredSequenceName + '_Sacred Selects';
  const fps = parseFloat($('#seq-fps').value) || 23.976;
  const gapFrames = parseInt($('#seq-gap').value) || 12;

  const xml = buildSacredSequencerXML({
    soundbites: seqSoundbites,
    sacredSequenceName,
    outputName,
    fps,
    gapFrames,
    sourceSequenceXML: seqSourceXML?.sequenceXML || null,
  });

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${outputName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xml`;
  a.click();
  URL.revokeObjectURL(url);
});

// Re-render blocks when FPS changes (updates frame timecodes)
$('#seq-fps')?.addEventListener('change', () => {
  if (seqSoundbites.length > 0 && !$('#seq-arrange').classList.contains('hidden')) {
    renderSeqBlocks();
  }
});

// Source XML upload for real media nesting
$('#seq-xml-upload-btn').addEventListener('click', () => {
  $('#seq-xml-input').click();
});

$('#seq-xml-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const parsed = parsePremiereXML(ev.target.result);
    if (!parsed) {
      $('#seq-xml-status').textContent = 'No sequence found in XML';
      $('#seq-xml-status').style.color = '#ff4444';
      seqSourceXML = null;
      return;
    }
    seqSourceXML = parsed;
    $('#seq-xml-status').textContent = `Linked: ${parsed.sequenceName}`;
    $('#seq-xml-status').style.color = '#00e5ff';
  };
  reader.readAsText(file);
  e.target.value = ''; // allow re-uploading same file
});

// ── Step 1: Upload ──
async function handleFile(file) {
  const lower = file.name.toLowerCase();
  const isJSON = lower.endsWith('.json');
  const isCSV  = lower.endsWith('.csv');
  const isHTML = lower.endsWith('.html') || lower.endsWith('.htm');
  const isZIP  = lower.endsWith('.zip');

  if (!file || (!isCSV && !isJSON && !isHTML && !isZIP)) {
    showError('Please upload a .csv, .json, .html, or Trint .zip export.');
    return;
  }

  // Trint export comes as a zip — unzip in-browser, find the index.html, parse it.
  if (isZIP) {
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { unzipSync, strFromU8 } = await import('fflate');
      const entries = unzipSync(buf, {
        // Skip non-HTML files to keep the unzip work small
        filter: (f) => /\.html?$/i.test(f.name) && !f.name.startsWith('__MACOSX/'),
      });
      // Prefer a top-level index.html, otherwise any .html
      let pick = Object.keys(entries).find(n => /(?:^|\/)index\.html?$/i.test(n))
              || Object.keys(entries).find(n => /\.html?$/i.test(n));
      if (!pick) {
        showError('Zip did not contain an HTML file. Is this a Trint Interactive export?');
        return;
      }
      const html = strFromU8(entries[pick]);
      try {
        const result = parseTrintHTML(html);
        segments = result.segments;
        wordTimingsMap = result.wordTimings;
      } catch (err) {
        showError('Could not parse the HTML inside this zip: ' + err.message);
        return;
      }
      finishUploadParse(file);
    } catch (err) {
      showError('Could not unzip: ' + err.message);
    }
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;

      if (isHTML || (!isJSON && !isCSV && content.trimStart().startsWith('<'))) {
        const result = parseTrintHTML(content);
        segments = result.segments;
        wordTimingsMap = result.wordTimings;
      } else if (isJSON || (!isCSV && content.trimStart().startsWith('['))) {
        const result = parseJSON(content);
        segments = result.segments;
        wordTimingsMap = result.wordTimings;
      } else {
        segments = parseCSV(content);
        wordTimingsMap = null;
      }

      finishUploadParse(file);
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsText(file);
}

function finishUploadParse(file) {
  // Reset state for new file
  currentTranscriptId = null;
  currentTranscriptName = '';
  analysis = null;
  translations = [];
  srtContent = '';
  speakerColors = {};
  annotations = {};
  editorState = null;
  editorInstance = null;
  workshopState = null;
  unmountWorkshop();
  speakerMap = buildSpeakerMap(segments);
  hiddenSpeakers = segments
    .map(s => s.speaker)
    .filter(s => isGenericSpeaker(s))
    .filter((v, i, a) => a.indexOf(v) === i);
  showAllSpeakers = false;
  // Pre-fill sequence name from filename (minus extension)
  customSequenceName = (file?.name || '').replace(/\.(json|csv|html|htm|zip)$/i, '');
  renderTranscript();

  // Auto-create draft transcript in Supabase
  autoSave();
}

function renderTranscript() {
  const stats = getStats(segments);
  const hiddenCount = hiddenSpeakers.length;
  $('#stat-segments').textContent = `${stats.segmentCount} segments`;
  $('#stat-duration').textContent = `Duration: ${stats.duration}`;
  $('#stat-speakers').textContent = `${stats.speakerCount} speaker${stats.speakerCount !== 1 ? 's' : ''}`;

  // Show/hide speaker toggle
  if (hiddenCount > 0) {
    btnSpeakerToggle.classList.remove('hidden');
    btnSpeakerToggle.textContent = showAllSpeakers
      ? 'Hide unlabeled'
      : `Show all (${hiddenCount} hidden)`;
  } else {
    btnSpeakerToggle.classList.add('hidden');
  }

  transcriptBody.innerHTML = segments
    .map(s => {
      const isHidden = !showAllSpeakers && hiddenSpeakers.includes(s.speaker);
      const displayName = speakerMap[s.speaker] || s.speaker;
      return `<tr class="${isHidden ? 'hidden' : ''} ${isGenericSpeaker(s.speaker) ? 'dimmed-speaker' : ''}">
      <td>${s.number}</td>
      <td>${esc(displayName)}</td>
      <td>${esc(s.start)}</td>
      <td>${esc(s.end)}</td>
      <td>${esc(s.text)}</td>
    </tr>`;
    })
    .join('');

  dropZone.classList.add('hidden');
  uploadPreview.classList.remove('hidden');
}

// Drag & drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files[0]);
});

// ── Step 2: Analyze ──
btnAnalyze.addEventListener('click', async () => {
  goToStep(2);
  $('#analyze-loading').classList.remove('hidden');
  $('#analyze-result').classList.add('hidden');

  try {
    analysis = await analyzeTranscript(segments);
    assignSpeakerColors();
    syncEditorColors();
    renderAnalysis();
    autoSave();
  } catch (err) {
    $('#analyze-loading').classList.add('hidden');
    showError(err.message, '#step-2');
  }
});

function assignSpeakerColors() {
  if (!analysis?.language_map) return;
  const speakers = Object.keys(analysis.language_map);
  speakers.forEach((speaker, i) => {
    if (!speakerColors[speaker]) {
      speakerColors[speaker] = SPEAKER_PALETTE[i % SPEAKER_PALETTE.length];
    }
  });
}

/**
 * Sync editor state JSON colors with the current speakerColors map.
 * Handles the case where editor state was built before colors were assigned,
 * or colors changed after the editor state was saved.
 */
function syncEditorColors() {
  if (!editorState?.content || Object.keys(speakerColors).length === 0) return;

  // Build reverse map: clean display name → raw CSV name
  const cleanToRaw = {};
  for (const [raw, clean] of Object.entries(speakerMap || {})) {
    cleanToRaw[clean] = raw;
  }

  for (const block of editorState.content) {
    if (block.type === 'speakerBlock' && block.attrs) {
      const displayName = block.attrs.speaker;
      const rawName = cleanToRaw[displayName] || displayName;
      const color = speakerColors[rawName];
      if (color) {
        block.attrs.color = color;
      }
    }
  }
}

function renderAnalysis() {
  $('#analyze-loading').classList.add('hidden');
  $('#analyze-result').classList.remove('hidden');

  $('#narrative-summary').textContent = analysis.narrative_summary;

  const langDiv = $('#language-map');
  if (analysis.language_map && typeof analysis.language_map === 'object') {
    langDiv.innerHTML = Object.entries(analysis.language_map)
      .map(([speaker, lang]) => `<div><strong>${esc(speaker)}</strong>: ${esc(lang)}</div>`)
      .join('');
  } else {
    langDiv.textContent = 'Could not detect languages';
  }

  // Populate sequence name input (remove old listener to avoid stacking)
  const seqInput = $('#sequence-name-input');
  seqInput.value = customSequenceName || getSequenceMetadata(segments).sequenceName || '';
  const seqInputHandler = () => { customSequenceName = seqInput.value.trim(); };
  seqInput.removeEventListener('input', seqInput._seqHandler);
  seqInput._seqHandler = seqInputHandler;
  seqInput.addEventListener('input', seqInputHandler);

  // Populate speaker checkboxes
  renderSpeakerCheckboxes();

  // Show generic segment count
  const genericCount = analysis.generic_segments?.length || 0;
  const notice = $('#questions-notice');
  const qCount = analysis.questions?.length || 0;
  let noticeHtml = '';

  if (genericCount > 0) {
    noticeHtml += `<p style="margin-top:0.5rem;font-family:var(--np-font-mono);font-size:12px;color:var(--np-sepia);">${genericCount} unlabeled segment${genericCount > 1 ? 's' : ''} will be marked [unintelligible]</p>`;
    noticeHtml += `<label class="speaker-checkbox-row" style="margin-top:0.25rem;">
      <input type="checkbox" id="chk-hide-unintelligible" ${hideUnintelligible ? 'checked' : ''}>
      <span class="speaker-checkbox-label">Make unintelligible audio invisible</span>
    </label>`;
  }

  if (qCount > 0) {
    noticeHtml += `<p style="margin-top:0.5rem;font-family:var(--np-font-mono);font-size:12px;color:var(--np-sepia);">${qCount} clarification question${qCount > 1 ? 's' : ''}</p>`;
  }

  notice.innerHTML = noticeHtml;

  // Wire up unintelligible checkbox
  const chkUnintelligible = $('#chk-hide-unintelligible');
  if (chkUnintelligible) {
    chkUnintelligible.addEventListener('change', (e) => {
      hideUnintelligible = e.target.checked;
    });
  }
  btnToClarify.innerHTML = 'Continue &rarr;';
}

function renderSpeakerCheckboxes() {
  const container = $('#speaker-checkboxes');
  if (!analysis?.language_map || typeof analysis.language_map !== 'object') {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = Object.entries(analysis.language_map)
    .map(([speaker, lang]) => {
      const color = speakerColors[speaker] || '#DD2C1E';
      const isHidden = hiddenSpeakers.includes(speaker);
      const checked = !isHidden;
      return `<label class="speaker-checkbox-row">
        <input type="checkbox" data-speaker="${esc(speaker)}" ${checked ? 'checked' : ''}>
        <span class="speaker-checkbox-dot" style="background:${color}"></span>
        <span class="speaker-checkbox-label">${esc(speaker)}</span>
        <span class="speaker-checkbox-lang">${esc(lang)}</span>
      </label>`;
    })
    .join('');
}

function gatherSpeakerSelections() {
  const checkboxes = $$('#speaker-checkboxes input[type="checkbox"]');
  if (checkboxes.length === 0) return;
  hiddenSpeakers = [];
  checkboxes.forEach(cb => {
    if (!cb.checked) {
      hiddenSpeakers.push(cb.dataset.speaker);
    }
  });
}

// ── Skip to Editor ──
function skipToEditor() {
  gatherSpeakerSelections();
  // Build editor state directly from segments (no translations)
  editorState = buildEditorDocument(segments, translations.length > 0 ? translations : null, speakerColors, speakerMap, hiddenSpeakers, analysis?.language_map, { hideUnintelligible });
  editorInstance = null;
  goToStep(5);
  switchView('editor');
  autoSave();
}

$('#btn-skip-to-editor').addEventListener('click', skipToEditor);
$('#btn-skip-to-editor-upload').addEventListener('click', skipToEditor);

// ── Step 3: Clarify ──
btnToClarify.addEventListener('click', () => {
  goToStep(3);
  renderClarifyStep();
  autoSave();
});

function renderClarifyStep() {
  // Render themes
  const themesList = $('#themes-list');
  const themes = analysis?.themes || [];
  if (themes.length > 0) {
    themesList.innerHTML = themes
      .map(t => `<span class="theme-tag">${esc(t)}</span>`)
      .join('');
    $('#themes-card').classList.remove('hidden');
  } else {
    $('#themes-card').classList.add('hidden');
  }

  // Render questions
  const questions = analysis?.questions || [];
  const questionsSection = $('#questions-section');

  if (questions.length > 0) {
    questionsSection.classList.remove('hidden');
    const list = $('#questions-list');
    list.innerHTML = questions
      .map((q, i) => `
        <div class="question-card" data-qid="${esc(q.id)}">
          ${q.quoted_text ? `<div class="quote">"${esc(q.quoted_text)}"</div>` : ''}
          <div class="question-text">${esc(q.question)}</div>
          ${q.why ? `<div class="why">${esc(q.why)}</div>` : ''}
          <textarea placeholder="Type your answer or leave blank to skip" data-idx="${i}"></textarea>
        </div>
      `)
      .join('');
  } else {
    questionsSection.classList.add('hidden');
  }
}

function gatherClarifications() {
  const answers = [];
  $$('#questions-list .question-card').forEach(card => {
    const id = card.dataset.qid;
    const answer = card.querySelector('textarea').value.trim();
    if (answer) {
      answers.push({ id, answer });
    }
  });
  return answers;
}

// ── Step 4: Translate ──
btnTranslate.addEventListener('click', () => {
  startTranslation();
});

async function startTranslation() {
  gatherSpeakerSelections();
  goToStep(4);
  $('#translate-loading').classList.remove('hidden');
  $('#translate-result').classList.add('hidden');

  const clarifications = gatherClarifications();
  const editorialFocus = $('#editorial-focus')?.value?.trim() || '';

  // Filter out hidden speakers — they get [chatter] results directly
  const hiddenSet = new Set(hiddenSpeakers);
  const segmentsToTranslate = segments.filter(s => !hiddenSet.has(s.speaker));

  try {
    const loadingText = $('#translate-loading p');
    const result = await translateSegments({
      segments: segmentsToTranslate,
      languageMap: analysis?.language_map || {},
      narrativeSummary: analysis?.narrative_summary || '',
      clarifications,
      editorialFocus,
      onProgress: (done, total) => {
        loadingText.textContent = `Translating batch ${done} of ${total}...`;
      },
    });

    // Merge results: translated segments get API results, hidden get [chatter]
    const translatedMap = new Map(result.map(r => [r.number, r]));
    translations = segments.map(seg => {
      if (translatedMap.has(seg.number)) {
        return translatedMap.get(seg.number);
      }
      // Hidden speaker — fill with chatter
      return {
        number: seg.number,
        original: seg.text,
        translated: '[chatter]',
        language: analysis?.language_map?.[seg.speaker] || '',
        kept_original: false,
        unintelligible: false,
        chatter: true,
      };
    });

    renderTranslations();
    editorState = buildEditorDocument(segments, translations, speakerColors, speakerMap, hiddenSpeakers, analysis?.language_map, { hideUnintelligible });
    editorInstance = null;
    const editorMount = $('#editor-mount');
    if (editorMount) editorMount.innerHTML = '';
    goToStep(5);
    switchView('editor');
    autoSave();
  } catch (err) {
    $('#translate-loading').classList.add('hidden');
    showError(err.message, '#step-4');
  }
}

function renderTranslations() {
  $('#translate-loading').classList.add('hidden');
  $('#translate-result').classList.remove('hidden');

  const tbody = $('#translation-table tbody');
  tbody.innerHTML = translations
    .map((t, i) => {
      const isUnintelligible = t.unintelligible;
      return `<tr class="${isUnintelligible ? 'unintelligible' : ''}">
        <td>${t.number}</td>
        <td>${esc(t.original)}</td>
        <td class="${isUnintelligible ? '' : 'editable'}" data-idx="${i}">
          ${esc(t.translated)}
          ${t.kept_original ? '<span class="kept-badge">kept</span>' : ''}
        </td>
      </tr>`;
    })
    .join('');

  // Inline editing (only for non-unintelligible)
  tbody.querySelectorAll('td.editable').forEach(td => {
    td.addEventListener('click', () => {
      if (td.classList.contains('editing')) return;
      const idx = parseInt(td.dataset.idx);
      const current = translations[idx].translated;
      td.classList.add('editing');
      td.innerHTML = `<textarea>${esc(current)}</textarea>`;
      const ta = td.querySelector('textarea');
      ta.focus();
      ta.addEventListener('blur', () => {
        translations[idx].translated = ta.value;
        translations[idx].kept_original = false;
        td.classList.remove('editing');
        td.textContent = ta.value;
      });
    });
  });
}

// ── Step 5: Edit ──
btnExport.addEventListener('click', () => {
  // Build editor state if not already present
  if (!editorState) {
    editorState = buildEditorDocument(segments, translations, speakerColors, speakerMap, hiddenSpeakers, analysis?.language_map, { hideUnintelligible });
    editorInstance = null;
    const editorMount = $('#editor-mount');
    if (editorMount) editorMount.innerHTML = '';
  }
  goToStep(5);
  switchView('editor');
  autoSave();
});

btnDownload.addEventListener('click', () => {
  if (!srtContent) {
    // Force a regenerate before download if user clicked before previewing
    if (translations.length > 0) regenerateSRT();
  }
  if (!srtContent) {
    showStatus?.('err', 'No subtitles to download yet.');
    return;
  }
  const baseName = (currentTranscriptName || 'subtitles').replace(/[^a-z0-9 _-]+/gi, '').trim() || 'subtitles';
  const blob = new Blob([srtContent], { type: 'application/x-subrip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.srt`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
});

btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(srtContent);
  const fb = $('#copy-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
});

// ── SRT controls (in Step 5 SRT view) ──
let srtRegenTimer = null;
function scheduleSrtRegen() {
  clearTimeout(srtRegenTimer);
  srtRegenTimer = setTimeout(() => {
    if (translations.length > 0) regenerateSRT();
  }, 60);
}

$('#max-words').addEventListener('input', (e) => {
  $('#max-words-val').textContent = e.target.value;
  scheduleSrtRegen();
});

$('#max-duration').addEventListener('input', (e) => {
  $('#max-duration-val').textContent = e.target.value + 's';
  scheduleSrtRegen();
});

function regenerateSRT() {
  syncEditorToTranslations();
  const maxWords = parseInt($('#max-words').value);
  const maxDuration = parseInt($('#max-duration').value);
  const dismissed = getDismissedSegmentNumbers(editorState);
  srtContent = buildSRT(translations, segments, { maxWords, maxDuration, dismissedSegments: dismissed, hideUnintelligible });
  $('#srt-preview').textContent = srtContent;
}

$('#btn-regenerate-srt').addEventListener('click', regenerateSRT);

// ── View toggle (Editor / Workshop) ──
function switchView(view) {
  ['editor', 'workshop'].forEach(v => {
    const btn = $(`#btn-view-${v}`);
    const el = $(`#${v}-view`);
    if (btn) btn.classList.toggle('active', v === view);
    if (el) el.classList.toggle('hidden', v !== view);
  });

  // Hunter only makes sense in editor mode (it highlights ProseMirror DOM).
  setSotHunterVisible(view === 'editor' && currentStep === 5 && segments.length > 0);

  if (view === 'workshop') {
    mountWorkshop();
  }

  // Mount editor on first switch to editor view
  if (view === 'editor' && editorState) {
    backfillStartTimes(editorState, segments);
    syncEditorColors();
    const container = $('#editor-mount');
    if (container && !editorInstance) {
      const seqMeta = getSeqMeta();
      editorInstance = mountEditor(container, {
        initialContent: editorState,
        projectId: currentProjectId,
        summary: currentSummary,
        summaryBullets,
        interestVotes,
        sequenceInfo: seqMeta,
        speakerColors,
        speakerMap,
        hiddenSpeakers,
        editorDirty,
        onSpeakerMapChange: (rawName, newCleanName) => {
          speakerMap[rawName] = newCleanName;
        },
        onUpdate: (json) => {
          editorState = json;
          editorDirty = true;
          debouncedAutoSave();
        },
        onSync: (arg) => {
          if (arg && typeof arg === 'object' && !Array.isArray(arg) && arg.kind === 'smart') {
            const count = smartSyncSelection(arg.segNums, arg.fullText);
            showSyncFeedback(count, arg.segNums);
          } else {
            const count = syncEditorToTranslations(arg);
            showSyncFeedback(count, arg);
          }
          autoSave();
        },
        onSequenceNameChange: handleSequenceNameChange,
        onAskAI: (selection) => {
          openCopilot(selection);
        },
        onInterestVote: handleInterestVote,
        onRegenerateSummary: () => generateAutoSummary(),
        onOpenHistory: () => openRevisionHistory(),
      });

      // Auto-generate summary on first entry if not already generated
      if (!currentSummary) {
        generateAutoSummary();
      }
    }
  }
}
$('#btn-view-editor').addEventListener('click', () => switchView('editor'));
$('#btn-view-workshop').addEventListener('click', () => switchView('workshop'));

// Workshop instance + state lives on the transcript doc.
let workshopInstance = null;
let workshopState = null;

function mountWorkshop() {
  const mount = $('#workshop-mount');
  if (!mount) return;
  if (workshopInstance) return; // already mounted for this transcript
  if (!segments || segments.length === 0) {
    mount.innerHTML = '<div class="workshop-placeholder"><p>Load a transcript first.</p></div>';
    return;
  }
  mount.innerHTML = '<div class="workshop-placeholder"><p>Loading Workshop…</p></div>';
  import('./workshop/index.js').then(({ mountWorkshop: mw }) => {
    try {
      mount.innerHTML = '';
      workshopInstance = mw(mount, {
        segments,
        editorialFocus: $('#editorial-focus')?.value || '',
        narrativeSummary: currentSummary || '',
        initialState: workshopState || {},
        onUpdate: (newState) => {
          workshopState = newState;
          debouncedAutoSave();
        },
      });
    } catch (err) {
      console.error('Workshop mount failed:', err);
      mount.innerHTML = `<div class="workshop-placeholder"><p style="color:var(--np-red);">Workshop failed to mount.</p><pre style="font-size:11px;color:var(--np-sepia);background:rgba(221,44,30,0.06);padding:12px;border:1px solid var(--np-red);border-radius:2px;text-align:left;max-width:600px;margin:12px auto;white-space:pre-wrap;">${escapeHtmlSafe(err?.stack || err?.message || String(err))}</pre></div>`;
    }
  }).catch(err => {
    console.error('Workshop import failed:', err);
    mount.innerHTML = `<div class="workshop-placeholder"><p style="color:var(--np-red);">Could not load Workshop module.</p><pre style="font-size:11px;color:var(--np-sepia);background:rgba(221,44,30,0.06);padding:12px;border:1px solid var(--np-red);border-radius:2px;text-align:left;max-width:600px;margin:12px auto;white-space:pre-wrap;">${escapeHtmlSafe(err?.message || String(err))}</pre></div>`;
  });
}

function unmountWorkshop() {
  if (workshopInstance) {
    workshopInstance.destroy();
    workshopInstance = null;
  }
  const mount = $('#workshop-mount');
  if (mount) mount.innerHTML = '';
}

// ── SRT modal (opens from Export menu → Download SRT) ──
function openSrtModal() {
  const modal = $('#srt-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  if (translations.length > 0) {
    syncEditorToTranslations();
    const maxWords = parseInt($('#max-words')?.value || 16);
    const maxDuration = parseInt($('#max-duration')?.value || 5);
    const dismissed = getDismissedSegmentNumbers(editorState);
    srtContent = buildSRT(translations, segments, { maxWords, maxDuration, dismissedSegments: dismissed, hideUnintelligible });
    $('#srt-preview').textContent = srtContent;
  }
}
function closeSrtModal() {
  const modal = $('#srt-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}
document.addEventListener('click', (e) => {
  const closeId = e.target?.dataset?.close;
  if (closeId === 'srt-modal') closeSrtModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#srt-modal')?.classList.contains('hidden')) closeSrtModal();
});

// (Reader view removed — copy-with-timecode now lives in the editor and workshop only.)

// ── Helpers ──
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Speaker toggle ──
btnSpeakerToggle.addEventListener('click', () => {
  showAllSpeakers = !showAllSpeakers;
  renderTranscript();

});

// ── Inline project creation (+ Folder button) ──
btnNewProject.addEventListener('click', () => {
  // Insert an editable row at the top of the library list
  const existing = libraryList.querySelector('.lib-row--new-folder');
  if (existing) return; // already showing
  const row = document.createElement('div');
  row.className = 'lib-row lib-row--new-folder';
  row.innerHTML = `
    <div class="lib-col lib-col--name">
      <span class="lib-icon">&#128193;</span>
      <input class="lib-new-folder-input" type="text" placeholder="Folder name..." autofocus>
    </div>
    <div class="lib-col lib-col--step"></div>
    <div class="lib-col lib-col--date"></div>
    <div class="lib-col lib-col--actions"></div>
  `;
  libraryList.prepend(row);
  const input = row.querySelector('.lib-new-folder-input');
  input.focus();

  let committed = false;
  async function commitFolder() {
    if (committed) return;
    committed = true;
    const name = input.value.trim();
    if (row.parentNode) row.remove();
    if (!name) return;
    try {
      const proj = await createProject({ name });
      projects.push(proj);
      invalidateLibraryCache();
      fetchLibrary(true);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitFolder(); }
    if (e.key === 'Escape') { committed = true; if (row.parentNode) row.remove(); }
  });
  input.addEventListener('blur', commitFolder);
});

// ── Export menu ──
const btnExportMenu = $('#btn-export-menu');
const exportDropdown = $('#export-dropdown');

if (btnExportMenu) {
  btnExportMenu.addEventListener('click', () => {
    exportDropdown.classList.toggle('hidden');
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!btnExportMenu.contains(e.target) && !exportDropdown.contains(e.target)) {
      exportDropdown.classList.add('hidden');
    }
  });

  exportDropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn) return;
    exportDropdown.classList.add('hidden');

    const format = btn.dataset.format;
    switch (format) {
      case 'srt': {
        openSrtModal();
        break;
      }
      case 'premiere': {
        const highlights = editorState ? extractHighlightsFromEditor(editorState) : [];
        const xml = buildPremiereXML(highlights, segments, currentTranscriptName);
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(currentTranscriptName || 'markers').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xml`;
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'premiere-sequence': {
        const seqName = customSequenceName || currentTranscriptName || 'Sacred Sequence';
        const dismissed = editorState ? new Set(getDismissedSegmentNumbers(editorState)) : new Set();
        const xml = buildPremiereSequenceXML({
          sacredSequenceName: seqName,
          outputName: `${currentTranscriptName || 'Selects'} — Cut`,
          segments,
          translations,
          interestVotes,
          dismissedSegments: dismissed,
          fps: 23.976,
        });
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(currentTranscriptName || 'sequence-cut').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xml`;
        a.click();
        URL.revokeObjectURL(url);
        break;
      }
      case 'highlights': {
        const highlights = editorState ? extractHighlightsFromEditor(editorState) : [];
        exportHighlightsPDF(highlights, [], currentTranscriptName);
        break;
      }
      case 'summary': {
        // Will use cached summary if copilot generated one
        const summaryEl = document.querySelector('.summary-content');
        const summaryText = summaryEl?.textContent || 'No summary generated. Use the AI Copilot to generate a summary first.';
        exportSummaryText(summaryText, currentTranscriptName);
        break;
      }
    }
  });
}

// ── Auto Summary ──
function parseSummaryBullets(rawText) {
  if (!rawText) return [];
  const lines = rawText.split('\n');
  const bullets = [];
  let id = 0;
  // Track current section's segment range (from headers like **Title (Segments 15-18)**)
  let sectionSegStart = null;
  let sectionSegEnd = null;
  let sectionTitle = null;
  let sectionTitleEnriched = null;

  for (const line of lines) {
    // Check for section header (bold or markdown heading)
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      // Clean header text: strip ** and ## prefixes
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      sectionTitleEnriched = null; // will be set during enriched text pass

      const headerSegMatch = line.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
      if (headerSegMatch) {
        sectionSegStart = parseInt(headerSegMatch[1] || headerSegMatch[3]);
        sectionSegEnd = parseInt(headerSegMatch[2] || headerSegMatch[4] || headerSegMatch[1] || headerSegMatch[3]);
      }
      continue;
    }

    // Match bullet lines starting with "- ", "N. ", or "• "
    const bulletMatch = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1];
    // Check for per-bullet segment refs: (Segments X-Y), (Segment X), [X-Y], [X]
    const bulletSegMatch = text.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
    let segStart, segEnd;
    if (bulletSegMatch) {
      segStart = parseInt(bulletSegMatch[1] || bulletSegMatch[3]);
      segEnd = parseInt(bulletSegMatch[2] || bulletSegMatch[4] || bulletSegMatch[1] || bulletSegMatch[3]);
    } else {
      // Inherit from section header
      segStart = sectionSegStart;
      segEnd = sectionSegEnd;
    }

    bullets.push({ id: id++, rawText: text, enrichedText: '', sectionTitle, segmentStart: segStart, segmentEnd: segEnd });
  }
  return bullets;
}

function attachEnrichedTextToBullets() {
  if (!currentSummary || !summaryBullets.length) return;
  const enrichedLines = currentSummary.split('\n');
  let bulletIdx = 0;
  let currentEnrichedHeader = null;

  for (const line of enrichedLines) {
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      currentEnrichedHeader = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      continue;
    }
    if (line.match(/^(?:[-•]|\d+\.)\s+/) && bulletIdx < summaryBullets.length) {
      summaryBullets[bulletIdx].enrichedText = line.replace(/^(?:[-•]|\d+\.)\s+/, '');
      if (currentEnrichedHeader && summaryBullets[bulletIdx].sectionTitle) {
        summaryBullets[bulletIdx].sectionTitleEnriched = currentEnrichedHeader;
      }
      bulletIdx++;
    }
  }
}

function parseSummaryBulletsFromEnriched(enrichedText) {
  // For pre-existing transcripts with no raw summary — parse bullet structure from
  // enriched text and reverse-map timecodes to segment numbers using the segments array.
  if (!enrichedText) return [];

  // Build reverse map: timecode short form → segment number
  const tcToSeg = {};
  for (const seg of segments) {
    if (seg.number != null && seg.start) {
      const short = fmtShortTimecode(seg.start);
      tcToSeg[short] = seg.number;
    }
  }

  const lines = enrichedText.split('\n');
  const bullets = [];
  let id = 0;
  let sectionSegStart = null;
  let sectionSegEnd = null;

  let sectionTitle = null;

  for (const line of lines) {
    // Check for section header with timecodes like (0:38 – 6:00)
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      const tcMatch = line.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
      if (tcMatch) {
        sectionSegStart = tcToSeg[tcMatch[1]] || null;
        sectionSegEnd = tcToSeg[tcMatch[2]] || null;
      } else {
        const singleTcMatch = line.match(/\((\d+:\d+(?::\d+)?)\)/);
        if (singleTcMatch) {
          sectionSegStart = tcToSeg[singleTcMatch[1]] || null;
          sectionSegEnd = sectionSegStart;
        }
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1];
    // Check for per-bullet timecodes or [X-Y] segment refs
    let segStart = sectionSegStart;
    let segEnd = sectionSegEnd;
    const bulletTcMatch = text.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
    if (bulletTcMatch) {
      segStart = tcToSeg[bulletTcMatch[1]] || segStart;
      segEnd = tcToSeg[bulletTcMatch[2]] || segEnd;
    } else {
      // Also try [X-Y] segment number format
      const bracketMatch = text.match(/\[(\d+)(?:\s*[-–]\s*(\d+))?\]/);
      if (bracketMatch) {
        segStart = parseInt(bracketMatch[1]);
        segEnd = bracketMatch[2] ? parseInt(bracketMatch[2]) : segStart;
      }
    }

    bullets.push({ id: id++, rawText: text, enrichedText: text, sectionTitle, sectionTitleEnriched: sectionTitle, segmentStart: segStart, segmentEnd: segEnd });
  }
  return bullets;
}

function fmtShortTimecode(tc) {
  let secs;
  if (/^\d+(\.\d+)?$/.test(tc)) { secs = parseFloat(tc); }
  else {
    const m = tc.match(/(\d+):(\d+):(\d+)/);
    if (m) secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
    else { const m2 = tc.match(/(\d+):(\d+)/); secs = m2 ? parseInt(m2[1]) * 60 + parseInt(m2[2]) : 0; }
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function enrichSummaryWithTimecodes(text) {
  if (!text || !segments.length) return text;

  // Build a map: segment number → start timecode
  const segTimecodes = {};
  for (const seg of segments) {
    if (seg.number != null && seg.start) {
      segTimecodes[seg.number] = seg.start;
    }
  }

  // Format a timecode value to short form (M:SS or H:MM:SS)
  function fmtShort(tc) {
    let secs;
    if (/^\d+(\.\d+)?$/.test(tc)) {
      secs = parseFloat(tc);
    } else {
      const m = tc.match(/(\d+):(\d+):(\d+)/);
      if (m) secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
      else {
        const m2 = tc.match(/(\d+):(\d+)/);
        secs = m2 ? parseInt(m2[1]) * 60 + parseInt(m2[2]) : 0;
      }
    }
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Replace (Segments X-Y) or [X-Y] with (X:XX – Y:YY)
  let result = text.replace(/\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)/gi, (match, startNum, endNum) => {
    const startTc = segTimecodes[parseInt(startNum)];
    if (!startTc) return match;
    const startFmt = fmtShort(startTc);
    if (endNum) {
      const endTc = segTimecodes[parseInt(endNum)];
      const endFmt = endTc ? fmtShort(endTc) : '';
      const range = endFmt ? `${startFmt} – ${endFmt}` : startFmt;
      return `(${range})`;
    }
    return `(${startFmt})`;
  });

  // Also handle [X-Y] bracket format
  result = result.replace(/\[(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (match, startNum, endNum) => {
    const startTc = segTimecodes[parseInt(startNum)];
    if (!startTc) return match;
    const startFmt = fmtShort(startTc);
    if (endNum) {
      const endTc = segTimecodes[parseInt(endNum)];
      const endFmt = endTc ? fmtShort(endTc) : '';
      const range = endFmt ? `${startFmt} – ${endFmt}` : startFmt;
      return `[${range}]`;
    }
    return `[${startFmt}]`;
  });

  return result;
}

async function generateAutoSummary() {
  const loaderId = 'auto-summary';
  try {
    if (!segments || segments.length === 0) {
      console.warn('No segments to summarize');
      return;
    }

    chattyStart(loaderId, SUMMARY_PHRASES);

    // Clear old bullets but keep summary text visible while regenerating
    summaryBullets = [];
    interestVotes = {};
    if (editorInstance) updateEditorInstance();

    const userMessage = buildAutoSummaryPrompt(segments, translations, speakerMap);
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        stream: true,
        system: 'You are an editorial assistant. Generate a concise chronological summary of this interview transcript.',
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      console.error('Summary API returned', res.status, await res.text().catch(() => ''));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              text += event.delta.text;
            }
          } catch {}
        }
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }

    // Store raw text for re-parsing on reload
    rawSummary = text;

    // Parse bullets from raw text BEFORE enrichment
    summaryBullets = parseSummaryBullets(text);

    currentSummary = enrichSummaryWithTimecodes(text);

    // Attach enriched text to each bullet
    attachEnrichedTextToBullets();

    // Update editor with the summary
    if (editorInstance) {
      updateEditorInstance();
    }

    // Save summary in metadata
    autoSave();
  } catch (err) {
    console.error('Auto-summary generation failed:', err);
  } finally {
    chattyEnd(loaderId);
  }
}

// ── Editor ↔ Translations sync ──

function syncEditorToTranslations(onlySegmentNumbers) {
  if (!editorState?.content) return 0;

  const limitSet = onlySegmentNumbers ? new Set(onlySegmentNumbers) : null;

  // Walk editor JSON, collect text per segment number
  const segmentTexts = new Map();

  function walk(node) {
    if (node.type === 'text' && node.marks) {
      // Skip deleted text — it should not appear in SRT output
      if (node.marks.some(m => m.type === 'deleted')) return;
      const segMark = node.marks.find(m => m.type === 'segment');
      if (segMark && segMark.attrs.number != null) {
        const num = segMark.attrs.number;
        if (limitSet && !limitSet.has(num)) return;
        const existing = segmentTexts.get(num) || '';
        segmentTexts.set(num, existing + (node.text || ''));
      }
    }
    if (node.content) {
      for (const child of node.content) walk(child);
    }
  }
  walk(editorState);

  // Update translations array
  let synced = 0;
  for (const [num, text] of segmentTexts) {
    const t = translations.find(t => t.number === num);
    if (t) {
      const trimmed = text.trim();
      if (t.translated !== trimmed) {
        t.translated = trimmed;
        synced++;
      }
    }
  }

  // Clear cached SRT so it regenerates fresh
  srtContent = '';
  if (!limitSet) editorDirty = false;

  // Update dirty indicator on sync button
  updateSyncDirtyIndicator();

  return synced;
}

// Replace the text of a segment range with `fullText`, distributing words
// across the segments proportional to their original durations. Used when
// the user pastes a polished rewrite over multiple segments — the paste
// kills the segment marks, so a normal Sync would lose the new text. This
// recovers it by treating the whole selection as the new content for the
// covered segment range and re-attaching the timing.
function smartSyncSelection(segNums, fullText) {
  if (!Array.isArray(segNums) || segNums.length === 0) return 0;
  const cleanText = (fullText || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return 0;

  const min = Math.min(...segNums);
  const max = Math.max(...segNums);

  const targetSegs = [];
  for (let n = min; n <= max; n++) {
    const seg = segments.find(s => s.number === n);
    if (!seg) continue;
    const startSec = parseTimecodeToSeconds(seg.start);
    const endSec = parseTimecodeToSeconds(seg.end);
    const dur = Math.max(0.001, endSec - startSec);
    targetSegs.push({ number: n, duration: dur });
  }
  if (targetSegs.length === 0) return 0;

  const totalDur = targetSegs.reduce((s, x) => s + x.duration, 0) || 1;
  const words = cleanText.split(' ').filter(Boolean);

  let cursor = 0;
  for (let i = 0; i < targetSegs.length; i++) {
    const isLast = i === targetSegs.length - 1;
    const share = isLast
      ? words.length - cursor
      : Math.max(0, Math.round(words.length * (targetSegs[i].duration / totalDur)));
    const portion = words.slice(cursor, cursor + share).join(' ');
    cursor += share;

    const t = translations.find(t => t.number === targetSegs[i].number);
    if (t) {
      t.translated = portion;
      t.kept_original = false;
    }
  }

  // Regenerate the editor doc so segment marks are re-attached to the
  // new text. This wipes any in-flight edits inside the touched range,
  // which is exactly what we want — the user just rewrote it.
  editorState = buildEditorDocument(
    segments, translations, speakerColors, speakerMap, hiddenSpeakers,
    analysis?.language_map, { hideUnintelligible },
  );
  if (editorInstance) updateEditorInstance();

  srtContent = '';
  editorDirty = false;
  updateSyncDirtyIndicator();
  debouncedAutoSave();

  return targetSegs.length;
}

function showSyncFeedback(count, segNums) {
  const btn = document.querySelector('.editor-sync-btn');
  if (!btn) return;
  const isPartial = Array.isArray(segNums);
  let msg;
  if (count > 0) {
    msg = isPartial ? `Synced ${count} selected` : `Synced ${count} segments`;
  } else {
    msg = 'Already in sync';
  }
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Sync';
    btn.disabled = false;
  }, 2000);
}

function updateSyncDirtyIndicator() {
  if (editorInstance) {
    updateEditorInstance();
  }
}

// ── Copilot helpers ──

function updateEditorStateJSON(doc, segmentNumbers, newText) {
  const nums = Array.isArray(segmentNumbers) ? segmentNumbers : [segmentNumbers];
  const numSet = new Set(nums);
  const updated = JSON.parse(JSON.stringify(doc));
  let isFirst = true;

  function walk(node) {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === 'segment' && numSet.has(mark.attrs.number)) {
          if (isFirst) {
            node.text = newText + ' ';
            // Extend end time to cover all replaced segments
            if (nums.length > 1) {
              const lastNum = nums[nums.length - 1];
              findEndTime(updated, lastNum, mark);
            }
            isFirst = false;
          } else {
            node.text = '';
          }
        }
      }
    }
    if (node.content) {
      for (const child of node.content) {
        walk(child);
      }
    }
  }

  // Find the end time of a specific segment number and apply it to the target mark
  function findEndTime(root, segNum, targetMark) {
    function search(node) {
      if (node.marks) {
        for (const m of node.marks) {
          if (m.type === 'segment' && m.attrs.number === segNum && m.attrs.end) {
            targetMark.attrs.end = m.attrs.end;
            return true;
          }
        }
      }
      if (node.content) {
        for (const child of node.content) {
          if (search(child)) return true;
        }
      }
      return false;
    }
    search(root);
  }

  walk(updated);

  // Remove empty text nodes from paragraphs
  function cleanEmpty(node) {
    if (node.content) {
      node.content = node.content.filter(child => {
        cleanEmpty(child);
        if (child.type === 'text' && !child.text) return false;
        return true;
      });
    }
  }
  cleanEmpty(updated);

  return updated;
}

function commitTranslationToEditor(segmentNumbers, newText) {
  const nums = Array.isArray(segmentNumbers) ? segmentNumbers : [segmentNumbers];

  // Update translations array — first segment gets new text, rest cleared
  for (let i = 0; i < nums.length; i++) {
    const t = translations.find(t => t.number === nums[i]);
    if (t) t.translated = i === 0 ? newText : '';
  }

  // Update editor state JSON (handles multi-segment replacement + cleanup)
  if (editorState) {
    editorState = updateEditorStateJSON(editorState, nums, newText);
  }

  // Push to live editor
  if (editorInstance && editorState) {
    updateEditorInstance();
  }

  debouncedAutoSave();
}

// ── Copilot ──
let copilotInstance = null;

function openCopilot(selection) {
  const panel = $('#copilot-panel');
  panel.classList.add('active');

  const editorialFocus = $('#editorial-focus')?.value?.trim() || '';

  const props = {
    selection,
    segments,
    translations,
    speakerMap,
    highlights: [], // extracted from editor state in future
    editorialFocus,
    onClose: () => {
      panel.classList.remove('active');
    },
    onCommitTranslation: (segmentNumber, newText) => {
      commitTranslationToEditor(segmentNumber, newText);
    },
  };

  if (copilotInstance) {
    copilotInstance.update(props);
  } else {
    copilotInstance = mountCopilot($('#copilot-mount'), props);
  }
}

function showError(msg, parentSel) {
  const parent = parentSel ? $(parentSel) : $('#step-1');
  const existing = parent.querySelector('.error-msg');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = msg;
  parent.prepend(div);

  setTimeout(() => div.remove(), 8000);
}

// ── Remember last transcript for auto-reload ──
function rememberLastTranscript(id) {
  try { localStorage.setItem('mcm_last_transcript', id); } catch {}
  setPermalinkHash(id);
}
function getLastTranscript() {
  try { return localStorage.getItem('mcm_last_transcript'); } catch { return null; }
}
function clearLastTranscript() {
  try { localStorage.removeItem('mcm_last_transcript'); } catch {}
}

// ── Reset to upload ──
function resetToUpload() {
  flushPendingSave();
  teardownEditingSession();
  clearLastTranscript();
  clearPermalinkHash();
  clearTimeout(debouncedAutoSaveTimer);
  segments = [];
  analysis = null;
  translations = [];
  srtContent = '';
  currentTranscriptId = null;
  currentTranscriptName = '';
  currentSlug = null;
  speakerColors = {};
  annotations = {};
  speakerMap = {};
  hiddenSpeakers = [];
  customSequenceName = '';
  editorState = null;
  editorDirty = false;
  currentSummary = null;
  rawSummary = null;
  summaryBullets = [];
  interestVotes = {};
  workshopState = null;
  unmountWorkshop();
  wordTimingsMap = null;
  libraryShowing = false;
  const editorMount = document.getElementById('editor-mount');
  if (editorMount) editorMount.innerHTML = '';
  editorInstance = null;
  const uploadPreview = document.getElementById('upload-preview');
  if (uploadPreview) { uploadPreview.classList.add('hidden'); uploadPreview.querySelector('tbody').innerHTML = ''; }
  const analyzeResult = document.getElementById('analyze-result');
  if (analyzeResult) analyzeResult.classList.add('hidden');
  const analyzeLoading = document.getElementById('analyze-loading');
  if (analyzeLoading) analyzeLoading.classList.add('hidden');
  const srtPreview = document.getElementById('srt-preview');
  if (srtPreview) srtPreview.textContent = '';
  const readerMount = document.getElementById('reader-mount');
  if (readerMount) readerMount.innerHTML = '';
  const searchView = document.getElementById('search-view');
  if (searchView) searchView.classList.remove('active');
  const copilotPanel = document.getElementById('copilot-panel');
  if (copilotPanel) copilotPanel.classList.remove('open', 'active');
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = '';
  // Ensure drop zone is visible
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) dropZone.classList.remove('hidden');
  // Hide all panels, library, search
  $$('.panel').forEach(p => p.classList.remove('active'));
  libraryView.classList.remove('active');
  goToStep(1);
}

const btnStartNew = document.getElementById('btn-start-new');
if (btnStartNew) btnStartNew.addEventListener('click', resetToUpload);

const headerLogo = document.getElementById('header-logo');
if (headerLogo) {
  headerLogo.addEventListener('click', (e) => {
    e.preventDefault();
    // Exit sequencer if it's open
    const seqView = document.getElementById('sequencer-view');
    if (seqView && !seqView.classList.contains('hidden')) {
      exitSequencer();
    }
    resetToUpload();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Revision history (Phase 2/3)
// ──────────────────────────────────────────────────────────────────────────
async function openRevisionHistory() {
  if (!currentTranscriptId) return;
  let modal = document.getElementById('revision-history-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'revision-history-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close-history></div>
    <div class="np-modal-card" style="max-width: 640px; max-height: 80vh; display: flex; flex-direction: column;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Version history</h3>
        <button class="np-modal-close" data-close-history aria-label="Close">×</button>
      </div>
      <p style="font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia); margin-bottom: 14px;">Each save writes a snapshot. The 50 most recent are kept. Restoring writes a new snapshot, so the action itself is undoable.</p>
      <div id="revision-list" style="overflow-y: auto; flex: 1; min-height: 0;">
        <div style="padding: 24px; text-align: center; font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia);">Loading…</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-history]').forEach(el => {
    el.addEventListener('click', () => modal.remove());
  });

  try {
    const revisions = await listRevisions(currentTranscriptId, 50);
    renderRevisionList(modal.querySelector('#revision-list'), revisions);
  } catch (err) {
    modal.querySelector('#revision-list').innerHTML = `<div style="padding: 16px; color: var(--np-red); font-family: var(--np-font-mono); font-size: 12px;">Could not load history: ${escapeHtmlSafe(err.message || String(err))}</div>`;
  }
}

function renderRevisionList(container, revisions) {
  if (!revisions || revisions.length === 0) {
    container.innerHTML = '<div style="padding: 16px; font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia);">No revisions yet. Make a save to start the history.</div>';
    return;
  }
  container.innerHTML = revisions.map((r) => {
    const when = new Date(r.created_at);
    const label = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const sourceTag = r.source === 'manual' ? 'manual save'
      : r.source === 'restore' ? 'restored from earlier'
      : r.source === 'conflict-overwrite' ? 'conflict resolution'
      : 'autosave';
    const isThisTab = r.client_id === CLIENT_ID;
    return `
      <div class="revision-row" data-id="${r.id}">
        <div class="revision-when">${escapeHtmlSafe(label)}</div>
        <div class="revision-meta">${escapeHtmlSafe(sourceTag)}${isThisTab ? ' · this tab' : ''}</div>
        <div class="revision-actions">
          <button class="np-button revision-restore">Restore</button>
        </div>
      </div>
    `;
  }).join('');
  container.querySelectorAll('.revision-row').forEach(row => {
    row.querySelector('.revision-restore').addEventListener('click', async () => {
      const id = row.dataset.id;
      if (!confirm('Restore this version? Your current state will be saved as a new revision first.')) return;
      try {
        // Make sure current state is captured first.
        if (saveState === 'dirty') await flushPendingSave();
        const rev = await loadRevision(id);
        applySnapshotPayload(rev.snapshot);
        finishLoadRender({
          ...rev.snapshot,
          id: currentTranscriptId,
          name: currentTranscriptName,
          step: rev.snapshot.step,
        });
        markDirty();
        await runSaveOnce({ source: 'restore' });
        document.getElementById('revision-history-modal')?.remove();
      } catch (err) {
        alert('Restore failed: ' + (err.message || String(err)));
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Realtime sync (Phase 3)
// ──────────────────────────────────────────────────────────────────────────
let realtimeUnsubscribe = null;
let realtimeBoundTranscriptId = null;

function ensureRealtimeSubscription() {
  if (!currentTranscriptId) return;
  if (realtimeBoundTranscriptId === currentTranscriptId && realtimeUnsubscribe) return;
  if (realtimeUnsubscribe) { try { realtimeUnsubscribe(); } catch {} realtimeUnsubscribe = null; }
  realtimeBoundTranscriptId = currentTranscriptId;
  try {
    realtimeUnsubscribe = subscribeToTranscript(currentTranscriptId, handleRemoteUpdate);
  } catch (err) {
    console.warn('[realtime] subscribe failed:', err);
  }
}

function teardownRealtime() {
  if (realtimeUnsubscribe) { try { realtimeUnsubscribe(); } catch {} realtimeUnsubscribe = null; }
  realtimeBoundTranscriptId = null;
}

function handleRemoteUpdate(newRow) {
  if (!newRow || newRow.id !== currentTranscriptId) return;
  // Ignore echoes of our own write.
  if (lastServerUpdatedAt && newRow.updated_at === lastServerUpdatedAt) return;
  // If we're in the middle of saving, also ignore (our reply will arrive shortly).
  if (saveInFlight) return;

  // If our local state is clean, silently fold in the remote version.
  if (saveState === 'clean' || saveState === 'saved') {
    applyTranscriptToState(newRow);
    lastServerUpdatedAt = newRow.updated_at;
    finishLoadRender(newRow);
    setSaveState('saved');
    return;
  }

  // We have unsaved local changes — show a banner letting the user choose.
  showRemoteChangeBanner(newRow);
}

function showRemoteChangeBanner(newRow) {
  let banner = document.getElementById('remote-change-banner');
  if (banner) banner.remove();
  banner = document.createElement('div');
  banner.id = 'remote-change-banner';
  banner.className = 'remote-change-banner';
  const when = newRow.updated_at ? new Date(newRow.updated_at).toLocaleTimeString() : '';
  banner.innerHTML = `
    <div class="remote-change-text">
      <strong>This transcript was updated elsewhere${when ? ' at ' + escapeHtmlSafe(when) : ''}.</strong>
      Your unsaved changes are still here. Choose what to do.
    </div>
    <div class="remote-change-actions">
      <button class="np-button" id="remote-keep-mine">Keep mine</button>
      <button class="np-button np-button--primary" id="remote-reload">Reload theirs</button>
      <button class="np-button" id="remote-dismiss">Dismiss</button>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('remote-keep-mine').addEventListener('click', () => {
    lastServerUpdatedAt = newRow.updated_at; // accept their version as the new baseline
    banner.remove();
    runSaveOnce({ source: 'conflict-overwrite' });
  });
  document.getElementById('remote-reload').addEventListener('click', () => {
    banner.remove();
    handleLoad(currentTranscriptId);
  });
  document.getElementById('remote-dismiss').addEventListener('click', () => {
    // Just hide it. Next save will hit a CONFLICT and the existing
    // conflict modal will surface.
    banner.remove();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Tab lock (Phase 3)
// ──────────────────────────────────────────────────────────────────────────
let lockHeartbeatTimer = null;
let lockBoundTranscriptId = null;
let viewOnly = false;

async function maybeAcquireLock() {
  if (!currentTranscriptId) return;
  // Already holding lock for this transcript?
  if (lockBoundTranscriptId === currentTranscriptId) return;
  // Release any prior lock.
  if (lockBoundTranscriptId && lockHeartbeatTimer) {
    clearInterval(lockHeartbeatTimer); lockHeartbeatTimer = null;
    try { await releaseLock(lockBoundTranscriptId, CLIENT_ID); } catch {}
  }
  lockBoundTranscriptId = null;

  let existing = null;
  try { existing = await checkLock(currentTranscriptId); } catch (err) { console.warn('[lock] check failed:', err); }
  if (existing && existing.holder_id !== CLIENT_ID) {
    const decision = await promptLockConflict(existing);
    if (decision === 'cancel') {
      // Pull back to library — load was probably accidental.
      teardownEditingSession();
      showLibrary();
      return;
    }
    if (decision === 'view-only') {
      viewOnly = true;
      showViewOnlyBanner(existing);
      return;
    }
    // 'take-over' — fall through to upsert below.
  }

  try {
    await acquireLock(currentTranscriptId, CLIENT_ID, CLIENT_LABEL);
    lockBoundTranscriptId = currentTranscriptId;
    lockHeartbeatTimer = setInterval(() => {
      heartbeatLock(currentTranscriptId, CLIENT_ID).catch(() => {});
    }, 30000);
  } catch (err) {
    console.warn('[lock] acquire failed:', err);
  }
}

function teardownEditingSession() {
  teardownRealtime();
  if (lockHeartbeatTimer) { clearInterval(lockHeartbeatTimer); lockHeartbeatTimer = null; }
  if (lockBoundTranscriptId) {
    releaseLock(lockBoundTranscriptId, CLIENT_ID).catch(() => {});
    lockBoundTranscriptId = null;
  }
  viewOnly = false;
  const banner = document.getElementById('view-only-banner');
  if (banner) banner.remove();
  const remoteBanner = document.getElementById('remote-change-banner');
  if (remoteBanner) remoteBanner.remove();
}

function promptLockConflict(lock) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'np-modal';
    const since = lock.last_seen ? new Date(lock.last_seen).toLocaleTimeString() : 'recently';
    const label = lock.holder_label || 'another tab';
    modal.innerHTML = `
      <div class="np-modal-backdrop"></div>
      <div class="np-modal-card" style="max-width: 520px;">
        <div class="np-modal-header"><h3 class="np-modal-title">Open elsewhere</h3></div>
        <p style="font-family: var(--np-font-mono); font-size: 13px; line-height: 1.5; margin-bottom: 14px;">This transcript is being edited from <b>${escapeHtmlSafe(label)}</b> (last active ${escapeHtmlSafe(since)}).</p>
        <p style="font-family: var(--np-font-mono); font-size: 12px; color: var(--np-sepia); line-height: 1.5; margin-bottom: 22px;">Editing in two places at once can cause one tab's changes to overwrite the other's. Pick one:</p>
        <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="np-button" data-decision="cancel">Cancel</button>
          <button class="np-button" data-decision="view-only">View only</button>
          <button class="np-button np-button--primary" data-decision="take-over">Take over</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-decision]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.decision;
        modal.remove();
        resolve(d);
      });
    });
  });
}

function showViewOnlyBanner(lock) {
  const existing = document.getElementById('view-only-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'view-only-banner';
  banner.className = 'view-only-banner';
  const label = lock.holder_label || 'another tab';
  banner.innerHTML = `
    <div class="view-only-text">
      <strong>View only</strong> — this transcript is being edited in ${escapeHtmlSafe(label)}. Your edits will not be saved.
    </div>
    <button class="np-button" id="view-only-takeover">Take over</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('view-only-takeover').addEventListener('click', async () => {
    viewOnly = false;
    banner.remove();
    try { await acquireLock(currentTranscriptId, CLIENT_ID, CLIENT_LABEL); } catch {}
    lockBoundTranscriptId = currentTranscriptId;
    if (!lockHeartbeatTimer) {
      lockHeartbeatTimer = setInterval(() => heartbeatLock(currentTranscriptId, CLIENT_ID).catch(() => {}), 30000);
    }
  });
}

// Release the lock cleanly when the tab closes.
window.addEventListener('beforeunload', () => {
  if (lockBoundTranscriptId) {
    // navigator.sendBeacon would be ideal but Supabase REST needs auth headers
    // we can't easily replicate here. Best-effort fire-and-forget delete.
    try { releaseLock(lockBoundTranscriptId, CLIENT_ID); } catch {}
  }
});

// ── Permalink support ──
function getPermalinkId() {
  const hash = window.location.hash.slice(1); // strip #
  if (!hash) return null;
  // Legacy format: #t=UUID
  const legacyMatch = hash.match(/^t=(.+)/);
  if (legacyMatch) return legacyMatch[1];
  // New format: #slug
  return hash;
}

function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str) || /^local_/.test(str);
}

function setPermalinkHash(slugOrId) {
  if (slugOrId) {
    history.replaceState(null, '', '#' + slugOrId);
  }
}

function clearPermalinkHash() {
  history.replaceState(null, '', window.location.pathname);
}

// ── Share / Copy Link button ──
const btnShare = document.getElementById('btn-share');
if (btnShare) {
  btnShare.addEventListener('click', () => {
    if (!currentTranscriptId) return;
    const permalink = currentSlug || currentTranscriptId;
    setPermalinkHash(permalink);
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      btnShare.textContent = 'Copied!';
      setTimeout(() => { btnShare.textContent = 'Share'; }, 2000);
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Schema migration banner — shown once per session if optional schema
// is missing. Offers a clear pointer to the SQL files instead of letting
// the user discover the gap by running into a confusing error later.
// ──────────────────────────────────────────────────────────────────────────
const SCHEMA_BANNER_DISMISS_KEY = 'mcm_schema_banner_dismissed_v1';

function showSchemaMigrationBanner(status) {
  // If user dismissed at this exact set of missing items, stay quiet.
  try {
    const dismissed = localStorage.getItem(SCHEMA_BANNER_DISMISS_KEY);
    if (dismissed === status.missing.join('|')) return;
  } catch {}

  if (document.getElementById('schema-migration-banner')) return;

  const phase1Items = ['transcripts.slug column', 'transcripts.deleted_at column', 'transcript_aliases table'];
  const phase2Items = ['transcripts.search_text column', 'transcript_revisions table', 'editor_locks table'];
  const needsPhase1 = status.missing.some(m => phase1Items.includes(m));
  const needsPhase2 = status.missing.some(m => phase2Items.includes(m));

  const files = [];
  if (needsPhase1) files.push('supabase-phase1.sql');
  if (needsPhase2) files.push('supabase-phase2.sql');
  const fileList = files.join(' then ');

  const banner = document.createElement('div');
  banner.id = 'schema-migration-banner';
  banner.className = 'schema-migration-banner';
  banner.innerHTML = `
    <div class="schema-banner-text">
      <strong>Database needs a one-time migration.</strong>
      Run <code>${escapeHtmlSafe(fileList)}</code> in your Supabase SQL editor to enable: ${escapeHtmlSafe(status.missing.join(', '))}.
      <span class="schema-banner-note">The app will still work without it — some features (permalinks, version history, locks, full-text search) will be disabled until you run it.</span>
    </div>
    <button class="np-button" id="schema-banner-dismiss">Dismiss</button>
  `;
  document.body.appendChild(banner);
  document.getElementById('schema-banner-dismiss').addEventListener('click', () => {
    try { localStorage.setItem(SCHEMA_BANNER_DISMISS_KEY, status.missing.join('|')); } catch {}
    banner.remove();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Command palette action set. Reads live state on every open so commands
// appear/disappear based on what's actually possible right now (e.g.
// "Translate" only when there's a transcript that hasn't been translated).
// ──────────────────────────────────────────────────────────────────────────
function buildPaletteActions() {
  const has = segments.length > 0;
  const translated = translations.length > 0;
  const onEditor = currentStep === 5;
  const inSequencer = !document.getElementById('sequencer-view')?.classList.contains('hidden');

  const actions = [];

  // ── Save & history ──────────────────────────────────────────────
  if (currentTranscriptId || has) {
    actions.push({
      id: 'save', group: 'File', icon: '\u{1F4BE}', label: 'Save now',
      hotkey: '⌘S', perform: () => manualSave(),
    });
  }
  if (currentTranscriptId) {
    actions.push({
      id: 'history', group: 'File', icon: '\u{1F552}', label: 'Open version history',
      perform: () => openRevisionHistory(),
    });
  }

  // ── Navigation ──────────────────────────────────────────────────
  actions.push({
    id: 'home', group: 'Go', icon: '\u{1F3E0}', label: 'New transcript (home)',
    perform: () => { if (inSequencer) exitSequencer(); resetToUpload(); },
  });
  actions.push({
    id: 'library', group: 'Go', icon: '\u{1F4DA}', label: 'Open library',
    perform: () => { if (inSequencer) exitSequencer(); showLibrary(); },
  });
  actions.push({
    id: 'sequencer', group: 'Go', icon: '\u{1F3AC}', label: 'Open Sacred Sequencer',
    perform: () => showSequencer(),
  });
  if (has && translated) {
    actions.push({
      id: 'go-editor', group: 'Go', icon: '\u{270E}', label: 'Go to Editor',
      perform: () => { goToStep(5); switchView('editor'); },
    });
    actions.push({
      id: 'go-workshop', group: 'Go', icon: '\u{1F527}', label: 'Go to Workshop',
      perform: () => { goToStep(5); switchView('workshop'); },
    });
  }
  for (let s = 1; s <= 5; s++) {
    if (s === currentStep) continue;
    if (s > 1 && !has) continue; // can't jump past upload without a transcript
    const stepNames = ['', 'Upload', 'Analyze', 'Clarify', 'Translate', 'Edit'];
    actions.push({
      id: `step-${s}`, group: 'Go', icon: '·',
      label: `Step ${s} — ${stepNames[s]}`,
      perform: () => goToStep(s),
    });
  }

  // ── Editorial actions ───────────────────────────────────────────
  if (has && !analysis) {
    actions.push({
      id: 'analyze', group: 'Editorial', icon: '\u{1F50D}', label: 'Analyze transcript',
      perform: () => $('#btn-analyze')?.click(),
    });
  }
  if (has && analysis && !translated) {
    actions.push({
      id: 'translate', group: 'Editorial', icon: '\u{1F310}', label: 'Translate transcript',
      perform: () => $('#btn-translate')?.click(),
    });
  }
  if (translated) {
    actions.push({
      id: 'regen-summary', group: 'Editorial', icon: '\u{1F4DD}', label: 'Regenerate summary',
      perform: () => generateAutoSummary(),
    });
  }

  // ── Tools ───────────────────────────────────────────────────────
  if (translated) {
    actions.push({
      id: 'sot-hunter', group: 'Tools', icon: '\u{1F3F9}', label: 'Open SOT Hunter',
      perform: () => {
        setSotHunterVisible(true);
        // The hunter manages its own panel; trigger its toggle button.
        document.getElementById('sot-hunter-toggle')?.click();
      },
    });
  }
  if (has) {
    actions.push({
      id: 'copilot', group: 'Tools', icon: '\u{1F916}', label: 'Open AI Copilot',
      perform: () => openCopilot(null),
    });
  }

  // ── Export ──────────────────────────────────────────────────────
  if (translated) {
    actions.push({
      id: 'export-srt', group: 'Export', icon: '\u{1F4E5}', label: 'Export SRT subtitles',
      perform: () => { goToStep(5); openSrtModal(); },
    });
    actions.push({
      id: 'export-premiere', group: 'Export', icon: '\u{1F39E}', label: 'Export Premiere markers (XML)',
      perform: () => exportFormat('premiere'),
    });
    actions.push({
      id: 'export-premiere-seq', group: 'Export', icon: '\u{1F39E}', label: 'Export Premiere sequence cut (XML)',
      perform: () => exportFormat('premiere-sequence'),
    });
    actions.push({
      id: 'export-highlights', group: 'Export', icon: '\u{1F4C4}', label: 'Export highlights (PDF)',
      perform: () => exportFormat('highlights'),
    });
    actions.push({
      id: 'export-summary', group: 'Export', icon: '\u{1F4C4}', label: 'Export summary (text)',
      perform: () => exportFormat('summary'),
    });
  }

  // ── Library helpers (only useful inside library view) ───────────
  if (libraryShowing) {
    actions.push({
      id: 'lib-refresh', group: 'Library', icon: '\u{21BB}', label: 'Refresh library',
      perform: () => { invalidateLibraryCache(); fetchLibrary(); },
    });
  }

  // ── Share ───────────────────────────────────────────────────────
  if (currentTranscriptId) {
    actions.push({
      id: 'copy-link', group: 'Share', icon: '\u{1F517}', label: 'Copy share link',
      perform: () => $('#btn-share')?.click(),
    });
  }

  // ── Sequencer-specific ──────────────────────────────────────────
  if (inSequencer) {
    actions.push({
      id: 'exit-sequencer', group: 'Go', icon: '«', label: 'Exit Sequencer',
      perform: () => exitSequencer(),
    });
  }

  return actions;
}

// Helper used by export commands above — calls the same handler that the
// export menu items use, so behaviour stays single-sourced.
function exportFormat(format) {
  const item = document.querySelector(`.export-dropdown-item[data-format="${format}"]`);
  if (item) item.click();
}

// ── Init: load projects and auto-reload last transcript ──
//
// Every step is independently try/caught: a single failing init must
// NEVER take down the rest of the app. Console-warns surface what broke
// so we can debug without leaving the user with a frozen page.
function safeInit(name, fn) {
  try { fn(); }
  catch (err) { console.warn(`[init] ${name} failed:`, err); }
}

(async function init() {
  safeInit('sot-hunter', () => {
    initSotHunter({
      getSegments: () => segments,
      getTranslations: () => translations,
    });
    setSotHunterVisible(false);
  });

  safeInit('command-palette', () => {
    initCommandPalette({
      getActions: buildPaletteActions,
      getTranscripts: () => libraryCache?.transcripts || [],
      onJumpToTranscript: (id) => handleLoad(id),
    });
  });

  safeInit('falling-glyphs', () => {
    initFallingGlyphs({
      getButtonRects: () => {
        const rects = [];
        const ids = ['home-library-btn', 'home-sequencer-btn', 'drop-zone'];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) rects.push(r);
        }
        return rects;
      },
    });
    if (currentStep === 1) startFallingGlyphs();
  });

  // Probe schema once at boot. Optional features in db.js will gate
  // themselves based on the result. Banner is shown only if something
  // is missing.
  try {
    const status = await getSchemaStatus();
    if (status?.missing?.length) showSchemaMigrationBanner(status);
  } catch (err) {
    console.warn('Schema probe failed:', err);
  }

  // Migrate localStorage → Supabase in background (non-blocking)
  migrateLocalStorageToSupabase()
    .then(r => { if (r.migrated) console.info(`Migrated ${r.transcripts} transcripts, ${r.projects} projects to Supabase`); })
    .catch(err => console.warn('Migration check failed:', err.message));

  // Only load a transcript if the URL explicitly asks for one. Visiting the
  // bare URL lands on home — no auto-redirect to last-opened, no silent URL
  // rewrite. Refresh-mid-edit still works because the URL already carries
  // the slug/UUID once a transcript is loaded.
  const permalink = getPermalinkId();

  // Load projects and transcript in parallel
  const projectsPromise = listProjects().then(p => { projects = p; }).catch(() => {});

  // Handle #sequencer permalink directly
  if (permalink === 'sequencer') {
    await projectsPromise;
    showSequencer();
    return;
  }

  let loadPromise = Promise.resolve();
  if (permalink) {
    // Try loading by slug first, then by UUID
    loadPromise = (async () => {
      try {
        if (isUUID(permalink)) {
          await handleLoad(permalink);
        } else {
          const t = await loadTranscriptBySlug(permalink);
          await handleLoad(t.id);
        }
        setPermalinkHash(currentSlug || currentTranscriptId);
      } catch (err) {
        console.warn('Permalink load failed:', err.message);
        clearPermalinkHash();
        showError('Could not load shared transcript. It may have been deleted or the database is temporarily unavailable.');
      }
    })();
  }

  await Promise.all([projectsPromise, loadPromise]);
})();
