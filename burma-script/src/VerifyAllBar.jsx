// Burma Script Tool — the VERIFY ALL bar. One-click background fact-checking for every
// still-unverified {fc} span (Ryan's flow, 2026-07-17: "highlight all of my fact checks
// and click a button to have them all run in the background... then my job is just to
// review each one"). Fixed pill, bottom-center — deliberately away from the save pill
// (bottom-right, bottom-LEFT while the dock is open per ux-06) and the right-edge dock.
//
// The batch touches localStorage only. Review = the existing per-span dock: REVIEW jumps
// to the next span that has a waiting verdict, selects + scrolls it, and opens the
// Workshop on it; approving there (footnote drop) flips it green, which removes it from
// the pending set — so the REVIEW counter naturally counts DOWN as Ryan works the queue.

import { useState, useEffect, useRef } from 'preact/hooks';
import { collectFcRuns, workshopStorage, reviewableRuns, startVerifyAll, makeBatchController } from './verify-all.js';

export function VerifyAllBar({ editor }) {
  const [counts, setCounts] = useState({ pending: 0, reviewable: 0 });
  const [progress, setProgress] = useState(null); // null = idle; {done,failed,total,...} while running
  const ctlRef = useRef(null);
  const debounceRef = useRef(null);

  const recompute = () => {
    if (!editor || editor.isDestroyed) return;
    const stored = workshopStorage().load();
    const runs = collectFcRuns(editor);
    setCounts({
      pending: runs.length,
      reviewable: runs.filter((r) => { const rec = stored[r.text]; return rec && rec.verdict && !rec.verdictError; }).length,
    });
  };

  useEffect(() => {
    if (!editor) return undefined;
    recompute();
    const onUpdate = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(recompute, 600);
    };
    editor.on('update', onUpdate);
    return () => { editor.off('update', onUpdate); clearTimeout(debounceRef.current); };
  }, [editor]);

  async function start() {
    if (progress) return;
    const ctl = makeBatchController();
    ctlRef.current = ctl;
    try {
      const summary = await startVerifyAll(editor, { controller: ctl, onProgress: (p) => setProgress(p) });
      window.dispatchEvent(new CustomEvent('wp-toast', {
        detail: summary.cancelled
          ? { msg: `verify all cancelled — ${summary.done} finished first` }
          : summary.failed
            ? { tone: 'error', msg: `fact checks done — ${summary.done} checked, ${summary.failed} failed (they'll retry on the next run)` }
            : { msg: `fact checks done — ${summary.done} checked. Click REVIEW to step through.` },
      }));
    } finally {
      ctlRef.current = null;
      setProgress(null);
      recompute();
    }
  }

  function review() {
    const next = reviewableRuns(editor)[0];
    if (!next) {
      window.dispatchEvent(new CustomEvent('wp-toast', { detail: { msg: 'nothing waiting for review' } }));
      return;
    }
    // Put the claim on screen, then open the dock on it — the Editor's own CH-02 guard
    // re-validates the range against the live mark before any later insert.
    try { editor.chain().focus().setTextSelection(next.from).scrollIntoView().run(); } catch { /* selection is best-effort */ }
    window.dispatchEvent(new CustomEvent('wp-open-workshop', {
      detail: { kind: 'fc', text: next.text, from: next.from, to: next.to, block: next.block, context: next.context },
    }));
  }

  const idleHidden = !progress && counts.pending === 0;
  if (idleHidden) return null;

  return (
    <div class="wp-verifyall" role="status">
      {progress ? (
        <>
          <span class="wp-va-spin" aria-hidden="true" />
          <span class="wp-va-label">
            checking {progress.done + progress.failed}/{progress.total}
            {progress.failed ? ` · ${progress.failed} failed` : ''}
            {progress.skipped ? ` · ${progress.skipped} already done` : ''}
          </span>
          <button class="wp-va-btn wp-va-cancel" onClick={() => ctlRef.current && ctlRef.current.cancel()}>CANCEL</button>
        </>
      ) : (
        <>
          <button class="wp-va-btn wp-va-run" onClick={start}
            title="Deep fact-check every unverified claim in the background — grounded sources with verbatim quotes; you keep writing">
            VERIFY ALL ({counts.pending})
          </button>
          {counts.reviewable > 0 && (
            <button class="wp-va-btn wp-va-review" onClick={review}
              title="Jump to the next claim with a verdict waiting — approve it by dropping its footnote">
              REVIEW ({counts.reviewable})
            </button>
          )}
        </>
      )}
    </div>
  );
}
