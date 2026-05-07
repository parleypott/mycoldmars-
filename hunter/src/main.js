import { isConfigured, listProjects, createProject, getProject, listMediaAssets, listCorpusUnitsForProject, listPatternObservations, updatePatternStatus, listAllCorpusUnits, getIngestStatus, semanticSearch, findSimilarClips, fetchSceneInsights, chatWithFootage, fetchTierComparison } from './db.js';

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
    initCorpusSearch();
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

  // Show loading state
  const header = document.getElementById('project-header');
  header.innerHTML = '<div class="project-loading">loading project...</div>';

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

  const statsLine = totalUnits > 0
    ? `${analyzedUnits} analyzed of ${totalUnits} units`
    : `${assets.length} sources`;

  // Build progress bars HTML
  const TIER_LABELS = { raw: 'raw', selects: 'selects', google_docs: 'script', finished: 'finished' };
  let progressHtml = '';
  const tierEntries = Object.entries(tierStats).filter(([, s]) => s.total > 0);
  if (tierEntries.length > 0) {
    progressHtml = '<div class="tier-progress">' + tierEntries.map(([tier, s]) => {
      const pct = s.total > 0 ? (s.analyzed / s.total * 100) : 0;
      const fillClass = pct >= 100 ? 'tier-progress-fill tier-progress-fill--complete' : 'tier-progress-fill';
      return `<div class="tier-progress-row">
        <span class="tier-progress-label">${TIER_LABELS[tier] || tier}</span>
        <div class="tier-progress-bar"><div class="${fillClass}" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="tier-progress-count">${s.analyzed}/${s.total}</span>
      </div>`;
    }).join('') + '</div>';
  }

  header.innerHTML = `<h2>${escHtml(project.name)}</h2><div class="project-stats">${statsLine}</div>${progressHtml}`;

  // Update training hub
  document.getElementById('hub-project-name').textContent = project.name;

  // Render spoke content + connection state
  const TIER_SPOKE = { raw: 'raw', script: 'script', selects: 'selects', finished: 'finished', google_docs: 'docs' };
  let connectedCount = 0;

  for (const [tier, spokeId] of Object.entries(TIER_SPOKE)) {
    const spoke = document.querySelector(`.spoke--${spokeId}`);
    const content = document.getElementById(`spoke-${spokeId}-content`);
    const tierAssets = assets.filter(a => a.tier === tier);

    if (tierAssets.length > 0) {
      spoke.classList.add('spoke--connected');
      connectedCount++;
      content.innerHTML = renderSpokePreview(tier, tierAssets);
    } else {
      spoke.classList.remove('spoke--connected');
      content.innerHTML = '';
    }
  }

  document.getElementById('hub-status').textContent = `${connectedCount}/5`;
  // Render node diagram SVG + waveform after layout settles
  setTimeout(() => { renderHubSVG(); renderWaveform(); }, 100);

  // Render tier funnel
  renderTierFunnel(tierStats);

  // Render project stats dashboard
  renderProjectStats(units);

  // Render shooting calendar
  renderShootCalendar(units);

  // Render insights hub
  renderInsightsHub(units, assets);

  // Render best clips
  renderBestClips(units);

  // Render scenes timeline
  renderScenes(units);

  // Render transcripts
  renderTranscripts(units);

  // Init project search
  initProjectSearch();

  // Render corpus units with expandable text
  const unitsList = document.getElementById('corpus-units-list');
  if (units.length > 0) {
    unitsList.innerHTML = units.map((u, i) => {
      const analysis = u.analyses?.[0];
      const fullText = analysis ? analysis.output_text : '';
      const isTruncatable = fullText.length > 200;
      const startSec = u.start_seconds ?? u.startSeconds ?? 0;
      const endSec = u.end_seconds ?? u.endSeconds ?? 0;
      const clipName = u.source_clip_name || u.sourceClipName || '';
      const badges = renderAnalysisBadges(analysis?.output_json);
      return `
        <div class="corpus-unit">
          <span class="corpus-unit-tc">${formatTc(startSec)} – ${formatTc(endSec)}${clipName ? '<br>' + escHtml(clipName) : ''}</span>
          <div>
            <span class="corpus-unit-desc${isTruncatable ? ' truncated' : ''}" data-unit="${i}">${fullText ? escHtml(fullText) : '<em>pending analysis</em>'}</span>
            ${isTruncatable ? `<button class="corpus-unit-expand" data-unit="${i}">read more</button>` : ''}
            ${badges}
          </div>
        </div>
      `;
    }).join('');

    unitsList.querySelectorAll('.corpus-unit-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const desc = unitsList.querySelector(`.corpus-unit-desc[data-unit="${btn.dataset.unit}"]`);
        const isExpanded = desc.classList.toggle('expanded');
        desc.classList.toggle('truncated', !isExpanded);
        btn.textContent = isExpanded ? 'collapse' : 'read more';
      });
    });
  } else {
    unitsList.innerHTML = '<p class="empty-sub">no units analyzed yet</p>';
  }

  // Render patterns
  const patternsList = document.getElementById('patterns-list');
  if (patterns.length > 0) {
    patternsList.innerHTML = patterns.map(p => {
      const date = p.created_at ? new Date(p.created_at) : null;
      const timeAgo = date ? formatTimeAgo(date) : '';
      return `
      <div class="pattern-card ${p.status !== 'surfaced' ? 'pattern-card--' + p.status : ''}" data-id="${p.id}">
        <div class="pattern-meta">
          <span class="pattern-status">${p.status}</span>
          ${timeAgo ? `<span class="pattern-time">${timeAgo}</span>` : ''}
        </div>
        <div class="pattern-text">${simpleMarkdown(p.observation_text)}</div>
        <button class="pattern-expand">show more</button>
        <div class="pattern-actions">
          <button class="np-button pattern-btn" data-action="accepted" data-id="${p.id}">accept</button>
          <button class="np-button pattern-btn" data-action="ignored" data-id="${p.id}">ignore</button>
        </div>
      </div>
    `;}).join('');

    // Detect overflow and add expand/collapse
    patternsList.querySelectorAll('.pattern-card').forEach(card => {
      const text = card.querySelector('.pattern-text');
      const btn = card.querySelector('.pattern-expand');
      if (text.scrollHeight > 310) {
        card.classList.add('truncated');
        btn.addEventListener('click', () => {
          const expanded = text.classList.toggle('expanded');
          btn.textContent = expanded ? 'show less' : 'show more';
        });
      }
    });

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
      const scenesPayload = scenes.map(s => ({
        label: s.label,
        day: s.day,
        time: s.time,
        clipCount: s.clips.length,
        clips: s.clips.map(c => ({
          clipName: c.source_clip_name || c.sourceClipName || '',
          startSeconds: c.start_seconds ?? c.startSeconds ?? 0,
          endSeconds: c.end_seconds ?? c.endSeconds ?? 0,
          analysisText: c.analyses?.[0]?.output_text || '',
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

document.getElementById('btn-export-xml').addEventListener('click', async () => {
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

const SCENE_TEMPORAL_GAP_MINUTES = 30;

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

    // Richer label: use first analysis sentence, or fallback to metadata
    let label = firstAnalysis.split(/[.!?]/)[0]?.slice(0, 60) || '';
    if (!label && topEmotion) label = `${topEmotion} · ${topShot || 'mixed'}`;
    if (!label) label = `Scene at ${time}`;

    const totalDuration = clips.reduce((sum, c) => {
      const dur = (c.end_seconds || 0) - (c.start_seconds || 0);
      return sum + (dur > 0 ? dur : 0);
    }, 0);

    return { clips, day, time, cameras, label, firstAnalysis, totalDuration, topEmotion, topShot, avgKeep };
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
            const clipNames = scene.clips.map(c => (c.source_clip_name || c.sourceClipName || '').replace(/_Proxy\.MP4$/i, ''));
            const sceneId = `scene-${day}-${si}`;
            return `
              <div class="scene-card" data-scene-id="${sceneId}">
                <div class="scene-card-time">${scene.time}</div>
                <div class="scene-card-label">${escHtml(scene.label)}</div>
                <div class="scene-card-clips">${scene.clips.length} clip${scene.clips.length > 1 ? 's' : ''}${scene.totalDuration > 0 ? ' · ' + formatTc(scene.totalDuration) : ''}${scene.avgKeep != null ? ` · keep ${scene.avgKeep.toFixed(1)}` : ''}</div>
                <div class="scene-card-meta">${[scene.topEmotion, scene.topShot, ...scene.cameras].filter(Boolean).map(t => `<span class="scene-meta-tag">${escHtml(t)}</span>`).join('')}</div>
                ${scene.firstAnalysis ? `<div class="scene-card-preview">${escHtml(scene.firstAnalysis.slice(0, 120))}</div>` : ''}
                <div class="scene-card-detail hidden" id="${sceneId}-detail">
                  ${scene.clips.map(c => {
                    const cn = (c.source_clip_name || c.sourceClipName || '').replace(/_Proxy\.MP4$/i, '');
                    const analysis = c.analyses?.[0]?.output_text || '';
                    return `<div class="scene-clip-row">
                      <span class="scene-clip-name">${escHtml(cn.replace(/^\d{8}-\d{4}-/, ''))}</span>
                      <span class="scene-clip-tc">${formatTc(c.start_seconds)} – ${formatTc(c.end_seconds)}</span>
                      ${analysis ? `<p class="scene-clip-analysis">${escHtml(analysis.slice(0, 150))}</p>` : ''}
                    </div>`;
                  }).join('')}
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

showView('projects');
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
