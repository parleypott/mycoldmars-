// Burma Script Tool — app entry (WP-01).
// A Preact + TipTap word processor for Johnny's Burma script. Loads the real 225
// parsed blocks, builds a TipTap doc, and renders an editable, movable script on
// clean Swiss paper. Working copy persists to localStorage; the blocks-data source
// stays read-only.

import { render } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { BurmaEditor, LS_DOC } from './Editor.jsx';
import { Exports } from './Exports.jsx';
import scriptData from '../sample-blocks.json';

const SOURCE_BLOCKS = scriptData.blocks || [];
const DOC_TITLE = scriptData.title || 'Burma — The Human Element';
const SEQUENCES = scriptData.sequences || [];

function Telem({ t }) {
  if (!t) return null;
  return (
    <div class="wp-telem">
      <span class="wp-t">WORDS <b>{t.words.toLocaleString()}</b></span>
      <span class="wp-t">BLOCKS <b>{t.blocks}</b></span>
      <span class="wp-t">SOT <b>{t.done}/{t.sot}</b></span>
    </div>
  );
}

// Minimal monochrome OUTLINE RAIL (DESIGN.md STRUCTURE): indented chapter/scene titles,
// NO genre color — the ping-pong is felt through structure, not loud chips. Click a row
// to scroll its block into view. Quiet, fixed, scannable for a 225-block document.
//
// Scroll-spy: the rail tracks the chapter currently scrolled into the reading band and
// marks it `.is-active`. That active chapter is the ONLY place Swiss red survives in the
// rail (one red tick max) — every other chapter reads in monochrome ink, hierarchy carried
// by the size + indent step, not color. Red stays an accent, never a per-line bullet glyph.
function Outline({ items }) {
  const [activeId, setActiveId] = useState('');

  // Find the chapter whose block sits highest above the reading band (~28% down the
  // viewport). Cheap rAF-throttled scan over the chapter anchors — 225 blocks, ~30 chapters.
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

  if (!items || !items.length) return null;
  const jump = (id) => {
    const node = document.querySelector(`[data-block-id="${id}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav class="wp-outline" aria-label="Script outline">
      <div class="wp-outline-head">OUTLINE</div>
      <div class="wp-outline-list">
        {items.map((it) => (
          <button
            key={it.id}
            class={`wp-outline-item lvl-${it.level} ${it.id === activeId ? 'is-active' : ''}`}
            title={it.title}
            onClick={() => jump(it.id)}
          >
            {it.title}
          </button>
        ))}
      </div>
    </nav>
  );
}

function App() {
  const [tel, setTel] = useState(null);
  // Hold the live editor so the Exports panel can read the current doc on demand.
  const editorRef = useRef(null);

  function resetDoc() {
    try { localStorage.removeItem(LS_DOC); } catch {}
    location.reload();
  }

  // The EXPORT control just broadcasts — the Exports panel listens and reads the live doc.
  function openExports() { window.dispatchEvent(new CustomEvent('wp-open-exports')); }

  return (
    <div class="wp-app">
      <header class="wp-bar">
        <span class="wp-model">WP&#8209;01 <b>BURMA</b> · SCRIPT</span>
        <Telem t={tel} />
        <button class="wp-export" onClick={openExports} title="Export — print PDF or worklists">EXPORT</button>
        <button class="wp-reset" onClick={resetDoc} title="Reset to source script">RESET</button>
      </header>

      <Outline items={tel?.outline} />

      <main class="wp-stage">
        <div class="wp-page">
          <div class="wp-doc-head" contenteditable={false}>
            <div class="wp-eyebrow">the human element</div>
            <h1 class="wp-title">{DOC_TITLE}</h1>
            <div class="wp-seq">{SEQUENCES.map(s => s.name).join('  ·  ')}</div>
          </div>
          <BurmaEditor
            sourceBlocks={SOURCE_BLOCKS}
            onTelemetry={setTel}
            onEditorReady={(ed) => { editorRef.current = ed; }}
          />
        </div>
      </main>

      <Exports getDoc={() => editorRef.current?.getJSON() || { type: 'doc', content: [] }} docTitle={DOC_TITLE} />
    </div>
  );
}

render(<App />, document.getElementById('app'));
