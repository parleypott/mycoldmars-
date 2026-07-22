/**
 * IMAGE UPLOAD — isPayloadTooLarge SELF-HEAL TRIGGER contract (2026-07-22, hunt lock).
 *
 * `runMediaUpload` self-heals a base64-road failure onto the signed road ONLY when
 * isPayloadTooLarge(out) says the failure was a body-too-large rejection (the platform's ~4.5MB
 * gate OR the edge fn's decoded-bytes 413 at api/script-image-upload.js:130 → j(413,
 * {error:'image_too_large'})). Johnny's image-drop-413-fallback.test.mjs proves the END-TO-END
 * heal, but every real rejection today carries res.status === 413, so his test only ever exercises
 * the `out.status === 413` branch. This locks the DESIGNED SAFETY NET — the string-matching
 * branches (`\b413\b`, `image_too_large|too.*large`) that Johnny added for the case a body limit
 * shifts or an intermediary masks the status while keeping the too-large message. Untested until now;
 * a refactor that dropped a trigger pattern would silently turn a self-heal back into "the picture
 * was NOT added" (his exact complaint) the instant that shape occurred.
 *
 * SOURCE-EXTRACTED verbatim (isPayloadTooLarge is module-private) so a drift in the real source
 * changes what this asserts. Mutation-proven: neuter any trigger → RED; restore → GREEN.
 *
 * Run: bun burma-script/src/extensions/image-drop-payload-too-large.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'image-drop.js'), 'utf8');

// Pull isPayloadTooLarge out verbatim (no nested braces in its body — the regex literals carry
// none — so match up to the first line-start `}`).
const m = SRC.match(/function isPayloadTooLarge\(out\) \{[\s\S]*?\n\}/);
assert.ok(m, 'isPayloadTooLarge must exist in image-drop.js (source-lock)');
const isPayloadTooLarge = (0, eval)(`(${m[0].replace('function isPayloadTooLarge', 'function')})`);

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// ── The status branch — the one Johnny's e2e already covers; pinned here too ──────────────────
ok('a 413 status heals (platform gate OR the edge fn 413)', () => {
  assert.equal(isPayloadTooLarge({ status: 413 }), true);
  assert.equal(isPayloadTooLarge({ status: 413, error: 'image_too_large' }), true);
});

// ── The STRING branches — the safety net, structurally unreachable by the e2e test ────────────
ok('a status-masked too-large STILL heals via the error string (the designed safety net)', () => {
  // res.status !== 413 (a proxy/edge quirk rewrote it) but the too-large signal survives.
  assert.equal(isPayloadTooLarge({ status: 200, error: 'image_too_large' }), true, 'image_too_large');
  assert.equal(isPayloadTooLarge({ status: 500, error: 'Payload Too Large' }), true, 'too large, case-insensitive');
  assert.equal(isPayloadTooLarge({ status: 502, error: 'upstream returned http 413' }), true, '\\b413\\b in the message');
});

// ── The negatives — a real (non-size) failure must NOT self-heal, or dedupe/retry churns ──────
ok('a genuine non-413 failure does NOT heal (bad_request, 400, network throw shape)', () => {
  assert.equal(isPayloadTooLarge({ status: 400, error: 'bad_request' }), false);
  assert.equal(isPayloadTooLarge({ status: 500, error: 'sign exploded' }), false);
  assert.equal(isPayloadTooLarge({ status: 401, error: 'unauthorized' }), false);
  assert.equal(isPayloadTooLarge(null), false, 'null out never heals');
  assert.equal(isPayloadTooLarge(undefined), false, 'undefined out never heals');
  assert.equal(isPayloadTooLarge({}), false, 'no status, no error → not a size failure');
  // "4130" is a number that CONTAINS 413 but isn't the code — \b guards against a substring false-fire.
  assert.equal(isPayloadTooLarge({ status: 200, error: 'code 41300 timeout' }), false, '\\b413\\b is word-bounded');
});

// ── Mutation oracle: the string branch is load-bearing, not decorative ────────────────────────
ok('a status-only predicate (no string branch) FAILS the masked-status case — string branch matters', () => {
  const statusOnly = (out) => !!out && out.status === 413;   // the branch WITHOUT the string fallback
  assert.equal(statusOnly({ status: 200, error: 'image_too_large' }), false,
    'a status-masked too-large would NOT heal without the string branch — proves it is load-bearing');
  assert.equal(isPayloadTooLarge({ status: 200, error: 'image_too_large' }), true,
    'the real predicate DOES heal it');
});

console.log(`image-drop-payload-too-large: ${pass} passed, 0 failed`);
