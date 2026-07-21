// Burma Script Tool — app entry (WP-01 · CARTRIDGES).
// fig.03 CARTRIDGE RACK. Every script block is a tactile hardware CARTRIDGE inside a warm
// outlined DEVICE FRAME (max-width 1040px, #efeadd paper, 2px ink border, registration-screw
// corner marks) over an #e7e1d3 page. Header = WP·01 wordmark + "fig.03 — CARTRIDGE RACK" +
// telemetry. Footer = "+ INSERT BLOCK …". FLAT — no shadow, no bevel; JetBrains Mono chrome,
// sans prose. A hidden OUTLINE panel slides out from the LEFT (default collapsed).

import { render } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { BurmaEditor, LS_DOC } from './Editor.jsx';
import { Exports } from './Exports.jsx';
import { migrateStoredDoc, snapshotDoc, saveDoc, primeVersionFloor, rehydrateLocalFromNewest, setReloadingForAdopt, setReloadingForReset, isRenderableLocalDoc, readLatestSavedRaw, ensureResetBackup, LS_DOC_FALLBACK, LS_DOC_VER, LS_MIGRATED } from './migrate-doc.js';
import { reconcileOnLoad, bootstrapFromCloud, fetchCloudDocReadOnly, docsDiffer, snapshotDocConflictAsync } from './cloud-sync.js';
import { isReadOnly } from './read-mode.js';
import { isEditMode, setEditMode } from './edit-mode.js';
import { chapterFocusKey } from './extensions/chapter-focus.js';
import { isCollabEnabled, prepareCollab } from './collab.js';
import { captureWriteTokenFromUrl } from './write-token.js';
import { requestPersistentStorage, pruneIfLowHeadroom } from './storage-persist.js';
import { idbPruneGlobal } from './recovery-store.js';
import { scanRecoverySnapshots, scanRecoverySnapshotsAsync, readSnapshot, readSnapshotAsync, snapshotToText, dismissSnapshot, dismissSnapshotAsync } from './recovery.js';
import { idbDeleteDoc } from './recovery-store.js';
import { restoreSnapshot, restoreDoc } from './restore.js';
import { getEpisode } from './episode-config.js';
import { ROLE_DEFS, ROLE_IDS, parseRoles, serializeRoles, toggleRole, rolesStorageKey } from './roles.js';
import { WORKSPACE_ROLES, workspaceRole, scanWorkspace, workspaceMetrics } from './workspaces.js';
import { workspaceFilterKey } from './extensions/workspace-filter.js';
import { WS_MAP_KEY, parseWsFlag, setWsInHash, setWsInSearch } from './ws-route.js';
import { mapModel } from './script-map.js';
import { ScriptMap } from './ScriptMap.jsx';
import { startVersionBeacon } from './version-beacon.js';
import { ShortcutsOverlay } from './ShortcutsOverlay.jsx';
import { ShareToggle } from './ShareToggle.jsx';
import { stickyHeaderVisible } from './sticky-header.js';

// EPISODE is selected by the per-entry boot module (burma-script/src/boot.jsx or
// palau-script/main.jsx) which calls setEpisode(...) BEFORE dynamically importing this
// shared app, so getEpisode() here always returns the active episode. episode-config
// defaults to BURMA, so a direct (boot-less) import still degrades to Burma.
const EPISODE = getEpisode();
const SOURCE_BLOCKS = EPISODE.blocksData || [];
const DOC_TITLE = EPISODE.title;

// ── THE CONTROL UNIT (feature E) — reading instrument ────────────────────────
// A sticky LEFT panel, flat fig.01 box with Teenage-Engineering tactile knobs that
// drive CSS variables on .wp-page: TEXT SIZE, LEAD (line-height), a 9-font reading
// selector (serif + sans), and a tasteful-neutral COLOR SCHEME flipper. Everything
// persists to localStorage and re-skins the whole instrument instantly. The unit
// collapses into a small TE knob icon and re-expands with a smooth ~200ms ease.
const LS_CTRL = EPISODE.storage.CTRL;
const LS_ROLES = rolesStorageKey(EPISODE.storage);

// 9 classic reading / word-processing faces — serif + sans. System faces need no
// load; Newsreader / Source Serif / Literata / IBM Plex / Inter come from @import.
const READ_FONTS = [
  { id: 'newsreader',  label: 'Newsreader',   stack: '"Newsreader", Georgia, serif',            cls: 'serif' },
  { id: 'source',      label: 'Source Serif', stack: '"Source Serif 4", Georgia, serif',        cls: 'serif' },
  { id: 'literata',    label: 'Literata',     stack: '"Literata", Georgia, serif',              cls: 'serif' },
  { id: 'lora',        label: 'Lora',         stack: '"Lora", Georgia, serif',                  cls: 'serif' },
  { id: 'spectral',    label: 'Spectral',     stack: '"Spectral", "Palatino Linotype", Palatino, Georgia, serif', cls: 'serif' },
  { id: 'crimson',     label: 'Crimson',      stack: '"Crimson Pro", "Iowan Old Style", Georgia, serif', cls: 'serif' },
  { id: 'inter',       label: 'Inter',        stack: '"Inter", system-ui, sans-serif',          cls: 'sans' },
  { id: 'system',      label: 'System Sans',  stack: '"Helvetica Neue", system-ui, Arial, sans-serif', cls: 'sans' },
  { id: 'plex',        label: 'IBM Plex',     stack: '"IBM Plex Sans", system-ui, sans-serif',  cls: 'sans' },
];

// 6 tasteful neutrals (Johnny's 4–6 range, top end for flipper range). All FLAT, no garish
// hues; the brand orange stays a hardware accent, never a theme colour. sw = swatch paper,
// ink = swatch dot. cream = locked default look.
const SCHEMES = [
  { id: 'cream',    label: 'Cream / Ink', sw: '#efeadd', ink: '#1f1d18' },
  { id: 'graphite', label: 'Graphite',    sw: '#e8e9eb', ink: '#1c1e22' },
  { id: 'cool',     label: 'Cool Paper',  sw: '#f4f5f6', ink: '#22252b' },
  { id: 'sepia',    label: 'Sepia',       sw: '#f3e7cf', ink: '#3a2f1e' },
  { id: 'manila',   label: 'Manila',      sw: '#ece0c1', ink: '#332b1a' },
  { id: 'slate',    label: 'Slate',       sw: '#2e3036', ink: '#e7e8ea' },
];

const SIZE_MIN = 14, SIZE_MAX = 22;
const LEAD_MIN = 1.3, LEAD_MAX = 2.0;

// ACCENT — the ONE hardware accent for this script (the drop-line, the reach-for-it grip, the
// copy pulse). One per script by default (Burma orange, Palau teal — each config declares it),
// but user-tunable here: a row of presets + a native colour picker for "any colour I like". Drives
// --ep-accent on .wp-page. Persisted per-episode in LS_CTRL like every other reading setting.
const ACCENT_PRESETS = [
  '#ff5b1f', // burma orange
  '#0c7d8c', // palau teal
  '#2f6fb0', // blue
  '#1f8a72', // green
  '#b0431f', // rust
  '#7a5cc0', // violet
];
const DEFAULTS = { size: 16, lead: 1.62, font: 'newsreader', scheme: 'sepia', accent: EPISODE.accent, collapsed: false };

function loadCtrl() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CTRL) || '{}');
    return { ...DEFAULTS, ...raw };
  } catch { return { ...DEFAULTS }; }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// TACTILE KNOB — a TE-style rotary. The indicator sweeps ~270° across the range.
// Drag vertically (up = increase) or scroll to turn; arrow keys for a11y. Flat: a
// ringed disc with a tick, a value readout below. No shadow, no bevel.
function Knob({ label, value, min, max, step, unit, onChange, format }) {
  const dragRef = useRef(null);
  const ang = -135 + ((value - min) / (max - min)) * 270; // -135°..+135°
  const startDrag = (e) => {
    e.preventDefault();
    const startY = (e.touches ? e.touches[0].clientY : e.clientY);
    const startV = value;
    const span = max - min;
    const move = (ev) => {
      const y = (ev.touches ? ev.touches[0].clientY : ev.clientY);
      const dv = ((startY - y) / 160) * span; // 160px full sweep
      onChange(clamp(Math.round((startV + dv) / step) * step, min, max));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
  };
  const wheel = (e) => {
    e.preventDefault();
    onChange(clamp(Math.round((value - Math.sign(e.deltaY) * step) / step) * step, min, max));
  };
  const key = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onChange(clamp(+(value + step).toFixed(2), min, max)); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onChange(clamp(+(value - step).toFixed(2), min, max)); }
  };
  return (
    <div class="wp-knob">
      <div
        class="wp-knob-dial"
        ref={dragRef}
        role="slider"
        tabindex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        onWheel={wheel}
        onKeyDown={key}
      >
        <span class="wp-knob-tick" style={{ transform: `rotate(${ang}deg)` }} />
      </div>
      <span class="wp-knob-lab">{label}</span>
      <span class="wp-knob-val">{format ? format(value) : value}{unit || ''}</span>
    </div>
  );
}

function ControlUnit({ outlineOpen }) {
  const [s, setS] = useState(loadCtrl);

  // Apply settings to the doc as CSS variables + scheme attribute. Persist.
  useEffect(() => {
    const page = document.querySelector('.wp-page');
    if (!page) return;
    const font = READ_FONTS.find((f) => f.id === s.font) || READ_FONTS.find((f) => f.id === 'system');
    page.style.setProperty('--doc-read', font.stack);
    page.style.setProperty('--doc-size', s.size + 'px');
    page.style.setProperty('--doc-lead', String(s.lead));
    // L1 — the SIZE knob also scales the structural chrome labels at HALF rate, floored at 11px,
    // so enlarging reading text proportionally enlarges the VO/SOT/NOTE kind labels, lane labels,
    // telemetry, etc. that tell a dyslexic reader what each block IS. SIZE 14 → 11px, 22 → 15px.
    const chrome = Math.max(11, 11 + (s.size - SIZE_MIN) * 0.5);
    page.style.setProperty('--chrome-size', chrome.toFixed(2) + 'px');
    page.style.setProperty('--chrome-size-sm', Math.max(10, chrome - 1).toFixed(2) + 'px');
    // ACCENT — the one hardware accent for this script, user-tunable, defaults to EPISODE.accent.
    page.style.setProperty('--ep-accent', s.accent || EPISODE.accent);
    page.setAttribute('data-scheme', s.scheme);
    // mirror scheme onto <html> so the body/overscroll area re-skins too
    document.documentElement.setAttribute('data-scheme', s.scheme);
    try { localStorage.setItem(LS_CTRL, JSON.stringify(s)); } catch {}
  }, [s.font, s.size, s.lead, s.scheme, s.accent, s.collapsed]);

  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));
  const cycleFont = (dir) => {
    const i = READ_FONTS.findIndex((f) => f.id === s.font);
    const n = (i + dir + READ_FONTS.length) % READ_FONTS.length;
    set({ font: READ_FONTS[n].id });
  };
  const font = READ_FONTS.find((f) => f.id === s.font) || READ_FONTS[7];

  return (
    <aside
      class={`wp-control${s.collapsed ? ' is-collapsed' : ''}${outlineOpen ? ' outline-open' : ''}`}
      aria-label="Reading control unit"
    >
      {/* collapsed dot — a TE knob icon. Click re-expands. */}
      <button
        class="wp-control-knobicon"
        title="Reading controls"
        aria-label="Open reading controls"
        onClick={() => set({ collapsed: false })}
        tabindex={s.collapsed ? 0 : -1}
      >
        <span class="wp-knobicon-dial"><span class="wp-knobicon-tick" /></span>
        <span class="wp-knobicon-lab">READ</span>
      </button>

      {/* expanded unit */}
      <div class="wp-control-body" aria-hidden={s.collapsed} inert={s.collapsed ? '' : undefined}>
        <div class="wp-control-head">
          <span class="wp-control-ttl">READING</span>
          <button
            class="wp-control-collapse"
            title="Collapse"
            aria-label="Collapse reading controls"
            tabindex={s.collapsed ? -1 : 0}
            onClick={() => set({ collapsed: true })}
          >–</button>
        </div>

        <div class="wp-control-knobs">
          <Knob label="SIZE" value={s.size} min={SIZE_MIN} max={SIZE_MAX} step={1} unit="px"
            onChange={(v) => set({ size: v })} />
          <Knob label="LEAD" value={s.lead} min={LEAD_MIN} max={LEAD_MAX} step={0.05}
            onChange={(v) => set({ lead: +v.toFixed(2) })} format={(v) => v.toFixed(2)} />
        </div>

        <div class="wp-control-row">
          <span class="wp-control-rowlab">FONT</span>
          <div class="wp-font-sel">
            <button class="wp-font-step" title="Previous font" aria-label="Previous font" onClick={() => cycleFont(-1)}>‹</button>
            <span class={`wp-font-name ${font.cls}`} style={{ fontFamily: font.stack }}>{font.label}</span>
            <button class="wp-font-step" title="Next font" aria-label="Next font" onClick={() => cycleFont(1)}>›</button>
          </div>
        </div>

        <div class="wp-control-row col">
          <span class="wp-control-rowlab">SCHEME</span>
          <div class="wp-scheme-grid">
            {SCHEMES.map((sc) => (
              <button
                key={sc.id}
                class={`wp-scheme-sw${s.scheme === sc.id ? ' is-active' : ''}`}
                title={sc.label}
                aria-label={sc.label}
                aria-pressed={s.scheme === sc.id}
                style={{ background: sc.sw, color: sc.ink }}
                onClick={() => set({ scheme: sc.id })}
              >
                <span class="wp-scheme-dot" style={{ background: sc.ink }} />
              </button>
            ))}
          </div>
        </div>

        <div class="wp-control-row col">
          <span class="wp-control-rowlab">ACCENT</span>
          <div class="wp-accent-grid">
            {ACCENT_PRESETS.map((hex) => (
              <button
                key={hex}
                class={`wp-accent-sw${(s.accent || '').toLowerCase() === hex.toLowerCase() ? ' is-active' : ''}`}
                title={hex}
                aria-label={`Accent ${hex}`}
                aria-pressed={(s.accent || '').toLowerCase() === hex.toLowerCase()}
                style={{ background: hex }}
                onClick={() => set({ accent: hex })}
              />
            ))}
            <label class="wp-accent-custom" title="Custom accent colour">
              <input
                type="color"
                value={s.accent || EPISODE.accent}
                onInput={(e) => set({ accent: e.currentTarget.value })}
                aria-label="Custom accent colour"
              />
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── ROLE FOCUS HUB — the crew lens. Sticky-left like the READING unit, collapsible.
// A teammate checks their craft (animator / 3D / archive / fact-check / b-roll) and the
// whole page fades back EXCEPT rows that carry their work — and, because a VO always shares
// its row with the direction spoken over it, the voiceover said during their shot stays lit
// too (see the [data-roles] lens in styles.css; the row is the co-occurrence unit).
//
// This is a PURE VIEW FILTER: it sets ONE attribute on .wp-page and writes ONE localStorage
// key. It registers no ProseMirror plugin and dispatches no transaction, so it is structurally
// outside the collab loop law — it cannot echo-loop, cannot clobber, cannot lose a word. It
// renders in ?read shares deliberately (a teammate isolating their craft on a shared link is
// the whole point) and touches nothing a read-only guard would need to gate.
function loadRoles() {
  try {
    const stored = localStorage.getItem(LS_ROLES);
    const parsed = stored ? JSON.parse(stored) : {};
    // Guard the WRONG-TYPE case, not just missing: a hand-edited / legacy LS value could be a
    // JSON array, number, or string, and `[].roles` / `(5).roles` would misread. Only a plain
    // object carries {roles, collapsed}; anything else degrades to the empty lens.
    const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return { roles: parseRoles(serializeRoles(o.roles || [])), collapsed: !!o.collapsed };
  } catch { return { roles: [], collapsed: false }; }
}

function RoleHub({ outlineOpen }) {
  const [s, setS] = useState(loadRoles);

  // Apply the active craft set to .wp-page as `data-roles` (the ONLY application path) + persist.
  useEffect(() => {
    const page = document.querySelector('.wp-page');
    if (!page) return;
    const active = serializeRoles(s.roles);
    if (active) page.setAttribute('data-roles', active);
    else page.removeAttribute('data-roles');
    try { localStorage.setItem(LS_ROLES, JSON.stringify({ roles: parseRoles(active), collapsed: s.collapsed })); } catch {}
  }, [s.roles, s.collapsed]);

  // On unmount, clear the attribute so a torn-down hub can't leave the page stuck in a lens.
  useEffect(() => () => { try { document.querySelector('.wp-page')?.removeAttribute('data-roles'); } catch {} }, []);

  const set = (patch) => setS((prev) => ({ ...prev, ...patch }));
  const active = new Set(s.roles);

  return (
    <aside
      class={`wp-role${s.collapsed ? ' is-collapsed' : ''}${outlineOpen ? ' outline-open' : ''}`}
      aria-label="Role focus hub"
    >
      {/* collapsed pill — an eye icon. Click re-expands. */}
      <button
        class="wp-role-knobicon"
        title="Role focus"
        aria-label="Open role focus"
        onClick={() => set({ collapsed: false })}
        tabindex={s.collapsed ? 0 : -1}
      >
        <span class="wp-role-eye" aria-hidden="true">◉</span>
        <span class="wp-role-iconlab">ROLE</span>
        {active.size > 0 && <span class="wp-role-dot" aria-hidden="true" />}
      </button>

      {/* expanded unit */}
      <div class="wp-role-body" aria-hidden={s.collapsed} inert={s.collapsed ? '' : undefined}>
        <div class="wp-role-head">
          <span class="wp-role-ttl">MY ROLE</span>
          <button
            class="wp-role-collapse"
            title="Collapse"
            aria-label="Collapse role hub"
            tabindex={s.collapsed ? -1 : 0}
            onClick={() => set({ collapsed: true })}
          >–</button>
        </div>

        <p class="wp-role-hint">Check your craft — everything else fades, but the voiceover said over your shots stays.</p>

        <div class="wp-role-list">
          {ROLE_DEFS.map((r) => {
            const on = active.has(r.id);
            return (
              <button
                key={r.id}
                class={`wp-role-item${on ? ' is-active' : ''}`}
                aria-pressed={on}
                title={on ? `${r.label} — isolated` : `Isolate ${r.label}`}
                onClick={() => set({ roles: toggleRole(s.roles, r.id) })}
              >
                <span class="wp-role-swatch" style={{ background: r.tint }} />
                <span class="wp-role-name">{r.label}</span>
                <span class="wp-role-check" aria-hidden="true">{on ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        <button
          class="wp-role-reset"
          disabled={!s.roles.length}
          onClick={() => set({ roles: [] })}
        >show everything</button>
      </div>
    </aside>
  );
}

// ── OUTLINE SCROLL-SPY + JUMP — shared by the slide-out PANEL and the always-there RAIL
// so the two can never disagree about which chapter is "current". Chapters only (lvl-0);
// the reading band sits 28% down the viewport.
function useOutlineSpy(items) {
  const [activeId, setActiveId] = useState('');
  useEffect(() => {
    if (!items || !items.length) return;
    const chapters = items.filter((it) => it.level === 0);
    if (!chapters.length) return;
    let ticking = false;
    const band = () => window.innerHeight * 0.28;
    const compute = () => {
      ticking = false;
      let current = chapters[0].id;
      for (const c of chapters) {
        const node = document.querySelector(`[data-block-id="${c.id}"]`);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= band()) current = c.id;
        else break;
      }
      setActiveId(current);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(compute); } };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [items]);
  return activeId;
}

function jumpToOutlineId(id) {
  const node = document.querySelector(`[data-block-id="${id}"]`);
  if (!node) return;
  // L4 — honor prefers-reduced-motion: jump instantly instead of smooth-scrolling for users who
  // asked the OS to reduce motion (smooth-scroll across a 225-block doc is a vestibular trigger).
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

// ── OUTLINE RAIL — the faint ALWAYS-THERE spine in the left margin (Johnny: "a faint
// outline I can click to jump to sections… like Google Docs"). Collapsed state = one thin
// dash per chapter, the current one orange. Hover the rail and the real titled list flies
// out (chapters + indented scenes, same items + jump as the panel); leave and it folds
// back to dashes. The pinned ≡ OUTLINE panel supersedes it (rail hides while open).
function OutlineRail({ items, hidden }) {
  const [hover, setHover] = useState(false);
  const activeId = useOutlineSpy(items);
  const navRef = useRef(null);
  const openT = useRef(null);
  const closeT = useRef(null);

  // HOVER INTENT (design panel): open after a beat, close after a longer beat, each timer
  // cancelling the other — grazing the screen edge never flashes the panel.
  const enter = () => { clearTimeout(closeT.current); openT.current = setTimeout(() => setHover(true), 120); };
  const leave = () => { clearTimeout(openT.current); closeT.current = setTimeout(() => setHover(false), 250); };
  useEffect(() => () => { clearTimeout(openT.current); clearTimeout(closeT.current); }, []);

  // On open, bring the active entry into the middle of the fly-out (instant — no smooth).
  useEffect(() => {
    if (!hover) return;
    requestAnimationFrame(() => {
      try { navRef.current?.querySelector('.wp-rail-list .is-active')?.scrollIntoView({ block: 'center' }); } catch {}
    });
  }, [hover]);

  if (hidden || !items || !items.length) return null;
  // TWO-LEVEL dashes: long = chapter, hairline = scene (scene texture, Docs-style). Long
  // docs collapse to chapters only so the stack never overflows its 72vh window.
  const markItems = items.length > 36 ? items.filter((it) => it.level === 0) : items;
  return (
    <nav
      ref={navRef}
      class={`wp-rail${hover ? ' is-open' : ''}`}
      aria-label="script outline"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <div class="wp-rail-marks" aria-hidden="true">
        {markItems.map((it) => (
          <span key={it.id} class={`wp-rail-mark lvl-${it.level}${it.id === activeId ? ' is-active' : ''}`} />
        ))}
      </div>
      {hover && (
        <div class="wp-rail-list">
          <div class="wp-outline-head"><span class="wp-outline-ttl">OUTLINE</span></div>
          {items.map((it) => (
            <button
              key={it.id}
              class={`wp-outline-item lvl-${it.level}${it.id === activeId ? ' is-active' : ''}`}
              title={it.title}
              onClick={() => jumpToOutlineId(it.id)}
            >
              {it.level === 0 && <span class="wp-outline-ord">{it.ord}</span>}
              <span class="wp-outline-txt">{it.title}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

// ── OUTLINE PANEL — slides out from the LEFT. Default hidden. Monochrome indented
// chapter/scene spine; scroll-spy marks the chapter currently in the reading band.
function OutlinePanel({ items, open, onClose }) {
  const activeId = useOutlineSpy(items);
  const jump = jumpToOutlineId;

  return (
    <aside class={`wp-outline${open ? ' is-open' : ''}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div class="wp-outline-head">
        <span class="wp-outline-ttl">OUTLINE</span>
        <button class="wp-outline-collapse" title="Collapse outline" aria-label="Collapse outline" tabindex={open ? 0 : -1} onClick={onClose}>‹</button>
      </div>
      <div class="wp-outline-list">
        {(!items || !items.length) && <div class="wp-outline-empty">OUTLINE · LOADING</div>}
        {(items || []).map((it) => (
          <button
            key={it.id}
            class={`wp-outline-item lvl-${it.level}${it.id === activeId ? ' is-active' : ''}`}
            title={it.title}
            tabindex={open ? 0 : -1}
            onClick={() => jump(it.id)}
          >
            {it.level === 0 && <span class="wp-outline-ord">{it.ord}</span>}
            <span class="wp-outline-txt">{it.title}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── COPY TOAST — a single shared dark pill. Every timecode copy (SOT LCD or B-roll
// string) dispatches `wp-toast` with the HH:MM:SS:FF value; this fades + translates up
// ~8px over ~160ms, holds, then auto-dismisses ~1.3s. Copy is the editor's primary
// action — this is the obvious, forgiving confirmation the spec asks for. FLAT.
function CopyToast() {
  const [tc, setTc] = useState(null);
  const [tone, setTone] = useState('ok'); // ux-01 — 'ok' (green COPIED) vs 'error' (red INVALID)
  const [lab, setLab] = useState('COPIED'); // restore-collab — ok toasts can carry their own label
  const [up, setUp] = useState(false);
  const hideTimer = useRef(null);
  const clearTimer = useRef(null);

  useEffect(() => {
    const onToast = (e) => {
      const d = e.detail || {};
      // ux-01 — an error toast carries { tone:'error', msg }; a copy carries { tc, tone:'ok' }. The
      // toast used to render every payload as a green "COPIED", so a REJECTED timecode edit looked
      // like a success the instant Johnny mistyped. Read the tone and surface a distinct red state.
      // restore-collab — an ok toast may also carry { msg, lab } (e.g. a live-room restore, which
      // has no reload to confirm it): render the msg with its own label instead of "COPIED".
      const isError = d.tone === 'error';
      const val = isError ? d.msg : (d.tc || d.msg);
      // Back-compat: a bare { tc } with no tone is still a copy.
      if (!val) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setTone(isError ? 'error' : 'ok');
      setLab(isError ? 'INVALID' : (d.tc ? 'COPIED' : (d.lab || 'DONE')));
      setTc(val);
      // next frame: flip to the raised/visible state so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      // Errors linger a touch longer — they ask Johnny to re-do something, not just confirm.
      // Sentence-length ok toasts (restore confirmations) get the longer hold too — they're read, not glanced.
      const hold = isError || !d.tc ? 2200 : 1300;
      hideTimer.current = setTimeout(() => setUp(false), hold);
      clearTimer.current = setTimeout(() => setTc(null), hold + 200);
    };
    window.addEventListener('wp-toast', onToast);
    return () => {
      window.removeEventListener('wp-toast', onToast);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  if (!tc) return null;
  const isError = tone === 'error';
  return (
    <div
      class={`wp-toast${up ? ' is-up' : ''}${isError ? ' is-error' : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span class="wp-toast-lab">{isError ? 'INVALID' : lab}</span>
      <span class="wp-toast-tc">{tc}</span>
    </div>
  );
}

// STARTUP-BANNER RACE: the broken-storage failure is detected BEFORE render() (in the migration
// block at the bottom of this file), but SaveStatus only attaches its wp-save-failed listener on
// MOUNT — so a pre-render dispatch is missed. We stash that initial failure here; SaveStatus reads
// it on first mount so the banner survives the gap between detection and listener attach.
let INITIAL_SAVE_FAILURE = null;

// ── SAVE STATUS — the cardinal-sin guard made visible. Data loss must NEVER be silent.
// Listens for the durable-save events the editor fires: `wp-dirty` (unsaved keystrokes in
// volatile state), `wp-saved` (a write landed AND passed the read-back invariant), and
// `wp-save-failed` (quota / private-mode / invariant / cross-tab-conflict failure). A failure
// raises a PERSISTENT, non-dismissable red banner so Johnny can never believe a save landed when
// it didn't. A SEPARATE, gentler `wp-stale-tab` signal (another tab saved a newer doc) shows a
// quiet amber "reload" notice — nothing was lost, the tab just needs to catch up.
// Relative-time label for the "saved" pill — "just now / 12s ago / 3m ago / 1h ago".
function relTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h + 'h ago';
}

// The pill's primary label. SAVING is the live state; once saved it tells Johnny WHERE the work
// lives so he is never guessing: green "SAVED TO CLOUD" when the cloud push confirmed, amber
// "SAVED ON THIS DEVICE · CLOUD OFFLINE" when the cloud was unreachable (work is still safe locally),
// and the plain "ALL CHANGES SAVED" before any push has happened (e.g. cloud table not set up yet).
function savedPillLabel(state, cloud) {
  // LOCAL-ONLY episodes (Palau) never touch the cloud, so the pill is calm + unambiguous: either a
  // brief "SAVING…" or a reassuring "ALL CHANGES SAVED". No cloud/offline/conflict wording ever.
  if (EPISODE.localOnly) return state === 'saving' ? 'SAVING…' : 'ALL CHANGES SAVED';
  // Conflict outranks everything except an in-progress save indicator: the cloud holds a newer doc
  // this device hasn't merged, so we must NOT claim "saved to cloud". Says reload, plainly.
  if (cloud === 'conflict') return 'NEWER VERSION ON CLOUD · RELOAD';
  if (state === 'saving') return 'SAVING…';
  // PENDING: the local save landed (work is safe here), but the cloud PUT is still in flight. Say so
  // honestly — never a premature green "SAVED TO CLOUD" while the push hasn't confirmed.
  if (cloud === 'syncing') return 'SYNCING TO CLOUD…';
  if (cloud === 'cloud') return 'SAVED TO CLOUD';
  if (cloud === 'offline') return 'SAVED ON THIS DEVICE · CLOUD OFFLINE';
  return 'ALL CHANGES SAVED';
}

function SaveStatus() {
  const [state, setState] = useState('saved'); // 'saving' | 'saved' | 'failed'
  const [failMsg, setFailMsg] = useState('');
  const [stale, setStale] = useState(false);
  const [savedAt, setSavedAt] = useState(null); // timestamp of the last verified save
  // CLOUD reachability of the LAST push: 'unknown' (no push yet) | 'cloud' (confirmed in cloud) |
  // 'offline' (local save landed, but the cloud was unreachable). This NEVER affects whether the
  // work is safe — the local save is authoritative — it only tells Johnny WHERE his work also lives.
  const [cloud, setCloud] = useState('unknown');
  // HOT-PATH PUSH-409 CONFLICT — another device advanced the cloud while this device was editing, so
  // this device's just-saved edit was NOT merged into the cloud. Sticky like 'failed': it must never
  // silently clear, and the pill must NEVER read "Saved to cloud" while it stands. Both docs are
  // already snapshotted to .conflict.<ts> by handlePushResult; this just surfaces the reload banner.
  const [cloudConflict, setCloudConflict] = useState(false);
  // SAME-USER conflict (wp-cloud-conflict-own) — the conflicting cloud version was written by the
  // SAME signed-in user (Johnny's own other tab / expired-token session). Data treatment upstream is
  // identical (snapshots + latch), but the UI must be CALM: a gentle amber "reload" note like the
  // cross-tab stale notice, never the alarming red ANOTHER-DEVICE banner. Sticky until reload for the
  // same reason cloudConflict is: pushes are latched, so the pill must not go green.
  const [ownConflict, setOwnConflict] = useState(false);
  // COLLAB ROOM SYNC — 'idle' (non-collab / synced), 'connecting' (editor mounted, initial sync
  // still in flight, editing gated off), 'stuck' (20s with no sync: auth failure / unreachable).
  // While connecting/stuck the editor is deliberately NON-editable (Editor.jsx sync gate), so the
  // pill must explain WHY typing does nothing — a silent dead page reads as data loss.
  const [collabSync, setCollabSync] = useState('idle');
  const [, setNowTick] = useState(0);           // forces the relative-time label to re-render

  useEffect(() => {
    // A failure stays sticky until a SUBSEQUENT save actually lands — never on a mere keystroke. A
    // `wp-dirty` does NOT clear it (more unsaved edits are still at risk), so dirty bails while failed.
    const onDirty = () => setState((s) => (s === 'failed' ? s : 'saving'));
    // SELF-HEALING (phase-4): `wp-saved` only fires after saveDoc's read-back invariant passed — i.e.
    // a write LANDED and verified. That is proof storage recovered (quota freed, private-mode gone),
    // so it is the one signal allowed to clear a standing 'failed': flip back to the normal saved pill
    // and drop the red banner WITHOUT a manual reload. (Quota-failed + stale-recovery self-heal; the
    // genuine cross-tab/cloud CONFLICT stays sticky-until-reload — it's tracked separately in `cloud`.)
    const onSaved = () => { setState('saved'); setFailMsg(''); setSavedAt(Date.now()); };
    // DEGRADED-DURABLE save (idb-only): fast localStorage was full so the edit landed ONLY in the
    // IndexedDB backstop — durable + recovers on reload, but NOT proof storage healed, so unlike
    // onSaved it must NOT clear a standing 'failed'. It only clears the transient 'saving' so the
    // pill can never hang on "SAVING…" after a durable degraded save. (wp-save-degraded had no
    // listener before — the pill hung indefinitely.)
    const onDegraded = () => { setState((s) => (s === 'failed' ? s : 'saved')); setSavedAt(Date.now()); };
    const onFailed = (e) => {
      setState('failed');
      setFailMsg(e.detail?.message || 'your edits are NOT being saved.');
    };
    // A cross-tab update doesn't mean THIS tab's save failed — it just means this tab is behind.
    // Flip the gentle stale notice; leave the tab's own save state intact.
    const onStale = () => setStale(true);
    // CLOUD push outcomes — the pill's "saved" label reflects WHERE the work lives.
    // A confirmed save clears any prior conflict ONLY if the cloud genuinely accepted us again
    // (a later, strictly-greater version push succeeded) — but to stay safe we keep the conflict
    // sticky until a reload reconciles; a fresh accepted push after reload starts a clean session.
    // Once a conflict is standing, do NOT let a stray saved/offline event paint over it — the device
    // is divergent until a reload reconciles, and a green "Saved to cloud" there would be the exact
    // false reassurance this fix removes. Conflict is sticky until the page reloads (fresh state).
    const onCloudSaved = () => setCloud((c) => (c === 'conflict' ? c : 'cloud'));
    const onCloudOffline = () => setCloud((c) => (c === 'conflict' ? c : 'offline'));
    // PENDING: a cloud PUT started. Show amber "SYNCING TO CLOUD…" until it confirms (wp-cloud-saved),
    // goes offline (wp-cloud-offline), or conflicts. Never override a sticky conflict.
    const onCloudSaving = () => setCloud((c) => (c === 'conflict' ? c : 'syncing'));
    // The two-device divergence. Sticky red-ish state: cloud := 'conflict', surface the reload banner.
    const onCloudConflict = () => { setCloud('conflict'); setCloudConflict(true); };
    // SAME-USER divergence — cloud state still flips to 'conflict' (the pill must honestly say
    // "NEWER VERSION ON CLOUD · RELOAD" and never a false green while pushes are latched), but the
    // banner is the CALM own-tab note, not the red alert.
    const onCloudConflictOwn = () => { setCloud('conflict'); setOwnConflict(true); };
    window.addEventListener('wp-dirty', onDirty);
    window.addEventListener('wp-saved', onSaved);
    window.addEventListener('wp-save-degraded', onDegraded);
    window.addEventListener('wp-save-failed', onFailed);
    window.addEventListener('wp-stale-tab', onStale);
    window.addEventListener('wp-cloud-saving', onCloudSaving);
    window.addEventListener('wp-cloud-saved', onCloudSaved);
    window.addEventListener('wp-cloud-offline', onCloudOffline);
    window.addEventListener('wp-cloud-conflict', onCloudConflict);
    const onCollabSync = (e) => {
      const s = e.detail?.state;
      setCollabSync(s === 'connecting' || s === 'stuck' ? s : 'idle');
    };
    window.addEventListener('wp-collab-sync', onCollabSync);
    window.addEventListener('wp-cloud-conflict-own', onCloudConflictOwn);
    // RACE FIX: consume a failure detected before this listener existed (pre-render startup).
    if (INITIAL_SAVE_FAILURE) {
      setState('failed');
      setFailMsg(INITIAL_SAVE_FAILURE.message || 'your edits are NOT being saved.');
      INITIAL_SAVE_FAILURE = null; // consumed once.
    }
    return () => {
      window.removeEventListener('wp-dirty', onDirty);
      window.removeEventListener('wp-saved', onSaved);
      window.removeEventListener('wp-save-degraded', onDegraded);
      window.removeEventListener('wp-save-failed', onFailed);
      window.removeEventListener('wp-stale-tab', onStale);
      window.removeEventListener('wp-cloud-saving', onCloudSaving);
      window.removeEventListener('wp-cloud-saved', onCloudSaved);
      window.removeEventListener('wp-cloud-offline', onCloudOffline);
      window.removeEventListener('wp-cloud-conflict', onCloudConflict);
      window.removeEventListener('wp-collab-sync', onCollabSync);
      window.removeEventListener('wp-cloud-conflict-own', onCloudConflictOwn);
    };
  }, []);

  // Tick the relative-time label ONLY while we're showing a "saved" timestamp — never a
  // perpetual timer. Cleared on state change + unmount.
  useEffect(() => {
    if (state !== 'saved' || savedAt == null) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state, savedAt]);

  if (state === 'failed') {
    return (
      <>
        <div class="wp-save-banner" role="alert" aria-live="assertive">
          <span class="wp-save-banner-lab">⚠ SAVE FAILED</span>
          <span class="wp-save-banner-msg">{failMsg} Export now (EXPORT button) to keep your work.</span>
        </div>
        {/* ux-06 — the corner pill agrees with the banner so the always-visible indicator never lies.
            In the FAILED state it now carries a REAL, clickable EXPORT button (pill is pointer-events:
            auto only when failed via .is-failed in CSS): it told Johnny to "EXPORT NOW" but, being
            pointer-events:none, offered no action — he had to hunt for the footer EXPORT himself. This
            fires the same wp-open-exports event the footer EXPORT does. DATA LOSS IS THE WORST OUTCOME,
            so the one indicator that must never be inert is now actionable. */}
        <div class="wp-save-pill is-failed" role="alert" aria-live="assertive">
          <span class="wp-save-pill-mark" />
          <span class="wp-save-pill-lab">SAVE FAILED</span>
          <button
            class="wp-save-pill-act"
            onClick={() => window.dispatchEvent(new CustomEvent('wp-open-exports'))}
            title="Export your script now to keep your work"
          >EXPORT NOW</button>
        </div>
      </>
    );
  }
  return (
    <>
      {cloudConflict && (
        <div class="wp-save-banner is-conflict" role="alert" aria-live="assertive">
          <span class="wp-save-banner-lab">↻ EDITED ON ANOTHER DEVICE</span>
          <span class="wp-save-banner-msg">
            another device saved a newer version of this script while you were editing — your latest
            change here was NOT merged to the cloud. Both versions are safely backed up. Reload to pull
            the newer version, then re-apply your change.
            {' '}
            <button class="wp-save-banner-act" onClick={() => location.reload()}>RELOAD</button>
          </span>
        </div>
      )}
      {ownConflict && !cloudConflict && (
        <div class="wp-save-banner is-stale" role="status" aria-live="polite">
          <span class="wp-save-banner-lab">↻ YOU EDITED THIS ELSEWHERE</span>
          <span class="wp-save-banner-msg">
            you saved a newer version of this script from another tab or session of your own — no one
            else touched it. Everything is safely backed up. Reload to keep going from the newest version.
            {' '}
            <button class="wp-save-banner-act" onClick={() => location.reload()}>RELOAD</button>
          </span>
        </div>
      )}
      {collabSync === 'stuck' && (
        <div class="wp-save-banner is-conflict" role="alert" aria-live="assertive">
          <span class="wp-save-banner-lab">⚠ CAN'T REACH THE LIVE ROOM</span>
          <span class="wp-save-banner-msg">
            this script lives in a shared live room and the connection didn't come up — editing is
            paused so nothing gets overwritten. Your script is safe in the cloud. Reload to retry;
            if it keeps happening, log out and back in.
            {' '}
            <button class="wp-save-banner-act" onClick={() => location.reload()}>RELOAD</button>
          </span>
        </div>
      )}
      {stale && (
        <div class="wp-save-banner is-stale" role="status" aria-live="polite">
          <span class="wp-save-banner-lab">↻ UPDATED IN ANOTHER TAB</span>
          <span class="wp-save-banner-msg">
            this script was changed in another tab — reload to get the latest. Your edits here are held back, not lost.
            {' '}
            <button class="wp-save-banner-act" onClick={() => location.reload()}>RELOAD</button>
          </span>
        </div>
      )}
      <div
        class={`wp-save-pill is-${state}${state === 'saved' && cloud === 'cloud' ? ' is-cloud' : ''}${state === 'saved' && cloud === 'offline' ? ' is-cloud-offline' : ''}${state === 'saved' && cloud === 'syncing' ? ' is-cloud-syncing' : ''}${cloud === 'conflict' ? ' is-cloud-conflict' : ''}${collabSync !== 'idle' ? ' is-collab-' + collabSync : ''}`}
        role="status"
        aria-live="polite"
      >
        <span class="wp-save-pill-mark" />
        <span class="wp-save-pill-lab">
          {collabSync === 'connecting' ? 'CONNECTING TO LIVE ROOM…'
            : collabSync === 'stuck' ? 'LIVE ROOM OFFLINE · RELOAD'
            : savedPillLabel(state, cloud)}
        </span>
        {collabSync === 'idle' && state === 'saved' && savedAt != null && (
          <span class="wp-save-pill-time">{relTime(savedAt)}</span>
        )}
      </div>
    </>
  );
}

// ── VERSION PILL — the stale-bundle beacon's quiet surface. When a deploy lands while this
// tab is open (version-beacon.js sees the page's asset signature change), a small pill offers
// a one-click reload. NEVER a modal, never auto-reloads (an auto-reload could eat an unsaved
// keystroke burst); the pill just sits there until clicked. Kills the "broken here, fine in a
// private window" class: that tell = this tab is running yesterday's bundle.
function VersionPill() {
  const [stale, setStale] = useState(false);
  useEffect(() => startVersionBeacon({ onStale: () => setStale(true) }), []);
  if (!stale) return null;
  return (
    <button
      class="wp-version-pill"
      onClick={() => location.reload()}
      title="A new version of the script tool shipped while this tab was open — click to reload"
    >
      <span class="wp-version-pill-mark" />
      NEW VERSION — RELOAD
    </button>
  );
}

// ── TIPS & TRICKS (feature C) — a tiny collapsed toggle in the pre-script zone that
// expands a short, plain-voice how-to. No marketing register — just the affordances.
const TIPS = [
  ['click a timecode', 'every HH:MM:SS:FF chip copies itself to your clipboard on click.'],
  ['click a yellow {tk} chip', 'opens the Workshop with 5 researched options to drop in.'],
  ['drag a block by its spine', 'grab the ⠿ grip on the left rail to reorder; click it for the block menu.'],
  ['the knobs on the left', 'change font, size, line-spacing and colour scheme — your reading, your way.'],
  ['the READ / EDIT switch up top', 'every visit starts safe in READ — flip to EDIT to type.'],
  ['⛶ on a chapter', 'opens just that chapter full screen. ESC or BACK TO SCRIPT returns instantly.'],
  ['right-click the ⊟ box → Bookmark', 'plants a ⚑ on that row and copies a link straight to that spot.'],
];

function TipsToggle() {
  const [open, setOpen] = useState(false);
  return (
    <div class={`wp-tips${open ? ' is-open' : ''}`}>
      <button
        class="wp-tips-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Hide tips' : 'Show tips'}
      >
        <span class="wp-tips-glyph">{open ? '–' : '?'}</span>
        <span class="wp-tips-lab">tips &amp; tricks</span>
      </button>
      <div class="wp-tips-body" aria-hidden={!open}>
        <ul class="wp-tips-list">
          {TIPS.map(([k, v]) => (
            <li key={k} class="wp-tips-item">
              <b>{k}</b> — {v}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── RECOVERY SURFACE (orphaned-snapshot discoverability) ─────────────────────────────────────────
// The adopt-cloud / cross-tab / 409 paths snapshot an unsynced local edit to a `.conflict.<ts>` (or
// `.bak.<ts>`) recovery key and THEN reload — which destroys the React banner that pointed at it. The
// bytes survive on disk but were reachable only through DevTools, which a dyslexic non-coder will
// never open. This banner runs the localStorage scan AT STARTUP and surfaces a persistent, plainly
// worded "you have an unsynced backup" affordance for each orphaned snapshot. It NEVER auto-restores
// (restoring over the live doc could itself lose work — the cardinal sin); instead it offers a
// read-only PREVIEW + DOWNLOAD .txt, then a DISMISS once Johnny has saved what he needs. Download
// reuses the same Blob plumbing the Exports panel uses, kept local here so this stands alone.
function downloadText(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 0);
    return true;
  } catch {
    return false;
  }
}

function recoveryFilename(snap) {
  const d = new Date(snap.ts || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${EPISODE.recoverPrefix}-${snap.kind}-${stamp}.txt`;
}

// True when the URL carries the ?backups flag (search OR hash-query, same parsing posture
// as read-mode's ?read) — the library's per-project BACKUPS entry sets it.
function showAdminBackups() {
  try {
    const { search = '', hash = '' } = window.location;
    return /[?&]backups\b/.test(search) || /[?&]backups\b/.test(hash.includes('?') ? hash.slice(hash.indexOf('?')) : '');
  } catch { return false; }
}

function RecoveryBanner({ getEditor = null }) {
  // LOCAL-ONLY episodes (Palau) can never have a cloud "newer version pulled in" conflict, so this
  // "unsynced backup found" banner is pure noise there — never show it. (EPISODE.localOnly is a
  // constant per entry, so this early return keeps the hook order consistent across renders.)
  if (EPISODE.localOnly) return null;
  // SYNCHRONOUS first paint from localStorage (legacy snapshots) so a recovery affordance shows
  // instantly without waiting on IndexedDB. Then an async pass reads BOTH stores (IDB + localStorage),
  // migrates legacy localStorage copies into IDB, and replaces the list with the merged/deduped set.
  // Phase 3 (recovery-idb): the heavy ~167KB snapshots now live in IDB, so the async pass is where the
  // full picture comes from; the sync pass is just the no-flicker placeholder for any legacy LS copy.
  const [snaps, setSnaps] = useState(() => {
    try { return scanRecoverySnapshots(); } catch { return []; }
  });
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState(null); // key of the snapshot currently being restored

  // SELF-HEALING (phase-4): the snapshot set was scanned ONCE at mount, so after the snapshots that
  // filled the quota were recovered/pruned/dismissed the banner lingered until a full reload (Johnny
  // had to clear it by hand). Re-run the async scan whenever the recovery picture could have changed:
  //   • `wp-saved`            — a verified save landed; quota-recovery may have pruned snapshots, so
  //                             the stale "unsynced backup" notice should disappear without a reload.
  //   • `wp-recovery-changed` — an explicit recover/clear/dismiss elsewhere; re-scan to reflect it.
  // The scan reads BOTH stores, so a banner that has nothing left to show returns [] and unmounts.
  // Crucially this does NOT touch the cross-tab/cloud CONFLICT banner (that one is reload-to-merge).
  useEffect(() => {
    let alive = true;
    let pending = false;
    const rescan = async () => {
      if (pending) return; // coalesce bursts (a save can fire wp-saved rapidly)
      pending = true;
      let merged = [];
      try { merged = await scanRecoverySnapshotsAsync(); } catch { merged = []; }
      pending = false;
      if (alive) setSnaps(merged);
    };
    rescan(); // initial full pass (replaces the sync placeholder with the merged IDB+LS set)
    if (typeof window !== 'undefined') {
      window.addEventListener('wp-saved', rescan);
      window.addEventListener('wp-recovery-changed', rescan);
    }
    return () => {
      alive = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('wp-saved', rescan);
        window.removeEventListener('wp-recovery-changed', rescan);
      }
    };
  }, []);

  if (!snaps || snaps.length === 0) return null;

  async function downloadOne(snap) {
    let doc = null;
    try { doc = await readSnapshotAsync(snap.key, { store: snap.store }); }
    catch { doc = readSnapshot(snap.key); }
    const text = snapshotToText(doc);
    const ok = downloadText(recoveryFilename(snap), text || '(this backup could not be read as text — open it from the file to inspect raw)');
    if (!ok) alert('Could not download the backup — your browser blocked the file save. Try again, or copy from the preview.');
  }
  function dismissOne(snap) {
    // Dismiss across BOTH stores (records the localStorage dismissal AND deletes the IDB copy).
    try { dismissSnapshotAsync(snap.key); } catch { dismissSnapshot(snap.key); }
    // Optimistic local removal for instant feedback (the last dismiss unmounts the banner — no reload).
    setSnaps((list) => list.filter((s) => s.key !== snap.key));
    // Broadcast so any other recovery surface re-syncs from the stores after the dismissal lands.
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wp-recovery-changed'));
    } catch {}
  }

  // RESTORE THIS VERSION — put a backed-up version back on screen, SAFELY. restoreSnapshot() backs up
  // the CURRENT live doc FIRST (so this can never cost Johnny what's on screen), then restores by
  // strategy: single-writer projects adopt through the canonical saveDoc path + reload; a LIVE collab
  // session gets the doc applied straight into the live editor (one user-initiated transaction — the
  // room converges, no reload); a collab project with an unreachable room is refused honestly.
  async function restoreOne(snap) {
    const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Restore this version? Your current copy is backed up first.')
      : true;
    if (!yes) return;
    setRestoring(snap.key);
    let result = null;
    try { result = await restoreSnapshot(snap, { getEditor }); } catch { result = { ok: false, reason: 'error' }; }
    // Single-writer success reloads the page, so reaching here means: collab-live success, or failure.
    setRestoring(null);
    if (result && result.ok) {
      try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'ok', lab: 'RESTORED', msg: 'version restored — the live room now shows it (everyone sees the change).' } }));
      } catch {}
      return;
    }
    const why = result && result.reason === 'backup-failed'
      ? 'could not back up your current copy first (storage is full) — nothing was changed. Free up space, then try again.'
      : result && result.reason === 'snapshot-unreadable'
        ? 'that backup could not be read. Try DOWNLOAD .TXT instead.'
        : result && result.reason === 'collab-unreachable'
          ? "can't restore while the live room is unreachable — reconnect (or reload), then try again."
          : result && result.reason === 'collab-apply-failed'
            ? 'restore could not be applied to the live editor — nothing changed (your current copy was backed up).'
            : 'restore did not complete — your current copy is unchanged.';
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: why } }));
    } catch {}
  }

  const n = snaps.length;
  return (
    <div class="wp-recovery-banner" role="status" aria-live="polite">
      <div class="wp-recovery-head">
        <span class="wp-recovery-lab">⤓ UNSYNCED BACKUP{n > 1 ? 'S' : ''} FOUND</span>
        <span class="wp-recovery-msg">
          {n === 1
            ? 'an earlier edit on this device was backed up before a newer version was pulled in. Nothing is lost — you can recover it here.'
            : `${n} earlier edits on this device were backed up before newer versions were pulled in. Nothing is lost — recover them here.`}
        </span>
        <button class="wp-recovery-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'HIDE' : 'SHOW'}
        </button>
      </div>
      {expanded && (
        <ul class="wp-recovery-list">
          {snaps.map((snap) => (
            <li key={snap.key} class="wp-recovery-item">
              <span class="wp-recovery-when">{relTime(snap.ts)}</span>
              <span class="wp-recovery-size">~{Math.max(1, Math.round(snap.bytes / 1024))} KB</span>
              <button
                class="wp-recovery-act is-restore"
                disabled={restoring === snap.key}
                onClick={() => restoreOne(snap)}
                title="Put this version back on screen — your current copy is backed up first"
              >{restoring === snap.key ? 'RESTORING…' : 'RESTORE THIS VERSION'}</button>
              <button class="wp-recovery-act" onClick={() => downloadOne(snap)}>DOWNLOAD .TXT</button>
              <button class="wp-recovery-act is-quiet" onClick={() => dismissOne(snap)} title="I've saved what I need — hide this">DISMISS</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── CLOUD VERSION HISTORY (restore any past cloud save) ──────────────────────────────────────────
// Wave 1's RecoveryBanner restores LOCAL-DEVICE snapshots. This panel restores the CLOUD history: every
// accepted cloud save appended a row to script_doc_revisions, so this lists them (newest first, who +
// when + version) and lets Johnny put ANY past cloud version back — through the SAME safe adopt path as
// the local restore (back up the current doc FIRST, then adopt + reload). It only appears for cloud-
// backed projects (Palau / local-only projects never touch the cloud, so there is no cloud history).
// Calm, deliberate "version browser" styling — paper/ink, NOT the green recovery ALARM: this is a tool
// you reach for, not a warning. FLAT, JetBrains-mono, on-brand.
function cloudApiBase() {
  try { return (EPISODE.cloud && EPISODE.cloud.api) || ''; } catch { return ''; }
}
function isCloudBackedProject() {
  if (EPISODE.localOnly) return false;
  return /\/api\/script-doc\b/.test(cloudApiBase());
}
// Pretty label for a revision's `source` column (autosave / adopt / seed / …). Falls back to a dash.
function revSourceLabel(src) {
  const s = String(src || '').trim();
  return s ? s.replace(/[_-]+/g, ' ') : '—';
}

function CloudHistoryPanel({ getEditor = null }) {
  // Gate: cloud-backed projects only. A constant per entry, so this early return keeps hook order stable.
  if (!isCloudBackedProject()) return null;
  const api = cloudApiBase();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revs, setRevs] = useState(null);        // null = never loaded, [] = loaded-empty
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(null); // id of the revision currently being restored

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(api + '&revisions=1', { headers: { Accept: 'application/json' } });
      if (!res || !res.ok) throw new Error('history fetch failed');
      const body = await res.json().catch(() => null);
      setRevs(Array.isArray(body?.revisions) ? body.revisions : []);
    } catch {
      setError('could not load the cloud history — check your connection and try again.');
      setRevs([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Lazy-load the list on first expand (metadata-only, so it's light) and on an explicit re-open after
    // an error, so a transient network blip can be retried without a page reload.
    if (next && !loading && (revs == null || error)) load();
  };

  async function restoreRev(rev) {
    const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Restore this cloud version? Your current copy is backed up first.')
      : true;
    if (!yes) return;
    setRestoring(rev.id);
    // 1. Fetch the chosen revision's FULL doc (the list carried metadata only).
    let doc = null;
    try {
      const res = await fetch(api + '&revision=' + encodeURIComponent(rev.id), { headers: { Accept: 'application/json' } });
      if (res && res.ok) { const body = await res.json().catch(() => null); doc = body?.doc ?? null; }
    } catch {}
    if (doc == null) {
      setRestoring(null);
      try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: 'could not fetch that version from the cloud — try again.' } })); } catch {}
      return;
    }
    // 2. Adopt through the SAME safe path the local restore uses (back up current FIRST, then restore
    //    by strategy: single-writer adopts + reloads; a live collab room gets it applied in place).
    let result = null;
    try { result = await restoreDoc(doc, { getEditor }); } catch { result = { ok: false, reason: 'error' }; }
    setRestoring(null); // single-writer success reloads — reaching here means collab-live success or failure.
    if (result && result.ok) {
      try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'ok', lab: 'RESTORED', msg: 'version restored — the live room now shows it (everyone sees the change).' } })); } catch {}
      return;
    }
    const why = result && result.reason === 'backup-failed'
      ? 'could not back up your current copy first (storage is full) — nothing changed. Free up space, then try again.'
      : result && result.reason === 'collab-unreachable'
        ? "can't restore while the live room is unreachable — reconnect (or reload), then try again."
        : result && result.reason === 'collab-apply-failed'
          ? 'restore could not be applied to the live editor — nothing changed (your current copy was backed up).'
          : 'restore did not complete — your current copy is unchanged.';
    try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: why } })); } catch {}
  }

  return (
    <div class={`wp-cloudhist${open ? ' is-open' : ''}`}>
      <button
        class="wp-cloudhist-toggle"
        aria-expanded={open}
        onClick={toggle}
        title={open ? 'Hide cloud version history' : 'Show cloud version history'}
      >
        <span class="wp-cloudhist-glyph">↺</span>
        <span class="wp-cloudhist-lab">CLOUD HISTORY</span>
      </button>
      {open && (
        <div class="wp-cloudhist-panel" role="region" aria-label="Cloud version history">
          <div class="wp-cloudhist-head">
            <span class="wp-cloudhist-ttl">CLOUD VERSION HISTORY</span>
            <button class="wp-cloudhist-refresh" onClick={load} disabled={loading} title="Refresh">
              {loading ? '…' : '⟳'}
            </button>
          </div>
          <p class="wp-cloudhist-note">
            every cloud save is kept. restore any version — your current copy is backed up first, so this
            is always safe.
          </p>
          {loading && (revs == null) && <div class="wp-cloudhist-empty">loading history…</div>}
          {error && <div class="wp-cloudhist-empty is-error">{error}</div>}
          {!loading && !error && revs != null && revs.length === 0 && (
            <div class="wp-cloudhist-empty">no cloud versions yet — history starts on your next save.</div>
          )}
          {revs != null && revs.length > 0 && (
            <ul class="wp-cloudhist-list">
              {revs.map((rev) => (
                <li key={rev.id} class="wp-cloudhist-item">
                  <span class="wp-cloudhist-when">{relTime(Date.parse(rev.created_at) || Date.now())}</span>
                  <span class="wp-cloudhist-ver">v{rev.version}</span>
                  <span
                    class="wp-cloudhist-who"
                    style={rev.user_color ? { color: rev.user_color } : undefined}
                    title={rev.user_id || ''}
                  >
                    {rev.user_name || (rev.user_id ? 'teammate' : revSourceLabel(rev.source))}
                  </span>
                  <button
                    class="wp-cloudhist-act is-restore"
                    disabled={restoring != null}
                    onClick={() => restoreRev(rev)}
                    title="Put this version back on screen — your current copy is backed up first"
                  >{restoring === rev.id ? 'RESTORING…' : 'RESTORE THIS VERSION'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── WORKSPACES — the per-craft cutout views (menu + hub + routing). ─────────────────────
// The masthead WORKSPACES menu opens a craft's workspace: the SAME editor, filtered to that
// craft's sections rendered as floating cutout cards (extensions/workspace-filter.js — the
// decoration-only paint). State rides the hash-query channel (#slug?ws=<key>, ws-route.js)
// so a workspace is a shareable deep link; in-session switching is replaceState only —
// no reload, no remount, collab session untouched.

// Rewrite the address bar to carry (or drop) the ws flag WITHOUT navigating. Slugged
// pages (#burma, library #<slug>) carry it in the hash-query; a hashless standalone door
// carries it in the search. The search copy is always scrubbed when the hash wins, so a
// stale ?ws= can never shadow the live hash flag (parse order is search-first).
function writeWsFlag(key) {
  try {
    const { pathname, search, hash } = window.location;
    if (hash && hash.length > 1) {
      history.replaceState(null, '', pathname + setWsInSearch(search, null) + setWsInHash(hash, key));
    } else {
      history.replaceState(null, '', pathname + setWsInSearch(search, key) + (hash || ''));
    }
  } catch {}
}

// One count line per craft: "5 SECTIONS · 214 ROWS" — live from scanWorkspace, computed
// LAZILY when the menu opens (never per keystroke; a 200-row doc scans in microseconds).
function wsCountLabel(c) {
  if (!c) return '—';
  if (!c.rows) return 'NO ROWS YET';
  return `${c.sections} SECTION${c.sections === 1 ? '' : 'S'} · ${c.rows} ROW${c.rows === 1 ? '' : 'S'}`;
}

// `placement` — 'masthead' (default) or 'sticky' (the slim scrolled-away strip). Same component,
// same state and handlers in both slots; the variant class only lets CSS nudge the popover to the
// right host. State that matters (the SELECTED workspace) lives in App via onPick, so a second
// mount here can never desync — only the local open/closed toggle differs per slot, and the two
// slots are never on screen together (masthead visible ⇔ strip hidden).
function WorkspacesMenu({ getDoc, onPick, placement = 'masthead' }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // Recompute on OPEN only — the menu is a glance, not a live meter.
    try {
      const doc = getDoc();
      if (!doc) return;
      const c = {};
      for (const r of WORKSPACE_ROLES) {
        const sections = scanWorkspace(doc, r.key);
        c[r.key] = { sections: sections.length, rows: sections.reduce((n, s) => n + s.rowCount, 0) };
      }
      setCounts(c);
    } catch {}
  };
  const pick = (key) => { setOpen(false); onPick(key); };
  return (
    <div class={`wp-wsmenu wp-wsmenu--${placement}${open ? ' is-open' : ''}`}>
      <button
        class="wp-wsmenu-toggle"
        aria-expanded={open}
        onClick={toggle}
        title={open ? 'Close the workspaces menu' : 'Open a craft workspace — the script filtered to one team’s work'}
      >
        <span class="wp-wsmenu-glyph" aria-hidden="true">▦</span>
        <span class="wp-wsmenu-lab">workspaces</span>
      </button>
      <div class="wp-wsmenu-body" aria-hidden={!open}>
        <div class="wp-wsmenu-head">CRAFT WORKSPACES</div>
        {WORKSPACE_ROLES.map((r) => (
          <button key={r.key} class="wp-wsmenu-item" onClick={() => pick(r.key)} title={`Open the ${r.label} workspace`}>
            <span class="wp-ws-chip" data-ws={r.key}>{r.label}</span>
            <span class="wp-wsmenu-count">{wsCountLabel(counts[r.key])}</span>
          </button>
        ))}
        <div class="wp-wsmenu-sep" />
        <button class="wp-wsmenu-item is-map" onClick={() => pick(WS_MAP_KEY)} title="Bird's-eye map of the whole script">
          <span class="wp-wsmenu-maplab">SCRIPT MAP</span>
          <span class="wp-wsmenu-count">WHOLE SCRIPT</span>
        </button>
      </div>
    </div>
  );
}

// ── STICKY HEADER — a slim strip that keeps the workspaces menu (and share) reachable once the
// real masthead has scrolled off. It appears ONLY when the masthead leaves the viewport
// (IntersectionObserver on .wp-masthead — no scroll listener, so no jank and no feedback loop:
// the strip lives at the very top and never touches the masthead's own intersection) and yields
// the top edge back whenever a workspace view or chapter-focus owns it (their bars are z-530; the
// strip is z-460, UNDER the centered READ/EDIT toggle at z-470 which floats above it, clear of the
// strip's end-hugged controls). The whole strip is absent in a ?read share. The one show/hide rule
// is stickyHeaderVisible() (sticky-header.js), tested headless. The workspaces menu and share are
// the SAME components as the masthead — a second placement, not a fork; the selected-workspace
// state lives in App, so nothing here can desync.
function StickyHeader({ title, readOnly, ws, chFocus, getDoc, onPick, project }) {
  const [mastheadVisible, setMastheadVisible] = useState(true);
  useEffect(() => {
    // A ?read share never mounts the owner masthead controls, so there's nothing to observe.
    if (readOnly) return undefined;
    const el = document.querySelector('.wp-masthead');
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => { const e = entries[0]; if (e) setMastheadVisible(e.isIntersecting); },
      { root: null, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [readOnly]);

  // Owner chrome only — a ?read viewer gets no strip at all (matches the masthead popovers).
  if (readOnly) return null;
  const show = stickyHeaderVisible({ mastheadVisible, readOnly, wsActive: !!ws, chFocusActive: !!chFocus });
  return (
    <div class="wp-stickyhead" data-show={show ? '' : undefined} aria-hidden={!show}>
      <span class="wp-stickyhead-title" title={title}>{title}</span>
      <span class="wp-stickyhead-spacer" />
      <WorkspacesMenu getDoc={getDoc} onPick={onPick} placement="sticky" />
      <ShareToggle project={project} />
    </div>
  );
}

// The hub above the editor while a craft workspace is active: the craft's chip, big, then
// one mono stat row. Metrics ride the SAME debounced/idle pipeline as telemetry — App
// recomputes them in an effect keyed on the telemetry state, so no second full-doc walk
// ever lands on the keystroke path. PENDING reads as the production manager's punch list:
// its counts ink in the alert red (CSS, keyed on data-ws-key).
function WorkspaceHub({ wsKey, metrics }) {
  const role = workspaceRole(wsKey);
  if (!role) return null;
  const m = metrics || { timedWords: 0, minutes: 0, sectionCount: 0, rowCount: 0 };
  return (
    <section class="wp-wshub" data-ws-key={wsKey} aria-label={`${role.label} workspace`}>
      <div class="wp-wshub-title">
        <span class="wp-ws-chip is-big" data-ws={wsKey}>{role.label}</span>
        <span class="wp-wshub-sub">WORKSPACE</span>
      </div>
      <div class="wp-wshub-stats">
        <span class="wp-wshub-stat"><b>{(m.timedWords || 0).toLocaleString()}</b> TIMED WORDS</span>
        <span class="wp-wshub-dot" aria-hidden="true">·</span>
        <span class="wp-wshub-stat"><b>{(m.minutes || 0).toFixed(1)}</b> MIN @130</span>
        <span class="wp-wshub-dot" aria-hidden="true">·</span>
        <span class="wp-wshub-stat"><b>{m.sectionCount || 0}</b> SECTION{m.sectionCount === 1 ? '' : 'S'}</span>
        <span class="wp-wshub-dot" aria-hidden="true">·</span>
        <span class="wp-wshub-stat"><b>{m.rowCount || 0}</b> ROW{m.rowCount === 1 ? '' : 'S'}</span>
        {wsKey === 'archive' && (
          <>
            <span class="wp-wshub-dot" aria-hidden="true">·</span>
            <span class="wp-wshub-stat is-done"><b>DONE {m.done || 0}/{m.total || 0}</b></span>
          </>
        )}
      </div>
      {m.rowCount === 0 && (
        <div class="wp-wshub-empty">no rows carry this craft yet — tag some work in the master script and it gathers here.</div>
      )}
      <div class="wp-wshub-foot">direction text not counted as time</div>
    </section>
  );
}

// ── READ / EDIT MODE SWITCH — the sticky top-center toggle (Johnny: "a sticky button that
// allows one to toggle between edit mode and read mode, and it starts in read mode"). Two flat
// segments, TE-hardware register: the active one is inked. Fixed, so it rides every scroll.
// Never mounted in a `?read` share — a reader has no edit mode to arm.
function ModeToggle({ edit }) {
  return (
    <div class="wp-mode" role="group" aria-label="read or edit mode">
      <button
        class={`wp-mode-seg${!edit ? ' is-active' : ''}`}
        aria-pressed={!edit}
        onClick={() => setEditMode(false)}
        title="Read mode — scroll and read, nothing can be typed or dragged"
      >READ</button>
      <button
        class={`wp-mode-seg${edit ? ' is-active' : ''}`}
        aria-pressed={edit}
        onClick={() => setEditMode(true)}
        title="Edit mode — the script is editable"
      >EDIT</button>
    </div>
  );
}

// ── BOOKMARK DEEP LINK — `?bm=<id>` (search or hash-query, same posture as ?read/?backups).
// The target row can render late (collab rooms sync after mount; cloud seeds after paint), so
// we poll gently for it and stop after ~30s. On find: scroll to center + a brief accent flash.
function bookmarkTargetFromUrl() {
  try {
    const { search = '', hash = '' } = window.location;
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    for (const qs of [search, hashQuery]) {
      if (!qs) continue;
      const params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
      const v = params.get('bm');
      if (v) return v;
    }
    return null;
  } catch { return null; }
}

// READ-ONLY SHARE BADGE (read-only-share) — the calm replacement for the save pill. A reader is never
// saving anything, so the always-visible status indicator says plainly what this view is: a shared,
// read-only copy of Johnny's live script. FLAT, JetBrains-mono, on-brand — no alarm, no action.
function ReadOnlyBadge() {
  return (
    <div class="wp-save-pill is-readonly" role="status" aria-live="polite">
      <span class="wp-save-pill-mark" />
      <span class="wp-save-pill-lab">READ-ONLY · SHARED VIEW</span>
    </div>
  );
}

function App({ readOnly = false, readOnlyDoc = null, recoveredDoc = null }) {
  const [tel, setTel] = useState(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const editorRef = useRef(null);
  // READ/EDIT MODE — mirror of the edit-mode module for rendering (the module is the truth;
  // this state just re-renders the switch + data-mode attr when the broadcast lands).
  const [editUi, setEditUi] = useState(isEditMode());
  // CHAPTER FOCUS — the focused chapter's blockId (null = normal full-script view).
  const [chFocus, setChFocus] = useState(null);
  const chScroll = useRef(0);       // scroll position to come back to — the "seamless" return
  const everFocused = useRef(false); // guards the restore effect from firing on plain mount
  // WORKSPACES — the active workspace key (null = master script). 'map' = the SCRIPT MAP
  // route (stage 4's non-editor view; the filter plugin ignores it by design).
  const [ws, setWs] = useState(null);
  const wsRef = useRef(null);        // mirror for handlers that must not re-subscribe on ws
  wsRef.current = ws;
  const [wsMetrics, setWsMetrics] = useState(null);
  const wsScroll = useRef(0);
  const everWs = useRef(false);
  const wsRole = ws ? workspaceRole(ws) : null;

  useEffect(() => {
    document.title = `${EPISODE.wordmark} · ${DOC_TITLE}`;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && EPISODE.favicon) icon.setAttribute('href', EPISODE.favicon);
  }, []);

  // Mark the whole document read-only so CSS can hide owner/library affordances from a viewer
  // (the static Library pill in index.html, etc.). index.html already sets this class inline from the
  // URL before first paint (no flash); this keeps it in lockstep if readOnly ever changes at runtime.
  useEffect(() => {
    try { document.documentElement.classList.toggle('read-only', !!readOnly); } catch {}
  }, [readOnly]);

  // Keep the switch UI in lockstep with the module (the module also gets set programmatically —
  // e.g. entering chapter focus arms EDIT).
  useEffect(() => {
    const onMode = (e) => setEditUi(!!(e.detail && e.detail.edit));
    window.addEventListener('wp-edit-mode', onMode);
    return () => window.removeEventListener('wp-edit-mode', onMode);
  }, []);

  // CHAPTER FOCUS — enter on the chapter cartridge's ⛶ (wp-chapter-focus event). Feeds the id
  // into the decoration plugin as a meta (no doc change, no reload), remembers where the scroll
  // was, and — since focusing a chapter is reaching for the pen — arms EDIT mode (never in a
  // `?read` share, which stays structurally frozen).
  useEffect(() => {
    const onFocus = (e) => {
      const id = e.detail && e.detail.id;
      const ed = editorRef.current;
      if (!id || !ed) return;
      chScroll.current = window.scrollY;
      try { ed.view.dispatch(ed.state.tr.setMeta(chapterFocusKey, { id })); } catch { return; }
      setChFocus(id);
      if (!readOnly) setEditMode(true);
    };
    window.addEventListener('wp-chapter-focus', onFocus);
    return () => window.removeEventListener('wp-chapter-focus', onFocus);
  }, [readOnly]);

  const exitChapterFocus = useCallback(() => {
    const ed = editorRef.current;
    try { ed?.view.dispatch(ed.state.tr.setMeta(chapterFocusKey, null)); } catch {}
    setChFocus(null);
  }, []);

  // Scroll choreography: entering focus starts the chapter at the top; exiting restores the
  // exact pre-focus position on the next frame (after the hidden rows have re-rendered) — the
  // "get back without reloading, seamless" contract.
  useEffect(() => {
    if (chFocus) { everFocused.current = true; window.scrollTo(0, 0); return undefined; }
    if (!everFocused.current) return undefined;
    const id = requestAnimationFrame(() => window.scrollTo(0, chScroll.current || 0));
    return () => cancelAnimationFrame(id);
  }, [chFocus]);

  // SCROLL MEMORY — a reload (browser refresh, or the in-editor rename reload) must keep you where
  // you were reading, not fling you to the top. The window is the scroll container. We persist
  // window.scrollY per script and restore it on mount AFTER the doc has laid out tall enough — the
  // content renders asynchronously, so an early scrollTo would clamp to the top. scrollRestoration
  // 'manual' stops the browser's own jump-then-guess. Defers to an explicit ?bm= bookmark deep link
  // and to chapter-focus (which owns its own scroll dance) so we never fight a deliberate jump.
  useEffect(() => {
    try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch {}
    const key = `wp_scroll_${EPISODE.id}`;
    let savedY = 0;
    try { savedY = Number(localStorage.getItem(key)) || 0; } catch {}

    let saveTimer = 0;
    const onScroll = () => {
      // Never overwrite the reading position while in chapter-focus OR a workspace — both
      // scroll to 0 then restore their pre-entry spot on exit; the page carries
      // data-chfocus / data-ws while they hold the screen.
      const page = document.querySelector('.wp-page');
      if (page?.hasAttribute('data-chfocus') || page?.hasAttribute('data-ws')) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(key, String(Math.round(window.scrollY))); } catch {}
      }, 150);
    };
    // Only start persisting AFTER we've restored (or decided not to), so the transient scrollY=0
    // of a still-short document during load can't clobber the saved position before we use it.
    const startSaving = () => window.addEventListener('scroll', onScroll, { passive: true });

    // Poll with setTimeout, NOT requestAnimationFrame — rAF is throttled/paused while the tab is
    // backgrounded, which would stall the restore (and never attach the save listener). setTimeout
    // keeps ticking. ~150 tries × 40ms ≈ 6s ceiling for the content to lay out tall enough.
    // RESTORE-AND-HOLD. A single early scrollTo doesn't stick — the doc reports full height almost
    // immediately, but a later boot step (focus/layout settle) yanks scroll back to 0. So we re-assert
    // the saved position on a setTimeout loop (setTimeout, not rAF — rAF pauses in a background tab),
    // correcting any reset, until it holds steady for a few ticks (or a ~2s ceiling). Then, and only
    // then, we start persisting scroll — so the transient 0 during boot can't overwrite the target.
    let pollTimer = 0;
    let tries = 0;
    let stable = 0;
    const skipRestore = savedY <= 0 || !!bookmarkTargetFromUrl();
    const restoreHold = () => {
      if (skipRestore) { startSaving(); return; }
      if (Math.abs(window.scrollY - savedY) > 2) { window.scrollTo(0, savedY); stable = 0; }
      else { stable += 1; }
      tries += 1;
      if (stable >= 5 || tries > 50) { startSaving(); return; } // held ~200ms, or ~2s cap
      pollTimer = setTimeout(restoreHold, 40);
    };
    restoreHold();

    return () => {
      clearTimeout(pollTimer);
      clearTimeout(saveTimer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // ESC exits focus — unless a floating menu is open (those own their Esc and close first).
  useEffect(() => {
    if (!chFocus) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A floating menu's capture-phase Esc closes it SYNCHRONOUSLY (the menu is out of the
      // DOM before this bubble listener runs) — but it calls preventDefault, so that is the
      // reliable "someone already consumed this Esc" signal (audit 2026-07-07).
      if (e.defaultPrevented) return;
      if (document.querySelector('.wp-rowmenu, .wp-addrows-menu, .wp-slash-menu, .wp-convert-menu, .wp-find')) return;
      exitChapterFocus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chFocus, exitChapterFocus]);

  // ── WORKSPACES — enter / exit / ESC / jump / deep link ─────────────────────────────
  // Entering a CRAFT workspace feeds the key into the filter plugin as a transaction meta
  // (decoration-only, no doc change, no reload — the chapter-focus pattern) and rewrites
  // the hash-query via replaceState. 'map' skips the plugin (stage 4 owns that view).
  // Never in a ?read share: the menu isn't mounted and the deep link is ignored (v1).
  const enterWorkspace = useCallback((key) => {
    if (readOnly) return;
    const role = workspaceRole(key);
    if (!role && key !== WS_MAP_KEY) return;
    const ed = editorRef.current;
    if (role) {
      if (!ed) return;
      try { ed.view.dispatch(ed.state.tr.setMeta(workspaceFilterKey, { key })); } catch { return; }
    } else if (ed) {
      // Switching straight from a craft workspace to the map clears the cutout paint.
      try { ed.view.dispatch(ed.state.tr.setMeta(workspaceFilterKey, null)); } catch {}
    }
    if (!wsRef.current) wsScroll.current = window.scrollY; // remember the master position once
    // SCRIPT MAP hides the editor (CSS) but keeps it mounted (collab session
    // untouched). Blur it so a stray keystroke can't edit the invisible doc.
    if (key === WS_MAP_KEY) { try { ed?.view?.dom?.blur(); } catch {} }
    setWs(key);
    writeWsFlag(key);
  }, [readOnly]);

  const exitWorkspace = useCallback(() => {
    const ed = editorRef.current;
    try { ed?.view.dispatch(ed.state.tr.setMeta(workspaceFilterKey, null)); } catch {}
    setWs(null);
    setWsMetrics(null);
    writeWsFlag(null);
  }, []);

  // Scroll choreography — same dance as chapter focus: enter at the top, exit restores
  // the exact master position on the next frame (after the hidden rows re-render).
  useEffect(() => {
    if (ws) { everWs.current = true; window.scrollTo(0, 0); return undefined; }
    if (!everWs.current) return undefined;
    const id = requestAnimationFrame(() => window.scrollTo(0, wsScroll.current || 0));
    return () => cancelAnimationFrame(id);
  }, [ws]);

  // ESC exits the workspace — chapter focus (if somehow active) and floating menus win first.
  useEffect(() => {
    if (!ws) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (chFocus) return; // chapter focus owns its own Esc
      if (document.querySelector('.wp-rowmenu, .wp-addrows-menu, .wp-slash-menu, .wp-convert-menu, .wp-find')) return;
      exitWorkspace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, chFocus, exitWorkspace]);

  // SECTION PILL JUMP (wp-ws-jump from the filter's meta pill): exit the workspace and
  // scroll the MASTER to that section's first row — resolved by firstBlockId AT CLICK
  // TIME via the DOM (the ?bm= deep-link pattern), never a stale index. The rAF seek
  // waits out the re-render that brings the hidden rows back.
  useEffect(() => {
    const onJump = (e) => {
      const id = e.detail && e.detail.blockId;
      everWs.current = false; // suppress the scroll-restore — the jump owns the landing
      exitWorkspace();
      if (!id) return;
      let tries = 0;
      const seek = () => {
        tries += 1;
        let node = null;
        try {
          const esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, '');
          node = document.querySelector(`[data-block-id="${esc}"]`);
        } catch {}
        if (node) {
          const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
          node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
          const row = node.closest('.wp-trow') || node;
          row.classList.add('wp-bm-target');
          setTimeout(() => { try { row.classList.remove('wp-bm-target'); } catch {} }, 2600);
          return;
        }
        if (tries < 30) requestAnimationFrame(seek);
      };
      requestAnimationFrame(seek);
    };
    window.addEventListener('wp-ws-jump', onJump);
    return () => window.removeEventListener('wp-ws-jump', onJump);
  }, [exitWorkspace]);

  // DEEP LINK — #slug?ws=<key> (search or hash-query). Enter once the editor is ready;
  // a collab room that syncs later just repaints the already-active filter (the plugin
  // rebuilds on every doc change). Ignored in ?read shares for v1.
  useEffect(() => {
    if (readOnly) return undefined;
    let target = null;
    try { target = parseWsFlag(window.location.search, window.location.hash); } catch {}
    if (!target) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (editorRef.current) {
        clearInterval(timer);
        enterWorkspace(target);
        return;
      }
      if (tries > 75) clearInterval(timer);
    }, 400);
    return () => clearInterval(timer);
  }, [readOnly, enterWorkspace]);

  // HUB METRICS — recomputed on the telemetry cadence (Editor.jsx already debounces +
  // idle-schedules the telemetry walk; this effect keys on that state landing), plus once
  // on entry. NO work while no workspace is active, and never on the keystroke path.
  useEffect(() => {
    if (!wsRole) return;
    const ed = editorRef.current;
    if (!ed) return;
    try { setWsMetrics(workspaceMetrics(ed.state.doc, ws)); } catch {}
  }, [tel, ws, wsRole]);

  // SCRIPT MAP MODEL — same cadence discipline as the hub metrics: recomputed only
  // while the map holds the screen, keyed on the telemetry debounce/idle state
  // (remote collab edits land in tel too, so the map tracks the live doc). One
  // full-doc walk per telemetry tick — microseconds at Burma scale (331 rows).
  const [wsMap, setWsMap] = useState(null);
  useEffect(() => {
    if (ws !== WS_MAP_KEY) { setWsMap(null); return; }
    const ed = editorRef.current;
    if (!ed) return;
    try { setWsMap(mapModel(ed.state.doc)); } catch {}
  }, [tel, ws]);

  // BOOKMARK DEEP LINK — poll for the ⚑ row (it can render late: collab sync, cloud seed),
  // then center + flash it once. Gives up quietly after ~30s.
  useEffect(() => {
    const target = bookmarkTargetFromUrl();
    if (!target) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      let node = null;
      try {
        const esc = (window.CSS && CSS.escape) ? CSS.escape(target) : target.replace(/["\\]/g, '');
        node = document.querySelector(`[data-bookmark-id="${esc}"]`);
      } catch {}
      if (node) {
        clearInterval(timer);
        const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        node.classList.add('wp-bm-target');
        setTimeout(() => { try { node.classList.remove('wp-bm-target'); } catch {} }, 2600);
      } else if (tries > 75) {
        clearInterval(timer);
      }
    }, 400);
    return () => clearInterval(timer);
  }, []);

  async function resetDoc() {
    // SACRED #1 — never wipe Johnny's fills without a recoverable copy. Snapshot the current
    // saved doc to a timestamped backup BEFORE removing it. snapshotDoc returns null when the
    // backup could not be written (quota / private mode) — in that case ABORT the reset rather
    // than destroy fills with no recovery copy. Only wipe if we know the snapshot landed (or
    // there was no saved doc to lose in the first place). palau-v2 (#4): ensureResetBackup gates on
    // the canonical NEWEST doc across ALL stores — sync `.z`/LS_DOC AND the async IndexedDB doc row —
    // so an IDB-only device (localStorage empty, doc only in IDB) still gets a must-land backup
    // before the wipe, instead of the sync-only reader seeing nothing and destroying the sole copy.
    let okToProceed = true;
    try { okToProceed = await ensureResetBackup(); } catch { okToProceed = false; }
    if (!okToProceed) {
      alert('RESET cancelled — could not back up your current script (storage full or blocked). Export first, then reset.');
      return;
    }
    // DL-05 — arm the reset reload guard BEFORE we remove the doc + reload. The reload fires
    // pagehide/beforeunload → flushSave → saveDoc; without this flag that teardown flush would
    // re-write the editor's in-memory (pre-reset) doc back to LS_DOC and RESURRECT what we just
    // reset (and re-push it to cloud). flushSave + saveDoc both early-return while this is set.
    setReloadingForReset();
    try { localStorage.removeItem(LS_DOC); } catch {}
    try { localStorage.removeItem(LS_DOC_FALLBACK); } catch {}
    // Clear the version + migration lineage too, so a (suppressed) resurrected write can't carry the
    // old version forward and a fresh-from-source doc re-runs migration cleanly on next load.
    try { localStorage.removeItem(LS_DOC_VER); } catch {}
    try { localStorage.removeItem(LS_MIGRATED); } catch {}
    try { await idbDeleteDoc(); } catch {}
    location.reload();
  }
  function openExports() { window.dispatchEvent(new CustomEvent('wp-open-exports')); }
  function insertFromFooter() {
    const ed = editorRef.current;
    if (!ed) return;
    ed.chain().focus('end').run();
    const { state } = ed;
    const end = state.doc.content.size;
    // TABLE SPINE — new blocks are inserted as a full-width ROW so the doc stays a uniform
    // stack of rows (tableRow > tableCell(full) > noneBlock). New blocks are BORN as `none`:
    // a chrome-less line with a faint pick-a-type hint until the writer picks a type.
    const none = state.schema.nodes.noneBlock.createAndFill({ blockId: 'blk_' + Math.random().toString(36).slice(2, 9) });
    const cell = none && state.schema.nodes.tableCell.createAndFill({ role: 'full' }, none);
    const row = cell && state.schema.nodes.tableRow.createAndFill({ cols: 1 }, cell);
    if (row) ed.view.dispatch(state.tr.insert(end, row).scrollIntoView());
  }

  const handleEditorReady = useCallback((ed) => {
    editorRef.current = ed;
  }, []);

  const words = tel?.words || 0;
  const blocks = tel?.blocks || 0;
  const sot = tel?.sot || 0;
  const done = tel?.done || 0;
  const scaffold = tel?.scaffold || 0;

  // CHAPTER FOCUS BAR — the focused chapter's title (from the live outline) + the way back.
  const focusItem = chFocus ? (tel?.outline || []).find((it) => it.id === chFocus) : null;

  return (
    <div
      class="wp-page"
      data-episode={EPISODE.id}
      data-daytc={EPISODE.features?.palauTimecodes ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-mode={!readOnly && editUi ? 'edit' : 'read'}
      data-chfocus={chFocus ? '' : undefined}
      data-ws={ws || undefined}
    >
      {ws && !chFocus && (
        <div class="wp-wsbar" role="region" aria-label="workspace">
          <button class="wp-wsbar-back" onClick={exitWorkspace} title="Back to the full script (Esc)">‹ BACK TO SCRIPT</button>
          <span class="wp-wsbar-lab">
            {wsRole ? `WORKSPACE · ${wsRole.label}` : 'SCRIPT MAP'}
          </span>
          <span class="wp-wsbar-hint">ESC TO EXIT</span>
        </div>
      )}
      {chFocus && (
        <div class="wp-chfocus-bar" role="region" aria-label="chapter focus">
          <button class="wp-chfocus-back" onClick={exitChapterFocus} title="Back to the full script (Esc)">‹ BACK TO SCRIPT</button>
          <span class="wp-chfocus-lab">
            CHAPTER FOCUS{focusItem ? ` · ${focusItem.ord ? focusItem.ord + ' — ' : ''}${focusItem.title}` : ''}
          </span>
          <span class="wp-chfocus-hint">ESC TO EXIT</span>
        </div>
      )}
      {!readOnly && <ModeToggle edit={editUi} />}
      {/* STICKY HEADER — carries workspaces + share once the masthead scrolls away (owner only;
          yields to the wsbar/chfocus bar). Reuses the SAME menu/share components as the masthead. */}
      {!readOnly && (
        <StickyHeader
          title={DOC_TITLE}
          readOnly={readOnly}
          ws={ws}
          chFocus={chFocus}
          getDoc={() => { try { return editorRef.current?.state?.doc || null; } catch { return null; } }}
          onPick={enterWorkspace}
          project={EPISODE.id}
        />
      )}
      <OutlinePanel items={tel?.outline} open={outlineOpen} onClose={() => setOutlineOpen(false)} />
      <OutlineRail items={tel?.outline} hidden={outlineOpen} />
      {/* Reading controls (font/size/scheme) stay in read-only — they help a dyslexic reader and
          touch nothing but CSS variables. Edit-only chrome below is what we strip. */}
      <ControlUnit outlineOpen={outlineOpen} />
      <RoleHub outlineOpen={outlineOpen} />

      <div class={`wp-device${outlineOpen ? ' outline-open' : ''}`}>
        {/* registration screws */}
        <span class="wp-screw tl"><i /></span>
        <span class="wp-screw tr"><i /></span>
        <span class="wp-screw bl"><i /></span>
        <span class="wp-screw br"><i /></span>

        {/* MASTHEAD (feature A) — the script's name, big + bold, the page headline. */}
        <div class="wp-masthead">
          <h1 class="wp-masthead-title">{DOC_TITLE}</h1>
          <div class="wp-masthead-meta">
            <span class="wp-masthead-tag">{readOnly ? 'SCRIPT · SHARED' : 'SCRIPT · DRAFT'}</span>
            {/* Tips are editing affordances ("drag a block", "click a {tk} chip") — hide for a reader. */}
            {!readOnly && <TipsToggle />}
            {/* WORKSPACES — gated exactly like the other masthead popovers (owner chrome). */}
            {!readOnly && (
              <WorkspacesMenu
                getDoc={() => { try { return editorRef.current?.state?.doc || null; } catch { return null; } }}
                onPick={enterWorkspace}
              />
            )}
            {!readOnly && <ShareToggle project={EPISODE.id} />}
            <ShortcutsOverlay />{/* ⌘/ help card — read-only chrome, works on ?read shares too */}
          </div>
        </div>

        {/* header */}
        <header class="wp-rack-head">
          <div class="wp-rack-id">
            <button
              class={`wp-outline-btn${outlineOpen ? ' is-open' : ''}`}
              onClick={() => setOutlineOpen((v) => !v)}
              title={outlineOpen ? 'Hide outline' : 'Show outline'}
            >
              <span class="wp-outline-glyph">{outlineOpen ? '‹' : '☰'}</span> OUTLINE
            </button>
            <span class="wp-wordmark">{EPISODE.wordmark}</span>
            <span class="wp-rack-fig">{EPISODE.figLabel}</span>
          </div>
          <div class="wp-telemetry">
            {words.toLocaleString()} WORDS · {blocks} BLOCKS · <span class="wp-tel-sot">{String(done).padStart(2, '0')}/{String(sot).padStart(2, '0')} SOT</span> · DRAFT
          </div>
        </header>

        {/* WORKSPACE HUB — the craft's dashboard, above the editor while a workspace is
            active. The SCRIPT MAP route renders its (stage-4) host instead of the hub. */}
        {wsRole && <WorkspaceHub wsKey={ws} metrics={wsMetrics} />}
        {ws === WS_MAP_KEY && (
          <div class={`wp-wsmap-host${wsMap ? ' is-live' : ''}`} id="wp-wsmap-host">
            {wsMap
              ? <ScriptMap model={wsMap} />
              : <span class="wp-wsmap-note">SCRIPT MAP — reading the script…</span>}
          </div>
        )}

        {/* the cartridge rack = the live editor. PRE-SCRIPT zone (masthead → setup NOTE
            boxes → ▸ SCRIPT BEGINS) is built INSIDE the doc: the leading scaffold bins now
            render as open NOTE boxes (is-scaffold) and a scriptStart divider node marks the
            start of the script. The scaffold count drives a quiet "author setup" caption. */}
        <main class="wp-rack">
          <div class="wp-rack-inner">
            {scaffold > 0 && (
              <div class="wp-prescript-cap" contenteditable={false}>
                <span class="wp-prescript-glyph">✎</span>
                <span class="wp-prescript-lab">AUTHOR SETUP · NOTES TO EDITOR</span>
              </div>
            )}
            <BurmaEditor
              sourceBlocks={SOURCE_BLOCKS}
              readOnlyDoc={readOnlyDoc}
              recoveredDoc={recoveredDoc}
              onTelemetry={setTel}
              onEditorReady={handleEditorReady}
            />
          </div>

          {/* footer affordance — INSERT / EXPORT / RESET are edit-only and are dropped in read-only.
              PRINT stays: the print/PDF path must still work from a shared read-only view. */}
          <div class="wp-rack-foot">
            {/* INSERT + RESET are WRITE affordances — they follow the READ/EDIT switch, not just
                the share gate, so read mode offers nothing that could change the script. */}
            {!readOnly && editUi && (
              <button class="wp-insert" onClick={insertFromFooter} title="Insert a block">
                <span class="wp-insert-box">+</span>
                <span class="wp-insert-lab">INSERT BLOCK — CHAPTER · VO · SOT · B-ROLL · NOTE</span>
              </button>
            )}
            <div class="wp-rack-foot-right">
              {!readOnly && <button class="wp-foot-btn" onClick={openExports} title="Export worklists">EXPORT</button>}
              <button class="wp-foot-btn" onClick={() => window.print()} title="Print / PDF">PRINT</button>
              {!readOnly && editUi && <button class="wp-foot-btn" onClick={resetDoc} title="Reset to source script">RESET</button>}
            </div>
          </div>
        </main>
      </div>

      {/* Exports dock (worklist generator) is edit-side tooling — omit for a reader. PRINT covers
          the shared-view print/PDF need. RecoveryBanner is edit-only (unsynced-backup recovery). */}
      {!readOnly && <Exports getDoc={() => editorRef.current?.getJSON() || { type: 'doc', content: [] }} docTitle={DOC_TITLE} />}
      <CopyToast />
      {readOnly ? <ReadOnlyBadge /> : <SaveStatus />}
      <VersionPill />
      {/* ADMIN BACKUPS (Johnny: "all of this is clutter… find another way to access backups
          from the library"). The recovery banner + cloud-history pill no longer live in the
          everyday editor — they mount ONLY when the project is opened through the library's
          BACKUPS entry (#slug?backups). The save/cloud STATUS pill is untouched — that's the
          one signal he wants always visible. */}
      {/* restore-collab: both restore surfaces get the live editor so a collab-flagged project can
          restore INTO the live room (one user-initiated transaction) instead of the silent
          adopt+reload no-op the Yjs room used to repaint right over. */}
      {!readOnly && showAdminBackups() && <RecoveryBanner getEditor={() => editorRef.current} />}
      {!readOnly && showAdminBackups() && <CloudHistoryPanel getEditor={() => editorRef.current} />}
    </div>
  );
}

function runStartupMigration() {
  try {
    const r = migrateStoredDoc();
    if (!r.ok) {
      console.warn('[burma] safe migration held back original doc:', r.reason, r.error || '');
      // STARTUP-BANNER RACE FIX: SaveStatus mounts during render() below, so a pre-render event would
      // be missed. Stash the broken-storage state here and let SaveStatus consume it on mount.
      if (/back up|unavailable/i.test(r.reason || '')) {
        INITIAL_SAVE_FAILURE = {
          kind: 'storage',
          message: 'storage is full or blocked — your edits will NOT be saved.',
        };
      }
    } else if (r.migrated) {
      console.info('[burma] safe migration applied + validated (backup:', r.bakKey + ')');
    }
    return r;
  } catch (e) {
    // Never let migration failure block the app — the editor's own ensureTableDoc still wraps at
    // render time as a fallback, and the original saved doc was never overwritten.
    console.warn('[burma] safe migration errored — original doc untouched:', e);
    return { ok: false, reason: 'migration threw', error: String(e) };
  }
}

// ── DOES THIS DEVICE HAVE A LOCAL DOC? ───────────────────────────────────────────────────────────
// The startup flow forks on this single question. A local doc means offline-first instant paint;
// no local doc means a fresh/incognito browser that must pull Johnny's real script from the cloud
// BEFORE the editor seeds (or the editor would seed from the bundled SOURCE — the reported bug).
// "Present and parseable" — a corrupt/empty blob is treated as "no usable local doc" so the cloud
// can still seed (seedDoc independently preserves the corrupt bytes to a .corrupt key, never loses).
// readLatestSavedRaw() is the startup sync reader here too, so a fresher `.z` crash-belt counts as
// "we have a local doc" even if LS_DOC itself is stale/empty after a quota-skipped fat write.
function hasUsableLocalDoc(resolved = null) {
  if (resolved?.renderable) return true;
  try {
    const raw = readLatestSavedRaw();
    if (!raw) return false;
    // CH-06 — single shared "renderable?" predicate (parseable + non-empty content). seedDoc and the
    // migrate base-gate use the SAME check, so "usable" means exactly one thing across startup.
    return isRenderableLocalDoc(raw);
  } catch {
    return false; // unparseable -> not usable here; cloud may seed, seedDoc preserves the bytes.
  }
}

// A minimal, on-brand pre-paint placeholder shown ONLY while we await the cloud on a fresh device.
// FLAT JetBrains-mono chrome over the #e7e1d3 page, matching the app's hardware aesthetic — never a
// spinner, never a logo flash. It is replaced the instant render(<App/>) runs (cloud answered) or
// we fall through to source. Mounted directly so it needs no React.
function mountCloudLoadingPlaceholder(el) {
  if (!el) return;
  el.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#e7e1d3;color:#1f1d18;' +
    "font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;\">" +
    '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;">' +
    '<span style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.55;">WP·01</span>' +
    '<span style="font-size:13px;letter-spacing:0.04em;opacity:0.8;">Loading your script…</span>' +
    '</div></div>';
}

// Shown when a share link is opened but the owner has turned sharing OFF (doc GET → 403 SHARING_OFF).
// A revoked link must land HERE, never on a stale bundled/local fallback — no old content leaks past a
// revoke. Plain, calm, no branding noise; the reader simply learns the link is no longer live.
function mountSharingOff(el) {
  if (!el) return;
  try { document.documentElement.classList.add('read-only'); } catch {}
  el.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;' +
    'background:#e7e1d3;color:#1f1d18;' +
    "font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;\">" +
    '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;text-align:center;">' +
    '<span style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.55;">Newpress · Script</span>' +
    '<span style="font-size:20px;font-weight:700;letter-spacing:0.01em;">This script is no longer shared</span>' +
    '<span style="font-size:13px;line-height:1.55;opacity:0.72;">The owner turned off link sharing for this script. If you need access, ask them to share it again.</span>' +
    '</div></div>';
}

// ── STARTUP ORCHESTRATION — deterministic, no flash of source on a fresh device ───────────────────
async function startup() {
  const el = document.getElementById('app');

  // SHARE-SAFETY (write-token provisioning). If Johnny opened his edit URL with `?key=SECRET`, stash the
  // secret into this device's localStorage and SCRUB it from the address bar — so every subsequent push
  // carries the write token the gated server requires, and the secret never lingers in the URL to be
  // shoulder-surfed or pasted into a `?read` share. Skipped under read-only (the recipient's device must
  // never acquire a write secret, even from a crafted `?key=` link). NEVER throws.
  try { captureWriteTokenFromUrl({ isReadOnly }); } catch {}

  // ── READ-ONLY SHARE PATH (read-only-share) ──────────────────────────────────────────────────────
  // `?read` / `?view` opens Johnny's script as a frozen, read-only shared view. We ALWAYS pull his
  // LATEST from the cloud (a recipient should never see a stale local copy) and render a non-editable
  // App with ZERO writes — no migration, no reconcile, no bootstrap-seed, no localStorage LS_DOC write,
  // no cloud PUT. If the cloud is unreachable, fall back to any local doc, else the bundled source, so
  // the link still renders something readable. saveDoc/pushDoc also refuse independently (defense in
  // depth), but this path simply never calls them.
  if (isReadOnly()) {
    mountCloudLoadingPlaceholder(el);
    let cloudDoc = null;
    let sharingOff = false;
    try {
      const r = await fetchCloudDocReadOnly({});
      if (r?.ok && r.doc) cloudDoc = r.doc;
      else if (r?.status === 403) sharingOff = true; // owner revoked link sharing
    } catch (e) {
      console.warn('[burma] read-only cloud fetch skipped:', e);
    }
    if (sharingOff) {
      // A revoked link: show the clear "no longer shared" screen and STOP — never fall back to a
      // bundled/local copy, which would leak stale content past the owner's revoke.
      console.info('[burma] read-only: link sharing is OFF for this script — showing revoked screen');
      mountSharingOff(el);
      return;
    }
    if (!cloudDoc) {
      // Cloud unreachable/empty — fall back to a local doc if one happens to exist on this device,
      // else BurmaEditor seeds from the bundled SOURCE_BLOCKS. Either way: still read-only, still no writes.
      try {
        const raw = localStorage.getItem(LS_DOC);
        if (raw) { const p = JSON.parse(raw); if (isRenderableLocalDoc(p)) cloudDoc = p; }
      } catch {}
      console.info('[burma] read-only: cloud unavailable — rendering from ' + (cloudDoc ? 'local cache' : 'source'));
    } else {
      console.info('[burma] read-only: rendering Johnny\'s latest cloud doc (frozen, no writes)');
    }
    render(<App readOnly readOnlyDoc={cloudDoc} />, el);
    return;
  }

  // #2 — DURABILITY: opt this origin into PERSISTENT storage ONCE per load, and prune the recovery
  // snapshots proactively if the quota is getting tight — BEFORE a save can throw QuotaExceededError,
  // not after catching the wall. Both are fire-and-forget and NEVER throw: persist() denial degrades
  // silently to best-effort (unchanged pre-#2 behavior), and the headroom prune only acts when the
  // estimate API reports low headroom. Kept off the read-only path — a recipient's device must not
  // request persistence for someone else's shared doc, and has no recovery store to prune.
  requestPersistentStorage().then((r) => {
    if (r && r.persisted) console.info('[burma] storage: persistent' + (r.already ? ' (already granted)' : ' (granted)'));
    else console.info('[burma] storage: best-effort (persist ' + ((r && r.reason) || 'unavailable') + ') — degrading gracefully');
  }).catch(() => {});
  pruneIfLowHeadroom(() => idbPruneGlobal()).then((p) => {
    if (p && p.low) console.info('[burma] storage headroom low (ratio ' + (p.ratio || 0).toFixed(2) + ') — pruned ' + p.pruned + ' recovery snapshot(s) before the wall');
  }).catch(() => {});

  // ── COLLAB (Phase 1) — Liveblocks + Yjs, behind the per-episode `collab` feature flag ─────────
  // When the flag is on, connect the realtime session BEFORE render so the editor mounts straight
  // onto the shared Y.Doc (canonical for the session). The single-writer reconcile/bootstrap
  // machinery below is SKIPPED in collab mode — its adopt-reload / conflict paths solve a problem
  // Yjs doesn't have — while all the LOCAL durability machinery (rehydrate, migration, recovery)
  // keeps running unchanged. If the runtime fails to load/connect, collabActive stays false and
  // this session falls back to the full single-writer engine — collab can never brick the editor.
  let collabActive = false;
  if (isCollabEnabled()) {
    try { collabActive = !!(await prepareCollab()); }
    catch (e) { console.warn('[burma] collab prepare failed — falling back to single-writer engine:', e); }
  }

  // BOOT READ SIDE (palau-v2) — recover the newest canonical doc BEFORE migration or render so a
  // quota-full edit parked in `.z`/IDB is the doc every downstream path reasons from on reload.
  let resolved = await rehydrateLocalFromNewest();
  // CLUNKY-RELOAD + FALSE "SAVE FAILED" FLASH (Johnny 2026-07-08): in a COLLAB session the Yjs
  // room is canonical and the local store is a demoted snapshot (healed by ensureTableDoc at
  // load — see table.js). The single-writer boot migration doesn't apply there, and because his
  // live doc carries a bare top-level node the migration's "already migrated" early-return never
  // fires — so it re-ran a full ~167KB parse/rewrite on EVERY reload (the "clunky reload"), and
  // its STEP-1 backup could fail on a tight origin and raise a big red "SAVE FAILED" banner that
  // the first real save cleared 1-2s later. Untrue AND slow. Skip it entirely in collab.
  if (!collabActive) runStartupMigration();
  // Migration may have rewritten the canonical bytes + version; resolve once more so the render
  // fork, recovered seed override, and first reconcile all reason from the post-migration newest doc.
  resolved = await rehydrateLocalFromNewest();
  const recoveredDoc = resolved?.renderable && !resolved?.lsReady ? resolved.doc : null;
  const recoveredRead = recoveredDoc ? () => ({
    hasDoc: true,
    version: resolved.version || 0,
    doc: resolved.doc,
  }) : null;
  const recoveredDiffers = recoveredDoc ? (otherDoc) => docsDiffer(recoveredDoc, otherDoc) : null;
  const recoveredSnapshot = recoveredDoc ? () => snapshotDocConflictAsync(recoveredDoc) : null;

  if (hasUsableLocalDoc(resolved)) {
    // OFFLINE-FIRST (unchanged behaviour). Render immediately from the local doc — instant, never
    // blocked on the network — then reconcile against the cloud in the BACKGROUND. The only branch
    // that ever reloads is adopt-cloud (cloud strictly newer); keep-local / noop never reload.
    //
    // IDB-ONLY RECOVERED BOOT (palau-v2): when the resolver found the freshest doc in IDB but quota
    // still blocked rehydrating LS_DOC/`.z`, recoveredRead feeds reconcile the recovered doc object
    // directly, and these two injected helpers keep the adopt guard on that SAME recovered content:
    // localDiffersFrom compares the recovered doc vs cloud, and snapshotConflict snapshots the
    // recovered bytes themselves. Without this, readLatestSavedRaw() can only see stale/empty sync
    // storage and the adopt path would diff/snapshot the wrong body on the exact quota-full reload.
    render(<App recoveredDoc={recoveredDoc} />, el);
    // LOCAL-ONLY (Palau): no cloud reconcile at all — the local doc IS the source of truth, so we
    // never fetch, never go "offline", and never snapshot a cloud conflict. Burma still reconciles.
    // COLLAB: the Y.Doc is canonical and the editor ignores the local doc — reconcile's adopt/reload
    // and keep-local-push would fight the room. Local stays a durability snapshot only.
    if (!EPISODE.localOnly && !collabActive) reconcileOnLoad({
      saveDoc,
      primeVersionFloor,
      ...(recoveredRead ? {
        readLocal: recoveredRead,
        readLiveLocal: recoveredRead,
        localDiffersFrom: recoveredDiffers,
        snapshotConflict: recoveredSnapshot,
      } : {}),
    })
      .then((r) => {
        if (r?.shouldReload) {
          console.info('[burma] cloud sync: adopted', r.action, '(v' + r.version + ') — reloading to re-seed');
          // ADOPT-CLOUD RELOAD RACE FIX (adopt-cloud-reload-race): the cloud doc is already written
          // to disk and is canonical; the editor's in-memory state still holds this device's STALE
          // local doc. location.reload() fires pagehide/beforeunload, which the editor turns into a
          // flushSave -> saveDoc of that stale local doc. At this point the on-disk version equals
          // this tab's knownBaseVersion, so the cross-tab guard would NOT catch it — the stale local
          // doc would clobber the just-adopted cloud doc and the newer device's work would be lost.
          // Arm the suppress-flush guard BEFORE triggering the reload so the teardown flush is
          // refused; the reload then re-seeds the editor cleanly from the adopted cloud doc.
          setReloadingForAdopt();
          location.reload();
        }
      })
      .catch((e) => console.warn('[burma] cloud sync reconcile skipped:', e));
    return;
  }

  // FRESH DEVICE + COLLAB — no local doc, but the editor's content comes from the synced Y.Doc
  // (seeded once from the cloud inside the collab path), so the single-writer cloud bootstrap
  // below is unnecessary and its local seed-write could only confuse the snapshot machinery.
  // Render immediately; the room fills the editor as sync arrives.
  if (collabActive) {
    console.info('[burma] collab: fresh device — rendering straight onto the shared room (no bootstrap)');
    render(<App />, el);
    return;
  }

  // FRESH / INCOGNITO DEVICE — no usable local doc. AWAIT the cloud BEFORE the first paint so the
  // editor seeds Johnny's real cloud script, not the bundled source. While awaiting, show the flat
  // "Loading your script…" placeholder. If the cloud answers cleanly with a doc, bootstrapFromCloud
  // writes it locally (primeVersionFloor → saveDoc) and we render(<App/>) — seedDoc then picks up the
  // freshly-written cloud doc on the FIRST frame: no reload, no flash of source. If the cloud is
  // empty / unreachable / table-missing, we render from source exactly as before (graceful).
  mountCloudLoadingPlaceholder(el);
  let seeded = false;
  try {
    const r = await bootstrapFromCloud({ saveDoc, primeVersionFloor });
    seeded = !!r?.seeded;
  } catch (e) {
    console.warn('[burma] cloud bootstrap skipped:', e);
  }
  if (seeded) {
    console.info('[burma] cloud bootstrap: seeded cloud doc before paint — rendering from cloud');
  } else {
    console.info('[burma] cloud bootstrap: no cloud doc available — rendering from source');
  }
  // Render either way. seedDoc reads localStorage fresh: if bootstrap seeded, it finds the cloud doc;
  // otherwise it builds from SOURCE_BLOCKS (the prior, unchanged fresh-device behaviour).
  render(<App />, el);
}

startup();
