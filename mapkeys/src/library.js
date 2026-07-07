// MapKeys library — the project home, in the Script Library's Cartridges
// chassis (paper frame, registration screws, mono chrome, FLAT) wearing
// MapKeys' own Space Mono / earthen palette. Vanilla DOM like the rest of
// MapKeys — the whole view re-renders from the store on every change.

import {
  activeProjects,
  trashedProjects,
  allFolders,
  createProject,
  createFolder,
  renameProject,
  renameFolder,
  deleteFolder,
  moveProject,
  trashProject,
  restoreProject,
  syncFromCloud,
  PROJECTS_CHANGED_EVENT,
} from './projects.js';

let root = null;
let onOpenProject = null;
let view = 'all'; // 'all' | 'trash'
let query = '';
let renamingId = null; // project id being renamed inline
let renamingFolderId = null;
let addingFolder = false;

export function initLibrary({ onOpen }) {
  onOpenProject = onOpen;
  root = document.createElement('div');
  root.id = 'mk-library';
  root.className = 'hidden';
  document.body.appendChild(root);
  window.addEventListener(PROJECTS_CHANGED_EVENT, () => {
    if (!root.classList.contains('hidden')) renderLibrary();
  });
}

export function showLibrary() {
  view = 'all';
  query = '';
  renderLibrary();
  root.classList.remove('hidden');
  document.body.classList.add('mk-library-open');
  syncFromCloud();
}

export function hideLibrary() {
  root.classList.add('hidden');
  document.body.classList.remove('mk-library-open');
}

export function isLibraryOpen() {
  return root && !root.classList.contains('hidden');
}

/* ── render ───────────────────────────────────────────────────────────── */

function relTime(iso) {
  const ms = Date.parse(iso || '');
  if (Number.isNaN(ms)) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function matches(row) {
  const q = query.trim().toLowerCase();
  return !q || String(row.name || '').toLowerCase().includes(q);
}

function renderLibrary() {
  if (!root) return;
  root.innerHTML = '';
  const frame = el('div', 'mkl-frame');

  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const screw = el('span', `mkl-screw ${pos}`);
    screw.appendChild(el('i'));
    frame.appendChild(screw);
  }

  // ── masthead ──
  const head = el('header', 'mkl-head');
  const idRow = el('div', 'mkl-id');
  idRow.appendChild(el('span', 'mkl-wordmark', 'MAPKEYS'));
  idRow.appendChild(el('span', 'mkl-fig', 'fig.06 — MAP LIBRARY'));
  head.appendChild(idRow);
  head.appendChild(el('div', 'mkl-sub', 'cinematic map keys · projects & folders'));
  frame.appendChild(head);

  // ── toolbar ──
  const bar = el('div', 'mkl-toolbar');
  const tabs = el('div', 'mkl-tabs');
  const active = activeProjects();
  const trashed = trashedProjects();
  const tabAll = el('button', `mkl-tab${view === 'all' ? ' is-active' : ''}`, 'LIBRARY ');
  tabAll.appendChild(el('span', 'mkl-count', String(active.length)));
  tabAll.onclick = () => { view = 'all'; query = ''; renderLibrary(); };
  const tabTrash = el('button', `mkl-tab${view === 'trash' ? ' is-active' : ''}`, 'TRASH ');
  tabTrash.appendChild(el('span', 'mkl-count', String(trashed.length)));
  tabTrash.onclick = () => { view = 'trash'; query = ''; renderLibrary(); };
  tabs.appendChild(tabAll);
  tabs.appendChild(tabTrash);
  bar.appendChild(tabs);

  const search = el('input', 'mkl-search');
  search.type = 'search';
  search.placeholder = view === 'trash' ? 'Search trash…' : 'Search maps…';
  search.value = query;
  search.oninput = () => {
    query = search.value;
    renderBody(body);
  };
  bar.appendChild(search);

  if (view === 'all') {
    const newBtn = el('button', 'mkl-new', '＋ New map');
    newBtn.onclick = async () => {
      newBtn.disabled = true;
      const row = await createProject('Untitled Map');
      if (onOpenProject) onOpenProject(row);
    };
    bar.appendChild(newBtn);

    const newFolder = el('button', 'mkl-new-folder', '＋ New folder');
    newFolder.onclick = () => { addingFolder = true; renderLibrary(); };
    bar.appendChild(newFolder);
  }
  frame.appendChild(bar);

  const body = el('div', 'mkl-body');
  renderBody(body);
  frame.appendChild(body);

  root.appendChild(frame);
}

function renderBody(body) {
  body.innerHTML = '';
  if (view === 'trash') return renderTrash(body);

  const folders = allFolders();
  const rows = activeProjects().filter(matches);
  const unfiled = rows.filter((r) => !r.folder_id || !folders.some((f) => f.id === r.folder_id));

  // New-folder inline input
  if (addingFolder) {
    const line = el('div', 'mkl-folder-add');
    const input = el('input', 'mkl-folder-input');
    input.placeholder = 'Folder name…';
    let committed = false; // Enter triggers blur — commit exactly once
    const commit = async () => {
      if (committed) return;
      committed = true;
      addingFolder = false;
      const name = input.value.trim();
      if (name) await createFolder(name);
      renderLibrary();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { addingFolder = false; renderLibrary(); }
    };
    input.onblur = commit;
    line.appendChild(input);
    body.appendChild(line);
    requestAnimationFrame(() => input.focus());
  }

  if (!rows.length && !folders.length && !addingFolder) {
    const empty = el('div', 'mkl-empty');
    empty.appendChild(el('div', 'mkl-empty-title', query.trim() ? `No maps match “${query.trim()}”.` : 'No maps yet.'));
    empty.appendChild(el('div', 'mkl-empty-sub', query.trim() ? 'Try a different search.' : 'Start one with ＋ New map.'));
    body.appendChild(empty);
    return;
  }

  if (unfiled.length) body.appendChild(cardGrid(unfiled, folders));

  for (const folder of folders) {
    const inFolder = rows.filter((r) => r.folder_id === folder.id);
    if (query.trim() && !inFolder.length) continue; // searching — hide empty folders
    body.appendChild(folderSection(folder, inFolder, folders));
  }
}

function folderSection(folder, projects, folders) {
  const section = el('section', 'mkl-folder');
  const head = el('div', 'mkl-folder-head');

  if (renamingFolderId === folder.id) {
    const input = el('input', 'mkl-folder-input');
    input.value = folder.name;
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      renamingFolderId = null;
      if (input.value.trim()) renameFolder(folder.id, input.value);
      renderLibrary();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') { renamingFolderId = null; renderLibrary(); }
    };
    input.onblur = commit;
    head.appendChild(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  } else {
    head.appendChild(el('span', 'mkl-folder-name', `▸ ${folder.name}`));
  }
  head.appendChild(el('span', 'mkl-folder-count', String(projects.length)));

  const acts = el('span', 'mkl-folder-acts');
  const ren = el('button', 'mkl-act', 'Rename');
  ren.onclick = () => { renamingFolderId = folder.id; renderLibrary(); };
  acts.appendChild(ren);
  const del = el('button', 'mkl-act', 'Delete');
  del.title = 'Removes the folder only — its maps move to the top, nothing is lost';
  del.onclick = () => {
    if (projects.length === 0 || window.confirm(`Delete folder "${folder.name}"? Its ${projects.length} map(s) move out of the folder — no maps are deleted.`)) {
      deleteFolder(folder.id);
      renderLibrary();
    }
  };
  acts.appendChild(del);
  head.appendChild(acts);
  section.appendChild(head);

  section.appendChild(projects.length
    ? cardGrid(projects, folders)
    : el('div', 'mkl-folder-empty', 'empty — move a map here with its folder menu'));
  return section;
}

function cardGrid(rows, folders) {
  const grid = el('div', 'mkl-grid');
  for (const row of rows) grid.appendChild(card(row, folders));
  return grid;
}

function card(row, folders) {
  const cardEl = el('div', 'mkl-card');

  const open = el('button', 'mkl-card-open');
  open.title = `Open ${row.name}`;
  open.onclick = () => { if (renamingId !== row.id && onOpenProject) onOpenProject(row); };
  open.appendChild(el('span', 'mkl-card-kind', '⬡ MAP'));

  if (renamingId === row.id) {
    const input = el('input', 'mkl-card-rename');
    input.value = row.name;
    input.onclick = (e) => e.stopPropagation();
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      renamingId = null;
      if (input.value.trim()) renameProject(row.id, input.value);
      renderLibrary();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); renamingId = null; renderLibrary(); }
    };
    input.onblur = commit;
    open.appendChild(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  } else {
    open.appendChild(el('span', 'mkl-card-title', row.name));
  }
  open.appendChild(el('span', 'mkl-card-time', `edited ${relTime(row.updated_at)}`));
  cardEl.appendChild(open);

  const acts = el('div', 'mkl-card-actions');
  const ren = el('button', 'mkl-act', 'Rename');
  ren.onclick = () => { renamingId = row.id; renderLibrary(); };
  acts.appendChild(ren);

  // Folder mover — a quiet select that reads as a button until opened.
  const move = document.createElement('select');
  move.className = 'mkl-move';
  move.title = 'Move to folder';
  const optNone = new Option('No folder', '');
  move.appendChild(optNone);
  for (const f of folders) move.appendChild(new Option(f.name, f.id));
  move.value = row.folder_id && folders.some((f) => f.id === row.folder_id) ? row.folder_id : '';
  move.onchange = () => { moveProject(row.id, move.value || null); renderLibrary(); };
  acts.appendChild(move);

  const trash = el('button', 'mkl-act mkl-act-danger', 'Trash');
  trash.onclick = () => { trashProject(row.id); renderLibrary(); };
  acts.appendChild(trash);

  cardEl.appendChild(acts);
  return cardEl;
}

function renderTrash(body) {
  const rows = trashedProjects().filter(matches);
  if (!rows.length) {
    const empty = el('div', 'mkl-empty');
    empty.appendChild(el('div', 'mkl-empty-title', 'Trash is empty.'));
    empty.appendChild(el('div', 'mkl-empty-sub', 'Trashed maps wait here — nothing is ever hard-deleted.'));
    body.appendChild(empty);
    return;
  }
  const grid = el('div', 'mkl-grid');
  for (const row of rows) {
    const cardEl = el('div', 'mkl-card is-trashed');
    const open = el('button', 'mkl-card-open');
    open.disabled = true;
    open.appendChild(el('span', 'mkl-card-kind', '⬡ MAP'));
    open.appendChild(el('span', 'mkl-card-title', row.name));
    open.appendChild(el('span', 'mkl-card-time', `trashed ${relTime(row.trashed_at)}`));
    cardEl.appendChild(open);
    const acts = el('div', 'mkl-card-actions');
    const restore = el('button', 'mkl-act', 'Restore');
    restore.onclick = () => { restoreProject(row.id); renderLibrary(); };
    acts.appendChild(restore);
    cardEl.appendChild(acts);
    grid.appendChild(cardEl);
  }
  body.appendChild(grid);
}
