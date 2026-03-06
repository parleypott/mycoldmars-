import './style.css';

/* ============================================================
   SLIDE DATA
   ============================================================ */
const slides = [
  {
    layout: 'title',
    headline: 'Newpress',
    sub: "We're not a media company. We're a movement.",
    stats: '13M+ Followers \u00A0\u00A0|\u00A0\u00A0 30M+ Monthly Views \u00A0\u00A0|\u00A0\u00A0 Emmy & Pulitzer-Recognized',
  },
  {
    layout: 'statement',
    label: '',
    headline: 'Media is broken.\nWe\u2019ve built something new.',
  },
  {
    layout: 'statement',
    label: 'HOW WE GOT HERE',
    headline: 'Johnny Harris spent years at Vox building one of the most-watched journalism teams in the world.',
    body: 'He learned what audiences wanted\u200A\u2014\u200Adepth, context, honesty\u200A\u2014\u200Aand what institutional media kept getting in the way of delivering. In 2020 he went independent. The audience followed. Then it grew. Then they became collaborators. That was the moment that pointed toward something bigger than a YouTube channel.',
  },
  {
    layout: 'statement',
    label: 'WHAT IS NEWPRESS',
    headline: 'More than a media company, Newpress is a movement.',
    body: "We\u2019re on a mission to rebuild audience trust through transparent and collaborative journalism. We\u2019re tearing down the wall between storytellers and audiences. We\u2019re engaging a community of loyal, curious viewers eager to participate in the content they consume.",
  },
  {
    layout: 'split',
    label: 'HOW WE\u2019RE RE-IMAGINING JOURNALISM',
    points: [
      {
        label: 'CREATOR-LED',
        text: 'A team of independent journalists not tied to a traditional publication, network, or editor-in-chief. Each journalist has their own channel and researches, writes, directs, and produces their own work\u200A\u2014\u200Aaccountable to the audiences they\u2019ve spent years building.',
      },
      {
        label: 'COMMUNITY-DRIVEN',
        text: 'Newpress.com is a platform where our creators\u2019 combined audiences participate as active collaborators\u200A\u2014\u200Acontributing subject matter expertise, sources, and insights that shape how stories are made. It\u2019s not a comment section. It\u2019s a newsroom with an open door.',
      },
    ],
  },
  {
    layout: 'quote',
    text: '\u201CJournalism done with people,\nnot at people.\u201D',
    attribution: 'Johnny Harris, Newpress Co-Founder',
  },
  {
    layout: 'break',
    label: 'MEET OUR CREATORS',
    headline: 'Creators who inform,\nnot just perform.',
  },
  {
    layout: 'grid',
    creators: [
      {
        name: 'Johnny Harris',
        role: 'Newpress Co-Founder\nEmmy-winning journalist',
        channel: 'Johnny Harris',
        stat: '7.5M subscribers',
        initial: 'JH',
      },
      {
        name: 'Sam Ellis',
        role: 'Emmy-nominated journalist',
        channel: 'Search Party',
        stat: '891K subscribers',
        initial: 'SE',
      },
      {
        name: 'Christophe Haubursin',
        role: 'Emmy-nominated tech expert',
        channel: 'Tunnel Vision',
        stat: '286K subscribers',
        initial: 'CH',
      },
      {
        name: 'Max Fisher',
        role: 'Pulitzer finalist\nfmr WaPo, NYT',
        channel: 'The Bigger Picture',
        stat: '24K subscribers',
        initial: 'MF',
      },
    ],
  },
  {
    layout: 'stats',
    label: 'OUR AUDIENCE',
    items: [
      { number: '13M+', label: 'Total subscribers\nacross platforms' },
      { number: '30M+', label: 'Monthly views\nacross the network' },
      { number: '70%', label: 'Returning viewers\non YouTube' },
      { number: '30K', label: 'Community members\non Newpress.com' },
    ],
  },
  {
    layout: 'statement',
    label: 'WHY PARTNER WITH US',
    headline: 'The audiences that matter most to brands are increasingly unreachable through traditional channels.',
    body: 'Pre-roll ads are skipped in five seconds. Algorithms reward outrage. Legacy institutions are losing credibility. We ground these issues in the language of the internet. Our channels are where those audiences live. Advertising with Newpress creators means reaching a highly-engaged community who will listen.',
  },
  {
    layout: 'tiers',
    label: 'HOW WE WORK WITH BRANDS',
    tiers: [
      {
        name: 'SINGLE CHANNEL',
        desc: 'Host-read integration, pinned comment, shortform video.',
        featured: false,
      },
      {
        name: '2 CREATORS',
        desc: 'All standard deliverables + newsletter mention + community post.',
        featured: false,
      },
      {
        name: '3 CREATORS',
        desc: 'All above + 3rd creator at 25% discount.',
        featured: false,
      },
      {
        name: 'FULL NETWORK',
        desc: 'All above + newsletter \u201CPresented By\u201D top placement + 4th creator at 50% off.',
        featured: true,
      },
    ],
  },
  {
    layout: 'split',
    label: 'HOW WE WORK WITH FOUNDATIONS',
    points: [
      {
        label: 'PRESENTING PARTNER',
        text: 'Foundation supports a series already in development. Gets transparent \u201Csupported by\u201D credit. Zero editorial input\u200A\u2014\u200Athe series was going to happen anyway.',
      },
      {
        label: 'SERIES SPONSOR',
        text: 'Foundation funds a new series on a topic of genuine mission alignment. Creator proposes the angle, the format, the stories. Foundation confirms alignment and commits.',
      },
      {
        label: 'COMMUNITY GRANT',
        text: 'Foundation funds a community-driven reporting project where audience participation is central to the journalism. Unique to Newpress.',
      },
    ],
  },
  {
    layout: 'statement',
    label: 'BRAND SAFETY',
    headline: 'Structural separation between editorial and business.',
    body: 'Iz Harris and Michael Letta manage all brand and foundation relationships. The creators manage their journalism. Those two sides don\u2019t cross. Brand partners get meaningful visibility into what\u2019s coming. What they don\u2019t get is editorial direction over what gets made.',
  },
  {
    layout: 'title',
    headline: 'Newpress',
    sub: 'Journalism, co-created.',
    stats: 'partnerships@newpress.com',
  },
];

/* ============================================================
   RENDER
   ============================================================ */
const deck = document.getElementById('deck');
const progress = document.getElementById('progress');
const navHint = document.getElementById('nav-hint');

let current = 0;
let navUsed = false;

function buildSlides() {
  slides.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = `slide slide-${s.layout}` + (i === 0 ? ' active' : '');
    el.dataset.index = i;
    el.innerHTML = renderSlide(s);
    deck.appendChild(el);
  });
  updateProgress();
}

function renderSlide(s) {
  switch (s.layout) {
    case 'title':
      return `
        <h1 class="headline headline-xl">${esc(s.headline)}</h1>
        <p class="body" style="text-align:center;max-width:640px;margin:0 auto">${esc(s.sub)}</p>
        <p class="stats-line"><span>${esc(s.stats)}</span></p>
      `;

    case 'statement':
      return `
        ${s.label ? `<p class="label">${esc(s.label)}</p>` : ''}
        <h1 class="headline headline-lg" style="margin-top:${s.label ? '16px' : '0'}">${nl2br(esc(s.headline))}</h1>
        ${s.body ? `<p class="body" style="margin-top:24px">${esc(s.body)}</p>` : ''}
      `;

    case 'quote':
      return `
        <div class="quote-rule"></div>
        <h1 class="headline headline-md">${nl2br(esc(s.text))}</h1>
        <p class="attribution">${esc(s.attribution)}</p>
      `;

    case 'stats':
      return `
        <p class="label">${esc(s.label)}</p>
        <div class="stats-grid">
          ${s.items.map((item) => `
            <div class="stat-item">
              <span class="stat-number">${esc(item.number)}</span>
              <span class="stat-label">${nl2br(esc(item.label))}</span>
            </div>
          `).join('')}
        </div>
      `;

    case 'grid':
      return `
        <div class="creators-grid">
          ${s.creators.map((c) => `
            <div class="creator-card">
              <div class="creator-avatar">${esc(c.initial)}</div>
              <div class="creator-name">${esc(c.name)}</div>
              <div class="creator-role">${nl2br(esc(c.role))}</div>
              <div class="creator-stat">${esc(c.stat)}</div>
            </div>
          `).join('')}
        </div>
      `;

    case 'split':
      return `
        <div class="split-left">
          <p class="label">${esc(s.label)}</p>
        </div>
        <div class="split-right">
          ${s.points.map((p) => `
            <div class="split-point">
              <p class="label accent-blue">${esc(p.label)}</p>
              <p class="body">${esc(p.text)}</p>
            </div>
          `).join('')}
        </div>
      `;

    case 'break':
      return `
        <div class="break-rule"></div>
        <p class="label">${esc(s.label)}</p>
        <h1 class="headline headline-lg">${nl2br(esc(s.headline))}</h1>
      `;

    case 'tiers':
      return `
        <p class="label" style="text-align:center;width:100%">${esc(s.label)}</p>
        <div class="tiers-row">
          ${s.tiers.map((t) => `
            <div class="tier-card${t.featured ? ' featured' : ''}">
              <div class="tier-name">${esc(t.name)}</div>
              <div class="tier-desc">${esc(t.desc)}</div>
            </div>
          `).join('')}
        </div>
      `;

    default:
      return '';
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goTo(index) {
  if (index < 0 || index >= slides.length || index === current) return;

  if (!navUsed) {
    navUsed = true;
    navHint.classList.add('faded');
  }

  const allSlides = deck.querySelectorAll('.slide');
  allSlides[current].classList.remove('active');
  allSlides[index].classList.add('active');
  current = index;
  updateProgress();
}

function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

function updateProgress() {
  const pct = ((current + 1) / slides.length) * 100;
  progress.style.width = pct + '%';
}

// Keyboard
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
});

// Click sides
deck.addEventListener('click', (e) => {
  const x = e.clientX / window.innerWidth;
  if (x > 0.65) next();
  else if (x < 0.35) prev();
});

// Touch swipe
let touchStartX = 0;
deck.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
deck.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) {
    if (dx < 0) next(); else prev();
  }
}, { passive: true });

/* ============================================================
   HELPERS
   ============================================================ */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function nl2br(str) {
  return str.replace(/\n/g, '<br>');
}

/* ============================================================
   INIT
   ============================================================ */
buildSlides();
