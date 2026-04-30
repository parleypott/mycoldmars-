import { detectThemes, extractSoundbites } from '../api-client.js';
import { formatPreciseTimecode, parseTimecodeToSeconds } from '../timecode-utils.js';
import { chattyStart, chattyUpdate, chattyEnd, THEME_DETECT_PHRASES, WORKSHOP_PROCESS_PHRASES } from '../chatty-loader.js';

/**
 * Mount the Soundbite Workshop into a container.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 *   - segments: array of { number, speaker, start, end, text }
 *   - editorialFocus: string (optional context for the LLM)
 *   - narrativeSummary: string (optional context for the LLM)
 *   - initialState: { themes, soundbites, openThemes } persisted from prior session
 *   - onUpdate(state): called when state changes that should be persisted
 */
export function mountWorkshop(container, opts) {
  const state = {
    phase: 'bank',                 // 'bank' | 'processing' | 'viewer'
    themes: [],                    // [{ id, name, description }]
    soundbites: [],                // [{ segmentNumber, themes: [name], label? }]
    openThemes: {},                // { themeName: true } — which accordion sections are open
    detecting: false,
    processing: false,
    progress: { done: 0, total: 0 },
    error: null,
  };

  const initial = opts.initialState || {};
  if (Array.isArray(initial.themes) && initial.themes.length > 0) {
    state.themes = initial.themes.map(t => ({
      id: t.id || rid(),
      name: t.name || '',
      description: t.description || '',
    }));
  }
  if (Array.isArray(initial.soundbites)) state.soundbites = initial.soundbites;
  if (initial.openThemes && typeof initial.openThemes === 'object') state.openThemes = initial.openThemes;

  if (state.soundbites.length > 0) state.phase = 'viewer';

  function persist() {
    if (typeof opts.onUpdate === 'function') {
      opts.onUpdate({
        themes: state.themes,
        soundbites: state.soundbites,
        openThemes: state.openThemes,
      });
    }
  }

  function render() {
    if (state.phase === 'bank') return renderBank();
    if (state.phase === 'processing') return renderProcessing();
    return renderViewer();
  }

  function renderBank() {
    container.innerHTML = `
      <div class="ws">
        <div class="ws-header">
          <div>
            <div class="np-eyebrow np-eyebrow--red">Soundbite Workshop</div>
            <h2 class="ws-title">Theme Bank</h2>
            <p class="ws-desc">Define the buckets you want soundbites organized into. Edit the auto-detected themes, add your own, then process the transcript.</p>
          </div>
          ${state.themes.length > 0 ? `<button class="np-button" data-act="redetect">Re-detect themes</button>` : ''}
        </div>

        ${state.error ? `<div class="ws-error">${escapeHtml(state.error)}</div>` : ''}

        ${state.detecting
          ? `<div class="ws-loading"><div class="np-eyebrow">Detecting themes...</div><div class="loading-bar"><div class="loading-bar-fill"></div></div></div>`
          : `
            <div class="ws-themes" id="ws-themes">
              ${state.themes.map(renderThemeCard).join('')}
              <button class="ws-add-theme" data-act="add">+ Add theme</button>
            </div>
            <div class="ws-bank-actions">
              <button class="np-button np-button--primary" data-act="process" ${state.themes.length === 0 ? 'disabled' : ''}>Process transcript</button>
            </div>
          `}
      </div>
    `;
    bindBank();
  }

  function renderThemeCard(theme) {
    return `
      <div class="ws-theme" data-id="${theme.id}">
        <input class="ws-theme-name" data-field="name" type="text" placeholder="Theme name" value="${escapeAttr(theme.name)}">
        <textarea class="ws-theme-desc" data-field="description" placeholder="What kind of soundbite belongs here?">${escapeHtml(theme.description)}</textarea>
        <button class="ws-theme-remove" data-act="remove" title="Remove theme">×</button>
      </div>
    `;
  }

  function bindBank() {
    container.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const act = btn.dataset.act;
        if (act === 'add') {
          state.themes.push({ id: rid(), name: '', description: '' });
          persist();
          render();
          // focus newly added input
          const cards = container.querySelectorAll('.ws-theme');
          cards[cards.length - 1]?.querySelector('input')?.focus();
        } else if (act === 'remove') {
          const id = btn.closest('.ws-theme').dataset.id;
          state.themes = state.themes.filter(t => t.id !== id);
          persist();
          render();
        } else if (act === 'process') {
          processTranscript();
        } else if (act === 'redetect') {
          if (confirm('Re-detect themes? This will replace your current theme list.')) {
            state.themes = [];
            persist();
            startDetection();
          }
        }
      });
    });

    // Edits to theme name/description
    container.querySelectorAll('.ws-theme input, .ws-theme textarea').forEach(field => {
      field.addEventListener('input', () => {
        const card = field.closest('.ws-theme');
        const id = card.dataset.id;
        const theme = state.themes.find(t => t.id === id);
        if (!theme) return;
        theme[field.dataset.field] = field.value;
        persist();
      });
    });
  }

  async function startDetection() {
    state.detecting = true;
    state.error = null;
    render();
    const loaderId = 'workshop-detect-' + rid();
    chattyStart(loaderId, THEME_DETECT_PHRASES);
    try {
      const detected = await detectThemes(opts.segments, {
        editorialFocus: opts.editorialFocus,
        narrativeSummary: opts.narrativeSummary,
      });
      state.themes = detected.map(t => ({ id: rid(), name: t.name || '', description: t.description || '' }));
    } catch (e) {
      state.error = 'Theme detection failed: ' + e.message;
    } finally {
      chattyEnd(loaderId);
      state.detecting = false;
      persist();
      render();
    }
  }

  async function processTranscript() {
    if (state.themes.length === 0) return;
    state.phase = 'processing';
    state.processing = true;
    state.progress = { done: 0, total: 0 };
    state.error = null;
    render();
    const loaderId = 'workshop-process-' + rid();
    chattyStart(loaderId, WORKSHOP_PROCESS_PHRASES, { progress: 0 });
    try {
      const bites = await extractSoundbites({
        segments: opts.segments,
        themes: state.themes,
        editorialFocus: opts.editorialFocus,
        narrativeSummary: opts.narrativeSummary,
        onProgress: (done, total) => {
          state.progress = { done, total };
          updateProgressBar();
          chattyUpdate(loaderId, { progress: total > 0 ? done / total : 0 });
        },
      });
      state.soundbites = bites;
      const counts = countByTheme(state.soundbites);
      const top = state.themes.map(t => t.name).sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
      if (top) state.openThemes = { [top]: true };
      state.phase = 'viewer';
    } catch (e) {
      state.error = 'Soundbite extraction failed: ' + e.message;
      state.phase = 'bank';
    } finally {
      chattyEnd(loaderId);
      state.processing = false;
      persist();
      render();
    }
  }

  function renderProcessing() {
    container.innerHTML = `
      <div class="ws ws-processing">
        <div class="np-eyebrow np-eyebrow--red">Soundbite Workshop</div>
        <h2 class="ws-title">Extracting soundbites...</h2>
        <p class="ws-desc">Reading the transcript through your theme bank.</p>
        <div class="loading-bar"><div class="loading-bar-fill" id="ws-progress-fill"></div></div>
        <div class="ws-progress-text" id="ws-progress-text">0 of 0 chunks</div>
      </div>
    `;
  }

  function updateProgressBar() {
    const fill = container.querySelector('#ws-progress-fill');
    const text = container.querySelector('#ws-progress-text');
    if (!fill || !text) return;
    const { done, total } = state.progress;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    fill.style.width = pct + '%';
    text.textContent = `${done} of ${total} chunks`;
  }

  function renderViewer() {
    const segByNum = {};
    for (const s of opts.segments) segByNum[s.number] = s;

    const counts = countByTheme(state.soundbites);
    const groups = state.themes.map(t => ({
      theme: t,
      count: counts[t.name] || 0,
    }));

    // Soundbites that don't match any theme (or don't match a theme that still exists)
    const themeNames = new Set(state.themes.map(t => t.name));
    const unclassified = state.soundbites.filter(b => !(b.themes || []).some(n => themeNames.has(n)));

    container.innerHTML = `
      <div class="ws">
        <div class="ws-toolbar">
          <div class="ws-toolbar-summary">
            <strong>${state.soundbites.length}</strong> soundbites · <strong>${state.themes.length}</strong> themes
          </div>
          <div class="ws-toolbar-actions">
            <button class="np-button" data-act="reprocess">Re-process</button>
            <button class="np-button" data-act="edit-themes">Edit themes</button>
          </div>
        </div>

        <div class="ws-accordion">
          ${groups.map(g => renderThemeSection(g, segByNum)).join('')}
          ${unclassified.length > 0
            ? renderUnclassifiedSection(unclassified, segByNum)
            : ''}
        </div>
      </div>
    `;

    bindViewer();
  }

  function renderThemeSection({ theme, count }, segByNum) {
    const isOpen = !!state.openThemes[theme.name];
    const bitesForTheme = state.soundbites
      .filter(b => (b.themes || []).indexOf(theme.name) !== -1)
      .map(b => ({ bite: b, seg: segByNum[b.segmentNumber] }))
      .filter(x => x.seg)
      .sort((a, b) => parseTimecodeToSeconds(a.seg.start) - parseTimecodeToSeconds(b.seg.start));

    return `
      <div class="ws-section ${isOpen ? 'open' : ''}" data-theme="${escapeAttr(theme.name)}">
        <button class="ws-section-header" data-act="toggle">
          <span class="ws-section-chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="ws-section-name">${escapeHtml(theme.name) || '(unnamed)'}</span>
          <span class="ws-section-count">${count}</span>
        </button>
        ${isOpen ? `
          <div class="ws-section-body" data-tc-copy>
            ${theme.description ? `<p class="ws-section-desc">${escapeHtml(theme.description)}</p>` : ''}
            ${bitesForTheme.length === 0
              ? `<p class="ws-section-empty">No soundbites tagged with this theme yet.</p>`
              : bitesForTheme.map(({ bite, seg }) => renderBite(bite, seg)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderUnclassifiedSection(unclassified, segByNum) {
    const isOpen = !!state.openThemes['__unclassified'];
    const bites = unclassified
      .map(b => ({ bite: b, seg: segByNum[b.segmentNumber] }))
      .filter(x => x.seg)
      .sort((a, b) => parseTimecodeToSeconds(a.seg.start) - parseTimecodeToSeconds(b.seg.start));

    return `
      <div class="ws-section ws-section--unclassified ${isOpen ? 'open' : ''}" data-theme="__unclassified">
        <button class="ws-section-header" data-act="toggle">
          <span class="ws-section-chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="ws-section-name">Unclassified</span>
          <span class="ws-section-count">${bites.length}</span>
        </button>
        ${isOpen ? `
          <div class="ws-section-body" data-tc-copy>
            ${bites.map(({ bite, seg }) => renderBite(bite, seg)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderBite(bite, seg) {
    const tc = formatTcShort(seg.start);
    const speaker = seg.speaker || 'Unknown';
    return `
      <div class="ws-bite" data-start="${escapeAttr(seg.start)}" data-speaker="${escapeAttr(speaker)}">
        <div class="ws-bite-meta">
          <span class="ws-bite-tc">${tc}</span>
          <span class="ws-bite-speaker">${escapeHtml(speaker)}</span>
          ${bite.label ? `<span class="ws-bite-label">${escapeHtml(bite.label)}</span>` : ''}
        </div>
        <div class="ws-bite-text">${escapeHtml(seg.text)}</div>
      </div>
    `;
  }

  function bindViewer() {
    container.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const act = btn.dataset.act;
        if (act === 'reprocess') {
          processTranscript();
        } else if (act === 'edit-themes') {
          state.phase = 'bank';
          render();
        } else if (act === 'toggle') {
          const section = btn.closest('.ws-section');
          const themeName = section.dataset.theme;
          state.openThemes[themeName] = !state.openThemes[themeName];
          if (!state.openThemes[themeName]) delete state.openThemes[themeName];
          persist();
          render();
        }
      });
    });

    // Copy-with-timecode: any selection inside [data-tc-copy] gets [Speaker — TC] prefix
    container.querySelectorAll('[data-tc-copy]').forEach(body => {
      body.addEventListener('copy', handleCopyWithTimecode);
    });
  }

  function handleCopyWithTimecode(e) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;

    let node = sel.anchorNode;
    while (node && !(node.dataset && node.dataset.start)) {
      node = node.parentElement;
    }
    if (!node) return;

    const speaker = node.dataset.speaker || 'Unknown';
    const tc = formatTcShort(node.dataset.start);

    e.preventDefault();
    e.clipboardData.setData('text/plain', `[${speaker} — ${tc}] ${text}`);

    flashCopyToast(container);
  }

  // Auto-detect themes if none exist yet.
  if (state.themes.length === 0 && state.phase === 'bank') {
    startDetection();
  } else {
    render();
  }

  // Public API: nothing yet, but return a destroy fn for symmetry.
  return {
    destroy() { container.innerHTML = ''; },
  };
}

// ── Helpers ──

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function countByTheme(soundbites) {
  const c = {};
  for (const b of soundbites) {
    for (const t of b.themes || []) c[t] = (c[t] || 0) + 1;
  }
  return c;
}

function formatTcShort(tc) {
  if (!tc) return '0:00';
  const f = parseFloat(tc);
  if (!isNaN(f) && /^\d+\.?\d*$/.test(String(tc).trim())) return formatPreciseTimecode(f);
  // Already a timecode string
  const m = String(tc).match(/(\d+):(\d+):(\d+)/);
  if (m) return parseInt(m[1]) > 0 ? `${m[1]}:${m[2]}:${m[3]}` : `${parseInt(m[2])}:${m[3]}`;
  const m2 = String(tc).match(/(\d+):(\d+)/);
  if (m2) return `${parseInt(m2[1])}:${m2[2]}`;
  return String(tc);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

let toastTimer = null;
function flashCopyToast(container) {
  let toast = container.querySelector('.ws-copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ws-copy-toast';
    toast.textContent = 'Copied with timecode.';
    container.appendChild(toast);
  }
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}
