// Headless coverage for the client Sentry boot (sentry-boot.js) — the module whose whole
// job is TWO promises: (1) monitoring is a clean no-op when VITE_SENTRY_DSN is unset, and
// (2) the SDK never rides the entry hot path (it loads lazily, after first paint).
//
// Run: bun burma-script/src/sentry-boot.test.mjs
//
// Mutation proof: make sentryDsn return '' instead of null for blank input and d3/d4 go RED;
// change tracesSampleRate to 1.0 and i2 goes RED; make scheduleAfterFirstPaint call fn
// synchronously and s3 goes RED; make armSentry ignore a missing DSN and a1 goes RED.

import { sentryDsn, buildSentryInit, scheduleAfterFirstPaint, armSentry } from './sentry-boot.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

/* ---- sentryDsn: only a real non-empty string turns monitoring on ---- */
eq(sentryDsn('https://abc@o1.ingest.sentry.io/42'), 'https://abc@o1.ingest.sentry.io/42', 'd1. real DSN passes through');
eq(sentryDsn('  https://abc@o1.ingest.sentry.io/42  '), 'https://abc@o1.ingest.sentry.io/42', 'd2. whitespace trimmed');
eq(sentryDsn(''), null, 'd3. empty string -> null (off)');
eq(sentryDsn('   '), null, 'd4. blank string -> null (off)');
eq(sentryDsn(undefined), null, 'd5. undefined -> null (off)');
eq(sentryDsn(null), null, 'd6. null -> null (off)');
eq(sentryDsn(42), null, 'd7. non-string -> null (off), never a throw');

/* ---- buildSentryInit: the modest-sampling / no-PII contract ---- */
{
  const cfg = buildSentryInit('dsn-x', { production: true });
  eq(cfg.dsn, 'dsn-x', 'i1. dsn carried');
  eq(cfg.tracesSampleRate, 0.1, 'i2. tracesSampleRate is MODEST (0.1) — never full tracing');
  eq(cfg.sendDefaultPii, false, 'i3. no default PII');
  eq(cfg.environment, 'production', 'i4. production env flag');
}
eq(buildSentryInit('d').environment, 'development', 'i5. non-production default env');

/* ---- scheduleAfterFirstPaint: deferred, rAF-aware, never throws headless ---- */
await (async () => {
  // s1. no rAF (headless) -> falls back to a timeout, still runs.
  let ran = false;
  scheduleAfterFirstPaint(() => { ran = true; }, {});
  ok(!ran, 's1a. not synchronous (headless path)');
  await new Promise((r) => setTimeout(r, 10));
  ok(ran, 's1b. ran via timeout fallback');

  // s2. with a rAF: fn runs AFTER the frame callback then a macrotask.
  let order = [];
  const fakeG = { requestAnimationFrame: (cb) => { order.push('raf'); setTimeout(cb, 0); } };
  scheduleAfterFirstPaint(() => order.push('fn'), fakeG);
  ok(order.join(',') === 'raf', 's2a. rAF requested immediately, fn not yet run');
  await new Promise((r) => setTimeout(r, 20));
  eq(order.join(','), 'raf,fn', 's2b. fn ran after the frame');

  // s3. never synchronous even with an immediately-invoking rAF (paint ordering law).
  let sync = false;
  scheduleAfterFirstPaint(() => { sync = true; }, { requestAnimationFrame: (cb) => cb() });
  ok(!sync, 's3. still deferred behind a macrotask when rAF fires synchronously');

  // s4. garbage globals never throw.
  let threw = false;
  try {
    scheduleAfterFirstPaint(() => {}, null);
    scheduleAfterFirstPaint(() => {}, { requestAnimationFrame: 'not a fn' });
  } catch { threw = true; }
  ok(!threw, 's4. weird globals -> no throw');
})();

/* ---- armSentry: the OFF path is the load-bearing one ---- */
// Under bun, import.meta.env aliases process.env — so we can drive the env directly.
{
  const prev = process.env.VITE_SENTRY_DSN;
  delete process.env.VITE_SENTRY_DSN;
  eq(armSentry({ episode: 'burma' }), false, 'a1. no DSN -> false, clean no-op');
  process.env.VITE_SENTRY_DSN = '   ';
  eq(armSentry({ episode: 'burma' }), false, 'a2. blank DSN -> still off');
  process.env.VITE_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/42';
  eq(armSentry({ episode: 'library' }), true, 'a3. DSN present -> armed (lazy import scheduled)');
  // restore
  if (prev === undefined) delete process.env.VITE_SENTRY_DSN;
  else process.env.VITE_SENTRY_DSN = prev;
}

/* ---- the hot-path law, enforced structurally ---- */
// sentry-boot.js must NEVER static-import @sentry/browser; only sentry-client.js (the lazy
// chunk) may. Read the source and assert — a regression here silently regrows the entry bundle.
{
  const src = await (await import('node:fs/promises')).readFile(
    new URL('./sentry-boot.js', import.meta.url), 'utf8');
  ok(!/^\s*import[^;]*@sentry\/browser/m.test(src), 'h1. sentry-boot.js has NO static @sentry/browser import');
  ok(/import\(['"]\.\/sentry-client\.js['"]\)/.test(src), 'h2. SDK loads only via dynamic import of sentry-client.js');
}

console.log(`\nsentry-boot: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
