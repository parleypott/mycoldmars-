// Mutation-lock for the null-body 500 crash class across three handlers the
// repo-wide gate (scripts/find-naive-body-read.mjs) flagged as MISSED by prior
// null-body sweeps:
//   api/generate-plan.js        (Walden masterplan renderer — handleGenPlan)
//   api/qss-block-summaries.js  (QSS story-spine block summaries)
//   api/walden-design.js        (Walden design collaborator — mode dispatch)
//
// Each read its POST body inside a try/catch that ONLY caught req.json()
// REJECTING (malformed JSON). A structurally-valid JSON literal `null` (or a
// number / string / array) PARSES successfully, slips past the catch, and the
// next RAW body access crashed into an unhandled HTTP 500:
//   generate-plan       → handleGenPlan(body) → `body.photo` on null
//   qss-block-summaries → `selectSummarizableBlocks(body.blocks)` on null
//   walden-design       → `body.mode` dispatch on null
//
// Fix: route the parsed body through coerceObjectBody (api/_lib/read-json-body.js)
// so a non-object body becomes {} and each handler's own field validation returns
// its intended 4xx instead of a server error.
//
// This test drives the REAL default exports end-to-end with mock Requests. Every
// bad-body case must (a) NOT throw and (b) NOT return 500. With the coerce REMOVED
// the raw access throws a TypeError → the handler promise rejects (single-arg web
// path) → these assertions go RED. No test reaches an external service: every
// non-object body returns at the body/field guard BEFORE any Gemini/Anthropic call.

import assert from 'node:assert';

// Reach the body read in each handler: keys present (the key gates sit before the
// parse), dev/open access mode (no ACCESS_CODE → checkAccess passes).
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
delete process.env.ACCESS_CODE;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const generatePlan = (await import('./generate-plan.js')).default;
const blockSummaries = (await import('./qss-block-summaries.js')).default;
const waldenDesign = (await import('./walden-design.js')).default;

function post(bodyStr) {
  return new Request('https://x.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
}

// The non-object bodies that all parse successfully but used to crash the raw read.
const NON_OBJECT_BODIES = [
  ['json null', 'null'],
  ['json array', '[]'],
  ['json number', '42'],
  ['json string', '"hello"'],
  ['json bool', 'true'],
];

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); pass++; }
  catch (e) { fail++; console.log(`  ✗ ${label}: ${e && e.message}`); }
}

const HANDLERS = [
  ['generate-plan', generatePlan],
  ['qss-block-summaries', blockSummaries],
  ['walden-design', waldenDesign],
];

for (const [name, handler] of HANDLERS) {
  for (const [blabel, bstr] of NON_OBJECT_BODIES) {
    await check(`${name} — ${blabel} → no crash, not 500`, async () => {
      // The single-arg web path returns a Response; a TypeError from an unguarded
      // raw body access would REJECT this promise (caught below as a failure).
      const res = await handler(post(bstr));
      assert.ok(res instanceof Response, `expected a Response, got ${typeof res}`);
      assert.notStrictEqual(res.status, 500, `non-object body must not 500 (got ${res.status})`);
      assert.ok(res.status >= 200 && res.status < 500, `expected 2xx/4xx, got ${res.status}`);
    });
  }
  // Malformed JSON still maps to a clean 400 (the catch arm), never a 500.
  await check(`${name} — malformed json → 400`, async () => {
    const res = await handler(post('{ this is not json'));
    assert.ok(res instanceof Response);
    assert.strictEqual(res.status, 400, `malformed json expected 400, got ${res.status}`);
  });
}

console.log(`\nnull-body-coerce-handlers: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
