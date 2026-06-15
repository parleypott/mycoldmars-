// Burma Script Tool — the margin WORKSHOP HUB.
// Opens when a {TK} research or [visual] direction span is clicked (the marks dispatch
// a 'wp-open-workshop' CustomEvent — same pattern as SpeakerBlock's rename overlay). It's
// the side panel where a span gets worked: notes, candidate lines, resolve. Swiss restraint —
// a quiet drawer on the right, not a loud modal. State is kept per-span in localStorage so
// the workshop survives reloads alongside the autosaved doc.

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
  const [span, setSpan] = useState(null);   // { kind, text }
  const [note, setNote] = useState('');
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const onOpen = (e) => {
      const detail = e.detail || {};
      setSpan(detail);
      const all = loadAll();
      const rec = all[detail.text] || {};
      setNote(rec.note || '');
      setResolved(!!rec.resolved);
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

  if (!open || !span) return null;

  const isTk = span.kind === 'tk';

  return (
    <aside class="wp-workshop" data-kind={span.kind}>
      <div class="wp-ws-head">
        <span class="wp-ws-kind">{isTk ? 'TK · RESEARCH' : 'VISUAL · DIRECTION'}</span>
        <button class="wp-ws-close" title="Close" onClick={() => setOpen(false)}>×</button>
      </div>

      <div class="wp-ws-span">{span.text}</div>

      <label class="wp-ws-label">{isTk ? 'Research notes / source' : 'Visual treatment'}</label>
      <textarea
        class="wp-ws-textarea"
        placeholder={isTk ? 'What needs verifying? Paste a source, jot the finding…' : 'How does this look on screen? Map move, archive, b-roll…'}
        value={note}
        onInput={(e) => { setNote(e.target.value); persist({ note: e.target.value }); }}
      />

      <button
        class={`wp-ws-resolve ${resolved ? 'is-resolved' : ''}`}
        onClick={() => { const v = !resolved; setResolved(v); persist({ resolved: v }); }}
      >
        {resolved ? '✓ Resolved' : 'Mark resolved'}
      </button>
    </aside>
  );
}
