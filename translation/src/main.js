import { parseCSV, getStats, cleanSpeakerName, buildSpeakerMap, isGenericSpeaker, getSequenceMetadata } from './csv-parser.js';
import { parseJSON } from './json-parser.js';
import { formatPreciseTimecode } from './timecode-utils.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';
import { saveTranscript, updateTranscript, listTranscripts, loadTranscript, deleteTranscript, restoreTranscript, permanentlyDeleteTranscript, listDeletedTranscripts, createProject, listProjects, deleteProject, supabaseAvailable, getStorageInfo, migrateLocalStorageToSupabase } from './db.js';
import { mountEditor } from './editor/mount.js';
import { buildEditorDocument, getDismissedSegmentNumbers } from './editor/document-builder.js';
import { mountTagSearch } from './tags/mount.js';
import { mountCopilot } from './copilot/mount.js';
import { buildPremiereXML, buildPremiereSequenceXML, buildSacredSequencerXML } from './export/premiere-xml.js';
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
const btnSave = $('#btn-save');
const saveModal = $('#save-modal');
const saveNameInput = $('#save-name');
const btnSaveConfirm = $('#btn-save-confirm');
const btnSaveCancel = $('#btn-save-cancel');
const libraryView = $('#library-view');
const libraryList = $('#library-list');
const libraryEmpty = $('#library-empty');
const stepsNav = $('.steps');
const btnSpeakerToggle = $('#btn-speaker-toggle');
const projectModal = $('#project-modal');
const projectNameInput = $('#project-name');
const btnProjectConfirm = $('#btn-project-confirm');
const btnProjectCancel = $('#btn-project-cancel');
const btnNewProject = $('#btn-new-project');
const projectSelect = $('#project-select');
const saveProjectSelect = $('#save-project-select');

// ── Step navigation ──
let libraryShowing = false;

function goToStep(n) {
  currentStep = n;

  // Hide library if showing
  if (libraryShowing) {
    libraryView.classList.remove('active');
    stepsNav.classList.remove('hidden');
    libraryShowing = false;
  }

  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`#step-${n}`).classList.add('active');

  $$('.steps .step').forEach(s => {
    const sn = parseInt(s.dataset.step);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
}

function showLibrary() {
  libraryShowing = true;
  $$('.panel').forEach(p => p.classList.remove('active'));
  stepsNav.classList.add('hidden');
  libraryView.classList.add('active');
  fetchLibrary();
}

// ── Library ──
async function fetchLibrary() {
  try {
    const [p, transcripts, deleted] = await Promise.all([
      listProjects(),
      listTranscripts(),
      listDeletedTranscripts(),
    ]);
    projects = p;
    renderLibrary(transcripts, projects, deleted);
  } catch (err) {
    libraryList.innerHTML = '';
    libraryEmpty.classList.remove('hidden');
    console.error('Failed to load library:', err);
  }
}

function renderLibrary(transcripts, projectsList, deletedTranscripts) {
  if ((!transcripts || transcripts.length === 0) && (!projectsList || projectsList.length === 0) && (!deletedTranscripts || deletedTranscripts.length === 0)) {
    libraryList.innerHTML = '';
    libraryEmpty.classList.remove('hidden');
    return;
  }

  libraryEmpty.classList.add('hidden');

  // Group transcripts by project
  const byProject = {};
  const unsorted = [];
  for (const t of (transcripts || [])) {
    if (t.project_id) {
      if (!byProject[t.project_id]) byProject[t.project_id] = [];
      byProject[t.project_id].push(t);
    } else {
      unsorted.push(t);
    }
  }

  let html = '';

  // Render each project group
  for (const proj of (projectsList || [])) {
    const items = byProject[proj.id] || [];
    html += `
      <div class="library-project-group">
        <div class="library-project-header">
          <span class="np-eyebrow np-eyebrow--red">${esc(proj.name)}</span>
          <button class="np-button library-delete-project-btn" data-id="${proj.id}" title="Delete project">&times;</button>
        </div>
        ${items.length === 0 ? '<p class="library-project-empty">No transcripts</p>' : ''}
        ${items.map(t => renderLibraryItem(t)).join('')}
      </div>
    `;
  }

  // Unsorted section
  if (unsorted.length > 0) {
    html += `
      <div class="library-project-group">
        <div class="library-project-header">
          <span class="np-eyebrow">Unsorted</span>
        </div>
        ${unsorted.map(t => renderLibraryItem(t)).join('')}
      </div>
    `;
  }

  // Recently Deleted section
  const deleted = (deletedTranscripts || []).filter(t => {
    // Only show items deleted within the last 30 days
    const deletedAt = new Date(t.deleted_at).getTime();
    return Date.now() - deletedAt < 30 * 24 * 60 * 60 * 1000;
  });
  if (deleted.length > 0) {
    html += `
      <div class="library-deleted-section">
        <button class="library-deleted-toggle" id="deleted-toggle">
          <span class="np-eyebrow">Recently Deleted</span>
          <span class="library-deleted-count">${deleted.length}</span>
        </button>
        <div class="library-deleted-list hidden" id="deleted-list">
          ${deleted.map(t => {
            const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(t.deleted_at).getTime()) / (24 * 60 * 60 * 1000)));
            return `
              <div class="library-item library-item--deleted" data-id="${t.id}">
                <div class="library-item-info">
                  <div class="library-item-name">${esc(t.name)}</div>
                  <div class="library-item-meta">
                    <span class="library-item-time">${daysLeft}d until permanent deletion</span>
                  </div>
                </div>
                <div class="library-item-actions">
                  <button class="header-btn library-restore-btn" data-id="${t.id}">Restore</button>
                  <button class="header-btn library-permadelete-btn" data-id="${t.id}">&times;</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  libraryList.innerHTML = html;

  // Wire up buttons
  libraryList.querySelectorAll('.library-load-btn').forEach(btn => {
    btn.addEventListener('click', () => handleLoad(btn.dataset.id));
  });
  libraryList.querySelectorAll('.library-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
  libraryList.querySelectorAll('.library-delete-project-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteProject(btn.dataset.id);
      fetchLibrary();
    });
  });

  // Recently Deleted toggle
  const deletedToggle = document.getElementById('deleted-toggle');
  const deletedListEl = document.getElementById('deleted-list');
  if (deletedToggle && deletedListEl) {
    deletedToggle.addEventListener('click', () => {
      deletedListEl.classList.toggle('hidden');
    });
  }

  // Restore buttons
  libraryList.querySelectorAll('.library-restore-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await restoreTranscript(btn.dataset.id);
      fetchLibrary();
    });
  });

  // Permanent delete buttons
  libraryList.querySelectorAll('.library-permadelete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await permanentlyDeleteTranscript(btn.dataset.id);
      fetchLibrary();
    });
  });
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

function renderLibraryItem(t) {
  const timeAgo = relativeTime(t.updated_at);
  const stepLabel = STEP_LABELS[t.step] || 'Upload';
  const meta = t.metadata || {};
  const segCount = meta.segmentCount;
  return `
    <div class="library-item" data-id="${t.id}">
      <div class="library-item-info">
        <div class="library-item-name">${esc(t.name)}</div>
        <div class="library-item-meta">
          <span class="library-item-time">${timeAgo}</span>
          <span class="library-item-step">Step ${t.step}: ${stepLabel}</span>
          ${segCount ? `<span class="library-item-segments">${segCount} segments</span>` : ''}
        </div>
      </div>
      <div class="library-item-actions">
        <button class="np-button library-load-btn" data-id="${t.id}">Load</button>
        <button class="np-button library-delete-btn" data-id="${t.id}">&times;</button>
      </div>
    </div>
  `;
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
    rememberLastTranscript(t.id);
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

// ── Save ──
btnSave.addEventListener('click', () => {
  // Pre-fill name
  if (currentTranscriptName) {
    saveNameInput.value = currentTranscriptName;
  } else {
    const firstSpeaker = segments[0]?.speaker || '';
    const cleanName = speakerMap[firstSpeaker] || firstSpeaker;
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    saveNameInput.value = cleanName ? `${cleanName} — ${date}` : '';
  }
  refreshProjectSelects();
  saveModal.classList.remove('hidden');
  saveNameInput.focus();
});

btnSaveCancel.addEventListener('click', () => {
  saveModal.classList.add('hidden');
});

saveModal.addEventListener('click', (e) => {
  if (e.target === saveModal) saveModal.classList.add('hidden');
});

btnSaveConfirm.addEventListener('click', async () => {
  const name = saveNameInput.value.trim();
  if (!name) return;

  btnSaveConfirm.textContent = 'Saving...';
  btnSaveConfirm.disabled = true;

  try {
    // Create new project if selected
    if (saveProjectSelect?.value === '__new__') {
      const projName = saveNewProjectInput?.value?.trim();
      if (projName) {
        const proj = await createProject({ name: projName });
        projects.push(proj);
        currentProjectId = proj.id;
      }
    } else if (saveProjectSelect) {
      currentProjectId = saveProjectSelect.value || null;
    }

    const payload = gatherState(name);

    if (currentTranscriptId) {
      await updateTranscript(currentTranscriptId, payload);
    } else {
      const row = await saveTranscript(payload);
      currentTranscriptId = row.id;
      rememberLastTranscript(row.id);
    }

    currentTranscriptName = name;
    saveModal.classList.add('hidden');
  } catch (err) {
    console.error('Save failed:', err);
    const inner = saveModal.querySelector('.save-modal-inner');
    const existing = inner.querySelector('.error-msg');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'error-msg';
    div.textContent = 'Save failed: ' + err.message;
    inner.appendChild(div);
    setTimeout(() => div.remove(), 8000);
  } finally {
    btnSaveConfirm.textContent = 'Save';
    btnSaveConfirm.disabled = false;
  }
});

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
      const row = await saveTranscript(payload);
      currentTranscriptId = row.id;
      currentTranscriptName = name;
      rememberLastTranscript(row.id);
    }
    updateSaveStatus('saved');
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
  if (editorInstance) updateEditorInstance();
  debouncedAutoSave();
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
$('#btn-search').addEventListener('click', () => {
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

function showSequencer() {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('sequencer-view').classList.remove('hidden');
  document.body.style.background = '#0b0b2e';
}

function exitSequencer() {
  document.getElementById('sequencer-view').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.body.style.background = '';
  // Reset sequencer state
  seqSoundbites = [];
  $('#seq-arrange').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  $('#seq-input').value = '';
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

function renderSeqBlocks() {
  const container = $('#seq-blocks');
  const status = $('#seq-status');
  status.textContent = `${seqSoundbites.length} soundbite${seqSoundbites.length !== 1 ? 's' : ''} · ~${formatDuration(seqSoundbites)} total`;

  container.innerHTML = seqSoundbites.map(b => `
    <div class="seq-block" draggable="true" data-id="${b.id}">
      <div class="seq-block-handle">⠿</div>
      <div class="seq-block-body">
        <div class="seq-block-time">${b.start} → ${b.end}</div>
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

$('#seq-parse-btn').addEventListener('click', () => {
  const raw = $('#seq-input').value;
  seqSoundbites = parseSoundbites(raw);
  if (seqSoundbites.length === 0) return;

  // Auto-detect sacred sequence name
  const sacredName = extractSacredName(seqSoundbites[0].prefix);
  $('#seq-name').value = sacredName;

  $('#seq-paste').classList.add('hidden');
  $('#seq-arrange').classList.remove('hidden');
  renderSeqBlocks();
});

$('#seq-back-btn').addEventListener('click', () => {
  $('#seq-arrange').classList.add('hidden');
  $('#seq-paste').classList.remove('hidden');
  $('#seq-input').value = '';
  seqSoundbites = [];
});

$('#seq-export-btn').addEventListener('click', () => {
  if (seqSoundbites.length === 0) return;

  const sacredSequenceName = $('#seq-name').value.trim() || 'Sacred Sequence';
  const fps = parseFloat($('#seq-fps').value) || 23.976;
  const gapFrames = parseInt($('#seq-gap').value) || 12;

  const xml = buildSacredSequencerXML({
    soundbites: seqSoundbites,
    sacredSequenceName,
    fps,
    gapFrames,
  });

  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sacredSequenceName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-sacred-selects.xml`;
  a.click();
  URL.revokeObjectURL(url);
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

// ── Projects ──
btnNewProject.addEventListener('click', () => {
  projectNameInput.value = '';
  projectModal.classList.remove('hidden');
  projectNameInput.focus();
});

btnProjectCancel.addEventListener('click', () => {
  projectModal.classList.add('hidden');
});

projectModal.addEventListener('click', (e) => {
  if (e.target === projectModal) projectModal.classList.add('hidden');
});

btnProjectConfirm.addEventListener('click', async () => {
  const name = projectNameInput.value.trim();
  if (!name) return;
  btnProjectConfirm.textContent = 'Creating...';
  btnProjectConfirm.disabled = true;
  try {
    const proj = await createProject({ name });
    projects.push(proj);
    currentProjectId = proj.id;
    projectModal.classList.add('hidden');
    refreshProjectSelects();
    if (libraryShowing) fetchLibrary();
  } catch (err) {
    console.error('Failed to create project:', err);
    // Show error inside the modal so it's visible
    const inner = projectModal.querySelector('.save-modal-inner');
    const existing = inner.querySelector('.error-msg');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'error-msg';
    div.textContent = 'Failed to create project: ' + err.message;
    inner.appendChild(div);
    setTimeout(() => div.remove(), 8000);
  } finally {
    btnProjectConfirm.textContent = 'Create';
    btnProjectConfirm.disabled = false;
  }
});

// Project select in save modal
const saveNewProjectDiv = $('#save-new-project');
const saveNewProjectInput = $('#save-new-project-name');

async function refreshProjectSelects() {
  try {
    projects = await listProjects();
  } catch {}
  const opts = '<option value="">No project</option>' +
    projects.map(p => `<option value="${p.id}" ${p.id === currentProjectId ? 'selected' : ''}>${esc(p.name)}</option>`) .join('') +
    '<option value="__new__">+ New project</option>';
  if (saveProjectSelect) saveProjectSelect.innerHTML = opts;
  if (saveNewProjectDiv) saveNewProjectDiv.classList.add('hidden');
}

if (saveProjectSelect) {
  saveProjectSelect.addEventListener('change', () => {
    if (saveProjectSelect.value === '__new__') {
      saveNewProjectDiv.classList.remove('hidden');
      // Default project name to primary speaker
      const seqMeta = getSeqMeta();
      saveNewProjectInput.value = seqMeta.primarySpeaker || '';
      saveNewProjectInput.focus();
    } else {
      saveNewProjectDiv.classList.add('hidden');
    }
  });
}

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
  if (copilotPanel) copilotPanel.classList.remove('open');
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = '';
  stepsNav.classList.remove('hidden');
  goToStep(1);
}

const btnStartNew = document.getElementById('btn-start-new');
if (btnStartNew) btnStartNew.addEventListener('click', resetToUpload);

const headerLogo = document.getElementById('header-logo');
if (headerLogo) {
  headerLogo.addEventListener('click', (e) => {
    e.preventDefault();
    resetToUpload();
  });
}

// ── Permalink support ──
function getPermalinkId() {
  const hash = window.location.hash;
  const match = hash.match(/^#t=(.+)/);
  return match ? match[1] : null;
}

function setPermalinkHash(id) {
  if (id) {
    history.replaceState(null, '', '#t=' + id);
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
    setPermalinkHash(currentTranscriptId);
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      btnShare.textContent = 'Link Copied!';
      setTimeout(() => { btnShare.textContent = 'Share Link'; }, 2000);
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
  const permalinkId = getPermalinkId();
  const loadId = permalinkId || getLastTranscript();

  // Load projects and transcript in parallel
  const projectsPromise = listProjects().then(p => { projects = p; refreshProjectSelects(); }).catch(() => {});
  const loadPromise = loadId
    ? handleLoad(loadId).then(() => setPermalinkHash(loadId)).catch(err => {
        console.warn('Auto-reload failed:', err.message);
        clearPermalinkHash();
        if (permalinkId) {
          showError('Could not load shared transcript. It may have been deleted or the database is temporarily unavailable.');
        } else {
          clearLastTranscript();
        }
      })
    : Promise.resolve();

  await Promise.all([projectsPromise, loadPromise]);
})();
