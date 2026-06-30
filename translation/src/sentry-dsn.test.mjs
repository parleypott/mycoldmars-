// Lock parseDsn — the load-bearing core of the Interpreter's error reporter
// (extracted from sentry-lite.js, added Jun 2026). It turns the public DSN into
// the legacy Sentry store-endpoint URL that every error event POSTs to. The
// fetch failure is `.catch`-swallowed, so a wrong URL breaks ALL error
// reporting SILENTLY — Johnny would lose visibility into exactly the swallowed
// throws this module exists to surface. This pins the URL contract.
//
// Run: node translation/src/sentry-dsn.test.mjs

import { parseDsn } from './sentry-dsn.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// The live DSN shape: https://<key>@<host>/<projectId>
const KEY = 'e859baaf76dba29c5f8de809ca65aa30';
const HOST = 'o4511436577308672.ingest.us.sentry.io';
const PROJ = '4511436583469056';
const DSN = `https://${KEY}@${HOST}/${PROJ}`;

const t = parseDsn(DSN);

// ── shape ───────────────────────────────────────────────────────────────
eq(t !== null, true, 'valid DSN parses to an object');
eq(t.key, KEY, 'key = DSN username');

// ── the store-endpoint URL contract (the whole point) ─────────────────────
const expected =
  `https://${HOST}/api/${PROJ}/store/?sentry_key=${KEY}&sentry_version=7`;
eq(t.url, expected, 'store URL: /api/<projectId>/store/ with key + version=7');

// Pin each load-bearing piece independently so a refactor can't quietly drift
// one without tripping the test.
eq(t.url.includes(`/api/${PROJ}/store/`), true, 'projectId comes from the path, not the host');
eq(t.url.includes(`sentry_key=${KEY}`), true, 'sentry_key carried in the query string');
eq(t.url.endsWith('sentry_version=7'), true, 'sentry_version=7 (legacy store API)');
eq(t.url.includes(HOST), true, 'host preserved');
// projectId must be the bare id — no leading slash leaking through from pathname.
eq(t.url.includes('/api//'), false, 'no double slash — leading path slash stripped');
eq(t.url.includes(`/api/${PROJ}/store/`) && !t.url.includes(`/api//${PROJ}`), true, 'projectId is slash-stripped exactly once');

// ── host with an explicit port is preserved verbatim (u.host includes port) ─
const ported = parseDsn(`https://k@example.com:9000/77`);
eq(ported.url, 'https://example.com:9000/api/77/store/?sentry_key=k&sentry_version=7', 'port is kept in the endpoint host');

// ── protocol is taken from the DSN, not hardcoded ─────────────────────────
const httpDsn = parseDsn('http://k@h.test/9');
eq(httpDsn.url.startsWith('http://'), true, 'protocol mirrors the DSN scheme');

// ── garbage degrades to null (never throws into the error handler) ────────
eq(parseDsn('not a url'), null, 'malformed DSN → null');
eq(parseDsn(''), null, 'empty string → null');
eq(parseDsn(null), null, 'null → null');
eq(parseDsn(undefined), null, 'undefined → null');
eq(parseDsn(12345), null, 'non-string → null');

console.log(`\nsentry-dsn: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
