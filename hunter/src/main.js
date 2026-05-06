import { isConfigured, listProjects, createProject, getProject, listMediaAssets, listCorpusUnitsForProject, listPatternObservations, updatePatternStatus, listAllCorpusUnits } from './db.js';

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
    loadCorpusBrowser();
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

// ── Demo data for preview without DB ──

const DEMO_PROJECTS = [
  { id: 'demo-1', name: 'Saudi Arabia', created_at: '2026-04-20T00:00:00Z' },
  { id: 'demo-2', name: 'Palau Expedition', created_at: '2026-03-15T00:00:00Z' },
  { id: 'demo-3', name: 'Taiwan Night Markets', created_at: '2026-02-10T00:00:00Z' },
];

const DEMO_ASSETS = {
  'demo-1': [
    { id: 'a1', tier: 'raw', source_kind: 'dropbox', source_ref: '/Projects/Saudi/Proxies', queue_status: 'done' },
    { id: 'a2', tier: 'script', source_kind: 'local', source_ref: 'saudi-script-v3.pdf', queue_status: 'done' },
    { id: 'a3', tier: 'selects', source_kind: 'local', source_ref: 'saudi-selects.xml', queue_status: 'done' },
    { id: 'a4', tier: 'finished', source_kind: 'youtube', source_ref: 'https://youtube.com/watch?v=example', queue_status: 'done' },
  ],
  'demo-2': [
    { id: 'a5', tier: 'raw', source_kind: 'dropbox', source_ref: '/Projects/Palau/Proxies', queue_status: 'analyzing' },
    { id: 'a6', tier: 'finished', source_kind: 'youtube', source_ref: 'https://youtube.com/watch?v=palau', queue_status: 'done' },
  ],
  'demo-3': [
    { id: 'a7', tier: 'raw', source_kind: 'dropbox', source_ref: '/Projects/Taiwan/Proxies', queue_status: 'pending' },
  ],
};

const DEMO_UNITS = [
  { id: 'u1', start_seconds: 0, end_seconds: 45, source_clip_name: 'A001_C003.mp4', analyses: [{ output_text: 'Wide establishing shot of empty desert highway at golden hour. The road cuts through undulating sand dunes, perfectly straight to the vanishing point. No vehicles, no people — just the geometry of human infrastructure against geological time. Warm amber light catches the rippled texture of sand. The composition is symmetrical, almost devotional. This is a patience shot — it teaches the viewer to slow down before the story begins.' }] },
  { id: 'u2', start_seconds: 45, end_seconds: 112, source_clip_name: 'A001_C007.mp4', analyses: [{ output_text: 'Johnny walks through a narrow souk corridor, camera following from behind at shoulder height. Vendors call out in Arabic. The light shifts dramatically every few steps — blazing sun through gaps in corrugated roofing, then deep shadow. Johnny pauses at a spice stall, reaches toward a mound of saffron. His hand hesitates. This moment of almost-touching is deeply characteristic — the camera catches curiosity in the body before words arrive.' }] },
  { id: 'u3', start_seconds: 112, end_seconds: 180, source_clip_name: 'A001_C012.mp4', analyses: [{ output_text: 'Close-up on weathered hands pouring Arabic coffee from a brass dallah into tiny ceramic cups. The pour is ceremonial, unhurried. Steam rises into late-afternoon light. The camera holds on the hands alone for 15 seconds before pulling back to reveal the face of the elderly host. This patience with detail before context is a recurring editorial instinct.' }] },
];

const DEMO_PATTERNS = [
  { id: 'p1', observation_text: 'Threshold moments before connection. Across the Saudi Arabia corpus, there is a consistent pattern of capturing the instant before human interaction begins — the pause at the spice stall, the moment before a handshake, the breath before speaking. These liminal seconds carry enormous emotional weight and suggest an editorial philosophy: the anticipation of connection is more cinematic than the connection itself.', example_unit_ids: [], status: 'surfaced' },
  { id: 'p2', observation_text: 'Geometric patience shots as emotional reset. Wide symmetrical compositions (the desert highway, architectural doorways, empty corridors) consistently appear at transition points between scenes. These are not B-roll — they function as editorial breathing room, giving the viewer permission to process what came before. The filmmaker instinctively uses negative space as punctuation.', example_unit_ids: [], status: 'surfaced' },
];

let isDemo = !isConfigured();

async function loadProjects() {
  if (!isDemo) {
    try {
      projects = await listProjects();
    } catch (err) {
      console.error('[hunter] loadProjects:', err);
      projects = [];
    }
  }

  // Fall back to demo data if no real projects
  if (projects.length === 0) {
    isDemo = true;
    projects = DEMO_PROJECTS;
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

  let project, assets, units, patterns;

  if (isDemo) {
    project = DEMO_PROJECTS.find(p => p.id === id) || { name: 'Unknown' };
    assets = DEMO_ASSETS[id] || [];
    units = id === 'demo-1' ? DEMO_UNITS : [];
    patterns = id === 'demo-1' ? DEMO_PATTERNS : [];
  } else {
    project = await getProject(id);
    assets = await listMediaAssets(id);
    units = await listCorpusUnitsForProject(id);
    patterns = await listPatternObservations(id);
  }

  const header = document.getElementById('project-header');
  header.innerHTML = `<h2>${escHtml(project.name)}</h2>`;

  // Render tiers
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

  // Render corpus units
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

  // Render patterns
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

    if (!isDemo) {
      patternsList.querySelectorAll('.pattern-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await updatePatternStatus(btn.dataset.id, btn.dataset.action);
          openProject(currentProjectId);
        });
      });
    }
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
  btn.innerHTML = 'observing<span class="thinking-indicator"><span></span><span></span><span></span></span>';
  try {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pattern_surfacing',
        projectId: currentProjectId,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `API error ${res.status}`);
    }
    await openProject(currentProjectId);
  } catch (err) {
    console.error('[hunter] pattern surfacing:', err);
    const patternsList = document.getElementById('patterns-list');
    patternsList.innerHTML = `<p class="empty-sub" style="color:var(--np-red)">${escHtml(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'what do you see?';
  }
});

// ── Corpus browser ──

async function loadCorpusBrowser() {
  const browser = document.getElementById('corpus-browser');

  let units;

  if (isDemo) {
    units = DEMO_UNITS.map(u => ({
      ...u,
      media_assets: { project_id: 'demo-1', tier: 'raw', hunter_projects: { name: 'Saudi Arabia' } },
    }));
  } else {
    try {
      units = await listAllCorpusUnits();
    } catch (err) {
      console.error('[hunter] loadCorpusBrowser:', err);
      browser.innerHTML = '<p class="corpus-browser-empty">failed to load corpus</p>';
      return;
    }
  }

  if (!units.length) {
    browser.innerHTML = '<p class="corpus-browser-empty">no analyzed footage yet — ingest a project to build the corpus</p>';
    return;
  }

  browser.innerHTML = `
    <div class="corpus-grid">
      ${units.map(u => {
        const analysis = u.analyses?.[0];
        const projectName = u.media_assets?.hunter_projects?.name || 'unknown';
        const tier = u.media_assets?.tier || '';
        return `
          <div class="corpus-grid-item" data-project-id="${u.media_assets?.project_id || ''}">
            <div class="corpus-grid-item-project">${escHtml(projectName)} / ${tier}</div>
            <div class="corpus-grid-item-tc">${formatTc(u.start_seconds)} – ${formatTc(u.end_seconds)}${u.source_clip_name ? ' · ' + escHtml(u.source_clip_name) : ''}</div>
            <div class="corpus-grid-item-text">${analysis ? escHtml(analysis.output_text.slice(0, 200)) : '<em style="color:var(--np-sepia)">pending analysis</em>'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  browser.querySelectorAll('.corpus-grid-item').forEach(item => {
    item.addEventListener('click', () => {
      const pid = item.dataset.projectId;
      if (pid) openProject(pid);
    });
  });
}

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
