// Client-side Sentry boot for the script engine — shared by BOTH entries
// (burma-script/src/boot.jsx standalone door + scripts-library/src/boot.jsx library door).
//
// Two laws shape this file:
//
//   1. ZERO COST WHEN OFF. VITE_SENTRY_DSN unset -> armSentry() returns false and nothing
//      else happens: no dynamic import, no network, no globals touched. The tool works
//      exactly as before monitoring existed.
//   2. ZERO WEIGHT ON THE HOT PATH. This module never imports @sentry/browser. The SDK
//      lives in ./sentry-client.js, loaded via dynamic import() AFTER first paint — Vite
//      code-splits it into its own async chunk, so the entry bundles don't grow a byte
//      of SDK. An editor keystroke never waits on a monitoring vendor.
//
// The pure pieces (sentryDsn / buildSentryInit / scheduleAfterFirstPaint) are exported
// separately so they're testable headless (sentry-boot.test.mjs) without a DOM or the SDK.

/** Normalize the DSN env value: a non-empty trimmed string, else null (= monitoring off). */
export function sentryDsn(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s ? s : null;
}

/**
 * The Sentry.init options — mirrors the server helper (api/_lib/sentry.js): modest
 * tracing (0.1), no PII. Pure so the contract is testable.
 */
export function buildSentryInit(dsn, { production } = {}) {
  return {
    dsn,
    environment: production ? 'production' : 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  };
}

/**
 * Run `fn` after the first paint: one animation frame (the paint happens right after the
 * frame callbacks), then a macrotask so we're clearly behind it. Headless (no rAF — tests,
 * odd webviews) falls back to a plain timeout. Never throws.
 */
export function scheduleAfterFirstPaint(fn, g = globalThis) {
  const raf = g && typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame : null;
  if (raf) {
    raf(() => { setTimeout(fn, 0); });
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * Arm error monitoring for this page. Call once from an entry, with the episode/route tag
 * for this boot ('burma', a project slug, or 'library'). Returns true if monitoring was
 * armed (DSN present), false if it's a clean no-op.
 */
export function armSentry({ episode } = {}) {
  let raw;
  try { raw = import.meta.env.VITE_SENTRY_DSN; } catch { raw = undefined; }
  const dsn = sentryDsn(raw);
  if (!dsn) return false;

  let production = true;
  try { production = !!import.meta.env.PROD; } catch { /* keep default */ }

  scheduleAfterFirstPaint(() => {
    import('./sentry-client.js')
      .then((m) => m.initSentry(dsn, { episode, production }))
      .catch(() => { /* monitoring must never break the tool it monitors */ });
  });
  return true;
}
