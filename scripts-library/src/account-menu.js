// Account menu — the avatar button in the library header. Opens a dropdown with:
//   • the signed-in email
//   • Add user (email → creates a Supabase account with a generated password)
//   • Manage users (list + reset password + delete) — admin-only
//   • Change my password
//   • Sign out
//
// The "Add user" flow is the whole point of this feature: an admin
// (johnny@newpress.com) types a colleague's email, we POST to /api/admin-users
// { action:'create' }, the server makes the account with a per-user RANDOM
// password and returns it exactly once (`generatedPassword`) — the admin copies
// it out of the confirmation and hands it over. There is no shared default.
// Non-admins still see Change password + Sign out; admin actions 403 gracefully.

import { currentUser, signOut, updatePassword, listUsers, createUser, deleteUser, setUserPassword, authRequired } from './auth.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Mount the avatar button into a container. No-op when auth is unconfigured. */
export function mountAccountMenu(container) {
  if (!authRequired()) return; // open mode: no account UI
  const user = currentUser();
  if (!container) return;

  const btn = document.createElement('button');
  btn.className = 'sl-avatar';
  btn.type = 'button';
  btn.title = user?.email || 'Account';
  const initial = (user?.email || '?').trim()[0]?.toUpperCase() || '?';
  btn.textContent = initial;
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn); });
  container.appendChild(btn);
}

let _menuEl = null;

function closeMenu() {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  document.removeEventListener('click', onDocClick, true);
}
function onDocClick(e) {
  if (_menuEl && !_menuEl.contains(e.target)) closeMenu();
}

function toggleMenu(anchor) {
  if (_menuEl) { closeMenu(); return; }
  const user = currentUser();
  const menu = document.createElement('div');
  menu.className = 'sl-account-menu';
  menu.innerHTML = `
    <div class="sl-account-email">${esc(user?.email || 'Signed in')}</div>
    <button class="sl-account-item" data-act="add">Add user…</button>
    <button class="sl-account-item" data-act="manage">Manage users…</button>
    <div class="sl-account-divider"></div>
    <button class="sl-account-item" data-act="password">Change my password…</button>
    <button class="sl-account-item sl-account-item--danger" data-act="signout">Sign out</button>
  `;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  _menuEl = menu;
  menu.addEventListener('click', (e) => {
    const it = e.target.closest('.sl-account-item');
    if (!it) return;
    const act = it.dataset.act;
    closeMenu();
    if (act === 'add') openAddUser();
    else if (act === 'manage') openManageUsers();
    else if (act === 'password') openChangePassword();
    else if (act === 'signout') signOut();
  });
  setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
}

// ── Modal helper ─────────────────────────────────────────────────────────────
function openModal(title, bodyHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'sl-modal-overlay';
  overlay.innerHTML = `
    <div class="sl-modal" role="dialog" aria-label="${esc(title)}">
      <div class="sl-modal-head">
        <span class="sl-modal-title">${esc(title)}</span>
        <button class="sl-modal-close" aria-label="Close">✕</button>
      </div>
      <div class="sl-modal-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.sl-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return { overlay, close, body: overlay.querySelector('.sl-modal-body') };
}

// ── Add user ─────────────────────────────────────────────────────────────────
function openAddUser() {
  const { body, close } = openModal('Add a user', `
    <p class="sl-modal-note">Enter their email. We create the account with a randomly generated password — it's shown once here so you can send it to them.</p>
    <input id="sl-add-email" class="sl-modal-input" type="email" placeholder="colleague@newpress.com" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button id="sl-add-submit" class="sl-gate-btn sl-gate-btn--primary" style="width:100%;margin-top:10px;">Create account</button>
    <p id="sl-add-msg" class="sl-modal-msg" hidden></p>
  `);
  const email = body.querySelector('#sl-add-email');
  const submit = body.querySelector('#sl-add-submit');
  const msg = body.querySelector('#sl-add-msg');
  setTimeout(() => email.focus(), 30);

  async function go() {
    const e = email.value.trim();
    if (!e || !e.includes('@')) { msg.hidden = false; msg.className = 'sl-modal-msg sl-modal-msg--error'; msg.textContent = 'Enter a valid email.'; return; }
    submit.disabled = true; submit.textContent = 'Creating…';
    const res = await createUser(e);
    if (res.ok) {
      msg.hidden = false; msg.className = 'sl-modal-msg sl-modal-msg--success';
      // The generated password exists ONLY in this response — it's not stored
      // anywhere we can re-read. Show it once and tell the admin to copy it.
      msg.innerHTML = res.generatedPassword
        ? `Created <strong>${esc(e)}</strong>. Their password: <code>${esc(res.generatedPassword)}</code> — copy it now, it won't be shown again. They can change it after signing in.`
        : `Created <strong>${esc(e)}</strong> with the password you set.`;
      email.value = '';
    } else {
      msg.hidden = false; msg.className = 'sl-modal-msg sl-modal-msg--error';
      msg.textContent = res.status === 403 ? 'Only admins can add users.' : (res.error || 'Could not create the account.');
    }
    submit.disabled = false; submit.textContent = 'Create account';
  }
  submit.addEventListener('click', (ev) => { ev.preventDefault(); go(); });
  email.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
}

// ── Manage users ─────────────────────────────────────────────────────────────
async function openManageUsers() {
  const { body } = openModal('Manage users', `<p class="sl-modal-note">Loading…</p>`);
  const res = await listUsers();
  if (!res.ok) {
    body.innerHTML = `<p class="sl-modal-msg sl-modal-msg--error">${esc(res.status === 403 ? 'Only admins can manage users.' : (res.error || 'Could not load users.'))}</p>`;
    return;
  }
  const me = currentUser();
  const rows = (res.users || []).map((u) => {
    const isMe = me && u.id === me.id;
    const lastDate = u.last_sign_in_at ? new Date(u.last_sign_in_at) : null;
    const last = lastDate && !isNaN(lastDate.getTime()) ? lastDate.toLocaleDateString() : 'never';
    return `<div class="sl-user-row" data-id="${esc(u.id)}" data-email="${esc(u.email)}">
      <div class="sl-user-main"><span class="sl-user-email">${esc(u.email)}</span>${isMe ? '<span class="sl-user-you">you</span>' : ''}</div>
      <div class="sl-user-meta">last: ${esc(last)}</div>
      <div class="sl-user-actions">
        <button class="sl-user-btn" data-act="reset">Reset pw</button>
        ${isMe ? '' : '<button class="sl-user-btn sl-user-btn--danger" data-act="delete">Delete</button>'}
      </div>
    </div>`;
  }).join('');
  body.innerHTML = `<div class="sl-user-list">${rows || '<p class="sl-modal-note">No users yet.</p>'}</div>
    <button id="sl-manage-add" class="sl-gate-btn" style="width:100%;margin-top:12px;">+ Add a user</button>`;
  body.querySelector('#sl-manage-add').addEventListener('click', () => { body.closest('.sl-modal-overlay').remove(); openAddUser(); });

  body.querySelectorAll('.sl-user-row').forEach((row) => {
    row.querySelector('[data-act="reset"]')?.addEventListener('click', async () => {
      const id = row.dataset.id;
      const r = await setUserPassword(id); // server generates + returns it once
      alert(r.ok
        ? `New password for ${row.dataset.email}:\n\n${r.generatedPassword}\n\nCopy it now — it won't be shown again.`
        : (r.error || 'Reset failed.'));
    });
    row.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
      if (!confirm(`Delete ${row.dataset.email}? This removes their account.`)) return;
      const r = await deleteUser(row.dataset.id);
      if (r.ok) row.remove(); else alert(r.error || 'Delete failed.');
    });
  });
}

// ── Change my password ───────────────────────────────────────────────────────
function openChangePassword() {
  const { body } = openModal('Change my password', `
    <input id="sl-pw-new" class="sl-modal-input" type="password" placeholder="New password (min 4 chars)" autocomplete="new-password">
    <button id="sl-pw-submit" class="sl-gate-btn sl-gate-btn--primary" style="width:100%;margin-top:10px;">Update password</button>
    <p id="sl-pw-msg" class="sl-modal-msg" hidden></p>
  `);
  const input = body.querySelector('#sl-pw-new');
  const submit = body.querySelector('#sl-pw-submit');
  const msg = body.querySelector('#sl-pw-msg');
  setTimeout(() => input.focus(), 30);
  async function go() {
    const p = input.value;
    submit.disabled = true; submit.textContent = 'Updating…';
    const res = await updatePassword(p);
    msg.hidden = false;
    if (res.ok) { msg.className = 'sl-modal-msg sl-modal-msg--success'; msg.textContent = 'Password updated.'; input.value = ''; }
    else { msg.className = 'sl-modal-msg sl-modal-msg--error'; msg.textContent = res.error || 'Could not update.'; }
    submit.disabled = false; submit.textContent = 'Update password';
  }
  submit.addEventListener('click', (e) => { e.preventDefault(); go(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}
