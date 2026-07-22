// Burma Script Tool — READ-ONLY SHARE MODE (read-only-share).
//
// Johnny sends a link with `?read` (or `?view`) and anyone can open it to READ his live
// script — but a recipient's browser must be STRUCTURALLY INCAPABLE of writing to his
// canonical doc. Read-only is the safety core of the share feature: no autosave, no
// saveDoc, no pushDoc, no localStorage LS_DOC write, no cloud PUT — ever.
//
// This module is the SINGLE source of truth for "are we in read-only mode?". It is read
// once, at module load, from the URL so the answer is stable across the whole session and
// can be cheaply consulted from the persistence layer (saveDoc / pushDoc), the editor, and
// the chrome. Defaulting: ANY parse failure resolves to FALSE so Johnny's normal edit URL
// is never accidentally turned read-only.

// Accept BOTH `?read` and `?view` (presence is enough — `?read`, `?read=1`, `?view=anything`).
// We also accept them inside the hash (e.g. `/#?read`) so static/hash routers still work.
function computeReadOnly() {
  try {
    if (typeof window === 'undefined' || !window.location) return false;
    const { search = '', hash = '' } = window.location;
    // Pull query params from BOTH the search string and anything after a `?` in the hash.
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
    for (const qs of [search, hashQuery]) {
      if (!qs) continue;
      const params = new URLSearchParams(qs.startsWith('?') ? qs : '?' + qs);
      if (params.has('read') || params.has('view')) return true;
    }
    return false;
  } catch {
    return false; // any failure → NOT read-only. Johnny's edit URL must never be downgraded.
  }
}

// Computed ONCE at module load. The URL signal does not change within a session without a
// reload (which re-evaluates this), so a frozen value keeps every consumer in lockstep — the
// editor, saveDoc, pushDoc and the chrome all agree on the same answer.
let _readOnly = computeReadOnly();

// The canonical query. Every write-path early-return and every editable gate keys off this.
export function isReadOnly() {
  return _readOnly;
}

// GUEST MODE LATCH (Google-Docs link sharing) — the Script Library's boot calls this for a
// signed-OUT visitor on a project link BEFORE importing the engine, so a guest session is
// read-only even on a BARE #slug link with no ?read flag. Deliberately ONE-WAY: it can only
// force read-only ON, never off — so no code path can ever use it to downgrade a ?read link
// into an editable session. Safe ordering: boot.jsx imports this module and latches before
// main.jsx (and every isReadOnly consumer) evaluates, so all consumers stay in lockstep.
export function forceReadOnly() {
  _readOnly = true;
  return _readOnly;
}

// TEST SEAM ONLY — lets a test mount a read-only session deterministically without driving a
// real URL. Never called by app code. Pass a boolean to force the mode; pass nothing to
// recompute from the (test-mocked) window.location.
export function __setReadOnlyForTest(v) {
  _readOnly = (v === undefined) ? computeReadOnly() : !!v;
  return _readOnly;
}
