// Burma Script Tool — the margin WORKSHOP HUB.
// Opens when a {TK} writing-helper, {fc} fact-check, or [visual] direction span is clicked
// (the marks dispatch a 'wp-open-workshop' CustomEvent with { kind, text, from, to, block,
// context }). It's the side panel where a span gets WORKED.
//
//   tk     → shows the PRE-COMPUTED, fact-checked research for that marker INSTANTLY (5 vetted
//            options + sources, woven in from tk-research.json). "Regenerate live" re-runs
//            /api/burma-tk for a fresh take. Picking a card replaces the {TK} marker in place.
//   fc     → calls /api/burma-tk (mode:'fc') with web search → verdict + finding + sources + edit.
//   visual → the quiet notes textarea.
//
// The hub is EXPANDABLE (⤢) so long options + sources have room. Picks/notes persist per-span.

import { useState, useEffect, useRef } from 'preact/hooks';
import RESEARCH from '../tk-research.json';

const LS_WS_WIDTH = 'wp01_burma_workshop_width_v1';

const LS_WORKSHOP = 'wp01_burma_workshop_v1';
// Normalize a marker to its inner content so the doc span ("shows years of…") matches the
// research key ("{TK shows years of…}"): strip outer braces/brackets + any leading TK/tk runs.
const norm = (s) => (s || '')
  .replace(/^[\s{[]+/, '')
  .replace(/[\s}\]]+$/, '')
  .replace(/^(tk[:\s]*)+/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Fuzzy matcher: the live parser's span text and the research marker text are the same writing
// but formatted differently (braces/TK stripped, whitespace, even counts differ), so match by
// token overlap instead of exact string. Robust to the two-pipeline mismatch.
const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
const RESEARCH_LIST = Object.keys(RESEARCH || {})
  .map((id) => {
    const e = RESEARCH[id];
    if (!e || !e.marker) return null;
    return {
      tokens: new Set(words(e.marker)),
      options: (e.options || []).map((o) => (typeof o === 'string' ? { text: o } : o)),
      sources: e.sources || [],
      chapter: e.chapter || '',
    };
  })
  .filter(Boolean);

function matchResearch(spanText) {
  const st = new Set(words(spanText));
  if (!st.size) return null;
  let best = null, bestScore = 0;
  for (const entry of RESEARCH_LIST) {
    let overlap = 0;
    for (const t of entry.tokens) if (st.has(t)) overlap++;
    const score = overlap / Math.max(1, Math.min(st.size, entry.tokens.size));
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return bestScore >= 0.6 ? best : null;
}

function loadAll() { try { return JSON.parse(localStorage.getItem(LS_WORKSHOP) || '{}'); } catch { return {}; } }
function saveAll(map) { try { localStorage.setItem(LS_WORKSHOP, JSON.stringify(map)); } catch {} }

export function Workshop() {
  const [open, setOpen] = useState(false);
  const [span, setSpan] = useState(null);
  const [note, setNote] = useState('');
  const [resolved, setResolved] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState([]);   // [{text, angle?}]
  const [sources, setSources] = useState([]);   // [{claim, url}]
  const [vetted, setVetted] = useState(false);   // options came from the fact-checked research
  const [chapter, setChapter] = useState('');
  const [verdict, setVerdict] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(() => {
    const v = parseInt(localStorage.getItem(LS_WS_WIDTH) || '', 10);
    return Number.isFinite(v) && v >= 340 ? v : 0; // 0 → use the CSS default
  });
  const asideRef = useRef(null);
  const resizing = useRef(false);

  // ux-06 — flag on <body> while the dock is open so the save pill can dodge it (the dock anchors to
  // the right edge full-height; the pill sat bottom-right underneath it). CSS reads this to move the
  // FAILED pill — the one indicator that must never be occluded — to the bottom-LEFT while open.
  const dockOpen = open && !!span;
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (dockOpen) document.body.setAttribute('data-workshop-open', '');
    else document.body.removeAttribute('data-workshop-open');
    return () => { try { document.body.removeAttribute('data-workshop-open'); } catch {} };
  }, [dockOpen]);

  // Drag the LEFT edge to resize the dock. Width is clamped to [340, 92vw], persisted so
  // Johnny's chosen size sticks across sessions. Dragging implies expanded.
  useEffect(() => {
    function onMove(e) {
      if (!resizing.current) return;
      const w = Math.max(340, Math.min(window.innerWidth * 0.92, window.innerWidth - e.clientX));
      setWidth(w);
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = false;
      asideRef.current?.classList.remove('is-resizing');
      try { localStorage.setItem(LS_WS_WIDTH, String(width)); } catch {}
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [width]);

  function startResize(e) {
    e.preventDefault();
    if (!expanded) setExpanded(true);
    resizing.current = true;
    asideRef.current?.classList.add('is-resizing');
  }

  useEffect(() => {
    const onOpen = (e) => {
      const detail = e.detail || {};
      setSpan(detail);
      const all = loadAll();
      const rec = all[detail.text] || {};
      setNote(rec.note || '');
      setResolved(!!rec.resolved);
      setExpanded(false);

      const research = detail.kind === 'tk' ? matchResearch(detail.text) : null;
      if (rec.options && rec.options.length) {
        // the writer already generated/edited this span — keep their work
        setOptions(rec.options); setSources(rec.sources || []); setVetted(false);
      } else if (research) {
        // surface the pre-computed, fact-checked options immediately — no click needed
        setOptions(research.options); setSources(research.sources); setVetted(true); setChapter(research.chapter);
      } else {
        setOptions([]); setSources([]); setVetted(false); setChapter('');
      }
      setVerdict(rec.verdict || null);
      setError(''); setLoading(false); setOpen(true);
    };
    window.addEventListener('wp-open-workshop', onOpen);
    return () => window.removeEventListener('wp-open-workshop', onOpen);
  }, []);

  function persist(patch) {
    if (!span) return;
    const all = loadAll();
    all[span.text] = { ...(all[span.text] || {}), kind: span.kind, ...patch };
    saveAll(all);
  }

  // Regenerate live via the backend. mode 'tk' → 5 options; mode 'fc' → verdict.
  async function generate() {
    if (!span) return;
    const mode = span.kind === 'fc' ? 'fc' : 'tk';
    setLoading(true); setError('');
    if (mode === 'tk') { setOptions([]); setVetted(false); } else setVerdict(null);
    try {
      const res = await fetch('/api/burma-tk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, marker: span.text, block: span.block, context: span.context }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (mode === 'tk') {
        const opts = (Array.isArray(data.options) ? data.options : []).map((o) => (typeof o === 'string' ? { text: o } : o));
        setOptions(opts); setSources(data.sources || []); setVetted(false);
        persist({ options: opts, sources: data.sources || [] });
      } else {
        setVerdict(data); persist({ verdict: data });
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Pick an option (or the fc suggested edit) → ask the Editor to replace the marker range.
  // CH-02: pass the ORIGINAL marker text + kind so the Editor can re-validate the cached
  // {from,to} range still spans the same marker before overwriting. The dock stays open over a
  // fully-editable editor, so any edit ABOVE the marker shifts these coordinates; replacing the
  // stale range would land the prose in the wrong place and delete good script silently.
  function pick(text) {
    if (!span || typeof span.from !== 'number') return;
    window.dispatchEvent(new CustomEvent('wp-replace-span', {
      detail: { from: span.from, to: span.to, text, markerText: span.text, kind: span.kind },
    }));
    persist({ resolved: true, chosen: text });
    setResolved(true);
    setOpen(false);
  }

  if (!open || !span) return null;

  const isTk = span.kind === 'tk';
  const isFc = span.kind === 'fc';
  const isVisual = span.kind === 'visual';

  const kindLabel = isTk ? 'TK · WRITING HELPER' : isFc ? 'FACT-CHECK · VERIFY' : 'VISUAL · DIRECTION';
  const genLabel = isFc ? 'VERIFY CLAIM' : (options.length ? 'REGENERATE LIVE' : 'GENERATE 5');

  return (
    <aside
      ref={asideRef}
      class={`wp-workshop ${expanded ? 'is-expanded' : ''}`}
      data-kind={span.kind}
      style={expanded && width ? { '--ws-w': width + 'px' } : undefined}
    >
      {/* drag the left edge to resize the dock */}
      <div class="wp-ws-resizer" title="Drag to resize" onMouseDown={startResize} />
      <div class="wp-ws-head">
        <span class="wp-ws-kind">{kindLabel}</span>
        <span class="wp-ws-actions">
          <button class="wp-ws-expand" title={expanded ? 'Collapse panel' : 'Expand panel — make it big'} onClick={() => setExpanded(!expanded)}>
            <span class="wp-ws-expand-glyph">{expanded ? '⤡' : '⤢'}</span>
            <span>{expanded ? 'Collapse' : 'Expand'}</span>
          </button>
          <button class="wp-ws-close" title="Close" onClick={() => setOpen(false)}>×</button>
        </span>
      </div>

      <div class="wp-ws-span">{span.text}</div>

      {/* VISUAL: quiet notes only */}
      {isVisual && (
        <>
          <label class="wp-ws-label">Visual treatment</label>
          <textarea class="wp-ws-textarea"
            placeholder="How does this look on screen? Map move, archive, b-roll…"
            value={note} onInput={(e) => { setNote(e.target.value); persist({ note: e.target.value }); }} />
          <button class={`wp-ws-resolve ${resolved ? 'is-resolved' : ''}`}
            onClick={() => { const v = !resolved; setResolved(v); persist({ resolved: v }); }}>
            {resolved ? '✓ Resolved' : 'Mark resolved'}
          </button>
        </>
      )}

      {/* TK: vetted badge when the options are the fact-checked research */}
      {isTk && vetted && !!options.length && (
        <div class="wp-ws-vetted">✓ RESEARCHED &amp; FACT-CHECKED · 5 OPTIONS{chapter ? ` · ${chapter.slice(0, 28).toUpperCase()}` : ''}</div>
      )}

      {/* TK / FC: the live action (regenerate / verify) */}
      {(isTk || isFc) && (
        <button class="wp-ws-generate" onClick={generate} disabled={loading} data-kind={span.kind} data-secondary={isTk && vetted ? '1' : null}>
          {loading ? (isFc ? 'Checking…' : 'Writing 5…') : genLabel}
        </button>
      )}

      {error && <div class="wp-ws-error">{error}</div>}

      {/* TK: five pick-able option cards */}
      {isTk && !!options.length && (
        <div class="wp-ws-options">
          <div class="wp-ws-hint">Pick one to drop it in — it replaces the {'{TK}'} marker.</div>
          {options.map((o, i) => (
            <button class="wp-opt" key={i} onClick={() => pick(o.text)} title="Insert, replacing the marker">
              <div class="wp-opt-top">
                <span class="wp-opt-n">{i + 1}</span>
                {o.angle && <span class="wp-opt-angle">{o.angle}</span>}
                <span class="wp-opt-pick">INSERT →</span>
              </div>
              <div class="wp-opt-text">{o.text}</div>
              {o.source && <div class="wp-opt-source">{o.source}</div>}
            </button>
          ))}
        </div>
      )}

      {/* TK + FC shared: sources */}
      {((isTk && !!sources.length) || (isFc && verdict && verdict.sources && verdict.sources.length)) && (
        <div class="wp-ws-sources">
          <div class="wp-ws-label">Sources</div>
          {(isTk ? sources : verdict.sources).map((s, i) => (
            <div class="wp-src" key={i}>
              {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.claim || s.label || s.url}</a> : (s.claim || s.label || '')}
            </div>
          ))}
        </div>
      )}

      {/* FC: verdict + finding + suggested edit */}
      {isFc && verdict && (
        <div class="wp-ws-verdict">
          <div class={`wp-verdict-badge v-${verdict.verdict}`}>{(verdict.verdict || 'unclear').toUpperCase()}</div>
          {verdict.finding && <div class="wp-verdict-finding">{verdict.finding}</div>}
          {verdict.suggestedEdit && (
            <button class="wp-opt wp-opt-edit" onClick={() => pick(verdict.suggestedEdit)} title="Insert the corrected line">
              <div class="wp-opt-top">
                <span class="wp-opt-angle">suggested edit</span>
                <span class="wp-opt-pick">INSERT →</span>
              </div>
              <div class="wp-opt-text">{verdict.suggestedEdit}</div>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
