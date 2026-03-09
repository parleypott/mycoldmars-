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
          ${s.logo ? '<img src="/deck/newpress-logo-white.png" alt="Newpress" class="tf-logo">' : ''}
          <span class="tf-tag" style="top:10%;right:8%;text-align:right">2026</span>
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
        <p class="body" style="margin:20px 0 12px">${e(s.body)}</p>
        ${s.body2 ? `<p class="body" style="margin:0 0 32px">${e(s.body2)}</p>` : ''}
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
        <div class="statement-wrap${s.image ? ' has-image' : ''}">
          <div class="statement-text">
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
          </div>
          ${s.image ? `<div class="statement-image"><img src="${s.image}" alt="" class="statement-img"></div>` : ''}
        </div>
      `;

    case 'whynow':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        ${s.subtext ? `<p class="body" style="margin:20px 0 16px">${e(s.subtext)}</p>` : ''}
        ${s.reach ? `<p class="body" style="margin:0 0 32px">${e(s.reach)}</p>` : ''}
        <div class="numbered-sections">
          ${s.sections.map(sec => `
            <div class="num-section">
              <span class="num-badge">${e(sec.num)}</span>
              <div class="num-content">
                <p class="num-title">${e(sec.title)}</p>
                <p class="num-text">${e(sec.text)}</p>
                ${sec.source ? `<p class="num-source">${e(sec.source)}</p>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
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

    case 'monetization':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 28px">${e(s.body)}</p>
        ${s.revenueOpp ? `
          <div class="revenue-opp" style="margin-top:24px;border-top:none;padding-top:0">
            <p class="label accent-yellow">${e(s.revenueOpp.label)}</p>
            <p class="body" style="margin:8px 0 12px">${e(s.revenueOpp.body)}</p>
            <div class="rev-tags">${s.revenueOpp.bullets.map(b => `<span class="rev-tag">${e(b)}</span>`).join('')}</div>
          </div>
        ` : ''}
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
      `;

    case 'business3':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <div class="pillars-grid">
          ${s.pillars.map(p => `
            <div class="pillar-card">
              <div class="pillar-bar pillar-bar-${p.color}"></div>
              <p class="pillar-title accent-${p.color}">${e(p.title)}</p>
              ${p.heroNum ? `
                <div class="biz-hero">
                  <span class="biz-hero-num">${e(p.heroNum)}</span>
                  <span class="biz-hero-label">${e(p.heroLabel)}</span>
                </div>
                ${p.text ? `<p class="pillar-text">${e(p.text)}</p>` : ''}
              ` : ''}
              ${p.partners ? `
                <div class="partner-list">
                  ${p.partners.map(pr => `
                    <div class="partner-item">
                      <span class="partner-channel">${e(pr.channel)}</span>
                      <span class="partner-range">${e(pr.range)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${p.intro ? `<p class="pillar-text">${e(p.intro)}</p>` : ''}
              ${p.stats ? `
                <div class="pillar-stats">
                  ${p.stats.map(st => `
                    <div class="biz-stat">
                      <span class="biz-stat-num">${e(st.number)}</span>
                      <span class="biz-stat-label">${e(st.label)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;

    case 'competition':
      return `
        ${labelHTML(s)}
        <div class="comp-grid">
          ${s.cards.map(c => {
            if (c.accent) {
              return `
                <div class="comp-card comp-accent">
                  <p class="comp-title">${e(c.title)}</p>
                  ${c.traits ? `<div class="comp-traits">${c.traits.map(t => `<span class="comp-trait">${e(t)}</span>`).join('')}</div>` : ''}
                  <p class="comp-text">${e(c.text)}</p>
                  ${c.values ? `
                    <p class="comp-values-label">WE VALUE</p>
                    <ul class="comp-values">
                      ${c.values.map(v => `<li>${e(v)}</li>`).join('')}
                    </ul>
                  ` : ''}
                </div>
              `;
            }
            return `
              <div class="comp-card">
                <p class="comp-title">${e(c.title)}</p>
                ${c.sub ? `<p class="comp-sub">${e(c.sub)}</p>` : ''}
                <p class="comp-text">${e(c.text)}</p>
              </div>
            `;
          }).join('')}
        </div>
      `;

    case 'creators':
      return `
        <div class="creators-wrap${s.heroImage ? ' has-hero' : ''}">
          <div class="creators-text">
            ${labelHTML(s)}
            ${s.headline ? `<h1 class="headline headline-lg" style="margin-bottom:28px">${e(s.headline)}</h1>` : ''}
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
                        ${imgOrPlaceholder(c.image, c.name, 'stage-avatar stage-avatar-lg')}
                        <div class="stage-info">
                          <p class="stage-name">${e(c.name)}</p>
                          ${c.tagline ? `<p class="stage-tagline">${e(c.tagline)}</p>` : ''}
                          <p class="stage-detail">${e(c.detail)}${c.subs ? ` <span class="subs-highlight">${e(c.subs)}</span>` : ''}</p>
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
                  ${st.name ? imgOrPlaceholder(st.image, st.name, 'stage-avatar stage-avatar-lg') : ''}
                  <div class="stage-info">
                    ${st.name ? `<p class="stage-name">${e(st.name)}</p>` : ''}
                    ${st.tagline ? `<p class="stage-tagline">${e(st.tagline)}</p>` : ''}
                    <p class="stage-detail">${e(st.detail)}${st.subs ? ` <span class="subs-highlight">${e(st.subs)}</span>` : ''}</p>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
            </div>
          </div>
          ${s.heroImage ? `<div class="creators-hero"><img src="${s.heroImage}" alt="" class="creators-hero-img"></div>` : ''}
        </div>
      `;

    case 'subscriberModel':
      return `
        <div class="sub-model-wrap">
          <div class="sub-model-text">
            ${labelHTML(s)}
            <h1 class="headline headline-lg" style="margin-bottom:24px">The home for the most curious<br>audience on the internet.</h1>
            <p class="body">${e(s.body)}</p>
          </div>
          ${s.images ? `
            <div class="sub-model-images">
              ${s.images.map(img => `<img src="${img}" alt="" class="sub-model-img">`).join('')}
            </div>
          ` : ''}
        </div>
      `;

    case 'humanElement':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <div class="he-body" style="margin-top:28px;max-width:760px">
          <p class="body" style="margin-bottom:16px">${e(s.body1)}</p>
          <p class="body" style="margin-bottom:16px">${e(s.body2)}</p>
          <p class="kicker">${e(s.body3)}</p>
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

    case 'fundingAsk':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <div class="funding-section" style="margin-top:32px">
          <p class="label accent-yellow" style="margin-bottom:20px">THE OPPORTUNITY</p>
          <div class="opp-grid">
            ${s.opportunities.map(o => `
              <div class="opp-card">
                <p class="opp-title">${e(o.title)}</p>
                <p class="opp-text">${e(o.text)}</p>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="funding-section" style="margin-top:36px">
          <p class="label accent-blue" style="margin-bottom:16px">${e(s.proceedsLabel)}</p>
          <ul class="point-list">
            ${s.proceeds.map(p => `<li>${e(p)}</li>`).join('')}
          </ul>
        </div>
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

    case 'appendixFinancials':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <div class="stats-grid four-col" style="margin:36px 0 24px">
          ${s.stats.map(st => `
            <div class="stat-item">
              <span class="stat-number">${e(st.number)}</span>
              <span class="stat-label">${nl(st.label)}</span>
              ${st.note ? `<span class="stat-note">${e(st.note)}</span>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="membership-section" style="margin-top:32px;padding-top:24px;border-top:1px solid rgba(18,17,24,0.12)">
          <p class="label" style="margin-bottom:20px">${e(s.membershipLabel)}</p>
          <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);max-width:480px">
            ${s.membershipStats.map(st => `
              <div class="stat-item">
                <span class="stat-number">${e(st.number)}</span>
                <span class="stat-label">${e(st.label)}</span>
                ${st.note ? `<span class="stat-note">${e(st.note)}</span>` : ''}
              </div>
            `).join('')}
          </div>
          ${s.membershipNote ? `<p class="financial-note" style="margin-top:16px">${e(s.membershipNote)}</p>` : ''}
        </div>
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
