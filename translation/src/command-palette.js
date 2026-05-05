// Command palette — ⌘K / Ctrl-K opens a fuzzy-searchable launcher
// over the entire app. Two source feeds:
//   - Actions: verbs the app can perform right now (translate, save,
//     export SRT, open history, etc).
//   - Jump-to: every transcript and folder in the library.
//
// Caller wires it once with getActions() and getTranscripts() callbacks
// that return live data each time the palette opens.

const RECENT_KEY = 'mcm_palette_recent';
const RECENT_MAX = 5;

let api = null; // owner-provided callbacks

let rootEl = null;
let inputEl = null;
let listEl = null;
let isOpen = false;
let activeIndex = 0;
let currentResults = [];

export function initCommandPalette({ getActions, getTranscripts, onJumpToTranscript }) {
  api = { getActions, getTranscripts, onJumpToTranscript };
  if (rootEl) return; // already mounted

  rootEl = document.createElement('div');
  rootEl.id = 'cmd-palette-root';
  rootEl.className = 'cmd-palette';
  rootEl.hidden = true;
  rootEl.innerHTML = `
    <div class="cmd-palette-backdrop" data-cmd-close></div>
    <div class="cmd-palette-card" role="dialog" aria-label="Command palette">
      <div class="cmd-palette-input-wrap">
        <span class="cmd-palette-search-icon" aria-hidden="true">⌘</span>
        <input
          id="cmd-palette-input"
          type="text"
          class="cmd-palette-input"
          placeholder="Type a command, transcript, or folder…"
          autocomplete="off"
          spellcheck="false"
          aria-autocomplete="list"
        >
        <kbd class="cmd-palette-esc">esc</kbd>
      </div>
      <div id="cmd-palette-list" class="cmd-palette-list" role="listbox"></div>
      <div class="cmd-palette-footer">
        <kbd>↑</kbd><kbd>↓</kbd> navigate &nbsp;·&nbsp; <kbd>↵</kbd> select &nbsp;·&nbsp; <kbd>esc</kbd> close
      </div>
    </div>
  `;
  document.body.appendChild(rootEl);

  inputEl = rootEl.querySelector('#cmd-palette-input');
  listEl = rootEl.querySelector('#cmd-palette-list');

  // Close handlers.
  rootEl.querySelectorAll('[data-cmd-close]').forEach(el => {
    el.addEventListener('click', closePalette);
  });

  inputEl.addEventListener('input', () => render());
  inputEl.addEventListener('keydown', onInputKey);

  // Mouse hover moves selection; click runs.
  listEl.addEventListener('mousemove', (e) => {
    const item = e.target.closest('.cmd-palette-item');
    if (!item) return;
    const idx = Number(item.dataset.idx);
    if (Number.isFinite(idx) && idx !== activeIndex) {
      activeIndex = idx;
      updateActiveHighlight();
    }
  });
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.cmd-palette-item');
    if (!item) return;
    activeIndex = Number(item.dataset.idx);
    runActive();
  });

  // Global keybinding: ⌘K / Ctrl-K toggles, Esc closes.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      isOpen ? closePalette() : openPalette();
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      closePalette();
    }
  });
}

export function openCommandPalette() { openPalette(); }

function openPalette() {
  if (!rootEl) return;
  isOpen = true;
  rootEl.hidden = false;
  requestAnimationFrame(() => rootEl.classList.add('open'));
  inputEl.value = '';
  activeIndex = 0;
  render();
  setTimeout(() => inputEl.focus(), 30);
}

function closePalette() {
  if (!rootEl) return;
  isOpen = false;
  rootEl.classList.remove('open');
  setTimeout(() => { rootEl.hidden = true; }, 140);
}

function onInputKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
    updateActiveHighlight(true);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActiveHighlight(true);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runActive();
  }
}

function updateActiveHighlight(scrollIntoView) {
  listEl.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
    el.classList.toggle('active', i === activeIndex);
    if (i === activeIndex && scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' });
    }
  });
}

function runActive() {
  const item = currentResults[activeIndex];
  if (!item) return;
  rememberRecent(item);
  closePalette();
  // Defer to next tick so the close animation runs cleanly.
  setTimeout(() => {
    try {
      if (item.kind === 'transcript') {
        api.onJumpToTranscript?.(item.id);
      } else {
        item.perform?.();
      }
    } catch (err) {
      console.error('[palette] action threw:', err);
    }
  }, 30);
}

function render() {
  const query = inputEl.value.trim();
  const actions = (api.getActions?.() || []).filter(a => a.enabled !== false);
  const transcripts = (api.getTranscripts?.() || []).map(t => ({
    kind: 'transcript',
    id: t.id,
    label: t.name || 'Untitled',
    group: 'Go to',
    hint: stepLabel(t.step),
    icon: '\u{1F4C4}',
  }));

  const all = [
    ...actions.map(a => ({
      kind: 'action',
      id: 'a:' + a.id,
      label: a.label,
      group: a.group || 'Actions',
      hint: a.hint || '',
      hotkey: a.hotkey,
      icon: a.icon || '›',
      perform: a.perform,
    })),
    ...transcripts,
  ];

  let results;
  if (!query) {
    // Empty query — show recents + a small selection of common actions/jumps.
    const recents = loadRecent().map(r => all.find(it => it.id === r.id)).filter(Boolean);
    const remaining = all.filter(it => !recents.some(r => r.id === it.id));
    results = [...recents, ...remaining].slice(0, 30);
  } else {
    results = all
      .map(it => ({ it, score: fuzzyScore(query, it.label, it.group, it.hint) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map(s => s.it);
  }

  currentResults = results;
  if (activeIndex >= results.length) activeIndex = 0;

  if (results.length === 0) {
    listEl.innerHTML = `<div class="cmd-palette-empty">No matches for "${escapeHtml(query)}"</div>`;
    return;
  }

  let lastGroup = null;
  let html = '';
  results.forEach((it, i) => {
    if (it.group !== lastGroup) {
      html += `<div class="cmd-palette-group">${escapeHtml(it.group)}</div>`;
      lastGroup = it.group;
    }
    html += `
      <div class="cmd-palette-item ${i === activeIndex ? 'active' : ''}" data-idx="${i}" role="option">
        <span class="cmd-palette-icon">${escapeHtml(it.icon || '›')}</span>
        <span class="cmd-palette-label">${escapeHtml(it.label)}</span>
        ${it.hint ? `<span class="cmd-palette-hint">${escapeHtml(it.hint)}</span>` : ''}
        ${it.hotkey ? `<kbd class="cmd-palette-hotkey">${escapeHtml(it.hotkey)}</kbd>` : ''}
      </div>
    `;
  });
  listEl.innerHTML = html;
}

// ── Fuzzy scoring ──────────────────────────────────────────────────────────
// Sum of:
//   exact substring match in label  — 100
//   starts-with match in label      — +60
//   word-boundary match in label    — +30
//   substring in hint or group      — +15
//   subsequence (in-order chars)    — up to +20
function fuzzyScore(q, label, group, hint) {
  if (!q) return 1;
  const ql = q.toLowerCase();
  const ll = label.toLowerCase();
  let score = 0;
  if (ll.includes(ql)) {
    score += 100;
    if (ll.startsWith(ql)) score += 60;
    // bonus for word-boundary match
    if (new RegExp(`\\b${escapeReg(ql)}`).test(ll)) score += 30;
  }
  const gl = (group || '').toLowerCase();
  const hl = (hint || '').toLowerCase();
  if (gl.includes(ql) || hl.includes(ql)) score += 15;

  // Subsequence: every char of query appears in order in label.
  let i = 0;
  for (const ch of ll) {
    if (ch === ql[i]) i++;
    if (i === ql.length) break;
  }
  if (i === ql.length) score += 20 - Math.min(20, ll.indexOf(ql[0]));

  return score;
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STEP_NAMES = { 1: 'Upload', 2: 'Analyze', 3: 'Clarify', 4: 'Translate', 5: 'Edit' };
function stepLabel(step) { return step ? `Step ${step} · ${STEP_NAMES[step] || ''}` : ''; }

// ── Recents ────────────────────────────────────────────────────────────────
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {}
}
function rememberRecent(item) {
  const list = loadRecent().filter(r => r.id !== item.id);
  list.unshift({ id: item.id, label: item.label, kind: item.kind });
  saveRecent(list);
}
