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
import { captureWriteTokenFromUrl } from './write-token.js';
import { requestPersistentStorage, pruneIfLowHeadroom } from './storage-persist.js';
import { idbPruneGlobal } from './recovery-store.js';
import { scanRecoverySnapshots, scanRecoverySnapshotsAsync, readSnapshot, readSnapshotAsync, snapshotToText, dismissSnapshot, dismissSnapshotAsync } from './recovery.js';
import { idbDeleteDoc } from './recovery-store.js';
import { restoreSnapshot } from './restore.js';
import { getEpisode } from './episode-config.js';

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

// ── OUTLINE PANEL — slides out from the LEFT. Default hidden. Monochrome indented
// chapter/scene spine; scroll-spy marks the chapter currently in the reading band.
function OutlinePanel({ items, open, onClose }) {
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

  const jump = (id) => {
    const node = document.querySelector(`[data-block-id="${id}"]`);
    if (!node) return;
    // L4 — honor prefers-reduced-motion: jump instantly instead of smooth-scrolling for users who
    // asked the OS to reduce motion (smooth-scroll across a 225-block doc is a vestibular trigger).
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

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
  const [up, setUp] = useState(false);
  const hideTimer = useRef(null);
  const clearTimer = useRef(null);

  useEffect(() => {
    const onToast = (e) => {
      const d = e.detail || {};
      // ux-01 — an error toast carries { tone:'error', msg }; a copy carries { tc, tone:'ok' }. The
      // toast used to render every payload as a green "COPIED", so a REJECTED timecode edit looked
      // like a success the instant Johnny mistyped. Read the tone and surface a distinct red state.
      const isError = d.tone === 'error';
      const val = isError ? d.msg : d.tc;
      // Back-compat: a bare { tc } with no tone is still a copy.
      if (!val) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setTone(isError ? 'error' : 'ok');
      setTc(val);
      // next frame: flip to the raised/visible state so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      // Errors linger a touch longer — they ask Johnny to re-do something, not just confirm.
      const hold = isError ? 2200 : 1300;
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
      <span class="wp-toast-lab">{isError ? 'INVALID' : 'COPIED'}</span>
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
    window.addEventListener('wp-dirty', onDirty);
    window.addEventListener('wp-saved', onSaved);
    window.addEventListener('wp-save-degraded', onDegraded);
    window.addEventListener('wp-save-failed', onFailed);
    window.addEventListener('wp-stale-tab', onStale);
    window.addEventListener('wp-cloud-saving', onCloudSaving);
    window.addEventListener('wp-cloud-saved', onCloudSaved);
    window.addEventListener('wp-cloud-offline', onCloudOffline);
    window.addEventListener('wp-cloud-conflict', onCloudConflict);
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
        class={`wp-save-pill is-${state}${state === 'saved' && cloud === 'cloud' ? ' is-cloud' : ''}${state === 'saved' && cloud === 'offline' ? ' is-cloud-offline' : ''}${state === 'saved' && cloud === 'syncing' ? ' is-cloud-syncing' : ''}${cloud === 'conflict' ? ' is-cloud-conflict' : ''}`}
        role="status"
        aria-live="polite"
      >
        <span class="wp-save-pill-mark" />
        <span class="wp-save-pill-lab">{savedPillLabel(state, cloud)}</span>
        {state === 'saved' && savedAt != null && (
          <span class="wp-save-pill-time">{relTime(savedAt)}</span>
        )}
      </div>
    </>
  );
}

// ── TIPS & TRICKS (feature C) — a tiny collapsed toggle in the pre-script zone that
// expands a short, plain-voice how-to. No marketing register — just the affordances.
const TIPS = [
  ['click a timecode', 'every HH:MM:SS:FF chip copies itself to your clipboard on click.'],
  ['click a yellow {tk} chip', 'opens the Workshop with 5 researched options to drop in.'],
  ['drag a block by its spine', 'grab the ⠿ grip on the left rail to reorder; click it for the block menu.'],
  ['the knobs on the left', 'change font, size, line-spacing and colour scheme — your reading, your way.'],
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

function RecoveryBanner() {
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
  // the CURRENT live doc FIRST (so this can never cost Johnny what's on screen), then adopts the chosen
  // snapshot through the canonical saveDoc path and reloads so the editor re-seeds from it. A confirm
  // step guards the (reversible, but disruptive) reload.
  async function restoreOne(snap) {
    const yes = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('Restore this version? Your current copy is backed up first.')
      : true;
    if (!yes) return;
    setRestoring(snap.key);
    let result = null;
    try { result = await restoreSnapshot(snap); } catch { result = { ok: false, reason: 'error' }; }
    // restoreSnapshot reloads the page on success, so we only reach here on failure/abort.
    setRestoring(null);
    if (!result || !result.ok) {
      const why = result && result.reason === 'backup-failed'
        ? 'could not back up your current copy first (storage is full) — nothing was changed. Free up space, then try again.'
        : result && result.reason === 'snapshot-unreadable'
          ? 'that backup could not be read. Try DOWNLOAD .TXT instead.'
          : 'restore did not complete — your current copy is unchanged.';
      try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone: 'error', msg: why } }));
      } catch {}
    }
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

  useEffect(() => {
    document.title = `${EPISODE.wordmark} · ${DOC_TITLE}`;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && EPISODE.favicon) icon.setAttribute('href', EPISODE.favicon);
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

  return (
    <div class="wp-page" data-episode={EPISODE.id} data-readonly={readOnly ? '' : undefined}>
      <OutlinePanel items={tel?.outline} open={outlineOpen} onClose={() => setOutlineOpen(false)} />
      {/* Reading controls (font/size/scheme) stay in read-only — they help a dyslexic reader and
          touch nothing but CSS variables. Edit-only chrome below is what we strip. */}
      <ControlUnit outlineOpen={outlineOpen} />

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
            {!readOnly && (
              <button class="wp-insert" onClick={insertFromFooter} title="Insert a block">
                <span class="wp-insert-box">+</span>
                <span class="wp-insert-lab">INSERT BLOCK — CHAPTER · VO · SOT · B-ROLL · NOTE</span>
              </button>
            )}
            <div class="wp-rack-foot-right">
              {!readOnly && <button class="wp-foot-btn" onClick={openExports} title="Export worklists">EXPORT</button>}
              <button class="wp-foot-btn" onClick={() => window.print()} title="Print / PDF">PRINT</button>
              {!readOnly && <button class="wp-foot-btn" onClick={resetDoc} title="Reset to source script">RESET</button>}
            </div>
          </div>
        </main>
      </div>

      {/* Exports dock (worklist generator) is edit-side tooling — omit for a reader. PRINT covers
          the shared-view print/PDF need. RecoveryBanner is edit-only (unsynced-backup recovery). */}
      {!readOnly && <Exports getDoc={() => editorRef.current?.getJSON() || { type: 'doc', content: [] }} docTitle={DOC_TITLE} />}
      <CopyToast />
      {readOnly ? <ReadOnlyBadge /> : <SaveStatus />}
      {!readOnly && <RecoveryBanner />}
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
    try {
      const r = await fetchCloudDocReadOnly({});
      if (r?.ok && r.doc) cloudDoc = r.doc;
    } catch (e) {
      console.warn('[burma] read-only cloud fetch skipped:', e);
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

  // BOOT READ SIDE (palau-v2) — recover the newest canonical doc BEFORE migration or render so a
  // quota-full edit parked in `.z`/IDB is the doc every downstream path reasons from on reload.
  let resolved = await rehydrateLocalFromNewest();
  runStartupMigration();
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
    if (!EPISODE.localOnly) reconcileOnLoad({
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
