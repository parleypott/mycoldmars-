// Manual Setup Steps — the place that lists every "you have to go do
// this in another tab" task and gives you (a) a button to open the
// destination, (b) a button to copy the payload to clipboard. Designed
// for the workflow: click open → tab opens → click copy → paste → done.
//
// Two entry points:
//   openManualStepsModal()                    — the full catalog
//   openManualStepsModal({ category })        — filtered focused flow
//
// Category-filtered mode is meant for one-shot setups like "get devchat
// working" — same UI, but with a friendlier intro, numbered steps, and
// an inline verify button at the bottom so you can confirm it worked
// without leaving the modal.

import { supabase } from './db.js';

const DONE_KEY = 'mcm_manual_steps_done_v1';

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveDone(set) {
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...set])); } catch {}
}

// Best-effort: pull the Supabase project ref out of the configured URL
// so the "Open SQL Editor" link goes straight to the right project.
function projectRef() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m ? m[1] : null;
}
function supabaseSqlEditorUrl() {
  const ref = projectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : 'https://supabase.com/dashboard';
}
function supabaseProjectSettingsUrl() {
  const ref = projectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}/settings/api` : 'https://supabase.com/dashboard';
}
function supabaseAuthProvidersUrl() {
  const ref = projectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}/auth/providers` : 'https://supabase.com/dashboard';
}
function supabaseRealtimeUrl() {
  const ref = projectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}/database/replication` : 'https://supabase.com/dashboard';
}

// ── Catalog ───────────────────────────────────────────────────────────
// Each step optionally carries `categories: [...]` so it can show up in
// focused flows without showing up in the full catalog twice. A step
// with no categories shows only in the full catalog.
const STEPS = () => ([
  {
    id: 'mig-010',
    kind: 'sql',
    title: 'Migration 010 — auth workspace + user_profiles',
    description: 'Adds the user_profiles table, attribution columns on transcripts/projects/media, and the bootstrap trigger that auto-creates a profile on first sign-in.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/010_auth_workspace.sql',
    categories: ['auth'],
  },
  {
    id: 'mig-011',
    kind: 'sql',
    title: 'Migration 011 — transcript sharing model',
    description: 'Adds the transcript_shares table that powers the Share dialog (collaborator list + roles + pending email invites).',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/011_sharing.sql',
    categories: ['sharing'],
  },
  {
    id: 'mig-012',
    kind: 'sql',
    title: 'Migration 012 — devchat tables',
    description: 'Creates devchat_threads + devchat_messages so the in-product chat box can persist threads.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/012_devchat.sql',
    categories: ['devchat'],
  },
  {
    id: 'mig-013',
    kind: 'sql',
    title: 'Migration 013 — public devchat',
    description: 'Loosens RLS so anonymous visitors on the public sequencer route can post bug reports without signing in.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/013_devchat_public.sql',
    categories: ['devchat'],
  },
  {
    id: 'realtime-devchat',
    kind: 'dashboard',
    title: 'Enable Realtime on devchat_messages',
    description: 'So new messages from Claude paint into the chat panel the instant they land. Toggle the switch next to devchat_messages (and devchat_threads while you\'re there).',
    where: { label: 'Open Supabase Replication', url: supabaseRealtimeUrl() },
    payload: null,
    categories: ['devchat'],
  },
  {
    id: 'env-service',
    kind: 'env',
    title: 'Vercel env: SUPABASE_SERVICE_ROLE_KEY',
    description: 'Required for /api/devchat-respond and /api/admin-users to call Supabase Admin API. Find it in Supabase → Project Settings → API → service_role secret. Treat as a secret.',
    where: { label: 'Open Supabase API settings', url: supabaseProjectSettingsUrl() },
    payload: 'SUPABASE_SERVICE_ROLE_KEY=(paste from Supabase Project Settings → API → service_role)',
    categories: ['devchat', 'admin'],
  },
  {
    id: 'env-admin',
    kind: 'env',
    title: 'Vercel env: ADMIN_EMAILS',
    description: 'Without this, the Admin Console refuses to create or delete users (the JWT email check has no list to match against).',
    where: { label: 'Open Vercel project settings', url: 'https://vercel.com/dashboard' },
    payload: 'ADMIN_EMAILS=johnny@newpress.com',
    categories: ['admin'],
  },
  {
    id: 'auth-close-signups',
    kind: 'dashboard',
    title: 'Disable open signups in Supabase',
    description: 'Once you switch to invitation-only mode, toggle off "Enable signups" so only the admin console can create accounts.',
    where: { label: 'Open Supabase Auth providers', url: supabaseAuthProvidersUrl() },
    payload: null,
    categories: ['admin'],
  },
]);

// ── Focused flow definitions ──────────────────────────────────────────
const FLOWS = {
  devchat: {
    title: 'Get devchat working',
    intro: 'Three steps to bring the in-product chat box live: create the tables, enable realtime so replies paint instantly, and confirm the service-role key is set in Vercel so Claude can write back.',
    category: 'devchat',
    verify: verifyDevchat,
  },
};

// Verify devchat by attempting a no-op Supabase query that touches the
// devchat_threads table. Success means the table exists and RLS allows
// the read; failure tells the user exactly what's still missing.
async function verifyDevchat() {
  if (!supabase) return { ok: false, reason: 'Supabase client not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
  try {
    const { error } = await supabase.from('devchat_threads').select('id').limit(1);
    if (error) {
      if (error.code === '42P01') return { ok: false, reason: 'Table devchat_threads still missing. Migration 012 needs to run.' };
      if (error.code === '42501') return { ok: false, reason: 'Permission denied — migration 013 (public RLS) needs to run.' };
      return { ok: false, reason: error.message || error.code };
    }
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
  // Endpoint check — just hit /api/devchat-respond with a bogus thread to
  // confirm it's deployed and not 404ing. We expect a 400 or 404 from a
  // missing thread, NOT 500 (which would mean a server-side env issue).
  try {
    const r = await fetch('/api/devchat-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: '00000000-0000-0000-0000-000000000000' }),
    });
    if (r.status === 500) {
      const body = await r.json().catch(() => ({}));
      if (body.error?.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        return { ok: false, reason: 'Server: SUPABASE_SERVICE_ROLE_KEY not set in Vercel.' };
      }
      if (body.error?.includes('ANTHROPIC_API_KEY')) {
        return { ok: false, reason: 'Server: ANTHROPIC_API_KEY not set in Vercel.' };
      }
      return { ok: false, reason: `Server error: ${body.error || 'unknown'}` };
    }
    if (r.status === 404) return { ok: false, reason: '/api/devchat-respond not deployed yet — Vercel still building?' };
  } catch (err) {
    return { ok: false, reason: 'Could not reach /api/devchat-respond: ' + (err?.message || err) };
  }
  return { ok: true };
}

// ── Public entry ──────────────────────────────────────────────────────
export async function openManualStepsModal(opts = {}) {
  document.getElementById('manual-steps-modal')?.remove();

  const flow  = opts.flow ? FLOWS[opts.flow] : null;
  const cat   = opts.category || flow?.category || null;
  const title = opts.title || flow?.title || 'Setup checklist';
  const intro = opts.intro || flow?.intro ||
    'Every one-time manual step in one place. Click open, click copy, paste, run. Tick when done — your progress sticks across sessions.';

  const done = loadDone();
  const all  = STEPS();
  const steps = cat ? all.filter(s => s.categories?.includes(cat)) : all;

  // Master view (no category) is now numbered + progress-tracked too —
  // Johnny needs ONE place that shows everything pending without a focused
  // flow accidentally hiding work.
  const numbered = true;
  const allDone  = steps.every(s => done.has(s.id));

  const modal = document.createElement('div');
  modal.id = 'manual-steps-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card ms-card ${numbered ? 'ms-card--focused' : ''}" style="max-width:640px;max-height:88vh;overflow-y:auto;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">${esc(title)}</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      ${numbered ? `<div class="ms-progress">
        <div class="ms-progress-fill" style="width:${stepsCompletedPct(steps, done)}%"></div>
        <span class="ms-progress-label">${stepsCompletedCount(steps, done)} of ${steps.length} done</span>
      </div>` : ''}
      <p class="ms-intro">${esc(intro)}</p>
      <div class="ms-list">
        ${steps.map((s, i) => renderStep(s, done.has(s.id), numbered ? i + 1 : null)).join('')}
      </div>
      ${flow?.verify ? `
        <div class="ms-verify">
          <button class="ms-verify-btn" data-act="verify">${allDone ? 'Verify it&#39;s working' : 'I&#39;m done — verify'}</button>
          <p class="ms-verify-msg" id="ms-verify-msg"></p>
        </div>
      ` : ''}
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => modal.remove()));

  for (const step of steps) {
    const row = modal.querySelector(`[data-step="${step.id}"]`);
    if (!row) continue;

    row.querySelector('[data-act="copy"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const original = btn.textContent;
      try {
        let text = step.payload;
        if (!text && step.payloadUrl) {
          const r = await fetch(step.payloadUrl);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          text = await r.text();
        }
        await navigator.clipboard.writeText(text || '');
        btn.textContent = 'copied!';
        btn.classList.add('ms-act--ok');
        setTimeout(() => { btn.textContent = original; btn.classList.remove('ms-act--ok'); }, 1600);
      } catch (err) {
        btn.textContent = `err: ${err.message}`;
        setTimeout(() => { btn.textContent = original; }, 2400);
      }
    });

    row.querySelector('[data-act="done"]')?.addEventListener('change', (e) => {
      const cb = e.currentTarget;
      const set = loadDone();
      if (cb.checked) set.add(step.id); else set.delete(step.id);
      saveDone(set);
      row.classList.toggle('ms-step--done', cb.checked);
      // Refresh progress bar if focused flow.
      if (numbered) {
        const fill = modal.querySelector('.ms-progress-fill');
        const label = modal.querySelector('.ms-progress-label');
        if (fill)  fill.style.width = stepsCompletedPct(steps, loadDone()) + '%';
        if (label) label.textContent = `${stepsCompletedCount(steps, loadDone())} of ${steps.length} done`;
      }
    });
  }

  if (flow?.verify) {
    const btn = modal.querySelector('[data-act="verify"]');
    const msg = modal.querySelector('#ms-verify-msg');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'checking…';
      msg.className = 'ms-verify-msg';
      msg.textContent = '';
      try {
        const result = await flow.verify();
        if (result.ok) {
          msg.classList.add('ms-verify-msg--ok');
          msg.textContent = '✓ All set. Devchat is wired up — close this and try sending a message.';
          btn.textContent = 'verified ✓';
        } else {
          msg.classList.add('ms-verify-msg--err');
          msg.textContent = '✗ ' + result.reason;
          btn.disabled = false;
          btn.textContent = original;
        }
      } catch (err) {
        msg.classList.add('ms-verify-msg--err');
        msg.textContent = '✗ ' + (err?.message || err);
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }
}

function stepsCompletedCount(steps, done) {
  return steps.filter(s => done.has(s.id)).length;
}
function stepsCompletedPct(steps, done) {
  if (steps.length === 0) return 0;
  return Math.round((stepsCompletedCount(steps, done) / steps.length) * 100);
}

function renderStep(step, isDone, number) {
  return `
    <div class="ms-step ${isDone ? 'ms-step--done' : ''}" data-step="${esc(step.id)}">
      <div class="ms-step-head">
        <label class="ms-step-checkbox">
          <input type="checkbox" data-act="done" ${isDone ? 'checked' : ''}>
          ${number ? `<span class="ms-step-num">${number}</span>` : ''}
          <span class="ms-step-title">${esc(step.title)}</span>
        </label>
        <span class="ms-step-kind ms-step-kind--${esc(step.kind)}">${esc(step.kind)}</span>
      </div>
      <p class="ms-step-desc">${esc(step.description)}</p>
      <div class="ms-step-actions">
        ${step.where ? `<a class="ms-act ms-act--link" href="${esc(step.where.url)}" target="_blank" rel="noopener">→ ${esc(step.where.label)}</a>` : ''}
        ${(step.payload || step.payloadUrl) ? `<button class="ms-act ms-act--copy" data-act="copy">copy${step.kind === 'sql' ? ' SQL' : step.kind === 'env' ? ' env line' : ''}</button>` : ''}
      </div>
    </div>
  `;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
