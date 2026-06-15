// Burma Script Tool — EXPORTS.
// Two export surfaces, one Swiss panel:
//   1. PRINT / PDF the whole script  — handled by the @media print stylesheet (styles.css):
//      window.print() hides all chrome and lays the document out black-on-white with page
//      breaks at chapters. The "Print script (PDF)" button just calls window.print() on the
//      live document — the editor surface itself is the print artifact.
//   2. WORKLISTS — three clean, printable + downloadable views derived from the LIVE doc:
//        • MAP NEEDS    — every map-need block (mapping data the graphics team must source)
//        • ARCHIVE      — every archive-req block (archival footage/stills to license)
//        • TRANSLATION  — every SOT speaker quote (sound-on-tape to translate / subtitle)
//      Each worklist is its OWN printable view (a class on <html> swaps which surface prints)
//      and downloadable as a clean .txt the producer can hand off.
//
// Reads the doc through docToBlocks(editor.getJSON()) so the worklists reflect every live
// edit, reorder, and done-tick — never the stale source file. Swiss restraint: a calm
// near-white overlay, mono labels, the single red accent, no modal chrome zoo.

import { useState, useMemo, useEffect, useCallback } from 'preact/hooks';
import { docToBlocks } from './document-builder.js';

// ---- worklist extraction -------------------------------------------------
// Pull the three worklists out of a live blocks array. Each entry is normalized to
// { id, primary, body, meta } so the render + download paths share one shape.
function buildWorklists(blocks) {
  const maps = [];
  const archive = [];
  const translation = [];

  // Track the chapter we're under so each worklist row says WHERE in the script it lives —
  // the producer needs the section, not just the line. (Chapter spine, like the outline.)
  let chapter = '';

  for (const b of blocks) {
    if (b.type === 'chapter') { chapter = (b.title || '').trim(); continue; }

    if (b.type === 'map-need') {
      maps.push({ id: b.id, primary: b.title || 'Mapping data needs', body: cleanBody(b.text), meta: chapter });
    } else if (b.type === 'archive-req') {
      archive.push({ id: b.id, primary: b.title || 'Archive request', body: cleanBody(b.text), meta: chapter });
    } else if (b.type === 'sot') {
      // SOT = sound-on-tape — the interview quotes that get translated / subtitled. The
      // timecode is the hero datum the editor matches against; speaker tells the translator
      // who's talking. Done-flagged quotes are kept but marked, so the translator can skip
      // what's already handled.
      const tc = b.timecode?.tc || '';
      translation.push({
        id: b.id,
        primary: tc || '——:——:——:——',
        body: cleanBody(b.text),
        meta: [b.speaker, chapter].filter(Boolean).join(' · '),
        done: !!b.done,
      });
    }
  }
  return { maps, archive, translation };
}

// The service/archive blocks still carry the bracketed "[Mapping data needs: …]" wrapper
// and the U+2043 hyphen-bullets from the parser. Strip the outer brackets, turn the bullet
// separators into clean line items, so the worklist reads as a tidy checklist.
function cleanBody(text) {
  if (!text) return '';
  let t = String(text)
    .replace(/\\([\-\[\]\!\(\)\.\*_`#>~])/g, '$1')
    .replace(/^\s*\[\s*/, '')
    .replace(/\s*\]\s*$/, '')
    .replace(/⁠/g, '')
    .trim();
  // Peel a leading "Mapping data needs:" / "Archive request for this section:" label —
  // it's already the row's primary heading, no need to echo it in the body.
  t = t.replace(/^Mapping data needs?:?\s*/i, '')
       .replace(/^Archive request(?:\s+for this section)?:?\s*/i, '')
       .trim();
  // Split the hyphen-bullet list into discrete lines.
  const parts = t.split(/\s*[⁃•]\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts.map((p) => '• ' + p).join('\n') : t;
}

// ---- plain-text download -------------------------------------------------
function toPlainText(title, docTitle, rows, opts = {}) {
  const lines = [];
  lines.push(docTitle);
  lines.push(title.toUpperCase());
  lines.push('Generated ' + new Date().toISOString().slice(0, 10) + ' · ' + rows.length + ' items');
  lines.push('='.repeat(60));
  lines.push('');
  rows.forEach((r, i) => {
    const num = String(i + 1).padStart(2, '0');
    const flag = opts.done && r.done ? '  [DONE]' : '';
    lines.push(`${num}.  ${r.primary}${flag}`);
    if (r.meta) lines.push('     ' + r.meta);
    if (r.body) r.body.split('\n').forEach((bl) => lines.push('     ' + bl));
    lines.push('');
  });
  return lines.join('\n');
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- the worklist render -------------------------------------------------
function Worklist({ rows, empty, showDone }) {
  if (!rows.length) return <div class="wp-ex-empty">{empty}</div>;
  return (
    <ol class="wp-ex-list">
      {rows.map((r) => (
        <li class={`wp-ex-row ${showDone && r.done ? 'is-done' : ''}`} key={r.id}>
          <div class="wp-ex-primary">{r.primary}{showDone && r.done ? <span class="wp-ex-doneflag">done</span> : null}</div>
          {r.meta ? <div class="wp-ex-meta">{r.meta}</div> : null}
          {r.body ? <div class="wp-ex-body">{r.body.split('\n').map((bl, i) => <div key={i}>{bl}</div>)}</div> : null}
        </li>
      ))}
    </ol>
  );
}

const TABS = [
  { key: 'maps', label: 'MAP NEEDS', file: 'burma-map-needs.txt', heading: 'Map needs', empty: 'No map-need blocks in the script.' },
  { key: 'archive', label: 'ARCHIVE', file: 'burma-archive.txt', heading: 'Archive requests', empty: 'No archive-req blocks in the script.' },
  { key: 'translation', label: 'TRANSLATION', file: 'burma-translation.txt', heading: 'Translation worklist (SOT)', empty: 'No SOT blocks to translate.' },
];

// `getDoc` returns the live ProseMirror JSON; `docTitle` heads the printed/downloaded sheet.
export function Exports({ getDoc, docTitle }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('maps');
  // Rebuild worklists from the live doc each time the panel opens (cheap; ~225 blocks).
  const [lists, setLists] = useState({ maps: [], archive: [], translation: [] });

  const refresh = useCallback(() => {
    try { setLists(buildWorklists(docToBlocks(getDoc()))); } catch { /* doc not ready */ }
  }, [getDoc]);

  useEffect(() => {
    const onOpen = () => { refresh(); setOpen(true); };
    window.addEventListener('wp-open-exports', onOpen);
    return () => window.removeEventListener('wp-open-exports', onOpen);
  }, [refresh]);

  // ESC closes the panel and clears any print-target class.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = useMemo(() => TABS.find((t) => t.key === tab) || TABS[0], [tab]);
  const rows = lists[tab] || [];
  const showDone = tab === 'translation';

  // PRINT THE WHOLE SCRIPT: drop the export overlay, mark <html> so the print stylesheet
  // shows the document (default target), and call print.
  function printScript() {
    setOpen(false);
    document.documentElement.classList.remove('wp-print-worklist');
    // wait a frame so the overlay is gone before the print dialog snapshots the page
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // PRINT THE ACTIVE WORKLIST: flag <html> so the print stylesheet hides the script + the
  // panel chrome and prints only the worklist sheet, then clears the flag afterwards.
  function printWorklist() {
    document.documentElement.classList.add('wp-print-worklist');
    const clear = () => { document.documentElement.classList.remove('wp-print-worklist'); window.removeEventListener('afterprint', clear); };
    window.addEventListener('afterprint', clear);
    requestAnimationFrame(() => window.print());
  }

  function downloadWorklist() {
    download(current.file, toPlainText(current.heading, docTitle, rows, { done: showDone }));
  }

  if (!open) return null;

  return (
    <div class="wp-ex-overlay" role="dialog" aria-label="Exports">
      <div class="wp-ex-panel">
        <header class="wp-ex-head">
          <div class="wp-ex-eyebrow">WP&#8209;01 · EXPORT</div>
          <button class="wp-ex-close" title="Close (Esc)" onClick={() => setOpen(false)}>×</button>
        </header>

        {/* PRINT / PDF — the whole script document. Uses window.print(); the @media print
            stylesheet does the rest (chrome off, black-on-white, chapter page breaks). */}
        <div class="wp-ex-print-row">
          <div class="wp-ex-print-copy">
            <div class="wp-ex-print-title">Print / Save as PDF</div>
            <div class="wp-ex-print-sub">The full script — clean black-on-white, page breaks at chapters, timecodes intact.</div>
          </div>
          <button class="wp-ex-btn wp-ex-btn-red" onClick={printScript}>PRINT SCRIPT →</button>
        </div>

        <div class="wp-ex-rule" />

        {/* WORKLISTS */}
        <nav class="wp-ex-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              class={`wp-ex-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}<span class="wp-ex-count">{(lists[t.key] || []).length}</span>
            </button>
          ))}
        </nav>

        <div class="wp-ex-sheet" data-worklist={tab}>
          <div class="wp-ex-sheet-head">
            <h2 class="wp-ex-sheet-title">{current.heading}</h2>
            <div class="wp-ex-sheet-meta">{docTitle} · {rows.length} items</div>
          </div>
          <Worklist rows={rows} empty={current.empty} showDone={showDone} />
        </div>

        <footer class="wp-ex-foot">
          <button class="wp-ex-btn" onClick={downloadWorklist} disabled={!rows.length}>DOWNLOAD .TXT</button>
          <button class="wp-ex-btn" onClick={printWorklist} disabled={!rows.length}>PRINT LIST</button>
        </footer>
      </div>
    </div>
  );
}
