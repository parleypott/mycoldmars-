import { parseCSV, getStats, cleanSpeakerName, buildSpeakerMap, isGenericSpeaker, getSequenceMetadata } from './csv-parser.js';
import { parseJSON } from './json-parser.js';
import { formatPreciseTimecode } from './timecode-utils.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';
import { saveTranscript, updateTranscript, listTranscripts, loadTranscript, loadTranscriptBySlug, isSlugTaken, deleteTranscript, restoreTranscript, permanentlyDeleteTranscript, listDeletedTranscripts, createProject, listProjects, deleteProject, supabaseAvailable, getStorageInfo, migrateLocalStorageToSupabase } from './db.js';
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
let libraryCurrentProject = null;  // null = root (show all projects + unsorted)
let librarySortKey = 'updated_at';
let librarySortAsc = false;
let libraryCache = null;           // { transcripts, projects, deleted, ts }
const LIBRARY_CACHE_TTL = 5000;
const LIBRARY_CACHE_LS_KEY = 'np_library_cache_v1';

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
  } else {
    if (header) header.classList.remove('hidden');
    stepsNav.classList.remove('hidden');
    if (homeHero) homeHero.classList.add('hidden');
  }
}

function showLibrary() {
  libraryShowing = true;
  $$('.panel').forEach(p => p.classList.remove('active'));
  const header = $('header');
  if (header) header.classList.remove('hidden');
  stepsNav.classList.add('hidden');
  libraryView.classList.add('active');
  const homeHero = $('#home-hero');
  if (homeHero) homeHero.classList.add('hidden');
  fetchLibrary();
}

// ── Library ──
async function fetchLibrary(forceRefresh) {
  // 1. Memory cache hit (fresh) — return immediately
  if (!forceRefresh && libraryCache && (Date.now() - libraryCache.ts < LIBRARY_CACHE_TTL)) {
    renderLibrary(libraryCache.transcripts, libraryCache.projects, libraryCache.deleted);
    return;
  }

  // 2. Cold load: hydrate from localStorage (stale-while-revalidate) so the
  // user sees something in <100ms even if the network is slow.
  let renderedFromDisk = false;
  if (!forceRefresh && !libraryCache) {
    const disk = loadLibraryCacheFromDisk();
    if (disk && (disk.transcripts?.length || disk.projects?.length)) {
      libraryCache = disk;
      projects = disk.projects || [];
      renderLibrary(disk.transcripts, disk.projects, disk.deleted);
      renderedFromDisk = true;
    }
  }

  // 3. If we still have nothing on screen, show a skeleton while we wait.
  if (!renderedFromDisk) {
    renderLibrarySkeleton();
  }

  // 4. Fetch transcripts+projects in parallel; render the second they're back.
  // listDeletedTranscripts is the slowest and only matters at root view, so
  // we fire it independently and patch in when it lands.
  let transcripts = [];
  let p = [];
  try {
    [p, transcripts] = await Promise.all([listProjects(), listTranscripts()]);
    projects = p;
    // Render with whatever deleted we have cached (probably stale or empty)
    const deletedSoFar = libraryCache?.deleted || [];
    libraryCache = {
      transcripts,
      projects,
      deleted: deletedSoFar,
      ts: Date.now(),
    };
    renderLibrary(transcripts, projects, deletedSoFar);
    saveLibraryCacheToDisk(libraryCache);
  } catch (err) {
    if (!renderedFromDisk) {
      libraryList.innerHTML = '';
      libraryEmpty.classList.remove('hidden');
    }
    console.error('Failed to load library:', err);
    return;
  }

  // 5. Fetch deleted in the background; only re-render if root view is
  // still showing (deleted only appears there).
  try {
    const deleted = await listDeletedTranscripts();
    libraryCache = { ...libraryCache, deleted, ts: Date.now() };
    saveLibraryCacheToDisk(libraryCache);
    if (libraryShowing && !libraryCurrentProject) {
      renderLibrary(transcripts, projects, deleted);
    }
  } catch {
    // Deleted is non-critical; ignore.
  }
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
  return `
    <div class="lib-row lib-row--file ${isActive ? 'lib-row--active' : ''}"
         data-id="${t.id}" data-project-id="${t.project_id || ''}" draggable="true">
      <div class="lib-col lib-col--name">
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
      // Don't load if clicking delete or name (for inline rename)
      if (e.target.closest('.lib-row-delete') || e.target.closest('.lib-name')) return;
      handleLoad(row.dataset.id);
    });
  });

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

  // Search filter
  const searchInput = $('#library-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      libraryList.querySelectorAll('.lib-row').forEach(row => {
        const name = row.querySelector('.lib-name')?.textContent?.toLowerCase() || '';
        row.style.display = (!q || name.includes(q)) ? '' : 'none';
      });
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

async function handleLoad(id) {
  try {
    const t = await loadTranscript(id);

    // Restore state
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
    rememberLastTranscript(t.id);
    updateTranscriptTitle();
    // Sync editor colors with saved speaker colors
    syncEditorColors();
    // Reset editor instance so it remounts with new state
    const editorMount = $('#editor-mount');
    if (editorMount) editorMount.innerHTML = '';
    editorInstance = null;

    // Restore metadata
    const meta = t.metadata || {};
    if (meta.editorialFocus) {
      const ef = $('#editorial-focus');
      if (ef) ef.value = meta.editorialFocus;
    }
    currentSummary = meta.summary ? enrichSummaryWithTimecodes(meta.summary) : null;
    rawSummary = meta.rawSummary || null;
    summaryBullets = meta.summaryBullets || [];
    interestVotes = meta.interestVotes || {};

    // Re-parse bullets for transcripts saved before voting feature
    if (summaryBullets.length === 0 && rawSummary) {
      summaryBullets = parseSummaryBullets(rawSummary);
      attachEnrichedTextToBullets();
    } else if (summaryBullets.length === 0 && currentSummary) {
      // No raw summary stored — parse from enriched text with timecode reverse-mapping
      summaryBullets = parseSummaryBulletsFromEnriched(currentSummary);
    }

    // Re-render based on step
    const step = t.step || 1;

    if (segments.length > 0) {
      renderTranscript();
    }

    if (analysis) {
      renderAnalysis();
      renderClarifyStep();

      // Restore clarification answers
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

    if (translations.length > 0) {
      renderTranslations();
    }

    if (srtContent) {
      $('#srt-preview').textContent = srtContent;
      buildReaderView();
    }

    goToStep(step);

    // If loaded into editor step, mount the editor view
    if (step === 5) {
      switchView('editor');
    }
  } catch (err) {
    console.error('Failed to load transcript:', err);
    showError('Failed to load transcript: ' + err.message);
  }
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
    },
  };
}

// ── Save status indicator ──
const saveStatusEl = document.getElementById('save-status');
let saveStatusTimer = null;

function updateSaveStatus(state) {
  if (!saveStatusEl) return;
  clearTimeout(saveStatusTimer);
  saveStatusEl.classList.remove('save-status--error', 'save-status--fade');

  if (state === 'saving') {
    saveStatusEl.textContent = 'Saving...';
  } else if (state === 'saved') {
    saveStatusEl.textContent = getStorageInfo() === 'local' ? 'Saved locally' : 'Saved';
    saveStatusTimer = setTimeout(() => {
      saveStatusEl.classList.add('save-status--fade');
    }, 2000);
  } else if (state === 'error') {
    saveStatusEl.textContent = 'Save failed';
    saveStatusEl.classList.add('save-status--error');
  }
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

async function autoSave() {
  updateSaveStatus('saving');
  try {
    const payload = gatherState();
    payload.metadata = { ...payload.metadata, segmentCount: segments.length };
    if (currentTranscriptId) {
      await updateTranscript(currentTranscriptId, payload);
    } else {
      const name = currentTranscriptName || generateAutoName();
      payload.name = name;
      // Generate a clean slug for the permalink
      const baseSlug = generateSlug(name);
      payload.slug = await ensureUniqueSlug(baseSlug);
      const row = await saveTranscript(payload);
      currentTranscriptId = row.id;
      currentTranscriptName = name;
      currentSlug = row.slug || payload.slug;
      rememberLastTranscript(row.id);
      setPermalinkHash(currentSlug);
      updateTranscriptTitle();
    }
    updateSaveStatus('saved');
    invalidateLibraryCache();
  } catch (err) {
    console.error('Auto-save failed:', err);
    updateSaveStatus('error');
  }
}

// Debounced auto-save for editor changes (3s)
let debouncedAutoSaveTimer = null;
function debouncedAutoSave() {
  clearTimeout(debouncedAutoSaveTimer);
  debouncedAutoSaveTimer = setTimeout(() => autoSave(), 3000);
}

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
    onSync: (segNums) => {
      const count = syncEditorToTranslations(segNums);
      showSyncFeedback(count, segNums);
      autoSave();
    },
    onSequenceNameChange: handleSequenceNameChange,
    onAskAI: (selection) => {
      openCopilot(selection);
    },
    onInterestVote: handleInterestVote,
    onRegenerateSummary: () => generateAutoSummary(),
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

function parseSoundbites(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const bites = [];
  const re = /^\[([^|]+?)\s*\|\s*([0-9:.,]+)\s*→\s*([0-9:.,]+)\]\s*(.+)/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    bites.push({
      id: crypto.randomUUID(),
      prefix: m[1].trim(),
      start: m[2].trim(),
      end: m[3].trim(),
      text: m[4].trim(),
    });
  }
  return bites;
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

function renderSeqBlocks() {
  const container = $('#seq-blocks');
  const status = $('#seq-status');
  status.textContent = `${seqSoundbites.length} soundbite${seqSoundbites.length !== 1 ? 's' : ''} · ~${formatDuration(seqSoundbites)} total`;

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

// Home page quick-links
const homeLibBtn = $('#home-library-btn');
if (homeLibBtn) homeLibBtn.addEventListener('click', showLibrary);
const homeSeqBtn = $('#home-sequencer-btn');
if (homeSeqBtn) homeSeqBtn.addEventListener('click', showSequencer);

$('#seq-parse-btn').addEventListener('click', () => {
  const raw = $('#seq-input').value;
  const hint = $('#seq-parse-hint');
  const newBites = parseSoundbites(raw);

  if (newBites.length === 0) {
    hint.textContent = 'No soundbites found. Look for lines like [Name | 00:00:00 → 00:01:00] text...';
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');

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
function handleFile(file) {
  const isJSON = file.name.endsWith('.json');
  const isCSV = file.name.endsWith('.csv');

  if (!file || (!isCSV && !isJSON)) {
    showError('Please upload a .csv or .json file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;

      if (isJSON || (!isCSV && content.trimStart().startsWith('['))) {
        const result = parseJSON(content);
        segments = result.segments;
        wordTimingsMap = result.wordTimings;
      } else {
        segments = parseCSV(content);
        wordTimingsMap = null;
      }

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
      speakerMap = buildSpeakerMap(segments);
      hiddenSpeakers = segments
        .map(s => s.speaker)
        .filter(s => isGenericSpeaker(s))
        .filter((v, i, a) => a.indexOf(v) === i);
      showAllSpeakers = false;
      // Pre-fill sequence name from filename (minus extension)
      customSequenceName = file.name.replace(/\.(json|csv)$/i, '');
      renderTranscript();

      // Auto-create draft transcript in Supabase
      autoSave();
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsText(file);
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
    buildReaderView();
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
  buildReaderView();
  goToStep(5);
  switchView('editor');
  autoSave();
});

btnDownload.addEventListener('click', () => {
  const blob = new Blob([srtContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'subtitles.srt';
  a.click();
  URL.revokeObjectURL(url);
});

btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(srtContent);
  const fb = $('#copy-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
});

// ── SRT controls (in Step 5 SRT view) ──
$('#max-words').addEventListener('input', (e) => {
  $('#max-words-val').textContent = e.target.value;
});

$('#max-duration').addEventListener('input', (e) => {
  $('#max-duration-val').textContent = e.target.value + 's';
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

// ── View toggle (SRT / Reader / Editor) ──
function switchView(view) {
  ['srt', 'reader', 'editor'].forEach(v => {
    const btn = $(`#btn-view-${v}`);
    const el = $(`#${v}-view`);
    if (btn) btn.classList.toggle('active', v === view);
    if (el) el.classList.toggle('hidden', v !== view);
  });

  // Lazy SRT generation on first switch to SRT view
  if (view === 'srt' && translations.length > 0) {
    syncEditorToTranslations();
    const maxWords = parseInt($('#max-words')?.value || 16);
    const maxDuration = parseInt($('#max-duration')?.value || 5);
    const dismissed = getDismissedSegmentNumbers(editorState);
    srtContent = buildSRT(translations, segments, { maxWords, maxDuration, dismissedSegments: dismissed, hideUnintelligible });
    $('#srt-preview').textContent = srtContent;
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
        onSync: (segNums) => {
          const count = syncEditorToTranslations(segNums);
          showSyncFeedback(count, segNums);
          autoSave();
        },
        onSequenceNameChange: handleSequenceNameChange,
        onAskAI: (selection) => {
          openCopilot(selection);
        },
        onInterestVote: handleInterestVote,
        onRegenerateSummary: () => generateAutoSummary(),
      });

      // Auto-generate summary on first entry if not already generated
      if (!currentSummary) {
        generateAutoSummary();
      }
    }
  }
}
$('#btn-view-srt').addEventListener('click', () => switchView('srt'));
$('#btn-view-reader').addEventListener('click', () => switchView('reader'));
$('#btn-view-editor').addEventListener('click', () => switchView('editor'));

// ── Reader view ──
function formatTimecodeShort(tc) {
  if (!tc) return '0:00';
  const match = tc.match(/(\d+):(\d+):(\d+)/);
  if (match) {
    const [, h, m, s] = match;
    return parseInt(h) > 0 ? `${h}:${m}:${s}` : `${parseInt(m)}:${s}`;
  }
  const match2 = tc.match(/(\d+):(\d+)/);
  if (match2) return `${parseInt(match2[1])}:${match2[2]}`;
  // Decimal seconds (from JSON parser) — format as precise timecode
  const f = parseFloat(tc);
  if (!isNaN(f)) return formatPreciseTimecode(f);
  return tc;
}

function buildReaderView() {
  const container = $('#reader-content');
  container.innerHTML = '';

  // Group consecutive segments by speaker
  const groups = [];
  let currentGroup = null;

  for (let i = 0; i < translations.length; i++) {
    const t = translations[i];
    const seg = segments[i];
    if (!seg) continue;

    const speaker = seg.speaker || 'Unknown';

    // Skip hidden speakers unless toggled
    if (!showAllSpeakers && hiddenSpeakers.includes(speaker)) continue;

    // Skip unintelligible segments when hidden
    if (hideUnintelligible && t.unintelligible) continue;

    if (!currentGroup || currentGroup.speaker !== speaker) {
      currentGroup = { speaker, items: [], isGeneric: isGenericSpeaker(speaker) };
      groups.push(currentGroup);
    }

    currentGroup.items.push({
      text: t.translated || t.original,
      start: seg.start,
      speaker,
      unintelligible: t.unintelligible,
    });
  }

  for (const group of groups) {
    const block = document.createElement('div');
    block.className = 'reader-speaker-block';
    if (group.isGeneric) block.classList.add('dimmed-speaker');

    const displayName = speakerMap[group.speaker] || group.speaker;
    const color = speakerColors[group.speaker] || '#DD2C1E';
    block.style.setProperty('--speaker-color', color);

    const nameEl = document.createElement('div');
    nameEl.className = 'reader-speaker-name';
    nameEl.textContent = displayName;
    block.appendChild(nameEl);

    const para = document.createElement('p');
    para.className = 'reader-para';

    for (const item of group.items) {
      const span = document.createElement('span');
      span.className = item.unintelligible ? 'seg seg-unintelligible' : 'seg';
      span.dataset.start = item.start;
      span.dataset.speaker = item.speaker;
      span.textContent = item.text + ' ';
      para.appendChild(span);
    }

    block.appendChild(para);
    container.appendChild(block);
  }
}

// Intercept copy in reader — prepend [Speaker — TC]
$('#reader-content').addEventListener('copy', (e) => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  let node = selection.anchorNode;
  while (node && !(node.dataset && node.dataset.start)) {
    node = node.parentElement;
  }

  if (!node) return;

  const speaker = node.dataset.speaker;
  const tc = formatTimecodeShort(node.dataset.start);

  e.preventDefault();
  e.clipboardData.setData('text/plain', `[${speaker} — ${tc}] ${selectedText}`);

  const fb = $('#reader-copy-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
});

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
  if (translations.length > 0) buildReaderView();
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
        // Regenerate with current slider settings before exporting
        if (translations.length > 0) regenerateSRT();
        const blob = new Blob([srtContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'subtitles.srt';
        a.click();
        URL.revokeObjectURL(url);
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
  try {
    if (!segments || segments.length === 0) {
      console.warn('No segments to summarize');
      return;
    }

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

// ── Init: load projects and auto-reload last transcript ──
(async function init() {
  // Migrate localStorage → Supabase in background (non-blocking)
  migrateLocalStorageToSupabase()
    .then(r => { if (r.migrated) console.info(`Migrated ${r.transcripts} transcripts, ${r.projects} projects to Supabase`); })
    .catch(err => console.warn('Migration check failed:', err.message));

  // Priority: URL permalink > localStorage last transcript
  const permalink = getPermalinkId();
  const lastSaved = getLastTranscript();

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
  } else if (lastSaved) {
    loadPromise = handleLoad(lastSaved)
      .then(() => setPermalinkHash(currentSlug || currentTranscriptId))
      .catch(err => {
        console.warn('Auto-reload failed:', err.message);
        clearPermalinkHash();
        clearLastTranscript();
      });
  }

  await Promise.all([projectsPromise, loadPromise]);
})();
