import { BURMA } from '../config.js';

// Boot-order contract: the active episode must be chosen before startup work begins. Modules may
// import these live bindings at module init, so this singleton always starts with Burma and the
// entry calls setEpisode(...) again before rendering to make the selected episode explicit.
let activeEpisode = BURMA;
const listeners = new Set();

function notify() {
  // Isolate each listener: on an episode SWITCH every registered module recomputes its
  // own localStorage keys here (syncStorageKeys / syncEpisodeKeys across recovery,
  // migrate-doc, cloud-sync, Editor, Workshop, write-token, recovery-store). A bare loop
  // lets ONE throwing listener strand every listener after it with stale keys pointed at
  // the PREVIOUS episode — a cross-episode data-integrity hazard. Wrapping per-listener
  // keeps the blast radius at the one bad module; the rest still resync. Mirrors the
  // sibling listener notifier in translation/src/auth.js.
  for (const listener of listeners) {
    try { listener(activeEpisode); } catch (err) { console.warn('[episode-config] listener threw:', err); }
  }
}

export function getEpisode() {
  if (!activeEpisode) throw new Error('episode config read before initialization');
  return activeEpisode;
}

export function setEpisode(episode) {
  if (!episode || typeof episode !== 'object') {
    throw new Error('setEpisode requires an episode config object');
  }
  activeEpisode = episode;
  notify();
  return activeEpisode;
}

export function getEpisodeStorage() {
  return getEpisode().storage;
}

// Feature-flag read for the active episode's `features` object. Replaces the old hardcoded
// `getEpisode()?.id === 'palau'` gates — episodes opt into engine features via config instead
// of the engine special-casing an id. Always read LIVE (never freeze at module init) and
// default to OFF for configs that carry no features object (e.g. brand-new library projects).
export function episodeFlag(name) {
  try { return !!(getEpisode()?.features?.[name]); } catch { return false; }
}

export function onEpisodeChange(listener) {
  if (typeof listener !== 'function') throw new Error('onEpisodeChange requires a function');
  listeners.add(listener);
  // Isolate the INITIAL invocation too (same posture as notify()). Seven modules register at
  // bootstrap via a top-level onEpisodeChange(...) call, each firing its listener once here. Left
  // bare, a listener that throws on this first call (e.g. a locked-down/private-browsing localStorage
  // access — the class the theme-toggle fixes closed) would propagate out and ABORT the registrant's
  // module evaluation, cascading up the import graph to a white-screened editor — a strictly worse
  // blast radius than notify()'s sibling-stranding. Wrapping keeps the failure at the one bad module:
  // the registrant still gets its unsubscribe handle and stays registered for future switches.
  try { listener(activeEpisode); } catch (err) { console.warn('[episode-config] listener threw:', err); }
  return () => listeners.delete(listener);
}
