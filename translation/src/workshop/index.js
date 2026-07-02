import { detectThemes, extractSoundbites, polishSoundbite } from '../api-client.js';
import { chattyStart, chattyUpdate, chattyEnd, THEME_DETECT_PHRASES, WORKSHOP_PROCESS_PHRASES } from '../chatty-loader.js';
import { countByTheme, formatTcShort, themeColor, resolveAndSortBites } from './workshop-format.js';
import { escapeHtml } from '../html-escape.js';

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
  // English per-segment, so the workshop renders the translation instead of the
  // source-language transcript. Johnny works in English here — he doesn't need
  // to read the original Chinese/etc. Falls back to the source text only for a
  // segment that has no translation yet.
  const translatedByNum = {};
  for (const t of (opts.translations || [])) {
    if (t && t.number != null && t.translated && t.translated !== '[chatter]') {
      translatedByNum[t.number] = t.translated;
    }
  }
  const biteText = (seg) => translatedByNum[seg.number] || seg.text;

  const state = {
    phase: 'bank',                 // 'bank' | 'processing' | 'viewer'
    themes: [],                    // [{ id, name, description }]
    soundbites: [],                // [{ segmentNumber, themes: [name], label? }]
    openThemes: {},                // { themeName: true } — which accordion sections are open
    detecting: false,
    processing: false,
    progress: { done: 0, total: 0 },
    error: null,
    // Per-bite ZAP state. Key = segmentNumber. Values:
    //   { status: 'loading' | 'ready' | 'error', chunks?, polished?, error? }
    // Not persisted — purely UI for the current session.
    zaps: {},
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
          <div class="ws-header-text">
            <div class="np-eyebrow np-eyebrow--red">Soundbite Workshop</div>
            <h2 class="ws-title">Theme Bank</h2>
            <p class="ws-desc">Define the buckets you want soundbites organized into. Edit the auto-detected themes, add your own, then process the transcript.</p>
          </div>
          ${state.themes.length > 0 ? `<button class="ws-redetect" data-act="redetect" title="Replace this list with a fresh AI pass">
            <span class="ws-redetect-icon" aria-hidden="true">↻</span>
            <span>Re-detect</span>
          </button>` : ''}
        </div>

        <div class="ws-process-hero">
          <button class="ws-process-hero-btn" data-act="process" ${state.themes.length === 0 ? 'disabled' : ''}>
            <span class="ws-process-hero-label">Process transcript</span>
            <span class="ws-process-hero-sub">${state.themes.length === 0 ? 'Add a theme to begin' : 'Read the transcript through your themes'}</span>
          </button>
        </div>

        ${state.error ? `<div class="ws-error">${escapeHtml(state.error)}</div>` : ''}

        ${state.detecting
          ? `<div class="ws-loading"><div class="np-eyebrow">Detecting themes...</div><div class="loading-bar"><div class="loading-bar-fill"></div></div></div>`
          : `
            <ol class="ws-themes" id="ws-themes">
              ${state.themes.map((t, i) => renderThemeCard(t, i)).join('')}
              <li class="ws-add-row">
                <button class="ws-add-theme" data-act="add">
                  <span class="ws-add-plus" aria-hidden="true">+</span>
                  <span>Add a theme</span>
                </button>
              </li>
            </ol>
          `}
      </div>
    `;
    bindBank();
  }

  function renderThemeCard(theme, idx) {
    const num = String(idx + 1).padStart(2, '0');
    const color = themeColor(theme.name || theme.id || '');
    return `
      <li class="ws-theme" data-id="${theme.id}" style="--theme-accent: ${color};">
        <div class="ws-theme-gutter" aria-hidden="true">
          <span class="ws-theme-num">${num}</span>
          <span class="ws-theme-mark"></span>
        </div>
        <div class="ws-theme-fields">
          <input class="ws-theme-name" data-field="name" type="text" placeholder="Theme name" value="${escapeAttr(theme.name)}">
          <textarea class="ws-theme-desc" data-field="description" rows="2" placeholder="What kind of soundbite belongs here?">${escapeHtml(theme.description)}</textarea>
        </div>
        <button class="ws-theme-remove" data-act="remove" title="Remove theme" aria-label="Remove theme">×</button>
      </li>
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
      const result = await extractSoundbites({
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
      const bites = result.bites;
      // Surface partial-failure count so the user knows the result is
      // incomplete and can re-run if they want full coverage.
      if (result.failedChunks > 0) {
        const ratio = `${result.failedChunks}/${result.totalChunks}`;
        state.error = `Partial result — ${ratio} sections couldn't be analyzed. Re-run to retry.`;
      }
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

    // Each section computes its own count from the RESOLVED bite list
    // (see renderThemeSection), so groups carries only the theme here.
    const groups = state.themes.map(t => ({ theme: t }));

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

  function renderThemeSection({ theme }, segByNum) {
    const isOpen = !!state.openThemes[theme.name];
    const taggedBites = state.soundbites.filter(b => (b.themes || []).indexOf(theme.name) !== -1);
    // Count from the RESOLVED list (not the raw tagged total) so the header
    // badge always matches the rows actually rendered below — a bite whose
    // segment was deleted/renumbered drops out of both together.
    const bitesForTheme = resolveAndSortBites(taggedBites, segByNum);

    return `
      <div class="ws-section ${isOpen ? 'open' : ''}" data-theme="${escapeAttr(theme.name)}">
        <button class="ws-section-header" data-act="toggle">
          <span class="ws-section-chevron">${isOpen ? '▾' : '▸'}</span>
          <span class="ws-section-name">${escapeHtml(theme.name) || '(unnamed)'}</span>
          <span class="ws-section-count">${bitesForTheme.length}</span>
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
    const bites = resolveAndSortBites(unclassified, segByNum);

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
    const zap = state.zaps[seg.number];
    return `
      <div class="ws-bite" data-start="${escapeAttr(seg.start)}" data-speaker="${escapeAttr(speaker)}" data-segnum="${seg.number}">
        <div class="ws-bite-meta">
          <span class="ws-bite-tc">${tc}</span>
          <span class="ws-bite-speaker">${escapeHtml(speaker)}</span>
          ${bite.label ? `<span class="ws-bite-label">${escapeHtml(bite.label)}</span>` : ''}
          <button class="ws-zap" data-act="zap" title="Craft a shorter, tighter version of this soundbite" aria-label="Shorten this soundbite">
            ${zap?.status === 'loading'
              ? `<span class="ws-zap-spin" aria-hidden="true"></span>`
              : `<svg class="ws-zap-bolt" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="3.3" cy="3.5" r="1.9"/>
                    <circle cx="3.3" cy="12.5" r="1.9"/>
                    <line x1="5" y1="4.7" x2="13.5" y2="12.6"/>
                    <line x1="5" y1="11.3" x2="13.5" y2="3.4"/>
                  </g>
                </svg>`
            }
            <span class="ws-zap-label">${zap?.status === 'loading' ? 'Shortening…' : 'Shorten'}</span>
          </button>
        </div>
        <div class="ws-bite-text">
          ${zap?.status === 'ready'
            ? renderZappedText(zap.chunks)
            : escapeHtml(biteText(seg))}
        </div>
        ${zap?.status === 'ready' ? `
          <div class="ws-bite-polished">
            <div class="ws-bite-polished-head">
              <span class="ws-bite-polished-eyebrow">Polished</span>
              <div class="ws-bite-polished-actions">
                <button class="ws-zap-action ws-zap-accept" data-act="zap-accept" title="Use this version everywhere it's copied">Use polished</button>
                <button class="ws-zap-action ws-zap-undo" data-act="zap-undo" title="Discard the proposal">Discard</button>
              </div>
            </div>
            <div class="ws-bite-polished-text">${escapeHtml(zap.polished)}</div>
          </div>
        ` : ''}
        ${zap?.status === 'error' ? `<div class="ws-bite-zap-err">${escapeHtml(zap.error || 'Zap failed')}</div>` : ''}
      </div>
    `;
  }

  function renderZappedText(chunks) {
    return (chunks || []).map(c => {
      if (c.type === 'strike') return `<s class="ws-zap-strike">${escapeHtml(c.text)}</s>`;
      return `<span>${escapeHtml(c.text)}</span>`;
    }).join('');
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
        } else if (act === 'zap') {
          const bite = btn.closest('.ws-bite');
          const segNum = Number(bite.dataset.segnum);
          runZap(segNum);
        } else if (act === 'zap-accept') {
          // Replace the bite text with the polished version so future
          // copies pick it up. Keeps the original in zaps.* in case the
          // user wants to undo by re-zapping.
          const bite = btn.closest('.ws-bite');
          const segNum = Number(bite.dataset.segnum);
          const z = state.zaps[segNum];
          const seg = opts.segments.find(s => s.number === segNum);
          if (z && seg) {
            seg.text = z.polished;
            delete state.zaps[segNum];
            // Notify the host so the segment mutation gets autosaved.
            // Without this the polished text vanishes on reload.
            if (typeof opts.onSegmentsMutated === 'function') {
              try { opts.onSegmentsMutated(); } catch {}
            }
            render();
          }
        } else if (act === 'zap-undo') {
          const bite = btn.closest('.ws-bite');
          const segNum = Number(bite.dataset.segnum);
          delete state.zaps[segNum];
          render();
        }
      });
    });

    // Copy-with-timecode: any selection inside [data-tc-copy] gets [Speaker — TC] prefix
    container.querySelectorAll('[data-tc-copy]').forEach(body => {
      body.addEventListener('copy', handleCopyWithTimecode);
    });
  }

  async function runZap(segNum) {
    const seg = opts.segments.find(s => s.number === segNum);
    if (!seg) return;
    // Double-click guard: if a zap is already in flight for this segment,
    // don't fire a second request. The previous version let two rapid
    // clicks race; whichever Anthropic response landed last won, so a
    // freshly-polished result could be overwritten by a stale error from
    // the first attempt — and Johnny got billed for both calls.
    if (state.zaps[segNum]?.status === 'loading') return;
    // Per-request token so a stale resolve can't clobber a newer one.
    const token = (state.zaps[segNum]?.token || 0) + 1;
    state.zaps[segNum] = { status: 'loading', token };
    render();
    try {
      const result = await polishSoundbite(seg.text);
      if (state.zaps[segNum]?.token !== token) return; // newer request superseded
      state.zaps[segNum] = { status: 'ready', token, chunks: result.chunks, polished: result.polished };
    } catch (err) {
      if (state.zaps[segNum]?.token !== token) return;
      state.zaps[segNum] = { status: 'error', token, error: err.message || String(err) };
    }
    render();
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

// escapeAttr is the canonical 5-char escaper (safe for both text and quoted
// attributes). The former local escapeHtml here escaped only & < > — missing "
// and ' — a divergent-weaker XSS twin of the shared boundary; both now delegate.
function escapeAttr(str) { return escapeHtml(str); }

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
