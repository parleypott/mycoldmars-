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

// Crash-safe localStorage READ for the theme preference — the read-side sibling
// of saveTheme. This value is read at MODULE TOP-LEVEL (main.js boot), so a raw
// `localStorage.getItem` there throws SecurityError in blocked-storage contexts
// (Safari "Block All Cookies", Brave shields, strict private mode) — which aborts
// the whole module and the map never initializes: the entire page is dead. The
// storage access lives INSIDE the try (not a default arg), an invalid saved value
// is ignored, and any storage failure degrades to `fallback`. Injectable + pure,
// so it's fully headless-testable. Mirrors pinglobe's readSavedTheme.
export function readTheme(store, key, fallback, isValid = () => true) {
  try {
    const saved = store.getItem(key);
    if (saved && isValid(saved)) return saved;
  } catch {
    /* blocked / throwing store — fall through to fallback */
  }
  return fallback;
}
