// Burma Script Tool — VERIFY ALL core: the pure batch engine behind the one-click
// background fact-check. NO imports, NO DOM — everything (fetch, storage, cancellation)
// is injected, so this file is fully testable and the UI wrapper (verify-all.js) stays
// a thin shell. Methodology context: this is the batch half of the Kenneth-pipeline port
// (see api/burma-tk.js mode:'fc-deep') — the server does the grounding discipline; this
// engine does the fan-out, persistence, and failure accounting.
//
// PERSISTENCE CONTRACT: results land in the SAME episode-keyed map the Workshop dock
// reads/writes (`all[span.text] = { kind:'fc', verdict, verdictError, ...their fields }`),
// merged never clobbered — a writer's notes/resolved flags survive a batch run, and the
// dock shows a batch verdict exactly as if the writer had clicked VERIFY on that span.
//
// KEY COLLISION (documented, accepted): the map keys on span TEXT, so two spans with
// byte-identical claim text share one record. They would get identical verdicts anyway;
// approval (footnote drop) is still per-span because ranges come from a live collect.

// Server bounds fc-deep at 240s; the client belt-and-suspenders sits above it.
export const DEEP_CLIENT_TIMEOUT_MS = 260_000;

// Which runs actually need work. Skips: duplicate claim texts (first instance wins) and
// spans that already carry a clean verdict (unless force) — a re-run after a partial
// failure only re-checks the failed/unchecked ones.
export function planRuns(runs, stored, { force = false } = {}) {
  const toRun = [];
  const skipped = [];
  const seen = new Set();
  for (const r of runs) {
    if (seen.has(r.text)) { skipped.push(r); continue; }
    seen.add(r.text);
    const rec = stored[r.text];
    if (!force && rec && rec.verdict && !rec.verdictError) { skipped.push(r); continue; }
    toRun.push(r);
  }
  return { toRun, skipped };
}

// Cancellation shared across the whole batch: cancel() flips the flag (stops the queue)
// and aborts every in-flight request.
export function makeBatchController() {
  const aborters = new Set();
  return {
    cancelled: false,
    track(ac) { aborters.add(ac); return () => aborters.delete(ac); },
    cancel() {
      this.cancelled = true;
      for (const ac of aborters) { try { ac.abort(); } catch { /* already settled */ } }
    },
  };
}

// The batch engine. Fan-out at bounded concurrency; each span POSTs mode:'fc-deep' and
// persists its own result the moment it lands (data-loss law: a crash mid-batch keeps
// every finished verdict). Failures persist a verdictError and DON'T stop the queue.
export async function runVerifyAll({
  runs,
  fetchImpl,
  storage,
  endpoint = '/api/burma-tk',
  concurrency = 3,
  controller,
  onProgress,
  corpusFor,
  force = false,
  timeoutMs = DEEP_CLIENT_TIMEOUT_MS,
}) {
  const ctl = controller || makeBatchController();
  const { toRun, skipped } = planRuns(runs, storage.load(), { force });
  const total = toRun.length;
  let done = 0;
  let failed = 0;
  const report = () => {
    if (onProgress) onProgress({ done, failed, total, skipped: skipped.length, cancelled: ctl.cancelled });
  };
  report();

  // Merge-persist under the Workshop dock's own keying — never clobber their fields.
  // ATOMICITY INVARIANT: this load→merge→save has NO await inside it, so on a single
  // thread (one tab) two persists can never interleave — worker-vs-worker and
  // worker-vs-dock lost-updates are structurally impossible. Do NOT introduce an await
  // between load and save; that would open the classic read-modify-write race. The one
  // residual is two TABS writing the same episode map concurrently — the same exposure
  // the dock already has today, and batch results are cheap to re-run.
  const persist = (text, patch) => {
    const all = storage.load();
    all[text] = { ...(all[text] || {}), kind: 'fc', ...patch };
    storage.save(all);
  };

  const queue = toRun.slice();
  async function worker() {
    while (queue.length && !ctl.cancelled) {
      const run = queue.shift();
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : { abort() {}, signal: undefined };
      const untrack = ctl.track(ac);
      const killer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const body = { mode: 'fc-deep', marker: run.text, block: run.block || '', context: run.context || '' };
        const corpus = corpusFor ? corpusFor(run) : null;
        if (Array.isArray(corpus) && corpus.length) body.corpus = corpus;
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        // SAFE PARSE — same discipline as the dock: a platform error page must become a
        // clean message, never a JSON.parse stack trace.
        const raw = await res.text();
        let data;
        try { data = raw ? JSON.parse(raw) : {}; } catch {
          throw new Error(`server error (${res.status || 'network'})`);
        }
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        persist(run.text, { verdict: data, verdictError: '' });
        done++;
      } catch (err) {
        if (!ctl.cancelled) {
          persist(run.text, { verdictError: err && err.name === 'AbortError' ? 'timed out' : ((err && err.message) || String(err)) });
          failed++;
        }
      } finally {
        clearTimeout(killer);
        untrack();
        report();
      }
    }
  }

  const width = Math.max(1, Math.min(concurrency, toRun.length || 1));
  await Promise.all(Array.from({ length: width }, worker));
  return { done, failed, total, skipped: skipped.length, cancelled: ctl.cancelled };
}
