// Server-side Sentry helper for Vercel Edge functions.
// All 25 of the /api/* handlers run on the edge runtime, so we use
// @sentry/vercel-edge (NOT @sentry/node, which won't load on edge).
//
// Usage in a handler:
//
//   import { withSentry, captureServerError } from './_lib/sentry.js';
//
//   export default withSentry(async function handler(req) {
//     // your code; throws are auto-captured
//   });
//
// Or, for finer control:
//
//   try { ... } catch (err) { await captureServerError(err, { route: 'claude' }); throw err; }
//
// No-ops if SENTRY_DSN is unset — safe to leave wired in everywhere.

import * as Sentry from '@sentry/vercel-edge';

// Derive the Sentry `route` tag from a request URL, NEVER throwing.
//
// This runs INSIDE withSentry's catch block, while we're already handling the
// handler's original error. The old inline form was `new URL(req.url).pathname
// .replace(/^\/api\//, '')` — but `new URL()` throws a TypeError on a missing,
// relative, or malformed `req.url`. A throw there is the worst possible place
// for one: it would replace the handler's real error (the thing we're trying to
// report) with a URL-parse error, mask the genuine failure in Sentry, AND change
// what propagates to the client. On Vercel Edge `req.url` is an absolute string
// today so this is latent — but an error path must not be the thing that can
// crash. Falls back to the relative path (or 'unknown') so there's always a
// usable tag and the original error always survives to be captured + rethrown.
export function routeTag(rawUrl) {
  const s = typeof rawUrl === 'string' ? rawUrl : '';
  let pathname = s;
  try {
    pathname = new URL(s).pathname;
  } catch {
    // Not an absolute URL — isolate the path from a relative form, stripping
    // any query/hash so the tag stays a clean route.
    pathname = s.split(/[?#]/)[0] || s;
  }
  return pathname.replace(/^\/api\//, '') || 'unknown';
}

let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    initialized = true;
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
  initialized = true;
}

export function withSentry(handler) {
  return async function wrappedHandler(req, ctx) {
    ensureInit();
    if (!process.env.SENTRY_DSN) return handler(req, ctx);
    try {
      return await handler(req, ctx);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: routeTag(req && req.url) },
      });
      await Sentry.flush(2000);
      throw err;
    }
  };
}

export async function captureServerError(err, extra = {}) {
  ensureInit();
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err, { extra });
  await Sentry.flush(2000);
}
