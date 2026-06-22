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
