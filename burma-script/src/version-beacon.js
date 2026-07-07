// Burma Script Tool — STALE-BUNDLE VERSION BEACON.
//
// THE SYMPTOM THIS KILLS: "the editor is broken / blank, but it works in a private window."
// A private window has no HTTP cache — the tell that the long-lived tab is running a STALE
// BUNDLE from before the latest deploy (Johnny keeps script tabs open for days; Vercel ships
// multiple times a day). A stale bundle against a new API/room is undefined behavior.
//
// HOW IT DETECTS: Vite fingerprints every chunk (/assets/index-<hash>.js) and hashes cascade
// through the import graph, so ANY code change re-hashes the entry the HTML references. We
// fetch this page's own HTML (cache: 'no-store'), extract the asset signature, and remember
// the first one as the baseline. When a later probe (every 5 min + on tab re-focus, when a
// stale bundle is most likely) returns a different signature, a deploy has landed since this
// tab loaded → fire onStale exactly once. NO api function involved — the repo has hit
// Vercel's free-tier api-deployments-per-day cap before; this costs one static GET.
//
// Deliberately QUIET + FAIL-SAFE: network errors are ignored (next tick retries), a probe
// can never break the editor, and the consumer (main.jsx) renders a small reload pill —
// never an interrupting modal. Pure parts exported for version-beacon.test.mjs.

// Sorted, deduped list of fingerprinted JS assets referenced by an HTML document — the
// bundle's identity. Query/origin-agnostic: matches the /assets/<name>.js path shape both
// absolute and relative references produce.
export function extractBundleSignature(html) {
  const found = String(html || '').match(/[A-Za-z0-9._/-]*\/assets\/[A-Za-z0-9._-]+\.js/g) || [];
  const names = found.map((p) => p.slice(p.lastIndexOf('/assets/')));
  return [...new Set(names)].sort().join('|');
}

// One probe: this page's own HTML, bypassing the HTTP cache. Returns the signature, or null
// when the fetch failed / returned junk (caller skips the tick — never a false positive).
export async function probeBundleSignature(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!res || !res.ok) return null;
    const sig = extractBundleSignature(await res.text());
    return sig.length ? sig : null;
  } catch {
    return null;
  }
}

// Pure tick logic (testable): given the previous baseline and a fresh probe result, decide
// { baseline, stale }. A null probe never advances or trips anything.
export function nextBeaconState(baseline, probed) {
  if (probed == null) return { baseline, stale: false };
  if (baseline == null) return { baseline: probed, stale: false };
  return { baseline, stale: probed !== baseline };
}

const PROBE_INTERVAL_MS = 5 * 60 * 1000;

// Start watching. onStale fires AT MOST ONCE, then the beacon stops itself. Returns stop().
export function startVersionBeacon({ onStale, intervalMs = PROBE_INTERVAL_MS } = {}) {
  let baseline = null;
  let stopped = false;
  let inFlight = false;

  const url = window.location.pathname + window.location.search;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    const probed = await probeBundleSignature(fetch.bind(window), url);
    inFlight = false;
    if (stopped) return;
    const next = nextBeaconState(baseline, probed);
    baseline = next.baseline;
    if (next.stale) {
      stop();
      try { onStale && onStale(); } catch {}
    }
  };

  // Re-focusing a long-parked tab is the moment a stale bundle is most likely (and the
  // moment Johnny is about to type into it) — probe immediately, don't wait for the timer.
  const onVisible = () => { if (!document.hidden) tick(); };

  const timer = setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', onVisible);
  tick(); // establish the baseline now

  return stop;
}
