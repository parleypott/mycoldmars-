import './style.css';
import slides from './slides.js';

const deck = document.getElementById('deck');
const progress = document.getElementById('progress');

let current = 0;
let navUsed = false;
const total = slides.length;

/* ============================================================
   RENDER ENGINE
   ============================================================ */
function buildSlides() {
  slides.forEach((s, i) => {
    const el = document.createElement('div');
    let cls = `slide slide-${s.layout}`;
    if (i === 0) cls += ' active';
    if (s.bg) cls += ` bg-${s.bg}`;
    if (s.stripe) cls += ` stripe stripe-${s.stripe}`;
    el.className = cls;
    el.dataset.index = i;

    const counter = `<span class="slide-counter">${i + 1} / ${total}</span>`;
    const corner = (i > 0 && i < total - 1) ? `<span class="corner-mark">Newpress</span>` : '';

    let extra = '';
    if (i === 0) {
      extra = `<div class="nav-arrow" id="nav-arrow"><span class="nav-arrow-label">Next</span><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    }

    el.innerHTML = counter + corner + renderSlide(s) + extra;
    deck.appendChild(el);
  });
  updateProgress();
}

function renderSlide(s) {
  switch (s.layout) {

    case 'title':
      return `
        <div class="title-frame">
          <div class="tf-grain"></div>
          <span class="tf-h" style="top:8%"></span>
          <span class="tf-h" style="top:34%"></span>
          <span class="tf-h" style="top:76%"></span>
          <span class="tf-h" style="bottom:8%"></span>
          <span class="tf-v" style="left:6%"></span>
          <span class="tf-v" style="left:62%"></span>
          <span class="tf-v" style="right:6%"></span>
          ${s.logo ? '<img src="/deck/newpress-logo-white.png" alt="Newpress" class="tf-logo">' : ''}
          <span class="tf-tag" style="top:10%;right:8%;text-align:right">INVESTOR DECK<br>2026</span>
          <h1 class="tf-headline">${nl(s.headline)}</h1>
          <span class="tf-tag" style="top:36%;left:64%">CREATOR-LED<br>JOURNALISM</span>
          <p class="tf-body">${e(s.body)}</p>
          <span class="tf-tag" style="bottom:10%;left:8%">NEWPRESS</span>
          <span class="tf-tag" style="bottom:10%;right:8%;text-align:right">001</span>
        </div>
      `;

    case 'data':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 32px">${e(s.body)}</p>
        <div class="data-grid">
          ${s.stats.map(d => `
            <div class="data-card">
              <span class="data-number">${e(d.number)}</span>
              <span class="data-text">${e(d.text)}</span>
              ${d.source ? `<span class="data-source">${e(d.source)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      `;

    case 'statement':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        ${s.stat ? `<p class="stat-callout">${e(s.stat)}</p>` : ''}
        ${s.body ? `<p class="body" style="margin:20px 0">${e(s.body)}</p>` : ''}
        ${s.bullets ? `<ul class="point-list" style="margin-top:16px">${s.bullets.map((b, i) => {
          let src = '';
          if (s.bulletSources && s.bulletSources[i]) {
            src = `<span class="bullet-source">${e(s.bulletSources[i])}</span>`;
          }
          return `<li>${e(b)}${src}</li>`;
        }).join('')}</ul>` : ''}
        ${s.kicker ? `<p class="kicker" style="margin-top:24px">${e(s.kicker)}</p>` : ''}
      `;

    case 'marketQuote':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <div class="mq-section" style="margin:32px 0">
          <p class="label-dim" style="margin-bottom:16px">${e(s.quoteLabel)}</p>
          <blockquote class="pull-quote">\u201C${e(s.quote)}\u201D</blockquote>
          <p class="quote-source">\u2014 ${e(s.quoteSource)}</p>
        </div>
        <p class="label-dim" style="margin-bottom:14px">${e(s.subhead)}</p>
        <ul class="point-list">
          ${s.bullets.map(b => `<li>${e(b)}</li>`).join('')}
        </ul>
      `;

    case 'position':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 28px">${e(s.body)}</p>
        ${s.resultLabel ? `
          <p class="label accent-yellow" style="margin-bottom:8px">${e(s.resultLabel)}</p>
          <p class="result-body">${e(s.resultBody)}</p>
        ` : ''}
        ${s.quote ? `<blockquote class="pull-quote" style="margin-top:28px">\u201C${e(s.quote)}\u201D</blockquote>` : ''}
      `;

    case 'business':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <div class="biz-columns" style="margin-top:32px">
          <div class="biz-col">
            <p class="biz-col-title accent-blue">${e(s.col1.title)}</p>
            <ul class="biz-list">${s.col1.points.map(p => `<li>${e(p)}</li>`).join('')}</ul>
          </div>
          <div class="biz-col">
            <p class="biz-col-title accent-green">${e(s.col2.title)}</p>
            <p class="biz-intro">${e(s.col2.intro)}</p>
            <div class="biz-stats">
              ${s.col2.stats.map(st => `
                <div class="biz-stat">
                  <span class="biz-stat-num">${e(st.number)}</span>
                  <span class="biz-stat-label">${e(st.label)}</span>
                </div>
              `).join('')}
            </div>
            <p class="biz-kicker">${e(s.col2.kicker)}</p>
          </div>
        </div>
        ${s.revenueOpp ? `
          <div class="revenue-opp">
            <p class="label accent-yellow">${e(s.revenueOpp.label)}</p>
            <p class="body" style="margin:8px 0 12px">${e(s.revenueOpp.body)}</p>
            <div class="rev-tags">${s.revenueOpp.bullets.map(b => `<span class="rev-tag">${e(b)}</span>`).join('')}</div>
          </div>
        ` : ''}
      `;

    case 'competition':
      return `
        ${labelHTML(s)}
        <div class="comp-grid">
          ${s.cards.map(c => `
            <div class="comp-card${c.accent ? ' comp-accent' : ''}">
              <p class="comp-title">${e(c.title)}</p>
              ${c.sub ? `<p class="comp-sub">${e(c.sub)}</p>` : ''}
              <p class="comp-text">${e(c.text)}</p>
            </div>
          `).join('')}
        </div>
      `;

    case 'creators':
      return `
        ${labelHTML(s)}
        <div class="stages">
          ${s.stages.map(st => {
            if (st.creators) {
              return `
                <div class="stage">
                  <div class="stage-header">
                    <span class="stage-num">${e(st.num)}</span>
                    <span class="stage-title">${e(st.title)}</span>
                  </div>
                  ${st.subtitle ? `<p class="stage-subtitle">${e(st.subtitle)}</p>` : ''}
                  <div class="stage-creators">
                    ${st.creators.map(c => `
                      <div class="stage-creator">
                        ${imgOrPlaceholder(c.image, c.name, 'stage-avatar')}
                        <div class="stage-info">
                          <p class="stage-name">${e(c.name)}</p>
                          <p class="stage-detail">${e(c.detail)}</p>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `;
            }
            return `
              <div class="stage">
                <div class="stage-header">
                  <span class="stage-num">${e(st.num)}</span>
                  <span class="stage-title">${e(st.title)}</span>
                </div>
                <div class="stage-single">
                  ${st.name ? imgOrPlaceholder(st.image, st.name, 'stage-avatar') : ''}
                  <div class="stage-info">
                    ${st.name ? `<p class="stage-name">${e(st.name)}</p>` : ''}
                    <p class="stage-detail">${e(st.detail)}</p>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

    case 'team':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md" style="margin-bottom:32px">${nl(s.headline)}</h1>
        <div class="team-grid">
          ${s.members.map(m => `
            <div class="team-card">
              ${imgOrPlaceholder(m.image, m.name, 'team-avatar')}
              <p class="team-name">${e(m.name)}</p>
              <p class="team-title">${e(m.title)}</p>
              <p class="team-detail">${e(m.detail)}</p>
            </div>
          `).join('')}
        </div>
      `;

    case 'financials':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <div class="stats-grid four-col" style="margin:36px 0 24px">
          ${s.stats.map(st => `
            <div class="stat-item">
              <span class="stat-number">${e(st.number)}</span>
              <span class="stat-label">${nl(st.label)}</span>
            </div>
          `).join('')}
        </div>
        ${s.note ? `<p class="financial-note">${e(s.note)}</p>` : ''}
      `;

    case 'raise':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md" style="margin-bottom:32px">${nl(s.headline)}</h1>
        <div class="alloc-bar">
          ${s.allocations.map(a => `<div class="alloc-segment alloc-${a.color}" style="flex:${parseInt(a.pct)}"></div>`).join('')}
        </div>
        <div class="alloc-grid">
          ${s.allocations.map(a => `
            <div class="alloc-card">
              <span class="alloc-pct accent-${a.color}">~${e(a.pct)}</span>
              <p class="alloc-title">${e(a.title)}</p>
              <p class="alloc-text">${e(a.text)}</p>
            </div>
          `).join('')}
        </div>
      `;

    case 'vision':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 36px">${e(s.body)}</p>
        <div class="vision-phases">
          ${s.phases.map(p => `
            <div class="vision-phase">
              <p class="vision-title">${e(p.title)}</p>
              <ul class="vision-list">${p.items.map(it => `<li>${e(it)}</li>`).join('')}</ul>
            </div>
          `).join('')}
        </div>
        ${s.closing ? `<p class="closing-statement">\u201C${e(s.closing)}\u201D</p>` : ''}
      `;

    default:
      return '';
  }
}

/* ============================================================
   HELPERS
   ============================================================ */
function e(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function nl(str) {
  return e(str).replace(/\n/g, '<br>');
}

function labelHTML(s) {
  if (!s.label) return '';
  const dot = s.labelDot ? ` label-dot dot-${s.labelDot}` : '';
  return `<p class="label${dot}">${e(s.label)}</p>`;
}

function imgOrPlaceholder(src, name, cls) {
  if (src) {
    return `<img src="${src}" alt="${e(name)}" class="${cls}">`;
  }
  const initials = (name || '').split(/[\s\u00B7]+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return `<div class="${cls} placeholder-avatar">${initials}</div>`;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goTo(index) {
  if (index < 0 || index >= total || index === current) return;
  if (!navUsed) {
    navUsed = true;
    const arrow = document.getElementById('nav-arrow');
    if (arrow) arrow.classList.add('hidden');
  }
  const all = deck.querySelectorAll('.slide');
  all[current].classList.remove('active');
  all[index].classList.add('active');
  current = index;
  updateProgress();
}

function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

function updateProgress() {
  progress.style.width = ((current + 1) / total) * 100 + '%';
  const bg = slides[current].bg;
  progress.classList.toggle('on-light', bg === 'yellow' || bg === 'warm');
}

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowRight' || ev.key === ' ') { ev.preventDefault(); next(); }
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); prev(); }
});

deck.addEventListener('click', (ev) => {
  const x = ev.clientX / window.innerWidth;
  if (x > 0.65) next();
  else if (x < 0.35) prev();
});

let tx = 0;
deck.addEventListener('touchstart', (ev) => { tx = ev.touches[0].clientX; }, { passive: true });
deck.addEventListener('touchend', (ev) => {
  const dx = ev.changedTouches[0].clientX - tx;
  if (Math.abs(dx) > 50) { dx < 0 ? next() : prev(); }
}, { passive: true });

/* ============================================================
   INIT
   ============================================================ */
buildSlides();

/* Film grain texture */
(function initGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const d = ctx.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255 | 0;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 22;
  }
  ctx.putImageData(d, 0, 0);
  const url = c.toDataURL();
  document.querySelectorAll('.tf-grain').forEach(el => {
    el.style.backgroundImage = `url(${url})`;
  });
})();
