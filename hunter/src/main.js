import { isConfigured, listProjects, createProject, getProject, listMediaAssets, listCorpusUnitsForProject, listPatternObservations, updatePatternStatus, listAllCorpusUnits, getIngestStatus, semanticSearch, findSimilarClips, fetchSceneInsights, chatWithFootage, fetchTierComparison, fetchNarrativeInsights, listScenes, listArcSummaries, fetchCorpusContext, getScriptSnapshot, listScriptPasses, runScriptPass, chatWithScript, fetchParseDoc, runGlobalTraining, getGlobalTraining, persistEditorialDecisions, runTasteTraining, getTasteProfile } from './db.js';

// ── State ──
let currentView = 'projects';
let currentProjectId = null;
let projects = [];

// ── DOM refs ──
const projectsView = document.getElementById('projects-view');
const projectView = document.getElementById('project-view');
const corpusView = document.getElementById('corpus-view');
const scriptCopilotView = document.getElementById('script-copilot-view');
const projectsList = document.getElementById('projects-list');
const projectsEmpty = document.getElementById('projects-empty');
const navBtns = document.querySelectorAll('.header-btn[data-view]');

// ── Navigation ──

function showView(view) {
  currentView = view;
  [projectsView, projectView, corpusView, scriptCopilotView].forEach(el => el.classList.remove('active'));
  navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

  if (view === 'projects') {
    projectsView.classList.add('active');
    loadProjects();
  } else if (view === 'project') {
    projectView.classList.add('active');
  } else if (view === 'corpus') {
    corpusView.classList.add('active');
    loadCorpusBrowser();
    initCorpusSearch();
  } else if (view === 'script-copilot') {
    scriptCopilotView.classList.add('active');
    renderScriptCopilotHub();
  }

  // Sync URL hash for top-level views
  if (view !== 'project') {
    history.replaceState(null, '', view === 'projects' ? '#' : `#${view}`);
  }
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

document.getElementById('btn-back-projects').addEventListener('click', () => {
  currentProjectId = null;
  stopIngestPolling();
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

const DEMO_UNITS = {
  'demo-1': [
    { id: 'u1', start_seconds: 0, end_seconds: 45, source_clip_name: '20241004-0730-C8100_Proxy.MP4', analyses: [{ output_text: 'Wide establishing shot of empty desert highway at golden hour. The road cuts through undulating sand dunes, perfectly straight to the vanishing point. No vehicles, no people — just the geometry of human infrastructure against geological time. Warm amber light catches the rippled texture of sand. The composition is symmetrical, almost devotional. This is a patience shot — it teaches the viewer to slow down before the story begins.' }] },
    { id: 'u2', start_seconds: 45, end_seconds: 112, source_clip_name: '20241004-0742-C8101_Proxy.MP4', analyses: [{ output_text: 'Johnny walks through a narrow souk corridor, camera following from behind at shoulder height. Vendors call out in Arabic. The light shifts dramatically every few steps — blazing sun through gaps in corrugated roofing, then deep shadow. Johnny pauses at a spice stall, reaches toward a mound of saffron. His hand hesitates. This moment of almost-touching is deeply characteristic — the camera catches curiosity in the body before words arrive.' }] },
    { id: 'u3', start_seconds: 112, end_seconds: 180, source_clip_name: '20241004-1415-C8200_Proxy.MP4', analyses: [{ output_text: 'Close-up on weathered hands pouring Arabic coffee from a brass dallah into tiny ceramic cups. The pour is ceremonial, unhurried. Steam rises into late-afternoon light. The camera holds on the hands alone for 15 seconds before pulling back to reveal the face of the elderly host. This patience with detail before context is a recurring editorial instinct.' }] },
    { id: 'u1b', start_seconds: 0, end_seconds: 38, source_clip_name: '20241005-0915-C8300_Proxy.MP4', analyses: [{ output_text: 'Aerial drone shot rising over a cluster of traditional mud-brick buildings at dawn. Long shadows stretch across the empty streets. A single figure emerges from a doorway, walks toward a well. The scale of the landscape dwarfs human presence — a recurring visual motif in this project.' }] },
    { id: 'u1c', start_seconds: 0, end_seconds: 55, source_clip_name: '20241005-0928-C8301_Proxy.MP4', analyses: [{ output_text: 'Medium close-up of Johnny interviewing a local craftsman shaping metal in a workshop. Sparks catch the morning light. The craftsman explains his process in Arabic while Johnny listens, his body language open and attentive. Two cameras capture different angles simultaneously.' }] },
    { id: 'u1d', start_seconds: 0, end_seconds: 42, source_clip_name: '20241005-0932-C8302_Proxy.MP4', analyses: [{ output_text: 'B-camera coverage of the metalworking interview. Tighter framing on the craftsman\'s hands as they work the heated metal. The hammer strikes create a rhythmic soundtrack. Focus pulls between the glowing metal and the craftsman\'s concentrated expression.' }] },
    { id: 'u1e', start_seconds: 0, end_seconds: 65, source_clip_name: '20241005-1640-C8400_Proxy.MP4', analyses: [{ output_text: 'Golden hour establishing shot of an ancient stone fortress silhouetted against the setting sun. The camera slowly zooms in to reveal architectural details — arched windows, carved stone patterns. Wind noise on the audio suggests an exposed rooftop position.' }] },
  ],
  'demo-2': [
    { id: 'u4', start_seconds: 0, end_seconds: 38, source_clip_name: '20241012-0830-C9001_Proxy.MP4', analyses: [{ output_text: 'Underwater wide shot. The camera descends through turquoise water toward a coral shelf. Visibility is extraordinary — perhaps 40 meters. Small fish scatter as a manta ray enters from the upper right, its wingspan filling the frame. The filmmaker lets the ray dominate the composition entirely, not chasing it. There is a philosophical patience here: the camera trusts the subject will be interesting if given room.' }] },
    { id: 'u5', start_seconds: 38, end_seconds: 94, source_clip_name: '20241012-1415-C9002_Proxy.MP4', analyses: [{ output_text: 'Johnny sits in a traditional Palauan bai (meeting house), the camera at a low angle looking up. Carved storyboard reliefs cover the walls behind him. He listens to an elder speaking in Palauan. The filmmaker captures a rare vulnerability — Johnny is out of his depth linguistically, and his body language shifts from interviewer to student. The carved histories on the wall dwarf both figures.' }] },
    { id: 'u6', start_seconds: 94, end_seconds: 142, source_clip_name: '20241013-0615-C9010_Proxy.MP4', analyses: [{ output_text: 'Slow tracking shot along a deserted beach at dawn. Debris line — coconut husks, plastic bottles, driftwood. The camera follows the debris line like a text, reading it left to right. A single hermit crab navigates the refuse. The shot holds on the crab for an almost uncomfortable duration (22 seconds). This is habitat as character: the beach tells its own story about human impact without a single word.' }] },
  ],
  'demo-3': [
    { id: 'u7', start_seconds: 0, end_seconds: 52, source_clip_name: '20241020-2015-C9500_Proxy.MP4', analyses: [{ output_text: 'Overhead drone shot pulling back from a single night market stall. Neon signs in Mandarin. Steam rises from a grill in organized columns. The pullback reveals the market as a dense grid of light — hundreds of stalls creating a galaxy-like pattern when seen from above. The transition from intimate (one stall) to vast (entire market) happens in a single unbroken move. A signature scale shift.' }] },
    { id: 'u8', start_seconds: 52, end_seconds: 118, source_clip_name: '20241020-2030-C9501_Proxy.MP4', analyses: [{ output_text: 'Handheld at eye level, moving through the crowd. The camera is in the stream of people, not observing from outside. Focus racks between faces — a child eating shaved ice, a vendor counting change, teenagers taking selfies. The audio is dense: sizzling oil, Mandarin pop music, motorbike engines. No attempt to isolate a single story thread. This is immersion as editorial technique: the chaos IS the subject.' }] },
    { id: 'u9', start_seconds: 118, end_seconds: 165, source_clip_name: '20241020-2105-C9502_Proxy.MP4', analyses: [{ output_text: 'Close-up: a hand operates a traditional Taiwanese puppet, carved and painted. The puppet casts a shadow on a backlit screen. Another hand enters with a second puppet. The shadows tell a story the camera cannot fully follow (it is in Hokkien). The filmmaker stays on the shadow play rather than cutting to the puppeteer — choosing the imagined world over the real one. A sophisticated editorial instinct about where meaning lives.' }] },
  ],
};

const DEMO_PATTERNS = {
  'demo-1': [
    { id: 'p1', observation_text: 'Threshold moments before connection. Across the Saudi Arabia corpus, there is a consistent pattern of capturing the instant before human interaction begins — the pause at the spice stall, the moment before a handshake, the breath before speaking. These liminal seconds carry enormous emotional weight and suggest an editorial philosophy: the anticipation of connection is more cinematic than the connection itself.', example_unit_ids: [], status: 'surfaced' },
    { id: 'p2', observation_text: 'Geometric patience shots as emotional reset. Wide symmetrical compositions (the desert highway, architectural doorways, empty corridors) consistently appear at transition points between scenes. These are not B-roll — they function as editorial breathing room, giving the viewer permission to process what came before. The filmmaker instinctively uses negative space as punctuation.', example_unit_ids: [], status: 'surfaced' },
  ],
  'demo-2': [
    { id: 'p3', observation_text: 'Subject as student, not authority. In the Palau footage, the filmmaker consistently positions himself in receiving postures — listening in the bai, floating below the manta ray, watching the hermit crab. The camera mirrors this humility: low angles looking up, long holds without intervention. The editorial instinct is to earn the story by being small within it.', example_unit_ids: [], status: 'surfaced' },
    { id: 'p4', observation_text: 'Environmental storytelling through debris and detail. Objects tell stories before people do. The debris line on the beach, the carved histories on the bai walls, the coral shelf — the camera reads environments like texts before introducing human subjects. This creates a layered editorial rhythm: place, then person, then tension between the two.', example_unit_ids: [], status: 'surfaced' },
  ],
  'demo-3': [
    { id: 'p5', observation_text: 'Scale shifts as emotional punctuation. The Taiwan footage consistently uses dramatic scale changes — drone pulling back from one stall to reveal hundreds, close-up puppet shadows opening into the crowd. These transitions between intimate and vast create the feeling of discovery, as if the viewer is seeing the larger pattern that contains the small moment they just witnessed.', example_unit_ids: [], status: 'surfaced' },
  ],
};

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

  // Fall back to demo data ONLY if DB is not configured
  if (projects.length === 0 && !isConfigured()) {
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
  startIngestPolling();

  // Show loading state (v2 shell handles its own loading via plate)
  const header = document.getElementById('project-header');
  if (header) header.innerHTML = '<div class="project-loading">loading project...</div>';

  let project, assets, units, patterns;

  if (isDemo) {
    project = DEMO_PROJECTS.find(p => p.id === id) || { name: 'Unknown' };
    assets = DEMO_ASSETS[id] || [];
    units = DEMO_UNITS[id] || [];
    patterns = DEMO_PATTERNS[id] || [];
  } else {
    try {
      project = await getProject(id);
      assets = await listMediaAssets(id);
      units = await listCorpusUnitsForProject(id);
      patterns = await listPatternObservations(id);
    } catch (err) {
      console.error('[hunter] openProject failed:', err);
      showToast(`Failed to load project: ${err.message}`, true);
      return;
    }
  }
  const totalUnits = units.length;
  const analyzedUnits = units.filter(u => u.analyses?.length > 0).length;

  // Build per-tier stats with analysis progress
  const tierStats = {};
  for (const a of assets) {
    const tierUnits = units.filter(u => u.media_assets?.tier === a.tier || u.media_asset_id === a.id);
    const analyzed = tierUnits.filter(u => u.analyses?.length > 0).length;
    const tierKey = a.tier;
    if (!tierStats[tierKey]) tierStats[tierKey] = { total: 0, analyzed: 0 };
    tierStats[tierKey].total += tierUnits.length;
    tierStats[tierKey].analyzed += analyzed;
  }

  // For demo mode, inject realistic tier counts if we have multi-tier assets
  if (isDemo && assets.length > 1) {
    const demoTierCounts = { raw: 7616, selects: 2168, google_docs: 28, finished: 1 };
    for (const a of assets) {
      if (demoTierCounts[a.tier] && (!tierStats[a.tier] || tierStats[a.tier].total < 10)) {
        tierStats[a.tier] = { total: demoTierCounts[a.tier], analyzed: demoTierCounts[a.tier] };
      }
    }
  }

  // Render v2 project detail shell
  renderProjectV2(project, assets, units, patterns, tierStats);
}

// ═════════════════════════════════════════════
//   V2 PROJECT DETAIL — BRUTALIST 4-TAB SHELL
// ═════════════════════════════════════════════

const TIER_COLORS = { raw: '#FFB000', script: '#5AA3FF', selects: '#FF3B20', finished: '#22C55E', google_docs: '#5AA3FF' };
const TIER_LABELS_V2 = { raw: 'RAW FOOTAGE', script: 'SCRIPT', selects: 'SELECTS', finished: 'FINISHED CUT', google_docs: 'GOOGLE DOCS' };
const TIER_ROLES = { raw: 'What the camera was drawn to', script: 'The original written intent', selects: 'What survived the edit room', finished: 'The story that was told' };
const TABS_V2 = [
  { id: 'inputs',   num: '01', label: 'INPUTS',        hint: 'CONNECT SOURCES' },
  { id: 'training', num: '02', label: 'TRAINING',      hint: 'STATUS / FEED'   },
  { id: 'insights', num: '03', label: 'INSIGHTS',      hint: 'WHAT DO YOU SEE' },
  { id: 'scenes',   num: '04', label: 'SCENE BUILDER', hint: 'PROPOSE / EDIT'  },
  { id: 'script',   num: '05', label: 'SCRIPT',        hint: 'COPILOT'         },
];

let v2Tab = 'inputs';
let v2AC = null; // abort controller for tab event listeners
let v2Data = {}; // persisted project data

function renderProjectV2(project, assets, units, patterns, tierStats) {
  // Store data
  v2Data = { project, assets, units, patterns, tierStats };

  // Cleanup previous listeners
  if (v2AC) v2AC.abort();
  v2AC = new AbortController();
  const signal = v2AC.signal;

  // ── TopBar timestamp ──
  const now = new Date();
  const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase() + ' · ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  document.getElementById('v2-topbar-time').textContent = timeStr;

  // ── Update training status in topbar ──
  const totalUnits = units.length;
  const analyzedUnits = units.filter(u => u.analyses?.length > 0).length;
  const pct = totalUnits > 0 ? ((analyzedUnits / totalUnits) * 100).toFixed(1) : '0.0';
  const statusText = document.getElementById('v2-status-text');
  const pulse = document.getElementById('v2-pulse');
  if (analyzedUnits < totalUnits && totalUnits > 0) {
    statusText.textContent = `TRAINING · ${pct}%`;
    pulse.classList.add('v2-pulse--active');
  } else if (totalUnits > 0) {
    statusText.textContent = `TRAINED · ${analyzedUnits.toLocaleString()} CLIPS`;
    pulse.classList.remove('v2-pulse--active');
  } else {
    statusText.textContent = 'READY';
    pulse.classList.remove('v2-pulse--active');
  }

  // ── ProjectPlate ──
  const plate = document.getElementById('v2-plate');
  const directorMeta = project.metadata?.director ? ` · DIR. ${project.metadata.director.toUpperCase()}` : '';
  const shotDatesMeta = project.metadata?.shot_dates ? ` · ${project.metadata.shot_dates.toUpperCase()}` : '';
  const hours = totalUnits > 0 ? units.reduce((s, u) => s + Math.max(0, (u.end_seconds || 0) - (u.start_seconds || 0)), 0) : 0;
  const hoursStr = `${Math.floor(hours / 3600)}:${String(Math.floor((hours % 3600) / 60)).padStart(2, '0')}`;
  const scenes = groupIntoScenes(units);

  plate.innerHTML = `
    <div style="flex:1">
      <div class="v2-plate-meta">
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.28em">PROJECT FILE · ${escHtml((project.slug || project.name || '').toUpperCase().slice(0, 8))}</span>
        <span style="width:1px;height:12px;background:var(--h-border);display:inline-block"></span>
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.16em">${escHtml(directorMeta)}</span>
        <span style="width:1px;height:12px;background:var(--h-border);display:inline-block"></span>
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.16em">${escHtml(shotDatesMeta)}</span>
      </div>
      <div class="v2-plate-title">${escHtml(project.name?.toUpperCase() || 'UNTITLED')}<span class="v2-plate-dot">.</span></div>
    </div>
    <div class="v2-plate-stats">
      <div class="v2-plate-stat">
        <span class="v2-caps v2-caps--sm v2-caps--dim">ANALYZED</span>
        <div class="v2-plate-stat-value">${analyzedUnits.toLocaleString()}</div>
        <span class="v2-caps v2-caps--xs v2-caps--dim" style="letter-spacing:0.16em">OF ${totalUnits.toLocaleString()}</span>
      </div>
      <div class="v2-plate-stat">
        <span class="v2-caps v2-caps--sm v2-caps--dim">HOURS</span>
        <div class="v2-plate-stat-value">${hoursStr}</div>
      </div>
      <div class="v2-plate-stat">
        <span class="v2-caps v2-caps--sm v2-caps--dim">SCENES</span>
        <div class="v2-plate-stat-value" style="color:var(--h-raw)">${scenes.length}</div>
        <span class="v2-caps v2-caps--xs v2-caps--dim">DETECTED</span>
      </div>
      <div class="v2-plate-stat" style="border-right:none">
        <span class="v2-caps v2-caps--sm v2-caps--dim">TIERS</span>
        <div class="v2-plate-stat-value">${assets.length}</div>
        <span class="v2-caps v2-caps--xs v2-caps--dim">CONNECTED</span>
      </div>
    </div>
  `;

  // ── TabStrip ──
  const tabstrip = document.getElementById('v2-tabstrip');
  tabstrip.innerHTML = TABS_V2.map((t, i) => `
    <button class="v2-tab${t.id === v2Tab ? ' active' : ''}" data-tab="${t.id}" style="${i < TABS_V2.length - 1 ? '' : 'border-right:none'}">
      <span class="v2-tab-num">${t.num}</span>
      <div style="flex:1;min-width:0">
        <div class="v2-tab-label">${t.label}</div>
        <div class="v2-tab-hint">${t.hint}</div>
      </div>
      <span class="v2-tab-pip"></span>
    </button>
  `).join('');

  tabstrip.querySelectorAll('.v2-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      v2Tab = btn.dataset.tab;
      v2SwitchTab(v2Tab, signal);
    }, { signal });
  });

  // ── FootBar ──
  renderV2Footbar();

  // ── Render initial tab ──
  v2SwitchTab(v2Tab, signal);
}

function v2SwitchTab(tabId, signal) {
  // Update tab strip
  document.querySelectorAll('.v2-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));

  // Update panels
  document.querySelectorAll('.v2-tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `v2-panel-${tabId}`);
  });

  // Render content
  const { project, assets, units, patterns, tierStats } = v2Data;
  switch (tabId) {
    case 'inputs':   renderInputsTab(assets, units, tierStats); break;
    case 'training': renderTrainingTab(units, assets); break;
    case 'insights': renderInsightsTab(units, patterns, assets, signal); break;
    case 'scenes':   renderScenesTab(units, signal); break;
    case 'script':   renderScriptTab(project, assets, signal); break;
  }

  // Update footbar
  renderV2Footbar();
}

function renderV2Footbar() {
  const tabMeta = TABS_V2.find(t => t.id === v2Tab);
  const foot = document.getElementById('v2-footbar');
  const { project } = v2Data;
  foot.innerHTML = `
    <div class="v2-footbar-cell v2-footbar-cell--active">§${tabMeta.num} · ${tabMeta.label}</div>
    <div class="v2-footbar-cell">${escHtml((project?.slug || project?.name || '').toUpperCase())}</div>
    <div class="v2-footbar-spacer"></div>
    <div class="v2-footbar-cell v2-footbar-cell--right">READY</div>
    <div class="v2-footbar-cell v2-footbar-cell--right">⌘K · COMMANDS</div>
  `;
}

// ── §01 INPUTS TAB ──

function renderInputsTab(assets, units, tierStats) {
  const panel = document.getElementById('v2-panel-inputs');

  const TIERS = ['raw', 'script', 'selects', 'finished'];
  const SOURCE_DATA = {
    raw: { kind: 'DROPBOX FOLDER', counts: (a, ts) => [['CLIPS', `${ts?.total || 0}`], ['HOURS', formatHoursFromUnits(units, a)], ['CAMERAS', countCameras(units)], ['DAYS', countDays(units)]] },
    script: { kind: 'GOOGLE DOC / FILE', counts: (a) => [['TYPE', a[0]?.format?.toUpperCase() || '—'], ['SOURCE', a[0]?.source_kind?.toUpperCase() || '—'], ['STATUS', a[0]?.queue_status?.toUpperCase() || '—'], ['ADDED', a[0]?.created_at ? formatDate(a[0].created_at) : '—']] },
    selects: { kind: 'FCP7 XML / EDL', counts: (a, ts) => [['SEQUENCES', `${a.length}`], ['CLIPS', `${ts?.total || 0}`], ['STATUS', a[0]?.queue_status?.toUpperCase() || '—'], ['ADDED', a[0]?.created_at ? formatDate(a[0].created_at) : '—']] },
    finished: { kind: 'YOUTUBE / VIMEO', counts: (a) => [['SOURCE', a[0]?.source_kind?.toUpperCase() || '—'], ['REF', (a[0]?.source_ref || '').slice(0, 30) || '—'], ['STATUS', a[0]?.queue_status?.toUpperCase() || '—'], ['ADDED', a[0]?.created_at ? formatDate(a[0].created_at) : '—']] },
  };

  const sourceCards = TIERS.map(tier => {
    const tierAssets = assets.filter(a => a.tier === tier || (tier === 'script' && a.tier === 'google_docs'));
    const color = TIER_COLORS[tier];
    const connected = tierAssets.length > 0;
    const sd = SOURCE_DATA[tier];
    const ts = tierStats?.[tier] || tierStats?.[tier === 'script' ? 'google_docs' : tier];
    const state = connected ? (tierAssets[0]?.queue_status === 'done' ? 'parsed' : tierAssets[0]?.queue_status === 'error' ? 'error' : 'syncing') : 'empty';
    const stateColors = { syncing: '#FFB000', parsed: '#22C55E', empty: 'var(--h-dim)', error: '#FF3B20' };
    const stateLabels = { syncing: 'SYNCING', parsed: 'PARSED', empty: 'NOT CONNECTED', error: 'ERROR' };
    const path = connected ? tierAssets[0].source_ref : '—';
    const counts = connected ? sd.counts(tierAssets, ts) : [['—', '—'], ['—', '—'], ['—', '—'], ['—', '—']];
    const lastSync = connected && tierAssets[0].updated_at ? `SYNCED ${formatTimeAgo(new Date(tierAssets[0].updated_at)).toUpperCase()}` : '—';

    // Progress for tier
    const progress = ts ? (ts.total > 0 ? ts.analyzed / ts.total : 0) : 0;

    return `
      <div class="v2-source-card">
        <div class="v2-source-strip">
          <div class="v2-source-strip-color" style="background:${color}"></div>
          <div class="v2-source-strip-info">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">${TIER_LABELS_V2[tier] || tier.toUpperCase()}</span>
            <span style="width:1px;height:10px;background:var(--h-border);display:inline-block"></span>
            <span class="v2-caps v2-caps--sm v2-caps--dim">${sd.kind}</span>
          </div>
          <div class="v2-source-strip-state">
            ${state === 'syncing' ? '<span style="width:6px;height:6px;background:#FFB000;animation:hpulse 1.4s steps(2) infinite;display:inline-block"></span>' : ''}
            <span class="v2-caps v2-caps--sm" style="color:${stateColors[state]}">${stateLabels[state]}</span>
          </div>
        </div>
        <div class="v2-source-body">
          <div class="v2-source-role">${TIER_ROLES[tier] || ''}</div>
          <div class="v2-source-path">
            <span style="color:${color};font-size:13px;font-weight:600">›</span>
            <span class="v2-source-path-text">${escHtml(path)}</span>
            <span class="v2-caps v2-caps--sm v2-caps--dim">EDIT</span>
          </div>
          <div class="v2-source-counts">
            ${counts.map(([k, v]) => `
              <div class="v2-source-count-row">
                <span class="v2-caps v2-caps--sm v2-caps--dim" style="letter-spacing:0.16em">${k}</span>
                <span class="v2-source-count-val">${v}</span>
              </div>
            `).join('')}
          </div>
          ${progress > 0 && progress < 1 ? `
            <div style="margin-bottom:14px">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span class="v2-caps v2-caps--sm v2-caps--dim">INGEST PROGRESS</span>
                <span style="font-size:10px;color:${color};font-variant-numeric:tabular-nums;font-weight:600">${(progress * 100).toFixed(1)}%</span>
              </div>
              <div class="v2-progress" style="height:4px">${renderProgressSegs(progress, 48, color)}</div>
            </div>
          ` : ''}
          <div class="v2-source-footer">
            <span class="v2-caps v2-caps--sm v2-caps--dim" style="letter-spacing:0.12em">${lastSync}</span>
            <div style="display:flex;gap:6px">
              ${connected ? `
                <button class="v2-btn-sec" data-action="open" data-tier="${tier}">OPEN</button>
                <button class="v2-btn-sec" data-action="resync" data-tier="${tier}">RE-SYNC</button>
                <button class="v2-btn-primary" style="background:${color};border-color:${color}" data-action="replace" data-tier="${tier}">REPLACE →</button>
              ` : `
                <button class="v2-btn-primary" style="background:${color};border-color:${color}" data-action="configure" data-tier="${tier}">CONFIGURE →</button>
              `}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Cross-tier linkage
  const rawAssets = assets.filter(a => a.tier === 'raw');
  const selectsAssets = assets.filter(a => a.tier === 'selects');
  const finishedAssets = assets.filter(a => a.tier === 'finished');
  const scriptAssets = assets.filter(a => a.tier === 'script' || a.tier === 'google_docs');
  const rawCount = tierStats?.raw?.total || 0;
  const selectsCount = tierStats?.selects?.total || 0;
  const finishedCount = tierStats?.finished?.total || 0;
  const scriptCount = tierStats?.script?.total || tierStats?.google_docs?.total || 0;

  const links = [
    { from: 'RAW', fromColor: TIER_COLORS.raw, to: 'SELECTS', toColor: TIER_COLORS.selects, n: selectsCount > 0 ? `${selectsCount}` : '—', label: rawCount > 0 && selectsCount > 0 ? `clips kept by editor (${(selectsCount / rawCount * 100).toFixed(0)}%)` : 'no data yet' },
    { from: 'RAW', fromColor: TIER_COLORS.raw, to: 'SCRIPT', toColor: TIER_COLORS.script, n: scriptCount > 0 ? `${scriptCount}` : '—', label: 'beats with footage candidates' },
    { from: 'SELECTS', fromColor: TIER_COLORS.selects, to: 'FINISHED', toColor: TIER_COLORS.finished, n: finishedCount > 0 ? `${finishedCount}` : '—', label: 'survived to final cut' },
    { from: 'SCRIPT', fromColor: TIER_COLORS.script, to: 'FINISHED', toColor: TIER_COLORS.finished, n: finishedCount > 0 ? `${finishedCount}` : '—', label: 'beats present in final' },
  ];

  panel.innerHTML = `
    <div class="v2-inputs-wrap">
      <div class="v2-section-head">
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.28em">§01</span>
        <div style="flex:1">
          <div class="v2-section-title">Inputs<span style="color:var(--h-raw)">.</span></div>
          <div class="v2-section-sub">Connect the four sources Hunter can read from. Each gets ingested, embedded, and cross-indexed against the others.</div>
        </div>
      </div>
      <div class="v2-sources-grid">${sourceCards}</div>
      <div class="v2-crosslinks">
        <div class="v2-crosslinks-header">
          <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">CROSS-TIER LINKAGE</span>
          <span class="v2-caps v2-caps--sm v2-caps--dim">CONTINUOUS</span>
        </div>
        <div class="v2-crosslinks-grid">
          ${links.map((l, i) => `
            <div class="v2-crosslinks-cell">
              <div class="v2-crosslinks-dots">
                <span class="v2-crosslinks-dot" style="background:${l.fromColor}"></span>
                <span class="v2-caps v2-caps--sm" style="color:var(--h-muted)">${l.from}</span>
                <span class="v2-crosslinks-line"></span>
                <span class="v2-caps v2-caps--sm" style="color:var(--h-muted)">${l.to}</span>
                <span class="v2-crosslinks-dot" style="background:${l.toColor}"></span>
              </div>
              <div class="v2-crosslinks-num">${l.n}</div>
              <div class="v2-crosslinks-label">${l.label}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Wire up configure/replace buttons
  panel.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tier = btn.dataset.tier;
      const action = btn.dataset.action;
      if (action === 'configure' || action === 'replace') {
        if (tier === 'raw') promptDropboxFolder('raw');
        else if (tier === 'script') promptScriptUpload();
        else if (tier === 'selects') promptSelectsUpload();
        else if (tier === 'finished') promptYoutubeUrl();
      }
    });
  });
}

// ── §02 TRAINING TAB ──

function renderTrainingTab(units, assets) {
  const panel = document.getElementById('v2-panel-training');
  const totalUnits = units.length;
  const analyzedUnits = units.filter(u => u.analyses?.length > 0).length;
  const pct = totalUnits > 0 ? ((analyzedUnits / totalUnits) * 100) : 0;

  // Pipeline stages
  const stages = [
    { id: 'ingest', label: 'INGEST', state: pct > 0 ? 'done' : 'queued' },
    { id: 'fingerprint', label: 'FINGERPRINT', state: pct >= 30 ? 'done' : pct > 0 ? 'running' : 'queued' },
    { id: 'cluster', label: 'CLUSTER', state: pct >= 60 ? 'done' : pct >= 30 ? 'running' : 'queued' },
    { id: 'describe', label: 'DESCRIBE', state: pct >= 90 ? 'done' : pct >= 60 ? 'running' : 'queued' },
    { id: 'pattern', label: 'PATTERN', state: pct >= 100 ? 'done' : pct >= 90 ? 'running' : 'queued' },
  ];

  const stageColors = { done: '#22C55E', running: '#FFB000', queued: 'var(--h-dim)' };

  // Recent analyses for the feed
  const recentUnits = units
    .filter(u => u.analyses?.length > 0)
    .sort((a, b) => new Date(b.analyses[0].created_at || 0) - new Date(a.analyses[0].created_at || 0))
    .slice(0, 40);

  const feedRows = recentUnits.map((u, i) => {
    const clipName = (u.source_clip_name || u.sourceClipName || 'unknown').replace(/_Proxy\.MP4$/i, '');
    const quip = generateQuip(u.analyses[0].output_text || '');
    const ts = extractDateFromClipName(u.source_clip_name || u.sourceClipName || '');
    const timeLabel = ts ? ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--';
    const stageIdx = i % stages.length;
    const mark = stages[stageIdx].state === 'done' ? '✓' : stages[stageIdx].state === 'running' ? '◉' : '·';
    const markColor = stageColors[stages[stageIdx].state];
    return `<div class="v2-feed-row${i < 3 ? ' v2-feed-row--active' : ''}">
      <span class="v2-feed-time">${timeLabel}</span>
      <span class="v2-feed-mark" style="color:${markColor}">${mark}</span>
      <div>
        <div class="v2-feed-name">${escHtml(clipName)}</div>
        <div class="v2-feed-quip">${escHtml(quip)}</div>
      </div>
      <span class="v2-feed-time">${formatTc(u.start_seconds)}</span>
    </div>`;
  }).join('');

  // Duplicate for scroll animation
  const scrollContent = feedRows + feedRows;

  const hoursTotal = units.reduce((s, u) => s + Math.max(0, (u.end_seconds || 0) - (u.start_seconds || 0)), 0);
  const hoursStr = `${Math.floor(hoursTotal / 3600)}:${String(Math.floor((hoursTotal % 3600) / 60)).padStart(2, '0')}`;

  panel.innerHTML = `
    <div class="v2-training-wrap">
      <div class="v2-section-head">
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.28em">§02</span>
        <div style="flex:1">
          <div class="v2-section-title">Training<span style="color:var(--h-raw)">.</span></div>
          <div class="v2-section-sub">Pipeline status and live clip processing feed.</div>
        </div>
      </div>

      <!-- Big status -->
      <div class="v2-big-status">
        <div class="v2-big-status-top">
          <div class="v2-big-pct">${pct.toFixed(1)}<span class="v2-big-pct-sign">%</span></div>
          <div class="v2-big-status-info">
            <div class="v2-big-status-current">${analyzedUnits.toLocaleString()} of ${totalUnits.toLocaleString()} clips analyzed</div>
            <div class="v2-big-status-eta">${pct < 100 ? 'IN PROGRESS' : 'COMPLETE'}</div>
            <div class="v2-progress" style="height:6px">${renderProgressSegs(pct / 100, 64, '#FFB000')}</div>
            <div class="v2-big-status-scale">
              <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>
        </div>
        <div class="v2-big-stats">
          <div class="v2-big-stat">
            <span class="v2-caps v2-caps--sm v2-caps--dim">CLIPS</span>
            <div class="v2-big-stat-value">${totalUnits.toLocaleString()}</div>
          </div>
          <div class="v2-big-stat">
            <span class="v2-caps v2-caps--sm v2-caps--dim">ANALYZED</span>
            <div class="v2-big-stat-value" style="color:var(--h-raw)">${analyzedUnits.toLocaleString()}</div>
          </div>
          <div class="v2-big-stat">
            <span class="v2-caps v2-caps--sm v2-caps--dim">HOURS</span>
            <div class="v2-big-stat-value">${hoursStr}</div>
          </div>
          <div class="v2-big-stat">
            <span class="v2-caps v2-caps--sm v2-caps--dim">TIERS</span>
            <div class="v2-big-stat-value">${assets.length}</div>
          </div>
          <div class="v2-big-stat" style="border-right:none">
            <span class="v2-caps v2-caps--sm v2-caps--dim">SCENES</span>
            <div class="v2-big-stat-value">${groupIntoScenes(units).length}</div>
          </div>
        </div>
      </div>

      <!-- Pipeline + Feed split -->
      <div class="v2-training-split">
        <div class="v2-card">
          <div class="v2-card-header">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">PIPELINE</span>
            <span class="v2-caps v2-caps--sm v2-caps--dim">${stages.filter(s => s.state === 'done').length}/${stages.length} COMPLETE</span>
          </div>
          <div class="v2-card-body">
            ${stages.map(s => `
              <div class="v2-stage">
                <div class="v2-stage-top">
                  <div class="v2-stage-label">
                    <span class="v2-stage-dot" style="background:${stageColors[s.state]}${s.state === 'running' ? ';animation:hpulse 1.4s steps(2) infinite' : ''}"></span>
                    <span class="v2-caps v2-caps--sm">${s.label}</span>
                  </div>
                  <span class="v2-stage-pct">${s.state === 'done' ? '100%' : s.state === 'running' ? `${Math.round(pct)}%` : '—'}</span>
                </div>
                <div class="v2-progress" style="height:3px">${renderProgressSegs(s.state === 'done' ? 1 : s.state === 'running' ? pct / 100 : 0, 16, stageColors[s.state])}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="v2-card">
          <div class="v2-card-header">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">LIVE FEED</span>
            <span class="v2-caps v2-caps--sm v2-caps--dim">${recentUnits.length} RECENT</span>
          </div>
          <div class="v2-feed-wrap">
            <div class="v2-feed-scroll" style="animation-duration:${Math.max(30, recentUnits.length * 2)}s">
              ${scrollContent || '<div class="v2-empty">no clips processed yet</div>'}
            </div>
            <div class="v2-feed-fade-top"></div>
            <div class="v2-feed-fade-bottom"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── §03 INSIGHTS TAB ──

let v2ChatHistory = [];

function renderInsightsTab(units, patterns, assets, signal) {
  const panel = document.getElementById('v2-panel-insights');
  const analyzed = units.filter(u => u.analyses?.[0]?.output_text);

  if (analyzed.length < 3) {
    panel.innerHTML = '<div class="v2-empty">Not enough analyzed footage to generate insights. Continue training.</div>';
    return;
  }

  // Aggregate metadata
  const emotions = {};
  const shotTypes = {};
  let keepSum = 0, keepN = 0;
  for (const u of analyzed) {
    const j = u.analyses?.[0]?.output_json;
    if (!j) continue;
    if (j.emotional_register) emotions[j.emotional_register] = (emotions[j.emotional_register] || 0) + 1;
    if (j.shot_type) shotTypes[j.shot_type] = (shotTypes[j.shot_type] || 0) + 1;
    if (j.keepability_score != null) { keepSum += j.keepability_score; keepN++; }
  }
  const topEmotions = Object.entries(emotions).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topShots = Object.entries(shotTypes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const avgKeep = keepN > 0 ? (keepSum / keepN).toFixed(2) : '—';
  const scenes = groupIntoScenes(units);

  // Read rich project context from metadata if available
  const richContext = v2Data?.project?.metadata?.context || '';
  const ctxStatus = v2Data?.project?.metadata?.corpus_context_status;

  // Phase labels for status display
  const phaseLabels = {
    subjects: 'EXTRACTING SUBJECTS',
    scenes: 'MATERIALIZING SCENES',
    scene_synthesis: 'SYNTHESIZING SCENES',
    day_synthesis: 'SYNTHESIZING DAYS',
    project_synthesis: 'MASTER SYNTHESIS',
    complete: 'COMPLETE',
  };

  panel.innerHTML = `
    <div class="v2-insights-wrap">
      <div class="v2-section-head">
        <span class="v2-caps v2-caps--dim" style="letter-spacing:0.28em">§03</span>
        <div style="flex:1">
          <div class="v2-section-title">Insights<span style="color:var(--h-raw)">.</span></div>
          <div class="v2-section-sub">Hunter's narrative intelligence — master arc, scene breakdowns, thematic threads.</div>
        </div>
        <button class="v2-btn-primary" id="v2-btn-generate-insights">GENERATE NARRATIVE</button>
      </div>

      <!-- Context engine status banner -->
      <div id="v2-context-status"></div>

      <!-- Meta stats -->
      <div class="v2-narrative-meta">
        <div class="v2-meta-cell">
          <span class="v2-caps v2-caps--sm v2-caps--dim">CORPUS</span>
          <div class="v2-meta-value">${analyzed.length.toLocaleString()}</div>
        </div>
        <div class="v2-meta-cell">
          <span class="v2-caps v2-caps--sm v2-caps--dim">SCENES</span>
          <div class="v2-meta-value">${scenes.length}</div>
        </div>
        <div class="v2-meta-cell">
          <span class="v2-caps v2-caps--sm v2-caps--dim">AVG KEEP</span>
          <div class="v2-meta-value">${avgKeep}</div>
        </div>
        <div class="v2-meta-cell">
          <span class="v2-caps v2-caps--sm v2-caps--dim">TOP REGISTER</span>
          <div class="v2-meta-value" style="font-size:14px">${topEmotions[0]?.[0] || '—'}</div>
        </div>
        <div class="v2-meta-cell" style="border-right:none">
          <span class="v2-caps v2-caps--sm v2-caps--dim">EMOTIONAL PALETTE</span>
          <div class="v2-meta-value" style="font-size:10px">${topEmotions.slice(0, 4).map(([e, n]) => `${e}(${n})`).join(' · ')}</div>
        </div>
      </div>

      <!-- Master Narrative -->
      <div id="v2-master-narrative"><div style="padding:24px;text-align:center"><span class="v2-caps v2-caps--sm" style="color:var(--h-muted)">LOADING...</span></div></div>

      <!-- Scene Breakdowns / Day Timeline -->
      <div id="v2-scene-breakdowns"></div>

      <!-- Chat footer -->
      <div class="v2-chat-footer">
        <div>
          <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">ASK HUNTER</span>
          <div style="font-size:10px;color:var(--h-muted);margin-top:4px">Ask anything about your footage — "what scenes feel most intimate?" · "find all coffee ceremonies"</div>
        </div>
        <div class="v2-chat-input-box">
          <span class="v2-chat-caret"></span>
          <input type="text" class="v2-chat-input" id="v2-chat-input" placeholder="ask anything about your footage..." autocomplete="off">
        </div>
        <button class="v2-btn-primary" id="v2-chat-send">SEND</button>
      </div>
      <div id="v2-chat-messages" style="margin-top:16px"></div>
    </div>
  `;

  // ── Status polling for context engine ──
  function renderStatus(status) {
    const el = document.getElementById('v2-context-status');
    if (!el) return;
    if (!status || status.phase === 'complete') {
      el.innerHTML = '';
      return;
    }
    const label = phaseLabels[status.phase] || status.phase.toUpperCase();
    el.innerHTML = `
      <div style="padding:12px 16px;background:linear-gradient(90deg, rgba(255,107,53,0.08) 0%, rgba(255,107,53,0.02) 100%);border:1px solid rgba(255,107,53,0.15);margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span class="v2-caps v2-caps--sm" style="color:var(--h-raw);animation:hpulse 1.4s steps(2) infinite;letter-spacing:0.18em">CONTEXT ENGINE RUNNING</span>
          <span style="font-size:11px;color:var(--h-muted)">${label}</span>
        </div>
        <div style="height:3px;background:var(--h-border);overflow:hidden">
          <div style="height:100%;width:${status.pct || 0}%;background:var(--h-raw);transition:width 0.5s"></div>
        </div>
        <div style="font-size:10px;color:var(--h-muted);margin-top:4px">${escHtml(status.message || '')}</div>
      </div>
    `;
  }

  // Show initial status if engine is running
  if (ctxStatus && ctxStatus.phase !== 'complete') {
    renderStatus(ctxStatus);
  }

  // Poll for status updates every 10s while engine is running
  let statusPollId = null;
  if (ctxStatus && ctxStatus.phase !== 'complete') {
    statusPollId = setInterval(async () => {
      try {
        const proj = await getProject(currentProjectId);
        const s = proj?.metadata?.corpus_context_status;
        if (s) {
          renderStatus(s);
          if (s.phase === 'complete') {
            clearInterval(statusPollId);
            // Reload the insights tab to show the new data
            setTimeout(() => {
              const { project, assets, units, patterns, tierStats } = v2Data;
              // Refresh project metadata
              getProject(currentProjectId).then(p => {
                v2Data.project = p;
                renderInsightsTab(units, patterns, assets, signal);
              });
            }, 2000);
          }
        } else {
          clearInterval(statusPollId);
          renderStatus(null);
        }
      } catch {}
    }, 10000);
    signal?.addEventListener('abort', () => clearInterval(statusPollId));
  }

  // ── Load pre-computed data or show generate button ──
  (async () => {
    const narrativeEl = document.getElementById('v2-master-narrative');
    const breakdownsEl = document.getElementById('v2-scene-breakdowns');
    const genBtn = document.getElementById('v2-btn-generate-insights');

    try {
      const arcs = await listArcSummaries(currentProjectId);
      const projectArc = arcs.find(a => a.level === 'project');

      if (projectArc) {
        // ── PRE-COMPUTED DATA EXISTS — full render ──
        const result = JSON.parse(projectArc.summary_text);
        genBtn.textContent = 'REGENERATE';

        const arcParagraphs = (result.master_arc || '').split(/\n\n+/).filter(Boolean);
        const themes = result.themes || [];
        const subjectArcs = result.subject_arcs || [];
        const recommendations = result.editorial_recommendations || [];

        narrativeEl.innerHTML = `
          <div class="v2-master-narrative">
            ${result.title ? `<h2 class="v2-narrative-title">${escHtml(result.title)}</h2>` : ''}
            ${result.lede ? `<p class="v2-narrative-lede">${escHtml(result.lede)}</p>` : ''}
            <div class="v2-narrative-arc">
              ${arcParagraphs.map(p => `<p class="v2-narrative-arc-p">${escHtml(p)}</p>`).join('')}
            </div>
            ${themes.length ? `
              <div class="v2-narrative-themes">
                <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em;display:block;margin-bottom:12px">THEMATIC THREADS</span>
                ${themes.map(t => `
                  <div class="v2-theme-row">
                    <span class="v2-theme-name">${escHtml(t.name || '')}</span>
                    <span class="v2-theme-desc">${escHtml(t.description || '')}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            ${subjectArcs.length ? `
              <div class="v2-narrative-themes" style="margin-top:20px">
                <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em;display:block;margin-bottom:12px">SUBJECT ARCS</span>
                ${subjectArcs.map(s => `
                  <div class="v2-theme-row">
                    <span class="v2-theme-name">${escHtml(s.name || '')}</span>
                    <span class="v2-theme-desc">${escHtml(s.arc || '')}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            ${recommendations.length ? `
              <div class="v2-narrative-themes" style="margin-top:20px">
                <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em;display:block;margin-bottom:12px">EDITORIAL RECOMMENDATIONS</span>
                ${recommendations.map((r, ri) => `
                  <div class="v2-theme-row">
                    <span class="v2-theme-name" style="min-width:16px">${ri + 1}.</span>
                    <span class="v2-theme-desc">${escHtml(r)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;

        // ── SCENE BREAKDOWNS from DB ──
        const dbScenes = await listScenes(currentProjectId);
        const sceneArcs = arcs.filter(a => a.level === 'scene');
        const sceneArcMap = new Map(sceneArcs.map(a => [a.scope_ref, a]));

        // ── DAY SUMMARIES ──
        const dayArcs = arcs.filter(a => a.level === 'day').sort((a, b) => a.scope_ref.localeCompare(b.scope_ref));

        let breakdownHtml = '';

        // Day-by-day timeline first (higher-level view)
        if (dayArcs.length) {
          breakdownHtml += `
            <div class="v2-scene-breakdowns">
              <div style="padding:12px 16px;border-bottom:1px solid var(--h-border)">
                <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">DAY-BY-DAY TIMELINE</span>
                <span class="v2-caps v2-caps--dim" style="margin-left:8px">${dayArcs.length} SHOOTING DAYS</span>
              </div>
              ${dayArcs.map((da, i) => {
                let dayData = {};
                try { dayData = JSON.parse(da.summary_text); } catch {}
                const dayScenes = dbScenes.filter(s => s.shoot_day === da.scope_ref);
                // Format date nicely — "Oct 4" or "Day N" for bad dates
                let dayLabel = `Day ${i + 1}`;
                try {
                  const d = new Date(da.scope_ref + 'T12:00:00');
                  if (d.getFullYear() >= 2020) dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                } catch {}
                return `
                  <div class="v2-breakdown-card">
                    <div class="v2-breakdown-header">
                      <div class="v2-day-badge">
                        <span class="v2-day-badge-num">${i + 1}</span>
                        <span class="v2-day-badge-date">${escHtml(dayLabel)}</span>
                      </div>
                      <div style="flex:1;min-width:0">
                        <div class="v2-breakdown-title" style="font-size:14px;font-weight:600">${escHtml(dayData.day_character || '')}</div>
                        <div class="v2-breakdown-meta">
                          <span>${dayScenes.length} scenes</span>
                          ${dayData.strongest_scene ? `<span style="color:var(--h-finished)">Best: ${escHtml((dayData.strongest_scene || '').slice(0, 50))}</span>` : ''}
                        </div>
                      </div>
                    </div>
                    ${dayData.emotional_arc ? `<div style="font-size:11px;color:var(--h-script);margin:4px 0 8px 0;font-style:italic">${escHtml(dayData.emotional_arc)}</div>` : ''}
                    ${dayData.day_narrative ? `<p class="v2-breakdown-desc" style="line-height:1.65">${escHtml(dayData.day_narrative.slice(0, 400))}</p>` : ''}
                    ${dayData.dominant_themes?.length ? `<div style="margin-top:8px">${dayData.dominant_themes.map(t => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 7px;font-size:9px;letter-spacing:0.08em;border:1px solid var(--h-border);color:var(--h-muted)">${escHtml(t)}</span>`).join('')}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        // Scene breakdowns
        if (dbScenes.length) {
          breakdownHtml += `
            <div class="v2-scene-breakdowns" style="margin-top:16px">
              <div style="padding:12px 16px;border-bottom:1px solid var(--h-border)">
                <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">SCENE BREAKDOWNS</span>
                <span class="v2-caps v2-caps--dim" style="margin-left:8px">${dbScenes.length} SCENES</span>
              </div>
              ${dbScenes.map((sc, i) => {
                let scData = {};
                const arc = sceneArcMap.get(sc.id);
                if (arc) try { scData = JSON.parse(arc.summary_text); } catch {}
                const keep = scData.keepability != null ? scData.keepability : null;
                const keepPct = keep != null ? Math.round(keep * 100) : null;
                const keepColor = keep != null ? (keep >= 0.7 ? 'var(--h-finished)' : keep >= 0.4 ? 'var(--h-script)' : 'var(--h-muted)') : '';
                const heroClips = (scData.hero_clips || []).slice(0, 3);
                return `
                  <div class="v2-breakdown-card">
                    <div class="v2-breakdown-header">
                      <span class="v2-breakdown-num">${String(i + 1).padStart(2, '0')}</span>
                      <div style="flex:1;min-width:0">
                        <div class="v2-breakdown-title">${escHtml(sc.name || `Scene ${i + 1}`)}</div>
                        <div class="v2-breakdown-meta">
                          ${sc.shoot_day ? `<span>${sc.shoot_day}</span>` : ''}
                          ${sc.time_of_day ? `<span>${sc.time_of_day}</span>` : ''}
                          <span>${sc.clip_count || 0} clips</span>
                          ${sc.scene_type ? `<span>${sc.scene_type}</span>` : ''}
                          ${sc.location ? `<span>${escHtml(sc.location)}</span>` : ''}
                        </div>
                      </div>
                      ${keepPct != null ? `<span style="color:${keepColor};font-size:11px;font-weight:600">${keepPct}%</span>` : ''}
                    </div>
                    ${sc.arc_summary ? `<p class="v2-breakdown-desc" style="line-height:1.6">${escHtml(sc.arc_summary.slice(0, 600))}</p>` : ''}
                    ${sc.emotional_curve ? `<div class="v2-breakdown-keyclip"><span class="v2-caps v2-caps--sm v2-caps--dim">CURVE</span> <span style="color:var(--h-script);font-size:11px;font-style:italic">${escHtml(sc.emotional_curve)}</span></div>` : ''}
                    ${sc.editorial_notes ? `<div class="v2-breakdown-connections"><span class="v2-caps v2-caps--sm v2-caps--dim">EDITORIAL</span> <span style="color:var(--h-muted);font-size:11px">${escHtml(sc.editorial_notes)}</span></div>` : ''}
                    ${heroClips.length ? `<div class="v2-breakdown-connections"><span class="v2-caps v2-caps--sm v2-caps--dim">HERO CLIPS</span> ${heroClips.map(c => `<span style="display:inline-block;margin:1px 3px;padding:1px 5px;font-size:9px;letter-spacing:0.06em;border:1px solid var(--h-finished);color:var(--h-finished)">${escHtml((c || '').replace(/_Proxy\.MP4$/i, '').slice(-25))}</span>`).join('')}</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }

        breakdownsEl.innerHTML = breakdownHtml;

      } else if (ctxStatus && ctxStatus.phase !== 'complete') {
        // Engine is running but no data yet
        narrativeEl.innerHTML = '';
        breakdownsEl.innerHTML = `<div class="v2-empty" style="color:var(--h-muted)">Context engine is building the narrative layer — insights will appear here when complete.</div>`;
      } else {
        // No pre-computed data, no engine running
        narrativeEl.innerHTML = '';
        breakdownsEl.innerHTML = `<div class="v2-empty">Click "Generate Narrative" for a quick on-the-fly synthesis from a sample of scenes.</div>`;
      }
    } catch {
      narrativeEl.innerHTML = '';
      breakdownsEl.innerHTML = `<div class="v2-empty">Click "Generate Narrative" — Hunter will watch your ${analyzed.length} clips and tell you what story lives in them.</div>`;
    }
  })();

  // Wire up Generate Narrative (fallback / re-generate)
  const genBtn = document.getElementById('v2-btn-generate-insights');
  genBtn?.addEventListener('click', async () => {
    genBtn.disabled = true;
    genBtn.textContent = 'ANALYZING FOOTAGE...';
    const narrativeEl = document.getElementById('v2-master-narrative');
    const breakdownsEl = document.getElementById('v2-scene-breakdowns');
    narrativeEl.innerHTML = '<div style="padding:24px;text-align:center"><span class="v2-caps v2-caps--sm" style="color:var(--h-raw);animation:hpulse 1.4s steps(2) infinite">HUNTER IS WATCHING YOUR FOOTAGE...</span></div>';
    breakdownsEl.innerHTML = '';

    try {
      const projectName = v2Data?.project?.name || '';
      const scenesPayload = scenes.slice(0, 30).map(s => {
        const durMin = Math.floor(s.totalDuration / 60);
        const durSec = Math.floor(s.totalDuration % 60);
        return {
          label: s.label,
          day: s.day,
          time: s.time,
          clipCount: s.clips.length,
          durationStr: `${durMin}m${durSec}s`,
          topEmotion: s.topEmotion,
          topShot: s.topShot,
          avgKeep: s.avgKeep,
          cameras: s.cameras.join(', ') || '?',
          clips: s.clips.slice(0, 10).map(c => ({
            clipName: c.source_clip_name || c.sourceClipName || '',
            startSeconds: c.start_seconds ?? c.startSeconds ?? 0,
            endSeconds: c.end_seconds ?? c.endSeconds ?? 0,
            analysisText: (c.analyses?.[0]?.output_text || '').replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim().slice(0, 250),
          })),
        };
      });

      const result = await fetchNarrativeInsights(scenesPayload, projectName);
      const mn = result.master_narrative || {};
      const breakdowns = result.scene_breakdowns || [];

      const arcParagraphs = (mn.arc || '').split(/\n\n+/).filter(Boolean);
      const themes = mn.themes || [];

      narrativeEl.innerHTML = `
        <div class="v2-master-narrative">
          ${mn.title ? `<h2 class="v2-narrative-title">${escHtml(mn.title)}</h2>` : ''}
          ${mn.lede ? `<p class="v2-narrative-lede">${escHtml(mn.lede)}</p>` : ''}
          <div class="v2-narrative-arc">
            ${arcParagraphs.map(p => `<p class="v2-narrative-arc-p">${escHtml(p)}</p>`).join('')}
          </div>
          ${themes.length ? `
            <div class="v2-narrative-themes">
              <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em;display:block;margin-bottom:12px">THEMATIC THREADS</span>
              ${themes.map(t => `
                <div class="v2-theme-row${t.count ? ' v2-theme-row--3col' : ''}">
                  <span class="v2-theme-name">${escHtml(t.name || '')}</span>
                  ${t.count ? `<span class="v2-theme-count">${t.count}</span>` : ''}
                  <span class="v2-theme-desc">${escHtml(t.description || '')}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;

      const verdictColors = { ESSENTIAL: 'var(--h-finished)', STRONG: 'var(--h-script)', USEFUL: 'var(--h-raw)', CUT: 'var(--h-selects)' };
      breakdownsEl.innerHTML = `
        <div class="v2-scene-breakdowns">
          <div style="padding:12px 16px;border-bottom:1px solid var(--h-border)">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">SCENE BREAKDOWNS</span>
            <span class="v2-caps v2-caps--dim" style="margin-left:8px">${breakdowns.length} SCENES</span>
          </div>
          ${breakdowns.map((bd, i) => {
            const scene = scenes[bd.scene_index ?? i];
            const vc = verdictColors[bd.editorial_verdict] || 'var(--h-muted)';
            return `
              <div class="v2-breakdown-card">
                <div class="v2-breakdown-header">
                  <span class="v2-breakdown-num">${String(i + 1).padStart(2, '0')}</span>
                  <div style="flex:1;min-width:0">
                    <div class="v2-breakdown-title">${escHtml(bd.title || `Scene ${i + 1}`)}</div>
                    <div class="v2-breakdown-meta">
                      ${scene?.day ? `<span>${scene.day}</span>` : ''}
                      ${bd.time_of_day ? `<span>${bd.time_of_day}</span>` : ''}
                      ${scene ? `<span>${scene.clips.length} clips</span>` : ''}
                    </div>
                  </div>
                  <span class="v2-breakdown-verdict" style="color:${vc};border-color:${vc}">${bd.editorial_verdict || ''}</span>
                </div>
                <p class="v2-breakdown-desc">${escHtml(bd.narrative_description || '')}</p>
                ${bd.key_clip ? `<div class="v2-breakdown-keyclip"><span class="v2-caps v2-caps--sm v2-caps--dim">KEY CLIP</span> <span style="color:var(--h-script);font-size:11px">${escHtml(bd.key_clip)}</span></div>` : ''}
                ${bd.connections ? `<div class="v2-breakdown-connections"><span class="v2-caps v2-caps--sm v2-caps--dim">CONNECTS TO</span> <span style="color:var(--h-muted);font-size:11px">${escHtml(bd.connections)}</span></div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      narrativeEl.innerHTML = `<div class="v2-empty" style="color:var(--h-err)">${escHtml(err.message)}</div>`;
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = 'GENERATE NARRATIVE';
    }
  }, { signal });

  // Wire up Chat
  const chatInput = document.getElementById('v2-chat-input');
  const chatSend = document.getElementById('v2-chat-send');

  async function sendV2Chat() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    const msgsEl = document.getElementById('v2-chat-messages');

    msgsEl.innerHTML += `<div style="text-align:right;margin-bottom:8px"><span style="display:inline-block;padding:8px 12px;background:var(--h-surface);font-size:12px;max-width:80%">${escHtml(msg)}</span></div>`;
    msgsEl.innerHTML += `<div id="v2-chat-thinking" style="margin-bottom:8px"><span class="v2-caps v2-caps--sm" style="color:var(--h-raw);animation:hpulse 1.4s steps(2) infinite">THINKING...</span></div>`;
    msgsEl.scrollTop = msgsEl.scrollHeight;

    v2ChatHistory.push({ role: 'user', content: msg });

    try {
      let relevantClips = [];
      try {
        const search = await semanticSearch({ query: msg, projectId: currentProjectId, limit: 10 });
        relevantClips = search.matches || [];
      } catch {}
      // Use rich project context from metadata.context if available
      let projectContext;
      if (richContext) {
        projectContext = richContext;
      } else {
        const tierCounts = {};
        for (const a of assets) tierCounts[a.tier] = (tierCounts[a.tier] || 0) + 1;
        projectContext = `PROJECT: ${analyzed.length} analyzed clips. Tiers: ${Object.entries(tierCounts).map(([t, c]) => `${t}(${c})`).join(', ')}.`;
      }

      const { reply, citedClips } = await chatWithFootage({ message: msg, conversationHistory: v2ChatHistory.slice(-10), projectContext, relevantClips });
      document.getElementById('v2-chat-thinking')?.remove();
      v2ChatHistory.push({ role: 'assistant', content: reply });

      const cited = (citedClips || []).map(c => {
        const name = (c.clipName || '').replace(/_Proxy\.MP4$/i, '').replace(/^\d{8}-\d{4}-/, '');
        return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:1px 5px;font-size:9px;letter-spacing:0.08em;border:1px solid var(--h-script);color:var(--h-script)">${escHtml(name)}</span>`;
      }).join('');

      msgsEl.innerHTML += `<div style="margin-bottom:8px"><span class="v2-caps v2-caps--xs" style="color:var(--h-raw);display:block;margin-bottom:4px">HUNTER</span><div style="font-size:12px;line-height:1.6;color:var(--h-fg);max-width:80%">${escHtml(reply)}</div>${cited ? `<div style="margin-top:4px">${cited}</div>` : ''}</div>`;
    } catch (err) {
      document.getElementById('v2-chat-thinking')?.remove();
      msgsEl.innerHTML += `<div style="margin-bottom:8px;color:var(--h-err);font-size:11px">${escHtml(err.message)}</div>`;
    }
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  chatSend?.addEventListener('click', sendV2Chat, { signal });
  chatInput?.addEventListener('keydown', e => { if (e.key === 'Enter') sendV2Chat(); }, { signal });
}

// ── §04 SCENE BUILDER TAB ──

let v2SelectedScene = 0;
let v2SceneFilter = 'all';

function renderScenesTab(units, signal) {
  const panel = document.getElementById('v2-panel-scenes');
  const scenes = groupIntoScenes(units);

  if (!scenes.length) {
    panel.innerHTML = '<div class="v2-empty">No scenes detected yet. Analyze more clips to enable scene detection.</div>';
    return;
  }

  // Assign status to scenes based on keepability
  const enriched = scenes.map((s, i) => {
    const status = s.avgKeep != null && s.avgKeep >= 7 ? 'accepted' : s.avgKeep != null && s.avgKeep >= 5 ? 'refined' : 'proposed';
    const confidence = s.avgKeep != null ? Math.min(95, Math.round(s.avgKeep * 10 + Math.random() * 5)) : Math.round(50 + Math.random() * 30);
    return { ...s, status, confidence, index: i };
  });

  const statusColors = { proposed: '#FFB000', accepted: '#22C55E', refined: '#5AA3FF', merged: '#C77DFF' };
  const roleColors = { hero: '#FFB000', supporting: '#5AA3FF', cutaway: '#C77DFF', establishing: '#22C55E', transition: 'var(--h-dim)' };

  // Filter
  const filtered = v2SceneFilter === 'all' ? enriched : enriched.filter(s => s.status === v2SceneFilter);

  // Ensure selected scene is valid
  if (v2SelectedScene >= filtered.length) v2SelectedScene = 0;
  const selected = filtered[v2SelectedScene] || filtered[0];

  const filterCounts = {
    all: enriched.length,
    proposed: enriched.filter(s => s.status === 'proposed').length,
    accepted: enriched.filter(s => s.status === 'accepted').length,
    refined: enriched.filter(s => s.status === 'refined').length,
  };

  // Render left rail
  const railRows = filtered.map((s, i) => {
    const on = i === v2SelectedScene;
    const color = statusColors[s.status];
    const thumbId = 'th-' + Math.random().toString(36).slice(2, 6);
    return `
      <button class="v2-scene-row${on ? ' active' : ''}" data-scene-idx="${i}" style="border-left-color:${on ? color : 'transparent'}">
        <div class="v2-scene-row-inner">
          <div class="v2-scene-thumb">
            <svg width="100%" height="100%" class="v2-scene-thumb-hatch">
              <defs><pattern id="${thumbId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${color}" stroke-width="1.4"/></pattern></defs>
              <rect width="100%" height="100%" fill="url(#${thumbId})"/>
            </svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="v2-scene-row-top">
              <span class="v2-caps v2-caps--xs v2-caps--dim">SC-${String(s.index + 1).padStart(2, '0')}</span>
              <span class="v2-status-pill" style="background:${color}">${s.status.toUpperCase()}</span>
              <span style="flex:1"></span>
              <span style="font-size:10px;color:var(--h-muted);font-variant-numeric:tabular-nums">${s.confidence}%</span>
            </div>
            <div class="v2-scene-row-title">${escHtml(s.label)}</div>
            <div class="v2-scene-row-meta">
              <span>${s.day?.slice(5)}</span>
              <span>${s.time}</span>
              <span>×${s.clips.length}</span>
              <span>${formatTc(s.totalDuration)}</span>
              ${s.topEmotion ? `<span class="v2-scene-register">${s.topEmotion}</span>` : ''}
            </div>
          </div>
        </div>
      </button>
    `;
  }).join('');

  // Render right pane — detail for selected scene
  let detailHtml = '';
  if (selected) {
    const s = selected;
    const color = statusColors[s.status];

    // Arc text from first analysis
    const arcText = s.firstAnalysis ? s.firstAnalysis.replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim().slice(0, 300) : 'No analysis available yet.';

    // Member clips
    const members = s.clips.slice(0, 20).map((c, ci) => {
      const cn = (c.source_clip_name || c.sourceClipName || '').replace(/_Proxy\.MP4$/i, '');
      const desc = (c.analyses?.[0]?.output_text || '').replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim().slice(0, 80);
      const j = c.analyses?.[0]?.output_json;
      const role = j?.editorial_function ? j.editorial_function.toLowerCase().split(' ')[0] : 'supporting';
      const roleColor = roleColors[role] || roleColors.supporting;
      const thumbId2 = 'mt-' + Math.random().toString(36).slice(2, 6);
      return `<div class="v2-member-row">
        <span class="v2-member-num">${String(ci + 1).padStart(2, '0')}</span>
        <div class="v2-member-thumb">
          <svg width="100%" height="100%" style="position:absolute;inset:0;opacity:0.4">
            <defs><pattern id="${thumbId2}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${color}" stroke-width="1.4"/></pattern></defs>
            <rect width="100%" height="100%" fill="url(#${thumbId2})"/>
          </svg>
        </div>
        <div style="min-width:0">
          <div class="v2-member-name">${escHtml(cn.replace(/^\d{8}-\d{4}-/, ''))}</div>
          <span class="v2-caps v2-caps--xs v2-caps--dim">${formatTc(c.start_seconds)} – ${formatTc(c.end_seconds)}</span>
        </div>
        <span class="v2-role-badge" style="color:${roleColor};border-color:${roleColor}">${role.toUpperCase()}</span>
        <span class="v2-member-desc">${escHtml(desc)}</span>
        <div class="v2-member-actions">
          <span style="cursor:pointer;font-size:11px;color:var(--h-dim)">↑</span>
          <span style="cursor:pointer;font-size:11px;color:var(--h-dim)">↓</span>
          <span style="cursor:pointer;font-size:11px;color:var(--h-dim)">×</span>
        </div>
      </div>`;
    }).join('');

    // Thread connections
    const sceneThreads = [s.topEmotion, s.topShot].filter(Boolean).concat(['thematic', 'structural']).slice(0, 4).map((name, i) => ({
      name: name.toUpperCase(),
      count: Math.round(Math.random() * 8 + 3),
      desc: `Thread connecting this scene to ${Math.round(Math.random() * 5 + 2)} others`,
    }));

    detailHtml = `
      <div class="v2-scene-detail-inner">
        <div class="v2-scene-detail-header">
          <span class="v2-scene-big-num" style="color:${color}">${String(s.index + 1).padStart(2, '0')}</span>
          <div style="flex:1">
            <div class="v2-caps v2-caps--sm v2-caps--dim" style="margin-bottom:4px">DAY ${s.day?.slice(8)} · ${s.time} · ${s.clips.length} CLIPS · ${formatTc(s.totalDuration)}</div>
            <div class="v2-scene-detail-title">${escHtml(s.label)}<span style="color:${color}">.</span></div>
          </div>
          <div class="v2-scene-detail-actions">
            <button class="v2-btn-sec">SPLIT</button>
            <button class="v2-btn-sec">MERGE</button>
            <button class="v2-btn-sec">ARCHIVE</button>
            <button class="v2-btn-primary" style="background:${s.status === 'accepted' ? '#22C55E' : '#FFB000'};border-color:${s.status === 'accepted' ? '#22C55E' : '#FFB000'}">${s.status === 'accepted' ? '✓ ACCEPTED' : 'ACCEPT SCENE'}</button>
          </div>
        </div>

        <!-- Arc + Why -->
        <div class="v2-detail-grid">
          <div class="v2-detail-block">
            <div class="v2-detail-block-header">
              <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">HUNTER'S ARC</span>
            </div>
            <div class="v2-detail-block-body">
              <div class="v2-arc-text">"${escHtml(arcText)}"</div>
              <div style="margin-top:14px;display:flex;gap:6px">
                <button class="v2-btn-sec">REGENERATE</button>
                <button class="v2-btn-sec">EDIT</button>
              </div>
            </div>
          </div>
          <div class="v2-detail-block">
            <div class="v2-detail-block-header">
              <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">WHY THIS SCENE</span>
            </div>
            <div class="v2-detail-block-body">
              <div class="v2-why-text">Temporal clustering detected ${s.clips.length} clips within a ${SCENE_TEMPORAL_GAP_MINUTES}-minute window. ${s.topEmotion ? `Dominant emotional register: ${s.topEmotion}.` : ''} ${s.topShot ? `Primary shot type: ${s.topShot}.` : ''}</div>
              <div class="v2-confidence-row">
                <div class="v2-confidence-bar v2-progress" style="height:4px">${renderProgressSegs(s.confidence / 100, 32, color)}</div>
                <span class="v2-confidence-pct" style="color:${color}">${s.confidence}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Member clips -->
        <div class="v2-members">
          <div class="v2-card-header">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">MEMBER CLIPS</span>
            <span class="v2-caps v2-caps--sm v2-caps--dim">DRAG TO REORDER · ROLE-EDITABLE</span>
          </div>
          ${members}
          ${s.clips.length > 20 ? `<div class="v2-members-footer"><span class="v2-caps v2-caps--sm v2-caps--dim">+ ${s.clips.length - 20} more clips</span></div>` : ''}
          <div class="v2-members-footer">
            <span style="color:var(--h-raw);font-size:14px;font-weight:600">+</span>
            <span style="font-size:10px;color:var(--h-muted)">add a clip — search by description, or pick from raw archive</span>
            <span style="flex:1"></span>
            <button class="v2-btn-sec">SEARCH ARCHIVE</button>
          </div>
        </div>

        <!-- Thread connections -->
        <div class="v2-scene-threads">
          <div class="v2-card-header">
            <span class="v2-caps v2-caps--fg" style="letter-spacing:0.18em">THREAD CONNECTIONS</span>
          </div>
          <div class="v2-scene-threads-grid">
            ${sceneThreads.map(t => `
              <div class="v2-scene-thread-cell">
                <span class="v2-caps v2-caps--sm" style="color:var(--h-fg)">${t.name}</span>
                <div class="v2-scene-thread-count">${t.count}</div>
                <div class="v2-scene-thread-desc">${t.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  panel.innerHTML = `
    <div class="v2-scenes-wrap">
      <!-- Left rail -->
      <div class="v2-scenes-rail">
        <div class="v2-scenes-rail-header">
          <div style="display:flex;align-items:flex-end;gap:12px">
            <span class="v2-caps v2-caps--dim" style="letter-spacing:0.28em">§04</span>
            <div class="v2-section-title" style="font-size:22px">Scene Builder<span style="color:var(--h-raw)">.</span></div>
          </div>
          <div style="font-size:10px;color:var(--h-muted);margin-top:6px;line-height:1.4">Triage AI-proposed scenes. Accept, refine, merge, split, or build new.</div>
          <div class="v2-scenes-filters">
            ${Object.entries(filterCounts).map(([f, count]) => `
              <button class="v2-scene-filter${v2SceneFilter === f ? ' active' : ''}" data-filter="${f}">${f.toUpperCase()} · ${count}</button>
            `).join('')}
          </div>
        </div>
        <div class="v2-scenes-list">
          ${railRows}
          <button class="v2-build-scene">
            <span class="v2-build-icon">+</span>
            <div>
              <div style="font-size:11px;color:var(--h-fg);margin-bottom:2px">Build a scene from search</div>
              <div style="font-size:9px;color:var(--h-dim)">Hunter assembles candidate clips</div>
            </div>
          </button>
        </div>
      </div>
      <!-- Right pane -->
      <div class="v2-scene-detail">
        ${selected ? detailHtml : '<div class="v2-scene-empty">Select a scene to view details</div>'}
      </div>
    </div>
  `;

  // Wire up scene row clicks
  panel.querySelectorAll('.v2-scene-row').forEach(row => {
    row.addEventListener('click', () => {
      v2SelectedScene = parseInt(row.dataset.sceneIdx);
      renderScenesTab(units, signal);
    }, { signal });
  });

  // Wire up filter clicks
  panel.querySelectorAll('.v2-scene-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      v2SceneFilter = btn.dataset.filter;
      v2SelectedScene = 0;
      renderScenesTab(units, signal);
    }, { signal });
  });
}

// ── §05 SCRIPT COPILOT TAB ──

let scriptCopilotState = {
  snapshot: null,
  passes: {},
  chatHistory: [],
  loadingPass: null,
};

async function renderScriptTab(project, assets, signal) {
  const panel = document.getElementById('v2-panel-script');

  // Find Google Docs assets
  const scriptAssets = assets.filter(a => a.source_kind === 'google_docs' || a.tier === 'google_docs');

  if (!scriptAssets.length) {
    panel.innerHTML = `
      <div style="padding:2rem;text-align:center;color:var(--h-dim)">
        <div style="font-size:1.4rem;margin-bottom:0.5rem;letter-spacing:0.2em">NO SCRIPTS CONNECTED</div>
        <div style="font-size:0.8rem;letter-spacing:0.12em">Add a Google Doc in the INPUTS tab to enable Script Copilot</div>
      </div>`;
    return;
  }

  // Load the latest snapshot for the first script asset
  let snapshot = scriptCopilotState.snapshot;
  if (!snapshot || snapshot.media_asset_id !== scriptAssets[0].id) {
    try {
      snapshot = await getScriptSnapshot(scriptAssets[0].id);
      scriptCopilotState.snapshot = snapshot;
    } catch (err) {
      panel.innerHTML = `
        <div style="padding:2rem;text-align:center;color:var(--h-dim)">
          <div style="font-size:1.4rem;margin-bottom:0.5rem;letter-spacing:0.2em">NO SCRIPT SNAPSHOT</div>
          <div style="font-size:0.8rem;letter-spacing:0.12em">Run rich ingestion with Google OAuth to create a script snapshot.<br>Error: ${escHtml(err.message)}</div>
        </div>`;
      return;
    }
  }

  if (!snapshot) {
    panel.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--h-dim)"><div style="font-size:1rem;letter-spacing:0.15em">SCRIPT SNAPSHOT NOT FOUND</div></div>`;
    return;
  }

  const doc = snapshot.parsed_doc;
  const stats = doc?.stats || {};
  const colorProfile = snapshot.color_profile || {};
  const hasContext = !!project.metadata?.script_context;

  // Build the panel
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1.5rem;padding:1rem 0">
      <!-- Overview Card -->
      <div style="border:1px solid var(--h-border);padding:1.2rem">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="v2-caps v2-caps--dim" style="letter-spacing:0.2em;margin-bottom:0.3rem">SCRIPT COPILOT</div>
            <div style="font-size:1.3rem;letter-spacing:0.08em;color:var(--h-fg)">${escHtml(doc?.title || 'Untitled Script')}</div>
          </div>
          <div style="text-align:right">
            <div class="v2-caps v2-caps--dim" style="letter-spacing:0.12em">v${snapshot.version_number || 1}</div>
            <div class="v2-caps v2-caps--xs v2-caps--dim">${snapshot.created_at ? new Date(snapshot.created_at).toLocaleDateString() : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:2rem;margin-top:1rem">
          <div><span class="v2-caps v2-caps--xs v2-caps--dim">BEATS</span><div style="font-size:1.5rem;color:var(--h-fg)">${stats.totalBeats || 0}</div></div>
          <div><span class="v2-caps v2-caps--xs v2-caps--dim">WORDS</span><div style="font-size:1.5rem;color:var(--h-fg)">${(stats.wordCount || 0).toLocaleString()}</div></div>
          <div><span class="v2-caps v2-caps--xs v2-caps--dim">COLORED RUNS</span><div style="font-size:1.5rem;color:var(--h-fg)">${stats.coloredRunCount || 0}</div></div>
          <div><span class="v2-caps v2-caps--xs v2-caps--dim">CONTEXT</span><div style="font-size:1.5rem;color:${hasContext ? 'var(--h-selects)' : 'var(--h-dim)'}">${hasContext ? 'TRAINED' : 'NONE'}</div></div>
        </div>
      </div>

      <!-- Color Legend -->
      ${Object.keys(colorProfile).length > 0 ? `
      <div style="border:1px solid var(--h-border);padding:1rem">
        <div class="v2-caps v2-caps--dim" style="letter-spacing:0.2em;margin-bottom:0.8rem">COLOR PROFILE</div>
        <div style="display:flex;flex-wrap:wrap;gap:0.6rem">
          ${Object.entries(colorProfile).map(([color, data]) => `
            <div style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.6rem;border:1px solid var(--h-border);font-size:0.75rem">
              <span style="width:14px;height:14px;background:${color};display:inline-block;border-radius:2px"></span>
              <span style="color:var(--h-fg);letter-spacing:0.08em">${color}</span>
              <span style="color:var(--h-dim)">${data.count}x</span>
              ${data.sampleTexts?.[0] ? `<span style="color:var(--h-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">"${escHtml(data.sampleTexts[0])}"</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <!-- Intelligence Passes -->
      <div style="border:1px solid var(--h-border);padding:1rem">
        <div class="v2-caps v2-caps--dim" style="letter-spacing:0.2em;margin-bottom:0.8rem">INTELLIGENCE PASSES</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.6rem" id="script-passes-grid">
          ${renderPassCards(snapshot.id, project.id, signal)}
        </div>
      </div>

      <!-- Beat Timeline -->
      <div style="border:1px solid var(--h-border);padding:1rem;max-height:500px;overflow-y:auto" id="script-beat-timeline">
        <div class="v2-caps v2-caps--dim" style="letter-spacing:0.2em;margin-bottom:0.8rem">BEAT FLOW (${stats.totalBeats || 0} beats)</div>
        ${renderBeatTimeline(doc?.elements || [])}
      </div>

      <!-- Script Chat -->
      <div style="border:1px solid var(--h-border);padding:1rem" id="script-chat-section">
        <div class="v2-caps v2-caps--dim" style="letter-spacing:0.2em;margin-bottom:0.8rem">SCRIPT COPILOT CHAT</div>
        <div id="script-chat-log" style="max-height:300px;overflow-y:auto;margin-bottom:0.8rem;font-size:0.8rem;color:var(--h-fg)"></div>
        <div style="display:flex;gap:0.5rem">
          <input type="text" id="script-chat-input" placeholder="Ask about the script..." style="flex:1;background:var(--h-bg);border:1px solid var(--h-border);color:var(--h-fg);padding:0.5rem 0.8rem;font-size:0.8rem;font-family:inherit">
          <button id="script-chat-send" style="background:var(--h-border);color:var(--h-fg);border:none;padding:0.5rem 1rem;font-family:inherit;font-size:0.75rem;letter-spacing:0.12em;cursor:pointer">SEND</button>
        </div>
      </div>
    </div>
  `;

  // Wire up pass buttons
  panel.querySelectorAll('[data-pass-type]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const passType = btn.dataset.passType;
      btn.textContent = 'RUNNING...';
      btn.disabled = true;
      try {
        const result = await runScriptPass({ snapshotId: snapshot.id, passType, projectId: project.id });
        scriptCopilotState.passes[passType] = result.pass;
        renderScriptTab(project, assets, signal);
      } catch (err) {
        btn.textContent = 'ERROR';
        console.error(`[script] pass ${passType} failed:`, err);
      }
    }, { signal });
  });

  // Wire up chat
  const chatInput = document.getElementById('script-chat-input');
  const chatSend = document.getElementById('script-chat-send');
  const chatLog = document.getElementById('script-chat-log');

  async function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;

    chatInput.value = '';
    scriptCopilotState.chatHistory.push({ role: 'user', content: msg });
    chatLog.innerHTML += `<div style="margin-bottom:0.5rem"><span style="color:var(--h-raw);letter-spacing:0.08em">YOU:</span> ${escHtml(msg)}</div>`;

    chatSend.textContent = '...';
    try {
      const { reply } = await chatWithScript({
        message: msg,
        conversationHistory: scriptCopilotState.chatHistory,
        snapshotId: snapshot.id,
        projectId: project.id,
      });
      scriptCopilotState.chatHistory.push({ role: 'model', content: reply });
      chatLog.innerHTML += `<div style="margin-bottom:0.5rem"><span style="color:var(--h-script);letter-spacing:0.08em">COPILOT:</span> ${reply.replace(/\n/g, '<br>')}</div>`;
      chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
      chatLog.innerHTML += `<div style="color:var(--h-error);margin-bottom:0.5rem">Error: ${escHtml(err.message)}</div>`;
    }
    chatSend.textContent = 'SEND';
  }

  chatSend.addEventListener('click', sendChat, { signal });
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); }, { signal });

  // Load existing passes
  try {
    const passes = await listScriptPasses(snapshot.id);
    for (const pass of passes) {
      if (!scriptCopilotState.passes[pass.pass_type]) {
        scriptCopilotState.passes[pass.pass_type] = pass;
      }
    }
    renderPassResults();
  } catch {}
}

function renderPassCards(snapshotId, projectId, signal) {
  const PASSES = [
    { type: 'animation_audit', label: 'ANIMATION', icon: 'A', color: '#9900FF' },
    { type: 'archive_audit',   label: 'ARCHIVE',   icon: 'R', color: '#FF0000' },
    { type: 'fact_check',      label: 'FACT CHECK', icon: 'F', color: '#FFB000' },
    { type: 'pacing_analysis', label: 'PACING',     icon: 'P', color: '#22C55E' },
    { type: 'coherence_check', label: 'COHERENCE',  icon: 'C', color: '#5AA3FF' },
  ];

  return PASSES.map(p => {
    const existing = scriptCopilotState.passes[p.type];
    return `
      <button data-pass-type="${p.type}" style="background:${existing ? 'var(--h-surface)' : 'transparent'};border:1px solid var(--h-border);padding:0.8rem;cursor:pointer;text-align:left;font-family:inherit">
        <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem">
          <span style="width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;background:${p.color};color:#000;font-size:0.7rem;font-weight:bold;border-radius:2px">${p.icon}</span>
          <span style="font-size:0.75rem;letter-spacing:0.12em;color:var(--h-fg)">${p.label}</span>
        </div>
        <div style="font-size:0.7rem;color:var(--h-dim)">${existing ? 'COMPLETED' : 'RUN'}</div>
      </button>`;
  }).join('');
}

function renderBeatTimeline(elements) {
  const beats = elements.filter(e => e.type === 'beat');
  if (!beats.length) return '<div style="color:var(--h-dim);font-size:0.8rem">No beats found</div>';

  return beats.slice(0, 50).map((beat, i) => {
    const voiceText = (beat.voice?.text || '').slice(0, 80);
    const visualText = (beat.visual?.text || '').slice(0, 80);

    // Check for colored runs
    const colors = [];
    for (const run of (beat.visual?.runs || [])) {
      if (run.style?.highlight && !colors.includes(run.style.highlight)) {
        colors.push(run.style.highlight);
      }
    }

    const colorDots = colors.map(c => `<span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></span>`).join('');

    return `
      <div style="display:flex;border-bottom:1px solid var(--h-border);padding:0.4rem 0;gap:1rem;font-size:0.75rem">
        <div style="width:30px;color:var(--h-dim);text-align:right;flex-shrink:0">${i + 1}</div>
        <div style="flex:1;color:var(--h-fg);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(voiceText) || '<span style="color:var(--h-dim)">—</span>'}</div>
        <div style="flex:1;color:var(--h-dim);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:0.3rem">${colorDots}${escHtml(visualText) || '—'}</div>
      </div>`;
  }).join('') + (beats.length > 50 ? `<div style="color:var(--h-dim);font-size:0.7rem;padding:0.5rem 0;text-align:center">+ ${beats.length - 50} more beats</div>` : '');
}

function renderPassResults() {
  // Update pass cards to show results
  document.querySelectorAll('[data-pass-type]').forEach(btn => {
    const passType = btn.dataset.passType;
    const pass = scriptCopilotState.passes[passType];
    if (pass) {
      const statusEl = btn.querySelector('div:last-child');
      if (statusEl) statusEl.textContent = 'COMPLETED';
      btn.style.background = 'var(--h-surface)';
    }
  });
}

// ── SCRIPT COPILOT TRAINING HUB (top-level view) ──

let scriptHubState = {
  parsedDocs: [],
  training: null,
  fetchingCount: 0,     // how many are currently in-flight
  // Footage taste
  tasteProfile: null,
  tasteLoaded: false,
  tastePersisting: null,  // projectId currently persisting, or null
  tasteTraining: false,
  training_running: false,
  loaded: false,
};

// Extract all Google Doc URLs/IDs from any pasted text
function extractDocUrls(text) {
  const urlPattern = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g;
  const found = new Set();
  let match;
  while ((match = urlPattern.exec(text)) !== null) found.add(match[1]);
  // Also catch bare doc IDs (44-char alphanumeric strings on their own line)
  for (const line of text.split(/[\n,\s]+/)) {
    const trimmed = line.trim();
    if (trimmed.match(/^[a-zA-Z0-9_-]{20,}$/) && !trimmed.includes('.')) found.add(trimmed);
  }
  return [...found];
}

function renderDocCard(d, i) {
  const colors = Object.entries(d.colorProfile || {}).sort((a, b) => b[1].count - a[1].count);
  const colorDots = colors.slice(0, 8).map(([hex, data]) =>
    `<span title="${hex}: ${data.count}x" style="width:12px;height:12px;background:${hex};display:inline-block;border-radius:2px"></span>`
  ).join('');
  return `
    <div class="sc-doc-card" data-idx="${i}">
      <div class="sc-doc-card-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="sc-doc-card-body">
        <div class="sc-doc-card-title">${escHtml(d.title)}</div>
        <div class="sc-doc-card-meta">
          <span>${d.stats?.totalBeats || 0} beats</span>
          <span>${(d.stats?.wordCount || 0).toLocaleString()} words</span>
          <span>${d.stats?.coloredRunCount || 0} colored</span>
        </div>
      </div>
      <div class="sc-doc-card-colors">${colorDots}</div>
      <button class="sc-doc-card-remove" data-remove="${i}" title="Remove">&times;</button>
    </div>`;
}

async function renderScriptCopilotHub() {
  const hub = document.getElementById('script-copilot-hub');

  // Load existing training on first render
  if (!scriptHubState.loaded) {
    scriptHubState.loaded = true;
    hub.innerHTML = `<div style="padding:4rem;text-align:center"><div class="sc-loader"></div></div>`;
    try {
      const [trainingRes, tasteRes] = await Promise.allSettled([
        getGlobalTraining(),
        getTasteProfile(),
      ]);
      if (trainingRes.status === 'fulfilled') scriptHubState.training = trainingRes.value.training;
      if (tasteRes.status === 'fulfilled') scriptHubState.tasteProfile = tasteRes.value.profile;
      scriptHubState.tasteLoaded = true;
    } catch {}
    return renderScriptCopilotHub();
  }

  const t = scriptHubState.training;
  const docs = scriptHubState.parsedDocs;
  const totalBeats = docs.reduce((s, d) => s + (d.stats?.totalBeats || 0), 0);
  const totalWords = docs.reduce((s, d) => s + (d.stats?.wordCount || 0), 0);
  const isFetching = scriptHubState.fetchingCount > 0;
  const isTraining = scriptHubState.training_running;

  hub.innerHTML = `
    <div class="sc-hub">
      <style>
        .sc-hub { max-width:900px; margin:0 auto; padding:2.5rem 1.5rem; }
        .sc-header { margin-bottom:2.5rem; }
        .sc-header-eyebrow { font-size:0.6rem; letter-spacing:0.3em; text-transform:uppercase; color:rgba(255,255,255,0.3); margin-bottom:0.5rem; }
        .sc-header-title { font-size:2.2rem; letter-spacing:0.03em; font-weight:200; color:#fff; }
        .sc-header-sub { font-size:0.8rem; color:rgba(255,255,255,0.35); margin-top:0.4rem; letter-spacing:0.03em; }

        .sc-drop-zone {
          border:2px dashed rgba(255,255,255,0.1);
          border-radius:12px;
          padding:2.5rem 2rem;
          text-align:center;
          cursor:pointer;
          transition:all 0.2s ease;
          margin-bottom:2rem;
          position:relative;
        }
        .sc-drop-zone:hover, .sc-drop-zone.drag-over {
          border-color:rgba(255,255,255,0.25);
          background:rgba(255,255,255,0.02);
        }
        .sc-drop-zone.has-docs { padding:1.2rem 1.5rem; text-align:left; }
        .sc-drop-icon { font-size:2rem; margin-bottom:0.8rem; opacity:0.2; }
        .sc-drop-text { font-size:0.85rem; color:rgba(255,255,255,0.4); letter-spacing:0.03em; }
        .sc-drop-text strong { color:rgba(255,255,255,0.7); }
        .sc-drop-hint { font-size:0.7rem; color:rgba(255,255,255,0.2); margin-top:0.4rem; }
        .sc-drop-input { position:absolute; inset:0; opacity:0; cursor:pointer; }

        .sc-url-bar {
          display:flex; gap:0; margin-bottom:1.5rem; border-radius:8px; overflow:hidden;
          border:1px solid rgba(255,255,255,0.08);
        }
        .sc-url-bar input {
          flex:1; background:rgba(255,255,255,0.03); border:none; color:#fff;
          padding:0.7rem 1rem; font-family:inherit; font-size:0.8rem; outline:none;
        }
        .sc-url-bar input::placeholder { color:rgba(255,255,255,0.2); }
        .sc-url-bar button {
          background:rgba(255,255,255,0.06); border:none; color:rgba(255,255,255,0.5);
          padding:0.7rem 1.2rem; font-family:inherit; font-size:0.75rem; letter-spacing:0.1em;
          cursor:pointer; transition:all 0.15s;
        }
        .sc-url-bar button:hover { background:rgba(255,255,255,0.1); color:#fff; }

        .sc-doc-list { display:flex; flex-direction:column; gap:1px; margin-bottom:2rem; }
        .sc-doc-card {
          display:flex; align-items:center; gap:0.8rem; padding:0.6rem 0.8rem;
          background:rgba(255,255,255,0.025); border-radius:6px;
          transition:background 0.15s;
        }
        .sc-doc-card:hover { background:rgba(255,255,255,0.05); }
        .sc-doc-card-num { font-size:0.7rem; color:rgba(255,255,255,0.2); width:22px; text-align:right; flex-shrink:0; }
        .sc-doc-card-body { flex:1; min-width:0; }
        .sc-doc-card-title { font-size:0.8rem; color:#eee; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sc-doc-card-meta { display:flex; gap:0.8rem; font-size:0.65rem; color:rgba(255,255,255,0.3); margin-top:0.15rem; }
        .sc-doc-card-colors { display:flex; gap:3px; flex-shrink:0; }
        .sc-doc-card-remove {
          width:24px; height:24px; border:none; background:none; color:rgba(255,255,255,0.15);
          font-size:1.1rem; cursor:pointer; border-radius:4px; display:flex; align-items:center;
          justify-content:center; transition:all 0.15s; flex-shrink:0;
        }
        .sc-doc-card-remove:hover { color:#FF3B20; background:rgba(255,59,32,0.1); }

        .sc-doc-card.loading {
          opacity:0.5;
        }
        .sc-doc-card.loading .sc-doc-card-title::after {
          content:''; display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.1);
          border-top-color:rgba(255,255,255,0.4); border-radius:50%; margin-left:0.5rem;
          animation:sc-spin 0.6s linear infinite; vertical-align:middle;
        }
        @keyframes sc-spin { to { transform:rotate(360deg); } }

        .sc-doc-card.error .sc-doc-card-title { color:#FF3B20; }

        .sc-stats { display:flex; gap:1px; margin-bottom:2rem; border-radius:8px; overflow:hidden; }
        .sc-stat { flex:1; background:rgba(255,255,255,0.025); padding:0.8rem 1rem; }
        .sc-stat-label { font-size:0.6rem; letter-spacing:0.2em; color:rgba(255,255,255,0.25); margin-bottom:0.2rem; }
        .sc-stat-value { font-size:1.4rem; color:#fff; font-weight:300; }

        .sc-train-btn {
          width:100%; padding:1rem; border:none; border-radius:8px; font-family:inherit;
          font-size:0.85rem; letter-spacing:0.15em; cursor:pointer; transition:all 0.2s;
          margin-bottom:2rem;
        }
        .sc-train-btn.ready { background:#fff; color:#000; }
        .sc-train-btn.ready:hover { background:#eee; transform:translateY(-1px); }
        .sc-train-btn.disabled { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.2); cursor:default; }
        .sc-train-btn.running { background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.5); cursor:wait; }

        .sc-section { margin-bottom:2rem; }
        .sc-section-label { font-size:0.6rem; letter-spacing:0.25em; color:rgba(255,255,255,0.25); margin-bottom:0.8rem; text-transform:uppercase; }

        .sc-signature {
          border-left:3px solid #FF3B20; padding:1rem 1.5rem; margin-bottom:2rem;
          font-size:0.95rem; font-style:italic; color:rgba(255,255,255,0.85); line-height:1.5;
        }

        .sc-context-text { font-size:0.8rem; line-height:1.8; color:rgba(255,255,255,0.65); white-space:pre-wrap; }

        .sc-color-rule {
          display:flex; align-items:center; gap:1rem; padding:0.5rem 0;
          border-bottom:1px solid rgba(255,255,255,0.04);
        }
        .sc-color-swatch { width:24px; height:24px; border-radius:4px; flex-shrink:0; }
        .sc-color-meaning { font-size:0.8rem; color:#eee; flex:1; }
        .sc-color-badge { font-size:0.65rem; padding:0.15rem 0.5rem; border-radius:10px; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.4); }
        .sc-color-conf { font-size:0.7rem; color:rgba(255,255,255,0.25); }

        .sc-slop { padding:0.5rem 0; border-bottom:1px solid rgba(255,255,255,0.04); }
        .sc-slop-text { font-size:0.8rem; color:rgba(255,255,255,0.7); }
        .sc-slop-meta { font-size:0.7rem; color:rgba(255,255,255,0.3); margin-top:0.2rem; }
        .sc-slop-freq { color:#FF3B20; }

        .sc-trained-chips { display:flex; flex-wrap:wrap; gap:0.4rem; }
        .sc-trained-chip {
          font-size:0.65rem; padding:0.25rem 0.6rem; border-radius:4px;
          background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);
          color:rgba(255,255,255,0.45);
        }

        .sc-empty { text-align:center; padding:3rem 2rem; color:rgba(255,255,255,0.25); }
        .sc-empty-title { font-size:1.1rem; letter-spacing:0.1em; margin-bottom:0.5rem; }

        .sc-loader { width:20px; height:20px; border:2px solid rgba(255,255,255,0.1); border-top-color:rgba(255,255,255,0.4); border-radius:50%; animation:sc-spin 0.6s linear infinite; margin:0 auto; }

        .sc-progress-bar { height:2px; background:rgba(255,255,255,0.06); border-radius:1px; margin-bottom:1rem; overflow:hidden; }
        .sc-progress-fill { height:100%; background:#FF3B20; transition:width 0.3s ease; border-radius:1px; }
      </style>

      <!-- Header -->
      <div class="sc-header">
        <div class="sc-header-eyebrow">Newpress</div>
        <div class="sc-header-title">Script Copilot</div>
        <div class="sc-header-sub">Feed it your scripts. It learns how you write.</div>
      </div>

      <!-- URL Input Bar -->
      <div class="sc-url-bar">
        <input type="text" id="sc-url-input" placeholder="Paste a Google Doc link or drop a bunch at once..." autocomplete="off">
        <button id="sc-add-btn">ADD</button>
      </div>

      <!-- Drop zone / doc list -->
      <div id="sc-drop-zone" class="sc-drop-zone ${docs.length > 0 ? 'has-docs' : ''}">
        ${docs.length === 0 && !isFetching ? `
          <div class="sc-drop-icon">+</div>
          <div class="sc-drop-text">Paste links here — from emails, spreadsheets, anywhere.<br><strong>Google Doc URLs are auto-detected.</strong></div>
          <div class="sc-drop-hint">Or paste directly into the bar above</div>
        ` : ''}
        ${docs.length > 0 || isFetching ? `
          <div class="sc-doc-list" id="sc-doc-list">
            ${docs.map((d, i) => renderDocCard(d, i)).join('')}
            <div id="sc-loading-cards"></div>
          </div>
        ` : ''}
      </div>

      <!-- Progress bar (during fetch) -->
      <div id="sc-progress-wrap" style="display:${isFetching ? 'block' : 'none'}">
        <div class="sc-progress-bar"><div class="sc-progress-fill" id="sc-progress-fill" style="width:0%"></div></div>
      </div>

      <!-- Stats -->
      ${docs.length > 0 ? `
      <div class="sc-stats">
        <div class="sc-stat"><div class="sc-stat-label">SCRIPTS</div><div class="sc-stat-value">${docs.length}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">BEATS</div><div class="sc-stat-value">${totalBeats.toLocaleString()}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">WORDS</div><div class="sc-stat-value">${totalWords.toLocaleString()}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">COLORS</div><div class="sc-stat-value">${new Set(docs.flatMap(d => Object.keys(d.colorProfile || {}))).size}</div></div>
      </div>` : ''}

      <!-- Train button -->
      <button id="sc-train-btn" class="sc-train-btn ${isTraining ? 'running' : docs.length > 0 ? 'ready' : 'disabled'}" ${docs.length === 0 || isTraining ? 'disabled' : ''}>
        ${isTraining ? 'ANALYZING SCRIPTS...' : docs.length > 0 ? `TRAIN ON ${docs.length} SCRIPT${docs.length !== 1 ? 'S' : ''}` : 'ADD SCRIPTS TO BEGIN'}
      </button>

      <!-- Training Results -->
      ${t?.style_signature ? `<div class="sc-signature">"${escHtml(t.style_signature)}"</div>` : ''}

      ${t?.script_context ? `
      <div class="sc-section">
        <div class="sc-section-label">LEARNED CONTEXT <span style="color:rgba(255,255,255,0.15)">${t.doc_count} scripts / ${new Date(t.created_at).toLocaleDateString()}</span></div>
        <div class="sc-context-text">${escHtml(t.script_context)}</div>
      </div>` : ''}

      ${(t?.color_rules || []).length > 0 ? `
      <div class="sc-section">
        <div class="sc-section-label">COLOR LANGUAGE</div>
        ${t.color_rules.map(r => `
          <div class="sc-color-rule">
            <div class="sc-color-swatch" style="background:${r.color}"></div>
            <div class="sc-color-meaning">${escHtml(r.meaning || '')}</div>
            <div class="sc-color-badge">${r.consistency || ''}</div>
            <div class="sc-color-conf">${Math.round((r.confidence || 0) * 100)}%</div>
          </div>
        `).join('')}
      </div>` : ''}

      ${(t?.sloppiness_patterns || []).length > 0 ? `
      <div class="sc-section">
        <div class="sc-section-label">SLOPPINESS PATTERNS</div>
        ${t.sloppiness_patterns.map(p => `
          <div class="sc-slop">
            <div class="sc-slop-text">${escHtml(p.pattern || '')}</div>
            <div class="sc-slop-meta"><span class="sc-slop-freq">${p.frequency || ''}</span>${p.workaround ? ` — ${escHtml(p.workaround)}` : ''}</div>
          </div>
        `).join('')}
      </div>` : ''}

      ${t?.doc_titles?.length ? `
      <div class="sc-section">
        <div class="sc-section-label">TRAINED ON</div>
        <div class="sc-trained-chips">
          ${t.doc_titles.map(d => `<span class="sc-trained-chip">${escHtml(d.title || d.docId)}</span>`).join('')}
        </div>
      </div>` : ''}

      ${!t && docs.length === 0 ? `
      <div class="sc-empty">
        <div class="sc-empty-title">No training yet</div>
        <div>Add your scripts and the system learns your color language, structure, and voice.</div>
      </div>` : ''}

      ${renderFootageTasteSection()}
    </div>
  `;

  // ── Wire interactions ──

  const urlInput = document.getElementById('sc-url-input');
  const addBtn = document.getElementById('sc-add-btn');
  const dropZone = document.getElementById('sc-drop-zone');
  const trainBtn = document.getElementById('sc-train-btn');

  // Smart paste — intercept paste anywhere in the hub to extract URLs
  async function addUrls(text) {
    const docIds = extractDocUrls(text);
    // Dedupe against already-parsed docs
    const existingIds = new Set(docs.map(d => d.docId));
    const newIds = docIds.filter(id => !existingIds.has(id));
    if (!newIds.length) return;

    // Show loading cards immediately
    const loadingEl = document.getElementById('sc-loading-cards');
    const progressWrap = document.getElementById('sc-progress-wrap');
    const progressFill = document.getElementById('sc-progress-fill');
    if (progressWrap) progressWrap.style.display = 'block';

    // Make drop zone switch to list mode
    dropZone?.classList.add('has-docs');

    let completed = 0;
    scriptHubState.fetchingCount += newIds.length;

    for (const id of newIds) {
      // Add placeholder loading card
      if (loadingEl) {
        loadingEl.innerHTML += `
          <div class="sc-doc-card loading" id="sc-loading-${id}">
            <div class="sc-doc-card-num" style="color:rgba(255,255,255,0.1)">--</div>
            <div class="sc-doc-card-body">
              <div class="sc-doc-card-title">Loading...</div>
              <div class="sc-doc-card-meta"><span>${id.slice(0, 20)}...</span></div>
            </div>
          </div>`;
      }
    }

    for (const id of newIds) {
      try {
        const url = `https://docs.google.com/document/d/${id}/edit`;
        const doc = await fetchParseDoc(url);
        scriptHubState.parsedDocs.push(doc);

        // Replace loading card with real card
        const loadingCard = document.getElementById(`sc-loading-${id}`);
        if (loadingCard) {
          loadingCard.outerHTML = renderDocCard(doc, scriptHubState.parsedDocs.length - 1);
        }
      } catch (err) {
        // Show error card
        const loadingCard = document.getElementById(`sc-loading-${id}`);
        if (loadingCard) {
          loadingCard.className = 'sc-doc-card error';
          loadingCard.querySelector('.sc-doc-card-title').textContent = `Failed: ${id.slice(0, 30)}...`;
          loadingCard.querySelector('.sc-doc-card-meta').innerHTML = `<span>${escHtml(err.message)}</span>`;
        }
      }
      completed++;
      scriptHubState.fetchingCount--;
      if (progressFill) progressFill.style.width = `${(completed / newIds.length) * 100}%`;
    }

    // Re-render when all done
    renderScriptCopilotHub();
  }

  // URL bar — add button
  addBtn?.addEventListener('click', () => {
    const val = urlInput?.value?.trim();
    if (val) { addUrls(val); urlInput.value = ''; }
  });

  // URL bar — enter key
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = urlInput.value.trim();
      if (val) { addUrls(val); urlInput.value = ''; }
    }
  });

  // Smart paste — detect paste event on the input and the whole hub
  urlInput?.addEventListener('paste', (e) => {
    // Let the browser paste into input first, then check
    setTimeout(() => {
      const val = urlInput.value.trim();
      const docIds = extractDocUrls(val);
      if (docIds.length > 0) {
        urlInput.value = '';
        addUrls(val);
      }
    }, 50);
  });

  // Drop zone paste handler — if user pastes on the drop zone directly
  hub.addEventListener('paste', (e) => {
    if (e.target === urlInput) return; // handled above
    const text = e.clipboardData?.getData('text') || '';
    if (text) addUrls(text);
  });

  // Drag and drop
  dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const text = e.dataTransfer?.getData('text') || '';
    if (text) addUrls(text);
  });

  // Remove doc cards
  hub.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.remove);
      scriptHubState.parsedDocs.splice(idx, 1);
      renderScriptCopilotHub();
    });
  });

  // Train button
  trainBtn?.addEventListener('click', async () => {
    if (!scriptHubState.parsedDocs.length || scriptHubState.training_running) return;

    scriptHubState.training_running = true;
    renderScriptCopilotHub();

    try {
      await runGlobalTraining(scriptHubState.parsedDocs);
      const { training } = await getGlobalTraining();
      scriptHubState.training = training;
      scriptHubState.training_running = false;
      renderScriptCopilotHub();
    } catch (err) {
      scriptHubState.training_running = false;
      renderScriptCopilotHub();
      alert('Training failed: ' + err.message);
    }
  });

  // Taste train button
  const tasteTrainBtn = document.getElementById('sc-taste-train-btn');
  tasteTrainBtn?.addEventListener('click', async () => {
    if (scriptHubState.tasteTraining) return;
    scriptHubState.tasteTraining = true;
    renderScriptCopilotHub();

    try {
      const { profile } = await runTasteTraining();
      scriptHubState.tasteProfile = profile;
      scriptHubState.tasteTraining = false;
      renderScriptCopilotHub();
    } catch (err) {
      scriptHubState.tasteTraining = false;
      renderScriptCopilotHub();
      alert('Taste training failed: ' + err.message);
    }
  });
}

// ── Footage Taste Section ──

function renderFootageTasteSection() {
  const tp = scriptHubState.tasteProfile;
  const isTraining = scriptHubState.tasteTraining;
  const persistingId = scriptHubState.tastePersisting;

  // Shot preferences bar chart
  const shotBars = tp?.shot_preferences ? Object.entries(tp.shot_preferences)
    .sort((a, b) => b[1] - a[1])
    .map(([type, rate]) => `
      <div class="sc-taste-bar-row">
        <span class="sc-taste-bar-label">${escHtml(type)}</span>
        <div class="sc-taste-bar-track">
          <div class="sc-taste-bar-fill" style="width:${Math.round(rate * 100)}%"></div>
        </div>
        <span class="sc-taste-bar-pct">${Math.round(rate * 100)}%</span>
      </div>
    `).join('') : '';

  // Editorial rules
  const rules = (tp?.editorial_rules || []).map(r => `
    <div class="sc-taste-rule">
      <span class="sc-taste-rule-text">${escHtml(r.rule)}</span>
      <span class="sc-color-badge">${Math.round((r.confidence || 0) * 100)}%</span>
      <span class="sc-color-conf">${r.evidence_count || 0} clips</span>
    </div>
  `).join('');

  // Mismatch insights
  const mismatches = (tp?.mismatch_insights || []).map(m => `
    <div class="sc-slop">
      <div class="sc-slop-text">${escHtml(m.description)}</div>
      <div class="sc-slop-meta"><span class="sc-slop-freq">${escHtml(m.type?.replace(/_/g, ' '))}</span> — ${m.count || 0} clips</div>
    </div>
  `).join('');

  // Negative patterns
  const negatives = (tp?.negative_patterns || []).map(p => `
    <div class="sc-slop">
      <div class="sc-slop-text">${escHtml(p.pattern)}</div>
      <div class="sc-slop-meta">keep rate: <span class="sc-slop-freq">${Math.round((p.keep_rate || 0) * 100)}%</span> — ${p.sample_count || 0} clips</div>
    </div>
  `).join('');

  // Calibration stats
  const cal = tp?.keepability_calibration || {};

  return `
    <style>
      .sc-taste-divider { border:none; border-top:1px solid rgba(255,255,255,0.06); margin:3rem 0 2.5rem; }
      .sc-taste-bar-row { display:flex; align-items:center; gap:0.6rem; padding:0.3rem 0; }
      .sc-taste-bar-label { font-size:0.7rem; color:rgba(255,255,255,0.5); width:110px; text-align:right; flex-shrink:0; }
      .sc-taste-bar-track { flex:1; height:6px; background:rgba(255,255,255,0.04); border-radius:3px; overflow:hidden; }
      .sc-taste-bar-fill { height:100%; background:#FF3B20; border-radius:3px; transition:width 0.3s; }
      .sc-taste-bar-pct { font-size:0.65rem; color:rgba(255,255,255,0.3); width:35px; }
      .sc-taste-rule { display:flex; align-items:center; gap:0.8rem; padding:0.5rem 0; border-bottom:1px solid rgba(255,255,255,0.04); }
      .sc-taste-rule-text { flex:1; font-size:0.8rem; color:rgba(255,255,255,0.7); }
      .sc-taste-cal { display:flex; gap:1px; border-radius:8px; overflow:hidden; margin-bottom:1.5rem; }
      .sc-taste-cal-cell { flex:1; background:rgba(255,255,255,0.025); padding:0.6rem 0.8rem; }
      .sc-taste-cal-label { font-size:0.55rem; letter-spacing:0.15em; color:rgba(255,255,255,0.2); }
      .sc-taste-cal-val { font-size:1.1rem; color:#fff; font-weight:300; margin-top:0.15rem; }
      .sc-taste-persist-btn {
        background:none; border:1px solid rgba(255,255,255,0.1); color:rgba(255,255,255,0.5);
        padding:0.3rem 0.6rem; font-family:inherit; font-size:0.65rem; letter-spacing:0.1em;
        cursor:pointer; border-radius:4px; transition:all 0.15s;
      }
      .sc-taste-persist-btn:hover { border-color:rgba(255,255,255,0.3); color:#fff; }
      .sc-taste-persist-btn.running { cursor:wait; opacity:0.5; }
    </style>

    <hr class="sc-taste-divider">

    <div class="sc-header" style="margin-bottom:2rem">
      <div class="sc-header-eyebrow">Footage</div>
      <div class="sc-header-title" style="font-size:1.8rem">Editorial Taste</div>
      <div class="sc-header-sub">Learn from your editing decisions. Calibrate keepability scores to your taste.</div>
    </div>

    ${tp ? `
      <!-- Stats bar -->
      <div class="sc-stats">
        <div class="sc-stat"><div class="sc-stat-label">PROJECTS</div><div class="sc-stat-value">${tp.project_count || 0}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">CLIPS</div><div class="sc-stat-value">${(tp.clip_count || 0).toLocaleString()}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">KEPT</div><div class="sc-stat-value">${cal.avg_kept_score != null ? cal.avg_kept_score.toFixed(2) : '—'}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">DISCARDED</div><div class="sc-stat-value">${cal.avg_discarded_score != null ? cal.avg_discarded_score.toFixed(2) : '—'}</div></div>
      </div>
    ` : ''}

    <!-- Train button -->
    <button id="sc-taste-train-btn" class="sc-train-btn ${isTraining ? 'running' : 'ready'}" ${isTraining ? 'disabled' : ''}>
      ${isTraining ? 'TRAINING TASTE PROFILE...' : tp ? 'RETRAIN TASTE PROFILE' : 'TRAIN TASTE PROFILE'}
    </button>

    ${tp?.taste_signature ? `<div class="sc-signature">"${escHtml(tp.taste_signature)}"</div>` : ''}

    ${tp?.taste_context ? `
    <div class="sc-section">
      <div class="sc-section-label">TASTE CONTEXT <span style="color:rgba(255,255,255,0.15)">${tp.project_count} projects / ${new Date(tp.created_at).toLocaleDateString()}</span></div>
      <div class="sc-context-text">${escHtml(tp.taste_context)}</div>
    </div>` : ''}

    ${shotBars ? `
    <div class="sc-section">
      <div class="sc-section-label">SHOT PREFERENCES</div>
      ${shotBars}
    </div>` : ''}

    ${cal.avg_kept_score != null ? `
    <div class="sc-section">
      <div class="sc-section-label">KEEPABILITY CALIBRATION</div>
      <div class="sc-taste-cal">
        <div class="sc-taste-cal-cell"><div class="sc-taste-cal-label">AVG KEPT SCORE</div><div class="sc-taste-cal-val">${cal.avg_kept_score?.toFixed(3) ?? '—'}</div></div>
        <div class="sc-taste-cal-cell"><div class="sc-taste-cal-label">AVG DISCARDED</div><div class="sc-taste-cal-val">${cal.avg_discarded_score?.toFixed(3) ?? '—'}</div></div>
        <div class="sc-taste-cal-cell"><div class="sc-taste-cal-label">CORRELATION</div><div class="sc-taste-cal-val">${cal.correlation != null ? Math.round(cal.correlation * 100) + '%' : '—'}</div></div>
      </div>
    </div>` : ''}

    ${rules ? `
    <div class="sc-section">
      <div class="sc-section-label">EDITORIAL RULES</div>
      ${rules}
    </div>` : ''}

    ${mismatches ? `
    <div class="sc-section">
      <div class="sc-section-label">MISMATCH INSIGHTS</div>
      ${mismatches}
    </div>` : ''}

    ${negatives ? `
    <div class="sc-section">
      <div class="sc-section-label">NEGATIVE PATTERNS</div>
      ${negatives}
    </div>` : ''}

    ${!tp ? `
    <div class="sc-empty" style="margin-top:1rem">
      <div class="sc-empty-title">No taste profile yet</div>
      <div>Run cross-tier matching on projects with raw + selects tiers, then train to learn your editing preferences.</div>
    </div>` : ''}
  `;
}

// ── V2 Helpers ──

function renderProgressSegs(value, segments, color) {
  const filled = Math.round(value * segments);
  return Array.from({ length: segments }).map((_, i) =>
    `<div class="v2-progress-seg${i < filled ? ' filled' : ''}" style="${i < filled ? 'background:' + color : ''}"></div>`
  ).join('');
}

function formatHoursFromUnits(units, assets) {
  const total = units.reduce((s, u) => s + Math.max(0, (u.end_seconds || 0) - (u.start_seconds || 0)), 0);
  return `${Math.floor(total / 3600)}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`;
}

function countCameras(units) {
  const cams = new Set();
  for (const u of units) {
    const cam = extractCameraId(u.source_clip_name || u.sourceClipName || '');
    if (cam) cams.add(cam);
  }
  return cams.size > 0 ? `${cams.size}` : '—';
}

function countDays(units) {
  const days = new Set();
  for (const u of units) {
    const ts = extractDateFromClipName(u.source_clip_name || u.sourceClipName || '');
    if (ts) days.add(ts.toISOString().slice(0, 10));
  }
  return days.size > 0 ? `${days.size}` : '—';
}

function formatDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch { return '—'; }
}

// Tier add/replace prompts for v2
async function promptScriptUpload() {
  const url = await showInputModal({
    title: 'add script',
    label: 'google docs url or upload file',
    placeholder: 'https://docs.google.com/document/d/...',
    buttonText: 'Add',
  });
  if (!url) return;
  if (!isDemo) {
    const { createMediaAsset } = await import('./db.js');
    await createMediaAsset({
      projectId: currentProjectId,
      tier: url.includes('docs.google.com') ? 'google_docs' : 'script',
      sourceKind: url.includes('docs.google.com') ? 'google_docs' : 'local',
      sourceRef: url,
      format: url.includes('docs.google.com') ? 'url' : 'pdf',
    });
  }
  openProject(currentProjectId);
}

async function promptSelectsUpload() {
  const path = await showInputModal({
    title: 'add selects xml',
    label: 'xml file path or drag/drop',
    placeholder: 'selects-v3.xml',
    buttonText: 'Add',
  });
  if (!path) return;
  if (!isDemo) {
    const { createMediaAsset } = await import('./db.js');
    await createMediaAsset({
      projectId: currentProjectId,
      tier: 'selects',
      sourceKind: 'local',
      sourceRef: path,
      format: 'xml',
    });
  }
  openProject(currentProjectId);
}

// ═════════════════════════════════════════════
//   END V2
// ═════════════════════════════════════════════

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
      btn.closest('.spoke').querySelector('.tier-file-input').click();
    } else if (tier === 'selects') {
      btn.closest('.spoke').querySelector('.tier-file-input').click();
    } else if (tier === 'finished') {
      promptYoutubeUrl();
    } else if (tier === 'google_docs') {
      promptGoogleDocsUrl();
    }
  });
});

async function promptDropboxFolder(tier) {
  const path = await showInputModal({
    title: 'add dropbox folder',
    label: 'folder path',
    placeholder: '/Projects/Saudi Arabia/Proxies',
    buttonText: 'Add',
  });
  if (!path) return;
  const { createMediaAsset } = await import('./db.js');
  await createMediaAsset({
    projectId: currentProjectId,
    tier,
    sourceKind: 'dropbox',
    sourceRef: path,
    format: 'mp4',
  });
  openProject(currentProjectId);
}

async function promptYoutubeUrl() {
  const url = await showInputModal({
    title: 'add youtube video',
    label: 'youtube url',
    placeholder: 'https://youtube.com/watch?v=...',
    buttonText: 'Add',
  });
  if (!url) return;
  const { createMediaAsset } = await import('./db.js');
  await createMediaAsset({
    projectId: currentProjectId,
    tier: 'finished',
    sourceKind: 'youtube',
    sourceRef: url,
    format: 'mp4',
  });
  openProject(currentProjectId);
}

document.querySelectorAll('.tier-file-input').forEach(input => {
  input.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const tier = input.dataset.tier;
    const btn = input.closest('.spoke').querySelector('.tier-add-btn');
    const spokeId = tier === 'google_docs' ? 'docs' : tier;
    const tierSource = document.getElementById(`spoke-${spokeId}-content`);

    // Show loading state — pulse the spoke card
    const originalBtnText = btn.textContent;
    const spoke = input.closest('.spoke');
    btn.disabled = true;
    btn.textContent = 'parsing...';
    spoke?.classList.add('spoke--processing');

    // Multiple XML/EDL upload for selects tier
    if (tier === 'selects' && files.some(f => /\.(xml|edl)$/i.test(f.name))) {
      try {
        const { parseFCP7XML, extractCorpusUnits, extractSourceClips } = await import('./xml-parser.js');
        const allResults = [];

        for (const file of files) {
          if (!/\.(xml|edl)$/i.test(file.name)) continue;
          btn.textContent = `reading ${file.name}...`;
          const text = await file.text();
          const sequences = parseFCP7XML(text);
          const units = extractCorpusUnits(sequences);
          const sourceClips = extractSourceClips(sequences);

          for (const seq of sequences) {
            const classification = classifySequence(seq);
            allResults.push({
              fileName: file.name,
              sequenceName: seq.name,
              classification,
              sequences: [seq],
              units: units.filter(u => u.sequenceName === seq.name),
              sourceClips,
            });
          }
        }

        console.log(`[hunter] Batch parsed ${allResults.length} sequences from ${files.length} files:`);
        for (const r of allResults) {
          console.log(`  [${r.classification}] "${r.sequenceName}" — ${r.units.length} cuts (from ${r.fileName})`);
        }

        // Show immediate visual feedback of parsed sequences
        btn.textContent = `saving ${allResults.length} sequences...`;
        const totalCuts = allResults.reduce((sum, r) => sum + r.units.length, 0);
        tierSource.innerHTML = `<div class="upload-summary">${allResults.length} sequences · ${totalCuts} cuts</div>` +
          allResults.map((r, i) =>
            `<div class="tier-asset tier-asset--new" style="animation-delay:${i * 0.05}s"><span class="np-eyebrow np-eyebrow--classification">${r.classification}</span> <span>${escHtml(r.sequenceName)}</span> <span style="opacity:0.5;font-size:10px">${r.units.length} cuts</span></div>`
          ).join('');

        // Save each classified sequence as a media asset
        if (!isDemo) {
          const { createMediaAsset } = await import('./db.js');
          for (const r of allResults) {
            await createMediaAsset({
              projectId: currentProjectId,
              tier: 'selects',
              sourceKind: 'local',
              sourceRef: `${r.fileName} → ${r.sequenceName}`,
              format: 'xml',
              metadata: {
                classification: r.classification,
                sequenceName: r.sequenceName,
                unitCount: r.units.length,
                sourceClips: r.sourceClips.map(c => c.name).slice(0, 50),
                parsedUnits: r.units.slice(0, 200),
              },
            });
          }
        }

        // Success feedback — mark spoke as connected
        spoke?.classList.remove('spoke--processing');
        spoke?.classList.add('spoke--connected');
        btn.textContent = `\u2713 ${allResults.length} sequences`;
        setTimeout(() => {
          btn.textContent = originalBtnText;
          btn.disabled = false;
        }, 3000);

        showToast(`${files.length} XML${files.length > 1 ? 's' : ''} → ${allResults.length} sequences · ${totalCuts} cuts`);

      } catch (err) {
        console.error('[hunter] XML parse error:', err);
        spoke?.classList.remove('spoke--processing');
        btn.textContent = originalBtnText;
        btn.disabled = false;
        showToast(`Error: ${err.message}`, true);
      }
    } else if (!isDemo) {
      const { createMediaAsset } = await import('./db.js');
      for (const file of files) {
        await createMediaAsset({
          projectId: currentProjectId,
          tier,
          sourceKind: 'local',
          sourceRef: file.name,
          format: file.name.split('.').pop(),
        });
      }
      spoke?.classList.remove('spoke--processing');
      spoke?.classList.add('spoke--connected');
      btn.textContent = `\u2713 ${files.length} file${files.length > 1 ? 's' : ''} added`;
      showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`);
      setTimeout(() => {
        btn.textContent = originalBtnText;
        btn.disabled = false;
      }, 3000);
    } else {
      spoke?.classList.remove('spoke--processing');
      btn.textContent = originalBtnText;
      btn.disabled = false;
    }

    input.value = ''; // reset so same files can be re-selected
    // Refresh the project view after a beat
    setTimeout(() => openProject(currentProjectId), 2200);
  });
});

/**
 * Classify a sequence based on its name and structure.
 * Returns: 'on-cam' | 'selects' | 'master' | 'stringout' | 'unknown'
 *
 * Heuristics:
 * - "on cam" / "OC" / "a-cam" / "talking head" → on-cam
 * - "selects" / "sel" / "picks" / "favorites" → selects
 * - "master" / "final" / "v1" / "edit" / "assembly" → master
 * - "stringout" / "string out" / "all clips" → stringout
 * - Many short clips (avg < 10s) with same source → stringout
 * - Fewer clips, longer duration, multiple sources → master/selects
 */
function classifySequence(seq) {
  const name = (seq.name || '').toLowerCase();

  // Name-based classification (strong signals)
  if (/\bon.?cam\b|\boc\b|\ba.?cam\b|\btalking.?head\b|\binterview\b|\bpresenter\b/.test(name)) return 'on-cam';
  if (/\bselect\b|\bsel\b|\bpick\b|\bfavorite\b|\bfav\b|\bbest\b|\bhighlight\b/.test(name)) return 'selects';
  if (/\bmaster\b|\bfinal\b|\bedit\b|\bassembly\b|\bcut\b|\bv\d\b|\brough\b|\bfine\b/.test(name)) return 'master';
  if (/\bstring.?out\b|\ball.?clip\b|\bdump\b|\bfull\b/.test(name)) return 'stringout';

  // Structure-based classification (weaker signals)
  const allClips = seq.videoTracks.flatMap(t => t.clips);
  if (allClips.length === 0) return 'unknown';

  const avgDuration = allClips.reduce((sum, c) => sum + (c.endSeconds - c.startSeconds), 0) / allClips.length;
  const uniqueSources = new Set(allClips.map(c => c.sourceFile?.name).filter(Boolean));

  // Single source + many clips = on-cam or stringout
  if (uniqueSources.size <= 2 && allClips.length > 20) return 'stringout';
  // Few sources + short clips = on-cam
  if (uniqueSources.size <= 3 && avgDuration < 15 && allClips.length > 5) return 'on-cam';
  // Many sources + moderate clips = selects
  if (uniqueSources.size > 5 && allClips.length > 3) return 'selects';
  // Long average duration + multiple sources = master
  if (avgDuration > 30 && uniqueSources.size > 3) return 'master';

  return 'selects'; // default to selects for unclassified
}

// ── Insights Hub ──

let chatHistory = [];
let insightsHubAC = null;

function renderInsightsHub(units, assets) {
  const section = document.getElementById('insights-hub');
  const analyzed = units.filter(u => u.analyses?.[0]?.output_text);

  if (analyzed.length < 3) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Reset chat on project change
  chatHistory = [];
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.innerHTML = '<div class="chat-empty">ask anything about your footage</div>';

  // Reset other panels
  document.getElementById('scene-insights-list').innerHTML = '';
  document.getElementById('tier-comparison-results').innerHTML = '';

  // Cleanup previous listeners
  if (insightsHubAC) insightsHubAC.abort();
  insightsHubAC = new AbortController();
  const signal = insightsHubAC.signal;

  // Tab switching
  document.querySelectorAll('.insights-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.insights-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.insights-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab.dataset.tab}`));
    }, { signal });
  });

  // Scene Insights button
  const insightsBtn = document.getElementById('btn-generate-insights');
  insightsBtn.addEventListener('click', async () => {
    const scenes = groupIntoScenes(units);
    if (!scenes.length) {
      document.getElementById('scene-insights-list').innerHTML = '<p class="empty-sub">no scenes detected</p>';
      return;
    }

    insightsBtn.disabled = true;
    insightsBtn.innerHTML = 'analyzing scenes<span class="thinking-indicator"><span></span><span></span><span></span></span>';

    try {
      const scenesPayload = scenes.slice(0, 20).map(s => ({
        label: s.label,
        day: s.day,
        time: s.time,
        clipCount: s.clips.length,
        clips: s.clips.slice(0, 8).map(c => ({
          clipName: c.source_clip_name || c.sourceClipName || '',
          startSeconds: c.start_seconds ?? c.startSeconds ?? 0,
          endSeconds: c.end_seconds ?? c.endSeconds ?? 0,
          analysisText: (c.analyses?.[0]?.output_text || '').replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim().slice(0, 200),
        })),
      }));

      const { insights } = await fetchSceneInsights(scenesPayload);
      const list = document.getElementById('scene-insights-list');
      list.innerHTML = (insights || []).map((ins, i) => {
        const scene = scenes[ins.scene_index ?? i];
        const potentialLevel = (ins.editorial_potential || '').split(' ')[0] || 'MEDIUM';
        const moments = Array.isArray(ins.key_moments) ? ins.key_moments : [];
        return `
          <div class="insight-card" style="animation-delay:${i * 0.05}s">
            <div class="insight-card-scene">Scene ${(ins.scene_index ?? i) + 1}: ${escHtml(scene?.label || '')}</div>
            <div class="insight-card-desc">${escHtml(ins.scene_description || '')}</div>
            <span class="insight-card-potential insight-card-potential--${escHtml(potentialLevel)}">${escHtml(ins.editorial_potential || '')}</span>
            ${moments.length ? `<div class="insight-card-moments">${moments.map(m => `<div class="insight-card-moment">${escHtml(typeof m === 'string' ? m : m.moment || m.description || JSON.stringify(m))}</div>`).join('')}</div>` : ''}
            ${ins.emotional_arc ? `<div class="insight-card-arc">${escHtml(ins.emotional_arc)}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (err) {
      document.getElementById('scene-insights-list').innerHTML = `<p class="empty-sub" style="color:var(--np-red)">${escHtml(err.message)}</p>`;
    } finally {
      insightsBtn.disabled = false;
      insightsBtn.textContent = 'generate scene insights';
    }
  }, { signal });

  // Chat
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  async function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;

    chatInput.value = '';

    // Remove empty placeholder
    const empty = chatMessages.querySelector('.chat-empty');
    if (empty) empty.remove();

    // Render user message
    chatMessages.innerHTML += `<div class="chat-message chat-message--user"><div class="chat-message-text">${escHtml(msg)}</div></div>`;

    // Show thinking indicator
    chatMessages.innerHTML += `<div class="chat-thinking" id="chat-thinking"><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div></div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatHistory.push({ role: 'user', content: msg });

    try {
      // Semantic search for relevant clips
      let relevantClips = [];
      try {
        const search = await semanticSearch({ query: msg, projectId: currentProjectId, limit: 10 });
        relevantClips = search.matches || [];
      } catch { /* search unavailable, proceed without */ }

      // Build project context
      const tierCounts = {};
      for (const a of assets) {
        tierCounts[a.tier] = (tierCounts[a.tier] || 0) + 1;
      }
      const projectContext = `PROJECT: ${analyzed.length} analyzed clips. Tiers: ${Object.entries(tierCounts).map(([t, c]) => `${t}(${c})`).join(', ')}.`;

      const { reply, citedClips } = await chatWithFootage({
        message: msg,
        conversationHistory: chatHistory.slice(-10),
        projectContext,
        relevantClips,
      });

      // Remove thinking indicator
      document.getElementById('chat-thinking')?.remove();

      chatHistory.push({ role: 'assistant', content: reply });

      // Render assistant message
      const cited = (citedClips || []).map(c => {
        const name = (c.clipName || '').replace(/_Proxy\.MP4$/i, '').replace(/^\d{8}-\d{4}-/, '');
        return `<span class="chat-cited-clip">${escHtml(name)}</span>`;
      }).join('');

      chatMessages.innerHTML += `
        <div class="chat-message chat-message--assistant">
          <div class="chat-message-label">hunter</div>
          <div class="chat-message-text">${escHtml(reply)}</div>
          ${cited ? `<div class="chat-cited-clips">${cited}</div>` : ''}
        </div>
      `;
    } catch (err) {
      document.getElementById('chat-thinking')?.remove();
      chatMessages.innerHTML += `<div class="chat-message chat-message--assistant"><div class="chat-message-label">hunter</div><div class="chat-message-text" style="color:var(--np-red)">${escHtml(err.message)}</div></div>`;
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatSendBtn.addEventListener('click', sendChat, { signal });
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); }, { signal });

  // Tier Comparison button
  const tierBtn = document.getElementById('btn-compare-tiers');
  tierBtn.addEventListener('click', async () => {
    tierBtn.disabled = true;
    tierBtn.innerHTML = 'comparing tiers<span class="thinking-indicator"><span></span><span></span><span></span></span>';

    try {
      const { comparison, tierCounts } = await fetchTierComparison(currentProjectId);
      const results = document.getElementById('tier-comparison-results');

      const cols = [
        { key: 'raw_character', label: 'raw', cls: 'raw', count: tierCounts?.raw },
        { key: 'selects_philosophy', label: 'selects', cls: 'selects', count: tierCounts?.selects },
        { key: 'finished_focus', label: 'finished', cls: 'finished', count: tierCounts?.finished },
      ];

      results.innerHTML = `
        <div class="tier-comparison-grid">
          ${cols.map(c => `
            <div class="tier-col">
              <div class="tier-col-label tier-col-label--${c.cls}">${c.label}${c.count ? ` (${c.count})` : ''}</div>
              <div class="tier-col-text">${escHtml(comparison[c.key] || 'No data for this tier.')}</div>
            </div>
          `).join('')}
        </div>
        ${comparison.editorial_drift ? `
          <div class="tier-section">
            <div class="tier-section-title">editorial drift</div>
            <div class="tier-section-text">${escHtml(comparison.editorial_drift)}</div>
          </div>
        ` : ''}
        ${comparison.hidden_gems?.length ? `
          <div class="tier-section">
            <div class="tier-section-title">hidden gems</div>
            <ul class="tier-section-list">
              ${comparison.hidden_gems.map(g => `<li>${escHtml(typeof g === 'string' ? g : g.description || JSON.stringify(g))}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        ${comparison.recommendations?.length ? `
          <div class="tier-section">
            <div class="tier-section-title">recommendations</div>
            <ul class="tier-section-list">
              ${comparison.recommendations.map(r => `<li>${escHtml(typeof r === 'string' ? r : r.description || JSON.stringify(r))}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      `;
    } catch (err) {
      document.getElementById('tier-comparison-results').innerHTML = `<p class="empty-sub" style="color:var(--np-red)">${escHtml(err.message)}</p>`;
    } finally {
      tierBtn.disabled = false;
      tierBtn.textContent = 'compare tiers';
    }
  }, { signal });
}

// ── "What do you see?" button ──

document.getElementById('btn-what-do-you-see')?.addEventListener('click', async () => {
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

let allCorpusUnits = [];
let corpusFilter = '';
let corpusKeepFilter = '';
let corpusSort = 'default';
let corpusPage = 0;
const CORPUS_PAGE_SIZE = 60;

async function loadCorpusBrowser() {
  const browser = document.getElementById('corpus-browser');
  browser.innerHTML = '<p class="corpus-browser-loading">loading corpus...</p>';

  if (isDemo) {
    allCorpusUnits = [];
    for (const [pid, projectUnits] of Object.entries(DEMO_UNITS)) {
      const proj = DEMO_PROJECTS.find(p => p.id === pid);
      for (const u of projectUnits) {
        allCorpusUnits.push({
          ...u,
          media_assets: { project_id: pid, tier: 'raw', hunter_projects: { name: proj?.name || 'unknown' } },
        });
      }
    }
  } else {
    try {
      allCorpusUnits = await listAllCorpusUnits(2000);
    } catch (err) {
      console.error('[hunter] loadCorpusBrowser:', err);
      browser.innerHTML = '<p class="corpus-browser-empty">failed to load corpus</p>';
      return;
    }
  }

  if (!allCorpusUnits.length) {
    browser.innerHTML = '<p class="corpus-browser-empty">no analyzed footage yet — ingest a project to build the corpus</p>';
    return;
  }

  // Render corpus summary
  renderCorpusSummary();

  // Init tier filter tabs
  document.querySelectorAll('.corpus-filter-tab[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      corpusFilter = tab.dataset.filter;
      corpusPage = 0;
      document.querySelectorAll('.corpus-filter-tab[data-filter]').forEach(t => t.classList.toggle('active', t === tab));
      renderCorpusPage();
    });
  });

  // Init keepability filter tabs
  document.querySelectorAll('.corpus-keep-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      corpusKeepFilter = tab.dataset.keep;
      corpusPage = 0;
      document.querySelectorAll('.corpus-keep-tab').forEach(t => t.classList.toggle('active', t.dataset.keep === corpusKeepFilter));
      renderCorpusPage();
    });
  });

  // Init sort selector
  const sortSelect = document.getElementById('corpus-sort');
  sortSelect.addEventListener('change', () => {
    corpusSort = sortSelect.value;
    corpusPage = 0;
    renderCorpusPage();
  });

  renderCorpusPage();
}

function getFilteredCorpus() {
  let filtered = allCorpusUnits;
  // Only show analyzed units (skip noise from pending analysis)
  filtered = filtered.filter(u => u.analyses?.length > 0 && u.analyses[0]?.output_text);
  if (corpusFilter) {
    filtered = filtered.filter(u => (u.media_assets?.tier || '') === corpusFilter);
  }
  // Keepability filter
  if (corpusKeepFilter) {
    filtered = filtered.filter(u => {
      const score = u.analyses?.[0]?.output_json?.keepability_score;
      if (score == null) return false;
      if (corpusKeepFilter === 'high') return score >= 7;
      if (corpusKeepFilter === 'mid') return score >= 4 && score <= 6;
      if (corpusKeepFilter === 'low') return score <= 3;
      return true;
    });
  }
  // Sort
  if (corpusSort === 'keep-desc') {
    filtered.sort((a, b) => (b.analyses?.[0]?.output_json?.keepability_score ?? -1) - (a.analyses?.[0]?.output_json?.keepability_score ?? -1));
  } else if (corpusSort === 'keep-asc') {
    filtered.sort((a, b) => (a.analyses?.[0]?.output_json?.keepability_score ?? 99) - (b.analyses?.[0]?.output_json?.keepability_score ?? 99));
  }
  return filtered;
}

function renderCorpusSummary() {
  const el = document.getElementById('corpus-summary');
  const analyzed = allCorpusUnits.filter(u => u.analyses?.length > 0 && u.analyses[0]?.output_text);
  if (analyzed.length < 5) { el.classList.add('hidden'); return; }

  // Total duration
  let totalDur = 0;
  for (const u of analyzed) {
    const dur = (u.end_seconds || 0) - (u.start_seconds || 0);
    if (dur > 0) totalDur += dur;
  }

  // Keepability
  let keepSum = 0, keepN = 0;
  const shotTypes = {};
  for (const u of analyzed) {
    const j = u.analyses[0]?.output_json;
    if (!j) continue;
    if (j.keepability_score != null) { keepSum += j.keepability_score; keepN++; }
    if (j.shot_type) shotTypes[j.shot_type] = (shotTypes[j.shot_type] || 0) + 1;
  }

  const avgKeep = keepN > 0 ? (keepSum / keepN).toFixed(1) : '—';
  const topShots = Object.entries(shotTypes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const hours = Math.floor(totalDur / 3600);
  const mins = Math.floor((totalDur % 3600) / 60);
  const durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  el.innerHTML = `
    <div class="corpus-summary-stat"><span class="corpus-summary-num">${analyzed.length.toLocaleString()}</span> analyzed clips</div>
    <div class="corpus-summary-stat"><span class="corpus-summary-num">${durStr}</span> footage</div>
    <div class="corpus-summary-stat"><span class="corpus-summary-num">${avgKeep}</span> avg keepability</div>
    ${topShots.length ? `<div class="corpus-summary-stat">top: ${topShots.map(t => `<span class="corpus-summary-tag">${escHtml(t)}</span>`).join(' ')}</div>` : ''}
  `;
  el.classList.remove('hidden');
}

function renderCorpusPage() {
  const browser = document.getElementById('corpus-browser');
  const pagination = document.getElementById('corpus-pagination');
  const countEl = document.getElementById('corpus-count');

  const filtered = getFilteredCorpus();
  const totalPages = Math.ceil(filtered.length / CORPUS_PAGE_SIZE);
  const page = Math.min(corpusPage, totalPages - 1);
  const start = page * CORPUS_PAGE_SIZE;
  const pageUnits = filtered.slice(start, start + CORPUS_PAGE_SIZE);

  countEl.textContent = `${filtered.length} units`;

  browser.innerHTML = `
    <div class="corpus-grid">
      ${pageUnits.map(u => {
        const analysis = u.analyses?.[0];
        const projectName = u.media_assets?.hunter_projects?.name || 'unknown';
        const tier = u.media_assets?.tier || '';
        const structured = analysis?.output_json;
        const badges = renderAnalysisBadges(structured);
        return `
          <div class="corpus-grid-item" data-project-id="${u.media_assets?.project_id || ''}">
            <div class="corpus-grid-item-project">${escHtml(projectName)} / ${tier}</div>
            <div class="corpus-grid-item-tc">${formatTc(u.start_seconds)} – ${formatTc(u.end_seconds)}${u.source_clip_name ? ' · ' + escHtml(u.source_clip_name) : ''}</div>
            <div class="corpus-grid-item-text">${analysis ? escHtml(analysis.output_text.slice(0, 200)) : '<em style="color:var(--np-text-dim)">pending analysis</em>'}</div>
            ${badges}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Pagination
  if (totalPages > 1) {
    let paginationHtml = '';
    paginationHtml += `<button class="corpus-page-btn" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>←</button>`;
    paginationHtml += `<span class="corpus-page-info">${page + 1} / ${totalPages}</span>`;
    paginationHtml += `<button class="corpus-page-btn" data-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''}>→</button>`;
    pagination.innerHTML = paginationHtml;

    pagination.querySelectorAll('.corpus-page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        corpusPage = parseInt(btn.dataset.page);
        renderCorpusPage();
        browser.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  } else {
    pagination.innerHTML = '';
  }

  browser.querySelectorAll('.corpus-grid-item').forEach(item => {
    item.addEventListener('click', () => {
      const pid = item.dataset.projectId;
      if (pid) openProject(pid);
    });
  });
}

// ── CSV export ──

document.getElementById('corpus-export-csv')?.addEventListener('click', () => {
  const filtered = getFilteredCorpus();
  if (!filtered.length) return;

  const headers = ['clip_name', 'project', 'tier', 'start', 'end', 'keepability', 'shot_type', 'camera_movement', 'editorial_function', 'emotional_register', 'analysis_preview'];
  const csvEscape = (s) => `"${String(s || '').replace(/"/g, '""')}"`;

  const rows = filtered.map(u => {
    const j = u.analyses?.[0]?.output_json || {};
    const text = (u.analyses?.[0]?.output_text || '').slice(0, 200).replace(/\n/g, ' ');
    return [
      u.source_clip_name || '',
      u.media_assets?.hunter_projects?.name || '',
      u.media_assets?.tier || '',
      formatTc(u.start_seconds),
      formatTc(u.end_seconds),
      j.keepability_score ?? '',
      j.shot_type || '',
      j.camera_movement || '',
      j.editorial_function || '',
      j.emotional_register || '',
      text,
    ].map(csvEscape).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hunter-corpus-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function renderAnalysisBadges(structured) {
  if (!structured) return '';
  const badges = [];
  if (structured.shot_type) badges.push(structured.shot_type);
  if (structured.camera_movement && structured.camera_movement !== 'static') badges.push(structured.camera_movement);
  if (structured.keepability_score != null) {
    const score = structured.keepability_score;
    const cls = score >= 7 ? 'analysis-badge--keep' : score <= 3 ? 'analysis-badge--cut' : '';
    badges.push(`<span class="analysis-badge ${cls}">keep: ${score}/10</span>`);
  }
  if (structured.editorial_function) badges.push(structured.editorial_function);
  if (!badges.length) return '';
  return `<div class="analysis-badges">${badges.map(b =>
    b.startsWith('<span') ? b : `<span class="analysis-badge">${escHtml(b)}</span>`
  ).join('')}</div>`;
}

// ── Corpus search ──

let _corpusSearchAC = null;

function initCorpusSearch() {
  if (_corpusSearchAC) _corpusSearchAC.abort();
  _corpusSearchAC = new AbortController();
  const signal = _corpusSearchAC.signal;

  const input = document.getElementById('corpus-search-input');
  const tierSelect = document.getElementById('corpus-search-tier');
  const btn = document.getElementById('corpus-search-btn');
  const results = document.getElementById('corpus-search-results');

  if (!input || !btn) return;

  async function doSearch() {
    const query = input.value.trim();
    if (!query) return;

    const tier = tierSelect.value || undefined;
    btn.disabled = true;
    btn.textContent = '...';
    results.innerHTML = '<p class="corpus-search-status">searching corpus...</p>';

    try {
      const data = await semanticSearch({ query, tier, limit: 20 });
      if (!data.matches?.length) {
        results.innerHTML = '<p class="corpus-search-status">no matches found</p>';
        return;
      }

      results.innerHTML = `
        <p class="corpus-search-status">${data.matches.length} matches across ${data.total} embeddings</p>
        ${data.matches.map(m => `
          <div class="corpus-search-match" data-project-id="${m.projectId || ''}" style="cursor:pointer">
            <div class="corpus-search-match-header">
              <span class="corpus-search-match-clip">${escHtml(m.clipName || 'unknown')}</span>
              <span class="corpus-search-match-score">${(m.similarity * 100).toFixed(1)}%</span>
            </div>
            <div class="corpus-search-match-meta">${escHtml(m.projectName || '')} / ${m.tier || ''} · ${formatTc(m.startSeconds)} – ${formatTc(m.endSeconds)}</div>
            <div class="corpus-search-match-text">${escHtml(m.analysisPreview || '')}</div>
          </div>
        `).join('')}
      `;
      // Click search results to navigate to project
      results.querySelectorAll('.corpus-search-match').forEach(el => {
        el.addEventListener('click', () => {
          const pid = el.dataset.projectId;
          if (pid) openProject(pid);
        });
      });
    } catch (err) {
      results.innerHTML = `<p class="corpus-search-status">error: ${escHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'search';
    }
  }

  btn.addEventListener('click', doSearch, { signal });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); }, { signal });
}

// ── YouTube + Google Docs helpers ──

function extractYoutubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function renderSpokePreview(tier, tierAssets) {
  switch (tier) {
    case 'raw': {
      const ref = tierAssets[0].source_ref || '';
      const parts = ref.split('/').filter(Boolean);
      const shortRef = parts.length > 1 ? parts.slice(-2).join('/') : ref;
      const clipCount = tierAssets.reduce((sum, a) => sum + (a.metadata?.clipCount || 1), 0);
      return `<div class="spoke-card-ref">${escHtml(shortRef)}</div>
              <div class="spoke-card-meta">${clipCount} clip${clipCount !== 1 ? 's' : ''}</div>`;
    }
    case 'script': {
      const ref = tierAssets[0].source_ref || '';
      const name = ref.replace(/\.[^.]+$/, '');
      return `<div class="spoke-card-ref">${escHtml(name)}</div>`;
    }
    case 'selects': {
      let seqCount = 0, cutCount = 0;
      tierAssets.forEach(a => {
        seqCount++;
        cutCount += a.metadata?.unitCount || 0;
      });
      return `<div class="spoke-card-meta">${seqCount} sequence${seqCount !== 1 ? 's' : ''} \u00b7 ${cutCount} cuts</div>`;
    }
    case 'finished': {
      const url = tierAssets[0].source_ref || '';
      const videoId = extractYoutubeId(url);
      let html = '';
      if (videoId) {
        html += `<img src="https://img.youtube.com/vi/${escHtml(videoId)}/mqdefault.jpg" class="spoke-card-thumb" alt="thumbnail">`;
      }
      html += `<div class="spoke-card-ref">${escHtml(url)}</div>`;
      return html;
    }
    case 'google_docs': {
      const url = tierAssets[0].source_ref || '';
      const display = url.length > 35 ? url.slice(0, 35) + '\u2026' : url;
      return `<a href="${escHtml(url)}" target="_blank" rel="noopener" class="spoke-card-link">${escHtml(display)} \u2197</a>`;
    }
    default:
      return tierAssets.map(a => `<div class="spoke-card-ref">${escHtml(a.source_ref)}</div>`).join('');
  }
}

async function promptGoogleDocsUrl() {
  const url = await showInputModal({
    title: 'link google doc',
    label: 'google docs url',
    placeholder: 'https://docs.google.com/document/d/...',
    buttonText: 'Link',
  });
  if (!url) return;
  if (!isDemo) {
    const { createMediaAsset } = await import('./db.js');
    await createMediaAsset({
      projectId: currentProjectId,
      tier: 'google_docs',
      sourceKind: 'google_docs',
      sourceRef: url,
      format: 'url',
    });
  }
  openProject(currentProjectId);
}

// ── Utilities ──

function showToast(message, isError = false) {
  const existing = document.querySelector('.hunter-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'hunter-toast' + (isError ? ' hunter-toast--error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function simpleMarkdown(str) {
  if (!str) return '';
  return escHtml(str)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^(\d+)\.\s+/gm, '<span class="md-list-num">$1.</span> ')
    .replace(/^-\s+/gm, '<span class="md-list-bullet">·</span> ')
    .replace(/---/g, '<hr class="md-hr">')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatTc(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Delete project ──

document.getElementById('btn-delete-project').addEventListener('click', async () => {
  const project = projects.find(p => p.id === currentProjectId);
  const name = project?.name || 'this project';

  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  if (!isDemo) {
    const { deleteProject } = await import('./db.js');
    await deleteProject(currentProjectId);
  } else {
    // Remove from demo data
    const idx = projects.findIndex(p => p.id === currentProjectId);
    if (idx >= 0) projects.splice(idx, 1);
    delete DEMO_ASSETS[currentProjectId];
  }

  currentProjectId = null;
  showView('projects');
});

// ── Export XML ──

document.getElementById('btn-export-xml')?.addEventListener('click', async () => {
  const { buildHunterSequenceXML, downloadXML } = await import('./xml-writer.js');

  // Get current project's units (demo or real)
  let units;
  if (isDemo && DEMO_UNITS[currentProjectId]) {
    units = DEMO_UNITS[currentProjectId];
  } else if (!isDemo) {
    units = await listCorpusUnitsForProject(currentProjectId);
  } else {
    units = [];
  }

  if (!units.length) {
    alert('No analyzed units to export.');
    return;
  }

  const project = projects.find(p => p.id === currentProjectId);
  const projectName = project?.name || 'Hunter Export';

  const exportUnits = units.map(u => ({
    sourceClipName: u.source_clip_name || u.source_clip_name || u.sourceClipName || 'clip',
    startSeconds: u.start_seconds ?? u.startSeconds ?? 0,
    endSeconds: u.end_seconds ?? u.endSeconds ?? 0,
    analysisText: u.analyses?.[0]?.output_text || '',
  }));

  const xml = buildHunterSequenceXML({
    sequenceName: `${projectName} — Hunter Selects`,
    units: exportUnits,
    fps: 23.976,
    label: 'Hunter Analysis',
  });

  downloadXML(xml, `${projectName.toLowerCase().replace(/\s+/g, '-')}-hunter-export.xml`);
});

// ── Reusable input modal ──

function showInputModal({ title, label, placeholder, buttonText }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('input-modal');
    const input = document.getElementById('input-modal-input');
    const titleEl = document.getElementById('input-modal-title');
    const labelEl = document.getElementById('input-modal-label');
    const submitBtn = document.getElementById('input-modal-submit');
    const cancelBtn = document.getElementById('input-modal-cancel');

    titleEl.textContent = title || 'input';
    labelEl.textContent = label || 'value';
    input.placeholder = placeholder || '';
    submitBtn.textContent = buttonText || 'Add';
    input.value = '';

    modal.classList.remove('hidden');
    input.focus();

    function cleanup() {
      modal.classList.add('hidden');
      submitBtn.removeEventListener('click', onSubmit);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      input.removeEventListener('keydown', onKey);
    }

    function onSubmit() {
      const val = input.value.trim();
      cleanup();
      resolve(val || null);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onOverlay(e) {
      if (e.target === modal) onCancel();
    }

    function onKey(e) {
      if (e.key === 'Enter') onSubmit();
      if (e.key === 'Escape') onCancel();
    }

    submitBtn.addEventListener('click', onSubmit);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    input.addEventListener('keydown', onKey);
  });
}

// ── Ingest status bar ──

let ingestPollTimer = null;
const TOTAL_CLIPS_ESTIMATE = 1199; // Saudi Arabia known count

// Generate a casual Hunter-voice quip from analysis text
function generateQuip(text) {
  // Extract the actual first sentence from the analysis — it's always specific
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  if (!sentences.length) return text.slice(0, 80);

  // Skip generic openers like "The video opens with..." — grab the meat
  let pick = sentences[0];
  if (sentences.length > 1 && /^(The (video|shot|scene|clip|moment|frame) (opens|begins|starts|shows))/i.test(pick)) {
    // Take the second sentence or trim the first to the interesting part
    const afterWith = pick.match(/with (.+)/i);
    if (afterWith) {
      pick = afterWith[1].replace(/^(a |an |the )/i, '');
      // Capitalize first letter
      pick = pick.charAt(0).toUpperCase() + pick.slice(1);
    } else {
      pick = sentences[1];
    }
  }

  // Trim to a readable length
  if (pick.length > 120) pick = pick.slice(0, 115) + '...';
  return pick;
}

async function pollIngestStatus() {
  if (!currentProjectId || isDemo) return;

  try {
    const status = await getIngestStatus(currentProjectId);
    const el = document.getElementById('ingest-status');
    if (!el) return;

    if (!status || !status.active) {
      if (status?.analyzedCount > 0 && status.recentAnalyses?.length > 0) {
        el.classList.remove('hidden');
        el.querySelector('.hunters-eye-title').textContent = 'hunter finished watching';
        el.querySelector('.hunters-eye-pulse').style.animation = 'none';
        el.querySelector('.hunters-eye-pulse').style.background = 'var(--np-green)';
        document.getElementById('ingest-count').textContent = `${status.analyzedCount} clips analyzed`;
        document.getElementById('ingest-progress-fill').style.width = '100%';
      } else {
        el.classList.add('hidden');
      }
      return;
    }

    el.classList.remove('hidden');
    const count = status.analyzedCount;
    const pct = Math.min((count / TOTAL_CLIPS_ESTIMATE) * 100, 99).toFixed(1);

    document.getElementById('ingest-count').textContent = `${count} / ~${TOTAL_CLIPS_ESTIMATE} clips`;
    document.getElementById('ingest-progress-fill').style.width = `${pct}%`;

    const feed = document.getElementById('ingest-feed');
    if (status.recentAnalyses?.length > 0) {
      feed.innerHTML = status.recentAnalyses.map(a => {
        const quip = generateQuip(a.text);
        const clipShort = a.clipName.replace(/_Proxy\.MP4$/i, '').replace(/^\d{8}-\d{4}-/, '');
        return `
          <div class="ingest-feed-item">
            <span class="ingest-feed-clip">${escHtml(clipShort)}</span>
            <span class="ingest-feed-quip">${escHtml(quip)}</span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('[hunter] ingest poll error:', err);
  }
}

function startIngestPolling() {
  if (ingestPollTimer) clearInterval(ingestPollTimer);
  pollIngestStatus();
  ingestPollTimer = setInterval(pollIngestStatus, 6000);
}

function stopIngestPolling() {
  if (ingestPollTimer) {
    clearInterval(ingestPollTimer);
    ingestPollTimer = null;
  }
}

// ── Project-level search ──

let _projectSearchAC = null;

function initProjectSearch() {
  if (_projectSearchAC) _projectSearchAC.abort();
  _projectSearchAC = new AbortController();
  const signal = _projectSearchAC.signal;

  const input = document.getElementById('project-search-input');
  const btn = document.getElementById('project-search-btn');
  const results = document.getElementById('project-search-results');

  if (!input || !btn) return;

  async function doProjectSearch() {
    const query = input.value.trim();
    if (!query || !currentProjectId) return;

    btn.disabled = true;
    btn.textContent = '...';
    results.innerHTML = '<p class="project-search-status">searching...</p>';

    try {
      const data = await semanticSearch({ query, projectId: currentProjectId, limit: 10 });
      if (!data.matches?.length) {
        results.innerHTML = '<p class="project-search-status">no matches found</p>';
        return;
      }

      results.innerHTML = data.matches.map(m => `
        <div class="project-search-result">
          <div class="project-search-result-header">
            <span class="project-search-result-clip">${escHtml(m.clipName || 'unknown')}</span>
            <span class="project-search-result-score">${(m.similarity * 100).toFixed(1)}%</span>
          </div>
          <div class="project-search-result-meta">${m.tier || ''} · ${formatTc(m.startSeconds)} – ${formatTc(m.endSeconds)}</div>
          <div class="project-search-result-text">${escHtml(m.analysisPreview || '')}</div>
        </div>
      `).join('');
    } catch (err) {
      results.innerHTML = `<p class="project-search-status" style="color:var(--np-red)">${escHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'search';
    }
  }

  btn.addEventListener('click', doProjectSearch, { signal });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doProjectSearch(); }, { signal });
}

// ── Tier funnel visualization ──

function renderTierFunnel(tierStats) {
  const funnel = document.getElementById('tier-funnel');
  const bar = document.getElementById('tier-funnel-bar');

  // Editorial flow: raw → selects → finished (script is parallel, not sequential)
  const flowTiers = ['raw', 'selects', 'finished'].filter(t => tierStats[t]?.total > 0);
  const scriptCount = tierStats['google_docs']?.total || 0;

  if (flowTiers.length < 2) {
    funnel.classList.add('hidden');
    return;
  }

  funnel.classList.remove('hidden');

  const maxCount = Math.max(...flowTiers.map(t => tierStats[t].total));
  const segments = [];

  for (let i = 0; i < flowTiers.length; i++) {
    const tier = flowTiers[i];
    const count = tierStats[tier].total;
    const pct = Math.max((count / maxCount) * 100, 12);

    segments.push(`<div class="funnel-segment funnel-segment--${tier}" style="width:${pct.toFixed(1)}%">${tier} ${count.toLocaleString()}</div>`);

    if (i < flowTiers.length - 1) {
      const nextCount = tierStats[flowTiers[i + 1]].total;
      const retention = ((nextCount / count) * 100).toFixed(1);
      segments.push(`<div class="funnel-arrow">→${retention}%</div>`);
    }
  }

  // Script as a parallel note if present
  if (scriptCount > 0) {
    segments.push(`<div class="funnel-segment funnel-segment--script" style="width:12%">script ${scriptCount}</div>`);
  }

  bar.innerHTML = segments.join('');
}

// ── Project stats dashboard ──

function renderProjectStats(units) {
  const section = document.getElementById('project-stats');
  const grid = document.getElementById('stats-grid');

  // Collect structured analysis data
  const analyzed = units.filter(u => u.analyses?.[0]?.output_json);
  if (analyzed.length < 3) {
    section.classList.add('hidden');
    return;
  }

  const shotTypes = {};
  const cameraMovements = {};
  const editorialFunctions = {};
  const emotionalRegisters = {};
  let keepTotal = 0;
  let keepCount = 0;

  for (const u of analyzed) {
    const j = u.analyses[0].output_json;
    if (j.shot_type) shotTypes[j.shot_type] = (shotTypes[j.shot_type] || 0) + 1;
    if (j.camera_movement) cameraMovements[j.camera_movement] = (cameraMovements[j.camera_movement] || 0) + 1;
    if (j.editorial_function) editorialFunctions[j.editorial_function] = (editorialFunctions[j.editorial_function] || 0) + 1;
    if (j.emotional_register) emotionalRegisters[j.emotional_register] = (emotionalRegisters[j.emotional_register] || 0) + 1;
    if (j.keepability_score != null) { keepTotal += j.keepability_score; keepCount++; }
  }

  const sorted = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

  function renderDistribution(title, data, maxItems = 6) {
    const entries = sorted(data).slice(0, maxItems);
    if (!entries.length) return '';
    const max = entries[0][1];
    return `<div class="stats-card">
      <div class="stats-card-title">${title}</div>
      ${entries.map(([label, count]) => {
        const pct = (count / max * 100).toFixed(0);
        return `<div class="stats-bar-row">
          <span class="stats-bar-label">${escHtml(label)}</span>
          <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%"></div></div>
          <span class="stats-bar-count">${count}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  let html = '';

  // Keepability score overview
  if (keepCount > 0) {
    const avg = (keepTotal / keepCount).toFixed(1);
    const highKeep = analyzed.filter(u => (u.analyses[0].output_json.keepability_score || 0) >= 7).length;
    const lowKeep = analyzed.filter(u => {
      const s = u.analyses[0].output_json.keepability_score;
      return s != null && s <= 3;
    }).length;
    html += `<div class="stats-card stats-card--highlight">
      <div class="stats-card-title">keepability</div>
      <div class="stats-score">${avg}<span class="stats-score-max">/10</span></div>
      <div class="stats-score-detail">${highKeep} keepers · ${lowKeep} cuts · ${keepCount} scored</div>
    </div>`;
  }

  html += renderDistribution('shot types', shotTypes);
  html += renderDistribution('camera movement', cameraMovements);
  html += renderDistribution('editorial function', editorialFunctions);
  html += renderDistribution('emotional register', emotionalRegisters, 8);

  if (!html) {
    section.classList.add('hidden');
    return;
  }

  grid.innerHTML = html;
  section.classList.remove('hidden');
}

// ── Shooting Calendar ──

function renderShootCalendar(units) {
  const section = document.getElementById('shoot-calendar');
  const grid = document.getElementById('shoot-calendar-grid');
  const countEl = document.getElementById('shoot-calendar-count');

  // Group clips by day using the timestamp extractor from scene detection
  const byDay = {};
  for (const u of units) {
    const ts = extractDateFromClipName(u.source_clip_name || u.sourceClipName);
    if (!ts) continue;
    const day = ts.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { clips: 0, duration: 0, analyzed: 0 };
    byDay[day].clips++;
    const dur = (u.end_seconds || 0) - (u.start_seconds || 0);
    if (dur > 0) byDay[day].duration += dur;
    if (u.analyses?.[0]) byDay[day].analyzed++;
  }

  const days = Object.keys(byDay).sort();
  if (days.length < 2) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  countEl.textContent = `${days.length} days`;

  const maxClips = Math.max(...Object.values(byDay).map(d => d.clips));

  grid.innerHTML = days.map(day => {
    const d = byDay[day];
    const intensity = Math.max(0.15, d.clips / maxClips);
    const hours = Math.floor(d.duration / 3600);
    const mins = Math.floor((d.duration % 3600) / 60);
    const durStr = hours > 0 ? `${hours}h${mins}m` : `${mins}m`;
    const label = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const weekday = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });

    return `<div class="shoot-day" style="--intensity: ${intensity}" data-day="${day}" title="${day}: ${d.clips} clips, ${durStr}">
      <div class="shoot-day-label">${weekday}</div>
      <div class="shoot-day-date">${label}</div>
      <div class="shoot-day-clips">${d.clips}</div>
      <div class="shoot-day-dur">${durStr}</div>
    </div>`;
  }).join('');

  // Click to scroll to that day's scenes
  grid.querySelectorAll('.shoot-day').forEach(el => {
    el.addEventListener('click', () => {
      const day = el.dataset.day;
      const sceneDay = document.querySelector(`.scenes-day-label`);
      // Find the scenes-day that matches this date
      const allDays = document.querySelectorAll('.scenes-day');
      for (const sd of allDays) {
        const labelText = sd.querySelector('.scenes-day-label')?.textContent || '';
        // Match by scrolling to the scenes section and hoping the day is visible
        if (labelText.includes(new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))) {
          sd.scrollIntoView({ behavior: 'smooth', block: 'start' });
          sd.classList.add('scenes-day--highlight');
          setTimeout(() => sd.classList.remove('scenes-day--highlight'), 2000);
          return;
        }
      }
      // Fallback: just scroll to scenes section
      document.getElementById('project-scenes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ── Best Clips ──

function renderBestClips(units) {
  const section = document.getElementById('best-clips');
  const grid = document.getElementById('best-clips-grid');
  const countEl = document.getElementById('best-clips-count');

  // Filter to units with keepability scores >= 6
  const scored = units
    .filter(u => u.analyses?.[0]?.output_json?.keepability_score >= 6)
    .sort((a, b) => (b.analyses[0].output_json.keepability_score) - (a.analyses[0].output_json.keepability_score))
    .slice(0, 20);

  if (scored.length < 1) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  countEl.textContent = `top ${scored.length}`;

  grid.innerHTML = scored.map(u => {
    const j = u.analyses[0].output_json;
    const text = u.analyses[0].output_text || '';
    const clipName = (u.source_clip_name || u.sourceClipName || '').replace(/_Proxy\.MP4$/i, '');
    const score = j.keepability_score;
    const scoreClass = score >= 8 ? 'best-clip-score--high' : '';

    return `<div class="best-clip-card">
      <div class="best-clip-top">
        <span class="best-clip-score ${scoreClass}">${score}/10</span>
        <span class="best-clip-name">${escHtml(clipName.replace(/^\d{8}-\d{4}-/, ''))}</span>
      </div>
      <div class="best-clip-tags">
        ${j.shot_type ? `<span class="best-clip-tag">${escHtml(j.shot_type)}</span>` : ''}
        ${j.emotional_register ? `<span class="best-clip-tag">${escHtml(j.emotional_register)}</span>` : ''}
        ${j.editorial_function ? `<span class="best-clip-tag">${escHtml(j.editorial_function)}</span>` : ''}
      </div>
      ${text ? `<div class="best-clip-text">${escHtml(text.slice(0, 150))}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Transcript Browser ──

let _transcriptFilterAC = null;

function renderTranscripts(units) {
  const section = document.getElementById('transcript-browser');
  const list = document.getElementById('transcript-list');
  const countEl = document.getElementById('transcript-count');
  const filterInput = document.getElementById('transcript-filter');

  if (_transcriptFilterAC) _transcriptFilterAC.abort();
  _transcriptFilterAC = new AbortController();

  const withTranscript = units.filter(u => u.analyses?.[0]?.output_json?.transcript_summary);
  if (withTranscript.length < 1) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  countEl.textContent = `${withTranscript.length} clips`;

  function renderList(filter) {
    const filtered = filter
      ? withTranscript.filter(u => u.analyses[0].output_json.transcript_summary.toLowerCase().includes(filter))
      : withTranscript;

    if (!filtered.length) {
      list.innerHTML = '<div class="transcript-empty">no matches</div>';
      return;
    }

    list.innerHTML = filtered.slice(0, 100).map(u => {
      const j = u.analyses[0].output_json;
      const clipName = (u.source_clip_name || '').replace(/_Proxy\.MP4$/i, '').replace(/^\d{8}-\d{4}-/, '');
      const transcript = j.transcript_summary;
      return `<div class="transcript-entry">
        <div class="transcript-entry-meta">
          <span class="transcript-entry-clip">${escHtml(clipName)}</span>
          <span class="transcript-entry-tc">${formatTc(u.start_seconds)} – ${formatTc(u.end_seconds)}</span>
        </div>
        <div class="transcript-entry-text">${escHtml(transcript)}</div>
      </div>`;
    }).join('');
  }

  renderList('');

  filterInput.addEventListener('input', () => {
    renderList(filterInput.value.trim().toLowerCase());
  }, { signal: _transcriptFilterAC.signal });
}

// ── Scene detection (client-side temporal grouping) ──

const SCENE_TEMPORAL_GAP_MINUTES = 10;

function extractDateFromClipName(name) {
  const m = name?.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]));
}

function extractCameraId(name) {
  const m = name?.match(/C(\d+)/);
  return m ? 'C' + m[1] : null;
}

function groupIntoScenes(units) {
  // Parse timestamps and sort
  const timed = units
    .map(u => ({
      ...u,
      timestamp: extractDateFromClipName(u.source_clip_name || u.sourceClipName),
      cameraId: extractCameraId(u.source_clip_name || u.sourceClipName),
    }))
    .filter(u => u.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!timed.length) return [];

  // Temporal grouping
  const scenes = [];
  let current = [timed[0]];

  for (let i = 1; i < timed.length; i++) {
    const gap = (timed[i].timestamp - current[current.length - 1].timestamp) / (1000 * 60);
    if (gap <= SCENE_TEMPORAL_GAP_MINUTES) {
      current.push(timed[i]);
    } else {
      scenes.push(current);
      current = [timed[i]];
    }
  }
  if (current.length) scenes.push(current);

  // Build scene objects with metadata enrichment
  return scenes.map(clips => {
    const start = clips[0].timestamp;
    const day = start.toISOString().slice(0, 10);
    const time = start.toISOString().slice(11, 16);
    const cameras = [...new Set(clips.map(c => c.cameraId).filter(Boolean))];
    const firstAnalysis = clips.find(c => c.analyses?.[0]?.output_text)?.analyses[0].output_text || '';

    // Aggregate structured metadata across all clips in the scene
    const emotions = {};
    const shotTypes = {};
    let keepSum = 0, keepN = 0;
    for (const c of clips) {
      const j = c.analyses?.[0]?.output_json;
      if (!j) continue;
      if (j.emotional_register) emotions[j.emotional_register] = (emotions[j.emotional_register] || 0) + 1;
      if (j.shot_type) shotTypes[j.shot_type] = (shotTypes[j.shot_type] || 0) + 1;
      if (j.keepability_score != null) { keepSum += j.keepability_score; keepN++; }
    }

    const topEmotion = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const topShot = Object.entries(shotTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const avgKeep = keepN > 0 ? (keepSum / keepN) : null;

    // Extract a usable label — skip markdown headers/preamble, find actual content
    let label = '';
    if (firstAnalysis) {
      // Strip markdown formatting and headers
      const cleaned = firstAnalysis
        .replace(/^#+\s+.*/gm, '')           // remove ## headers
        .replace(/\*\*[^*]*\*\*:?\s*/g, '')   // remove **bold labels**:
        .replace(/\*[^*]*\*\s*/g, '')         // remove *italic*
        .replace(/^(Here'?s|This|The (video|shot|scene|clip) (opens|begins|starts|shows|is))[^.]*\.\s*/i, '') // skip generic openers
        .trim();
      // Grab first real sentence
      const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
      label = (sentences[0] || cleaned.slice(0, 70)).slice(0, 70);
      // If still looks like a label/header, bail
      if (/^(what|how|why|analysis|description|shot|physical)/i.test(label)) label = '';
    }
    if (!label && topEmotion) label = `${topEmotion} · ${topShot || 'mixed'}`;
    if (!label) label = `Scene at ${time}`;

    const totalDuration = clips.reduce((sum, c) => {
      const dur = (c.end_seconds || 0) - (c.start_seconds || 0);
      return sum + (dur > 0 ? dur : 0);
    }, 0);

    return { clips, day, time, cameras: cameras.slice(0, 3), label, firstAnalysis, totalDuration, topEmotion, topShot, avgKeep };
  });
}

function renderScenes(units) {
  const section = document.getElementById('project-scenes');
  const timeline = document.getElementById('scenes-timeline');
  const countEl = document.getElementById('scenes-count');

  const scenes = groupIntoScenes(units);
  if (!scenes.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  countEl.textContent = `${scenes.length} scenes`;

  // Group by day
  const byDay = {};
  for (const scene of scenes) {
    if (!byDay[scene.day]) byDay[scene.day] = [];
    byDay[scene.day].push(scene);
  }

  timeline.innerHTML = Object.entries(byDay).sort().map(([day, dayScenes]) => {
    const totalClips = dayScenes.reduce((s, sc) => s + sc.clips.length, 0);
    const dayLabel = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    return `
      <div class="scenes-day">
        <div class="scenes-day-label">
          ${dayLabel}
          <span class="scenes-day-count">${dayScenes.length} scenes · ${totalClips} clips</span>
        </div>
        <div class="scenes-day-strip">
          ${dayScenes.map((scene, si) => {
            const sceneId = `scene-${day}-${si}`;
            // Normalize keepability: if < 1 it's 0-1 scale, multiply by 10
            const keepDisplay = scene.avgKeep != null
              ? (scene.avgKeep <= 1 ? (scene.avgKeep * 10).toFixed(1) : scene.avgKeep.toFixed(1))
              : null;
            // Clean preview: strip markdown formatting
            const cleanPreview = scene.firstAnalysis
              ? scene.firstAnalysis.replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim().slice(0, 120)
              : '';
            // Only show emotion + shot type tags, skip camera IDs
            const metaTags = [scene.topEmotion, scene.topShot].filter(Boolean);
            return `
              <div class="scene-card" data-scene-id="${sceneId}">
                <div class="scene-card-time">${scene.time}</div>
                <div class="scene-card-label">${escHtml(scene.label)}</div>
                <div class="scene-card-clips">${scene.clips.length} clip${scene.clips.length > 1 ? 's' : ''}${scene.totalDuration > 0 ? ' · ' + formatTc(scene.totalDuration) : ''}${keepDisplay != null ? ` · keep ${keepDisplay}` : ''}</div>
                <div class="scene-card-meta">${metaTags.map(t => `<span class="scene-meta-tag">${escHtml(t)}</span>`).join('')}</div>
                ${cleanPreview ? `<div class="scene-card-preview">${escHtml(cleanPreview)}</div>` : ''}
                <div class="scene-card-detail hidden" id="${sceneId}-detail">
                  ${scene.clips.slice(0, 30).map(c => {
                    const cn = (c.source_clip_name || c.sourceClipName || '').replace(/_Proxy\.MP4$/i, '');
                    const analysis = (c.analyses?.[0]?.output_text || '').replace(/\*\*[^*]*\*\*:?\s*/g, '').replace(/^#+\s+.*/gm, '').replace(/\*/g, '').trim();
                    return `<div class="scene-clip-row">
                      <span class="scene-clip-name">${escHtml(cn.replace(/^\d{8}-\d{4}-/, ''))}</span>
                      <span class="scene-clip-tc">${formatTc(c.start_seconds)} – ${formatTc(c.end_seconds)}</span>
                      ${analysis ? `<p class="scene-clip-analysis">${escHtml(analysis.slice(0, 150))}</p>` : ''}
                    </div>`;
                  }).join('')}
                  ${scene.clips.length > 30 ? `<div class="scene-clip-row" style="color:var(--np-text-dim);font-style:italic">+ ${scene.clips.length - 30} more clips</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Wire up scene card click-to-expand
  timeline.querySelectorAll('.scene-card').forEach(card => {
    card.addEventListener('click', () => {
      const detail = card.querySelector('.scene-card-detail');
      if (detail) {
        detail.classList.toggle('hidden');
        card.classList.toggle('scene-card--expanded');
      }
    });
  });
}

// ── Node diagram SVG ──

function renderHubSVG() {
  const container = document.querySelector('.training-hub-container');
  if (!container) return;

  // Remove existing SVG
  container.querySelector('.hub-svg-overlay')?.remove();

  // Don't render on mobile (flexbox layout)
  if (window.innerWidth <= 600) return;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('hub-svg-overlay');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const containerRect = container.getBoundingClientRect();

  // Hub center — the ::before circle is 48px, sits at top of flex column
  const hub = container.querySelector('.training-hub');
  const hubRect = hub.getBoundingClientRect();
  const hubCx = hubRect.left + hubRect.width / 2 - containerRect.left;
  const hubCy = hubRect.top + 24 - containerRect.top; // 24 = half of 48px circle

  // Draw lines to each spoke's dot (::before, 12px)
  container.querySelectorAll('.spoke').forEach(spoke => {
    const spokeRect = spoke.getBoundingClientRect();
    const sx = spokeRect.left + spokeRect.width / 2 - containerRect.left;
    const sy = spokeRect.top + 6 - containerRect.top; // 6 = half of 12px dot

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', hubCx);
    line.setAttribute('y1', hubCy);
    line.setAttribute('x2', sx);
    line.setAttribute('y2', sy);

    const isConnected = spoke.classList.contains('spoke--connected');
    line.setAttribute('stroke', isConnected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)');
    line.setAttribute('stroke-width', '1');
    if (!isConnected) {
      line.setAttribute('stroke-dasharray', '4 4');
    }

    svg.appendChild(line);
  });

  container.insertBefore(svg, container.firstChild);
}

function renderWaveform() {
  const container = document.querySelector('.training-hub-container');
  if (!container || container.querySelector('.hub-waveform')) return;

  const waveform = document.createElement('div');
  waveform.className = 'hub-waveform';

  const barCount = 60;
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement('div');
    bar.className = 'hub-waveform-bar';
    const height = 4 + Math.sin(i * 0.3) * 8 + Math.random() * 6;
    bar.style.height = `${height}px`;
    waveform.appendChild(bar);
  }

  container.appendChild(waveform);
}

window.addEventListener('resize', () => {
  if (currentProjectId) renderHubSVG();
});

// ── Corpus health bar ──

async function loadCorpusHealth() {
  if (isDemo) return;
  try {
    const { listAllCorpusUnits } = await import('./db.js');
    // Use the supabase client to get counts via HEAD requests
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'count=exact' };
    const [unitsRes, analysesRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/corpus_units?select=id&limit=1`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/analyses?select=id&limit=1`, { headers }),
    ]);

    const parse = (res) => { const m = (res.headers.get('content-range') || '').match(/\/(\d+)/); return m ? parseInt(m[1]) : 0; };
    const total = parse(unitsRes);
    const analyzed = parse(analysesRes);
    if (!total) return;

    const pct = ((analyzed / total) * 100).toFixed(1);
    const el = document.getElementById('corpus-health');
    if (el) {
      el.classList.remove('hidden');
      document.getElementById('corpus-health-fill').style.width = pct + '%';
      document.getElementById('corpus-health-label').textContent = `${analyzed.toLocaleString()} / ${total.toLocaleString()} analyzed (${pct}%)`;
    }
  } catch (err) {
    console.warn('[hunter] corpus health:', err);
  }
}

// ── Boot ──

// Route based on URL hash
const bootHash = window.location.hash.replace('#', '');
const topLevelViews = ['projects', 'corpus', 'script-copilot'];
if (topLevelViews.includes(bootHash)) {
  showView(bootHash);
} else if (bootHash === 'script') {
  // Alias: #script → script-copilot
  showView('script-copilot');
} else {
  showView('projects');
}
loadCorpusHealth();
setInterval(loadCorpusHealth, 60000);

// Show demo banner if in demo mode
if (isDemo) {
  const banner = document.getElementById('demo-banner');
  if (banner) banner.classList.remove('hidden');
}

// ── Clip review mode ──

let reviewMode = false;
let reviewIndex = 0;

function enterReviewMode() {
  const filtered = getFilteredCorpus();
  if (!filtered.length) return;

  reviewMode = true;
  reviewIndex = 0;

  let overlay = document.getElementById('review-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'review-overlay';
    overlay.className = 'review-overlay';
    document.body.appendChild(overlay);
  }
  overlay.classList.remove('hidden');
  renderReviewCard(filtered);
}

function exitReviewMode() {
  reviewMode = false;
  const overlay = document.getElementById('review-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function renderReviewCard(filtered) {
  const overlay = document.getElementById('review-overlay');
  if (!overlay || !filtered.length) return;

  const u = filtered[reviewIndex];
  const analysis = u.analyses?.[0];
  const j = analysis?.output_json || {};
  const clipName = (u.source_clip_name || '').replace(/_Proxy\.MP4$/i, '');
  const projectName = u.media_assets?.hunter_projects?.name || '';
  const tier = u.media_assets?.tier || '';
  const text = analysis?.output_text || '';
  const score = j.keepability_score;

  const tags = [j.shot_type, j.camera_movement, j.editorial_function, j.emotional_register, j.lighting, j.audio_quality].filter(Boolean);

  overlay.innerHTML = `
    <div class="review-card">
      <div class="review-nav">
        <span class="review-pos">${reviewIndex + 1} / ${filtered.length}</span>
        <span class="review-hint">← → navigate · esc close</span>
      </div>
      <div class="review-clip-name">${escHtml(clipName)}</div>
      <div class="review-meta">${escHtml(projectName)} / ${tier} · ${formatTc(u.start_seconds)} – ${formatTc(u.end_seconds)}</div>
      ${score != null ? `<div class="review-score ${score >= 7 ? 'review-score--high' : score <= 3 ? 'review-score--low' : ''}">keepability: ${score}/10</div>` : ''}
      <div class="review-tags">${tags.map(t => `<span class="review-tag">${escHtml(t)}</span>`).join('')}</div>
      ${text ? `<div class="review-text">${escHtml(text)}</div>` : ''}
      ${j.visual_description ? `<div class="review-visual"><strong>visual:</strong> ${escHtml(j.visual_description)}</div>` : ''}
      ${j.transcript_summary ? `<div class="review-transcript"><strong>transcript:</strong> ${escHtml(j.transcript_summary)}</div>` : ''}
      <button class="np-button np-button--ghost review-similar-btn" id="review-find-similar" data-unit-id="${u.id}">find similar clips</button>
      <div class="review-similar-results" id="review-similar-results"></div>
    </div>
  `;

  // Wire up find similar button
  document.getElementById('review-find-similar')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const unitId = btn.dataset.unitId;
    const resultsEl = document.getElementById('review-similar-results');
    btn.textContent = 'searching...';
    btn.disabled = true;
    try {
      const similar = await findSimilarClips(unitId, 8);
      if (!similar.length) {
        resultsEl.innerHTML = '<div class="review-similar-empty">no similar clips found</div>';
        return;
      }
      resultsEl.innerHTML = similar.map(s => {
        const cn = (s.clip_name || '').replace(/_Proxy\.MP4$/i, '').replace(/^\d{8}-\d{4}-/, '');
        const simPct = (s.similarity * 100).toFixed(0);
        return `<div class="review-similar-item">
          <span class="review-similar-score">${simPct}%</span>
          <div class="review-similar-info">
            <span class="review-similar-name">${escHtml(cn)}</span>
            <span class="review-similar-meta">${escHtml(s.project_name || '')} / ${s.tier || ''}</span>
            ${s.analysis_preview ? `<span class="review-similar-preview">${escHtml(s.analysis_preview.slice(0, 120))}</span>` : ''}
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      resultsEl.innerHTML = `<div class="review-similar-empty">${escHtml(err.message)}</div>`;
    } finally {
      btn.textContent = 'find similar clips';
      btn.disabled = false;
    }
  });

  // Highlight current item in the grid
  document.querySelectorAll('.corpus-grid-item').forEach((el, i) => {
    el.classList.toggle('corpus-grid-item--active', i === reviewIndex % CORPUS_PAGE_SIZE);
  });
}

// ── Global keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

  // Review mode navigation
  if (reviewMode) {
    const filtered = getFilteredCorpus();
    if (e.key === 'Escape') { exitReviewMode(); return; }
    if (e.key === 'ArrowRight' || e.key === 'j') {
      reviewIndex = Math.min(reviewIndex + 1, filtered.length - 1);
      // Auto-paginate if needed
      const neededPage = Math.floor(reviewIndex / CORPUS_PAGE_SIZE);
      if (neededPage !== corpusPage) { corpusPage = neededPage; renderCorpusPage(); }
      renderReviewCard(filtered);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'k') {
      reviewIndex = Math.max(reviewIndex - 1, 0);
      const neededPage = Math.floor(reviewIndex / CORPUS_PAGE_SIZE);
      if (neededPage !== corpusPage) { corpusPage = neededPage; renderCorpusPage(); }
      renderReviewCard(filtered);
      return;
    }
    return;
  }

  // Escape closes modals and goes back
  if (e.key === 'Escape') {
    const inputModal = document.getElementById('input-modal');
    const newProjectModal = document.querySelector('.modal-overlay');
    const shortcutOverlay = document.getElementById('shortcut-overlay');
    if (shortcutOverlay && !shortcutOverlay.classList.contains('hidden')) {
      shortcutOverlay.classList.add('hidden');
    } else if (inputModal && !inputModal.classList.contains('hidden')) {
      document.getElementById('input-modal-cancel')?.click();
    } else if (newProjectModal) {
      newProjectModal.remove();
    } else if (currentView === 'project') {
      document.getElementById('btn-back-projects')?.click();
    }
  }

  if (isInput) return;

  // ? = show keyboard shortcuts
  if (e.key === '?') {
    toggleShortcutOverlay();
  }

  // / = focus search (project or corpus)
  if (e.key === '/') {
    e.preventDefault();
    const projectSearch = document.getElementById('project-search-input');
    const corpusSearch = document.getElementById('corpus-search-input');
    if (currentView === 'project' && projectSearch) {
      projectSearch.focus();
      projectSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (currentView === 'corpus' && corpusSearch) {
      corpusSearch.focus();
    }
  }

  // Keyboard nav: 1 = projects, 2 = corpus
  if (e.key === '1' && !e.ctrlKey && !e.metaKey) showView('projects');
  if (e.key === '2' && !e.ctrlKey && !e.metaKey) showView('corpus');

  // i = jump to insights hub
  if (e.key === 'i' && currentView === 'project') {
    document.getElementById('insights-hub')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // s = jump to scenes section
  if (e.key === 's' && currentView === 'project') {
    document.getElementById('project-scenes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // t = jump to transcripts
  if (e.key === 't' && currentView === 'project') {
    document.getElementById('transcript-browser')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // o = jump to observations
  if (e.key === 'o' && currentView === 'project') {
    document.getElementById('project-patterns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // c = jump to corpus
  if (e.key === 'c' && currentView === 'project') {
    document.getElementById('project-corpus')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // r = enter review mode (corpus view)
  if (e.key === 'r' && currentView === 'corpus' && !reviewMode) {
    enterReviewMode();
  }
});

function toggleShortcutOverlay() {
  let overlay = document.getElementById('shortcut-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'shortcut-overlay';
    overlay.className = 'shortcut-overlay';
    overlay.innerHTML = `
      <div class="shortcut-card">
        <div class="shortcut-title">keyboard shortcuts</div>
        <div class="shortcut-grid">
          <kbd>?</kbd><span>show shortcuts</span>
          <kbd>/</kbd><span>focus search</span>
          <kbd>1</kbd><span>projects view</span>
          <kbd>2</kbd><span>corpus view</span>
          <kbd>i</kbd><span>jump to insights hub</span>
          <kbd>s</kbd><span>jump to scenes</span>
          <kbd>t</kbd><span>jump to transcripts</span>
          <kbd>c</kbd><span>jump to corpus</span>
          <kbd>o</kbd><span>jump to observations</span>
          <kbd>r</kbd><span>review clips (corpus)</span>
          <kbd>esc</kbd><span>back / close</span>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
    document.body.appendChild(overlay);
  } else {
    overlay.classList.toggle('hidden');
  }
}

console.log('[hunter] booted', isConfigured() ? '(db connected)' : '(no db)', isDemo ? '(demo mode)' : '');
