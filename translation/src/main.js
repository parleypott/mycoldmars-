import { parseCSV, getStats } from './csv-parser.js';
import { analyzeTranscript, translateSegments } from './api-client.js';
import { buildSRT } from './srt-builder.js';

// ── State ──
let segments = [];
let analysis = null;     // { narrative_summary, language_map, themes, questions, generic_segments }
let translations = [];    // [{ number, original, translated, language, kept_original, unintelligible }]
let srtContent = '';
let currentStep = 1;
let bank = [];          // [{ id, speaker, tc, text }]

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

  // Show generic segment count
  const genericCount = analysis.generic_segments?.length || 0;
  const notice = $('#questions-notice');
  const qCount = analysis.questions?.length || 0;
  let noticeHtml = '';

  if (genericCount > 0) {
    noticeHtml += `<p style="margin-top:0.5rem;color:var(--muted);font-family:var(--font-mono);font-size:0.75rem;">${genericCount} unlabeled segment${genericCount > 1 ? 's' : ''} will be marked [unintelligible]</p>`;
  }

  if (qCount > 0) {
    noticeHtml += `<p style="margin-top:0.5rem;color:var(--muted);font-family:var(--font-mono);font-size:0.75rem;">${qCount} clarification question${qCount > 1 ? 's' : ''}</p>`;
  }

  notice.innerHTML = noticeHtml;
  btnToClarify.innerHTML = 'Continue &rarr;';
}

// ── Step 3: Clarify ──
btnToClarify.addEventListener('click', () => {
  goToStep(3);
  renderClarifyStep();
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
  goToStep(4);
  $('#translate-loading').classList.remove('hidden');
  $('#translate-result').classList.add('hidden');

  const clarifications = gatherClarifications();
  const editorialFocus = $('#editorial-focus')?.value?.trim() || '';

  try {
    const loadingText = $('#translate-loading p');
    const result = await translateSegments({
      segments,
      languageMap: analysis?.language_map || {},
      narrativeSummary: analysis?.narrative_summary || '',
      clarifications,
      editorialFocus,
      onProgress: (done, total) => {
        loadingText.textContent = `Translating batch ${done} of ${total}...`;
      },
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

// Slider controls
$('#max-words').addEventListener('input', (e) => {
  $('#max-words-val').textContent = e.target.value;
});

$('#max-duration').addEventListener('input', (e) => {
  $('#max-duration-val').textContent = e.target.value + 's';
});

// ── Step 5: Export ──
btnExport.addEventListener('click', () => {
  const maxWords = parseInt($('#max-words').value);
  const maxDuration = parseInt($('#max-duration').value);

  srtContent = buildSRT(translations, segments, { maxWords, maxDuration });
  goToStep(5);

  $('#srt-preview').textContent = srtContent;
  buildReaderView();
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

// ── View toggle (SRT / Reader) ──
function switchView(view) {
  ['srt', 'reader'].forEach(v => {
    $(`#btn-view-${v}`).classList.toggle('active', v === view);
    $(`#${v}-view`).classList.toggle('hidden', v !== view);
  });
}
$('#btn-view-srt').addEventListener('click', () => switchView('srt'));
$('#btn-view-reader').addEventListener('click', () => switchView('reader'));

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

    if (!currentGroup || currentGroup.speaker !== speaker) {
      currentGroup = { speaker, items: [] };
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

    const nameEl = document.createElement('div');
    nameEl.className = 'reader-speaker-name';
    nameEl.textContent = group.speaker;
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

// Intercept copy in reader — prepend [Speaker — TC] and bank it
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

  // Auto-bank the bite
  addToBank(speaker, tc, selectedText);

  const fb = $('#reader-copy-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
});

// ── Bank ──
let bankId = 0;

function addToBank(speaker, tc, text) {
  bank.push({ id: ++bankId, speaker, tc, text });
  renderBank();
}

function renderBank() {
  const list = $('#bank-list');
  const empty = $('#bank-empty');
  const actions = $('#bank-actions');
  const countEl = $('#bank-count');

  if (bank.length === 0) {
    empty.classList.remove('hidden');
    actions.classList.add('hidden');
    countEl.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  actions.classList.remove('hidden');
  countEl.classList.remove('hidden');
  countEl.textContent = bank.length;

  list.innerHTML = bank.map(item => `
    <div class="bank-item" data-bank-id="${item.id}">
      <button class="bank-item-x" data-bank-id="${item.id}">&times;</button>
      <div class="bank-item-meta">
        <span class="bank-item-speaker">${esc(item.speaker)}</span>
        <span class="bank-item-tc">${esc(item.tc)}</span>
      </div>
      <div class="bank-item-text">${esc(item.text)}</div>
    </div>
  `).join('');

  // Wire up X buttons
  list.querySelectorAll('.bank-item-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.bankId);
      const el = list.querySelector(`.bank-item[data-bank-id="${id}"]`);
      el.classList.add('removing');
      el.addEventListener('animationend', () => {
        bank = bank.filter(b => b.id !== id);
        renderBank();
      });
    });
  });
}

// Copy all banked items
$('#btn-bank-copy-all').addEventListener('click', async () => {
  const text = bank.map(b => `[${b.speaker} — ${b.tc}] ${b.text}`).join('\n\n');
  await navigator.clipboard.writeText(text);
  const fb = $('#bank-copy-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
});

// Clear all
$('#btn-bank-clear').addEventListener('click', () => {
  bank = [];
  renderBank();
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
