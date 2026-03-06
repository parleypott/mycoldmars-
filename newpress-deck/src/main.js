import './style.css';
import slides from './slides.js';

const deck = document.getElementById('deck');
const progress = document.getElementById('progress');
const navHint = document.getElementById('nav-hint');

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

    const counter = `<span class="slide-counter">${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>`;
    const corner = (i > 0 && i < total - 1) ? `<span class="corner-mark">Newpress</span>` : '';

    el.innerHTML = counter + corner + renderSlide(s);
    deck.appendChild(el);
  });
  updateProgress();
}

function renderSlide(s) {
  switch (s.layout) {

    case 'title':
      return `
        ${s.logo ? '<div class="logo-placeholder">NEWPRESS</div>' : ''}
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body">${e(s.body)}</p>
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

    case 'solution':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 8px">${e(s.body)}</p>
        <p class="body" style="color:var(--warm);margin-bottom:20px"><strong>${e(s.subhead)}</strong></p>
        <ul class="point-list">
          ${s.points.map(p => `<li>${e(p)}</li>`).join('')}
        </ul>
        <p class="kicker">${e(s.kicker)}</p>
      `;

    case 'whynow':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md" style="margin-bottom:32px">${nl(s.headline)}</h1>
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

    case 'market':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0 36px">${e(s.body)}</p>
        <div class="stats-grid four-col">
          ${s.stats.map((st, i) => `
            <div class="stat-item">
              <span class="stat-number color-${['blue','red','yellow','green'][i % 4]}">${e(st.number)}</span>
              <span class="stat-label">${nl(st.label)}</span>
              ${st.source ? `<span class="stat-source">${e(st.source)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      `;

    case 'statement':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <p class="body" style="margin:20px 0">${e(s.body)}</p>
        ${s.bulletLabel ? `<p class="label accent-blue" style="margin-top:24px">${e(s.bulletLabel)}</p>` : ''}
        ${s.bullets ? `<ul class="point-list" style="margin-top:12px">${s.bullets.map(b => `<li>${e(b)}</li>`).join('')}</ul>` : ''}
        ${s.kicker ? `<p class="kicker" style="margin-top:24px">${e(s.kicker)}</p>` : ''}
      `;

    case 'position':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-lg">${nl(s.headline)}</h1>
        <blockquote class="pull-quote">\u201C${e(s.quote)}\u201D</blockquote>
        <p class="body">${e(s.body)}</p>
      `;

    case 'business':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <p class="body" style="margin:16px 0 32px">${e(s.subhead)}</p>
        <div class="biz-columns">
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
        <h1 class="headline headline-md" style="margin-bottom:32px">${nl(s.headline)}</h1>
        <div class="stages">
          ${s.stages.map(st => {
            if (st.creators) {
              return `
                <div class="stage">
                  <div class="stage-header">
                    <span class="stage-num">${e(st.num)}</span>
                    <span class="stage-title">${e(st.title)}</span>
                  </div>
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
                  ${imgOrPlaceholder(st.image, st.name, 'stage-avatar')}
                  <div class="stage-info">
                    <p class="stage-name">${e(st.name)}</p>
                    <p class="stage-detail">${e(st.detail)}</p>
                    ${st.sub ? `<p class="stage-sub">${e(st.sub)}</p>` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <p class="kicker" style="margin-top:24px">${e(s.kicker)}</p>
      `;

    case 'series':
      return `
        ${labelHTML(s)}
        <h1 class="headline headline-md">${nl(s.headline)}</h1>
        <p class="series-tagline">${e(s.tagline)}</p>
        <p class="body" style="margin:16px 0 24px">${e(s.body)}</p>
        <div class="series-meta">
          <div class="series-episodes">
            <p class="label accent-yellow">SEASON 1 \u2014 12 EPISODES</p>
            <div class="episode-tags">${s.episodes.map(ep => `<span class="ep-tag">${e(ep)}</span>`).join('')}</div>
          </div>
          ${s.image ? `<img src="${s.image}" class="series-image" alt="The Human Element">` : '<div class="image-placeholder">THE HUMAN ELEMENT<br>KEY ART</div>'}
        </div>
        <p class="body" style="margin-top:20px">${e(s.proof)}</p>
        <p class="body" style="margin-top:8px"><strong>${e(s.status)}</strong></p>
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
        <div class="stats-grid four-col" style="margin:36px 0 32px">
          ${s.stats.map(st => `
            <div class="stat-item">
              <span class="stat-number">${e(st.number)}</span>
              <span class="stat-label">${nl(st.label)}</span>
            </div>
          `).join('')}
        </div>
        <p class="kicker">${nl(s.kicker)}</p>
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
  const initials = (name || '').split(/[\s·]+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return `<div class="${cls} placeholder-avatar">${initials}</div>`;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goTo(index) {
  if (index < 0 || index >= total || index === current) return;
  if (!navUsed) { navUsed = true; navHint.classList.add('faded'); }
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
