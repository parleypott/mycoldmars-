// sentry-dsn — pure, side-effect-free Sentry DSN → store-endpoint parser.
//
// Extracted verbatim from sentry-lite.js so it can be unit-tested in isolation
// (sentry-lite.js installs a top-level setInterval + window listeners, so it
// can't be imported under node). This is the load-bearing core of the whole
// error-reporting pipeline: it turns the public DSN into the exact legacy
// `/api/<projectId>/store/?sentry_key=…&sentry_version=7` URL that events POST
// to. If this returns the wrong URL — wrong projectId, missing key/version,
// or null — every error report Johnny relies on (to catch the silent-swallowed
// throws this module exists for) fails the fetch, which is `.catch`-swallowed,
// so reporting breaks SILENTLY and forever. Hence the dedicated lock.

export function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    return {
      key: u.username,
      // store endpoint: https://<host>/api/<projectId>/store/
      url: `${u.protocol}//${u.host}/api/${projectId}/store/?sentry_key=${u.username}&sentry_version=7`,
    };
  } catch { return null; }
}
