// Burma Script Tool — the margin WORKSHOP HUB.
// Opens when a {TK} writing-helper, {fc} fact-check, or [visual] direction span is clicked
// (the marks dispatch a 'wp-open-workshop' CustomEvent with { kind, text, from, to, block,
// context }). It's the side panel where a span gets WORKED — and now it actually does the work:
//
//   tk     → calls /api/burma-tk (mode:'tk'), renders FIVE pick-able option cards; picking one
//            dispatches 'wp-replace-span' so the Editor replaces the {TK} marker in place.
//   fc     → calls /api/burma-tk (mode:'fc') with web search, shows a verdict + finding +
//            sources + a suggested corrected edit the writer can drop in over the {fc} marker.
//   visual → the quiet notes textarea (visual direction isn't a writing/verify task).
//
// Swiss restraint — a calm drawer on the right, not a loud modal. Notes/picks persist per-span
// in localStorage so the workshop survives reloads alongside the autosaved doc.

import { useState, useEffect } from 'preact/hooks';

const LS_WORKSHOP = 'wp01_burma_workshop_v1';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(LS_WORKSHOP) || '{}'); } catch { return {}; }
}
function saveAll(map) {
  try { localStorage.setItem(LS_WORKSHOP, JSON.stringify(map)); } catch {}
}

export function Workshop() {
  const [open, setOpen] = useState(false);
  const [span, setSpan] = useState(null);   // { kind, text, from, to, block, context }
  const [note, setNote] = useState('');
  const [resolved, setResolved] = useState(false);

  // generated state (per-open)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState([]);   // tk: [{text, angle, source}]
  const [verdict, setVerdict] = useState(null);  // fc: {verdict, finding, suggestedEdit, sources}

  useEffect(() => {
    const onOpen = (e) => {
      const detail = e.detail || {};
      setSpan(detail);
      const all = loadAll();
      const rec = all[detail.text] || {};
      setNote(rec.note || '');
      setResolved(!!rec.resolved);
      // restore any previously generated work for this span
      setOptions(rec.options || []);
      setVerdict(rec.verdict || null);
      setError('');
      setLoading(false);
      setOpen(true);
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

  // Call the backend. mode 'tk' → 5 options; mode 'fc' → verdict.
  async function generate() {
    if (!span) return;
    const mode = span.kind === 'fc' ? 'fc' : 'tk';
    setLoading(true); setError('');
    if (mode === 'tk') setOptions([]); else setVerdict(null);
    try {
      const res = await fetch('/api/burma-tk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, marker: span.text, block: span.block, context: span.context }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (mode === 'tk') {
        const opts = Array.isArray(data.options) ? data.options : [];
        setOptions(opts);
        persist({ options: opts });
      } else {
        setVerdict(data);
        persist({ verdict: data });
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Pick an option (or the fc suggested edit) → ask the Editor to replace the marker range.
  function pick(text) {
    if (!span || typeof span.from !== 'number') return;
    window.dispatchEvent(new CustomEvent('wp-replace-span', {
      detail: { from: span.from, to: span.to, text },
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
  const genLabel = isFc ? 'VERIFY CLAIM' : 'GENERATE 5';

  return (
    <aside class="wp-workshop" data-kind={span.kind}>
      <div class="wp-ws-head">
        <span class="wp-ws-kind">{kindLabel}</span>
        <button class="wp-ws-close" title="Close" onClick={() => setOpen(false)}>×</button>
      </div>

      <div class="wp-ws-span">{span.text}</div>

      {/* ---- VISUAL: quiet notes only ---- */}
      {isVisual && (
        <>
          <label class="wp-ws-label">Visual treatment</label>
          <textarea
            class="wp-ws-textarea"
            placeholder="How does this look on screen? Map move, archive, b-roll…"
            value={note}
            onInput={(e) => { setNote(e.target.value); persist({ note: e.target.value }); }}
          />
          <button
            class={`wp-ws-resolve ${resolved ? 'is-resolved' : ''}`}
            onClick={() => { const v = !resolved; setResolved(v); persist({ resolved: v }); }}
          >
            {resolved ? '✓ Resolved' : 'Mark resolved'}
          </button>
        </>
      )}

      {/* ---- TK / FC: the real generate action ---- */}
      {(isTk || isFc) && (
        <button class="wp-ws-generate" onClick={generate} disabled={loading} data-kind={span.kind}>
          {loading ? (isFc ? 'Checking…' : 'Writing 5…') : genLabel}
        </button>
      )}

      {error && <div class="wp-ws-error">{error}</div>}

      {/* ---- TK: five pick-able option cards ---- */}
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

      {/* ---- FC: verdict + finding + sources + suggested edit ---- */}
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
          {!!(verdict.sources && verdict.sources.length) && (
            <div class="wp-ws-sources">
              <div class="wp-ws-label">Sources</div>
              {verdict.sources.map((s, i) => (
                <div class="wp-src" key={i}>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.label || s.url}</a> : (s.label || '')}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
