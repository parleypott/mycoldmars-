// Burma Script Tool — app entry (WP-01).
// DESIGN LAW v3 — TEENAGE SOUL. A FLAT technical fig.01 "WORD PROCESSING INSTRUMENT":
// cream ground, hairline-outlined panels, mono uppercase labels in the chrome, serif ONLY
// in the script body. NO drop shadow / bevel anywhere — flat fills + hairline borders only.
// The TE instrument FRAMES the script; it never invades the prose.
//
// Layout maps the approved mock (/tmp/te-mock/index.html) onto the real editor:
//   TOP    = CONTROL SURFACE bar (typeface/size readouts, mode segmented DRAFT/EDIT/REVISE)
//   LEFT   = INPUT BAY (outline/nav, FOCUS LOCK, SAVED status)
//   CENTER = FIELD NOTE panel = the real TipTap editor (225 blocks, editable + movable)
//   RIGHT  = OUTPUT + TELEMETRY (export cartridges, draft-pressure gauge, schema)
//   BOTTOM = FUNCTION-KEY strip (F1 SAVE … ESC)

import { render } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { BurmaEditor, LS_DOC } from './Editor.jsx';
import { Exports } from './Exports.jsx';
import scriptData from '../sample-blocks.json';

const SOURCE_BLOCKS = scriptData.blocks || [];
const DOC_TITLE = scriptData.title || 'Burma — The Human Element';
const SEQUENCES = scriptData.sequences || [];

// ── INPUT BAY: outline/nav. Monochrome indented chapter/scene spine + primary keys.
// Scroll-spy marks the chapter currently in the reading band (the one red tick in the rail).
function Outline({ items }) {
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
    const scroller = document.querySelector('.wp-doc-scroll');
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (scroller) scroller.removeEventListener('scroll', onScroll);
    };
  }, [items]);

  const jump = (id) => {
    const node = document.querySelector(`[data-block-id="${id}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!items || !items.length) {
    return <div class="wp-bay-empty">OUTLINE · LOADING</div>;
  }
  return (
    <div class="wp-bay-outline">
      {items.map((it) => (
        <button
          key={it.id}
          class={`wp-bay-item lvl-${it.level} ${it.id === activeId ? 'is-active' : ''}`}
          title={it.title}
          onClick={() => jump(it.id)}
        >
          <span class="wp-bay-item-txt">{it.title}</span>
        </button>
      ))}
    </div>
  );
}

// ── TELEMETRY readouts (right rail). Derived live from the doc.
function pct(done, total) { return total ? Math.round((done / total) * 100) : 0; }

function App() {
  const [tel, setTel] = useState(null);
  const [savedAgo, setSavedAgo] = useState(0);
  const [mode, setMode] = useState('EDIT');
  const editorRef = useRef(null);

  // SAVED · NN AGO ticker — purely cosmetic instrument telemetry; resets on each autosave.
  useEffect(() => {
    const t = setInterval(() => setSavedAgo((s) => Math.min(s + 1, 5999)), 1000);
    const onSave = () => setSavedAgo(0);
    window.addEventListener('wp-saved', onSave);
    return () => { clearInterval(t); window.removeEventListener('wp-saved', onSave); };
  }, []);

  function resetDoc() {
    try { localStorage.removeItem(LS_DOC); } catch {}
    location.reload();
  }
  function openExports() { window.dispatchEvent(new CustomEvent('wp-open-exports')); }

  const words = tel?.words || 0;
  const blocks = tel?.blocks || 0;
  const sot = tel?.sot || 0;
  const done = tel?.done || 0;
  const draftPct = pct(done, sot);
  const reading = Math.max(1, Math.round(words / 160)); // ~160 wpm script read
  const savedMin = String(Math.floor(savedAgo / 60)).padStart(2, '0');
  const savedSec = String(savedAgo % 60).padStart(2, '0');

  return (
    <div class="wp-sheet">
      <div class="wp-tab-notch l" /><div class="wp-tab-notch r" />

      {/* ── TOP HEADER ── */}
      <header class="wp-head">
        <div class="wp-head-id">
          <div class="wp-head-ttl">WORD PROCESSING INSTRUMENT / MODEL WP&#8209;01 · BURMA</div>
          <div class="wp-head-sub">TEXT IS A MATERIAL · FORMAT IS A TOOL · DOCUMENT AS OBJECT</div>
        </div>
        <div class="wp-head-right">
          <small class="wp-head-note">INTERFACE<br/>STUDY DRAWING</small>
          <div class="wp-head-fig">fig.01</div>
          <div class="wp-head-dots"><i class="d-orange" /><i class="d-red" /></div>
        </div>
      </header>

      {/* ── CONTROL SURFACE ── matches the mock: typeface · size/weight · dial · line-height,
            with live telemetry threaded through the instrument readouts. */}
      <section class="wp-panel wp-control">
        <span class="wp-cap">Control Surface</span>
        <div class="wp-ctl">
          <span class="wp-l">Typeface</span>
          <div class="wp-dropdown"><span>IOWAN · SERIF</span><span class="wp-car">▾</span></div>
          <span class="wp-tag">SCRIPT</span>
        </div>
        <div class="wp-ctl">
          <div class="wp-ctl-row"><span class="wp-l">Size</span><span class="wp-bignum">15.5</span><span class="wp-l" style={{ marginLeft: '6px' }}>Weight</span></div>
          <div class="wp-ctl-row wp-slider-row">
            <span class="wp-l2">LIGHT</span>
            <div class="wp-slider"><span class="wp-slider-fill" style={{ width: '45%' }} /><span class="wp-knob" style={{ left: '45%' }} /></div>
            <span class="wp-chip-orange" />
            <span class="wp-l2">BOLD</span>
          </div>
        </div>
        <div class="wp-ctl wp-ctl-dial">
          <div class="wp-dial"><div class="wp-dial-ticks" id="wp-ticks" /><div class="wp-dial-odot" /></div>
          <span class="wp-l2">DIAL · TRACKING</span>
        </div>
        <div class="wp-ctl">
          <div class="wp-ctl-row" style={{ justifyContent: 'space-between' }}><span class="wp-l">Line Height</span><span class="wp-bignum" style={{ fontSize: '16px' }}>1.62</span></div>
          <span class="wp-l2">WORDS {words.toLocaleString()} · READING {reading}:{String((words % 160) % 60).padStart(2, '0')}</span>
          <div class="wp-seg">
            {['DRAFT', 'EDIT', 'REVISE'].map((m) => (
              <span key={m} class={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── THREE COLUMNS ── */}
      <div class="wp-cols">

        {/* LEFT: INPUT BAY */}
        <aside class="wp-panel wp-col wp-bay">
          <span class="wp-cap">Input Bay</span>
          <div class="wp-tabs"><span class="wp-tab on">OUTLINE</span><span class="wp-tab">NOTES</span></div>
          <div class="wp-bay-sec">PRIMARY KEYS · DOCUMENT FLOW</div>
          <div class="wp-bay-keys">
            <div class="wp-bay-li"><span>OUTLINE</span><span class="k">⌘ O</span></div>
            <div class="wp-bay-li"><span>FOOTNOTES</span><span class="k">⌘ F</span></div>
            <div class="wp-bay-li"><span>VERSION</span><span class="k">⌘ V</span></div>
          </div>
          <div class="wp-bay-sec">SCRIPT SPINE</div>
          <div class="wp-bay-scroll">
            <Outline items={tel?.outline} />
          </div>
          <button class="wp-btn-orange" onClick={resetDoc} title="Reset to source script">FOCUS LOCK</button>
          <div class="wp-saved">SAVED · {savedMin}:{savedSec} AGO</div>
        </aside>

        {/* CENTER: FIELD NOTE = the real editor */}
        <main class="wp-panel wp-doc">
          <span class="wp-cap">Field Note</span>
          <div class="wp-doc-scroll">
            <div class="wp-doc-inner">
              <div class="wp-doc-head" contenteditable={false}>
                <div class="wp-eyebrow">untitled field note · the human element</div>
                <h1 class="wp-title">{DOC_TITLE}</h1>
                <div class="wp-seq">{SEQUENCES.map((s, i) => (
                  <span class="wp-seq-item" key={s.name}>
                    {i > 0 && <span class="wp-seq-sep" aria-hidden="true">·</span>}
                    <span class="wp-seq-name">{s.name}</span>
                  </span>
                ))}</div>
              </div>
              <BurmaEditor
                sourceBlocks={SOURCE_BLOCKS}
                onTelemetry={setTel}
                onEditorReady={(ed) => { editorRef.current = ed; }}
              />
            </div>
          </div>
          <div class="wp-doc-foot">
            <span>WORDS {words.toLocaleString()} · READING {reading}:00 · BLOCKS {blocks}</span>
            <span>MODE: {mode === 'EDIT' ? 'PRECISE' : mode}</span>
          </div>
        </main>

        {/* RIGHT: OUTPUT + TELEMETRY */}
        <aside class="wp-panel wp-col wp-out">
          <span class="wp-cap">Output + Telemetry</span>

          <div class="wp-schema">
            <div class="wp-schema-box" style={{ left: '8px', top: '18px' }} />
            <div class="wp-schema-lab" style={{ left: '8px', top: '5px' }}>SOURCE</div>
            <div class="wp-schema-ln" style={{ left: '42px', top: '30px', width: '16px' }} />
            <div class="wp-schema-box" style={{ left: '58px', top: '18px' }} />
            <div class="wp-schema-lab" style={{ left: '58px', top: '5px' }}>FORMAT</div>
            <div class="wp-schema-ln" style={{ left: '92px', top: '30px', width: '16px' }} />
            <div class="wp-schema-box" style={{ left: '108px', top: '18px' }} />
            <div class="wp-schema-lab" style={{ left: '108px', top: '5px' }}>RENDER</div>
            <div class="wp-schema-ln wp-orange-ln" style={{ left: '142px', top: '30px', width: '16px' }} />
            <div class="wp-schema-box wp-orange-box" style={{ left: '158px', top: '18px' }} />
            <div class="wp-schema-lab wp-orange-lab" style={{ left: '158px', top: '5px' }}>OUT</div>
            <div class="wp-schema-od" style={{ left: '171px', top: '27px' }} />
            <div class="wp-schema-lab" style={{ left: '8px', bottom: '6px' }}>RULER · 01 · CALIBRATED</div>
          </div>

          <div class="wp-pressure">
            <span class="wp-l">Draft Pressure · SOT {done}/{sot}</span>
            <div class="wp-pbar"><span class="wp-pbar-fill" style={{ width: `${Math.min(100, draftPct)}%` }} /><span class="wp-pk" style={{ left: `${Math.min(100, draftPct)}%` }} /></div>
            <div class="wp-pends"><span>ROUGH</span><span>FINAL</span></div>
          </div>

          <div class="wp-exports">
            <span class="wp-l">Export Cartridges</span>
            <div class="wp-exp-grid">
              <button class="wp-exp on" onClick={openExports}>FINAL</button>
              <button class="wp-exp" onClick={openExports}>PDF</button>
              <button class="wp-exp" onClick={openExports}>MD</button>
              <button class="wp-exp" onClick={openExports}>DOCX</button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── BOTTOM FUNCTION STRIP ── */}
      <div class="wp-fnstrip">
        <button class="wp-fn"><b>F1</b>SAVE</button>
        <button class="wp-fn" onClick={() => { const el = document.querySelector('.wp-bay-scroll'); if (el) el.scrollTop = 0; }}><b>F2</b>OUTLINE</button>
        <button class="wp-fn"><b>F3</b>COMMENT</button>
        <button class="wp-fn"><b>F4</b>REFERENCE</button>
        <button class="wp-fn"><b>F5</b>FOCUS</button>
        <button class="wp-fn" onClick={() => window.print()}><b>F6</b>PRINT</button>
        <button class="wp-fn" onClick={openExports}><b>F7</b>EXPORT</button>
        <button class="wp-fn" onClick={resetDoc}><b>ESC</b>RESET</button>
      </div>

      <div class="wp-caption">DESIGNED AS A BEAUTIFUL LABELLED INSTRUMENT — HYPER-FUNCTIONAL WORD PROCESSOR · BURMA SCRIPT · 225 BLOCKS</div>

      <Exports getDoc={() => editorRef.current?.getJSON() || { type: 'doc', content: [] }} docTitle={DOC_TITLE} />
    </div>
  );
}

render(<App />, document.getElementById('app'));

// draw the dial ticks once mounted
requestAnimationFrame(() => {
  const t = document.getElementById('wp-ticks');
  if (t && !t.childElementCount) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.style.transform = `translate(-50%,0) rotate(${i * 30}deg)`;
      t.appendChild(s);
    }
  }
});
