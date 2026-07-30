// Coverage for verify-all-core.js — the pure batch engine behind VERIFY ALL.
// Everything injected (fetch, storage, controller), so these tests prove the engine's
// contracts without a DOM, an editor, or a network:
//
//   1. PLANNING: already-verified spans are skipped (unless force), failed ones are
//      retried, duplicate claim texts collapse to one check.
//   2. PERSISTENCE: results merge into the Workshop map shape ({kind:'fc', verdict})
//      without clobbering the writer's own fields (note/resolved), and every result
//      lands the moment it finishes (crash mid-batch keeps finished verdicts).
//   3. FAILURE ACCOUNTING: a failing span persists verdictError and does NOT stop the
//      queue; a non-JSON body (platform error page) becomes a clean message.
//   4. CONCURRENCY: in-flight never exceeds the bound.
//   5. CANCEL: stops the queue and aborts in-flight work.

import assert from 'node:assert';
import { planRuns, runVerifyAll, makeBatchController, DEEP_CLIENT_TIMEOUT_MS, INFRA_FAILURE_LIMIT, isInfraFailure } from './verify-all-core.js';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  RED:', name); }
}

const R = (text) => ({ text, from: 1, to: 2, block: 'B', context: 'C' });
function memStorage(initial = {}) {
  let map = JSON.parse(JSON.stringify(initial));
  return {
    load() { return JSON.parse(JSON.stringify(map)); },
    save(m) { map = JSON.parse(JSON.stringify(m)); },
    peek() { return map; },
  };
}
const okResponse = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

// ---- 1. planning ----
{
  const stored = {
    'already done': { kind: 'fc', verdict: { verdict: 'true' }, verdictError: '' },
    'failed last time': { kind: 'fc', verdictError: 'timed out' },
  };
  const runs = [R('already done'), R('failed last time'), R('fresh claim'), R('fresh claim')];
  const { toRun, skipped } = planRuns(runs, stored);
  ok('plan: clean verdict skipped', !toRun.some((r) => r.text === 'already done'));
  ok('plan: failed span retried', toRun.some((r) => r.text === 'failed last time'));
  ok('plan: duplicate claim text collapses to one check', toRun.filter((r) => r.text === 'fresh claim').length === 1);
  ok('plan: skipped accounted (dupe + done)', skipped.length === 2);
  const forced = planRuns(runs, stored, { force: true });
  ok('plan: force re-runs the clean one too', forced.toRun.some((r) => r.text === 'already done'));
}

// ---- 2. persistence: merge shape + immediate landing ----
{
  const storage = memStorage({ 'claim A': { kind: 'fc', note: 'writer note', resolved: false } });
  const result = await runVerifyAll({
    runs: [R('claim A')],
    fetchImpl: async () => okResponse({ mode: 'fc-deep', verdict: 'true', finding: 'f', suggestedEdit: 'e', claims: [{ claim: 'c', verdict: 'true' }], sources: [{ label: 'L', quote: 'Q' }] }),
    storage,
  });
  const rec = storage.peek()['claim A'];
  ok('persist: verdict landed in Workshop shape', rec && rec.kind === 'fc' && rec.verdict && rec.verdict.verdict === 'true');
  ok('persist: deep fields ride along (claims + grounded sources)', rec.verdict.claims.length === 1 && rec.verdict.sources[0].quote === 'Q');
  ok('persist: writer fields NOT clobbered', rec.note === 'writer note' && rec.resolved === false);
  ok('summary: 1 done, 0 failed', result.done === 1 && result.failed === 0);
}

// ---- 3. failure accounting ----
{
  const storage = memStorage();
  let calls = 0;
  const result = await runVerifyAll({
    runs: [R('bad claim'), R('good claim'), R('html claim')],
    concurrency: 1,
    fetchImpl: async (url, opts) => {
      calls++;
      const marker = JSON.parse(opts.body).marker;
      if (marker === 'bad claim') return okResponse({ error: 'rate limited' });
      if (marker === 'html claim') return { ok: false, status: 504, text: async () => 'An error occurred with your deployment' };
      return okResponse({ mode: 'fc-deep', verdict: 'true', finding: 'f', suggestedEdit: 'e', claims: [], sources: [] });
    },
    storage,
  });
  ok('failure: queue continues past failures (all 3 attempted)', calls === 3);
  ok('failure: error body persists verdictError', /rate limited/.test(storage.peek()['bad claim'].verdictError));
  ok('failure: non-JSON body becomes clean message (no parse crash)', /server error \(504\)/.test(storage.peek()['html claim'].verdictError));
  ok('failure: good one still landed', storage.peek()['good claim'].verdict.verdict === 'true');
  ok('summary: 1 done 2 failed', result.done === 1 && result.failed === 2);
}

// ---- 4. concurrency bound ----
{
  let inflight = 0, maxInflight = 0;
  const storage = memStorage();
  await runVerifyAll({
    runs: Array.from({ length: 9 }, (_, i) => R(`claim ${i}`)),
    concurrency: 3,
    fetchImpl: async () => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      return okResponse({ mode: 'fc-deep', verdict: 'true', finding: 'f', suggestedEdit: 'e', claims: [], sources: [] });
    },
    storage,
  });
  ok(`concurrency: never exceeds 3 (saw ${maxInflight})`, maxInflight === 3);
}

// ---- 5. cancel stops the queue + aborts in-flight ----
{
  const storage = memStorage();
  const ctl = makeBatchController();
  let aborted = 0, started = 0;
  const result = await runVerifyAll({
    runs: Array.from({ length: 6 }, (_, i) => R(`c${i}`)),
    concurrency: 2,
    controller: ctl,
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      started++;
      if (opts.signal) opts.signal.addEventListener('abort', () => { aborted++; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      if (started === 2) setTimeout(() => ctl.cancel(), 5); // cancel once two are in flight
    }),
    storage,
  });
  ok('cancel: queue stopped early (not all 6 started)', started < 6);
  ok('cancel: in-flight requests aborted', aborted >= 1);
  ok('cancel: summary flags cancelled', result.cancelled === true);
  ok('cancel: aborted spans NOT counted as failed', result.failed === 0);
}

// ---- 6. progress reporting ----
{
  const events = [];
  const storage = memStorage();
  await runVerifyAll({
    runs: [R('p1'), R('p2')],
    concurrency: 1,
    onProgress: (p) => events.push({ ...p }),
    fetchImpl: async () => okResponse({ mode: 'fc-deep', verdict: 'true', finding: 'f', suggestedEdit: 'e', claims: [], sources: [] }),
    storage,
  });
  ok('progress: initial + per-completion events', events.length === 3 && events[0].done === 0 && events[2].done === 2);
  ok('progress: total stable across events', events.every((e) => e.total === 2));
}

ok('const: client timeout sits above the 240s server bound', DEEP_CLIENT_TIMEOUT_MS === 260_000);


// ── 6. CIRCUIT BREAKER (production incident 2026-07-30) ─────────────────────
// A deployment-level failure is identical for every remaining claim. Grinding through
// them drains the SAME rate bucket the writers' interactive VERIFY CLAIM uses, so a
// broken batch degrades a working feature for the whole team.
{
  const R2 = (t) => ({ text: t, from: 1, to: 2, block: 'B', context: 'C' });
  const runs = Array.from({ length: 20 }, (_, i) => R2(`claim ${i}`));
  let hits = 0;
  const store = memStorage();
  const res = await runVerifyAll({
    runs, storage: store, concurrency: 1, corpusFor: null,
    fetchImpl: async () => { hits++; return { ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' }; },
  });
  ok('breaker: stops well short of all 20 claims', hits <= INFRA_FAILURE_LIMIT + 1);
  ok('breaker: reports why it stopped', /consecutive server failures/.test(res.stoppedReason || ''));
  ok('breaker: tells the user nothing was lost', /re-run/i.test(res.stoppedReason || ''));
}
{
  // 429 — the shared-bucket case — must also trip it.
  const R2 = (t) => ({ text: t, from: 1, to: 2, block: 'B', context: 'C' });
  let hits = 0;
  const res = await runVerifyAll({
    runs: Array.from({ length: 20 }, (_, i) => R2(`c${i}`)), storage: memStorage(), concurrency: 1, corpusFor: null,
    fetchImpl: async () => { hits++; return { ok: false, status: 429, text: async () => JSON.stringify({ error: 'rate limited' }) }; },
  });
  ok('breaker: 429 trips it too', hits <= INFRA_FAILURE_LIMIT + 1 && !!res.stoppedReason);
}
{
  // Per-claim failures must NOT trip it — all 20 deserve their turn.
  const R2 = (t) => ({ text: t, from: 1, to: 2, block: 'B', context: 'C' });
  let hits = 0;
  const res = await runVerifyAll({
    runs: Array.from({ length: 20 }, (_, i) => R2(`c${i}`)), storage: memStorage(), concurrency: 1, corpusFor: null,
    fetchImpl: async () => { hits++; return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'marker too long' }) }; },
  });
  ok('breaker: per-claim 400s do NOT trip it', hits === 20 && !res.stoppedReason);
  ok('breaker: all 20 still recorded as failed', res.failed === 20);
}
{
  // A success in the middle resets the streak.
  const R2 = (t) => ({ text: t, from: 1, to: 2, block: 'B', context: 'C' });
  let n = 0;
  const res = await runVerifyAll({
    runs: Array.from({ length: 9 }, (_, i) => R2(`c${i}`)), storage: memStorage(), concurrency: 1, corpusFor: null,
    fetchImpl: async () => {
      n++;
      if (n === 3 || n === 6) return { ok: true, status: 200, text: async () => JSON.stringify({ verdict: 'true', sources: [] }) };
      return { ok: false, status: 502, text: async () => '<html>Bad Gateway</html>' };
    },
  });
  ok('breaker: a success resets the streak (2 fails, ok, 2 fails, ok, ...)', res.done === 2 && n >= 8);
}

ok('isInfraFailure: 502 yes', isInfraFailure('server error (502)') === true);
ok('isInfraFailure: 429 yes', isInfraFailure('HTTP 429') === true);
ok('isInfraFailure: rate limited yes', isInfraFailure('rate limited') === true);
ok('isInfraFailure: timed out NO (per-claim)', isInfraFailure('timed out') === false);
ok('isInfraFailure: model error NO (per-claim)', isInfraFailure('marker too long') === false);

assert.ok(true);
console.log(`verify-all-core: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
