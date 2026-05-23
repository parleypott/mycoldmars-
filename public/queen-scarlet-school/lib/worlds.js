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
      // Art style — sticker-illustration register. Mirrors the
      // currently-hardcoded block in api/qss-character-card.js. The
      // character-card endpoint will pull artStyle.styleBlock per
      // active world; if missing, falls back to this QSS style.
      artStyle: {
        styleBlock: `STYLE: Whimsical, weird, prop-driven sticker illustration. As imaginative as a brilliant 13-year-old's drawings of his own characters. EVERY character has at least ONE absurd, oversized, story-specific physical feature or prop — a calculator-helmet head, a forklift, a gas mask, antennae, extra eyes, a doorknob for a nose. The prop or feature IS the character. Thick uniform black ink outlines. Flat saturated cel-shaded colors — no gradients, no painterly textures. Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green, lavender, salmon pink, warm cream. Plain warm cream / off-white paper background (#F4ECD8). Cinematic 3/4 or head-and-shoulders framing. Deadpan, sincere, faintly satirical expression — never smiling at the camera. Vinyl laptop sticker quality. Charmingly drawn, slightly dorky, not slick.`,
        references: `STYLE REFERENCES: (1) GOLD STANDARD — Kevin: a boy with a giant grey calculator-helmet swallowing his whole head, "ERROR: 3000" on the red screen, BEEP BEEP BEEP lozenges, bagel sandwich, teal hoodie with K, blue backpack. (2) Benny the beaver in orange safety vest + gas mask on a yellow forklift loaded with green BEANS cans. (3) Red cartoon dragon with yellow horns and teal-and-orange wings. EVERY new character must hit the Kevin bar.`,
        dontList: `DO NOT use: painterly brushwork, watercolor texture, photorealism, manga/anime conventions, gradient backgrounds, scenery, ambient props, text, labels, captions, signage, written words of any kind, generic smiling kid with no prop, stock cartoon boy face, default-white skin. NEVER default to white — human skin rotates deep brown / warm brown / golden / olive / freckled cream OR non-human (lavender, mossy green, sunshine yellow, slate blue, terracotta). White is the LAST option, not the first.`,
        paper: `Plain warm cream / off-white paper (#F4ECD8). No scenery. Centered subject.`,
      },
    },
    'burgundy': {
      slug: 'burgundy',
      name: 'Puppy Town — the Rico Uprising',
      shortName: 'Puppy Town',
      tagline: 'King of the Puppies, God of Machines',
      mascot: '🐕',
      colors: {
        // Iron-gray + amber lamplight + sienna-burgundy — replaces the
        // grape+sky stub. This is the retro-industrial mining-planet
        // palette, not the kid-cartoon palette.
        accent: '#D67A3E',     // amber lamplight
        accentDeep: '#A24F1F', // sienna
        primary: '#6E1F1A',    // burgundy red
        primaryDeep: '#3A0C0A',
      },
      planet: {
        size: 220,
        x: 72,
        y: 54,
        // Painted hero image (Studio Ghibli + Iron Giant register).
        // The cosmic universe page uses heroImage when present and
        // falls back to surface gradient if missing.
        heroImage: '/queen-scarlet-school/worlds/burgundy/planet-hero.jpg',
        // Fallback gradient — dark iron-gray + magma-orange veins.
        surface: 'radial-gradient(circle at 32% 30%, #4A3A3A 0%, #1F1416 55%, #0A0506 100%), radial-gradient(circle at 70% 65%, rgba(214, 122, 62, 0.35) 0%, transparent 50%)',
        glow: 'rgba(214, 122, 62, 0.55)',
        // No Saturn-style ring on this planet — the painting handles
        // its own visual identity.
        ring: null,
        atmosphere: 'rgba(45, 80, 95, 0.32)',
        bauble: { emoji: '👑', x: 14, y: 24 },
      },
      // Full canon — derived from puppy_town_act1.md.
      // This is "Puppy Town — Act I: The Rico Uprising." Tone: cinematic,
      // grimy, retro-industrial, class-revolt fable. NOT playful. NOT
      // sticker. Think Iron Giant + Yucatan 1512 poster + Studio Ghibli.
      canonText: `You are writing for "Puppy Town — the Rico Uprising" — Act I of a multi-volume saga about a backwater mining planet on the edge of the Universe Alliance Commodity Market.

═══ TONE ═══
This is NOT the playful sticker register of Queen Scarlet's Apocalypse School. This is grim industrial fable. Cinematic. Retro-futurist. The grown-ups are tyrants and the puppies are workers, miners, smugglers, peasants. Burgundy is intellectual, intense, calculating — sympathetic at the start, ruthless by the end of Act I. Studio Ghibli tonal weight (My Neighbor Totoro it is not — closer to Princess Mononoke + The Iron Giant + a Cormac McCarthy frontier).

═══ SETTING ═══
PUPPY TOWN is a mining planet — iron and a handful of esoteric specialty metals. Strategically negligible. Workforce: peasant puppy miners living at subsistence. The royal palace sits above the largest shaft complex. Most of what the planet produces ships offworld as tribute to Nicholas, an arms dealer none of the puppies have ever seen.

AESTHETIC: retro-futurist. MSDOS green-on-black terminals running heavy industrial equipment. CRT monitors. Hand-soldered boards. Audible relays. Boxy machines visibly assembled from scrap. The opposite of sleek — that is the point.

═══ CANONICAL CHARACTERS ═══
- BURGUNDY — the King's son. Tinker, engineer, autodidact. Builds in the palace basement against his father's orders. Has the peasant miners' trust because he works alongside them. Wires MSDOS terminals to industrial equipment. Writes self-modifying feedback loops that turn dumb machines into self-improving ones. By the end of Act I he overthrows his father, executes him after the surrender, crowns himself, and posts a sign declaring: "BURGUNDY, KING OF THE PUPPIES, GOD OF MACHINES." (This motto predates his coronation as Puppy King — it is his self-claimed title.)
- THE PUPPY KING (Burgundy's father) — tyrant, hoarder. Believes rule is hereditary class, not merit. Refuses innovation on principle. Pays tribute to Nicholas and calls it stewardship. Dies on his own throne, crown already passed to his son.
- THE QUEEN (Burgundy's mother) — unnamed, hates her husband. Quietly funds Burgundy's underground market purchases. Operates inside the palace without the King's notice. Open hook to fill in.
- NICHOLAS — off-world arms dealer. Receives Puppy Town's tribute. Never appears on the planet but looms over every scene. Setup for later acts.
- THE SPACE PIRATES — puppy smuggler crew. Run material in past the King's customs in exchange for whatever Burgundy can pay. Bridge to Act II.
- THE PEASANT MINERS — Burgundy's true court. Watch him build. Form the militia. After the siege, become the workforce of the new regime.

═══ TECH: THE RICO ═══
A Rico is a boxy, scrap-built robot — hardware mediocre, scored together from salvaged plate and rivets, CRT readout face glowing dim green with MSDOS-style text. The BREAKTHROUGH is not the hardware. The breakthrough is Burgundy wiring his terminal into the machine and writing self-modifying feedback loops. The Rico scores its own outcomes, mutates its parameters, runs itself thousands of times a day. After one week unattended in the mines, the prototype goes from useless to flawless. One unit outproduces a full shift.

- MINING RICO — original civilian variant. Industrial.
- BATTLE RICO V1 — armored, weaponized variant. Built in secret. Two hundred deployed in the siege. Untouched by the King's tanks.

═══ ACT I BEATS (canonical reference points) ═══
1. THE PITCH — Burgundy presents the prototype to his father, rejected violently.
2. THE FAILURE — Burgundy smuggles it into the mines. It performs terribly.
3. THE LOOP — Burgundy wires his terminal in and writes self-modifying feedback code. Walks away.
4. THE RETURN — One week later, the Rico mines flawlessly. One unit outproduces a full shift.
5. THE NETWORK — Smuggling operation: peasants, his mother, space pirates. The basement becomes a factory.
6. THE ARMY — Two hundred Battle Ricos V1. Peasant militia trained in whispers.
7. THE SIEGE — Palace doors fall. The King's tanks are scrap in minutes.
8. THE CROWN — The King surrenders the crown himself. Burgundy takes it — then orders the Ricos to kill him anyway.
9. THE NEW KING — Burgundy posts the motto "Burgundy, King of the Puppies, God of Machines." Crowns himself Puppy King. The planet's entire industrial capacity is repointed at Rico production.

═══ THEMES ═══
- Class revolt powered by tech the rulers refused to see.
- Self-modifying systems as the great equalizer — and the new weapon.
- The son becomes the father. (The surrender wasn't enough. Burgundy wanted the man dead.)
- Tribute, periphery, and dependence. Nicholas is still out there.

═══ VOICE RULES ═══
- Plain language. No marketing, no "weave/tapestry/delve/intricate/the story needs".
- Period-accurate scrap-tech vocabulary: solder, relay, schematic, terminal, shaft, ore, scrip, ledger, customs, tribute, hoard.
- Take the world seriously. The puppies are PEOPLE. The Ricos are dangerous.
- When writing Burgundy, lean cold-eyed. He is twelve, brilliant, and quietly furious.

═══ OPEN CALLS ═══
Henry can fill in: the Queen's name, the planet's official name (if different from "Puppy Town"), the specific esoteric metals.`,
      // Art style — REPLACES the QSS sticker prompt entirely when this
      // is the active world. Sourced from Johnny's reference set:
      // Studio Ghibli, Brad Bird's Iron Giant, the YUCATAN 1512 poster,
      // and a stack of painterly children's-book illustration.
      artStyle: {
        styleBlock: `STYLE: painterly cinematic illustration in the lineage of Studio Ghibli, Brad Bird's Iron Giant, and the YUCATAN 1512 movie poster. Hand-painted feel — visible brush strokes, soft edges, atmospheric depth, painted lighting. NOT vector, NOT sticker, NOT flat-cel. Treat each portrait as a single frame from an animated film about an industrial revolution on a backwater mining planet.\nPalette: deep teal-blue night + warm amber lamplight + sienna and burgundy reds + iron-gray + occasional CRT-green or magma-orange accent. Cool ambient backdrop with one warm light source carving the subject. Heavy chiaroscuro. Earth-tone, never saccharine.\nFraming: cinematic 3/4 portrait, character lit by a practical source (lamp, CRT glow, distant mine fire, broken stained glass). Atmosphere matters as much as character — show the world around them.\nTexture: visible paper grain or canvas tooth. Watercolor washes for skies/atmosphere. Crisp ink only where structural (machine edges, schematic lines on whiteboards). Bias soft over sharp. Bias painted over inked.\nQuality: looks like a still from a film, not a sticker on a notebook. Frame-worthy, not laptop-worthy.`,
        references: `REFERENCES (match these): Studio Ghibli (Mononoke / Castle in the Sky / Howl's Moving Castle) for character work and atmospheric backgrounds. Brad Bird's Iron Giant for the Rico aesthetic and the kid-with-giant-machine compositions. The YUCATAN 1512 movie poster by Alex Vede for flat-but-cinematic limited-palette tonal control. Carson Ellis, Sydney Smith, and Beatrice Alemagna for high-end painterly children's-book character illustration. The puppies are LITERAL dogs (brown-and-white, working breeds, weathered) wearing period-accurate work clothes and royal cloaks — NOT anthropomorphic cute cartoon mascots.`,
        dontList: `DO NOT use: sticker outlines, thick uniform black outlines, flat-cel coloring, warm cream "kid's book paper" background, vinyl-laptop-sticker quality, manga/anime conventions, photorealism, bright saccharine palettes, generic Disney-3D look, vector-clean lines. DO NOT make the puppies cute, baby-faced, or wearing "playful" outfits — they are workers and rebels in a hard world. DO NOT make the Ricos sleek, modern, or smooth — they are scrap-built, hand-soldered, deliberately ugly.`,
        paper: `Deep cinematic background — the character is embedded in their environment (mineshaft, basement workshop, throne room, smoke, lamplight). The background is NOT a flat colored paper. Show atmosphere.`,
      },
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

  // ─── Fetch wrapper — inject active world into /api/qss-* POSTs ────
  // Server endpoints read body.world_slug (or body.world) and prepend
  // that world's canon to their system prompts. The cast/library/main
  // pages have an access-code fetch wrapper that runs AFTER this one;
  // their wrapper sees our wrapped version, adds the x-access-code
  // header, and delegates. So the call order is:
  //   page code → access-code wrapper → world-injection wrapper → real fetch
  function installWorldFetchWrapper() {
    if (window.__qssWorldFetchInstalled) return;
    window.__qssWorldFetchInstalled = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async function(input, init = {}) {
      try {
        const url = typeof input === 'string' ? input : (input?.url || '');
        const method = (init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
        // Only inject on POSTs to /api/qss-* endpoints with a JSON body.
        if (method === 'POST' && /\/api\/qss-/.test(url) && init?.body && typeof init.body === 'string') {
          let body;
          try { body = JSON.parse(init.body); } catch { body = null; }
          if (body && typeof body === 'object' && !('world' in body) && !('world_slug' in body)) {
            body.world = getActive();
            init = { ...init, body: JSON.stringify(body) };
          }
        }
      } catch {}
      return origFetch(input, init);
    };
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
    // Body too — many shell-page selectors are written against `body[data-world=…]`
    // for the per-world theme overrides. Setting both means either selector
    // form works.
    if (document.body) {
      document.body.setAttribute('data-world', world.slug);
    } else {
      // If worlds.js runs before <body> exists (rare — but the script can be
      // moved into <head> on some pages), wait for it.
      document.addEventListener('DOMContentLoaded', () => {
        document.body && document.body.setAttribute('data-world', world.slug);
      }, { once: true });
    }
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
  installWorldFetchWrapper();
  injectCSS();
  const w = activeWorld();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => paintTheme(w));
  } else {
    paintTheme(w);
  }
})();
