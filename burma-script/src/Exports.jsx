// Burma Script Tool — EXPORTS.
// Two export surfaces, one Swiss panel:
//   1. PRINT / PDF the whole script  — handled by the @media print stylesheet (styles.css):
//      window.print() hides all chrome and lays the document out black-on-white with page
//      breaks at chapters. The "Print script (PDF)" button just calls window.print() on the
//      live document — the editor surface itself is the print artifact.
//   2. WORKLIST — one clean, printable + downloadable view derived from the LIVE doc:
//        • TRANSLATION  — every SOT speaker quote (sound-on-tape to translate / subtitle)
//      The worklist is its OWN printable view (a class on <html> swaps which surface prints)
//      and downloadable as a clean .txt the producer can hand off.
//
// Reads the doc through docToBlocks(editor.getJSON()) so the worklists reflect every live
// edit, reorder, and done-tick — never the stale source file. Swiss restraint: a calm
// near-white overlay, mono labels, the single red accent, no modal chrome zoo.

import { useState, useMemo, useEffect, useCallback } from 'preact/hooks';
import { docToBlocks } from './document-builder.js';
import { buildWorklists, toPlainText, actionable } from './worklists.js';

// Worklist bodies unwrap the inline span scaffolding ({tk …} / [visual …]) to inner text —
// stripSpanScaffolding lives beside its inverse (inlineContent/wrapToken) in document-builder.js
// and is guarded by the worklist-unwrap checks in integrity-check.ts. The pure extraction logic
// (buildWorklists / toPlainText / actionable) lives in worklists.js so it is
// unit-tested headlessly; this file owns only the render + download/print plumbing.

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
  { key: 'translation', label: 'TRANSLATION', file: 'burma-translation.txt', heading: 'Translation worklist (SOT)', empty: 'No SOT blocks to translate.' },
];

// `getDoc` returns the live ProseMirror JSON; `docTitle` heads the printed/downloaded sheet.
export function Exports({ getDoc, docTitle }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('translation');
  // Rebuild the worklist from the live doc each time the panel opens (cheap; ~225 blocks).
  const [lists, setLists] = useState({ translation: [] });

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
  const liveRows = actionable(rows); // passthrough now (TRANSLATION rows carry no empty flag)
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
    download(current.file, toPlainText(current.heading, docTitle, liveRows, { done: showDone }));
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
              {t.label}<span class="wp-ex-count">{actionable(lists[t.key] || []).length}</span>
            </button>
          ))}
        </nav>

        <div class="wp-ex-sheet" data-worklist={tab}>
          <div class="wp-ex-sheet-head">
            <h2 class="wp-ex-sheet-title">{current.heading}</h2>
            <div class="wp-ex-sheet-meta">{docTitle} · {liveRows.length} items</div>
          </div>
          <Worklist rows={rows} empty={current.empty} showDone={showDone} />
        </div>

        <footer class="wp-ex-foot">
          <button class="wp-ex-btn" onClick={downloadWorklist} disabled={!liveRows.length}>DOWNLOAD .TXT</button>
          <button class="wp-ex-btn" onClick={printWorklist} disabled={!liveRows.length}>PRINT LIST</button>
        </footer>
      </div>
    </div>
  );
}
