// sentry-lite — dependency-free error reporting for the Interpreter.
//
// Why not @sentry/browser? The app already ships several large vendor chunks;
// a 30KB SDK to catch uncaught errors is overkill. This posts a minimal event
// straight to Sentry's store endpoint via fetch — enough to surface the class
// of bug that just bit us (a silent throw in the transcript load path that the
// UI swallowed). Errors land in harris-3m/javascript, tagged app:interpreter.
//
// The DSN public key is meant to live in client code — it only permits writing
// events, never reading them. Safe to ship in the bundle.

const DSN = 'https://e859baaf76dba29c5f8de809ca65aa30@o4511436577308672.ingest.us.sentry.io/4511436583469056';

function parseDsn(dsn) {
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

const target = parseDsn(DSN);

// Cheap de-dupe + rate-limit so a render loop can't spam the project.
const seen = new Set();
let sentThisMinute = 0;
setInterval(() => { sentThisMinute = 0; }, 60_000);

function uuid() {
  // 32 hex chars, no dashes (Sentry event_id format).
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function send(level, message, error, extra) {
  if (!target) return;
  const sig = (message || '') + '|' + (error && error.stack ? error.stack.slice(0, 200) : '');
  if (seen.has(sig)) return;
  if (sentThisMinute >= 20) return;
  seen.add(sig); sentThisMinute++;

  const event = {
    event_id: uuid(),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level,
    logger: 'interpreter',
    environment: 'production',
    release: 'interpreter@' + (window.__BUILD_ID__ || 'live'),
    message: { formatted: String(message || (error && error.message) || 'Unknown error') },
    tags: { app: 'interpreter' },
    request: { url: location.href },
    extra: {
      stack: error && error.stack ? error.stack : undefined,
      userAgent: navigator.userAgent,
      ...extra,
    },
  };

  try {
    fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,        // survive the unload that often accompanies a crash
      mode: 'cors',
    }).catch(() => {});
  } catch { /* never let the reporter throw */ }
}

export function initErrorReporting() {
  if (!target || window.__interpreterSentryInstalled) return;
  window.__interpreterSentryInstalled = true;

  window.addEventListener('error', (e) => {
    // Resource load errors (img/script 404) have no e.error — skip the noise.
    if (!e.error && !e.message) return;
    send('error', e.message, e.error, { source: e.filename, line: e.lineno, col: e.colno });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason;
    const err = reason instanceof Error ? reason : null;
    send('error', err ? err.message : ('Unhandled rejection: ' + safeStr(reason)), err);
  });
}

// Optional manual capture for caught-but-notable errors (e.g. the handleLoad
// catch). Import and call captureError(err, {context}) where useful.
export function captureError(error, extra) {
  send('error', error && error.message, error, extra);
}

function safeStr(v) {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return '[unserializable]'; }
}
