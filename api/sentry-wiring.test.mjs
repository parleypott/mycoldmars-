// Sentry wiring coverage for the script-tool endpoints. Two layers:
//
//   1. BEHAVIORAL — with SENTRY_DSN unset, a wrapped handler is a perfect pass-through
//      (same response, throws still propagate). This is the no-op contract every endpoint
//      now leans on: wiring monitoring in must never change behavior when it's off.
//   2. STRUCTURAL — every script-tool endpoint actually ships wrapped. The failure mode
//      here is silent: an unwrapped endpoint works perfectly and just never reports, so
//      only a source-level assertion catches the regression.
//
// Run: bun api/sentry-wiring.test.mjs

import { readFile } from 'node:fs/promises';
import { withSentry } from './_lib/sentry.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };

/* ---- 1. behavioral: DSN unset -> withSentry is invisible ---- */
{
  const prev = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;

  const res = new Response('ok');
  const wrapped = withSentry(async () => res);
  ok(await wrapped(new Request('https://x.com/api/script-doc')) === res, 'b1. response passes through untouched');

  const boom = new Error('kaput');
  const throwing = withSentry(async () => { throw boom; });
  let caught = null;
  try { await throwing(new Request('https://x.com/api/script-doc')); } catch (e) { caught = e; }
  ok(caught === boom, 'b2. the ORIGINAL error still propagates (no swallowing, no re-wrapping)');

  if (prev === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = prev;
}

/* ---- 2. structural: the five script-tool endpoints are wired ---- */
// Endpoints whose handler wraps its whole body in a swallow-into-error-response catch-all
// must ALSO report explicitly (captureServerError) — their throws never reach withSentry's
// catch, so the wrap alone would be decorative. script-image-sign is exempt: its only catch
// is a narrow upstream-fetch failure (the Supabase sign call), the moral twin of claude.js's
// unreported 'anthropic_unreachable'; withSentry covers the rest of its body, which has no
// catch-all.
const ENDPOINTS = [
  ['script-doc.js', { reports: true }],
  ['script-projects.js', { reports: true }],
  ['script-image-sign.js', { reports: false }],
  ['liveblocks-auth.js', { reports: true }],
];
for (const [f, { reports }] of ENDPOINTS) {
  const src = await readFile(new URL('./' + f, import.meta.url), 'utf8');
  ok(/import \{ withSentry(, captureServerError)? \} from '\.\/_lib\/sentry\.js';/.test(src),
    `w1. ${f} imports the shared sentry helper`);
  ok(/export default withSentry\(async function handler/.test(src),
    `w2. ${f} default export is withSentry-wrapped`);
  if (reports) {
    ok(src.includes('await captureServerError(e,'),
      `w3. ${f} reports the throws its catch-all swallows (captureServerError)`);
  }
}

/* ---- 2b. the NODEJS-runtime webhook is DELIBERATELY unwrapped (not a runtime constraint) ----
   liveblocks-webhook is the repo's one runtime:'nodejs' function. It stays UNWRAPPED for now,
   but NOT because @sentry crashes node: the earlier "crashes the nodejs runtime at cold start"
   note was a MISDIAGNOSIS (iteration #17) — the real 2026-07-08 FUNCTION_INVOCATION_FAILED cause
   was a web-shaped req.text() on a nodejs handler, since fixed by a Node->web bridge adapter.
   The @sentry/vercel-edge SDK loads fine on node (it's fetch-transport only, and this webhook's
   own module graph already imports it transitively via script-doc.js/liveblocks-auth.js while
   staying live-healthy). So wrapping is SAFE; it's deferred only until an attended signed-delivery
   test can confirm end-to-end reporting. This guard locks the current unwrapped state so any
   future wrap is a deliberate, visible decision (a red test) rather than a silent drift. */
{
  const src = await readFile(new URL('./liveblocks-webhook.js', import.meta.url), 'utf8');
  ok(/runtime:\s*'nodejs'/.test(src),
    'w4. liveblocks-webhook still declares the nodejs runtime');
  ok(!src.includes("from './_lib/sentry.js'"),
    'w5. liveblocks-webhook does NOT import the sentry helper directly (deliberately unwrapped)');
  ok(/export default async function handler/.test(src),
    'w6. liveblocks-webhook default export is a bare handler (unwrapped)');
}

console.log(`\nsentry-wiring: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
