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
        tags: { route: new URL(req.url).pathname.replace(/^\/api\//, '') },
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
