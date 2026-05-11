// Devchat — in-product chat box for live feedback.
//
// What it does:
//   • Floating button bottom-right.
//   • Click → opens a panel with thread list + active thread.
//   • New thread captures page URL + transcript context at the moment
//     the user opened the chat.
//   • Each thread is a real conversation (rows in devchat_messages).
//     User messages POST to /api/devchat-respond which calls Claude API
//     and writes an 'assistant' reply back to the same thread. Realtime
//     subscription paints both directions instantly.
//
// What it doesn't do (yet):
//   • Take screenshots (just URL + page state for now).
//   • Actually edit code (the autonomous fixer is a separate worker —
//     see the v2 sketch in supabase/migrations/012_devchat.sql comment).
//
// Hidden by default for non-signed-in users. Devchat is for the workspace
// crew, not random sequencer-public visitors.

import {
  createDevchatThread,
  listDevchatThreads,
  listDevchatMessages,
  addDevchatMessage,
  subscribeToDevchatThread,
  uploadDevchatImage,
} from './db.js';
import { currentUser } from './auth.js';

let panelEl = null;
let buttonEl = null;
let activeThreadId = null;
let activeUnsubscribe = null;
let context = {};   // { getTranscriptId, getPageState, getCurrentView }
let pendingAttachments = [];   // [{file, previewUrl}] before send

export function initDevchat({ getTranscriptId, getPageState, getCurrentView } = {}) {
  context = { getTranscriptId, getPageState, getCurrentView };
  ensureButton();
  // Re-evaluate button visibility on auth changes.
  window.addEventListener('mcm-gate-unlocked', ensureButton);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureButton();
  });
}

function ensureButton() {
  // Always-on. Devchat is open to anyone who can reach the app —
  // including anonymous visitors on the public sequencer route — so
  // collaborators can flag bugs without needing an account first.
  if (buttonEl) return;
  buttonEl = document.createElement('button');
  buttonEl.id = 'devchat-fab';
  buttonEl.className = 'devchat-fab';
  buttonEl.title = 'Devchat — report a bug or ask for a fix';
  buttonEl.innerHTML = `<span class="devchat-fab-glyph">⚙</span><span class="devchat-fab-label">devchat</span>`;
  buttonEl.addEventListener('click', togglePanel);
  document.body.appendChild(buttonEl);
}

async function togglePanel() {
  if (panelEl) { panelEl.remove(); panelEl = null; tearDownSubscription(); return; }
  panelEl = document.createElement('div');
  panelEl.id = 'devchat-panel';
  panelEl.className = 'devchat-panel';
  panelEl.innerHTML = `
    <header class="devchat-head">
      <button class="devchat-head-history" data-act="history" title="Thread history">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="devchat-head-title">devchat</div>
      <div class="devchat-head-actions">
        <button class="devchat-head-btn" data-act="new" title="New thread">＋</button>
        <button class="devchat-head-btn" data-act="close" title="Close">×</button>
      </div>
    </header>
    <aside class="devchat-history hidden" id="devchat-history">
      <div class="devchat-history-head">recent threads</div>
      <div class="devchat-history-list" id="devchat-threads"></div>
    </aside>
    <main class="devchat-thread" id="devchat-thread"></main>
    <div class="devchat-compose hidden" id="devchat-compose">
      <div class="devchat-attachments" id="devchat-attachments"></div>
      <div class="devchat-compose-row">
        <textarea id="devchat-input" placeholder="what's broken? paste a screenshot or describe it." rows="1"></textarea>
        <input type="file" id="devchat-file" accept="image/*" multiple hidden>
        <button class="devchat-icon-btn" id="devchat-attach" title="Attach image">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <button class="devchat-send" id="devchat-send" title="Send (⌘↵)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="devchat-compose-hint">⌘↵ to send · paste images · drag to drop</div>
    </div>
  `;
  document.body.appendChild(panelEl);
  panelEl.querySelector('[data-act="close"]').addEventListener('click', togglePanel);
  panelEl.querySelector('[data-act="new"]').addEventListener('click', startNewThread);
  panelEl.querySelector('[data-act="history"]').addEventListener('click', () => {
    panelEl.querySelector('#devchat-history').classList.toggle('hidden');
    renderThreadList();
  });
  panelEl.querySelector('#devchat-send').addEventListener('click', sendCurrentMessage);
  panelEl.querySelector('#devchat-attach').addEventListener('click', () => {
    panelEl.querySelector('#devchat-file').click();
  });
  panelEl.querySelector('#devchat-file').addEventListener('change', (e) => {
    for (const f of e.target.files || []) addPendingAttachment(f);
    e.target.value = '';
  });
  const inputEl = panelEl.querySelector('#devchat-input');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendCurrentMessage(); }
  });
  // Auto-grow textarea as the user types.
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  });
  inputEl.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type?.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) addPendingAttachment(f);
      }
    }
  });
  ;['dragover','dragleave','drop'].forEach(ev => {
    panelEl.addEventListener(ev, (e) => {
      e.preventDefault();
      panelEl.classList.toggle('devchat--dragging', ev === 'dragover');
      if (ev === 'drop') {
        const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
        files.forEach(addPendingAttachment);
      }
    });
  });

  // Don't auto-create a thread on open — show a clean greeting first
  // so opening the panel is cheap and doesn't pollute the thread list.
  await showGreeting();
}

async function showGreeting() {
  const host = panelEl?.querySelector('#devchat-thread');
  const compose = panelEl?.querySelector('#devchat-compose');
  if (!host) return;
  compose?.classList.remove('hidden');
  host.innerHTML = `
    <div class="devchat-welcome">
      <div class="devchat-welcome-mark">✦</div>
      <div class="devchat-welcome-title">what's on your mind?</div>
      <div class="devchat-welcome-sub">
        type below — your first message starts a new thread.
      </div>
    </div>
  `;
  panelEl?.querySelector('#devchat-input')?.focus();
}

async function renderThreadList() {
  const host = panelEl?.querySelector('#devchat-threads');
  if (!host) return;
  host.innerHTML = `<div class="devchat-loading">…</div>`;
  let threads = [];
  try { threads = await listDevchatThreads({ limit: 30 }); }
  catch (err) {
    host.innerHTML = renderThreadListError(err);
    bindSetupCta(host);
    return;
  }
  if (!threads.length) {
    host.innerHTML = `<div class="devchat-history-empty">no threads yet</div>`;
    return;
  }
  host.innerHTML = threads.map(t => {
    const title = (t.title && t.title.trim()) || (t.page_url || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '').slice(0, 40) || 'thread';
    return `
      <button class="devchat-thread-item ${t.id === activeThreadId ? 'active' : ''}" data-thread="${escDc(t.id)}">
        <span class="devchat-thread-status devchat-thread-status--${escDc(t.status)}"></span>
        <span class="devchat-thread-title">${escDc(title)}</span>
        <span class="devchat-thread-when">${escDc(relAgo(t.updated_at))}</span>
      </button>
    `;
  }).join('');
  host.querySelectorAll('[data-thread]').forEach(el => {
    el.addEventListener('click', () => {
      loadThread(el.dataset.thread);
      panelEl?.querySelector('#devchat-history')?.classList.add('hidden');
    });
  });
}

async function startNewThread(opts = {}) {
  let thread;
  try {
    thread = await createDevchatThread({
      pageUrl: window.location.href,
      transcriptId: context.getTranscriptId?.() || null,
      title: opts.title || null,
      pageState: {
        view: context.getCurrentView?.() || null,
        ...context.getPageState?.(),
      },
    });
  } catch (err) {
    const host = panelEl?.querySelector('#devchat-thread');
    if (host) {
      if (isSchemaMissing(err)) {
        host.innerHTML = renderSchemaMissingPrompt();
        bindSetupCta(host);
        throw err;
      }
      if (isPermissionError(err)) {
        host.innerHTML = renderPermissionPrompt(err);
        bindSetupCta(host);
        throw err;
      }
    }
    showError(err?.message || 'Could not start a thread.');
    console.warn('[devchat] startNewThread error:', err);
    throw err;
  }
  activeThreadId = thread.id;
  if (!opts.silent) {
    await loadThread(thread.id, { fresh: true });
    panelEl?.querySelector('#devchat-input')?.focus();
  } else {
    // Silent mode (called from sendCurrentMessage on first send) — set
    // up realtime for the assistant reply but DON'T clear the host yet.
    // The user message will be painted optimistically by sendCurrentMessage.
    tearDownSubscription();
    activeUnsubscribe = subscribeToDevchatThread(thread.id, (row) => {
      if (document.querySelector(`[data-msg-id="${row.id}"]`)) return;
      if (row.sender !== 'user') hideTypingIndicator();
      appendMessage(row);
      renderThreadList();
    });
  }
}

async function loadThread(threadId, opts = {}) {
  activeThreadId = threadId;
  tearDownSubscription();
  const host = panelEl?.querySelector('#devchat-thread');
  const compose = panelEl?.querySelector('#devchat-compose');
  if (!host) return;
  compose.classList.remove('hidden');
  host.innerHTML = `<div class="devchat-loading">…</div>`;
  let messages = [];
  if (!opts.fresh) {
    try { messages = await listDevchatMessages(threadId); }
    catch (err) {
      host.innerHTML = `<div class="devchat-empty">${escDc(err?.message || 'Could not load messages.')}</div>`;
      return;
    }
  }
  renderMessages(messages);
  await renderThreadList();
  activeUnsubscribe = subscribeToDevchatThread(threadId, (row) => {
    if (document.querySelector(`[data-msg-id="${row.id}"]`)) return;
    if (row.sender !== 'user') hideTypingIndicator();
    appendMessage(row);
    renderThreadList();
  });
}

function renderMessages(messages) {
  const host = panelEl?.querySelector('#devchat-thread');
  if (!host) return;
  if (!messages.length) {
    host.innerHTML = `<div class="devchat-welcome devchat-welcome--small">
      <div class="devchat-welcome-mark">✦</div>
      <div class="devchat-welcome-sub">empty thread — type below to start.</div>
    </div>`;
    return;
  }
  host.innerHTML = messages.map(messageToHtml).join('');
  scrollMessagesToBottom();
}

function appendMessage(row) {
  const host = panelEl?.querySelector('#devchat-thread');
  if (!host) return;
  // Remove the greeting placeholder if present.
  host.querySelector('.devchat-welcome')?.remove();
  host.insertAdjacentHTML('beforeend', messageToHtml(row));
  scrollMessagesToBottom();
}

function messageToHtml(m) {
  const images = m.metadata?.images || [];
  const imagesHtml = images.length ? `
    <div class="devchat-msg-images">
      ${images.map(img => `
        <a class="devchat-msg-image" href="${escDc(img.url)}" target="_blank" rel="noopener">
          <img src="${escDc(img.url)}" alt="attachment" loading="lazy">
        </a>
      `).join('')}
    </div>
  ` : '';
  const bodyHtml = m.body ? `<div class="devchat-msg-body">${escDc(m.body).replace(/\n/g, '<br>')}</div>` : '';
  return `
    <div class="devchat-msg devchat-msg--${escDc(m.sender)}" data-msg-id="${escDc(m.id || '')}">
      <div class="devchat-msg-sender">${escDc(senderLabel(m.sender))}</div>
      ${imagesHtml}
      ${bodyHtml}
    </div>
  `;
}

function showTypingIndicator() {
  hideTypingIndicator();
  const host = panelEl?.querySelector('#devchat-thread');
  if (!host) return;
  host.insertAdjacentHTML('beforeend', `
    <div class="devchat-msg devchat-msg--assistant" id="devchat-typing">
      <div class="devchat-msg-sender">parley</div>
      <div class="devchat-msg-body devchat-typing">
        <span></span><span></span><span></span>
      </div>
    </div>
  `);
  scrollMessagesToBottom();
}

function hideTypingIndicator() {
  document.getElementById('devchat-typing')?.remove();
}

// Poll for the assistant reply for up to 30s — failsafe for when
// Supabase Realtime isn't enabled on devchat_messages. Stops as soon
// as we see a message newer than the user's send timestamp from a
// non-user sender (assistant/system/agent).
async function pollAssistantReply(threadId, sinceIso) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    await new Promise(r => setTimeout(r, 1500));
    if (!panelEl) return;
    if (activeThreadId !== threadId) return;   // user navigated away
    try {
      const messages = await listDevchatMessages(threadId);
      const newer = messages.filter(m =>
        m.sender !== 'user' && new Date(m.created_at) > new Date(sinceIso)
      );
      for (const m of newer) {
        if (document.querySelector(`[data-msg-id="${m.id}"]`)) continue;
        hideTypingIndicator();
        appendMessage(m);
      }
      if (newer.length) return;
    } catch {}
  }
  // Timed out — leave the typing indicator off and let the user retry.
  hideTypingIndicator();
}

function addPendingAttachment(file) {
  if (!file || !file.type?.startsWith('image/')) return;
  if (file.size > 10 * 1024 * 1024) {
    showError(`Image too big (${Math.round(file.size/1024/1024)}MB) — keep under 10MB.`);
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  pendingAttachments.push({ file, previewUrl });
  renderPendingAttachments();
}

function removePendingAttachment(idx) {
  const att = pendingAttachments[idx];
  if (att) try { URL.revokeObjectURL(att.previewUrl); } catch {}
  pendingAttachments.splice(idx, 1);
  renderPendingAttachments();
}

function renderPendingAttachments() {
  const host = panelEl?.querySelector('#devchat-attachments');
  if (!host) return;
  if (!pendingAttachments.length) { host.innerHTML = ''; return; }
  host.innerHTML = pendingAttachments.map((a, i) => `
    <div class="devchat-attach-thumb" data-idx="${i}">
      <img src="${escDc(a.previewUrl)}" alt="">
      <button class="devchat-attach-remove" data-remove="${i}">×</button>
    </div>
  `).join('');
  host.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePendingAttachment(parseInt(btn.dataset.remove, 10));
    });
  });
}

function clearPendingAttachments() {
  for (const a of pendingAttachments) {
    try { URL.revokeObjectURL(a.previewUrl); } catch {}
  }
  pendingAttachments = [];
  renderPendingAttachments();
}

function senderLabel(s) {
  if (s === 'user') return 'you';
  if (s === 'assistant') return 'parley';
  if (s === 'agent') return 'fixer';
  return s;
}

function scrollMessagesToBottom() {
  const host = panelEl?.querySelector('#devchat-thread');
  if (host) host.scrollTop = host.scrollHeight;
}

async function sendCurrentMessage() {
  const input = panelEl?.querySelector('#devchat-input');
  const sendBtn = panelEl?.querySelector('#devchat-send');
  const text = (input?.value || '').trim();
  const attachments = pendingAttachments.slice();
  if (!text && !attachments.length) return;

  // Lazy-create the thread on first send so opening the panel doesn't
  // pollute the thread list with empty stubs.
  if (!activeThreadId) {
    sendBtn.disabled = true;
    try {
      await startNewThread({ silent: true, title: text.slice(0, 60) || null });
    } catch {
      sendBtn.disabled = false;
      return; // startNewThread already surfaced the error
    }
    if (!activeThreadId) { sendBtn.disabled = false; return; }
  }

  sendBtn.disabled = true;
  const originalLabel = sendBtn.innerHTML;

  try {
    // 1. Upload every pending attachment first so we have public URLs.
    let uploadedImages = [];
    if (attachments.length) {
      sendBtn.textContent = 'uploading…';
      uploadedImages = await Promise.all(
        attachments.map(a => uploadDevchatImage(a.file))
      );
    }

    // 2. Insert the message with image refs in metadata.
    input.value = '';
    clearPendingAttachments();
    const insertedRow = await addDevchatMessage(activeThreadId, {
      sender: 'user',
      body: text,
      metadata: uploadedImages.length ? { images: uploadedImages } : null,
    });

    // 3. Paint the user message immediately — don't depend on realtime
    // (which may not be enabled yet, or may be slow). The realtime
    // subscription dedupes by data-msg-id so we never double-paint.
    appendMessage(insertedRow);
    renderThreadList();

    // 4. Kick the assistant reply. Show a typing indicator until either
    // a reply lands via realtime/poll OR the API surfaces an error.
    showTypingIndicator();
    pollAssistantReply(activeThreadId, insertedRow.created_at).catch(() => {});
    fetch('/api/devchat-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: activeThreadId }),
    }).catch(() => {});
  } catch (err) {
    showError(err?.message || 'Send failed.');
    console.warn('[devchat] send failed:', err);
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalLabel;
    input?.focus();
    // Reset textarea height after send.
    if (input) input.style.height = 'auto';
  }
}

function tearDownSubscription() {
  try { activeUnsubscribe?.(); } catch {}
  activeUnsubscribe = null;
}

function showError(msg) {
  const host = panelEl?.querySelector('#devchat-thread');
  if (!host) return;
  host.insertAdjacentHTML('beforeend',
    `<div class="devchat-msg devchat-msg--error"><div class="devchat-msg-body">${escDc(msg)}</div></div>`);
}

function isSchemaMissing(err) {
  // Be precise — match table-missing, NOT generic table-name mentions
  // (RLS errors include the table name and used to false-positive into
  // a "needs setup" prompt that hid the actual permission issue).
  const code = err?.code || err?.cause?.code;
  if (code === '42P01') return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('does not exist')
      || msg.includes('schema cache')
      || msg.includes('migration 012');
}

function isPermissionError(err) {
  const code = err?.code || err?.cause?.code;
  if (code === '42501') return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('row-level security')
      || msg.includes('rls')
      || msg.includes('permission denied');
}

function renderThreadListError(err) {
  if (isSchemaMissing(err)) {
    return `
      <div class="devchat-empty devchat-empty--setup">
        <div class="devchat-empty-title">Devchat isn't set up yet</div>
        <div class="devchat-empty-sub">The database tables haven't been created.</div>
        <button class="devchat-setup-btn" data-act="open-setup">Set up devchat →</button>
      </div>
    `;
  }
  return `<div class="devchat-empty">${escDc(err?.message || 'Could not load threads.')}</div>`;
}

function renderSchemaMissingPrompt() {
  return `
    <div class="devchat-greeting devchat-greeting--setup">
      <p style="margin-bottom:10px;">Devchat tables don't exist yet — migration 012 needs to run.</p>
      <button class="devchat-setup-btn" data-act="open-setup">Set up devchat →</button>
    </div>
  `;
}

function renderPermissionPrompt(err) {
  const msg = escDc(err?.message || err?.code || 'permission denied');
  return `
    <div class="devchat-greeting devchat-greeting--setup">
      <p style="margin-bottom:6px;"><strong>Database said no.</strong></p>
      <p style="margin-bottom:10px;font-size:11px;color:var(--np-sepia);">Likely migration 013 (public RLS) hasn't run yet.<br><span style="opacity:.7;">${msg}</span></p>
      <button class="devchat-setup-btn" data-act="open-setup">Set up devchat →</button>
    </div>
  `;
}

function bindSetupCta(scope) {
  scope.querySelectorAll('[data-act="open-setup"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { openManualStepsModal } = await import('./manual-steps.js');
      openManualStepsModal({ flow: 'devchat' });
    });
  });
}

function escDc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function relAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  if (s < 86400) return `${Math.round(s/3600)}h`;
  return `${Math.round(s/86400)}d`;
}
