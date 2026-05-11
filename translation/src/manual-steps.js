// Manual Setup Steps — the place that lists every "you have to go do
// this in another tab" task and gives you (a) a button to open the
// destination, (b) a button to copy the payload to clipboard. Designed
// for the workflow: click open → tab opens → click copy → paste → done.
//
// New manual steps go in the STEPS array below. The modal renders each
// in order; once you've completed one you can mark it done locally
// (stored in localStorage so it doesn't nag again).

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
function supabaseSqlEditorUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (m) return `https://supabase.com/dashboard/project/${m[1]}/sql/new`;
  return 'https://supabase.com/dashboard';
}

// The catalog. Add new entries as new manual steps come up. Each step
// can be a SQL paste, a dashboard toggle, an env-var setting, etc.
const STEPS = () => ([
  {
    id: 'mig-010',
    kind: 'sql',
    title: 'Migration 010 — auth workspace + user_profiles',
    description: 'Adds the user_profiles table, attribution columns on transcripts/projects/media, and the bootstrap trigger that auto-creates a profile on first sign-in.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/010_auth_workspace.sql',
  },
  {
    id: 'mig-011',
    kind: 'sql',
    title: 'Migration 011 — transcript sharing model',
    description: 'Adds the transcript_shares table that powers the Share dialog (collaborator list + roles + pending email invites).',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/011_sharing.sql',
  },
  {
    id: 'mig-012',
    kind: 'sql',
    title: 'Migration 012 — devchat tables',
    description: 'Creates devchat_threads + devchat_messages so the in-product chat box can persist threads.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/012_devchat.sql',
  },
  {
    id: 'mig-013',
    kind: 'sql',
    title: 'Migration 013 — public devchat',
    description: 'Loosens RLS so anonymous visitors on the public sequencer route can post bug reports without signing in.',
    where: { label: 'Open Supabase SQL Editor', url: supabaseSqlEditorUrl() },
    payloadUrl: '/migrations/013_devchat_public.sql',
  },
  {
    id: 'env-admin',
    kind: 'env',
    title: 'Vercel env: ADMIN_EMAILS',
    description: 'Without this, the Admin Console refuses to create or delete users (the JWT email check has no list to match against).',
    where: { label: 'Open Vercel project settings', url: 'https://vercel.com/dashboard' },
    payload: 'ADMIN_EMAILS=johnny@newpress.com',
  },
  {
    id: 'env-service',
    kind: 'env',
    title: 'Vercel env: SUPABASE_SERVICE_ROLE_KEY',
    description: 'Required for /api/admin-users to call Supabase Admin API. Find it in Supabase → Project Settings → API → service_role secret. Treat as a secret.',
    where: { label: 'Open Supabase API settings', url: supabaseProjectSettingsUrl() },
    payload: 'SUPABASE_SERVICE_ROLE_KEY=(paste from Supabase Project Settings → API → service_role)',
  },
  {
    id: 'auth-close-signups',
    kind: 'dashboard',
    title: 'Disable open signups in Supabase',
    description: 'Once you switch to invitation-only mode, toggle off "Enable signups" so only the admin console can create accounts.',
    where: { label: 'Open Supabase Auth providers', url: supabaseAuthProvidersUrl() },
    payload: null,
  },
]);

function supabaseProjectSettingsUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (m) return `https://supabase.com/dashboard/project/${m[1]}/settings/api`;
  return 'https://supabase.com/dashboard';
}
function supabaseAuthProvidersUrl() {
  const url = import.meta.env.VITE_SUPABASE_URL || '';
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  if (m) return `https://supabase.com/dashboard/project/${m[1]}/auth/providers`;
  return 'https://supabase.com/dashboard';
}

export async function openManualStepsModal() {
  document.getElementById('manual-steps-modal')?.remove();
  const done = loadDone();
  const steps = STEPS();

  const modal = document.createElement('div');
  modal.id = 'manual-steps-modal';
  modal.className = 'np-modal';
  modal.innerHTML = `
    <div class="np-modal-backdrop" data-close></div>
    <div class="np-modal-card" style="max-width:640px;max-height:80vh;overflow-y:auto;">
      <div class="np-modal-header">
        <h3 class="np-modal-title">Manual setup steps</h3>
        <button class="np-modal-close" data-close aria-label="Close">×</button>
      </div>
      <p style="font-family:var(--np-font-mono);font-size:12px;color:var(--np-sepia);margin-bottom:14px;">
        Each step you can knock out in a few seconds: click <em>open</em>, click <em>copy</em>, paste, run. Tick when done so it stops nagging.
      </p>
      <div class="ms-list">
        ${steps.map(s => renderStep(s, done.has(s.id))).join('')}
      </div>
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
    });
  }
}

function renderStep(step, isDone) {
  return `
    <div class="ms-step ${isDone ? 'ms-step--done' : ''}" data-step="${esc(step.id)}">
      <div class="ms-step-head">
        <label class="ms-step-checkbox">
          <input type="checkbox" data-act="done" ${isDone ? 'checked' : ''}>
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
