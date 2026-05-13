import { parseCSV, getStats, cleanSpeakerName, buildSpeakerMap, isGenericSpeaker, getSequenceMetadata } from './csv-parser.js';
import { parseJSON } from './json-parser.js';
import { parseTrintHTML } from './trint-html-parser.js';
import { chattyStart, chattyEnd, SUMMARY_PHRASES } from './chatty-loader.js';
import { formatPreciseTimecode, parseTimecodeToSeconds } from './timecode-utils.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';
import { saveTranscript, updateTranscript, listTranscripts, loadTranscript, loadTranscriptBySlug, isSlugTaken, deleteTranscript, restoreTranscript, permanentlyDeleteTranscript, listDeletedTranscripts, createProject, listProjects, deleteProject, supabaseAvailable, getStorageInfo, migrateLocalStorageToSupabase, isConfigured as isDbConfigured, getInitError as getDbInitError, insertRevision, listRevisions, loadRevision, checkLock, acquireLock, heartbeatLock, releaseLock, releaseLockBeacon, subscribeToTranscript, subscribePresence, searchTranscripts, getSchemaStatus, getMediaUpload, getMediaSignedUrl, updateMediaUpload, listShares, addShare, removeShare, updateShareRole, searchUserProfiles } from './db.js';
import { saveSnapshot, loadSnapshot, clearSnapshot, isSnapshotNewerThan, saveDraftSnapshot, loadDraftSnapshot, clearDraftSnapshot } from './snapshot.js';
import { mountEditor } from './editor/mount.js';
import { buildEditorDocument, getDismissedSegmentNumbers } from './editor/document-builder.js';
import { mountTagSearch } from './tags/mount.js';
import { mountCopilot } from './copilot/mount.js';
import { buildPremiereXML, buildPremiereSequenceXML, buildSacredSequencerXML } from './export/premiere-xml.js';
import { buildPremiereScript } from './export/premiere-script.js';
import { exportHighlightsPDF } from './export/pdf-export.js';
import { exportSummaryText, safeFilename } from './export/summary-export.js';
import { extractHighlightsFromEditor } from './editor/document-builder.js';
import { buildAutoSummaryPrompt } from './copilot/copilot-prompts.js';
import { initSotHunter, setSotHunterVisible } from './sot-hunter.js';
import { initCommandPalette, openCommandPalette } from './command-palette.js';
import { initFallingGlyphs, startFallingGlyphs, stopFallingGlyphs } from './falling-glyphs.js';
import { isMediaFile, uploadMedia, runTranscription } from './upload/media-flow.js';
import { openPreTranscribeDialog, openSpeakerLabelDialog } from './upload/dialogs.js';
import { mountMediaDeck } from './edit/media-deck.js';

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
let mediaDeck = null;         // mounted Trint-style video+waveform deck (when transcript has media)
let currentMediaUploadId = null; // hydrated from transcripts.media_upload_id on load
let pendingTargetLanguage = null;     // user pick from Step 2 language card
let pendingSourceLanguage = null;     // user pick from Step 2 language card
let pendingTranslationEnabled = null; // tri-state: null=unknown, true/false=user chose
let currentTargetLanguage = null;     // hydrated from transcripts.target_language
let currentTranslationEnabled = null; // hydrated from transcripts.translation_enabled
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

// Step 3 (Clarify) is hidden — kept in the array for legacy step IDs.
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
  // URL is the source of truth — make refresh stay on library, not boomerang
  // back into the previously-loaded transcript via its hash.
  setRoute({ kind: 'library' });
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
  bar.innerHTML = `
    <div class="lib-bulk-text">${count} selected</div>
    <button class="np-button" id="lib-bulk-move-btn">Move to…</button>
    <button class="np-button" id="lib-bulk-delete">Delete</button>
    <button class="np-button" id="lib-bulk-clear">Clear</button>
  `;
  document.getElementById('lib-bulk-move-btn').addEventListener('click', () => {
    openMoveToDialog(Array.from(librarySelected));
  });
  document.getElementById('lib-bulk-delete').addEventListener('click', () => bulkDeleteSelected());
  document.getElementById('lib-bulk-clear').addEventListener('click', clearLibrarySelection);
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
    renderSidebarFolders(projectsList || []);
    updateSidebarCounts();
    return;
  }

  libraryEmpty.classList.add('hidden');
  renderBreadcrumb();
  renderSidebarFolders(projectsList || []);
  updateSidebarCounts();

  const rows = [];

  // Sidebar virtual views take precedence over folder navigation.
  if (libraryActiveView === 'starred') {
    const items = (transcripts || []).filter(t => starredSet.has(t.id));
    if (items.length === 0) {
      libraryList.innerHTML = '';
      const emptyEl = document.getElementById('library-empty');
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.querySelector('.lib-empty-title').textContent = 'No starred transcripts.';
        emptyEl.querySelector('.lib-empty-sub').innerHTML = 'Star a transcript via right-click → <kbd>Star</kbd>, or click the outline star on any row.';
      }
      return;
    }
    for (const t of sortTranscripts(items)) rows.push(renderFileRow(t));
  } else if (libraryActiveView === 'recent') {
    const items = [...(transcripts || [])]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 25);
    for (const t of items) rows.push(renderFileRow(t));
  } else if (libraryActiveView === 'trash') {
    // Show ONLY deleted items in trash view.
    const deleted = (deletedTranscripts || []).filter(t => {
      const deletedAt = new Date(t.deleted_at).getTime();
      return Date.now() - deletedAt < 30 * 24 * 60 * 60 * 1000;
    });
    if (deleted.length === 0) {
      libraryList.innerHTML = '';
      const emptyEl = document.getElementById('library-empty');
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.querySelector('.lib-empty-title').textContent = 'Trash is empty.';
        emptyEl.querySelector('.lib-empty-sub').textContent = 'Deleted transcripts appear here for 30 days.';
      }
      return;
    }
    rows.push(...deleted.map(t => {
      const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / (24 * 60 * 60 * 1000)));
      return `<div class="lib-row lib-row--deleted" data-id="${t.id}" tabindex="-1">
        <div class="lib-col lib-col--name">
          <span class="lib-row-check-spacer"></span>
          <span class="lib-icon">${ICON_FILE}</span>
          <span class="lib-name lib-name--deleted">${esc(t.name)}</span>
          <span class="lib-deleted-days">${daysLeft}d left</span>
        </div>
        <div class="lib-col lib-col--step"></div>
        <div class="lib-col lib-col--date">${relativeTime(t.deleted_at)}</div>
        <div class="lib-col lib-col--actions">
          <button class="lib-restore-btn" data-id="${t.id}">Restore</button>
          <button class="lib-row-delete" data-id="${t.id}" title="Delete forever">${ICON_X}</button>
        </div>
      </div>`;
    }));
  } else if (!libraryCurrentProject) {
    // ROOT 'all' VIEW: folders first, then unsorted transcripts
    for (const proj of (projectsList || [])) {
      const count = (transcripts || []).filter(t => t.project_id === proj.id).length;
      rows.push(renderFolderRow(proj, count));
    }
    const unsorted = (transcripts || []).filter(t => !t.project_id);
    for (const t of sortTranscripts(unsorted)) rows.push(renderFileRow(t));
  } else {
    // PROJECT 'all' VIEW: transcripts in this project only
    const items = (transcripts || []).filter(t => t.project_id === libraryCurrentProject);
    for (const t of sortTranscripts(items)) rows.push(renderFileRow(t));
  }

  // Recently-deleted is now its own sidebar view ('Trash'); no inline
  // section needed in the All / project / starred / recent views.

  libraryList.innerHTML = rows.join('');
  wireLibraryEvents();
  wireLibraryDragAndDrop();

  // Toggle empty-state placeholder based on whether anything renders.
  const emptyEl = document.getElementById('library-empty');
  if (emptyEl) emptyEl.classList.toggle('hidden', rows.length > 0);
}

// ── Library row icons (SVG, brand-aligned, no emojis) ──
const ICON_FOLDER = `
  <svg class="lib-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
  </svg>`;
const ICON_FILE = `
  <svg class="lib-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
    <path d="M14 3v6h6"/>
    <path d="M8 13h8M8 17h6"/>
  </svg>`;
const ICON_FILE_MEDIA = `
  <svg class="lib-icon-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
    <path d="M14 3v6h6"/>
    <path d="M10 13.5v4l3.5-2z" fill="currentColor"/>
  </svg>`;
const ICON_KEBAB = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>
  </svg>`;
const ICON_X = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6l-12 12"/>
  </svg>`;
const ICON_CHEVRON_RIGHT = `
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6"/>
  </svg>`;

function renderFolderRow(proj, count) {
  return `
    <div class="lib-row lib-row--folder" data-project-id="${proj.id}" data-droppable="true" tabindex="-1">
      <div class="lib-col lib-col--name">
        <span class="lib-row-check-spacer"></span>
        <span class="lib-icon lib-icon--folder">${ICON_FOLDER}</span>
        <span class="lib-name">${esc(proj.name)}</span>
        <span class="lib-count">${count}</span>
      </div>
      <div class="lib-col lib-col--step"></div>
      <div class="lib-col lib-col--date">${relativeTime(proj.created_at)}</div>
      <div class="lib-col lib-col--actions">
        <button class="lib-row-kebab" data-project-id="${proj.id}" title="Folder actions" aria-label="Folder actions">${ICON_KEBAB}</button>
      </div>
    </div>`;
}

// Star icon — outline by default, filled when starred. We just toggle a
// modifier class instead of swapping SVGs.
const ICON_STAR = `
  <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="1.6" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2l3 7 7 .8-5 4.6 1.5 7L12 17.8 5.5 21.4 7 14.4 2 9.8 9 9z"/>
  </svg>`;

// Map step number to a status color band so the user can scan a long list
// at a glance: green = ready (Edit/done), amber = in-progress, red = error.
function statusToneForTranscript(t) {
  if (t.step === 5) return 'ready';
  if (t.step === 4 || t.step === 3 || t.step === 2) return 'progress';
  return 'fresh';
}

// Tiny avatar dot for the library row — shows who last edited (or who
// created if there's no edit attribution yet). Falls back to nothing when
// the row predates the auth migration.
function renderEditorBadge(t) {
  const editor = t.last_edited_by_profile || t.created_by_profile;
  if (!editor) return '';
  const name = editor.display_name || 'User';
  const color = editor.color || '#412c27';
  const initials = name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  const verb = t.last_edited_by_profile ? 'edited by' : 'created by';
  return `<span class="lib-row-editor" title="${esc(verb)} ${esc(name)}" style="background:${esc(color)}">${esc(initials)}</span>`;
}

function renderFileRow(t) {
  const isActive = t.id === currentTranscriptId;
  const stepLabel = STEP_LABELS[t.step] || 'Upload';
  const tone = statusToneForTranscript(t);
  const isChecked = librarySelected.has(t.id);
  const hasMedia  = !!t.media_upload_id;
  const icon = hasMedia ? ICON_FILE_MEDIA : ICON_FILE;
  const starred = isStarred(t.id);
  return `
    <div class="lib-row lib-row--file ${isActive ? 'lib-row--active' : ''} ${isChecked ? 'lib-row--checked' : ''} ${hasMedia ? 'lib-row--media' : ''} ${starred ? 'lib-row--starred' : ''}"
         data-id="${t.id}" data-project-id="${t.project_id || ''}" draggable="true" tabindex="-1">
      <div class="lib-col lib-col--name">
        <input type="checkbox" class="lib-row-check" data-id="${t.id}" ${isChecked ? 'checked' : ''} aria-label="Select">
        <button class="lib-row-star ${starred ? 'lib-row-star--on' : ''}" data-id="${t.id}" title="${starred ? 'Unstar' : 'Star'}" aria-label="Toggle star">${ICON_STAR}</button>
        <span class="lib-icon lib-icon--file ${hasMedia ? 'lib-icon--media' : ''}">${icon}</span>
        <span class="lib-name" data-id="${t.id}">${esc(t.name)}</span>
      </div>
      <div class="lib-col lib-col--step"><span class="lib-status-dot lib-status-dot--${tone}"></span><span class="lib-step-tag">${stepLabel}</span></div>
      <div class="lib-col lib-col--date">${renderEditorBadge(t)}${relativeTime(t.updated_at)}</div>
      <div class="lib-col lib-col--actions">
        <button class="lib-row-kebab" data-id="${t.id}" title="More actions" aria-label="More actions">${ICON_KEBAB}</button>
      </div>
    </div>`;
}

function renderBreadcrumb() {
  const crumbEl = document.querySelector('.lib-breadcrumb');
  if (!crumbEl) return;
  // Total count for the current view — shown as a quiet right-aligned badge.
  // Folder counts in their own renderFolderRow; this is the toolbar-level
  // 'X transcripts in this view' indicator.
  const transcripts = libraryCache?.transcripts || [];
  const inView = libraryCurrentProject
    ? transcripts.filter(t => t.project_id === libraryCurrentProject).length
    : transcripts.length;

  let html = `<button class="lib-crumb lib-crumb--root" data-id="">My Library</button>`;
  if (libraryCurrentProject) {
    const proj = projects.find(p => p.id === libraryCurrentProject);
    if (proj) {
      html += ` <span class="lib-crumb-sep">&rsaquo;</span> `;
      html += `<span class="lib-crumb--current">${esc(proj.name)}</span>`;
    }
  }
  if (inView > 0) {
    html += `<span class="lib-crumb-count">${inView} transcript${inView === 1 ? '' : 's'}</span>`;
  }
  crumbEl.innerHTML = html;
  crumbEl.querySelector('.lib-crumb--root')?.addEventListener('click', () => {
    libraryCurrentProject = null;
    fetchLibrary(true);
  });
  // Right-click on the current-folder crumb → quick rename / delete.
  const currentCrumb = crumbEl.querySelector('.lib-crumb--current');
  if (currentCrumb && libraryCurrentProject) {
    currentCrumb.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openFolderContextMenu(e.clientX, e.clientY, libraryCurrentProject);
    });
  }
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

// Track last-clicked row id for shift-click range selection.
let libraryLastClickedId = null;

// ── Virtual library views (sidebar) ──
// 'all'     — root shows folders + unsorted; entering a folder shows its files
// 'starred' — only transcripts the user has starred (localStorage)
// 'recent'  — top 25 by updated_at (across all folders)
// 'trash'   — recently-deleted transcripts (already cached as libraryCache.deleted)
let libraryActiveView = 'all';

const STARRED_KEY = 'mcm_starred_v1';
function loadStarred() {
  try { return new Set(JSON.parse(localStorage.getItem(STARRED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveStarred(set) {
  try { localStorage.setItem(STARRED_KEY, JSON.stringify(Array.from(set))); } catch {}
}
let starredSet = loadStarred();

function isStarred(id) { return starredSet.has(id); }
function toggleStar(id) {
  if (starredSet.has(id)) starredSet.delete(id);
  else starredSet.add(id);
  saveStarred(starredSet);
  // Refresh just this row's star icon — or repaint if we're in the Starred view.
  if (libraryActiveView === 'starred') fetchLibrary();
  else {
    const row = libraryList.querySelector(`.lib-row--file[data-id="${id}"]`);
    row?.classList.toggle('lib-row--starred', starredSet.has(id));
    const star = row?.querySelector('.lib-row-star');
    if (star) star.classList.toggle('lib-row-star--on', starredSet.has(id));
    updateSidebarCounts();
  }
}

function updateSidebarCounts() {
  const starredCount = starredSet.size;
  const trashCount = (libraryCache?.deleted || []).length;
  document.querySelectorAll('.lib-nav-count[data-count="starred"]').forEach(el => {
    el.textContent = starredCount > 0 ? String(starredCount) : '';
  });
  document.querySelectorAll('.lib-nav-count[data-count="trash"]').forEach(el => {
    el.textContent = trashCount > 0 ? String(trashCount) : '';
  });
}

// Render the folder list in the sidebar — same data as the inline folder
// rows in the main view, but as a quick-jump nav surface.
function renderSidebarFolders(projectsList) {
  const host = document.querySelector('[data-sidebar-folders]');
  if (!host) return;
  if (!projectsList || projectsList.length === 0) {
    host.innerHTML = '<div class="lib-sidebar-empty">no folders yet</div>';
    return;
  }
  host.innerHTML = projectsList.map(p => {
    const count = (libraryCache?.transcripts || []).filter(t => t.project_id === p.id).length;
    const isCurrent = libraryCurrentProject === p.id && libraryActiveView === 'all';
    return `
      <button class="lib-sidebar-folder ${isCurrent ? 'lib-sidebar-folder--active' : ''}" data-side-folder="${esc(p.id)}" data-droppable="side">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
        <span class="lib-sidebar-folder-name">${esc(p.name)}</span>
        <span class="lib-sidebar-folder-count">${count}</span>
      </button>
    `;
  }).join('');
  host.querySelectorAll('[data-side-folder]').forEach(el => {
    el.addEventListener('click', () => {
      libraryActiveView = 'all';
      libraryCurrentProject = el.dataset.sideFolder;
      updateSidebarActive();
      fetchLibrary();
    });
    // Allow drag-drop transcripts onto sidebar folders too — same handler
    // pattern as the main folder rows.
    el.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types;
      if (!types || !Array.from(types).includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('lib-sidebar-folder--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('lib-sidebar-folder--drop'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('lib-sidebar-folder--drop');
      const fileId = e.dataTransfer.getData('text/plain');
      if (!fileId) return;
      try {
        await updateTranscript(fileId, { projectId: el.dataset.sideFolder });
        invalidateLibraryCache();
        fetchLibrary();
        showSuccess('Moved');
      } catch (err) { showErrorToast(`Move failed: ${err?.message || 'Unknown error'}`); }
    });
  });
}

function updateSidebarActive() {
  document.querySelectorAll('.lib-nav-item').forEach(el => {
    el.classList.toggle('lib-nav-item--active', el.dataset.view === libraryActiveView);
  });
  document.querySelectorAll('.lib-sidebar-folder').forEach(el => {
    const isActive = libraryActiveView === 'all' && libraryCurrentProject === el.dataset.sideFolder;
    el.classList.toggle('lib-sidebar-folder--active', isActive);
  });
}

// Wire sidebar nav-item clicks once at module load (the elements are
// static in index.html so we don't need to re-bind on every render).
function wireSidebarOnce() {
  document.querySelectorAll('.lib-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      libraryActiveView = el.dataset.view || 'all';
      // Switching to a virtual view exits any folder-drilldown.
      if (libraryActiveView !== 'all') libraryCurrentProject = null;
      updateSidebarActive();
      fetchLibrary();
    });
  });
  // Sidebar "+ folder" → forward to the existing toolbar handler.
  document.getElementById('btn-new-project-side')?.addEventListener('click', () => {
    document.getElementById('btn-new-project')?.click();
  });
}

function getVisibleFileRows() {
  return Array.from(libraryList.querySelectorAll('.lib-row--file'))
    .filter(r => r.style.display !== 'none');
}

function wireLibraryEvents() {
  // Star toggles
  libraryList.querySelectorAll('.lib-row-star').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStar(btn.dataset.id);
    });
  });

  // Kebab buttons → open the appropriate context menu (file or folder).
  // Discoverable alternative to right-click for users who don't know about it.
  libraryList.querySelectorAll('.lib-row-kebab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = btn.getBoundingClientRect();
      const x = rect.right;
      const y = rect.bottom + 4;
      // Folder kebab (data-project-id set) vs file kebab (data-id set).
      if (btn.dataset.projectId) {
        openFolderContextMenu(x, y, btn.dataset.projectId);
      } else if (btn.dataset.id) {
        const id = btn.dataset.id;
        if (!librarySelected.has(id)) {
          clearLibrarySelection();
          toggleRowSelection(id, true);
        }
        openFileContextMenu(x, y);
      }
    });
  });

  // ── File row click — opens the transcript by default. Cmd/Ctrl-click
  //    toggles selection without opening. Shift-click extends a range
  //    selection from the last clicked row. Like Drive / Finder. ──
  libraryList.querySelectorAll('.lib-row--file').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.lib-row-delete') ||
          e.target.closest('.lib-row-kebab') ||
          e.target.closest('.lib-row-star') ||
          e.target.closest('.lib-name') ||
          e.target.closest('.lib-row-check')) return;

      const id = row.dataset.id;

      // Cmd/Ctrl-click: toggle this row's selection (don't open).
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggleRowSelection(id, !librarySelected.has(id));
        libraryLastClickedId = id;
        return;
      }

      // Shift-click: extend range from last clicked.
      if (e.shiftKey) {
        e.preventDefault();
        applyRangeSelection(libraryLastClickedId || id, id);
        return;
      }

      // Plain click: open. Set as last-clicked for subsequent shift-clicks.
      libraryLastClickedId = id;
      handleLoad(id);
    });

    // Right-click → context menu. We attach to file rows (folders get
    // their own menu in the wiring further down).
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = row.dataset.id;
      // If the row isn't already part of the selection, treat the
      // right-click as a single-row action and clear other selections.
      if (!librarySelected.has(id)) {
        clearLibrarySelection();
        toggleRowSelection(id, true);
      }
      openFileContextMenu(e.clientX, e.clientY);
    });
  });

  // Folder row right-click → folder context menu.
  libraryList.querySelectorAll('.lib-row--folder').forEach(row => {
    row.addEventListener('contextmenu', (e) => {
      // Skip the new-folder edit row.
      if (row.classList.contains('lib-row--new-folder')) return;
      e.preventDefault();
      openFolderContextMenu(e.clientX, e.clientY, row.dataset.projectId);
    });
  });

  // Bulk-select checkboxes.
  libraryList.querySelectorAll('.lib-row-check').forEach(box => {
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      toggleRowSelection(id, e.target.checked);
      libraryLastClickedId = id;
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
      const projectId = btn.dataset.projectId;
      const proj = projects.find(p => p.id === projectId);
      const projName = proj?.name || 'this folder';
      if (!confirm(`Delete folder "${projName}"? Transcripts inside it will move to Unsorted (they aren't deleted).`)) return;
      try {
        await deleteProject(projectId);
        invalidateLibraryCache();
        fetchLibrary();
      } catch (err) {
        console.error('delete project failed:', err);
        showError(`Couldn't delete folder: ${err?.message || 'Unknown error'}`);
      }
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
      try {
        await restoreTranscript(btn.dataset.id);
        invalidateLibraryCache();
        fetchLibrary();
      } catch (err) {
        console.error('restore failed:', err);
        showError(`Couldn't restore transcript: ${err?.message || 'Unknown error'}`);
      }
    });
  });

  // Permanent delete buttons (in deleted section)
  libraryList.querySelectorAll('.lib-row--deleted .lib-row-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Permanently delete this transcript? This cannot be undone.')) return;
      try {
        await permanentlyDeleteTranscript(btn.dataset.id);
        invalidateLibraryCache();
        fetchLibrary();
      } catch (err) {
        console.error('permanent delete failed:', err);
        showError(`Couldn't permanently delete: ${err?.message || 'Unknown error'}`);
      }
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
      // Was fire-and-forget — silently lost the rename if the network blipped
      // and reverted on next load. Now: optimistic UI, but revert + toast on
      // failure so the user sees what happened.
      updateTranscript(id, { name: newName })
        .then(() => { invalidateLibraryCache(); })
        .catch((err) => {
          console.error('rename failed:', err);
          el.textContent = oldName;
          if (id === currentTranscriptId) {
            currentTranscriptName = oldName;
            updateTranscriptTitle();
          }
          showError(`Rename failed: ${err?.message || 'Unknown error'}`);
        });
      if (id === currentTranscriptId) {
        currentTranscriptName = newName;
        updateTranscriptTitle();
      }
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
      try {
        await updateTranscript(fileId, { projectId });
        invalidateLibraryCache();
        fetchLibrary();
      } catch (err) {
        console.error('move failed:', err);
        showError(`Move to folder failed: ${err?.message || 'Unknown error'}`);
      }
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
      try {
        await updateTranscript(fileId, { projectId: null });
        invalidateLibraryCache();
        fetchLibrary();
      } catch (err) {
        console.error('un-assign failed:', err);
        showError(`Move to root failed: ${err?.message || 'Unknown error'}`);
      }
    });
  }
}

// ── Selection helpers ────────────────────────────────────────────────
function toggleRowSelection(id, selected) {
  if (selected) librarySelected.add(id);
  else librarySelected.delete(id);
  // Update DOM without re-rendering.
  const row = libraryList.querySelector(`.lib-row--file[data-id="${id}"]`);
  if (row) {
    row.classList.toggle('lib-row--checked', selected);
    const check = row.querySelector('.lib-row-check');
    if (check) check.checked = selected;
  }
  updateBulkActionBar();
}

function clearLibrarySelection() {
  librarySelected.clear();
  libraryList.querySelectorAll('.lib-row--checked').forEach(r => r.classList.remove('lib-row--checked'));
  libraryList.querySelectorAll('.lib-row-check').forEach(b => { b.checked = false; });
  updateBulkActionBar();
}

function applyRangeSelection(fromId, toId) {
  const rows = getVisibleFileRows();
  const ids = rows.map(r => r.dataset.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a === -1 || b === -1) {
    toggleRowSelection(toId, true);
    return;
  }
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = lo; i <= hi; i++) toggleRowSelection(ids[i], true);
}

// ── Context menus ────────────────────────────────────────────────────
let openContextMenuEl = null;
function closeContextMenu() {
  if (openContextMenuEl && openContextMenuEl.parentNode) {
    openContextMenuEl.parentNode.removeChild(openContextMenuEl);
  }
  openContextMenuEl = null;
}
// Universal close-on-anything-else.
document.addEventListener('mousedown', (e) => {
  if (!openContextMenuEl) return;
  if (!e.target.closest('.context-menu')) closeContextMenu();
}, true);
document.addEventListener('keydown', (e) => {
  if (openContextMenuEl && e.key === 'Escape') closeContextMenu();
});
window.addEventListener('blur', closeContextMenu);

function openContextMenu(x, y, items) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'context-menu-item' + (item.danger ? ' context-menu-item--danger' : '');
    btn.disabled = !!item.disabled;
    btn.innerHTML = `
      <span class="context-menu-icon">${item.icon || ''}</span>
      <span>${esc(item.label)}</span>
      ${item.shortcut ? `<span class="context-menu-shortcut">${esc(item.shortcut)}</span>` : ''}
    `;
    btn.addEventListener('click', () => {
      closeContextMenu();
      try { item.onClick && item.onClick(); } catch (err) { console.error('[ctx-menu]', err); }
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  // Position with viewport clamping.
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, px)}px`;
  menu.style.top = `${Math.max(8, py)}px`;
  openContextMenuEl = menu;
}

function openFileContextMenu(x, y) {
  const ids = Array.from(librarySelected);
  const single = ids.length === 1;
  const focusId = ids[0];
  // Resolve permalink for the focused row (slug if available, falls back to id).
  const focusedRow = single ? (libraryCache?.transcripts || []).find(t => t.id === focusId) : null;
  const permalinkPart = focusedRow?.slug || focusedRow?.id || focusId;
  const allStarred = ids.every(id => starredSet.has(id));
  openContextMenu(x, y, [
    { label: single ? 'Open' : `Open (${ids.length})`, icon: '↗', shortcut: 'Enter',
      onClick: () => single && handleLoad(focusId) },
    { label: 'Open in new tab', icon: '↗', disabled: !single,
      onClick: () => {
        if (!single) return;
        const href = `${window.location.pathname}#${permalinkPart}`;
        window.open(href, '_blank', 'noopener');
      } },
    { separator: true },
    { label: allStarred ? `Unstar${ids.length > 1 ? ` (${ids.length})` : ''}` : `Star${ids.length > 1 ? ` (${ids.length})` : ''}`,
      icon: allStarred ? '★' : '☆',
      onClick: () => {
        if (allStarred) ids.forEach(id => { starredSet.delete(id); });
        else ids.forEach(id => { starredSet.add(id); });
        saveStarred(starredSet);
        if (libraryActiveView === 'starred') fetchLibrary();
        else {
          ids.forEach(id => {
            const row = libraryList.querySelector(`.lib-row--file[data-id="${id}"]`);
            row?.classList.toggle('lib-row--starred', starredSet.has(id));
            const star = row?.querySelector('.lib-row-star');
            if (star) star.classList.toggle('lib-row-star--on', starredSet.has(id));
          });
          updateSidebarCounts();
        }
      } },
    { separator: true },
    { label: 'Rename', icon: '✎', shortcut: 'F2', disabled: !single,
      onClick: () => {
        const nameEl = libraryList.querySelector(`.lib-row--file[data-id="${focusId}"] .lib-name`);
        if (nameEl) startInlineRename(nameEl);
      } },
    { label: `Move to…`, icon: '⇨', shortcut: 'M',
      onClick: () => openMoveToDialog(ids) },
    { label: 'Copy link', icon: '🔗', disabled: !single,
      onClick: async () => {
        try {
          const url = `${window.location.origin}${window.location.pathname}#${permalinkPart}`;
          await navigator.clipboard.writeText(url);
          showSuccess('Link copied');
        } catch (err) {
          showErrorToast(`Couldn't copy link: ${err?.message || 'Unknown error'}`);
        }
      } },
    { separator: true },
    { label: ids.length > 1 ? `Delete ${ids.length} transcripts` : 'Delete', icon: '🗑', danger: true, shortcut: 'Del',
      onClick: () => bulkDeleteSelected() },
  ]);
}

function openFolderContextMenu(x, y, projectId) {
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  openContextMenu(x, y, [
    { label: 'Open folder', icon: '📁',
      onClick: () => { libraryCurrentProject = projectId; fetchLibrary(); } },
    { separator: true },
    { label: 'Rename folder', icon: '✎',
      onClick: () => promptRenameFolder(projectId) },
    { separator: true },
    { label: 'Delete folder', icon: '🗑', danger: true,
      onClick: async () => {
        if (!confirm(`Delete folder "${proj.name}"? Transcripts inside it will move to Unsorted (they aren't deleted).`)) return;
        try {
          await deleteProject(projectId);
          showSuccess(`Folder "${proj.name}" deleted`);
          invalidateLibraryCache();
          fetchLibrary();
        } catch (err) {
          showErrorToast(`Couldn't delete folder: ${err?.message || 'Unknown error'}`);
        }
      } },
  ]);
}

async function promptRenameFolder(projectId) {
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  const next = window.prompt(`Rename folder "${proj.name}":`, proj.name);
  if (next == null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === proj.name) return;
  try {
    // Inline import — keep DB layer stable.
    const { updateProject } = await import('./db.js');
    await updateProject(projectId, { name: trimmed });
    proj.name = trimmed;
    invalidateLibraryCache();
    fetchLibrary();
    showSuccess(`Renamed to "${trimmed}"`);
  } catch (err) {
    console.error('rename folder failed:', err);
    showErrorToast(`Couldn't rename folder: ${err?.message || 'Unknown error'}`);
  }
}

async function bulkDeleteSelected() {
  const ids = Array.from(librarySelected);
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} transcript${ids.length === 1 ? '' : 's'}? You can restore from Recently Deleted.`)) return;
  try {
    await Promise.all(ids.map(id => deleteTranscript(id)));
    showSuccess(`Deleted ${ids.length} transcript${ids.length === 1 ? '' : 's'}`, {
      action: 'Undo',
      onAction: async () => {
        try {
          await Promise.all(ids.map(id => restoreTranscript(id)));
          invalidateLibraryCache();
          fetchLibrary();
          showSuccess('Restored');
        } catch (err) {
          showErrorToast(`Restore failed: ${err?.message || 'Unknown error'}`);
        }
      },
    });
    librarySelected.clear();
    invalidateLibraryCache();
    await fetchLibrary();
  } catch (err) {
    showErrorToast(`Delete failed: ${err?.message || 'Unknown error'}`);
  }
}

// ── Move-to dialog ───────────────────────────────────────────────────
function openMoveToDialog(ids) {
  if (!ids || ids.length === 0) return;
  closeContextMenu();
  document.getElementById('move-to-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'move-to-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card move-to-card">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Move ${ids.length} transcript${ids.length === 1 ? '' : 's'} to…</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <input type="text" class="move-to-search" placeholder="Search folders…" autofocus>
      <div class="move-to-list" data-list></div>
      <div class="move-to-new">
        <input type="text" data-new-folder placeholder="Or create a new folder…">
        <button class="np-button" data-create-folder>+ Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const listEl = modal.querySelector('[data-list]');
  const searchEl = modal.querySelector('.move-to-search');

  function dismiss() { modal.remove(); }
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', dismiss));
  modal.querySelector('[data-close]')?.addEventListener('click', dismiss);

  function paint(filter = '') {
    const f = filter.trim().toLowerCase();
    const all = [
      { id: null, name: 'Unsorted' },
      ...projects,
    ];
    // Detect each transcript's CURRENT project so we can mark it.
    const currentProjectIds = new Set(ids.map(id => {
      const t = (libraryCache?.transcripts || []).find(x => x.id === id);
      return t?.project_id ?? null;
    }));
    const filtered = all.filter(p => !f || (p.name || '').toLowerCase().includes(f));
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="move-to-empty">No folders match "${esc(filter)}"</div>`;
      return;
    }
    listEl.innerHTML = filtered.map(p => {
      const allCurrent = currentProjectIds.size === 1 && currentProjectIds.has(p.id);
      return `
        <button class="move-to-item ${allCurrent ? 'move-to-item--current' : ''}"
                data-target="${p.id == null ? '__unsorted' : esc(p.id)}"
                ${allCurrent ? 'disabled' : ''}>
          <span>${p.id == null ? '🗂' : '📁'}</span>
          <span>${esc(p.name)}</span>
          ${allCurrent ? '<span style="margin-left:auto;font-size:11px;color:var(--np-sepia);">already here</span>' : ''}
        </button>
      `;
    }).join('');
    listEl.querySelectorAll('.move-to-item').forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener('click', async () => {
        const target = btn.dataset.target;
        const projectId = target === '__unsorted' ? null : target;
        await applyMove(ids, projectId);
        dismiss();
      });
    });
  }
  paint('');
  searchEl.addEventListener('input', () => paint(searchEl.value));

  // Create-new-folder inline.
  const newFolderInput = modal.querySelector('[data-new-folder]');
  const createBtn = modal.querySelector('[data-create-folder]');
  async function commitNewFolder() {
    const name = newFolderInput.value.trim();
    if (!name) return;
    try {
      const proj = await createProject({ name });
      projects.push(proj);
      await applyMove(ids, proj.id);
      dismiss();
    } catch (err) {
      showErrorToast(`Couldn't create folder: ${err?.message || 'Unknown error'}`);
    }
  }
  createBtn.addEventListener('click', commitNewFolder);
  newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitNewFolder(); }
  });
}

async function applyMove(ids, projectId) {
  // Optimistic: update the local cache first so the row appears in the new
  // folder immediately; revert on failure.
  const prior = new Map();
  if (libraryCache?.transcripts) {
    for (const t of libraryCache.transcripts) {
      if (ids.includes(t.id)) {
        prior.set(t.id, t.project_id ?? null);
        t.project_id = projectId;
      }
    }
  }
  try {
    await Promise.all(ids.map(id => updateTranscript(id, { projectId })));
    invalidateLibraryCache();
    await fetchLibrary();
    librarySelected.clear();
    const folderName = projectId ? (projects.find(p => p.id === projectId)?.name || 'folder') : 'Unsorted';
    showSuccess(`Moved ${ids.length} to ${folderName}`, {
      action: 'Undo',
      onAction: async () => {
        try {
          await Promise.all([...prior.entries()].map(([id, pid]) => updateTranscript(id, { projectId: pid })));
          invalidateLibraryCache();
          fetchLibrary();
          showSuccess('Move undone');
        } catch (err) {
          showErrorToast(`Undo failed: ${err?.message || 'Unknown error'}`);
        }
      },
    });
  } catch (err) {
    // Revert local cache.
    if (libraryCache?.transcripts) {
      for (const t of libraryCache.transcripts) {
        if (prior.has(t.id)) t.project_id = prior.get(t.id);
      }
    }
    showErrorToast(`Move failed: ${err?.message || 'Unknown error'}`);
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
  currentMediaUploadId = t.media_upload_id || null;
  currentTargetLanguage = t.target_language || null;
  currentTranslationEnabled = (typeof t.translation_enabled === 'boolean') ? t.translation_enabled : null;
  // Reset pending* — they're only set during the current session's flow.
  pendingMediaUploadId = null;
  pendingTargetLanguage = null;
  pendingSourceLanguage = null;
  pendingTranslationEnabled = null;
  // Reset metadata-derived globals so transcript-A's summary/votes/workshop
  // can't bleed into transcript-B and get autosaved into B's row. The
  // 'fall back to server metadata' logic in finishLoadRender will repopulate
  // them from t.metadata if present.
  currentSummary = null;
  rawSummary = null;
  summaryBullets = [];
  interestVotes = {};
  workshopState = null;
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
  // Media link + project + translate prefs — without these, snapshot recovery
  // silently drops the media file association (no video deck) and the user's
  // language/project picks. Critical for the mid-upload-save-failure path.
  if (payload.mediaUploadId !== undefined) currentMediaUploadId = payload.mediaUploadId || null;
  if (payload.projectId !== undefined) currentProjectId = payload.projectId || null;
  if (payload.targetLanguage !== undefined) currentTargetLanguage = payload.targetLanguage || null;
  if (payload.translationEnabled !== undefined) currentTranslationEnabled = !!payload.translationEnabled;
  if (payload.step !== undefined && Number.isFinite(payload.step)) currentStep = payload.step;
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
    const isDirty = !!snap.dirty;
    const heading = isDirty ? 'Unsaved work recovered' : 'Newer local copy found';
    const explanation = isDirty
      ? `Your browser has unsaved work for <b>${escapeHtmlSafe(serverRow.name)}</b> that never reached the cloud — likely because the last save attempt failed or the tab closed before it finished. Restore to recover the work.`
      : `Your browser has a newer snapshot of <b>${escapeHtmlSafe(serverRow.name)}</b> than the cloud. This usually means a previous save didn't reach the server.`;
    modal.innerHTML = `
      <div class="np-modal-backdrop"></div>
      <div class="np-modal-card" style="max-width: 540px;">
        <div class="np-modal-header">
          <h3 class="np-modal-title">${heading}</h3>
        </div>
        <p style="font-family: var(--np-font-mono); font-size: 13px; line-height: 1.5; margin-bottom: 14px;">${explanation}</p>
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
        // Tear down BEFORE rendering — finishLoadRender may mount a new
        // media deck via switchView('editor'), and the old teardown order
        // was destroying that fresh deck right after it was created.
        teardownEditingSession();
        applyTranscriptToState(t);
        applySnapshotPayload(snap.payload);
        lastServerUpdatedAt = t.updated_at; // server still on the older version
        rememberLastTranscript(t.id);
        setPermalinkHash(currentSlug || t.id);
        finishLoadRender(t, /*step override*/ undefined);
        ensureRealtimeSubscription();
        maybeAcquireLock();
        markDirty();
        debouncedAutoSave();
        return;
      }
      clearSnapshot(t.id);
    }

    // Same ordering fix on the regular load path: teardown old session first
    // so the freshly-mounted deck/editor in finishLoadRender survive.
    teardownEditingSession();
    applyTranscriptToState(t);
    lastServerUpdatedAt = t.updated_at;
    rememberLastTranscript(t.id);
    // Prefer the slug for the URL (shareable + readable). currentSlug was
    // populated by applyTranscriptToState above. Falls back to id if the
    // transcript has no slug yet.
    setPermalinkHash(currentSlug || t.id);
    finishLoadRender(t);
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
    mediaUploadId: pendingMediaUploadId || currentMediaUploadId || undefined,
    source: (pendingMediaUploadId || currentMediaUploadId) ? 'transcribed' : undefined,
    targetLanguage: pendingTargetLanguage ?? currentTargetLanguage ?? undefined,
    translationEnabled: pendingTranslationEnabled ?? currentTranslationEnabled ?? undefined,
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

// Auto-derived browser/OS string — used as a fallback subtitle when we
// have a user-provided name (e.g. "Brad · Chrome on Mac" in lock prompts).
const CLIENT_DEVICE = (() => {
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

// User identity. Two layers:
//   1. CLIENT_ID — stable per-tab id used to dedupe a user across multiple
//      tabs they might have open. Persists in localStorage.
//   2. Display name + color — sourced from the signed-in user (auth.js
//      currentProfile()). Falls back to a self-attested localStorage name
//      for the dev-mode / pre-auth path (so the existing identity flow
//      still works on local dev with no Supabase Auth provider).
//
// All consumers (insertRevision, presence, locks, speaker rename) call the
// `currentClient*()` helpers below so they always pick up the latest auth
// state without each having to subscribe themselves.
import { currentUser, currentProfile, onAuthChange, signOut as authSignOut, updateDisplayName as authUpdateName } from './auth.js';

const NAME_PALETTE = [
  '#dd2c1e', '#004cff', '#0d5921', '#ffbf00',
  '#6b5ce7', '#e85d04', '#412c27', '#a83279',
];
function pickColorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return NAME_PALETTE[Math.abs(h) % NAME_PALETTE.length];
}
function getStoredUserName() {
  try { return localStorage.getItem('mcm_user_name') || ''; } catch { return ''; }
}
function setStoredUserName(name) {
  try { localStorage.setItem('mcm_user_name', name); } catch {}
  if (presenceChannel) broadcastPresence();
  renderHeaderIdentity();
}

function currentClientName() {
  const prof = currentProfile();
  if (prof?.display_name) return prof.display_name;
  return getStoredUserName();
}
function currentClientLabel() {
  return currentClientName() || CLIENT_DEVICE;
}
function currentClientColor() {
  const prof = currentProfile();
  if (prof?.color) return prof.color;
  const n = currentClientName();
  if (n) return pickColorForName(n);
  return pickColorForName(CLIENT_ID);
}
function currentUserId() {
  return currentUser()?.id || null;
}

// Re-broadcast presence + redraw identity badge whenever auth state shifts.
onAuthChange(() => {
  renderHeaderIdentity();
  if (presenceChannel) broadcastPresence();
});

// Forward declaration — defined later in the file.
let presenceChannel = null;

// Render the user's identity badge in the editor header. Click to open
// dropdown: change display name, change color, sign out.
function renderHeaderIdentity() {
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;
  let host = document.getElementById('header-identity');
  if (!host) {
    host = document.createElement('div');
    host.id = 'header-identity';
    host.className = 'header-identity';
    headerActions.insertBefore(host, headerActions.firstChild);
  }
  const name = currentClientName() || 'Anonymous';
  const color = currentClientColor();
  const initials = name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
  const signedIn = !!currentUser();
  const email = currentUser()?.email || '';
  host.innerHTML = `
    <button class="header-identity-trigger" title="${esc(signedIn ? email : 'Local identity (sign in to sync)')}">
      <span class="header-identity-avatar" style="background:${esc(color)}">${esc(initials)}</span>
      <span class="header-identity-name">${esc(name)}</span>
    </button>
    <div class="header-identity-menu hidden" data-menu>
      <div class="header-identity-menu-head">
        <div class="header-identity-menu-name">${esc(name)}</div>
        ${signedIn ? `<div class="header-identity-menu-email">${esc(email)}</div>` : '<div class="header-identity-menu-email">Local only</div>'}
      </div>
      <button class="header-identity-menu-item" data-act="rename">Change display name</button>
      <button class="header-identity-menu-item" data-act="color">Change color</button>
      ${signedIn ? '<button class="header-identity-menu-item" data-act="password">Change password…</button>' : ''}
      ${signedIn ? '<button class="header-identity-menu-item" data-act="admin">Admin console…</button>' : ''}
      <button class="header-identity-menu-item" data-act="manual-steps">Setup checklist…</button>
      <button class="header-identity-menu-item" data-act="setup-admin">— Just multi-user logins…</button>
      <button class="header-identity-menu-item" data-act="setup-devchat">— Just devchat setup…</button>
      ${signedIn
        ? '<button class="header-identity-menu-item header-identity-menu-item--danger" data-act="signout">Sign out</button>'
        : '<button class="header-identity-menu-item" data-act="signin">Sign in</button>'
      }
    </div>
  `;
  const trigger = host.querySelector('.header-identity-trigger');
  const menu = host.querySelector('[data-menu]');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  // Close on outside click.
  document.addEventListener('click', () => menu.classList.add('hidden'), { once: true });

  host.querySelector('[data-act="rename"]')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    const next = window.prompt('Display name:', currentClientName());
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    if (signedIn) {
      const res = await authUpdateName(trimmed);
      if (res.ok) showSuccess(`Name set to "${trimmed}"`);
      else showErrorToast(res.error || 'Could not update name.');
    } else {
      setStoredUserName(trimmed);
      showSuccess(`Local name set to "${trimmed}"`);
    }
  });

  host.querySelector('[data-act="color"]')?.addEventListener('click', () => {
    menu.classList.add('hidden');
    openColorPicker();
  });

  host.querySelector('[data-act="signout"]')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    await authSignOut();
    if (window.showGate) window.showGate();
  });
  host.querySelector('[data-act="signin"]')?.addEventListener('click', () => {
    menu.classList.add('hidden');
    if (window.showGate) window.showGate();
  });

  host.querySelector('[data-act="password"]')?.addEventListener('click', () => {
    menu.classList.add('hidden');
    openChangePasswordDialog();
  });
  host.querySelector('[data-act="admin"]')?.addEventListener('click', () => {
    menu.classList.add('hidden');
    openAdminConsole();
  });
  host.querySelector('[data-act="manual-steps"]')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    const { openManualStepsModal } = await import('./manual-steps.js');
    openManualStepsModal();
  });
  host.querySelector('[data-act="setup-devchat"]')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    const { openManualStepsModal } = await import('./manual-steps.js');
    openManualStepsModal({ flow: 'devchat' });
  });
  host.querySelector('[data-act="setup-admin"]')?.addEventListener('click', async () => {
    menu.classList.add('hidden');
    const { openManualStepsModal } = await import('./manual-steps.js');
    openManualStepsModal({ flow: 'admin' });
  });
}

// ─── Self-service: change my own password ────────────────────────────
async function openChangePasswordDialog() {
  document.getElementById('password-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'password-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card" style="max-width:380px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Change password</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <input id="pw-new" class="np-textarea" type="password" placeholder="New password"
             autocomplete="new-password" style="min-height:auto;margin-bottom:8px;">
      <input id="pw-confirm" class="np-textarea" type="password" placeholder="Confirm new password"
             autocomplete="new-password" style="min-height:auto;margin-bottom:10px;">
      <button id="pw-submit" class="np-button np-button--primary" style="width:100%;">Update password</button>
      <p id="pw-msg" class="hidden" style="font-family:var(--np-font-mono);font-size:11px;margin-top:10px;padding:6px 10px;border-radius:4px;"></p>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.remove()));
  const auth = await import('./auth.js');
  const newEl = document.getElementById('pw-new');
  const conEl = document.getElementById('pw-confirm');
  const btn   = document.getElementById('pw-submit');
  const msg   = document.getElementById('pw-msg');
  if (window.attachPasswordEye) {
    window.attachPasswordEye(newEl);
    window.attachPasswordEye(conEl);
  }
  newEl.focus();
  function err(text) {
    msg.style.background = 'rgba(221, 44, 30, 0.08)';
    msg.style.color = 'var(--np-red)';
    msg.textContent = text; msg.classList.remove('hidden');
  }
  function ok(text) {
    msg.style.background = 'rgba(13, 89, 33, 0.08)';
    msg.style.color = 'var(--np-green, #0d5921)';
    msg.textContent = text; msg.classList.remove('hidden');
  }
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (newEl.value !== conEl.value) { err('Passwords do not match.'); return; }
    if (newEl.value.length < 4) { err('Password must be at least 4 characters.'); return; }
    btn.disabled = true; btn.textContent = 'Updating…';
    const res = await auth.updatePassword(newEl.value);
    btn.disabled = false; btn.textContent = 'Update password';
    if (res.ok) { ok('Password updated.'); setTimeout(() => modal.remove(), 1200); }
    else err(res.error || 'Could not update.');
  });
}

// ─── Admin Console: list/create/delete/set_password for users ────────
async function openAdminConsole() {
  document.getElementById('admin-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'admin-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card" style="max-width:620px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Admin console — users</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <div class="admin-add-row">
        <input id="admin-add-email" class="np-textarea admin-add-input" type="email"
               placeholder="email@example.com" style="min-height:auto;flex:1;">
        <button id="admin-add-btn" class="np-button np-button--primary">Add user</button>
      </div>
      <p style="font-family:var(--np-font-mono);font-size:11px;color:var(--np-sepia);margin:6px 2px 14px;">
        New users are created with password <code>newpress</code>. They can change it from the avatar menu after signing in.
      </p>
      <div id="admin-users-list" class="admin-users-list">
        <div class="admin-loading">Loading users…</div>
      </div>
      <p id="admin-msg" class="hidden" style="font-family:var(--np-font-mono);font-size:11px;margin-top:12px;padding:6px 10px;border-radius:4px;"></p>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.remove()));

  const msg = document.getElementById('admin-msg');
  function err(text) {
    msg.style.background = 'rgba(221, 44, 30, 0.08)';
    msg.style.color = 'var(--np-red)';
    msg.textContent = text; msg.classList.remove('hidden');
  }
  function ok(text) {
    msg.style.background = 'rgba(13, 89, 33, 0.08)';
    msg.style.color = 'var(--np-green, #0d5921)';
    msg.textContent = text; msg.classList.remove('hidden');
  }

  async function adminCall(action, payload = {}) {
    const auth = await import('./auth.js');
    const token = await auth.getAccessToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch('/api/admin-users', {
      method: 'POST', headers,
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  }

  async function refresh() {
    const list = document.getElementById('admin-users-list');
    list.innerHTML = '<div class="admin-loading">Loading users…</div>';
    try {
      const out = await adminCall('list');
      const users = out.users || [];
      const meId = currentUserId();
      list.innerHTML = users.map(u => {
        const isMe = u.id === meId;
        const last = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : '—';
        return `
          <div class="admin-user-row">
            <div class="admin-user-body">
              <div class="admin-user-email">${esc(u.email || '(no email)')}${isMe ? ' <span class="admin-pill">you</span>' : ''}</div>
              <div class="admin-user-sub">last seen ${esc(last)}</div>
            </div>
            <button class="admin-user-act" data-pw-for="${esc(u.id)}" title="Reset password">reset pw</button>
            ${isMe ? '' : `<button class="admin-user-act admin-user-act--danger" data-del-for="${esc(u.id)}" title="Delete user">delete</button>`}
          </div>
        `;
      }).join('') || '<div class="admin-loading">No users.</div>';

      list.querySelectorAll('[data-pw-for]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.pwFor;
          const pw = window.prompt('New password (default: newpress):', 'newpress');
          if (pw == null) return;
          try {
            await adminCall('set_password', { userId, password: pw });
            ok(`Password reset.`);
          } catch (e) { err(e.message); }
        });
      });
      list.querySelectorAll('[data-del-for]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.delFor;
          if (!confirm('Delete this user permanently?')) return;
          try {
            await adminCall('delete', { userId });
            ok('User deleted.');
            refresh();
          } catch (e) { err(e.message); }
        });
      });
    } catch (e) { err(e.message); }
  }

  document.getElementById('admin-add-btn').addEventListener('click', async () => {
    const inputEl = document.getElementById('admin-add-email');
    const email = inputEl.value.trim();
    if (!email) return;
    try {
      const out = await adminCall('create', { email });
      ok(`Created ${out.user.email}. Password: ${out.defaultPassword || '(custom)'}`);
      inputEl.value = '';
      refresh();
    } catch (e) { err(e.message); }
  });
  document.getElementById('admin-add-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('admin-add-btn').click(); }
  });

  await refresh();
}

// Color picker popup — palette-based for brand consistency.
function openColorPicker() {
  document.getElementById('color-picker-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'color-picker-modal';
  modal.className = 'np-modal';
  const current = currentClientColor();
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card" style="max-width:380px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Pick your color</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <p style="font-family:var(--np-font-mono);font-size:12px;color:var(--np-sepia);margin-bottom:14px;">Used for your avatar, your edits in revision history, and your presence cursor.</p>
      <div class="color-picker-grid">
        ${NAME_PALETTE.map(c => `
          <button class="color-picker-swatch ${c === current ? 'color-picker-swatch--active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.remove()));
  modal.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.color;
      modal.remove();
      if (currentUser()) {
        try {
          const { supabase } = await import('./db.js');
          const { error } = await supabase.from('user_profiles')
            .update({ color, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser().id);
          if (error) throw error;
          // Refresh profile via auth bootstrap.
          const auth = await import('./auth.js');
          // Crude: re-bootstrap to refetch profile.
          await auth.bootstrap();
          renderHeaderIdentity();
          if (presenceChannel) broadcastPresence();
          showSuccess('Color updated');
        } catch (err) {
          showErrorToast(`Couldn't save color: ${err?.message || 'Unknown error'}`);
        }
      } else {
        // Local-only: store color preference in localStorage.
        try { localStorage.setItem('mcm_user_color', color); } catch {}
        renderHeaderIdentity();
        showSuccess('Color updated locally');
      }
    });
  });
}

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

  if (state === 'clean' || state === 'saved') {
    // Reset the error-retry backoff whenever we recover. Defined later in
    // this file; check for existence in case of init order (it's hoisted
    // anyway as a function declaration).
    if (typeof cancelErrorRetry === 'function') cancelErrorRetry();
  }

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
  // Allow dirty marking from any state EXCEPT mid-save (which will end in
  // saved/error/conflict and re-evaluate). Previously, error/conflict states
  // suppressed dirty marking, so subsequent edits after a save failure
  // weren't tracked at all — that was the lost-work bug.
  if (saveState === 'saving') return;
  // In error/conflict, don't downgrade the visible status to "dirty" — the
  // user needs to keep seeing the failure. But DO snapshot the new content
  // to LS so it survives a tab close.
  if (saveState === 'error' || saveState === 'conflict') {
    snapshotDirtyState();
    return;
  }
  setSaveState('dirty');
  snapshotDirtyState();
}

// Mirror current in-memory state to localStorage immediately, with no
// server updatedAt (marks the snapshot as dirty). This is the safety net
// that catches work even when the cloud save path is broken.
//
// Two paths:
//   • currentTranscriptId set → indexed snapshot under mcm_snap_{id}.
//   • currentTranscriptId not set yet (the gap between first upload and
//     the first successful save) → draft snapshot under a fixed key.
//     Recovered on next session start if the user closed the tab before
//     the first save landed.
function snapshotDirtyState() {
  let payload;
  try { payload = gatherState(); }
  catch (err) {
    console.warn('[autosave] gatherState failed:', err);
    return;
  }
  if (currentTranscriptId) {
    try { saveSnapshot(currentTranscriptId, payload, null); }
    catch (err) { console.warn('[autosave] dirty snapshot failed:', err); }
  } else if ((payload.segments || []).length > 0) {
    // Only worth a draft if there's actual content to lose.
    try { saveDraftSnapshot(payload); }
    catch (err) { console.warn('[autosave] draft snapshot failed:', err); }
  }
}

// Public entry points used throughout the app.
function debouncedAutoSave() {
  if (!currentTranscriptId && segments.length === 0) return; // nothing to save
  clearTimeout(debouncedAutoSaveTimer);
  pendingSave = true;
  markDirty();
  // First save (no id yet) fires fast — we want to establish currentTranscriptId
  // ASAP so subsequent edits are protected by the dirty-snapshot recovery path.
  // Without this, a fresh-import-then-tab-close-within-3s loses work entirely.
  const delay = currentTranscriptId ? AUTOSAVE_DEBOUNCE_MS : 500;
  debouncedAutoSaveTimer = setTimeout(() => {
    pendingSave = false;
    debouncedAutoSaveTimer = null;
    runSaveOnce();
  }, delay);
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
  // Hard guard: NEVER create a row when there's nothing to save. This
  // sits outside debouncedAutoSave because manual saves, error retries,
  // conflict-overwrites, draft recovery, and various edge paths all call
  // runSaveOnce directly and used to bypass the empty-state check —
  // which was the source of stray "Untitled — May 11" rows that polluted
  // the library and stuck the URL hash.
  if (!currentTranscriptId && segments.length === 0) {
    setSaveState('clean');
    return;
  }
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

    // Multi-user attribution. Stamp every write with the current auth
    // user. Pre-auth rows keep created_by=NULL; new rows pick up an
    // owner. last_edited_by changes on every save so the library can
    // show "edited by X 2h ago".
    const me = currentUserId();
    let savedRow;
    if (currentTranscriptId) {
      if (me) payload.lastEditedBy = me;
      savedRow = await updateTranscript(currentTranscriptId, payload, { expectedUpdatedAt: lastServerUpdatedAt });
      lastServerUpdatedAt = savedRow.updated_at;
      saveSnapshot(currentTranscriptId, payload, savedRow.updated_at);
    } else {
      const name = currentTranscriptName || generateAutoName();
      payload.name = name;
      const baseSlug = generateSlug(name);
      payload.slug = await ensureUniqueSlug(baseSlug);
      if (me) {
        payload.createdBy = me;
        payload.lastEditedBy = me;
      }
      savedRow = await saveTranscript(payload);
      currentTranscriptId = savedRow.id;
      currentTranscriptName = name;
      currentSlug = savedRow.slug || payload.slug;
      lastServerUpdatedAt = savedRow.updated_at;
      rememberLastTranscript(savedRow.id);
      setPermalinkHash(currentSlug);
      updateTranscriptTitle();
      saveSnapshot(currentTranscriptId, payload, savedRow.updated_at);
      // First save landed — clear the pre-id draft snapshot so we don't
      // offer to recover it on the next session.
      try { clearDraftSnapshot(); } catch {}
      // pending* values were just persisted as part of the new row. Clear
      // them so subsequent autosaves don't keep re-asserting the same
      // mediaUploadId / targetLanguage / etc on every save (P1-11).
      pendingMediaUploadId = null;
      pendingTargetLanguage = null;
      pendingSourceLanguage = null;
      pendingTranslationEnabled = null;
      // Subscribe to remote updates as soon as we have an id.
      ensureRealtimeSubscription();
    }
    // Cheap insurance: write a revision row. Trigger trims to last 50 per transcript.
    insertRevision(currentTranscriptId, payload, {
      source: opts.source || 'autosave',
      clientId: CLIENT_ID,
      clientLabel: currentClientLabel(),
      clientColor: currentClientColor(),
      userId: currentUserId(),
    })
      .catch(err => console.warn('Could not write revision:', err.message));
    setSaveState('saved');
    invalidateLibraryCache();
  } catch (err) {
    console.error('Save failed:', err);
    if (err && err.code === 'CONFLICT') {
      setSaveState('conflict', err);
    } else {
      setSaveState('error', err);
      scheduleErrorRetry();
    }
  } finally {
    saveInFlight = false;
    if (nextSavePending) {
      nextSavePending = false;
      // Tail-call the next save — but only if we're not in an error state
      // (don't auto-retry into the same failure synchronously).
      if (saveState !== 'error' && saveState !== 'conflict') {
        runSaveOnce();
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Error retry with exponential backoff. Without this, a single transient
// failure (network blip, brief outage) leaves the editor permanently stuck
// in 'error' state — exactly the bug that lost a session of work.
// Backoff: 5s, 15s, 30s, 60s, 2min, 5min, then steady at 5min.
// ──────────────────────────────────────────────────────────────────────────
let errorRetryTimer = null;
let errorRetryAttempt = 0;
const ERROR_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000, 300000];

function scheduleErrorRetry() {
  if (errorRetryTimer) return; // already scheduled
  const delay = ERROR_RETRY_DELAYS_MS[Math.min(errorRetryAttempt, ERROR_RETRY_DELAYS_MS.length - 1)];
  errorRetryAttempt++;
  errorRetryTimer = setTimeout(() => {
    errorRetryTimer = null;
    if (saveState === 'error') {
      console.info(`[autosave] retrying after error (attempt ${errorRetryAttempt})`);
      runSaveOnce();
    }
  }, delay);
}

function cancelErrorRetry() {
  if (errorRetryTimer) { clearTimeout(errorRetryTimer); errorRetryTimer = null; }
  errorRetryAttempt = 0;
}

// Note: setSaveState resets errorRetryAttempt directly when entering
// 'saved' or 'clean' (see edit in setSaveState body).

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

// Best-guess source frame rate for export. Newpress shoots 23.976 by
// default. Single place to flip later (or to plumb a real probed value
// from media_uploads.metadata once we extract that on upload).
function getExportFps() {
  return 23.976;
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

// Warn before closing the tab if there is ANY unsaved work — pending,
// in-flight, dirty (debounce window), error (retry pending), or conflict.
// Previously, only pending/in-flight triggered the warning, so a tab
// close after a stuck "Save failed" state would silently lose the work.
// One-shot final flush attempt also fires on hidden visibility (mobile,
// tab swap), since beforeunload is unreliable on mobile browsers.
window.addEventListener('beforeunload', (e) => {
  // Active uploads in the queue: warn before tab close. Closing mid-upload
  // orphans bytes in Storage (no transcript row gets created) and silently
  // wastes the user's bandwidth.
  const activeUploads = uploadQueue && uploadQueue.some(u =>
    u.status === 'uploading' || u.status === 'transcribing' || u.status === 'saving'
  );
  if (
    pendingSave || saveInFlight ||
    saveState === 'dirty' || saveState === 'error' || saveState === 'conflict' ||
    activeUploads
  ) {
    // Best-effort: kick off a final save (fire-and-forget — the browser
    // may not actually wait for it, but on desktop it usually does).
    try { runSaveOnce(); } catch {}
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

// Mobile / tab-swap final flush. visibilitychange fires more reliably
// than beforeunload on iOS Safari and Android Chrome.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (
      pendingSave || saveInFlight ||
      saveState === 'dirty' || saveState === 'error' || saveState === 'conflict'
    ) {
      try { runSaveOnce(); } catch {}
    }
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

// "+ Upload" toolbar button — exits to the upload step where the drop
// zone + file picker live. Faster than navigating via the home button.
$('#btn-new-upload')?.addEventListener('click', () => {
  goToStep(1);
});

// ── Type-ahead jump (Drive-style): when library is showing and no input
// is focused, typing letters jumps to the first row whose name starts with
// the buffer. Buffer resets after 900 ms of inactivity. ──
let typeAheadBuffer = '';
let typeAheadTimer = null;
function typeAheadJump(ch) {
  if (typeAheadTimer) clearTimeout(typeAheadTimer);
  typeAheadBuffer = (typeAheadBuffer + ch).toLowerCase();
  typeAheadTimer = setTimeout(() => { typeAheadBuffer = ''; }, 900);
  const rows = getVisibleFileRows();
  const match = rows.find(row => {
    const name = (row.querySelector('.lib-name')?.textContent || '').toLowerCase();
    return name.startsWith(typeAheadBuffer);
  });
  if (match) {
    clearLibrarySelection();
    toggleRowSelection(match.dataset.id, true);
    libraryLastClickedId = match.dataset.id;
    match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    match.focus({ preventScroll: true });
  }
}

// ── Desktop drag-and-drop directly into the library view: drop a file
// anywhere on the library and we jump to step-1 with that file already
// in the upload pipeline. Saves the user from having to navigate to home
// just to upload. ──
let libraryDragDepth = 0;
function isExternalFileDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // Browsers expose 'Files' on external file drags; internal drags have
  // 'text/plain' (set in wireLibraryDragAndDrop). We only want external.
  return Array.from(types).includes('Files');
}
libraryView.addEventListener('dragenter', (e) => {
  if (!libraryShowing || !isExternalFileDrag(e)) return;
  e.preventDefault();
  libraryDragDepth++;
  libraryView.classList.add('lib-view--drop-target');
});
libraryView.addEventListener('dragover', (e) => {
  if (!libraryShowing || !isExternalFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
libraryView.addEventListener('dragleave', () => {
  libraryDragDepth = Math.max(0, libraryDragDepth - 1);
  if (libraryDragDepth === 0) libraryView.classList.remove('lib-view--drop-target');
});
libraryView.addEventListener('drop', async (e) => {
  if (!libraryShowing || !isExternalFileDrag(e)) return;
  e.preventDefault();
  libraryDragDepth = 0;
  libraryView.classList.remove('lib-view--drop-target');
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length === 0) return;
  // Bulk-friendly: queue everything in the background. The user stays on
  // the library — no forced jump into an upload page or editor — and the
  // floating UploadPanel shows progress per file with cancel/retry/open.
  enqueueFilesForUpload(files);
});

// ── Library-scoped keyboard shortcuts (only fire when library is showing) ──
window.addEventListener('keydown', (e) => {
  if (!libraryShowing) return;
  // Ignore when typing in inputs / textareas / contentEditable.
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;

  // Cmd/Ctrl-A: select all visible files.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    getVisibleFileRows().forEach(row => toggleRowSelection(row.dataset.id, true));
    return;
  }

  // Escape: clear selection.
  if (e.key === 'Escape' && librarySelected.size > 0) {
    e.preventDefault();
    clearLibrarySelection();
    return;
  }

  // Delete / Backspace: delete selection.
  if ((e.key === 'Delete' || e.key === 'Backspace') && librarySelected.size > 0) {
    e.preventDefault();
    bulkDeleteSelected();
    return;
  }

  // Cmd/Ctrl-/ or ⌘F: focus search.
  if ((e.metaKey || e.ctrlKey) && (e.key === '/' || e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    document.getElementById('library-search')?.focus();
    return;
  }

  // M: open Move-to dialog for the current selection.
  if (e.key === 'm' && librarySelected.size > 0 && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openMoveToDialog(Array.from(librarySelected));
    return;
  }

  // N: new folder.
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    btnNewProject?.click();
    return;
  }

  // Enter on a focused row: open the focused selection.
  if (e.key === 'Enter' && librarySelected.size === 1) {
    e.preventDefault();
    const id = Array.from(librarySelected)[0];
    handleLoad(id);
    return;
  }

  // Type-ahead jump: any single printable character (no modifiers) routes
  // to the type-ahead buffer.
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
    typeAheadJump(e.key);
  }
});

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
      // Route through the same code path as body click-to-rename so segments,
      // hiddenSpeakers, and the editor doc all stay consistent and the
      // change actually autosaves.
      const from = speakerMap[rawName] || rawName;
      const to = (newCleanName || '').trim();
      if (!to || to === from) return;
      window.dispatchEvent(new CustomEvent('np-speaker-rename', {
        detail: { from, to },
      }));
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
  // Remember where we came from so exitSequencer can put us back where we
  // expect to land (library if user opened it from library; transcript if
  // user opened it from a transcript; home otherwise).
  if (libraryShowing) sequencerEntryRoute = { kind: 'library' };
  else if (currentTranscriptId) sequencerEntryRoute = { kind: 'transcript', id: currentSlug || currentTranscriptId };
  else sequencerEntryRoute = { kind: 'home' };
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sequencer-view').classList.remove('hidden');
  document.body.style.background = '#0a0526';
  startSeqAurora();
  setPermalinkHash('sequencer');
}

let sequencerEntryRoute = null;

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
  // Return to wherever the user opened the sequencer from. Defaults to
  // home if we never tracked an entry route (e.g. first session, refreshed
  // directly into #sequencer).
  const entry = sequencerEntryRoute || { kind: 'home' };
  sequencerEntryRoute = null;
  if (entry.kind === 'library') {
    setRoute({ kind: 'library' });
    showLibrary();
  } else if (entry.kind === 'transcript' && entry.id) {
    setRoute({ kind: 'transcript', id: entry.id });
    // The transcript view is already mounted (we never tore it down on
    // entering sequencer); just make sure the editor panel is visible.
    if (currentTranscriptId && editorState) { goToStep(5); switchView('editor'); }
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
  a.download = `${safeFilename(outputName)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  a.download = `${safeFilename(outputName)}.xml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  // Guard first — handleFile(undefined) used to throw on file.name when the
  // user cancelled a file picker (input change fires with empty FileList).
  if (!file) return;

  const lower = file.name.toLowerCase();
  const isJSON = lower.endsWith('.json');
  const isCSV  = lower.endsWith('.csv');
  const isHTML = lower.endsWith('.html') || lower.endsWith('.htm');
  const isZIP  = lower.endsWith('.zip');

  // Video / audio: upload to Storage, transcribe via Whisper, populate segments.
  if (isMediaFile(file)) {
    await handleMediaUpload(file);
    return;
  }

  if (!isCSV && !isJSON && !isHTML && !isZIP) {
    showError('Please upload a .csv, .json, .html, .zip — or a video/audio file (mp4, mov, mp3, wav, m4a, webm).');
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

// ──────────────────────────────────────────────────────────────────────────
// Media upload + Whisper transcription flow.
//
// User drops a video/audio file → we upload to Supabase Storage → create
// a media_uploads row → call /api/transcribe (Whisper) → normalize the
// response into the segment shape the rest of the app expects → hand off
// to finishUploadParse.
//
// Progress is surfaced in the existing drop-zone area so the user sees
// what's happening at each stage. For files >25MB we surface a clear
// error pointing at the large-file roadmap (task #8).
// ──────────────────────────────────────────────────────────────────────────
let pendingMediaUploadId = null; // surfaced into the saved transcript row

async function handleMediaUpload(file) {
  // STEP 1: upload to Storage (no transcription yet)
  showMediaProgress({ stage: 'starting', message: `Preparing ${file.name}…` });
  let upload;
  try {
    upload = await uploadMedia(file, {
      projectId: currentProjectId,
      onProgress: (percent) => {
        const pct = Math.round((percent || 0) * 100);
        showMediaProgress({ stage: 'upload', message: `Uploading ${file.name} — ${pct}%`, percent });
      },
    });
  } catch (err) {
    console.error('Upload failed:', err);
    hideMediaProgress();
    showError(err?.message || 'Upload failed.');
    return;
  }

  // STEP 2: pre-transcribe dialog — show stats + language pickers, wait for TRANSCRIBE
  hideMediaProgress();
  let prefs;
  try {
    prefs = await openPreTranscribeDialog({
      filename: file.name,
      sizeBytes: file.size,
      durationSeconds: upload.durationSeconds,
      mimeType: upload.mimeType,
    });
  } catch (cancelled) {
    // User dismissed the dialog. Leave the upload row in 'pending' so
    // they can come back later (Library will show it as un-transcribed).
    return;
  }
  if (!prefs) return;

  // STEP 3: run transcription with the user's language choices
  showMediaProgress({
    stage: 'transcribe',
    message: `Transcribing in ${prefs.sourceLanguageLabel || 'auto-detected language'}…`,
  });
  let result;
  try {
    result = await runTranscription({
      mediaUploadId: upload.mediaUploadId,
      signedUrl: upload.signedUrl,
      sizeBytes: upload.sizeBytes,
      language: prefs.sourceLanguage || undefined,
      prompt: prefs.prompt || undefined,
    });
  } catch (err) {
    console.error('Transcription failed:', err);
    hideMediaProgress();
    showError(err?.message || 'Transcription failed.');
    return;
  }
  hideMediaProgress();

  // Populate state — segments from the transcription, word timings flat.
  segments = result.segments;
  wordTimingsMap = result.wordTimings || null;
  pendingMediaUploadId = upload.mediaUploadId;
  // Also set currentMediaUploadId immediately so mountMediaDeckForCurrent
  // can find the media on the FIRST entry to the editor view. (Before this,
  // the deck only appeared after a page reload because currentMediaUploadId
  // was only hydrated by applyTranscriptToState during a fresh DB load.)
  currentMediaUploadId = upload.mediaUploadId;
  pendingTargetLanguage = prefs.targetLanguage || null;
  pendingTranslationEnabled = !!prefs.targetLanguage;

  // STEP 4: speaker-labeling dialog — for each detected speaker show an
  // inline audio sample player, a label input, and an "ignore" toggle.
  // Pass through if there's only "Speaker 1" and the user wants to skip.
  const speakerLabels = await openSpeakerLabelDialog({
    segments,
    signedUrl: upload.signedUrl,
  }).catch(() => null);

  if (speakerLabels) {
    speakerMap = { ...speakerMap, ...speakerLabels.renames };
    hiddenSpeakers = speakerLabels.hidden;
    // Apply the speakerMap to the segments themselves so the editor
    // renders the new names. The original speaker key stays intact in
    // speakerMap, so subsequent edits can still reach it.
    segments = segments.map(s => ({
      ...s,
      speaker: speakerMap[s.speaker] || s.speaker,
    }));
  } else {
    // User skipped — keep all speakers visible by default (this is the
    // bugfix for the "everything-hidden" empty-editor regression: we no
    // longer auto-add 'Speaker N' to hiddenSpeakers).
    hiddenSpeakers = [];
  }

  // For media uploads we've already set speakerMap/hiddenSpeakers via the
  // speaker-labeling dialog — tell finishUploadParse not to overwrite.
  finishUploadParse({ name: file.name }, { preserveSpeakerState: true });

  // Pre-set the destination step BEFORE the first save lands. For media
  // uploads we know we're going to the editor; setting currentStep here
  // ensures the row is persisted with step=5 on the very first save. Without
  // this, the first save baked in step=1 (the initial state), and a tab
  // close before the second debounced save would land the user back on the
  // upload home page on next reload — confusing and felt like a bounce.
  currentStep = pendingTargetLanguage ? 4 : 5;

  // Wait for the first save to land so currentTranscriptId exists before
  // the next step. Without this, translateSegments / skipToEditor can run
  // against state with no transcript row, and any failure leaves the work
  // un-snapshottable to localStorage (snapshotDirtyState requires an id).
  try { await flushPendingSave(); } catch (err) {
    console.warn('[upload] first-save flush failed; continuing anyway:', err);
  }

  // If the user picked a translate target in the pre-transcribe dialog,
  // run the translate step so we get bilingual segments before entering
  // the editor. Otherwise jump straight to the editor.
  try {
    if (pendingTargetLanguage) startTranslation();
    else skipToEditor();
  } catch (err) {
    console.warn('Post-transcribe step failed:', err);
    try { skipToEditor(); } catch {}
  }
}

function showMediaProgress({ stage, message, percent }) {
  let overlay = document.getElementById('media-progress-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'media-progress-overlay';
    overlay.className = 'media-progress-overlay';
    overlay.innerHTML = `
      <div class="media-progress-card">
        <div class="media-progress-stage" data-progress-stage></div>
        <div class="media-progress-message" data-progress-message></div>
        <div class="media-progress-bar"><div class="media-progress-fill" data-progress-fill></div></div>
        <div class="media-progress-hint" data-progress-hint>safe to keep this tab open in the background — work auto-saves when done</div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('[data-progress-stage]').textContent = stageLabel(stage);
  overlay.querySelector('[data-progress-message]').textContent = message || '';
  const fill = overlay.querySelector('[data-progress-fill]');
  if (typeof percent === 'number' && isFinite(percent)) {
    fill.style.width = Math.round(Math.max(0, Math.min(1, percent)) * 100) + '%';
    fill.style.opacity = '1';
  } else {
    // Indeterminate
    fill.style.width = '40%';
    fill.style.opacity = '0.6';
  }
}

function hideMediaProgress() {
  const overlay = document.getElementById('media-progress-overlay');
  if (overlay) overlay.remove();
}

// ─────────────────────────────────────────────────────────────────────
// BULK UPLOAD QUEUE
//
// Drop one file or twenty — they all flow through here. Items run serially
// (one upload + one transcribe at a time) to avoid hammering Storage and
// the transcription API. The user can keep editing other transcripts or
// click around the library while the queue churns in the background; the
// floating UploadPanel surfaces progress + per-file cancel/retry/open.
//
// Settings for bulk: auto-detect language, no translation, no speaker
// dialog. Defaults that work for the 90% case. The user can tweak language
// per transcript inside the editor afterward.
//
// Each queue item shape:
//   { id, file, status, progress, error?, transcriptId?, transcriptSlug?,
//     mediaUploadId?, abortController? }
//
// status: 'queued' | 'uploading' | 'transcribing' | 'saving' | 'done' | 'error' | 'cancelled'
// ─────────────────────────────────────────────────────────────────────

const uploadQueue = [];
let uploadWorkerActive = false;

function enqueueUpload(file) {
  if (!file) return null;
  // Deduplicate within the current queue by name+size+lastModified —
  // dragging the same batch twice shouldn't duplicate work.
  const dupe = uploadQueue.find(u =>
    u.file && u.file.name === file.name &&
    u.file.size === file.size &&
    u.file.lastModified === file.lastModified &&
    (u.status === 'queued' || u.status === 'uploading' || u.status === 'transcribing' || u.status === 'saving')
  );
  if (dupe) {
    showInfo(`${file.name} is already in the queue.`);
    return dupe.id;
  }
  const id = 'up_' + Math.random().toString(36).slice(2, 10);
  uploadQueue.push({
    id, file,
    status: 'queued',
    progress: 0,
    addedAt: Date.now(),
  });
  renderUploadPanel();
  if (!uploadWorkerActive) runUploadWorker().catch(err => {
    console.error('[upload-worker] crashed:', err);
    uploadWorkerActive = false;
  });
  return id;
}

async function runUploadWorker() {
  uploadWorkerActive = true;
  while (true) {
    const next = uploadQueue.find(u => u.status === 'queued');
    if (!next) break;
    next.status = 'uploading';
    next.progress = 0;
    next.error = null;
    renderUploadPanel();
    try {
      await processBulkUpload(next);
    } catch (err) {
      console.error('[upload-worker] item failed:', next.file?.name, err);
      // Cancellation isn't an error — leave the status set by cancelUpload.
      if (next.status !== 'cancelled') {
        next.status = 'error';
        next.error = err?.message || String(err);
      }
      renderUploadPanel();
    }
  }
  uploadWorkerActive = false;
}

async function processBulkUpload(item) {
  // Non-media files (CSV/JSON/Trint zip): use the existing readText pipeline
  // but route through bulk save so we don't mutate globals.
  if (!isMediaFile(item.file)) {
    item.status = 'transcribing'; // semantically "processing"; reuse the same UI state
    renderUploadPanel();
    await processBulkParseFile(item);
    return;
  }

  // 1) Upload to Storage with progress.
  const upload = await uploadMedia(item.file, {
    projectId: currentProjectId,
    onProgress: (percent) => {
      // Map upload progress to 0–55% of the overall bar.
      item.progress = Math.min(0.55, (percent || 0) * 0.55);
      renderUploadPanel();
    },
  });
  if (item.status === 'cancelled') return;
  item.mediaUploadId = upload.mediaUploadId;
  item.signedUrl = upload.signedUrl;
  item.progress = 0.55;
  item.status = 'transcribing';
  renderUploadPanel();

  // 2) Transcribe — auto-detect language, no translation, no prompt.
  const result = await runTranscription({
    mediaUploadId: upload.mediaUploadId,
    signedUrl: upload.signedUrl,
    sizeBytes: upload.sizeBytes,
    language: undefined,
  });
  if (item.status === 'cancelled') return;
  item.progress = 0.92;
  item.status = 'saving';
  renderUploadPanel();

  // 3) Persist as a fresh transcript row WITHOUT mutating global editor state.
  const row = await bulkSaveTranscript({
    file: item.file,
    upload,
    segments: result.segments || [],
    wordTimings: result.wordTimings || null,
    sourceLanguage: result.sourceLanguage || null,
  });
  item.transcriptId = row.id;
  item.transcriptSlug = row.slug || row.id;
  item.progress = 1;
  item.status = 'done';
  renderUploadPanel();
  invalidateLibraryCache();

  // Surface a toast with an Open button so the user can jump in when ready.
  showSuccess(`${shortName(item.file.name)} transcribed`, {
    duration: 8000,
    action: 'Open',
    onAction: () => handleLoad(row.id),
  });
}

async function processBulkParseFile(item) {
  // Read text + parse via the same parsers used by handleFile, but build the
  // transcript row directly instead of routing through finishUploadParse.
  const file = item.file;
  const lower = file.name.toLowerCase();
  const isZIP  = lower.endsWith('.zip');
  const isHTML = lower.endsWith('.html') || lower.endsWith('.htm');
  const isJSON = lower.endsWith('.json');
  const isCSV  = lower.endsWith('.csv');

  let parsedSegments = [];
  let parsedWordTimings = null;

  if (isZIP) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const { unzipSync, strFromU8 } = await import('fflate');
    const entries = unzipSync(buf, { filter: (f) => /\.html?$/i.test(f.name) && !f.name.startsWith('__MACOSX/') });
    const pick = Object.keys(entries).find(n => /(?:^|\/)index\.html?$/i.test(n))
              || Object.keys(entries).find(n => /\.html?$/i.test(n));
    if (!pick) throw new Error('Zip did not contain an HTML file (Trint Interactive export expected).');
    const html = strFromU8(entries[pick]);
    const result = parseTrintHTML(html);
    parsedSegments = result.segments;
    parsedWordTimings = result.wordTimings;
  } else {
    const content = await file.text();
    if (isHTML || (!isJSON && !isCSV && content.trimStart().startsWith('<'))) {
      const result = parseTrintHTML(content);
      parsedSegments = result.segments;
      parsedWordTimings = result.wordTimings;
    } else if (isJSON || (!isCSV && content.trimStart().startsWith('['))) {
      const result = parseJSON(content);
      parsedSegments = result.segments;
      parsedWordTimings = result.wordTimings;
    } else if (isCSV) {
      parsedSegments = parseCSV(content);
    } else {
      throw new Error('Unsupported file type.');
    }
  }
  item.progress = 0.6;
  renderUploadPanel();

  if (item.status === 'cancelled') return;
  item.status = 'saving';
  renderUploadPanel();

  const row = await bulkSaveTranscript({
    file: item.file,
    upload: null,
    segments: parsedSegments,
    wordTimings: parsedWordTimings,
    sourceLanguage: null,
  });
  item.transcriptId = row.id;
  item.transcriptSlug = row.slug || row.id;
  item.progress = 1;
  item.status = 'done';
  renderUploadPanel();
  invalidateLibraryCache();
  showSuccess(`${shortName(item.file.name)} imported`, {
    duration: 8000,
    action: 'Open',
    onAction: () => handleLoad(row.id),
  });
}

// Build + persist a fresh transcript row from a bulk-uploaded file. Does
// NOT touch any global editor state (segments, speakerMap, currentTranscriptId
// etc.) so multiple bulk uploads don't clobber each other or the current
// open transcript.
async function bulkSaveTranscript({ file, upload, segments: segs, wordTimings, sourceLanguage }) {
  const safeName = (file.name || 'Untitled').replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled';
  const baseSlug = generateSlug(safeName);
  const slug = await ensureUniqueSlug(baseSlug);

  // Speaker setup using existing helpers, scoped locally.
  const speakerMap = buildSpeakerMap(segs);
  const hiddenSpeakers = []; // keep all visible by default for bulk
  const speakerColors = {};   // editor will fill defaults

  const editorDoc = buildEditorDocument(segs, null, speakerColors, speakerMap, hiddenSpeakers, null, {});

  const me = currentUserId();
  const payload = {
    name: safeName,
    slug,
    step: 5,
    segments: segs,
    analysis: null,
    translations: [],
    srtContent: '',
    speakerColors,
    annotations: {},
    speakerMap,
    hiddenSpeakers,
    hideUnintelligible: true,
    customSequenceName: safeName,
    projectId: libraryCurrentProject || currentProjectId || null,
    editorState: editorDoc,
    wordTimings: wordTimings || null,
    mediaUploadId: upload?.mediaUploadId || undefined,
    source: upload ? 'transcribed' : 'imported',
    targetLanguage: undefined,
    translationEnabled: false,
    metadata: {},
    createdBy: me || undefined,
    lastEditedBy: me || undefined,
  };
  return await saveTranscript(payload);
}

function cancelUpload(id) {
  const item = uploadQueue.find(u => u.id === id);
  if (!item) return;
  if (item.status === 'done' || item.status === 'error' || item.status === 'cancelled') {
    // Just remove finished items from the panel.
    const idx = uploadQueue.indexOf(item);
    if (idx >= 0) uploadQueue.splice(idx, 1);
    renderUploadPanel();
    return;
  }
  item.status = 'cancelled';
  renderUploadPanel();
  // Note: we don't actively abort an in-flight Supabase storage upload —
  // the SDK doesn't expose that cleanly. The status flip prevents the
  // worker from saving a transcript row when the upload eventually finishes,
  // and the panel reflects the user's intent immediately.
}

function retryUpload(id) {
  const item = uploadQueue.find(u => u.id === id);
  if (!item) return;
  item.status = 'queued';
  item.progress = 0;
  item.error = null;
  renderUploadPanel();
  if (!uploadWorkerActive) runUploadWorker().catch(err => {
    console.error('[upload-worker] crashed:', err);
    uploadWorkerActive = false;
  });
}

function clearFinishedUploads() {
  for (let i = uploadQueue.length - 1; i >= 0; i--) {
    const s = uploadQueue[i].status;
    if (s === 'done' || s === 'error' || s === 'cancelled') uploadQueue.splice(i, 1);
  }
  renderUploadPanel();
}

function shortName(name, max = 36) {
  if (!name) return '';
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  const base = ext > 0 ? name.slice(0, ext) : name;
  const suffix = ext > 0 ? name.slice(ext) : '';
  const keep = max - suffix.length - 1;
  return base.slice(0, Math.max(8, keep)) + '…' + suffix;
}

function statusLabel(s) {
  switch (s) {
    case 'queued': return 'queued';
    case 'uploading': return 'uploading';
    case 'transcribing': return 'transcribing';
    case 'saving': return 'saving';
    case 'done': return 'ready';
    case 'error': return 'error';
    case 'cancelled': return 'cancelled';
    default: return s;
  }
}

// ── UploadPanel UI: floating card bottom-left, collapsible. ──
let uploadPanelCollapsed = false;
function renderUploadPanel() {
  let host = document.getElementById('upload-panel');
  if (uploadQueue.length === 0) {
    if (host) host.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'upload-panel';
    host.className = 'upload-panel';
    document.body.appendChild(host);
  }
  const inFlight = uploadQueue.filter(u => u.status === 'uploading' || u.status === 'transcribing' || u.status === 'saving' || u.status === 'queued');
  const done = uploadQueue.filter(u => u.status === 'done').length;
  const total = uploadQueue.length;
  const headerLabel = inFlight.length > 0
    ? `Uploading ${total - inFlight.length + 1} of ${total}`
    : `${done} ready · ${total - done} other`;

  host.innerHTML = `
    <div class="upload-panel-header">
      <span class="upload-panel-title">${esc(headerLabel)}</span>
      <div class="upload-panel-header-actions">
        ${(uploadQueue.some(u => u.status === 'done' || u.status === 'error' || u.status === 'cancelled'))
          ? `<button class="upload-panel-clear" data-act="clear" title="Clear finished">Clear</button>` : ''}
        <button class="upload-panel-collapse" data-act="collapse" title="${uploadPanelCollapsed ? 'Expand' : 'Collapse'}">
          ${uploadPanelCollapsed ? '+' : '–'}
        </button>
      </div>
    </div>
    <div class="upload-panel-body" ${uploadPanelCollapsed ? 'hidden' : ''}>
      ${uploadQueue.map(renderUploadRow).join('')}
    </div>
  `;
  // Wire panel-level controls.
  host.querySelector('[data-act="collapse"]').addEventListener('click', () => {
    uploadPanelCollapsed = !uploadPanelCollapsed;
    renderUploadPanel();
  });
  host.querySelector('[data-act="clear"]')?.addEventListener('click', clearFinishedUploads);
  // Per-row actions.
  host.querySelectorAll('[data-upload-row]').forEach(el => {
    const id = el.dataset.uploadRow;
    el.querySelector('[data-act="cancel"]')?.addEventListener('click', () => cancelUpload(id));
    el.querySelector('[data-act="retry"]')?.addEventListener('click', () => retryUpload(id));
    el.querySelector('[data-act="open"]')?.addEventListener('click', () => {
      const item = uploadQueue.find(u => u.id === id);
      if (item?.transcriptId) handleLoad(item.transcriptId);
    });
    el.querySelector('[data-act="dismiss"]')?.addEventListener('click', () => cancelUpload(id));
  });
}

function renderUploadRow(item) {
  const pct = Math.round((item.progress || 0) * 100);
  const isActive = item.status === 'uploading' || item.status === 'transcribing' || item.status === 'saving';
  const isError = item.status === 'error';
  const isDone = item.status === 'done';
  const isCancelled = item.status === 'cancelled';
  const fillStyle = isActive
    ? `width:${pct}%;`
    : isDone ? 'width:100%;' : 'width:0%;';
  return `
    <div class="upload-row upload-row--${item.status}" data-upload-row="${item.id}">
      <div class="upload-row-top">
        <span class="upload-row-name" title="${esc(item.file.name)}">${esc(shortName(item.file.name))}</span>
        <span class="upload-row-status">${esc(statusLabel(item.status))}${isActive ? ' · ' + pct + '%' : ''}</span>
      </div>
      <div class="upload-row-bar"><div class="upload-row-bar-fill" style="${fillStyle}"></div></div>
      ${isError ? `<div class="upload-row-error" title="${esc(item.error || '')}">${esc(item.error || 'Failed.')}</div>` : ''}
      <div class="upload-row-actions">
        ${isDone ? '<button class="upload-row-btn upload-row-btn--primary" data-act="open">Open</button>' : ''}
        ${isError ? '<button class="upload-row-btn" data-act="retry">Retry</button>' : ''}
        ${isActive || item.status === 'queued' ? '<button class="upload-row-btn" data-act="cancel">Cancel</button>' : ''}
        ${(isDone || isError || isCancelled) ? '<button class="upload-row-btn" data-act="dismiss">Dismiss</button>' : ''}
      </div>
    </div>
  `;
}

function stageLabel(stage) {
  switch (stage) {
    case 'starting':   return '01 · prepare';
    case 'upload':     return '02 · upload';
    case 'transcribe': return '03 · transcribe';
    case 'normalize':  return '04 · finalize';
    default:           return '· · ·';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Trint-style media deck mounting (editor view only).
//
// If the current transcript has a media_upload_id, fetch the media row,
// generate a 4-hour signed URL (long enough for an editing session), and
// mount the pinned video player + waveform alongside the editor. The deck
// also wires click-to-seek into the editor and renders highlights as
// regions on the waveform.
// ──────────────────────────────────────────────────────────────────────────
async function mountMediaDeckForCurrent(editorContainer) {
  if (!currentMediaUploadId) return;
  if (mediaDeck) { try { mediaDeck.destroy(); } catch {} mediaDeck = null; }

  let media;
  try { media = await getMediaUpload(currentMediaUploadId); }
  catch (err) {
    console.warn('[media-deck] could not load media row:', err);
    return;
  }
  if (!media || !media.storage_path) return;

  // Prefer the worker-produced H.264 transcode when ready — Chrome can
  // decode it where the original ProRes/MOV/MXF can't. While it's still
  // pending/processing the deck falls back to the original (which usually
  // means audio-only fallback kicks in until the transcode lands).
  const useTranscoded = media.transcode_status === 'done' && media.transcode_path;
  const playbackPath = useTranscoded ? media.transcode_path : media.storage_path;
  const playbackMime = useTranscoded ? 'video/mp4' : (media.mime_type || '');

  const signedUrl = await getMediaSignedUrl(playbackPath, {
    bucket: media.storage_bucket || 'media',
    expiresInSeconds: 4 * 60 * 60, // 4h editing session
  });
  if (!signedUrl) return;

  // If the transcode is still in flight, kick off a poll so the deck swaps
  // to the H.264 version as soon as it lands without needing a page reload.
  if (media.transcode_status === 'pending' || media.transcode_status === 'processing') {
    schedulePostTranscodeRemount(media.id, editorContainer);
  }

  // Pull cached waveform peaks from the media row when present. First-load
  // for this media will be slow (Wavesurfer downloads + decodes the audio
  // to compute peaks); we cache those peaks so subsequent loads paint
  // instantly without waiting for the full audio buffer.
  const cachedPeaks    = media.waveform?.peaks || null;
  const cachedDuration = media.waveform?.duration || media.duration_seconds || null;

  mediaDeck = mountMediaDeck(editorContainer, {
    signedUrl,
    mimeType: playbackMime,
    transcodeStatus: media.transcode_status || 'not_needed',
    segments,
    wordTimings: wordTimingsArray(),
    highlights: currentEditorHighlights(),
    cachedPeaks,
    cachedDuration,
    onSeek: () => {},
    onTimeUpdate: () => {},
    onPeaksReady: ({ peaks, duration }) => {
      // Fire-and-forget persist. Failures are non-fatal — peaks will
      // just be re-computed on the next load.
      updateMediaUpload(media.id, {
        waveform: {
          peaks,
          duration,
          generated_at: new Date().toISOString(),
          // Store enough metadata that we know what produced these peaks
          // and can invalidate later (e.g. if we ever re-encode the file).
          source: 'wavesurfer-export-v7',
          channels: 1,
          maxLength: 4000,
        },
      }).catch(err => console.warn('[media-deck] could not persist peaks:', err));
    },
  });
}

// Poll the media row until transcode_status flips to 'done' (or 'error'),
// then re-mount the deck so playback swaps to the H.264 version. Backs off
// after 20 minutes (a runaway worker shouldn't keep polling forever).
let transcodePollTimer = null;
function schedulePostTranscodeRemount(mediaId, editorContainer) {
  if (transcodePollTimer) { clearInterval(transcodePollTimer); transcodePollTimer = null; }
  const startedAt = Date.now();
  const POLL_MS = 5000;
  const GIVE_UP_MS = 20 * 60 * 1000;
  transcodePollTimer = setInterval(async () => {
    if (Date.now() - startedAt > GIVE_UP_MS) {
      clearInterval(transcodePollTimer); transcodePollTimer = null;
      return;
    }
    if (currentMediaUploadId !== mediaId || !mediaDeck) {
      clearInterval(transcodePollTimer); transcodePollTimer = null;
      return;
    }
    try {
      const fresh = await getMediaUpload(mediaId);
      if (!fresh) return;
      if (fresh.transcode_status === 'done' && fresh.transcode_path) {
        clearInterval(transcodePollTimer); transcodePollTimer = null;
        // Re-mount the deck against the new playable URL.
        try { mediaDeck.destroy(); } catch {}
        mediaDeck = null;
        mountMediaDeckForCurrent(editorContainer).catch(err =>
          console.warn('[transcode-poll] remount failed:', err)
        );
      } else if (fresh.transcode_status === 'error') {
        clearInterval(transcodePollTimer); transcodePollTimer = null;
        console.warn('[transcode-poll] worker reported error:', fresh.transcode_error);
      }
    } catch (err) {
      console.warn('[transcode-poll] check failed:', err);
    }
  }, POLL_MS);
}

// wordTimingsMap can hold one of two shapes:
//   • flat array from Whisper/Deepgram: [{ word, start, end, speaker? }]
//   • legacy segment-keyed object: { segNum: { start, end } }
// This helper returns the flat array if available, else null.
function wordTimingsArray() {
  if (Array.isArray(wordTimingsMap) && wordTimingsMap.length > 0) return wordTimingsMap;
  return null;
}

// Pull current highlights from the editor's in-memory state. The editor's
// document is the source of truth for highlights — the highlights table
// is only persisted on export. So we extract from editorState directly,
// which keeps the waveform regions in lockstep with what the editor shows.
function currentEditorHighlights() {
  if (!editorState) return [];
  try {
    const raw = extractHighlightsFromEditor(editorState) || [];
    // Normalize to the shape media-deck expects: { segmentNumbers, color? }
    return raw.map(h => ({
      segmentNumbers: h.segmentNumbers || h.segment_numbers || [],
      color: h.color || 'rgba(221, 200, 30, 0.35)',
    }));
  } catch (err) {
    console.warn('[media-deck] highlight extract failed:', err);
    return [];
  }
}

// Refresh the waveform regions when highlights change in the editor.
// Throttled because it's wired to onUpdate (every keystroke) and walking
// the editor doc to extract highlights + recreating wavesurfer regions on
// every keypress is wasteful — even with no highlights it's a tree walk.
let highlightRefreshTimer = null;
function refreshMediaDeckHighlights() {
  if (!mediaDeck) return;
  if (highlightRefreshTimer) return; // already scheduled
  highlightRefreshTimer = setTimeout(() => {
    highlightRefreshTimer = null;
    if (!mediaDeck) return;
    try { mediaDeck.setHighlights(currentEditorHighlights()); } catch {}
  }, 250);
}

function finishUploadParse(file, opts = {}) {
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
  // Speaker state: media uploads pass preserveSpeakerState=true because
  // the speaker-labeling dialog already set speakerMap + hiddenSpeakers
  // explicitly. CSV/JSON/Trint imports get the auto-derived defaults.
  if (!opts.preserveSpeakerState) {
    speakerMap = buildSpeakerMap(segments);
    hiddenSpeakers = segments
      .map(s => s.speaker)
      .filter(s => isGenericSpeaker(s))
      .filter((v, i, a) => a.indexOf(v) === i);
  }
  showAllSpeakers = false;
  // Pre-fill sequence name from filename (minus extension)
  customSequenceName = (file?.name || '').replace(/\.(json|csv|html|htm|zip|mp4|mov|webm|mkv|mp3|m4a|wav|ogg|flac)$/i, '');
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
  const files = Array.from(e.dataTransfer.files || []);
  enqueueFilesForUpload(files);
});

dropZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  // Reset value so picking the SAME file(s) twice in a row still fires change
  // — without this, re-selecting (e.g., after fixing a parse error) is a no-op.
  fileInput.value = '';
  enqueueFilesForUpload(files);
});

// Bulk-friendly entry point: send N files into the queue. The queue worker
// runs serially in the background; the UploadPanel surfaces progress + per-
// file cancel/retry/open. Skips the language picker dialog (defaults to
// auto-detect) so dropping 8 files doesn't blast 8 modals at the user.
function enqueueFilesForUpload(files) {
  if (!files || files.length === 0) return;
  // Filter to recognized types; toast for anything we can't handle so the
  // user gets explicit feedback instead of silent drops.
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    if (!f) continue;
    const lower = (f.name || '').toLowerCase();
    const isParseable = lower.endsWith('.csv') || lower.endsWith('.json') ||
                        lower.endsWith('.html') || lower.endsWith('.htm') ||
                        lower.endsWith('.zip');
    if (isMediaFile(f) || isParseable) accepted.push(f);
    else rejected.push(f);
  }
  if (rejected.length > 0) {
    showInfo(`Skipped ${rejected.length} unsupported file${rejected.length === 1 ? '' : 's'} (${shortName(rejected[0].name)}${rejected.length > 1 ? ' …' : ''}).`);
  }
  for (const f of accepted) enqueueUpload(f);
  if (accepted.length > 1) {
    showInfo(`Queued ${accepted.length} files. They'll process in the background — keep working.`);
  }
}

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
  if (btnToClarify) btnToClarify.innerHTML = 'Continue &rarr;';
  populateLanguagePickers();
}

// Populate the source-language dropdown from the analysis (detected
// languages per speaker → flattened set), and pre-select the most
// common source. Also default the target dropdown to the user's
// previously-saved choice when re-entering an existing transcript.
const ISO_LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', zh: 'Chinese (Simplified)',
  ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', ru: 'Russian',
  nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
  pl: 'Polish', tr: 'Turkish', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', uk: 'Ukrainian', cs: 'Czech', el: 'Greek', ro: 'Romanian',
  hu: 'Hungarian', bn: 'Bengali', ur: 'Urdu', fa: 'Persian',
};

function populateLanguagePickers() {
  const sourceSel = document.getElementById('source-language');
  const targetSel = document.getElementById('target-language');
  if (!sourceSel || !targetSel) return;

  // Build the source list: union of (a) the detected languages from
  // analysis.language_map, (b) common ISO-639-1 codes, ordered with
  // detected langs first.
  const detected = new Set();
  if (analysis?.language_map && typeof analysis.language_map === 'object') {
    for (const lang of Object.values(analysis.language_map)) {
      const code = isoCodeFromName(lang);
      if (code) detected.add(code);
    }
  }
  const all = [...detected, ...Object.keys(ISO_LANG_NAMES).filter(c => !detected.has(c))];
  sourceSel.innerHTML = ['<option value="">Auto-detect</option>']
    .concat(all.map(code => `<option value="${code}">${ISO_LANG_NAMES[code] || code}${detected.has(code) ? ' (detected)' : ''}</option>`))
    .join('');

  // Pick the most common detected language as the default source.
  if (detected.size > 0) sourceSel.value = [...detected][0];

  // Honor user's previous target choice on this transcript; otherwise
  // default to "no translation" if source was English (most common case
  // for Johnny — interviews shot in English don't need translation).
  if (currentTargetLanguage) {
    targetSel.value = currentTargetLanguage;
  } else if (currentTranslationEnabled === false) {
    targetSel.value = '';
  } else if (sourceSel.value === 'en') {
    targetSel.value = ''; // English source → default to no translation
  }
}

// Map "English", "Spanish", etc. (whatever the analysis returns) to ISO codes.
function isoCodeFromName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase().trim();
  // Direct ISO code passthrough
  if (ISO_LANG_NAMES[lower]) return lower;
  // Name lookup
  for (const [code, n] of Object.entries(ISO_LANG_NAMES)) {
    if (n.toLowerCase() === lower) return code;
    if (lower.startsWith(n.toLowerCase())) return code;
  }
  // Common aliases
  if (/^chinese/.test(lower) || /^mandarin/.test(lower) || lower === 'cantonese') return 'zh';
  if (/^spanish/.test(lower)) return 'es';
  if (/^english/.test(lower)) return 'en';
  return null;
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

// ── Click-to-rename a speaker from the editor body ──
// SpeakerBlock.js dispatches `np-speaker-rename` { from, to } when the
// user clicks a speaker label and confirms a new name. We update segments,
// speakerMap, and the hidden-speakers list so the new name sticks
// everywhere; rebuild the editor doc; autosave.
window.addEventListener('np-speaker-rename', (e) => {
  const { from, to } = e.detail || {};
  if (!from || !to || from === to) return;

  // 1) Rewrite every segment's speaker field that matches the old name.
  segments = segments.map(s => s.speaker === from ? { ...s, speaker: to } : s);

  // 2) Rewrite the speakerMap so future loads stay consistent. Two cases:
  //    a) `from` is a value in speakerMap (we previously renamed) → update value
  //    b) `from` is the raw key (no prior rename) → set raw → to
  let touched = false;
  const next = { ...speakerMap };
  for (const k of Object.keys(next)) {
    if (next[k] === from) { next[k] = to; touched = true; }
  }
  if (!touched) next[from] = to;
  speakerMap = next;

  // 3) Update hiddenSpeakers if needed.
  hiddenSpeakers = (hiddenSpeakers || []).map(s => s === from ? to : s);

  // 4) Rebuild + mark dirty + autosave. markDirty() runs the snapshot
  //    capture so a failed save still recovers the rename on reload.
  editorState = buildEditorDocument(
    segments,
    translations.length > 0 ? translations : null,
    speakerColors,
    speakerMap,
    hiddenSpeakers,
    analysis?.language_map,
    { hideUnintelligible },
  );
  editorInstance = null;
  switchView('editor');
  markDirty();
  autoSave();
});

$('#btn-skip-to-editor').addEventListener('click', skipToEditor);
$('#btn-skip-to-editor-upload').addEventListener('click', skipToEditor);

// ── New 3-step flow: Analyze → Translate (optional) → Edit ──
// The legacy Clarify step is kept in the DOM for backwards compatibility
// (so old saved transcripts mid-flow still load), but new flows skip it
// entirely. Editorial Focus moved into Step 2 alongside the language
// pickers; per-question clarifications are no longer collected.
const btnContinueFromAnalyze = document.getElementById('btn-continue-from-analyze');
if (btnContinueFromAnalyze) {
  btnContinueFromAnalyze.addEventListener('click', () => {
    gatherSpeakerSelections();
    const targetLang = (document.getElementById('target-language')?.value || '').trim();
    const sourceLang = (document.getElementById('source-language')?.value || '').trim();
    pendingTargetLanguage = targetLang || null;
    pendingSourceLanguage = sourceLang || null;
    pendingTranslationEnabled = !!targetLang;

    if (!targetLang) {
      // No translation requested — go straight to the editor with the
      // original transcript. Build editor state from segments only.
      skipToEditor();
      return;
    }
    // Translation requested — kick off Step 4 directly. Clarify is dead.
    startTranslation();
  });
}

// Legacy Clarify button still wired so old saved transcripts can load
// into Step 3 without breaking. New uploads never touch this path.
btnToClarify?.addEventListener('click', () => {
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

  // Hide the media deck visually when not in editor view, but DON'T destroy
  // it — destroying triggers a fresh signed-URL fetch + waveform decode every
  // time the user toggles editor↔workshop, which is wasteful and slow.
  // The deck is torn down for real on transcript change (resetToUpload /
  // teardownEditingSession) so playback state actually persists across views.
  if (mediaDeck?.root) {
    mediaDeck.root.style.display = (view === 'editor') ? '' : 'none';
  }
  document.body.classList.toggle('has-media-deck', view === 'editor' && !!mediaDeck);

  // Mount editor on first switch to editor view
  if (view === 'editor' && editorState) {
    backfillStartTimes(editorState, segments);
    syncEditorColors();
    const container = $('#editor-mount');
    if (container && !editorInstance) {
      // Mount the Trint-style media deck only if we don't already have one
      // for this transcript. Re-mount on view-toggle is what made it slow.
      if (!mediaDeck) {
        mountMediaDeckForCurrent(container).catch(err => console.warn('[media-deck] mount failed:', err));
      }
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
        viewOnly,
        onSpeakerMapChange: (rawName, newCleanName) => {
          // Route through np-speaker-rename — same code path as body
          // click-to-rename. Without this, the rename never autosaves
          // and segments stay stale until reload.
          const from = speakerMap[rawName] || rawName;
          const to = (newCleanName || '').trim();
          if (!to || to === from) return;
          window.dispatchEvent(new CustomEvent('np-speaker-rename', {
            detail: { from, to },
          }));
        },
        onUpdate: (json) => {
          editorState = json;
          editorDirty = true;
          debouncedAutoSave();
          refreshMediaDeckHighlights();
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
        // Fires when "Use polished" mutates a segment.text in place. Without
        // this the edit only lives in memory and vanishes on reload — the
        // workshop was mutating the global `segments` array directly with
        // no autosave hook.
        onSegmentsMutated: () => {
          markDirty();
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
        const xml = buildPremiereXML(highlights, segments, currentTranscriptName, { fps: getExportFps() });
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeFilename(currentTranscriptName || 'markers')}.xml`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          fps: getExportFps(),
        });
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeFilename(currentTranscriptName || 'sequence-cut')}.xml`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        model: 'claude-sonnet-4-6',
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

// Legacy in-place error (used by step-1 upload errors). Kept for that one
// callsite; everything else uses the toast system below.
function showError(msg, parentSel) {
  const parent = parentSel ? $(parentSel) : $('#step-1');
  // If we're not on step-1, use a toast instead — the inline error would
  // never be seen otherwise.
  if (!parent || (!parentSel && currentStep !== 1)) {
    return showToast(msg, 'error');
  }
  const existing = parent.querySelector('.error-msg');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = msg;
  parent.prepend(div);

  setTimeout(() => div.remove(), 8000);
}

// ──────────────────────────────────────────────────────────────────────
// Toast notifications — replaces showError's prepend pattern. Stacks in
// the bottom-right corner. Variants: error (red), success (green), info.
// Click to dismiss; auto-dismiss after a kind-specific delay.
// ──────────────────────────────────────────────────────────────────────
function ensureToastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  return host;
}

function showToast(message, kind = 'info', opts = {}) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const text = document.createElement('div');
  text.className = 'toast-msg';
  text.textContent = String(message);
  el.appendChild(text);

  if (opts.action && opts.onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.action;
    btn.addEventListener('click', () => {
      try { opts.onAction(); } finally { dismiss(); }
    });
    el.appendChild(btn);
  }

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = '&times;';
  close.addEventListener('click', dismiss);
  el.appendChild(close);

  host.appendChild(el);

  // Trigger enter animation
  requestAnimationFrame(() => el.classList.add('toast--in'));

  const timeoutMs = opts.duration ?? (kind === 'error' ? 7000 : 3500);
  let timer = setTimeout(dismiss, timeoutMs);

  function dismiss() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!el.parentNode) return;
    el.classList.remove('toast--in');
    el.classList.add('toast--out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  return { dismiss };
}

const showSuccess = (msg, opts) => showToast(msg, 'success', opts);
const showInfo    = (msg, opts) => showToast(msg, 'info', opts);
// Toast-only error (always corner toast, never inline). Use this from
// non-step-1 contexts where prepending to step-1 makes no sense.
const showErrorToast = (msg, opts) => showToast(msg, 'error', opts);

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
async function resetToUpload() {
  // Wait for any in-flight save to land BEFORE clearing local state, otherwise
  // the in-flight runSaveOnce() may finish after the reset, see nextSavePending,
  // and write a half-empty payload (no segments/no editorState) to the server.
  try { await flushPendingSave(); } catch {}
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
    // Audit attribution: show who made each revision. Falls back gracefully
    // if the migration hasn't run (no client_label) or for old rows.
    const who = r.client_label || (isThisTab ? 'You' : 'anonymous');
    const color = r.client_color || (isThisTab ? currentClientColor() : 'rgba(65,44,39,0.45)');
    const initials = who.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
    return `
      <div class="revision-row" data-id="${r.id}">
        <div class="revision-avatar" style="background:${escapeHtmlSafe(color)}">${escapeHtmlSafe(initials)}</div>
        <div class="revision-body">
          <div class="revision-when"><b>${escapeHtmlSafe(who)}</b> · ${escapeHtmlSafe(label)}</div>
          <div class="revision-meta">${escapeHtmlSafe(sourceTag)}${isThisTab ? ' · this tab' : ''}</div>
        </div>
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
        if (saveState === 'dirty' || saveState === 'error' || saveState === 'conflict') {
          await flushPendingSave();
        }
        const rev = await loadRevision(id);
        // applySnapshotPayload is additive — it only writes fields present in
        // the payload. Old revisions predate fields like wordTimings,
        // mediaUploadId, target_language, etc., so without an explicit reset
        // those fields would bleed through from the live in-memory state and
        // the "restored" version would be a hybrid of old + new. Zero out
        // first so the restore is true to what was actually saved.
        segments = [];
        analysis = null;
        translations = [];
        srtContent = '';
        speakerColors = {};
        annotations = {};
        speakerMap = {};
        hiddenSpeakers = [];
        editorState = null;
        wordTimingsMap = null;
        currentMediaUploadId = null;
        currentTargetLanguage = null;
        currentTranslationEnabled = null;
        currentSummary = null;
        rawSummary = null;
        summaryBullets = [];
        interestVotes = {};
        workshopState = null;
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
  // Stand up the presence channel alongside the data channel.
  ensurePresence();
}

function teardownRealtime() {
  if (realtimeUnsubscribe) { try { realtimeUnsubscribe(); } catch {} realtimeUnsubscribe = null; }
  realtimeBoundTranscriptId = null;
  teardownPresence();
}

// ── Presence: who's looking at this transcript right now ────────────
let presenceBoundTranscriptId = null;
let presenceHeartbeatTimer = null;
let lastPresencePeers = [];

function ensurePresence() {
  if (!currentTranscriptId) return;
  if (presenceBoundTranscriptId === currentTranscriptId && presenceChannel) return;
  teardownPresence();
  presenceBoundTranscriptId = currentTranscriptId;
  try {
    presenceChannel = subscribePresence(currentTranscriptId, (peers) => {
      lastPresencePeers = peers;
      renderPresence(peers);
    });
    // Initial broadcast — Supabase Realtime presence buffers until subscribe
    // completes, but track() before the SUBSCRIBED event is harmless; the
    // join event lands once the socket settles.
    broadcastPresence();
    // Heartbeat every 25s so peers know we're still here even if state
    // doesn't change. Without this, a tab that goes idle but never closes
    // (e.g. switched away) eventually times out of the channel.
    presenceHeartbeatTimer = setInterval(broadcastPresence, 25000);
  } catch (err) {
    console.warn('[presence] subscribe failed:', err);
  }
}

function teardownPresence() {
  if (presenceHeartbeatTimer) { clearInterval(presenceHeartbeatTimer); presenceHeartbeatTimer = null; }
  if (presenceChannel) {
    try { presenceChannel.untrack(); } catch {}
    try { presenceChannel.unsubscribe(); } catch {}
    presenceChannel = null;
  }
  presenceBoundTranscriptId = null;
  renderPresence([]);
}

function broadcastPresence() {
  if (!presenceChannel) return;
  presenceChannel.track({
    clientId: CLIENT_ID,
    userId: currentUserId() || null,
    name: currentClientName() || "anonymous",
    color: currentClientColor(),
    device: CLIENT_DEVICE,
    transcriptId: currentTranscriptId,
    at: new Date().toISOString(),
  });
}

function renderPresence(peers) {
  let host = document.getElementById('presence-stack');
  if (!host) {
    host = document.createElement('div');
    host.id = 'presence-stack';
    host.className = 'presence-stack';
    document.body.appendChild(host);
  }
  // Filter out self by clientId.
  const others = (peers || []).filter(p => p && p.clientId && p.clientId !== CLIENT_ID);
  if (others.length === 0) {
    host.innerHTML = '';
    host.style.display = 'none';
    return;
  }
  host.style.display = '';
  // Dedupe by clientId so the same person in two tabs only shows once.
  const seen = new Set();
  const unique = [];
  for (const p of others) {
    if (seen.has(p.clientId)) continue;
    seen.add(p.clientId);
    unique.push(p);
  }
  host.innerHTML = unique.map(p => {
    const name = p.name || 'anonymous';
    const initials = name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';
    const tooltip = `${name}${p.device ? ' · ' + p.device : ''}`;
    return `
      <div class="presence-pill" title="${escapeHtmlSafe(tooltip)}" style="background:${escapeHtmlSafe(p.color || '#412C27')}">${escapeHtmlSafe(initials)}</div>
    `;
  }).join('');
}

function handleRemoteUpdate(newRow) {
  if (!newRow || newRow.id !== currentTranscriptId) return;
  // Ignore echoes of our own write.
  if (lastServerUpdatedAt && newRow.updated_at === lastServerUpdatedAt) return;
  // If we're in the middle of saving, also ignore (our reply will arrive shortly).
  if (saveInFlight) return;

  // If the user has navigated AWAY from the editor (library, home, sequencer,
  // search), do NOT auto-render the editor view. Just update in-memory state
  // so it's fresh when they return. Previously this re-ran finishLoadRender
  // which forced switchView('editor') and yanked the user out of wherever
  // they actually were — the "click library and bounce into the transcript"
  // bug.
  if (libraryShowing || currentStep !== 5) {
    if (saveState === 'clean' || saveState === 'saved') {
      applyTranscriptToState(newRow);
      lastServerUpdatedAt = newRow.updated_at;
      setSaveState('saved');
    } else {
      // User has unsaved local edits AND has navigated away — keep their
      // edits, surface the banner so they decide on next return.
      showRemoteChangeBanner(newRow);
    }
    return;
  }

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
  // 5 min staleness — matches an active heartbeat (every 30s) with plenty of
  // margin for network blips, sleep/wake, etc. Old 60s was too aggressive
  // and caused stale-lock false positives every time a browser tab restarted.
  try { existing = await checkLock(currentTranscriptId, 5 * 60); } catch (err) { console.warn('[lock] check failed:', err); }
  if (existing && existing.holder_id !== CLIENT_ID) {
    const decision = await promptLockConflict(existing);
    if (decision === 'cancel') {
      // Cancel means "I changed my mind" — just dismiss, leave the user
      // in whatever step the load already rendered. Previously this bounced
      // back to the library which felt like a navigation bug.
      return;
    }
    if (decision === 'view-only') {
      viewOnly = true;
      showViewOnlyBanner(existing);
      // Push viewOnly into a mounted editor so input is actually disabled,
      // not just silently dropped by runSaveOnce.
      if (editorInstance) editorInstance.update({ viewOnly: true });
      return;
    }
    // 'take-over' — fall through to upsert below.
  }

  try {
    await acquireLock(currentTranscriptId, CLIENT_ID, currentClientLabel());
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
  // Tear down media deck on transcript change. View-toggle no longer destroys
  // it (just hides), so this is the single owner of deck destruction.
  if (mediaDeck) {
    try { mediaDeck.destroy(); } catch {}
    mediaDeck = null;
  }
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
    try { await acquireLock(currentTranscriptId, CLIENT_ID, currentClientLabel()); } catch {}
    lockBoundTranscriptId = currentTranscriptId;
    if (!lockHeartbeatTimer) {
      lockHeartbeatTimer = setInterval(() => heartbeatLock(currentTranscriptId, CLIENT_ID).catch(() => {}), 30000);
    }
  });
}

// Release the lock cleanly when the tab closes. Uses fetch keepalive:true
// so the request actually survives the tab unload — the previous best-effort
// async releaseLock() call routinely got killed by the browser before the
// network round-trip completed, leaving stale locks that triggered "another
// tab is editing" warnings on the next session.
window.addEventListener('beforeunload', () => {
  if (lockBoundTranscriptId) {
    try { releaseLockBeacon(lockBoundTranscriptId, CLIENT_ID); } catch {}
  }
});
window.addEventListener('pagehide', () => {
  if (lockBoundTranscriptId) {
    try { releaseLockBeacon(lockBoundTranscriptId, CLIENT_ID); } catch {}
  }
});

// ── Permalink / router ─────────────────────────────────────────────
//
// The URL hash is the source of truth for which view we're on. Refresh,
// back/forward, deep links, and programmatic navigation all flow through
// here so behaviour stays consistent.
//
// Route shapes:
//   {kind:'home'}                — bare URL (no hash)
//   {kind:'library'}             — #library
//   {kind:'sequencer'}           — #sequencer
//   {kind:'transcript', id:slug} — #<slug-or-uuid>
//
// Reserved keywords (library/sequencer/search/trash) are checked first
// when parsing so a transcript slug accidentally named 'library' wouldn't
// clobber routing — we just won't generate slugs that collide (slug
// generator strips to alphanum and prefixes if needed).

const RESERVED_ROUTE_KEYWORDS = new Set(['library', 'sequencer', 'search', 'trash', 'home']);

function parseRoute() {
  const hash = window.location.hash.slice(1).trim();
  if (!hash || hash === '/' || hash === 'home') return { kind: 'home' };
  // Legacy `#t=UUID` format from older sessions — still accepted on read.
  const legacyMatch = hash.match(/^t=(.+)/);
  if (legacyMatch) return { kind: 'transcript', id: legacyMatch[1] };
  if (hash === 'library') return { kind: 'library' };
  if (hash === 'sequencer') return { kind: 'sequencer' };
  // Anything else — treat as a transcript slug or UUID.
  return { kind: 'transcript', id: hash };
}

// Back-compat shim — code still calls getPermalinkId() in a few spots.
function getPermalinkId() {
  const r = parseRoute();
  return r.kind === 'transcript' ? r.id : null;
}

function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str) || /^local_/.test(str);
}

// Suppress the next hashchange event when we change the URL programmatically.
// replaceState does NOT fire hashchange in modern browsers, but
// window.location.hash = ... DOES, and we want to be defensive in case any
// third-party plugin still uses the latter. The flag is consumed once.
let suppressNextHashChange = false;

function setRoute(route, opts = {}) {
  const path = window.location.pathname;
  let target = path;
  if (route.kind === 'library') target = path + '#library';
  else if (route.kind === 'sequencer') target = path + '#sequencer';
  else if (route.kind === 'transcript' && route.id) target = path + '#' + route.id;
  // Already on this URL? Skip — avoids redundant history entries + spurious
  // hashchange events.
  const currentFull = window.location.pathname + window.location.hash;
  if (currentFull === target) return;
  suppressNextHashChange = true;
  if (opts.push) history.pushState(null, '', target);
  else history.replaceState(null, '', target);
}

// Back-compat shims used widely below — keep them but route through setRoute.
function setPermalinkHash(slugOrId) {
  if (!slugOrId) { setRoute({ kind: 'home' }); return; }
  if (slugOrId === 'library')   { setRoute({ kind: 'library' }); return; }
  if (slugOrId === 'sequencer') { setRoute({ kind: 'sequencer' }); return; }
  setRoute({ kind: 'transcript', id: slugOrId });
}
function clearPermalinkHash() { setRoute({ kind: 'home' }); }

// React to URL changes that didn't originate from our own setRoute calls
// (browser back/forward, manual hash edit, opening a deep link). The
// suppressNextHashChange flag short-circuits the loop where our own
// programmatic changes would otherwise re-trigger this.
async function applyRouteFromUrl() {
  if (suppressNextHashChange) { suppressNextHashChange = false; return; }
  const route = parseRoute();

  if (route.kind === 'home') {
    // Don't tear down current edits silently — if the user has unsaved work,
    // resetToUpload will flush first. Safe.
    if (currentStep !== 1 && !libraryShowing) {
      try { await resetToUpload(); } catch {}
    } else if (libraryShowing) {
      libraryShowing = false;
      libraryView.classList.remove('active');
      goToStep(1);
    }
    return;
  }

  if (route.kind === 'library') {
    if (!libraryShowing) showLibrary();
    return;
  }

  if (route.kind === 'sequencer') {
    if (!document.getElementById('sequencer-view')?.classList.contains('hidden')) return;
    showSequencer();
    return;
  }

  if (route.kind === 'transcript') {
    // Already loaded? No-op.
    if (currentTranscriptId === route.id || currentSlug === route.id) {
      // Make sure we're actually showing the editor view; URL says we should be.
      if (libraryShowing || currentStep !== 5) {
        libraryShowing = false;
        libraryView.classList.remove('active');
        if (editorState) { goToStep(5); switchView('editor'); }
      }
      return;
    }
    // Different transcript — load it.
    try {
      if (isUUID(route.id)) {
        await handleLoad(route.id);
      } else {
        const t = await loadTranscriptBySlug(route.id);
        await handleLoad(t.id);
      }
    } catch (err) {
      console.warn('[router] load failed:', err.message);
      showErrorToast('Could not load that transcript.');
      // Bad route — push user to library so they can pick something else.
      setRoute({ kind: 'library' });
      showLibrary();
    }
  }
}

// Wire the listeners once at module load. popstate covers back/forward;
// hashchange covers manual URL edits + a few rare browser cases.
window.addEventListener('hashchange', () => { applyRouteFromUrl(); });
window.addEventListener('popstate',   () => { applyRouteFromUrl(); });

// ── Share button — opens full Share dialog (collaborators + permalink) ──
const btnShare = document.getElementById('btn-share');
if (btnShare) {
  btnShare.addEventListener('click', () => {
    if (!currentTranscriptId) return;
    openShareDialog();
  });
}

const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
const ROLE_HINTS = {
  owner: 'Can edit, share, and delete',
  editor: 'Can edit and comment',
  viewer: 'Can read and comment',
};

async function openShareDialog() {
  if (!currentTranscriptId) return;
  document.getElementById('share-modal')?.remove();

  const permalink = currentSlug || currentTranscriptId;
  setPermalinkHash(permalink);
  const shareUrl = window.location.href;

  const modal = document.createElement('div');
  modal.id = 'share-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card share-card" style="max-width:520px;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Share this transcript</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <div class="share-link-row">
        <input class="share-link-input" id="share-link-input" type="text" readonly value="${esc(shareUrl)}">
        <button class="np-button" id="share-link-copy">Copy link</button>
      </div>
      <p class="share-link-hint">Anyone signed in to this workspace with the link can open it.</p>
      <div class="share-add-row">
        <input class="np-textarea share-add-input" id="share-add-input"
               placeholder="Add by email or name…" autocomplete="off"
               style="min-height:auto;">
        <select class="share-role-select" id="share-add-role">
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button class="np-button np-button--primary" id="share-add-btn">Add</button>
      </div>
      <div class="share-suggest" id="share-suggest"></div>
      <div class="share-list" id="share-list">
        <div class="share-loading">Loading collaborators…</div>
      </div>
      <p id="share-msg" class="share-msg hidden"></p>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.remove()));

  document.getElementById('share-link-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      const btn = document.getElementById('share-link-copy');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
    } catch {
      document.getElementById('share-link-input').select();
    }
  });

  // Add-collaborator field — search-as-you-type for existing users.
  const input = document.getElementById('share-add-input');
  const suggest = document.getElementById('share-suggest');
  let suggestTimer = null;
  let pickedUser = null;
  input.addEventListener('input', () => {
    pickedUser = null;
    if (suggestTimer) clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (q.length < 2) { suggest.innerHTML = ''; return; }
    suggestTimer = setTimeout(async () => {
      try {
        const matches = await searchUserProfiles(q, { limit: 6 });
        if (!matches.length) { suggest.innerHTML = ''; return; }
        suggest.innerHTML = matches.map(p => `
          <button class="share-suggest-item" data-user-id="${esc(p.user_id)}"
                  data-display="${esc(p.display_name || p.email || 'User')}"
                  data-color="${esc(p.color || '#412c27')}">
            <span class="share-avatar share-avatar--sm" style="background:${esc(p.color || '#412c27')}">
              ${esc((p.display_name || p.email || '?').slice(0, 1).toUpperCase())}
            </span>
            <span class="share-suggest-name">${esc(p.display_name || 'User')}</span>
            <span class="share-suggest-email">${esc(p.email || '')}</span>
          </button>
        `).join('');
        suggest.querySelectorAll('.share-suggest-item').forEach(el => {
          el.addEventListener('click', () => {
            pickedUser = { id: el.dataset.userId, name: el.dataset.display };
            input.value = el.dataset.display;
            suggest.innerHTML = '';
          });
        });
      } catch {}
    }, 180);
  });

  document.getElementById('share-add-btn').addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) return;
    const role = document.getElementById('share-add-role').value;
    const msg = document.getElementById('share-msg');
    msg.classList.add('hidden');
    msg.classList.remove('share-msg--error');
    try {
      if (pickedUser) {
        await addShare(currentTranscriptId, {
          userId: pickedUser.id, role,
          createdBy: currentUserId() || undefined,
        });
      } else if (raw.includes('@')) {
        await addShare(currentTranscriptId, {
          email: raw, role,
          createdBy: currentUserId() || undefined,
        });
      } else {
        msg.textContent = 'Type an email or pick a user from the suggestions.';
        msg.classList.remove('hidden');
        msg.classList.add('share-msg--error');
        return;
      }
      input.value = '';
      pickedUser = null;
      suggest.innerHTML = '';
      await renderShareList();
    } catch (err) {
      msg.textContent = err?.message || 'Could not add collaborator.';
      msg.classList.remove('hidden');
      msg.classList.add('share-msg--error');
    }
  });

  await renderShareList();

  async function renderShareList() {
    const host = document.getElementById('share-list');
    if (!host) return;
    host.innerHTML = `<div class="share-loading">Loading collaborators…</div>`;
    let shares = [];
    try {
      shares = await listShares(currentTranscriptId);
    } catch (err) {
      host.innerHTML = `<div class="share-empty">${esc(err?.message || 'Could not load collaborators.')}</div>`;
      return;
    }
    if (!shares.length) {
      host.innerHTML = `<div class="share-empty">No explicit collaborators yet. Anyone in this workspace can already open this link.</div>`;
      return;
    }
    host.innerHTML = shares.map(s => {
      const profile = s.user_profile;
      const name = profile?.display_name || s.email || 'Pending invite';
      const color = profile?.color || '#412c27';
      const initials = (name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
      const subtitle = profile?.email || (s.email ? 'Pending — invite sent' : '');
      return `
        <div class="share-row" data-share-id="${esc(s.id)}">
          <span class="share-avatar" style="background:${esc(color)}">${esc(initials)}</span>
          <div class="share-row-body">
            <div class="share-row-name">${esc(name)}${s.status === 'pending' ? ' <span class="share-pill">pending</span>' : ''}</div>
            <div class="share-row-sub">${esc(subtitle)}</div>
          </div>
          <select class="share-role-select" data-role-for="${esc(s.id)}">
            ${Object.entries(ROLE_LABELS).map(([k, lbl]) =>
              `<option value="${k}" ${k === s.role ? 'selected' : ''}>${esc(lbl)}</option>`
            ).join('')}
          </select>
          <button class="share-remove" data-remove-share="${esc(s.id)}" title="Remove">×</button>
        </div>
      `;
    }).join('');
    host.querySelectorAll('[data-role-for]').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await updateShareRole(sel.dataset.roleFor, sel.value);
        } catch (err) {
          showErrorToast(`Couldn't update role: ${err?.message || 'unknown'}`);
        }
      });
    });
    host.querySelectorAll('[data-remove-share]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.removeShare;
        try {
          await removeShare(id);
          await renderShareList();
        } catch (err) {
          showErrorToast(`Couldn't remove: ${err?.message || 'unknown'}`);
        }
      });
    });
  }
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
  if (needsPhase1) files.push('supabase/migrations/001_phase1_core.sql');
  if (needsPhase2) files.push('supabase/migrations/004_phase2_revisions_locks.sql');
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
  safeInit('sidebar', wireSidebarOnce);

  safeInit('devchat', async () => {
    const { initDevchat } = await import('./devchat.js');
    initDevchat({
      getTranscriptId: () => currentTranscriptId,
      getCurrentView: () => {
        if (!document.getElementById('sequencer-view')?.classList.contains('hidden')) return 'sequencer';
        if (!document.getElementById('library-view')?.classList.contains('hidden')) return 'library';
        return `step-${currentStep}`;
      },
      getPageState: () => ({
        currentSlug,
        segmentsCount: segments?.length || 0,
        translationsCount: translations?.length || 0,
      }),
    });
  });

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

  // Pre-id draft recovery — if the previous session uploaded + transcribed
  // but never made it through the first save (network failure, tab close
  // before save landed, etc.), the in-memory state is stranded in
  // localStorage under the draft key. Offer to restore so the work isn't lost.
  // Only triggers when no permalink is set (so we don't trample over an
  // explicitly-loaded transcript) and only when the draft has segments.
  try {
    const draft = loadDraftSnapshot();
    if (draft?.payload && (draft.payload.segments || []).length > 0 && !getPermalinkId()) {
      const segCount = draft.payload.segments.length;
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'recently';
      const recover = window.confirm(
        `Recover unsaved work?\n\n` +
        `${segCount} segments from a previous session were never saved to the cloud (${when}).\n\n` +
        `OK to recover, Cancel to discard.`
      );
      if (recover) {
        applySnapshotPayload(draft.payload);
        // Force first-save now so a real id gets minted and the indexed
        // snapshot path takes over.
        markDirty();
        await runSaveOnce({ awaitInFlight: true }).catch(err => {
          console.warn('[draft-recover] save failed; data is still in memory:', err);
        });
        clearDraftSnapshot();
        // Render whatever step we ended up at.
        if (segments.length > 0 && editorState) { goToStep(5); switchView('editor'); }
        else if (segments.length > 0) goToStep(2);
        return;
      }
      clearDraftSnapshot();
    }
  } catch (err) {
    console.warn('[draft-recover] failed:', err);
  }

  // URL is the source of truth — route to whatever the hash says. Bare
  // URL → home; #library → library; #sequencer → sequencer; #<slug> →
  // transcript. Refresh stays where you were instead of boomeranging back
  // to a stale transcript.
  const route = parseRoute();

  // Load projects and (optional) transcript in parallel
  const projectsPromise = listProjects().then(p => { projects = p; }).catch(() => {});

  if (route.kind === 'sequencer') {
    await projectsPromise;
    showSequencer();
    return;
  }

  if (route.kind === 'library') {
    await projectsPromise;
    showLibrary();
    return;
  }

  let loadPromise = Promise.resolve();
  if (route.kind === 'transcript') {
    const permalink = route.id;
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
