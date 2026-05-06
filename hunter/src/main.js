import { isConfigured, listProjects, createProject, getProject, listMediaAssets, listCorpusUnitsForProject, listPatternObservations, updatePatternStatus } from './db.js';

// ── State ──
let currentView = 'projects';
let currentProjectId = null;
let projects = [];

// ── DOM refs ──
const projectsView = document.getElementById('projects-view');
const projectView = document.getElementById('project-view');
const corpusView = document.getElementById('corpus-view');
const projectsList = document.getElementById('projects-list');
const projectsEmpty = document.getElementById('projects-empty');
const navBtns = document.querySelectorAll('.header-btn[data-view]');

// ── Navigation ──

function showView(view) {
  currentView = view;
  [projectsView, projectView, corpusView].forEach(el => el.classList.remove('active'));
  navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

  if (view === 'projects') {
    projectsView.classList.add('active');
    loadProjects();
  } else if (view === 'project') {
    projectView.classList.add('active');
  } else if (view === 'corpus') {
    corpusView.classList.add('active');
  }
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('btn-back-projects').addEventListener('click', () => {
  currentProjectId = null;
  showView('projects');
});

// ── Projects list ──

async function loadProjects() {
  if (!isConfigured()) {
    projectsEmpty.querySelector('p').textContent = 'database not connected';
    projectsEmpty.style.display = '';
    projectsList.innerHTML = '';
    return;
  }

  try {
    projects = await listProjects();
  } catch (err) {
    console.error('[hunter] loadProjects:', err);
    projects = [];
  }

  if (projects.length === 0) {
    projectsEmpty.style.display = '';
    projectsList.innerHTML = '';
    return;
  }

  projectsEmpty.style.display = 'none';
  projectsList.innerHTML = projects.map(p => `
    <div class="project-row" data-id="${p.id}">
      <span class="project-row-name">${escHtml(p.name)}</span>
      <span class="project-row-meta">${new Date(p.created_at).toLocaleDateString()}</span>
    </div>
  `).join('');

  projectsList.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', () => openProject(row.dataset.id));
  });
}

async function openProject(id) {
  currentProjectId = id;
  showView('project');

  const project = await getProject(id);
  const header = document.getElementById('project-header');
  header.innerHTML = `<h2>${escHtml(project.name)}</h2>`;

  // Load media assets for each tier
  const assets = await listMediaAssets(id);
  for (const tier of ['raw', 'script', 'selects', 'finished']) {
    const el = document.getElementById(`tier-${tier}-source`);
    const tierAssets = assets.filter(a => a.tier === tier);
    if (tierAssets.length > 0) {
      el.innerHTML = tierAssets.map(a =>
        `<div class="tier-asset">${escHtml(a.source_ref)} <span class="np-eyebrow">${a.queue_status}</span></div>`
      ).join('');
    } else {
      el.innerHTML = '';
    }
  }

  // Load corpus units
  const units = await listCorpusUnitsForProject(id);
  const unitsList = document.getElementById('corpus-units-list');
  if (units.length > 0) {
    unitsList.innerHTML = units.map(u => {
      const analysis = u.analyses?.[0];
      return `
        <div class="corpus-unit">
          <span class="corpus-unit-tc">${formatTc(u.start_seconds)} – ${formatTc(u.end_seconds)}</span>
          <span class="corpus-unit-desc">${analysis ? escHtml(analysis.output_text.slice(0, 200)) : '<em>pending analysis</em>'}</span>
        </div>
      `;
    }).join('');
  } else {
    unitsList.innerHTML = '<p class="empty-sub">no units analyzed yet</p>';
  }

  // Load patterns
  const patterns = await listPatternObservations(id);
  const patternsList = document.getElementById('patterns-list');
  if (patterns.length > 0) {
    patternsList.innerHTML = patterns.map(p => `
      <div class="pattern-card" data-id="${p.id}">
        <div class="pattern-text">${escHtml(p.observation_text)}</div>
        <div class="pattern-examples">${(p.example_unit_ids || []).length} example units</div>
        <div class="pattern-actions">
          <button class="np-button pattern-btn" data-action="accepted" data-id="${p.id}">accept</button>
          <button class="np-button pattern-btn" data-action="ignored" data-id="${p.id}">ignore</button>
        </div>
      </div>
    `).join('');

    patternsList.querySelectorAll('.pattern-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updatePatternStatus(btn.dataset.id, btn.dataset.action);
        openProject(currentProjectId);
      });
    });
  } else {
    patternsList.innerHTML = '';
  }
}

// ── New project ──

document.getElementById('btn-new-project').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>new project</h3>
      <div class="input-dialog">
        <label>project name</label>
        <input id="new-project-name" type="text" placeholder="e.g. Saudi Arabia" autofocus>
      </div>
      <div class="modal-actions">
        <button class="np-button" id="modal-cancel">Cancel</button>
        <button class="np-button np-button--primary" id="modal-create">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#new-project-name');
  input.focus();

  overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  async function create() {
    const name = input.value.trim();
    if (!name) return;
    try {
      const project = await createProject({ name });
      overlay.remove();
      openProject(project.id);
    } catch (err) {
      console.error('[hunter] createProject:', err);
      alert('Failed to create project: ' + err.message);
    }
  }

  overlay.querySelector('#modal-create').addEventListener('click', create);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
});

// ── Tier add buttons ──

document.querySelectorAll('.tier-add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tier = btn.dataset.tier;
    if (tier === 'raw') {
      promptDropboxFolder('raw');
    } else if (tier === 'script') {
      btn.closest('.tier-card').querySelector('.tier-file-input').click();
    } else if (tier === 'selects') {
      btn.closest('.tier-card').querySelector('.tier-file-input').click();
    } else if (tier === 'finished') {
      promptYoutubeUrl();
    }
  });
});

function promptDropboxFolder(tier) {
  const path = prompt('Dropbox folder path (e.g. /Projects/Saudi Arabia/Proxies):');
  if (!path) return;
  import('./db.js').then(({ createMediaAsset }) => {
    createMediaAsset({
      projectId: currentProjectId,
      tier,
      sourceKind: 'dropbox',
      sourceRef: path,
      format: 'mp4',
    }).then(() => openProject(currentProjectId));
  });
}

function promptYoutubeUrl() {
  const url = prompt('YouTube URL of finished video:');
  if (!url) return;
  import('./db.js').then(({ createMediaAsset }) => {
    createMediaAsset({
      projectId: currentProjectId,
      tier: 'finished',
      sourceKind: 'youtube',
      sourceRef: url,
      format: 'mp4',
    }).then(() => openProject(currentProjectId));
  });
}

document.querySelectorAll('.tier-file-input').forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const tier = input.dataset.tier;
    const { createMediaAsset } = await import('./db.js');
    await createMediaAsset({
      projectId: currentProjectId,
      tier,
      sourceKind: 'local',
      sourceRef: file.name,
      format: file.name.split('.').pop(),
    });
    openProject(currentProjectId);
  });
});

// ── "What do you see?" button ──

document.getElementById('btn-what-do-you-see').addEventListener('click', async () => {
  const btn = document.getElementById('btn-what-do-you-see');
  btn.disabled = true;
  btn.textContent = 'thinking...';
  try {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pattern_surfacing',
        projectId: currentProjectId,
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    await openProject(currentProjectId);
  } catch (err) {
    console.error('[hunter] pattern surfacing:', err);
    alert('Pattern surfacing failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'what do you see?';
  }
});

// ── Utilities ──

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatTc(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Boot ──

showView('projects');
console.log('[hunter] booted', isConfigured() ? '(db connected)' : '(no db)');
