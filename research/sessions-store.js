// research hub — session-list store parsing.
//
// loadSessions() reads the persisted session list out of localStorage. Several
// consumers assume the result is an ARRAY without re-checking:
//   - newSession:    `[s, ...loadSessions()]`   (spread — throws on a non-iterable)
//   - updateSession: `loadSessions().findIndex(...)`
//   - openSession:   `loadSessions().find(...)`
//   - renderHistory: iterates / slices the result
//
// JSON.parse of a valid-but-non-array stored value ('{}', '5', '"x"') SUCCEEDS,
// so the old `JSON.parse(raw) ?? []` returned that non-array verbatim — and the
// next core action (start a research run, a report streaming in, the corkboard
// render at page load) crashed with a TypeError, with no recovery. No code path
// writes a non-array (saveSessions always stringifies an array), so this is a
// corrupt/legacy/tampered-store hardening — but the crash is real and reachable.
//
// parseSessionList GUARANTEES an array: a non-array, malformed JSON, or absent
// value all degrade to []. A real array passes through verbatim (zero regression).
export function parseSessionList(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ── corkboard render-boundary guards ──────────────────────────────────────
// parseSessionList GUARANTEES an array but NOT the shape of each entry. A legacy
// session object (written before `createdAt`/`prompt` existed), a partial write,
// or a hand-edited store can carry a session that lacks a string `prompt` or a
// valid `createdAt`. renderHistory rendered these RAW, with two reachable bugs:
//
//   `s.prompt.replace(/</g, "&lt;")`  -> TypeError when prompt is absent/non-string.
//        renderHistory runs on page load AND after every updateSession, so ONE bad
//        entry threw and blanked the ENTIRE corkboard history (no recovery).
//   `new Date(s.createdAt).toLocaleString()` -> the literal "Invalid Date" string
//        on a missing/unparseable timestamp (same class as the QSS / Hunter /
//        Interpreter / nile-flights / Burma-Essays Invalid-Date sweeps).
//
// Both guards are no-ops on a well-formed session (zero regression).

// Safe, tag-escaped prompt text for the corkboard. Coerces a null/undefined/
// non-string prompt to "" before escaping the only tag-opening char.
export function sessionPromptHtml(s) {
  return String((s && s.prompt) ?? "").replace(/</g, "&lt;");
}

// Locale time label for the corkboard. A valid timestamp passes through
// `toLocaleString()` unchanged; anything unparseable degrades to an em-dash
// instead of "Invalid Date".
export function sessionTimeLabel(value) {
  // `new Date(null)` and `new Date("")` coerce to the epoch (a VALID 1970 date),
  // which would print a misleading "1/1/1970" — treat nullish/empty as missing.
  if (value === null || value === undefined || value === "") return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
