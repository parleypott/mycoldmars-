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
import scriptData from '../sample-blocks.json';

const SOURCE_BLOCKS = scriptData.blocks || [];
const DOC_TITLE = scriptData.title || 'Burma — The Human Element';

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
    <aside class={`wp-outline${open ? ' is-open' : ''}`} aria-hidden={!open}>
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

function App() {
  const [tel, setTel] = useState(null);
  const [scaffoldOpen, setScaffoldOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const editorRef = useRef(null);

  function resetDoc() {
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
    const fresh = state.schema.nodes.voBlock.createAndFill({ blockId: 'blk_' + Math.random().toString(36).slice(2, 9), status: 'todo' });
    if (fresh) ed.view.dispatch(state.tr.insert(end, fresh).scrollIntoView());
  }

  const words = tel?.words || 0;
  const blocks = tel?.blocks || 0;
  const sot = tel?.sot || 0;
  const done = tel?.done || 0;
  const scaffold = tel?.scaffold || 0;

  return (
    <div class="wp-page">
      <OutlinePanel items={tel?.outline} open={outlineOpen} onClose={() => setOutlineOpen(false)} />

      <div class={`wp-device${outlineOpen ? ' outline-open' : ''}`}>
        {/* registration screws */}
        <span class="wp-screw tl"><i /></span>
        <span class="wp-screw tr"><i /></span>
        <span class="wp-screw bl"><i /></span>
        <span class="wp-screw br"><i /></span>

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

        {/* the cartridge rack = the live editor */}
        <main class="wp-rack">
          <div class={`wp-rack-inner${scaffoldOpen ? '' : ' scaffold-collapsed'}`}>
            {scaffold > 0 && (
              <button
                class={`wp-scaffold-toggle${scaffoldOpen ? ' is-open' : ''}`}
                contenteditable={false}
                onClick={() => setScaffoldOpen((v) => !v)}
                title={scaffoldOpen ? 'Collapse setup notes' : 'Expand setup notes'}
              >
                <span class="wp-scaffold-glyph">{scaffoldOpen ? '⊖' : '⊕'}</span>
                <span class="wp-scaffold-lab">SETUP NOTES</span>
                <span class="wp-scaffold-n">({scaffold})</span>
              </button>
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
    </div>
  );
}

render(<App />, document.getElementById('app'));
