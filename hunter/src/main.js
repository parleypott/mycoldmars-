import { isConfigured, listProjects, createProject, getProject, listMediaAssets, listCorpusUnitsForProject, listPatternObservations, updatePatternStatus, listAllCorpusUnits, getIngestStatus } from './db.js';

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
    { id: 'u1', start_seconds: 0, end_seconds: 45, source_clip_name: 'A001_C003.mp4', analyses: [{ output_text: 'Wide establishing shot of empty desert highway at golden hour. The road cuts through undulating sand dunes, perfectly straight to the vanishing point. No vehicles, no people — just the geometry of human infrastructure against geological time. Warm amber light catches the rippled texture of sand. The composition is symmetrical, almost devotional. This is a patience shot — it teaches the viewer to slow down before the story begins.' }] },
    { id: 'u2', start_seconds: 45, end_seconds: 112, source_clip_name: 'A001_C007.mp4', analyses: [{ output_text: 'Johnny walks through a narrow souk corridor, camera following from behind at shoulder height. Vendors call out in Arabic. The light shifts dramatically every few steps — blazing sun through gaps in corrugated roofing, then deep shadow. Johnny pauses at a spice stall, reaches toward a mound of saffron. His hand hesitates. This moment of almost-touching is deeply characteristic — the camera catches curiosity in the body before words arrive.' }] },
    { id: 'u3', start_seconds: 112, end_seconds: 180, source_clip_name: 'A001_C012.mp4', analyses: [{ output_text: 'Close-up on weathered hands pouring Arabic coffee from a brass dallah into tiny ceramic cups. The pour is ceremonial, unhurried. Steam rises into late-afternoon light. The camera holds on the hands alone for 15 seconds before pulling back to reveal the face of the elderly host. This patience with detail before context is a recurring editorial instinct.' }] },
  ],
  'demo-2': [
    { id: 'u4', start_seconds: 0, end_seconds: 38, source_clip_name: 'B002_C001.mp4', analyses: [{ output_text: 'Underwater wide shot. The camera descends through turquoise water toward a coral shelf. Visibility is extraordinary — perhaps 40 meters. Small fish scatter as a manta ray enters from the upper right, its wingspan filling the frame. The filmmaker lets the ray dominate the composition entirely, not chasing it. There is a philosophical patience here: the camera trusts the subject will be interesting if given room.' }] },
    { id: 'u5', start_seconds: 38, end_seconds: 94, source_clip_name: 'B002_C005.mp4', analyses: [{ output_text: 'Johnny sits in a traditional Palauan bai (meeting house), the camera at a low angle looking up. Carved storyboard reliefs cover the walls behind him. He listens to an elder speaking in Palauan. The filmmaker captures a rare vulnerability — Johnny is out of his depth linguistically, and his body language shifts from interviewer to student. The carved histories on the wall dwarf both figures.' }] },
    { id: 'u6', start_seconds: 94, end_seconds: 142, source_clip_name: 'B002_C009.mp4', analyses: [{ output_text: 'Slow tracking shot along a deserted beach at dawn. Debris line — coconut husks, plastic bottles, driftwood. The camera follows the debris line like a text, reading it left to right. A single hermit crab navigates the refuse. The shot holds on the crab for an almost uncomfortable duration (22 seconds). This is habitat as character: the beach tells its own story about human impact without a single word.' }] },
  ],
  'demo-3': [
    { id: 'u7', start_seconds: 0, end_seconds: 52, source_clip_name: 'C003_C001.mp4', analyses: [{ output_text: 'Overhead drone shot pulling back from a single night market stall. Neon signs in Mandarin. Steam rises from a grill in organized columns. The pullback reveals the market as a dense grid of light — hundreds of stalls creating a galaxy-like pattern when seen from above. The transition from intimate (one stall) to vast (entire market) happens in a single unbroken move. A signature scale shift.' }] },
    { id: 'u8', start_seconds: 52, end_seconds: 118, source_clip_name: 'C003_C004.mp4', analyses: [{ output_text: 'Handheld at eye level, moving through the crowd. The camera is in the stream of people, not observing from outside. Focus racks between faces — a child eating shaved ice, a vendor counting change, teenagers taking selfies. The audio is dense: sizzling oil, Mandarin pop music, motorbike engines. No attempt to isolate a single story thread. This is immersion as editorial technique: the chaos IS the subject.' }] },
    { id: 'u9', start_seconds: 118, end_seconds: 165, source_clip_name: 'C003_C008.mp4', analyses: [{ output_text: 'Close-up: a hand operates a traditional Taiwanese puppet, carved and painted. The puppet casts a shadow on a backlit screen. Another hand enters with a second puppet. The shadows tell a story the camera cannot fully follow (it is in Hokkien). The filmmaker stays on the shadow play rather than cutting to the puppeteer — choosing the imagined world over the real one. A sophisticated editorial instinct about where meaning lives.' }] },
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
  startIngestPolling();

  let project, assets, units, patterns;

  if (isDemo) {
    project = DEMO_PROJECTS.find(p => p.id === id) || { name: 'Unknown' };
    assets = DEMO_ASSETS[id] || [];
    units = DEMO_UNITS[id] || [];
    patterns = DEMO_PATTERNS[id] || [];
  } else {
    project = await getProject(id);
    assets = await listMediaAssets(id);
    units = await listCorpusUnitsForProject(id);
    patterns = await listPatternObservations(id);
  }

  const header = document.getElementById('project-header');
  const totalUnits = units.length;
  const analyzedUnits = units.filter(u => u.analyses?.length > 0).length;
  const statsLine = totalUnits > 0 ? `${analyzedUnits} analyzed · ${assets.length} sources` : `${assets.length} sources`;
  header.innerHTML = `<h2>${escHtml(project.name)}</h2><div class="project-stats">${statsLine}</div>`;

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
      return `
        <div class="corpus-unit">
          <span class="corpus-unit-tc">${formatTc(startSec)} – ${formatTc(endSec)}${clipName ? '<br>' + escHtml(clipName) : ''}</span>
          <div>
            <span class="corpus-unit-desc${isTruncatable ? ' truncated' : ''}" data-unit="${i}">${fullText ? escHtml(fullText) : '<em>pending analysis</em>'}</span>
            ${isTruncatable ? `<button class="corpus-unit-expand" data-unit="${i}">read more</button>` : ''}
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
    // Merge all demo units across all projects
    units = [];
    for (const [pid, projectUnits] of Object.entries(DEMO_UNITS)) {
      const proj = DEMO_PROJECTS.find(p => p.id === pid);
      for (const u of projectUnits) {
        units.push({
          ...u,
          media_assets: { project_id: pid, tier: 'raw', hunter_projects: { name: proj?.name || 'unknown' } },
        });
      }
    }
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

// ── Boot ──

showView('projects');

// Show demo banner if in demo mode
if (isDemo) {
  const banner = document.getElementById('demo-banner');
  if (banner) banner.classList.remove('hidden');
}

// ── Global keyboard shortcuts ──

document.addEventListener('keydown', (e) => {
  // Escape closes modals and goes back
  if (e.key === 'Escape') {
    const inputModal = document.getElementById('input-modal');
    const newProjectModal = document.getElementById('new-project-modal');
    if (inputModal && !inputModal.classList.contains('hidden')) {
      document.getElementById('input-modal-cancel')?.click();
    } else if (newProjectModal && !newProjectModal.classList.contains('hidden')) {
      document.getElementById('cancel-project')?.click();
    } else if (currentView === 'project') {
      document.getElementById('btn-back-projects')?.click();
    }
  }

  // Keyboard nav: 1 = projects, 2 = corpus
  if (e.key === '1' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
    showView('projects');
  }
  if (e.key === '2' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
    showView('corpus');
  }
});

console.log('[hunter] booted', isConfigured() ? '(db connected)' : '(no db)', isDemo ? '(demo mode)' : '');
