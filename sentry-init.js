// Browser-side Sentry init. Imported as a module from each page that wants
// crash reporting. No-op if VITE_SENTRY_DSN is unset — safe to leave wired
// in even when you don't have a DSN locally.
//
// Add to any page's index.html with:
//   <script type="module" src="/sentry-init.js"></script>
// (path is rewritten by Vite at build time; works in dev too via the proxy.)

import * as Sentry from '@sentry/browser';

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      const msg = event.exception?.values?.[0]?.value || '';
      if (msg.includes('ResizeObserver loop')) return null;
      if (msg.includes('Non-Error promise rejection')) return null;
      return event;
    },
  });
} else if (import.meta.env.DEV) {
  console.info('[sentry] no VITE_SENTRY_DSN set — error reporting disabled');
}
