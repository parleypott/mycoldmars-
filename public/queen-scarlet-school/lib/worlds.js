// worlds.js — Henry's storytelling tool lives across multiple world.
//
// Each world is an isolated story universe: its own cast of characters,
// its own rules (the "bible"), its own AI canon (overlays on every model
// prompt), its own brand identity (palette, mascot, name). Worlds can
// share characters via deliberate cross-world links, but by default
// nothing leaks from one world to another.
//
// This file is the registry + the shim. It must load BEFORE any page
// code that touches localStorage, because it migrates the legacy
// global LS keys (`qss:globalcast`, `qss:last_story`, `qss:story:*`,
// `qss:cast:*`) into the default world's namespace on first run.
//
// URL contract: the existing /queen-scarlet-school/ path stays as the
// app root for now (historical, Henry remembers it). The active world
// is stored in localStorage at `qss:world:active` and toggled via the
// switcher pill in every page's topbar. We can split URL paths per
// world later if Henry wants distinct bookmarks per world.

(function() {
  if (window.QSSWorlds) return; // idempotent — script may load on multiple pages

  // ─── Registry ──────────────────────────────────────────────────────
  // Add a new world by inserting an entry here. Each world's content is
  // populated through the normal app (write stories, draw cast, etc.) —
  // this registry just declares the SHELL: what to call it, what color
  // to paint, what mascot to show, what AI canon to overlay.
  const WORLDS = {
    'queen-scarlet': {
      slug: 'queen-scarlet',
      name: "Queen Scarlet's Apocalypse School",
      shortName: 'Queen Scarlet',
      tagline: 'a magical school where everything is technically fine',
      mascot: '🐉',
      colors: {
        // Yolk-yellow + red-dragon — matches existing brand
        accent: '#FFD93D',
        accentDeep: '#F0B900',
        primary: '#E84545',
        primaryDeep: '#C32626',
      },
      // Planet rendering — the home universe shows each world as a
      // floating planet. The values here drive the planet's visual
      // identity: surface color, glow, ring config, atmosphere wash.
      planet: {
        size: 220,
        x: 28,   // % across the viewport
        y: 48,
        surface: 'radial-gradient(circle at 35% 30%, #FF6B5C 0%, #C32626 55%, #6B1414 100%)',
        glow: 'rgba(232, 69, 69, 0.55)',
        ring: { color: '#FFD93D', tilt: -16, opacity: 0.75 },
        atmosphere: 'rgba(255, 217, 60, 0.18)',
        // Tiny decoration that floats near the planet — a hovering icon
        // that hints at what's inside.
        bauble: { emoji: '👑', x: 78, y: 18 },
      },
      // AI canon overlay — appended to every model system prompt that
      // generates content for this world. The actual character canon
      // (Queen Scarlet IS a red dragon, etc.) lives in
      // /api/_lib/qss-canon.js — this is the world-level voice frame.
      canonText: `You are writing for "Queen Scarlet's Apocalypse School" — a magical school setting where the staff treat impossible logistics (eleven-minute PA announcements, four-mile underground canals, banned bean varieties) as routine scheduling matters. Dark-satirical-absurd tone. Children are competent and resigned; adults are bureaucratic and oblivious. Calculator helmets, paperwork, beans, bunkers, dragons running schools.`,
    },
    'burgundy': {
      slug: 'burgundy',
      name: 'Burgundy and the Ricos',
      shortName: 'Burgundy',
      tagline: 'a puppy who became a king who became a god of machines',
      mascot: '🐕',
      colors: {
        // Grape + sky — distinct from Queen Scarlet's yolk+red
        accent: '#9F7AE0',
        accentDeep: '#7654AC',
        primary: '#4DB8E8',
        primaryDeep: '#2596C7',
      },
      planet: {
        size: 180,
        x: 72,
        y: 56,
        surface: 'radial-gradient(circle at 30% 28%, #C1A5F0 0%, #7654AC 50%, #3E1F70 100%)',
        glow: 'rgba(159, 122, 224, 0.55)',
        ring: { color: '#4DB8E8', tilt: 28, opacity: 0.65 },
        atmosphere: 'rgba(77, 184, 232, 0.18)',
        bauble: { emoji: '🤖', x: 14, y: 22 },
      },
      // Stub — Johnny will give me the full canon. The bones are here.
      canonText: `You are writing for "Burgundy and the Ricos" — a story world about Burgundy, a puppy who became a king and then transcended into a technology-godlike figure. He built the Ricos: extraordinarily advanced robots. This world shares a universe with "Queen Scarlet's Apocalypse School" but operates by different rules with different characters and a different feel. Tone, voice, and specific lore details to be defined by Johnny.`,
    },
  };

  const DEFAULT_WORLD = 'queen-scarlet';
  const LS_ACTIVE = 'qss:world:active';
  const LS_MIGRATED = 'qss:world:migrated:v1';

  // ─── Active-world accessors ────────────────────────────────────────
  function getActive() {
    try {
      const slug = localStorage.getItem(LS_ACTIVE);
      return (slug && WORLDS[slug]) ? slug : DEFAULT_WORLD;
    } catch { return DEFAULT_WORLD; }
  }
  function setActive(slug) {
    if (!WORLDS[slug]) return false;
    try { localStorage.setItem(LS_ACTIVE, slug); return true; }
    catch { return false; }
  }
  function list() { return Object.values(WORLDS); }
  function get(slug) { return WORLDS[slug || getActive()] || null; }
  function activeWorld() { return get(getActive()); }

  // ─── Storage scoping ───────────────────────────────────────────────
  // All world-scoped LS keys go through this helper. Callers pass the
  // legacy suffix (e.g. "globalcast") and get back the namespaced key
  // for the active world.
  //
  // Examples:
  //   QSSWorlds.key('globalcast')         → 'qss:world:queen-scarlet:globalcast'
  //   QSSWorlds.key('story:my-story-id')  → 'qss:world:queen-scarlet:story:my-story-id'
  function key(suffix) {
    return `qss:world:${getActive()}:${suffix}`;
  }

  // ─── Migration ─────────────────────────────────────────────────────
  // First page load with worlds.js sees legacy LS keys (no world
  // namespace). Copy them under the default world so existing data
  // survives. Leave the legacy keys intact for now as a fallback —
  // a follow-up cleanup pass can remove them once we're confident.
  function migrateLegacy() {
    try {
      if (localStorage.getItem(LS_MIGRATED)) return;
      const LEGACY_EXACT = [
        'qss:globalcast',
        'qss:globalcast:migrated',
        'qss:last_story',
      ];
      const LEGACY_PREFIXES = [
        'qss:story:',
        'qss:cast:',
      ];
      let migrated = 0;
      for (const lk of LEGACY_EXACT) {
        const val = localStorage.getItem(lk);
        if (val == null) continue;
        const dest = `qss:world:${DEFAULT_WORLD}:${lk.replace(/^qss:/, '')}`;
        if (localStorage.getItem(dest) == null) {
          localStorage.setItem(dest, val);
          migrated++;
        }
      }
      // Snapshot keys before mutating (length will shift if we add).
      const allKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) allKeys.push(k);
      }
      for (const k of allKeys) {
        if (k.startsWith('qss:world:')) continue;
        const matchedPrefix = LEGACY_PREFIXES.find(p => k.startsWith(p));
        if (!matchedPrefix) continue;
        const dest = `qss:world:${DEFAULT_WORLD}:${k.replace(/^qss:/, '')}`;
        if (localStorage.getItem(dest) == null) {
          const val = localStorage.getItem(k);
          if (val != null) {
            localStorage.setItem(dest, val);
            migrated++;
          }
        }
      }
      localStorage.setItem(LS_MIGRATED, '1');
      if (migrated > 0) {
        console.log(`[worlds] migrated ${migrated} legacy keys to ${DEFAULT_WORLD}`);
      }
    } catch (e) { console.warn('[worlds] migration error', e); }
  }

  // ─── Theme painting ────────────────────────────────────────────────
  // Each world gets its own --world-accent + --world-primary CSS vars.
  // Page CSS can hook these for accents. Doesn't replace the existing
  // --yolk/--red tokens yet (that's a follow-up so we don't blow up
  // existing styling); for now this is additive.
  function paintTheme(world) {
    if (!world?.colors) return;
    const root = document.documentElement;
    const c = world.colors;
    if (c.accent)       root.style.setProperty('--world-accent',       c.accent);
    if (c.accentDeep)   root.style.setProperty('--world-accent-deep',  c.accentDeep);
    if (c.primary)      root.style.setProperty('--world-primary',      c.primary);
    if (c.primaryDeep)  root.style.setProperty('--world-primary-deep', c.primaryDeep);
    root.setAttribute('data-world', world.slug);
  }

  // Resolve the universe page URL from any page depth — pages live at
  // /queen-scarlet-school/, /queen-scarlet-school/cast/, and
  // /queen-scarlet-school/library/. Universe is at
  // /queen-scarlet-school/universe/.
  function universeHref() {
    const path = location.pathname;
    if (/\/queen-scarlet-school\/(cast|library|universe)\/?(?:index\.html)?$/.test(path)) {
      return '../universe/';
    }
    return 'universe/';
  }

  // ─── Switcher UI ───────────────────────────────────────────────────
  function createSwitcher() {
    const active = getActive();
    const world = get(active);
    const wrap = document.createElement('div');
    wrap.className = 'world-switcher';
    wrap.innerHTML = `
      <button class="world-pill" type="button" aria-label="Switch worlds" aria-haspopup="menu">
        <span class="world-pill-mascot" aria-hidden="true">${world?.mascot || '🌍'}</span>
        <span class="world-pill-name">${world?.shortName || 'World'}</span>
        <span class="world-pill-caret" aria-hidden="true">▾</span>
      </button>
      <div class="world-menu hidden" role="menu">
        ${list().map(w => `
          <button class="world-option ${w.slug === active ? 'active' : ''}" data-slug="${w.slug}" type="button" role="menuitem">
            <span class="world-option-mascot" aria-hidden="true">${w.mascot}</span>
            <span class="world-option-text">
              <span class="world-option-name">${w.name}</span>
              <span class="world-option-tag">${w.tagline}</span>
            </span>
            ${w.slug === active ? '<span class="world-option-check" aria-hidden="true">●</span>' : ''}
          </button>
        `).join('')}
        <a class="world-option world-option-universe" href="${universeHref()}" role="menuitem">
          <span class="world-option-mascot" aria-hidden="true">🌌</span>
          <span class="world-option-text">
            <span class="world-option-name">see the whole universe</span>
            <span class="world-option-tag">cosmic view — every world floating in space</span>
          </span>
        </a>
        <div class="world-menu-hint">switching worlds keeps everything safe — each world has its own cast and stories.</div>
      </div>
    `;
    const pill = wrap.querySelector('.world-pill');
    const menu = wrap.querySelector('.world-menu');
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('hidden');
    });
    wrap.addEventListener('click', (e) => {
      const opt = e.target.closest('.world-option');
      if (!opt) return;
      const slug = opt.dataset.slug;
      if (slug && slug !== active) {
        setActive(slug);
        location.reload();
      } else {
        menu.classList.add('hidden');
      }
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) menu.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.classList.add('hidden');
    });
    return wrap;
  }

  // ─── CSS injection ─────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('worlds-css')) return;
    const s = document.createElement('style');
    s.id = 'worlds-css';
    s.textContent = `
      .world-switcher { position: relative; display: inline-flex; }
      .world-pill {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 7px 10px 7px 12px;
        background: rgba(255, 246, 224, 0.06);
        border: 2px solid rgba(255, 246, 224, 0.3);
        border-radius: 999px;
        color: inherit;
        font-family: var(--ui, system-ui), -apple-system, sans-serif;
        font-size: 13px; font-weight: 700;
        cursor: pointer; line-height: 1;
        white-space: nowrap;
        transition: background 120ms ease;
      }
      .world-pill:hover { background: rgba(255, 246, 224, 0.14); }
      .world-pill-mascot { font-size: 16px; line-height: 1; }
      .world-pill-name { letter-spacing: -0.01em; }
      .world-pill-caret { opacity: 0.6; font-size: 10px; }

      .world-menu {
        position: absolute; top: calc(100% + 8px); right: 0; z-index: 200;
        min-width: 320px; max-width: 380px;
        background: #1a1a20;
        border: 2px solid rgba(255, 246, 224, 0.3);
        border-radius: 14px;
        padding: 6px 6px 4px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.55);
        display: flex; flex-direction: column; gap: 2px;
      }
      .world-menu.hidden { display: none; }
      .world-option {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px;
        background: transparent;
        border: none; border-radius: 10px;
        color: #f4e9c8;
        cursor: pointer; text-align: left;
        font-family: var(--ui, system-ui), -apple-system, sans-serif;
        position: relative;
      }
      .world-option:hover { background: rgba(255, 246, 224, 0.08); }
      .world-option.active {
        background: rgba(255, 217, 60, 0.16);
        outline: 1.5px solid rgba(255, 217, 60, 0.35);
      }
      .world-option-mascot { font-size: 22px; flex-shrink: 0; line-height: 1; }
      .world-option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .world-option-name { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
      .world-option-tag { font-size: 11.5px; color: rgba(244, 233, 200, 0.6); font-weight: 400; font-style: italic; line-height: 1.35; }
      .world-option-check { color: #FFD93D; font-size: 10px; margin-left: auto; flex-shrink: 0; }

      .world-option-universe {
        text-decoration: none;
        border-top: 1px solid rgba(244, 233, 200, 0.08);
        margin-top: 4px; padding-top: 14px;
        background: rgba(159, 122, 224, 0.08);
      }
      .world-option-universe:hover { background: rgba(159, 122, 224, 0.18); }

      .world-menu-hint {
        padding: 8px 12px 6px;
        font-family: var(--serif, Georgia, serif);
        font-size: 11.5px; font-style: italic;
        color: rgba(244, 233, 200, 0.45);
        border-top: 1px solid rgba(244, 233, 200, 0.08);
        margin-top: 4px;
      }
    `;
    document.head.appendChild(s);
  }

  // ─── Public API ────────────────────────────────────────────────────
  window.QSSWorlds = {
    // data
    list, get, activeWorld,
    // control
    getActive, setActive,
    // storage scoping
    key,
    // ui
    createSwitcher, injectCSS, paintTheme,
    // lifecycle
    migrateLegacy,
  };

  // ─── Boot ──────────────────────────────────────────────────────────
  migrateLegacy();
  injectCSS();
  const w = activeWorld();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => paintTheme(w));
  } else {
    paintTheme(w);
  }
})();
