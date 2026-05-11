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
} from './db.js';
import { currentUser } from './auth.js';

let panelEl = null;
let buttonEl = null;
let activeThreadId = null;
let activeUnsubscribe = null;
let context = {};   // { getTranscriptId, getPageState, getCurrentView }

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
    <div class="devchat-head">
      <div class="devchat-head-title">devchat</div>
      <div class="devchat-head-actions">
        <button class="devchat-head-btn" data-act="new" title="New thread">+ new</button>
        <button class="devchat-head-btn" data-act="close" title="Close">×</button>
      </div>
    </div>
    <div class="devchat-body">
      <div class="devchat-threads" id="devchat-threads"></div>
      <div class="devchat-thread" id="devchat-thread"></div>
    </div>
    <div class="devchat-compose hidden" id="devchat-compose">
      <textarea id="devchat-input" placeholder="What's broken? What do you want to change?" rows="3"></textarea>
      <button class="devchat-send" id="devchat-send">Send</button>
    </div>
  `;
  document.body.appendChild(panelEl);
  panelEl.querySelector('[data-act="close"]').addEventListener('click', togglePanel);
  panelEl.querySelector('[data-act="new"]').addEventListener('click', startNewThread);
  panelEl.querySelector('#devchat-send').addEventListener('click', sendCurrentMessage);
  panelEl.querySelector('#devchat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendCurrentMessage(); }
  });

  await renderThreadList();
  // No thread selected yet → start a fresh one immediately so the user
  // can just type and go.
  await startNewThread();
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
    host.innerHTML = `<div class="devchat-empty">No threads yet.</div>`;
    return;
  }
  host.innerHTML = threads.map(t => `
    <button class="devchat-thread-item ${t.id === activeThreadId ? 'active' : ''}" data-thread="${escDc(t.id)}">
      <span class="devchat-thread-status devchat-thread-status--${escDc(t.status)}"></span>
      <span class="devchat-thread-title">${escDc(t.title || (t.page_url || 'Thread').split('/').pop() || 'Thread')}</span>
      <span class="devchat-thread-when">${escDc(relAgo(t.updated_at))}</span>
    </button>
  `).join('');
  host.querySelectorAll('[data-thread]').forEach(el => {
    el.addEventListener('click', () => loadThread(el.dataset.thread));
  });
}

async function startNewThread() {
  let thread;
  try {
    thread = await createDevchatThread({
      pageUrl: window.location.href,
      transcriptId: context.getTranscriptId?.() || null,
      pageState: {
        view: context.getCurrentView?.() || null,
        ...context.getPageState?.(),
      },
    });
  } catch (err) {
    if (isSchemaMissing(err)) {
      const host = panelEl?.querySelector('#devchat-thread');
      if (host) {
        host.innerHTML = renderSchemaMissingPrompt();
        bindSetupCta(host);
      }
      return;
    }
    showError(err?.message || 'Could not start a thread.');
    return;
  }
  activeThreadId = thread.id;
  await renderThreadList();
  await loadThread(thread.id, { fresh: true });
  panelEl?.querySelector('#devchat-input')?.focus();
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
    appendMessage(row);
    renderThreadList();
  });
}

function renderMessages(messages) {
  const host = panelEl?.querySelector('#devchat-thread');
  if (!host) return;
  if (!messages.length) {
    host.innerHTML = `<div class="devchat-greeting">
      Type what's broken or what you want changed. I'll triage; the fix lands later.
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
  host.querySelector('.devchat-greeting')?.remove();
  host.insertAdjacentHTML('beforeend', messageToHtml(row));
  scrollMessagesToBottom();
}

function messageToHtml(m) {
  return `
    <div class="devchat-msg devchat-msg--${escDc(m.sender)}">
      <div class="devchat-msg-sender">${escDc(senderLabel(m.sender))}</div>
      <div class="devchat-msg-body">${escDc(m.body).replace(/\n/g, '<br>')}</div>
    </div>
  `;
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
  if (!activeThreadId) return;
  const input = panelEl?.querySelector('#devchat-input');
  const sendBtn = panelEl?.querySelector('#devchat-send');
  const text = (input?.value || '').trim();
  if (!text) return;
  input.value = '';
  sendBtn.disabled = true;
  try {
    await addDevchatMessage(activeThreadId, { sender: 'user', body: text });
    // Kick the assistant reply (fire-and-forget; realtime will paint it).
    fetch('/api/devchat-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: activeThreadId }),
    }).catch(() => {});
  } catch (err) {
    showError(err?.message || 'Send failed.');
  } finally {
    sendBtn.disabled = false;
    input?.focus();
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
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('devchat_threads')
      || msg.includes('devchat_messages')
      || msg.includes('schema cache')
      || msg.includes('migration 012');
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
      <p style="margin-bottom:10px;">Devchat needs a one-time setup before threads can land.</p>
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
