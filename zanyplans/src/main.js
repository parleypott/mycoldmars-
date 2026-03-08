import { spaces, mediaManifest } from './spaces.js';
import { createGridCollage, destroyGridCollage } from './grid-collage.js';
import { createGridGallery, destroyGridGallery } from './grid-gallery.js';
import { createWheel, destroyWheel } from './wheel.js';
import { initEffects, applyEffect, clearEffect, destroyEffects } from './effects.js';
import './style.css';

const app = document.getElementById('app');
let currentCleanup = null;
let currentMode = 'gallery'; // 'gallery' (default) or 'blinds'
let currentSlug = null;

function getMediaType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'webm'].includes(ext)) return 'video';
  if (ext === 'gif') return 'gif';
  return 'image';
}

function getMediaForSpace(slug) {
  const files = mediaManifest[slug] || [];
  if (files.length > 0) {
    return files.map(f => ({
      src: `/zanyplans/spaces/${slug}/${f}`,
      type: getMediaType(f),
      label: f
    }));
  }
  // Generate placeholders
  const palettes = {
    void: [220, 260],
    memories: [0, 30],
  };
  const [hueMin, hueMax] = palettes[slug] || [0, 360];
  return Array.from({ length: 12 }, (_, i) => ({
    src: null,
    type: 'placeholder',
    color: `hsl(${hueMin + ((hueMax - hueMin) * i / 12)}, 50%, ${15 + Math.random() * 20}%)`,
    label: `${slug.toUpperCase()}_${String(i).padStart(3, '0')}.DAT`
  }));
}

// ═══════════════════════════════════════════
// HOMEPAGE
// ═══════════════════════════════════════════

function renderHome() {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }
  currentSlug = null;
  app.innerHTML = '';
  app.className = 'home';

  // Subtitle (above title)
  const subtitle = document.createElement('p');
  subtitle.className = 'home-subtitle';
  subtitle.textContent = 'SELECT A SPACE';
  app.appendChild(subtitle);

  // Title
  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = 'ZANY PLANS';
  app.appendChild(title);

  // Navigation — vertical text links
  const nav = document.createElement('nav');
  nav.className = 'home-nav';
  spaces.forEach(space => {
    const link = document.createElement('button');
    link.className = 'home-link';
    link.textContent = space.name;
    link.addEventListener('click', () => {
      location.hash = `/space/${space.slug}`;
    });
    nav.appendChild(link);
  });
  app.appendChild(nav);

  // ── Print registration marks ──
  const mk = (cls, style) => {
    const el = document.createElement('div');
    el.className = `pm ${cls}`;
    Object.assign(el.style, style);
    app.appendChild(el);
    return el;
  };

  // 4 corner crop marks
  mk('pm-crop pm-crop-tl', {});
  mk('pm-crop pm-crop-tr', {});
  mk('pm-crop pm-crop-bl', {});
  mk('pm-crop pm-crop-br', {});

  // Crosshairs — scattered
  mk('pm-cross', { top: '28px', left: '50%', transform: 'translateX(-50%)' });
  mk('pm-cross', { bottom: '28px', left: '50%', transform: 'translateX(-50%)' });
  mk('pm-cross', { top: '50%', left: '28px', transform: 'translateY(-50%)' });
  mk('pm-cross', { top: '50%', right: '28px', transform: 'translateY(-50%)' });
  mk('pm-cross', { top: '18%', left: '22%' });
  mk('pm-cross', { top: '75%', right: '18%' });
  mk('pm-cross', { bottom: '22%', left: '40%' });

  // Targets ⊕ — various positions
  mk('pm-target', { top: '14%', left: '12%' });
  mk('pm-target', { top: '12%', right: '14%' });
  mk('pm-target', { bottom: '15%', right: '10%' });
  mk('pm-target', { bottom: '18%', left: '8%' });
  mk('pm-target-sm', { top: '16%', left: '16%' });
  mk('pm-target-sm', { top: '10%', right: '22%' });
  mk('pm-target-sm', { bottom: '12%', left: '20%' });
  mk('pm-target-sm', { bottom: '10%', right: '25%' });
  mk('pm-target-sm', { top: '38%', right: '8%' });

  // Halftone dots
  mk('pm-dot', { top: '13%', left: '9%' });
  mk('pm-dot-sm', { top: '20%', left: '14%' });
  mk('pm-dot-sm', { bottom: '25%', right: '12%' });
  mk('pm-dot-sm', { top: '30%', left: '6%' });
  mk('pm-dot-sm', { bottom: '35%', right: '6%' });

  // Thin horizontal rules
  mk('pm-rule-h', { top: '12%', left: '4%', width: '45px' });
  mk('pm-rule-h', { top: '12%', right: '4%', width: '45px' });
  mk('pm-rule-h', { bottom: '12%', left: '4%', width: '45px' });
  mk('pm-rule-h', { bottom: '12%', right: '4%', width: '45px' });
  mk('pm-rule-h', { top: '30%', left: '6%', width: '30px' });
  mk('pm-rule-h', { top: '70%', right: '6%', width: '30px' });
  mk('pm-rule-h', { top: '50%', left: '5%', width: '20px' });
  mk('pm-rule-h', { top: '50%', right: '5%', width: '20px' });

  // Thin vertical rules
  mk('pm-rule-v', { top: '4%', left: '12%', height: '45px' });
  mk('pm-rule-v', { top: '4%', right: '12%', height: '45px' });
  mk('pm-rule-v', { bottom: '4%', left: '12%', height: '45px' });
  mk('pm-rule-v', { bottom: '4%', right: '12%', height: '45px' });
  mk('pm-rule-v', { top: '25%', left: '4%', height: '20px' });
  mk('pm-rule-v', { bottom: '25%', right: '4%', height: '20px' });

  // Small text labels
  const lbl = (text, style) => {
    const el = mk('pm-label', style);
    el.textContent = text;
  };
  lbl('CMYK', { top: '8%', left: '5%' });
  lbl('100%', { top: '10%', left: '5%' });
  lbl('K', { top: '8%', left: '10%' });
  lbl('PROCESS', { top: '8%', right: '5%' });
  lbl('PROOF', { bottom: '8%', right: '5%' });
  lbl('01', { bottom: '6%', left: '5%' });
  lbl('A4', { bottom: '8%', left: '5%' });
  lbl('2026', { top: '6%', right: '12%' });
  lbl('OFFSET', { bottom: '6%', right: '12%' });
  lbl('REG', { top: '18%', right: '6%' });
  lbl('TRIM', { bottom: '18%', left: '6%' });
  lbl('NO. 1', { top: '35%', left: '4%' });
  lbl('ZANY', { bottom: '35%', right: '4%' });

  // Small black rectangles
  mk('pm-rect', { top: '9%', left: '8%', width: '12px', height: '4px' });
  mk('pm-rect', { bottom: '9%', right: '8%', width: '12px', height: '4px' });
  mk('pm-rect', { top: '22%', right: '5%', width: '8px', height: '3px' });
  mk('pm-rect', { bottom: '22%', left: '5%', width: '8px', height: '3px' });
  mk('pm-rect', { top: '40%', left: '3%', width: '16px', height: '5px' });

  // CMYK color bar (top-left cluster)
  const bar = mk('pm-color-bar', { top: '11%', left: '8%' });
  ['#00aeef','#ec008c','#fff200','#1a1a1a'].forEach(c => {
    const s = document.createElement('span');
    s.style.background = c;
    bar.appendChild(s);
  });

  // Second color bar (bottom-right area)
  const bar2 = mk('pm-color-bar', { bottom: '11%', right: '8%' });
  ['#1a1a1a','#fff200','#ec008c','#00aeef'].forEach(c => {
    const s = document.createElement('span');
    s.style.background = c;
    bar2.appendChild(s);
  });
}

// ═══════════════════════════════════════════
// EDITORIAL OVERLAY
// ═══════════════════════════════════════════

function buildEditorialContent() {
  const blocks = [
    // Top left — large vertical title
    `<div class="ed-block ed-vert" style="top:6%;left:5%;font-size:clamp(28px,4vw,48px);letter-spacing:0.15em;opacity:0.85">夜市散策</div>`,
    // Top right — issue number
    `<div class="ed-block" style="top:5%;right:6%;font-size:9px;letter-spacing:0.3em;opacity:0.5;font-family:'DM Sans',sans-serif">NO. 47 — 2026</div>`,
    // Horizontal rule top
    `<div class="ed-rule-h" style="top:10%;left:4%;width:40%"></div>`,
    `<div class="ed-rule-h" style="top:10%;right:4%;width:20%"></div>`,
    // Section header
    `<div class="ed-block" style="top:12%;left:5%;font-size:clamp(14px,2vw,22px);opacity:0.7">特集</div>`,
    `<div class="ed-block" style="top:12%;left:12%;font-size:9px;opacity:0.35;font-family:'DM Sans',sans-serif;letter-spacing:0.2em">FEATURE</div>`,
    // Large title block
    `<div class="ed-block" style="top:16%;left:5%;font-size:clamp(22px,3.5vw,42px);line-height:1.5;opacity:0.9">台灣夜市<br>美食紀行</div>`,
    // Small body text left
    `<div class="ed-block ed-body" style="top:28%;left:5%;width:35%;opacity:0.3">夜市は台湾の文化の中心であり、地元の人々と観光客が集まる場所です。屋台の明かりが通りを照らし、様々な料理の香りが漂います。</div>`,
    // Vertical rule
    `<div class="ed-rule-v" style="top:12%;left:48%;height:35%"></div>`,
    // Right column — contents
    `<div class="ed-block" style="top:12%;right:5%;font-size:8px;letter-spacing:0.25em;opacity:0.4;font-family:'DM Sans',sans-serif">CONTENTS</div>`,
    `<div class="ed-block ed-contents" style="top:16%;right:5%;text-align:right;opacity:0.55">
      <span class="ed-num">01</span> 臭豆腐の誘惑<br>
      <span class="ed-num">02</span> 珍珠奶茶物語<br>
      <span class="ed-num">03</span> 蚵仔煎の技法<br>
      <span class="ed-num">04</span> 夜の光と影<br>
      <span class="ed-num">05</span> 鹽酥雞散歩<br>
      <span class="ed-num">06</span> 市場の記憶
    </div>`,
    // Mid horizontal rule
    `<div class="ed-rule-h" style="top:50%;left:8%;width:84%"></div>`,
    // Bottom left — large kanji
    `<div class="ed-block ed-vert" style="bottom:8%;left:3%;font-size:clamp(36px,5vw,64px);opacity:0.7;letter-spacing:0.2em">食文化</div>`,
    // Bottom section
    `<div class="ed-block" style="bottom:35%;left:12%;font-size:clamp(16px,2.5vw,28px);opacity:0.65">街角の味覚</div>`,
    `<div class="ed-block ed-body" style="bottom:22%;left:12%;width:30%;opacity:0.25">深夜の市場を歩けば、そこには生きた文化がある。煙と蒸気の向こうに見える笑顔。</div>`,
    // Bottom right column
    `<div class="ed-block ed-vert" style="bottom:12%;right:8%;font-size:clamp(18px,2.5vw,30px);opacity:0.6;letter-spacing:0.12em">市場物語</div>`,
    `<div class="ed-block" style="bottom:6%;right:5%;font-size:8px;opacity:0.35;font-family:'DM Sans',sans-serif;letter-spacing:0.2em">NIGHT MARKET STORIES</div>`,
    // Scattered decorative elements
    `<div class="ed-rule-h" style="bottom:40%;right:6%;width:25%"></div>`,
    `<div class="ed-rule-v" style="bottom:8%;right:35%;height:30%"></div>`,
    `<div class="ed-block" style="top:45%;left:5%;font-size:7px;opacity:0.25;font-family:'DM Sans',sans-serif;letter-spacing:0.4em">PHOTOGRAPHY</div>`,
    `<div class="ed-block" style="top:55%;right:8%;font-size:clamp(12px,1.8vw,20px);opacity:0.5">香りと記憶</div>`,
    `<div class="ed-block ed-body" style="top:59%;right:8%;width:25%;opacity:0.2;text-align:right">味わいの中に故郷がある。一口ごとに、遠い夜の記憶が蘇る。</div>`,
    // Page numbers
    `<div class="ed-block" style="bottom:4%;left:50%;transform:translateX(-50%);font-size:8px;opacity:0.3;font-family:'DM Sans',sans-serif;letter-spacing:0.15em">— 14 —</div>`,
    // Extra vertical text
    `<div class="ed-block ed-vert" style="top:40%;left:50%;font-size:clamp(11px,1.5vw,16px);opacity:0.35;letter-spacing:0.3em">遊歩道</div>`,
  ];
  return blocks.join('\n');
}

// ═══════════════════════════════════════════
// SPACE PAGE
// ═══════════════════════════════════════════

function renderSpace(slug, mode) {
  if (currentCleanup) { currentCleanup(); currentCleanup = null; }

  const space = spaces.find(s => s.slug === slug);
  if (!space) { renderHome(); return; }

  currentSlug = slug;
  currentMode = mode || currentMode;

  app.innerHTML = '';
  app.className = 'space';

  // Back button
  const back = document.createElement('button');
  back.className = 'back-btn';
  back.textContent = '\u2190 BACK';
  back.addEventListener('click', () => { location.hash = ''; });
  app.appendChild(back);

  // Title
  const title = document.createElement('div');
  title.className = 'space-title';
  title.textContent = space.name;
  app.appendChild(title);

  // Mode toggle button
  const modeBtn = document.createElement('button');
  modeBtn.className = 'mode-btn';
  modeBtn.textContent = currentMode === 'gallery' ? 'BLINDS' : 'GALLERY';
  modeBtn.addEventListener('click', () => {
    const next = currentMode === 'gallery' ? 'blinds' : 'gallery';
    renderSpace(slug, next);
  });
  app.appendChild(modeBtn);

  // Content container
  const container = document.createElement('div');
  container.className = 'windows-container';
  app.appendChild(container);

  // Build scene based on mode
  const media = getMediaForSpace(slug);
  let scene;

  if (currentMode === 'blinds') {
    // Tile to 10 for the blinds grid
    let tiled = [...media];
    while (tiled.length < 10) tiled = tiled.concat(media);
    scene = createGridCollage(tiled.slice(0, 10), container);
  } else {
    // Gallery mode — pass full pool, cells pick randomly
    scene = createGridGallery(media, container);
  }

  // Editorial overlay (night-market only)
  let editorialOverlay = null;
  if (slug === 'night-market') {
    const editBtn = document.createElement('button');
    editBtn.className = 'editorial-btn';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      if (editorialOverlay) {
        editorialOverlay.classList.toggle('active');
      }
    });
    app.appendChild(editBtn);

    editorialOverlay = document.createElement('div');
    editorialOverlay.className = 'editorial-overlay';
    editorialOverlay.innerHTML = buildEditorialContent();
    app.appendChild(editorialOverlay);
  }

  // Wheel of fortune
  const wheel = createWheel((effectName) => {
    applyEffect(effectName, container);
  });
  app.appendChild(wheel);

  // Effects overlay
  const effectsCanvas = initEffects();
  app.appendChild(effectsCanvas);

  // Audio play buttons
  const audioEls = [];
  const audioFiles = space.audio
    ? (Array.isArray(space.audio) ? space.audio : [space.audio])
    : [];
  const colorClasses = ['audio-yellow', 'audio-red', 'audio-blue', 'audio-green'];

  if (audioFiles.length > 0) {
    const btnContainer = document.createElement('div');
    btnContainer.className = 'audio-btns';

    const playSvg = `<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>`;
    const pauseSvg = `<svg viewBox="0 0 24 24"><rect x="5" y="4" width="4" height="16"/><rect x="15" y="4" width="4" height="16"/></svg>`;

    audioFiles.forEach((file, i) => {
      const audio = new Audio(`/zanyplans/spaces/${slug}/${file}`);
      audio.loop = true;
      audioEls.push(audio);

      const btn = document.createElement('button');
      btn.className = `audio-btn ${colorClasses[i] || colorClasses[0]}`;
      btn.innerHTML = playSvg;
      btn.addEventListener('click', () => {
        if (audio.paused) {
          audio.play();
          btn.innerHTML = pauseSvg;
          btn.classList.add('playing');
        } else {
          audio.pause();
          btn.innerHTML = playSvg;
          btn.classList.remove('playing');
        }
      });
      btnContainer.appendChild(btn);
    });

    app.appendChild(btnContainer);
  }

  currentCleanup = () => {
    audioEls.forEach(a => { a.pause(); a.src = ''; });
    if (currentMode === 'blinds') destroyGridCollage(scene);
    else destroyGridGallery(scene);
    destroyWheel();
    destroyEffects();
  };
}

// ═══════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════

function route() {
  const hash = location.hash.slice(1);
  const match = hash.match(/^\/space\/(.+)$/);
  if (match) {
    renderSpace(match[1]);
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', route);
route();
