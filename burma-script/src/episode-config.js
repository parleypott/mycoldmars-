import { BURMA } from '../config.js';

// Boot-order contract: the active episode must be chosen before startup work begins. Modules may
// import these live bindings at module init, so this singleton always starts with Burma and the
// entry calls setEpisode(...) again before rendering to make the selected episode explicit.
let activeEpisode = BURMA;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(activeEpisode);
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

export function onEpisodeChange(listener) {
  if (typeof listener !== 'function') throw new Error('onEpisodeChange requires a function');
  listeners.add(listener);
  listener(activeEpisode);
  return () => listeners.delete(listener);
}
