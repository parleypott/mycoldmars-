// The @sentry/browser half of client monitoring. ONLY ever loaded via dynamic import from
// sentry-boot.js (after first paint, and only when VITE_SENTRY_DSN is set) — never import
// this statically from entry/engine code, or the SDK lands back on the hot path that
// sentry-boot.js exists to protect.

import * as Sentry from '@sentry/browser';
import { buildSentryInit } from './sentry-boot.js';

let initialized = false;

/**
 * Initialize @sentry/browser once and tag every event with the episode/route this page
 * booted into ('burma', a library project slug, or 'library'), so an error in one
 * script's session is attributable at a glance.
 */
export function initSentry(dsn, { episode, production } = {}) {
  if (initialized) return Sentry;
  initialized = true;
  Sentry.init(buildSentryInit(dsn, { production }));
  if (episode) Sentry.setTag('episode', String(episode));
  return Sentry;
}
