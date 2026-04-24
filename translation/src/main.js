import { parseCSV, getStats } from './csv-parser.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';

// ── State ──
let segments = [];
let analysis = null;     // { narrative_summary, language_map, questions }
let translations = [];    // [{ number, original, translated, language, kept_original }]
let srtContent = '';
let currentStep = 1;

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

// ── Step navigation ──
function goToStep(n) {
  currentStep = n;
  $$('.panel').forEach(p => p.classList.remove('active'));
  $(`#step-${n}`).classList.add('active');

  $$('.steps .step').forEach(s => {
    const sn = parseInt(s.dataset.step);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done', sn < n);
  });
}

// ── Step 1: Upload ──
function handleFile(file) {
  if (!file || !file.name.endsWith('.csv')) {
    showError('Please upload a .csv file');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      segments = parseCSV(e.target.result);
      renderTranscript();
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsText(file);
}

function renderTranscript() {
  const stats = getStats(segments);
  $('#stat-segments').textContent = `${stats.segmentCount} segments`;
  $('#stat-duration').textContent = `Duration: ${stats.duration}`;
  $('#stat-speakers').textContent = `${stats.speakerCount} speaker${stats.speakerCount !== 1 ? 's' : ''}`;

  transcriptBody.innerHTML = segments
    .map(s => `<tr>
      <td>${s.number}</td>
      <td>${esc(s.speaker)}</td>
      <td>${esc(s.start)}</td>
      <td>${esc(s.end)}</td>
      <td>${esc(s.text)}</td>
    </tr>`)
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
    renderAnalysis();
  } catch (err) {
    $('#analyze-loading').classList.add('hidden');
    showError(err.message, '#step-2');
  }
});

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

  const qCount = analysis.questions?.length || 0;
  const notice = $('#questions-notice');
  if (qCount > 0) {
    notice.innerHTML = `<p style="margin-top:0.5rem;color:#555;">Claude has <strong>${qCount}</strong> clarification question${qCount > 1 ? 's' : ''}.</p>`;
    btnToClarify.textContent = 'Answer Questions';
  } else {
    notice.innerHTML = `<p style="margin-top:0.5rem;color:#555;">No clarification questions — ready to translate.</p>`;
    btnToClarify.textContent = 'Skip to Translate';
  }
}

// ── Step 3: Clarify ──
btnToClarify.addEventListener('click', () => {
  const questions = analysis?.questions || [];
  if (questions.length === 0) {
    // Skip to translate directly
    startTranslation();
    return;
  }

  goToStep(3);
  renderQuestions(questions);
});

function renderQuestions(questions) {
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
  goToStep(4);
  $('#translate-loading').classList.remove('hidden');
  $('#translate-result').classList.add('hidden');

  const clarifications = gatherClarifications();

  try {
    const result = await translateSegments({
      segments,
      languageMap: analysis?.language_map || {},
      narrativeSummary: analysis?.narrative_summary || '',
      clarifications,
    });

    translations = result;
    renderTranslations();
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
    .map((t, i) => `<tr>
      <td>${t.number}</td>
      <td>${esc(t.original)}</td>
      <td class="editable" data-idx="${i}">
        ${esc(t.translated)}
        ${t.kept_original ? '<span class="kept-badge">kept</span>' : ''}
      </td>
    </tr>`)
    .join('');

  // Inline editing
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

// Slider controls
$('#max-words').addEventListener('input', (e) => {
  $('#max-words-val').textContent = e.target.value;
});

$('#max-duration').addEventListener('input', (e) => {
  $('#max-duration-val').textContent = e.target.value;
});

// ── Step 5: Export ──
btnExport.addEventListener('click', () => {
  const maxWords = parseInt($('#max-words').value);
  const maxDuration = parseInt($('#max-duration').value);

  srtContent = buildSRT(translations, segments, { maxWords, maxDuration });
  goToStep(5);

  $('#srt-preview').textContent = srtContent;
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

// ── Helpers ──
function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
