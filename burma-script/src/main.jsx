// Burma Script Tool — app entry (WP-01 · CARTRIDGES).
// fig.03 CARTRIDGE RACK. Every script block is a tactile hardware CARTRIDGE inside a warm
// outlined DEVICE FRAME (max-width 1040px, #efeadd paper, 2px ink border, registration-screw
// corner marks) over an #e7e1d3 page. Header = WP·01 wordmark + "fig.03 — CARTRIDGE RACK" +
// telemetry. Footer = "+ INSERT BLOCK …". FLAT — no shadow, no bevel; JetBrains Mono chrome,
// sans prose. A hidden OUTLINE panel slides out from the LEFT (default collapsed).

import { render } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { BurmaEditor, LS_DOC } from './Editor.jsx';
import { Exports } from './Exports.jsx';
import { migrateStoredDoc, snapshotDoc } from './migrate-doc.js';
import scriptData from '../sample-blocks.json';

const SOURCE_BLOCKS = scriptData.blocks || [];
const DOC_TITLE = scriptData.title || 'Burma — The Human Element';

// ── THE CONTROL UNIT (feature E) — reading instrument ────────────────────────
// A sticky LEFT panel, flat fig.01 box with Teenage-Engineering tactile knobs that
// drive CSS variables on .wp-page: TEXT SIZE, LEAD (line-height), a 9-font reading
// selector (serif + sans), and a tasteful-neutral COLOR SCHEME flipper. Everything
// persists to localStorage and re-skins the whole instrument instantly. The unit
// collapses into a small TE knob icon and re-expands with a smooth ~200ms ease.
const LS_CTRL = 'wp01.controls.v1';

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
const DEFAULTS = { size: 16, lead: 1.62, font: 'newsreader', scheme: 'sepia', collapsed: false };

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
    page.setAttribute('data-scheme', s.scheme);
    // mirror scheme onto <html> so the body/overscroll area re-skins too
    document.documentElement.setAttribute('data-scheme', s.scheme);
    try { localStorage.setItem(LS_CTRL, JSON.stringify(s)); } catch {}
  }, [s.font, s.size, s.lead, s.scheme, s.collapsed]);

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
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const [up, setUp] = useState(false);
  const hideTimer = useRef(null);
  const clearTimer = useRef(null);

  useEffect(() => {
    const onToast = (e) => {
      const val = e.detail?.tc;
      if (!val) return;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      setTc(val);
      // next frame: flip to the raised/visible state so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
      hideTimer.current = setTimeout(() => setUp(false), 1300);
      clearTimer.current = setTimeout(() => setTc(null), 1300 + 200);
    };
    window.addEventListener('wp-toast', onToast);
    return () => {
      window.removeEventListener('wp-toast', onToast);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  if (!tc) return null;
  return (
    <div class={`wp-toast${up ? ' is-up' : ''}`} role="status" aria-live="polite">
      <span class="wp-toast-lab">COPIED</span>
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
function SaveStatus() {
  const [state, setState] = useState('saved'); // 'saved' | 'unsaved' | 'failed'
  const [failMsg, setFailMsg] = useState('');
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const onDirty = () => setState((s) => (s === 'failed' ? s : 'unsaved'));
    const onSaved = () => setState((s) => (s === 'failed' ? s : 'saved'));
    const onFailed = (e) => {
      setState('failed');
      setFailMsg(e.detail?.message || 'your edits are NOT being saved.');
    };
    // A cross-tab update doesn't mean THIS tab's save failed — it just means this tab is behind.
    // Flip the gentle stale notice; leave the tab's own save state intact.
    const onStale = () => setStale(true);
    window.addEventListener('wp-dirty', onDirty);
    window.addEventListener('wp-saved', onSaved);
    window.addEventListener('wp-save-failed', onFailed);
    window.addEventListener('wp-stale-tab', onStale);
    // RACE FIX: consume a failure detected before this listener existed (pre-render startup).
    if (INITIAL_SAVE_FAILURE) {
      setState('failed');
      setFailMsg(INITIAL_SAVE_FAILURE.message || 'your edits are NOT being saved.');
      INITIAL_SAVE_FAILURE = null; // consumed once.
    }
    return () => {
      window.removeEventListener('wp-dirty', onDirty);
      window.removeEventListener('wp-saved', onSaved);
      window.removeEventListener('wp-save-failed', onFailed);
      window.removeEventListener('wp-stale-tab', onStale);
    };
  }, []);

  if (state === 'failed') {
    return (
      <div class="wp-save-banner" role="alert" aria-live="assertive">
        <span class="wp-save-banner-lab">⚠ SAVE FAILED</span>
        <span class="wp-save-banner-msg">{failMsg} Export now (EXPORT button) to keep your work.</span>
      </div>
    );
  }
  return (
    <>
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
      <div class={`wp-save-dot is-${state}`} role="status" aria-live="polite" title={state === 'unsaved' ? 'Unsaved changes' : 'Saved'}>
        <span class="wp-save-dot-mark" />
        <span class="wp-save-dot-lab">{state === 'unsaved' ? 'UNSAVED' : 'SAVED'}</span>
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

function App() {
  const [tel, setTel] = useState(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const editorRef = useRef(null);

  function resetDoc() {
    // SACRED #1 — never wipe Johnny's fills without a recoverable copy. Snapshot the current
    // saved doc to a timestamped backup BEFORE removing it. snapshotDoc returns null when the
    // backup could not be written (quota / private mode) — in that case ABORT the reset rather
    // than destroy fills with no recovery copy. Only wipe if we know the snapshot landed (or
    // there was no saved doc to lose in the first place).
    let saved = null;
    try { saved = localStorage.getItem(LS_DOC); } catch {}
    if (saved) {
      let bak = null;
      try { bak = snapshotDoc(); } catch {}
      if (!bak) {
        alert('RESET cancelled — could not back up your current script (storage full or blocked). Export first, then reset.');
        return;
      }
    }
    try { localStorage.removeItem(LS_DOC); } catch {}
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
    // stack of rows (tableRow > tableCell(full) > voBlock).
    const vo = state.schema.nodes.voBlock.createAndFill({ blockId: 'blk_' + Math.random().toString(36).slice(2, 9), status: 'todo' });
    const cell = vo && state.schema.nodes.tableCell.createAndFill({ role: 'full' }, vo);
    const row = cell && state.schema.nodes.tableRow.createAndFill({ cols: 1 }, cell);
    if (row) ed.view.dispatch(state.tr.insert(end, row).scrollIntoView());
  }

  const words = tel?.words || 0;
  const blocks = tel?.blocks || 0;
  const sot = tel?.sot || 0;
  const done = tel?.done || 0;
  const scaffold = tel?.scaffold || 0;

  return (
    <div class="wp-page">
      <OutlinePanel items={tel?.outline} open={outlineOpen} onClose={() => setOutlineOpen(false)} />
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
            <span class="wp-masthead-tag">SCRIPT · DRAFT</span>
            <TipsToggle />
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
            <span class="wp-wordmark">WP·<b>01</b></span>
            <span class="wp-rack-fig">fig.03 — CARTRIDGE RACK</span>
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
              onTelemetry={setTel}
              onEditorReady={(ed) => { editorRef.current = ed; }}
            />
          </div>

          {/* footer affordance */}
          <div class="wp-rack-foot">
            <button class="wp-insert" onClick={insertFromFooter} title="Insert a block">
              <span class="wp-insert-box">+</span>
              <span class="wp-insert-lab">INSERT BLOCK — CHAPTER · VO · SOT · B-ROLL · NOTE</span>
            </button>
            <div class="wp-rack-foot-right">
              <button class="wp-foot-btn" onClick={openExports} title="Export worklists">EXPORT</button>
              <button class="wp-foot-btn" onClick={() => window.print()} title="Print / PDF">PRINT</button>
              <button class="wp-foot-btn" onClick={resetDoc} title="Reset to source script">RESET</button>
            </div>
          </div>
        </main>
      </div>

      <Exports getDoc={() => editorRef.current?.getJSON() || { type: 'doc', content: [] }} docTitle={DOC_TITLE} />
      <CopyToast />
      <SaveStatus />
    </div>
  );
}

// SACRED #1 — SAFE MIGRATION (tbl-dim-migrate). Run ONCE before the editor mounts: back up
// Johnny's saved doc, wrap pre-table flat blocks into full-width rows, validate (text-equality
// + live-schema round-trip), and only persist the rowed doc on success — otherwise keep the
// original untouched. Version-gated + idempotent, so a healthy doc is never re-wrapped. The
// editor then seeds the already-migrated doc; its downstream ensureTableDoc is a clean no-op.
try {
  const r = migrateStoredDoc();
  if (!r.ok) {
    console.warn('[burma] safe migration held back original doc:', r.reason, r.error || '');
    // If migration was held back for a STORAGE reason (can't back up / unavailable), storage is
    // broken — every downstream autosave will fail too. Make that loud + visible up front rather
    // than letting Johnny type into a doc that silently never persists.
    if (/back up|unavailable/i.test(r.reason || '')) {
      // STARTUP-BANNER RACE FIX: SaveStatus attaches its wp-save-failed listener on MOUNT, which
      // happens during render() BELOW — so a wp-save-failed dispatched here (pre-render) is missed
      // and the banner never shows. Stash the broken-storage state on a module flag that SaveStatus
      // reads on mount, so the initial failure survives until the listener exists. (We still keep
      // an event-style detail object so the flag and a live event carry identical shape.)
      INITIAL_SAVE_FAILURE = {
        kind: 'storage',
        message: 'storage is full or blocked — your edits will NOT be saved.',
      };
    }
  } else if (r.migrated) {
    console.info('[burma] safe migration applied + validated (backup:', r.bakKey + ')');
  }
} catch (e) {
  // Never let migration failure block the app — the editor's own ensureTableDoc still wraps at
  // render time as a fallback, and the original saved doc was never overwritten.
  console.warn('[burma] safe migration errored — original doc untouched:', e);
}

render(<App />, document.getElementById('app'));
