// Shared authorization helpers for the admin console (api/admin-users.js).
//
// These are the authorization GATE for every privileged admin action
// (list / create / delete / set_password). They were previously inline in
// admin-users.js with ZERO test coverage, and the ADMIN_EMAILS parse was
// duplicated between the gate and the bootstrap action — a divergent copy
// waiting to drift. Extracted here as a single source of truth so the gate
// has one definition and a mutation-proven test can catch a regression
// (a loosened substring match, a dropped case-fold) BEFORE it becomes a
// privilege-escalation hole. Pure + env-driven: no I/O, fully testable.

// Parse the server-controlled ADMIN_EMAILS env value into a normalized list.
// Comma-separated, trimmed, lowercased, empties dropped.
export function parseAdminEmails(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Is this verified email an admin?
// Fail-closed: a missing email, or an empty/unset admin list, → false.
// EXACT (case-insensitive) membership only — never a substring/prefix match,
// or "notadmin@x.com" would match an admin entry of "admin@x.com".
// `raw` defaults to the live env at call time (default params evaluate per
// call), so the runtime behavior is identical to reading process.env inline;
// tests pass it explicitly.
export function isAdminEmail(email, raw = process.env.ADMIN_EMAILS) {
  if (!email) return false;
  const list = parseAdminEmails(raw);
  if (!list.length) return false;
  return list.includes(String(email).toLowerCase());
}

// Is the request URL pointing at a loopback host? Used (heavily gated — only
// when NOT production AND ADMIN_EMAILS is unset) for the localhost dev bypass.
// EXACT host match only; fail-closed (false) on an unparseable URL so a
// malformed or spoofed URL can never trip the bypass.
export function isLoopbackHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
