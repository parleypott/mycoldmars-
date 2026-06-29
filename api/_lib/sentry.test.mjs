// First coverage for sentry.js's routeTag — the pure route-tag derivation that
// runs INSIDE withSentry's catch block on api/claude.js (Johnny's live LLM
// proxy). The old inline form `new URL(req.url).pathname.replace(...)` would
// THROW on a missing/relative/malformed req.url — and a throw there masks the
// handler's real error (the thing Sentry exists to report) and changes what's
// rethrown. routeTag must NEVER throw and must still produce the clean route for
// the normal absolute-URL case.
//
// Mutation proof: revert routeTag to a bare `new URL(s).pathname.replace(...)`
// (no try/catch, no guards) and the relative/empty/null/garbage cases go RED.
import { routeTag } from './sentry.js';
import assert from 'node:assert/strict';

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

// ── The normal Vercel-Edge case: absolute URL → bare route, /api/ stripped ──
t('absolute api URL → route without the /api/ prefix', () => {
  assert.equal(routeTag('https://mycoldmars.com/api/claude'), 'claude');
  assert.equal(routeTag('https://mycoldmars.vercel.app/api/qss-tts'), 'qss-tts');
});

t('absolute URL with query/hash → path only, no query leaked into the tag', () => {
  assert.equal(routeTag('https://x.com/api/claude?stream=1'), 'claude');
  assert.equal(routeTag('https://x.com/api/claude#frag'), 'claude');
});

t('non-/api/ absolute path is returned as-is (still a usable tag)', () => {
  assert.equal(routeTag('https://x.com/healthz'), '/healthz');
});

// ── The whole point: the catch path must never throw ──
t('relative URL (no origin) does not throw → cleaned path', () => {
  // `new URL('/api/claude')` throws TypeError; routeTag must degrade, not crash.
  assert.doesNotThrow(() => routeTag('/api/claude'));
  assert.equal(routeTag('/api/claude'), 'claude');
  assert.equal(routeTag('/api/claude?x=1'), 'claude');
});

t('undefined / null / non-string req.url → "unknown", never a throw', () => {
  assert.doesNotThrow(() => routeTag(undefined));
  assert.doesNotThrow(() => routeTag(null));
  assert.doesNotThrow(() => routeTag(42));
  assert.doesNotThrow(() => routeTag({}));
  assert.equal(routeTag(undefined), 'unknown');
  assert.equal(routeTag(null), 'unknown');
  assert.equal(routeTag(''), 'unknown');
});

t('garbage / malformed string → does not throw, yields a string tag', () => {
  assert.doesNotThrow(() => routeTag('http://['));
  assert.doesNotThrow(() => routeTag('not a url at all'));
  assert.equal(typeof routeTag('http://['), 'string');
  // A bare token with no path separators isn't an absolute URL; it survives as
  // itself rather than crashing the error handler.
  assert.equal(routeTag('not-a-url'), 'not-a-url');
});

console.log(`\nsentry routeTag: ${pass} passed, 0 failed`);
