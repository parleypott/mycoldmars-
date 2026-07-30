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
// Shallow batch bound. Mirrors the interactive contract in Workshop.jsx (70s client vs the
// 50s FC_UPSTREAM_TIMEOUT_MS server deadline) — the client bound must always sit ABOVE its
// server deadline or the UI gives up on a request the server would still have answered.
export const SHALLOW_CLIENT_TIMEOUT_MS = 70_000;
export const clientBoundFor = (mode) => (mode === 'fc-deep' ? DEEP_CLIENT_TIMEOUT_MS : SHALLOW_CLIENT_TIMEOUT_MS);

// Which runs actually need work. Skips: duplicate claim texts (first instance wins) and
// spans that already carry a clean verdict (unless force) — a re-run after a partial
// failure only re-checks the failed/unchecked ones.
export function planRuns(runs, stored, { force = false, mode = 'fc-deep' } = {}) {
  const toRun = [];
  const skipped = [];
  const seen = new Set();
  for (const r of runs) {
    if (seen.has(r.text)) { skipped.push(r); continue; }
    seen.add(r.text);
    const rec = stored[r.text];
    if (!force && rec && rec.verdict && !rec.verdictError && satisfies(rec, mode)) { skipped.push(r); continue; }
    toRun.push(r);
  }
  return { toRun, skipped };
}

// Does an existing verdict already meet the depth being asked for?
//
// THE TRAP THIS EXISTS TO PREVENT: run a shallow batch while deep is unavailable, then run
// deep once it's back and click VERIFY ALL — without this, every
// shallow verdict reads as "already verified" and gets skipped, so the deep pass silently
// never happens on a single claim and the script looks fully checked when it isn't.
//
// Depth is ordered: a deep verdict satisfies a shallow request (it's strictly more work),
// a shallow verdict does NOT satisfy a deep request. Records written before mode-stamping
// existed carry no `mode`; they came from the deep-only era, so treat them as deep.
export function satisfies(rec, mode = 'fc-deep') {
  const have = rec && rec.mode ? rec.mode : 'fc-deep';
  if (mode === 'fc-deep') return have === 'fc-deep';
  return true; // a shallow request is met by either depth
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

// How many CONSECUTIVE infrastructure-shaped failures end the batch. Three, because one
// is noise and two can be coincidence, but three in a row is the deployment telling you
// the remaining N would fail identically.
export const INFRA_FAILURE_LIMIT = 3;

// A DEFINITIVE "not available here" — the server saying this mode is switched off on this
// deployment. Distinct from isInfraFailure: that's a streak (could be a blip), this is proof
// on the first hit. Matches the 501 bodies from burma-tk (deep_unavailable) and
// citations-search (retrieval_not_configured).
export function isUnavailable(msg) {
  // upstream_rejected = the model provider refused on ACCOUNT grounds (spend cap, quota, bad
  // key). Like a 501 it is definitive for the whole batch, not this one claim: every
  // remaining claim hits the same wall, so stop on the first rather than burning 45 attempts
  // and the shared rate budget discovering the same thing 45 times.
  return /\b501\b|_unavailable|not_configured|upstream_rejected|usage limits|not available on this deployment/i.test(String(msg || ''));
}

// Is this failure about the DEPLOYMENT rather than this particular claim? Platform kills
// (502/503/504), the shared rate bucket (429), and the safe-parse fallback for a
// non-JSON platform error page all mean "every other claim will hit this too". A timeout
// or a model-level error is per-claim and must NOT count — the next claim deserves its turn.
export function isInfraFailure(msg) {
  return /\b(429|50[234])\b|rate limit|too many requests|server error \(/i.test(String(msg || ''));
}

// The batch engine. Fan-out at bounded concurrency; each span POSTs mode:'fc-deep' and
// persists its own result the moment it lands (data-loss law: a crash mid-batch keeps
// every finished verdict). Per-claim failures persist a verdictError and DON'T stop the
// queue; a run of INFRA_FAILURE_LIMIT deployment-level failures DOES (see circuit breaker).
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
  mode = 'fc-deep',
  timeoutMs = null, // null = derive from the ACTIVE mode (it can downgrade mid-batch)
}) {
  const ctl = controller || makeBatchController();
  const { toRun, skipped } = planRuns(runs, storage.load(), { force, mode });
  // The depth actually in use. Starts at the caller's request and DOWNGRADES on the first
  // deep_unavailable, so one click gets the best depth this deployment can serve instead of
  // failing outright. Every record is stamped with the depth that produced it.
  let activeMode = mode;
  let downgraded = false;
  const total = toRun.length;
  let done = 0;
  let failed = 0;
  let infraStreak = 0;   // consecutive deployment-level failures; any success resets it
  let stoppedReason = ''; // set when the circuit breaker trips, surfaced to the caller
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
      const killer = setTimeout(() => ac.abort(), timeoutMs || clientBoundFor(activeMode));
      try {
        const body = { mode: activeMode, marker: run.text, block: run.block || '', context: run.context || '' };
        // Corpus pre-flight. AWAITED — corpusFor is async now that it's wired to the
        // citations RAG over HTTP (corpus-retrieval.js); the earlier sync call would have
        // handed Array.isArray a Promise and silently dropped every chunk.
        //
        // Its own try/catch, INSIDE the run's: retrieval is an enhancement, so a corpus
        // failure must degrade this run to web-only, never mark it failed. Letting it fall
        // to the outer catch would turn "the RAG was down" into "the fact-check failed".
        let corpus = null;
        if (corpusFor && activeMode === 'fc-deep') { // shallow mode has no corpus seam server-side
          try { corpus = await corpusFor(run); } catch { corpus = null; }
        }
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
        // Record whether the corpus actually reached the model. Retrieval degrades
        // silently by design, and on a CITATIONS feature "grounded in Newpress research"
        // vs "web-only because the RAG was down" must not look identical after the fact.
        // 0 = web-only (no RAG, no hits, or a degraded call); N = N vetted chunks sent.
        persist(run.text, {
          verdict: data,
          verdictError: '',
          corpusUsed: Array.isArray(corpus) ? corpus.length : 0,
          // STAMP THE DEPTH. This is what lets a later deep pass find the shallow ones
          // instead of skipping them as "already verified" (see satisfies()).
          mode: activeMode,
        });
        done++;
        infraStreak = 0; // a success proves the deployment is healthy — forget the streak
      } catch (err) {
        if (!ctl.cancelled) {
          const msg = err && err.name === 'AbortError' ? 'timed out' : ((err && err.message) || String(err));
          persist(run.text, { verdictError: msg });
          failed++;
          // CIRCUIT BREAKER (production incident 2026-07-30). A DEPLOYMENT-level failure —
          // the platform killing the function (502) or the shared rate bucket emptying (429)
          // — is identical for every remaining claim. Grinding through them all does three
          // harmful things: it can't succeed, it drains the SAME token bucket the writers'
          // interactive VERIFY CLAIM button uses (so a broken batch degrades a working
          // feature for everyone), and it buries the real cause under N console errors.
          //
          // Per-claim failures (a bad marker, one timeout) must NOT trip this — they're
          // independent and the next claim deserves its turn. Only consecutive
          // infrastructure-shaped failures count, and the streak resets on any success.
          // A 501 is DEFINITIVE, not a streak: the server is saying this mode is not
          // available on this deployment. One is proof; there is no point spending two
          // more claims confirming it.
          if (isUnavailable(msg)) {
            // Deep is off on this deployment. If we were asked for deep, DOWNGRADE to
            // shallow and keep going — the writer-grade check still fits the platform's
            // time limit, so one click gets the best available depth. Re-queue this claim
            // so it isn't lost to the failed attempt. Only give up if shallow fails too.
            if (activeMode === 'fc-deep') {
              activeMode = 'fc';
              downgraded = true;
              failed--; // the deep attempt doesn't count; shallow gets its turn
              queue.unshift(run);
            } else {
              ctl.cancel();
              stoppedReason = `${msg} Nothing was lost — re-run once it's enabled and this picks up where it left off.`;
            }
          } else if (isInfraFailure(msg)) {
            infraStreak++;
            if (infraStreak >= INFRA_FAILURE_LIMIT) {
              ctl.cancel();
              stoppedReason = `stopped after ${infraStreak} consecutive server failures (${msg}) — the remaining claims would fail the same way. Nothing was lost: re-run to pick up where this left off.`;
            }
          } else {
            infraStreak = 0;
          }
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
  return { done, failed, total, skipped: skipped.length, cancelled: ctl.cancelled, stoppedReason, mode: activeMode, downgraded };
}
