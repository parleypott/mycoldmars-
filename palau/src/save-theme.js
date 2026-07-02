// Crash-safe localStorage write for the theme preference.
//
// Safari / Firefox Private Browsing (and any quota-exhausted store) throw a
// QuotaExceededError from setItem even for a tiny value. In the vibes handler
// the persist call runs BEFORE the visual theme swap (map.setStyle / applyThemeUI),
// so a raw throw there aborts the whole click: the map never restyles, the UI
// never updates, and currentTheme silently desyncs from what's on screen. This
// wrapper swallows the throw so the visual update always runs; the theme just
// won't persist across reload in a store that can't be written. Returns whether
// the value actually landed. Mirrors laserspace's saveHiScore + democracy's
// inline try/catch precedent.
export function saveTheme(store, key, value) {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
