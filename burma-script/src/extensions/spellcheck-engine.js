// Burma Script Tool — SPELLCHECK ENGINE (LOADED LAZILY).
//
// This module is ONLY ever reached via `await import('./spellcheck-engine.js')` from spellcheck.js's
// warm step — never statically imported by the editor bundle. Because the three heavy imports below
// live here, vite code-splits nspell AND both inlined Hunspell dictionary strings into ONE async
// chunk (~200KB gzip), leaving the core editor bundle untouched — the same posture as the lamejs /
// mp4-muxer audio path. The `?raw` query inlines the .aff/.dic FILE TEXT into the JS chunk at build
// time: CSP-clean, zero runtime fetch, nothing lands in public/ (satisfies the strict-CSP rule).
//
// dictionary-en is pinned to v3.x on purpose: it ships index.aff / index.dic at the package root
// with no `exports` gate, so the `?raw` deep-import resolves through vite cleanly. v4+ is ESM-only
// with a restrictive exports map that can block the deep path. The dic data is SCOWL-derived (MIT
// AND BSD) — clean for Johnny's use.

import affRaw from 'dictionary-en/index.aff?raw';
import dicRaw from 'dictionary-en/index.dic?raw';
import nspell from 'nspell';
import { loadPersonalDict, addToPersonalDictStore, shouldCheck } from './spellcheck-core.js';

// Memoized singleton. Built on first getSpeller(); seeded with the personal dictionary so Johnny's
// added names (Moharem, Lulu, Aswan) read as correct immediately, with no reload.
let speller = null;

export async function getSpeller() {
  if (!speller) {
    speller = nspell(affRaw, dicRaw);
    for (const w of loadPersonalDict()) {
      try { speller.add(w); } catch {}
    }
  }
  return speller;
}

// A word is misspelled if the Hunspell instance rejects it. Personal-dict words were seeded via
// speller.add (getSpeller + addToPersonalDict), so `correct()` already returns true for them — no
// separate set lookup needed. Returns false when the engine isn't built yet (caller yields to
// native rather than falsely flagging).
export function isMisspelled(word) {
  if (!speller) return false;
  try { return !speller.correct(word); } catch { return false; }
}

// Up to 5 ranked suggestions. Empty array → the wiring layer must NOT preventDefault, so Chrome's
// native context menu surfaces instead of a dead end (the fallback Johnny accepts).
export function suggestions(word) {
  if (!speller) return [];
  try { return speller.suggest(word).slice(0, 5); } catch { return []; }
}

// Persist to localStorage AND teach the live instance, so the word stops flagging without a reload.
export function addToPersonalDict(word) {
  addToPersonalDictStore(word);
  if (speller) { try { speller.add(word); } catch {} }
}

export { shouldCheck };
