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

  // Button colors
  const btnColors = [
    { bg: '#c22828', glow: 'rgba(194,40,40,0.4)' },     // red
    { bg: '#c8a000', glow: 'rgba(200,160,0,0.4)' },      // yellow
    { bg: '#2244aa', glow: 'rgba(34,68,170,0.4)' },      // blue
    { bg: '#b85a1b', glow: 'rgba(184,90,27,0.4)' },      // burnt orange
  ];

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'home-subtitle';
  subtitle.textContent = 'SELECT A SPACE';
  app.appendChild(subtitle);

  // Title
  const title = document.createElement('h1');
  title.className = 'home-title';
  title.textContent = 'ZANY PLANS';
  app.appendChild(title);

  // Navigation — big horizontal color buttons
  const nav = document.createElement('nav');
  nav.className = 'home-nav';
  spaces.forEach((space, i) => {
    const link = document.createElement('button');
    link.className = 'home-link';
    link.textContent = space.name;
    const c = btnColors[i % btnColors.length];
    link.style.setProperty('--btn-bg', c.bg);
    link.style.setProperty('--btn-glow', c.glow);
    link.style.setProperty('--pulse-dur', `${4.5 + i * 0.7}s`);
    link.style.setProperty('--pulse-delay', `${i * -1.2}s`);
    link.addEventListener('click', () => {
      location.hash = `/space/${space.slug}`;
    });
    nav.appendChild(link);
  });
  app.appendChild(nav);

  // ── Typographic debris layer ──
  const debris = document.createElement('div');
  debris.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  debris.innerHTML = `
    <!-- Corner crop marks -->
    <div class="td-crop td-crop-tl"></div>
    <div class="td-crop td-crop-tr"></div>
    <div class="td-crop td-crop-bl"></div>
    <div class="td-crop td-crop-br"></div>

    <!-- Long crossing rules -->
    <div class="td-rule-h" style="top:18%;left:2%;width:38%"></div>
    <div class="td-rule-h" style="top:18%;right:2%;width:22%"></div>
    <div class="td-rule-h" style="top:82%;left:8%;width:84%"></div>
    <div class="td-rule-h" style="top:36%;left:0;width:15%"></div>
    <div class="td-rule-h" style="top:36%;right:0;width:10%"></div>
    <div class="td-rule-h" style="top:68%;left:3%;width:25%"></div>
    <div class="td-rule-h" style="top:68%;right:5%;width:18%"></div>
    <div class="td-rule-h" style="top:50%;left:0;width:8%"></div>
    <div class="td-rule-h" style="top:50%;right:0;width:8%"></div>
    <div class="td-rule-h" style="top:10%;left:15%;width:70%"></div>
    <div class="td-rule-h" style="top:92%;left:4%;width:30%"></div>
    <div class="td-rule-h" style="top:92%;right:4%;width:30%"></div>
    <div class="td-rule-h-thick" style="top:20%;left:5%;width:120px"></div>
    <div class="td-rule-h-thick" style="bottom:18%;right:8%;width:90px"></div>
    <div class="td-rule-h-thick" style="top:58%;left:3%;width:60px"></div>

    <!-- Vertical rules -->
    <div class="td-rule-v" style="top:2%;left:18%;height:35%"></div>
    <div class="td-rule-v" style="bottom:2%;left:18%;height:25%"></div>
    <div class="td-rule-v" style="top:5%;right:20%;height:30%"></div>
    <div class="td-rule-v" style="bottom:5%;right:20%;height:20%"></div>
    <div class="td-rule-v" style="top:15%;left:50%;height:15%"></div>
    <div class="td-rule-v" style="bottom:10%;left:50%;height:10%"></div>
    <div class="td-rule-v" style="top:0;left:8%;height:100%"></div>
    <div class="td-rule-v" style="top:0;right:8%;height:100%"></div>
    <div class="td-rule-v" style="top:30%;left:38%;height:20%"></div>
    <div class="td-rule-v" style="top:60%;right:35%;height:22%"></div>
    <div class="td-rule-v-thick" style="top:14%;left:14%;height:60px"></div>
    <div class="td-rule-v-thick" style="bottom:14%;right:14%;height:60px"></div>

    <!-- Crosshairs + -->
    <div class="td-cross" style="top:18%;left:18%"></div>
    <div class="td-cross" style="top:18%;right:20%"></div>
    <div class="td-cross" style="bottom:18%;left:18%"></div>
    <div class="td-cross" style="bottom:18%;right:20%"></div>
    <div class="td-cross" style="top:50%;left:8%;transform:translateY(-50%)"></div>
    <div class="td-cross" style="top:50%;right:8%;transform:translateY(-50%)"></div>
    <div class="td-cross" style="top:10%;left:50%;transform:translateX(-50%)"></div>
    <div class="td-cross" style="bottom:8%;left:50%;transform:translateX(-50%)"></div>
    <div class="td-cross" style="top:36%;left:38%"></div>
    <div class="td-cross" style="top:68%;right:35%"></div>

    <!-- Targets ⊕ -->
    <div class="td-target" style="top:10%;left:10%"></div>
    <div class="td-target" style="top:8%;right:12%"></div>
    <div class="td-target" style="bottom:10%;right:8%"></div>
    <div class="td-target" style="bottom:12%;left:6%"></div>
    <div class="td-target" style="top:30%;right:6%"></div>
    <div class="td-target" style="bottom:30%;left:4%"></div>
    <div class="td-target" style="top:50%;left:18%"></div>
    <div class="td-target" style="top:50%;right:20%"></div>

    <!-- Halftone dots -->
    <div class="td-dot" style="top:9%;left:7%;width:14px;height:14px"></div>
    <div class="td-dot" style="bottom:9%;right:6%;width:10px;height:10px"></div>
    <div class="td-dot" style="top:32%;left:5%;width:5px;height:5px"></div>
    <div class="td-dot" style="bottom:28%;right:4%;width:5px;height:5px"></div>
    <div class="td-dot" style="top:55%;left:6%;width:4px;height:4px"></div>
    <div class="td-dot" style="top:22%;right:7%;width:8px;height:8px"></div>

    <!-- Black rectangles -->
    <div class="td-rect" style="top:21%;left:5%;width:45px;height:12px"></div>
    <div class="td-rect" style="bottom:16%;right:8%;width:35px;height:10px"></div>
    <div class="td-rect" style="top:58%;left:3%;width:18px;height:6px"></div>
    <div class="td-rect" style="bottom:40%;right:4%;width:12px;height:4px"></div>
    <div class="td-rect" style="top:6%;left:20%;width:8px;height:20px"></div>
    <div class="td-rect" style="bottom:6%;right:22%;width:8px;height:20px"></div>

    <!-- LARGE ghost text (like "NR.1" / "CONCEPT") -->
    <div class="td td-lg" style="top:3%;left:3%">NR.<sup style="font-size:0.5em">1</sup></div>
    <div class="td td-lg" style="bottom:3%;right:3%">ARCHIVE</div>
    <div class="td td-lg td-flip" style="top:6%;left:3%;color:rgba(0,0,0,0.05)">CONCEPT</div>
    <div class="td td-lg" style="bottom:25%;left:2%;font-size:clamp(20px,3vw,40px);color:rgba(0,0,0,0.06)">PROCESS</div>
    <div class="td td-lg" style="top:28%;right:2%;font-size:clamp(18px,2.5vw,36px);color:rgba(0,0,0,0.06)">LAYOUT</div>

    <!-- Medium text -->
    <div class="td td-md" style="top:12%;left:5%">ZANY PLANS</div>
    <div class="td td-md" style="bottom:5%;left:5%;font-size:clamp(10px,1.5vw,16px)">TYPOGRAPHIC PROCESS</div>
    <div class="td td-md" style="top:24%;right:5%;letter-spacing:0.3em;font-size:clamp(10px,1.3vw,14px)">ARCHIVE</div>
    <div class="td td-md" style="bottom:24%;left:10%;font-size:clamp(10px,1.3vw,14px)">DIMENSION</div>
    <div class="td td-md" style="top:65%;right:3%;font-size:clamp(9px,1.2vw,13px)">SELECT</div>
    <div class="td td-md" style="top:40%;left:2%;font-size:clamp(12px,1.8vw,20px);color:rgba(0,0,0,0.08)">VOID</div>
    <div class="td td-md" style="bottom:35%;right:2%;font-size:clamp(11px,1.6vw,18px);color:rgba(0,0,0,0.08)">MEMORIES</div>

    <!-- Vertical text -->
    <div class="td td-md td-vert" style="top:15%;left:2%;font-size:clamp(9px,1vw,12px);letter-spacing:0.4em">OFFSET PRINT</div>
    <div class="td td-md td-vert" style="top:20%;right:2%;font-size:clamp(9px,1vw,12px);letter-spacing:0.4em">PROOF SHEET</div>
    <div class="td td-md td-vert" style="bottom:15%;left:4%;font-size:clamp(8px,0.9vw,11px);letter-spacing:0.3em;color:rgba(0,0,0,0.1)">REGISTRATION</div>
    <div class="td td-md td-vert" style="bottom:20%;right:4%;font-size:clamp(8px,0.9vw,11px);letter-spacing:0.3em;color:rgba(0,0,0,0.1)">ALIGNMENT</div>

    <!-- Small labels -->
    <div class="td td-sm" style="top:5%;left:5%">CMYK PROCESS</div>
    <div class="td td-sm" style="top:7%;left:5%">100% K</div>
    <div class="td td-sm" style="top:5%;right:5%">SFr/DIM 3</div>
    <div class="td td-sm" style="top:7%;right:5%">US $ 1</div>
    <div class="td td-sm" style="bottom:5%;left:5%">01</div>
    <div class="td td-sm" style="bottom:3%;left:5%">A4 FORMAT</div>
    <div class="td td-sm" style="bottom:5%;right:5%">2026</div>
    <div class="td td-sm" style="bottom:3%;right:5%">PROOF</div>
    <div class="td td-sm" style="top:20%;left:20%">510</div>
    <div class="td td-sm" style="top:22%;left:20%">La Guardia Place</div>
    <div class="td td-sm" style="top:15%;right:25%">TRIM</div>
    <div class="td td-sm" style="top:19%;left:6%">REG MARKS</div>
    <div class="td td-sm" style="bottom:19%;right:6%">CROP AREA</div>
    <div class="td td-sm" style="top:75%;left:5%">BLEED 3mm</div>
    <div class="td td-sm" style="top:85%;right:5%">OVERPRINT</div>
    <div class="td td-sm" style="top:45%;left:3%">PAGE 14</div>
    <div class="td td-sm" style="bottom:45%;right:3%">SECTION B</div>

    <!-- Tiny data numbers -->
    <div class="td td-xs" style="top:14%;left:10%">212 &nbsp; 473 &nbsp; 9652</div>
    <div class="td td-xs" style="top:26%;right:8%">New York &nbsp; NY &nbsp; 10012</div>
    <div class="td td-xs" style="bottom:14%;left:8%">HARRIS &nbsp; J.</div>
    <div class="td td-xs" style="bottom:26%;right:10%">VOL. 1 &mdash; 2026</div>
    <div class="td td-xs" style="top:34%;left:6%">PANTONE 485 C</div>
    <div class="td td-xs" style="top:62%;right:6%">PANTONE 7409 C</div>
    <div class="td td-xs" style="bottom:62%;left:6%">PANTONE 2728 C</div>
    <div class="td td-xs" style="bottom:34%;right:6%">PANTONE 1525 C</div>
    <div class="td td-xs" style="top:88%;left:15%">FOLIO &nbsp; 47</div>
    <div class="td td-xs" style="top:88%;right:15%">SHEET &nbsp; 03</div>
    <div class="td td-xs" style="top:42%;right:4%">4C + SPOT</div>
    <div class="td td-xs" style="bottom:42%;left:4%">COLD SET</div>

    <!-- Upside-down text -->
    <div class="td td-md td-flip" style="top:8%;left:22%;font-size:clamp(8px,1vw,11px);color:rgba(0,0,0,0.07)">CONCEPT</div>
    <div class="td td-sm td-flip" style="bottom:8%;right:22%">TYPESET</div>
  `;
  app.appendChild(debris);
}

// ═══════════════════════════════════════════
// EDITORIAL OVERLAY — 10 cycling variations
// ═══════════════════════════════════════════

let editorialIndex = 0;

// Helper builders
const B = (s, c) => `<div class="ed-block" style="${s}">${c}</div>`;
const BV = (s, c) => `<div class="ed-block ed-vert" style="${s}">${c}</div>`;
const BB = (s, c) => `<div class="ed-block ed-body" style="${s}">${c}</div>`;
const RH = (s) => `<div class="ed-rule-h" style="${s}"></div>`;
const RV = (s) => `<div class="ed-rule-v" style="${s}"></div>`;

const EDITORIAL_PAGES = [
  // 0 — Dense editorial spread (intense)
  () => [
    BV('top:4%;left:3%;font-size:clamp(32px,5vw,56px);letter-spacing:0.2em;opacity:0.9', '夜市散策'),
    B('top:4%;right:5%;font-size:8px;letter-spacing:0.3em;opacity:0.4;font-family:"DM Sans",sans-serif', 'NO. 47 — 2026'),
    RH('top:9%;left:3%;width:45%'), RH('top:9%;right:3%;width:25%'),
    B('top:11%;left:4%;font-size:clamp(16px,2.5vw,26px);opacity:0.7', '特集'),
    B('top:11%;left:13%;font-size:8px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.2em', 'FEATURE'),
    B('top:15%;left:4%;font-size:clamp(24px,4vw,48px);line-height:1.4;opacity:0.9', '台灣夜市<br>美食紀行'),
    BB('top:28%;left:4%;width:38%;opacity:0.3', '夜市は台湾の文化の中心であり、地元の人々と観光客が集まる場所です。屋台の明かりが通りを照らし、様々な料理の香りが漂います。'),
    RV('top:10%;left:48%;height:38%'),
    B('top:11%;right:4%;font-size:7px;letter-spacing:0.25em;opacity:0.35;font-family:"DM Sans",sans-serif', 'CONTENTS'),
    B('top:15%;right:4%;text-align:right;opacity:0.5;font-size:clamp(12px,1.6vw,16px);line-height:2.4', '<span class="ed-num">01</span> 臭豆腐の誘惑<br><span class="ed-num">02</span> 珍珠奶茶物語<br><span class="ed-num">03</span> 蚵仔煎の技法<br><span class="ed-num">04</span> 夜の光と影<br><span class="ed-num">05</span> 鹽酥雞散歩<br><span class="ed-num">06</span> 市場の記憶'),
    RH('top:50%;left:6%;width:88%'),
    BV('bottom:6%;left:2%;font-size:clamp(38px,6vw,72px);opacity:0.65;letter-spacing:0.2em', '食文化'),
    B('bottom:36%;left:12%;font-size:clamp(18px,2.8vw,32px);opacity:0.6', '街角の味覚'),
    BB('bottom:22%;left:12%;width:32%;opacity:0.22', '深夜の市場を歩けば、そこには生きた文化がある。煙と蒸気の向こうに見える笑顔。'),
    BV('bottom:10%;right:6%;font-size:clamp(20px,3vw,36px);opacity:0.55;letter-spacing:0.12em', '市場物語'),
    B('bottom:5%;right:4%;font-size:7px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.2em', 'NIGHT MARKET STORIES'),
    RH('bottom:42%;right:5%;width:28%'), RV('bottom:6%;right:36%;height:32%'),
    B('top:45%;left:4%;font-size:7px;opacity:0.2;font-family:"DM Sans",sans-serif;letter-spacing:0.4em', 'PHOTOGRAPHY'),
    B('top:56%;right:6%;font-size:clamp(13px,2vw,22px);opacity:0.45', '香りと記憶'),
    BB('top:60%;right:6%;width:28%;opacity:0.18;text-align:right', '味わいの中に故郷がある。一口ごとに、遠い夜の記憶が蘇る。'),
    B('bottom:3%;left:50%;transform:translateX(-50%);font-size:7px;opacity:0.25;font-family:"DM Sans",sans-serif;letter-spacing:0.15em', '— 14 —'),
    BV('top:42%;left:50%;font-size:clamp(11px,1.5vw,16px);opacity:0.3;letter-spacing:0.3em', '遊歩道'),
  ],

  // 1 — Minimal (sparse, breathing room)
  () => [
    B('top:50%;left:50%;transform:translate(-50%,-50%);font-size:clamp(36px,6vw,80px);opacity:0.7;letter-spacing:0.1em', '夜'),
    RH('top:40%;left:20%;width:60%'),
    RH('bottom:40%;left:20%;width:60%'),
    B('bottom:35%;left:50%;transform:translateX(-50%);font-size:8px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.4em', 'NIGHT MARKET'),
  ],

  // 2 — Vertical columns (intense)
  () => [
    BV('top:5%;left:5%;font-size:clamp(28px,4vw,50px);opacity:0.85;letter-spacing:0.18em', '夜市美食紀行'),
    BV('top:8%;left:18%;font-size:clamp(16px,2.5vw,28px);opacity:0.5;letter-spacing:0.25em', '臭豆腐珍珠奶茶蚵仔煎鹽酥雞'),
    BV('top:12%;left:30%;font-size:clamp(11px,1.5vw,18px);opacity:0.35;letter-spacing:0.15em', '台灣夜市散策記録'),
    BV('top:5%;right:5%;font-size:clamp(22px,3.5vw,42px);opacity:0.7;letter-spacing:0.2em', '食文化物語'),
    BV('top:10%;right:18%;font-size:clamp(14px,2vw,24px);opacity:0.45;letter-spacing:0.18em', '市場光影記憶'),
    RV('top:0;left:14%;height:100%'), RV('top:0;left:26%;height:100%'),
    RV('top:0;right:14%;height:100%'), RV('top:0;right:26%;height:100%'),
    B('bottom:4%;left:50%;transform:translateX(-50%);font-size:7px;opacity:0.25;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', '— 47 —'),
    RH('top:3%;left:5%;width:90%'), RH('bottom:3%;left:5%;width:90%'),
  ],

  // 3 — Numbers + data (minimal-medium)
  () => [
    B('top:8%;left:6%;font-size:clamp(48px,8vw,100px);opacity:0.08;font-family:"DM Sans",sans-serif;font-weight:900', '47'),
    B('top:12%;left:6%;font-size:8px;opacity:0.35;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', 'ISSUE NO. 47'),
    RH('top:18%;left:6%;width:35%'),
    B('top:20%;left:6%;font-size:clamp(14px,2vw,22px);opacity:0.6', '夜市特集号'),
    B('top:30%;right:8%;font-size:7px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.2em;line-height:2.8;text-align:right', '01 — FEATURE<br>06 — PORTRAITS<br>14 — MARKET MAP<br>22 — RECIPES<br>30 — GALLERY'),
    RV('top:28%;right:40%;height:25%'),
    B('bottom:12%;left:6%;font-size:clamp(20px,3vw,36px);opacity:0.5', '二〇二六年三月'),
    B('bottom:8%;left:6%;font-size:7px;opacity:0.25;font-family:"DM Sans",sans-serif;letter-spacing:0.2em', 'MARCH 2026'),
  ],

  // 4 — Big single character (very minimal)
  () => [
    B('top:50%;left:50%;transform:translate(-50%,-50%);font-size:clamp(80px,20vw,240px);opacity:0.06;letter-spacing:0', '市'),
    RH('top:50%;left:0;width:100%'),
    B('top:52%;right:8%;font-size:8px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', 'MARKET'),
  ],

  // 5 — Dense magazine spread with body text (very intense)
  () => [
    B('top:3%;left:3%;font-size:clamp(28px,4.5vw,52px);opacity:0.85;line-height:1.3', '深夜市場<br>台灣味覚'),
    BB('top:20%;left:3%;width:30%;opacity:0.3', '夜市は台湾の文化の中心であり、地元の人々と観光客が集まる場所です。屋台の明かりが通りを照らし、様々な料理の香りが漂います。何百もの屋台が並び、それぞれが独自の味と香りを持っています。'),
    BB('top:20%;left:36%;width:28%;opacity:0.25', '臭豆腐の独特な香りが漂い、鉄板の上で焼かれる蚵仔煎の音が聞こえる。珍珠奶茶を片手に、人々は夜の市場を歩く。そこには台湾の日常がある。'),
    BB('top:20%;right:3%;width:28%;opacity:0.2', '夜が深まるにつれ、市場は活気を増していく。笑い声と呼び込みの声が混ざり合い、ネオンの光が路面を照らす。ここでは時間がゆっくりと流れる。'),
    RV('top:18%;left:34%;height:40%'), RV('top:18%;left:66%;height:40%'),
    RH('top:18%;left:3%;width:94%'), RH('top:62%;left:3%;width:94%'),
    BV('bottom:5%;left:3%;font-size:clamp(24px,3.5vw,44px);opacity:0.6;letter-spacing:0.15em', '美食散歩道'),
    B('bottom:5%;right:3%;font-size:clamp(18px,2.8vw,32px);opacity:0.55', '味覚探訪'),
    BB('bottom:12%;right:3%;width:35%;opacity:0.2;text-align:right', '一つ一つの料理に込められた想い。何世代にもわたって受け継がれてきた味。'),
    B('top:3%;right:3%;font-size:7px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.25em', 'VOL. 1 — P. 06-13'),
    B('bottom:3%;left:50%;transform:translateX(-50%);font-size:7px;opacity:0.2;font-family:"DM Sans",sans-serif;letter-spacing:0.15em', '— 06 —'),
    BV('top:65%;left:50%;font-size:clamp(10px,1.3vw,14px);opacity:0.25;letter-spacing:0.3em', '続く'),
  ],

  // 6 — Diagonal composition (minimal)
  () => [
    B('top:10%;left:10%;font-size:clamp(20px,3vw,36px);opacity:0.6', '夜'),
    B('top:25%;left:25%;font-size:clamp(20px,3vw,36px);opacity:0.5', '市'),
    B('top:40%;left:40%;font-size:clamp(20px,3vw,36px);opacity:0.4', '散'),
    B('top:55%;left:55%;font-size:clamp(20px,3vw,36px);opacity:0.3', '策'),
    B('top:70%;left:70%;font-size:clamp(20px,3vw,36px);opacity:0.2', '記'),
    B('top:85%;left:85%;font-size:clamp(20px,3vw,36px);opacity:0.15', '録'),
    RH('top:8%;left:8%;width:6%'), RH('top:23%;left:23%;width:6%'),
    RH('top:38%;left:38%;width:6%'), RH('top:53%;left:53%;width:6%'),
  ],

  // 7 — Full bleed type (very intense)
  () => [
    B('top:2%;left:2%;font-size:clamp(44px,7vw,90px);opacity:0.06;letter-spacing:-0.02em;line-height:1.1', '台灣夜市美食散策紀行二〇二六年春'),
    B('top:3%;right:2%;font-size:clamp(36px,5.5vw,72px);opacity:0.05;letter-spacing:0.05em;line-height:1.2;text-align:right;width:45%', '深夜市場物語食文化記録'),
    BV('top:5%;left:50%;font-size:clamp(48px,8vw,100px);opacity:0.04;letter-spacing:0.3em', '夜市散策美食'),
    RH('top:50%;left:0;width:100%'),
    RV('top:0;left:50%;height:100%'),
    B('bottom:4%;left:50%;transform:translateX(-50%);font-size:clamp(14px,2vw,22px);opacity:0.6', '夜市'),
    B('bottom:2%;left:50%;transform:translateX(-50%);font-size:7px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.4em', 'YESHI'),
  ],

  // 8 — Scattered labels (medium density)
  () => [
    B('top:6%;left:4%;font-size:7px;opacity:0.4;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', 'TAIPEI'),
    B('top:6%;right:4%;font-size:7px;opacity:0.4;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', 'TAICHUNG'),
    B('top:15%;left:8%;font-size:clamp(18px,2.8vw,32px);opacity:0.65', '士林夜市'),
    B('top:25%;right:10%;font-size:clamp(16px,2.2vw,26px);opacity:0.5', '饒河街'),
    B('top:38%;left:15%;font-size:clamp(14px,1.8vw,22px);opacity:0.4', '寧夏路'),
    B('top:50%;right:15%;font-size:clamp(18px,2.8vw,32px);opacity:0.55', '逢甲夜市'),
    B('top:62%;left:6%;font-size:clamp(12px,1.6vw,18px);opacity:0.35', '華西街'),
    B('top:75%;right:8%;font-size:clamp(15px,2vw,24px);opacity:0.45', '六合夜市'),
    RH('top:35%;left:3%;width:20%'), RH('top:48%;right:3%;width:15%'),
    RH('top:60%;left:3%;width:12%'), RH('top:73%;right:3%;width:18%'),
    BV('bottom:5%;left:4%;font-size:clamp(10px,1.2vw,14px);opacity:0.3;letter-spacing:0.2em', '台灣夜市地図'),
    B('bottom:3%;right:4%;font-size:7px;opacity:0.25;font-family:"DM Sans",sans-serif;letter-spacing:0.2em', 'MARKET MAP'),
  ],

  // 9 — Centered stack (minimal-medium)
  () => [
    B('top:25%;left:50%;transform:translateX(-50%);font-size:clamp(30px,5vw,64px);opacity:0.75;text-align:center;letter-spacing:0.15em', '夜市'),
    B('top:38%;left:50%;transform:translateX(-50%);font-size:clamp(14px,2vw,22px);opacity:0.4;text-align:center;letter-spacing:0.3em', '美食紀行'),
    RH('top:48%;left:30%;width:40%'),
    B('top:52%;left:50%;transform:translateX(-50%);font-size:8px;opacity:0.3;font-family:"DM Sans",sans-serif;letter-spacing:0.35em;text-align:center', 'A NIGHT MARKET JOURNEY'),
    BB('top:58%;left:50%;transform:translateX(-50%);width:50%;opacity:0.2;text-align:center', '夜の帳が降りると、市場は別の顔を見せる。灯りに誘われた人々が集い、食と文化の交差点が生まれる。'),
    B('bottom:20%;left:50%;transform:translateX(-50%);font-size:clamp(16px,2.2vw,26px);opacity:0.5;text-align:center', '二〇二六'),
    B('bottom:15%;left:50%;transform:translateX(-50%);font-size:7px;opacity:0.25;font-family:"DM Sans",sans-serif;letter-spacing:0.3em', 'VOLUME ONE'),
  ],
];

function buildEditorialContent(index) {
  return EDITORIAL_PAGES[index % EDITORIAL_PAGES.length]().join('\n');
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

  // Editorial overlay (night-market only) — cycles through 10 variations
  let editorialOverlay = null;
  if (slug === 'night-market') {
    const editBtn = document.createElement('button');
    editBtn.className = 'editorial-btn';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => {
      if (!editorialOverlay) return;
      if (editorialOverlay.classList.contains('active')) {
        // Already active — cycle to next
        editorialIndex = (editorialIndex + 1) % EDITORIAL_PAGES.length;
        editorialOverlay.classList.remove('active');
        setTimeout(() => {
          editorialOverlay.innerHTML = buildEditorialContent(editorialIndex);
          editorialOverlay.classList.add('active');
        }, 400);
      } else {
        // First press — show current
        editorialOverlay.innerHTML = buildEditorialContent(editorialIndex);
        editorialOverlay.classList.add('active');
      }
    });
    app.appendChild(editBtn);

    editorialOverlay = document.createElement('div');
    editorialOverlay.className = 'editorial-overlay';
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
