// Burma Script Tool — VERIFY ALL: editor-facing shell around verify-all-core.js.
// Collects every still-unverified {fc} span from the live doc (same enumerator the red
// flag widgets use), wires the pure batch engine to real fetch + the Workshop's own
// episode-keyed localStorage map, and exposes the next-unreviewed lookup the review
// button uses. The batch NEVER touches the document — results go to localStorage only;
// the only doc write in the whole flow stays the human approve (footnote drop → green).

import { findPendingFcRuns } from './extensions/marks.js';
import { getEpisodeStorage } from './episode-config.js';
import { runVerifyAll, makeBatchController, DEEP_CLIENT_TIMEOUT_MS } from './verify-all-core.js';

export { makeBatchController, DEEP_CLIENT_TIMEOUT_MS };

// Every fc span still awaiting verification (pending OR solid), with the same shape the
// per-span dock sends the backend: text + range + surrounding block + nearby context.
export function collectFcRuns(editor) {
  const { state } = editor;
  const markType = state.schema.marks.factCheckSpan;
  if (!markType) return [];
  const size = state.doc.content.size;
  return findPendingFcRuns(state.doc, markType)
    .map((run) => {
      const $from = state.doc.resolve(run.from);
      return {
        text: state.doc.textBetween(run.from, run.to, ''),
        from: run.from,
        to: run.to,
        status: run.status,
        block: $from.parent && $from.parent.isTextblock ? $from.parent.textContent : '',
        context: state.doc.textBetween(Math.max(0, run.from - 1200), Math.min(size, run.to + 1200), ' '),
      };
    })
    .filter((r) => r.text.trim());
}

// The SAME map the Workshop dock persists to (episode-keyed) — one storage, two writers,
// merge-only updates on both sides.
export function workshopStorage() {
  const key = getEpisodeStorage().WORKSHOP;
  return {
    load() { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } },
    save(map) { try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* storage-blocked browser */ } },
  };
}

// Spans that have a clean batch/dock verdict waiting for human review (still un-approved —
// approval flips status to 'checked', which drops them out of findPendingFcRuns entirely).
export function reviewableRuns(editor, stored) {
  const map = stored || workshopStorage().load();
  return collectFcRuns(editor).filter((r) => {
    const rec = map[r.text];
    return rec && rec.verdict && !rec.verdictError;
  });
}

// Kick the batch with live wiring. corpusFor stays a pass-through seam: tonight's
// embedding session plugs retrieval in here (run → top-k vetted chunks) with zero
// changes to the engine or the API contract.
export function startVerifyAll(editor, { onProgress, controller, force, corpusFor } = {}) {
  return runVerifyAll({
    runs: collectFcRuns(editor),
    fetchImpl: (...args) => fetch(...args),
    storage: workshopStorage(),
    onProgress,
    controller,
    force,
    corpusFor,
  });
}
