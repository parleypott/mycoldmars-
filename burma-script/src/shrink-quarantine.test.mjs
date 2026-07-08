/*
 * shrink-quarantine.test.mjs — the BACK-DOOR data-loss block (2026-07-08 audit). A save that
 * catastrophically collapses a large stored doc must be refused on BOTH server persistence paths,
 * so a bad sync can never overwrite the canonical script. Locks the exact incident dimensions.
 */
import assert from 'node:assert/strict';
import { shrinkVerdict } from '../../api/script-doc.js';

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// A doc whose JSON serializes to ~N bytes.
const docOfBytes = (n) => ({ type: 'doc', content: [{ type: 'paragraph', text: 'x'.repeat(Math.max(0, n - 40)) }] });
const bigDoc = docOfBytes(271000);   // ~Johnny's real Burma script
const nineNodes = { type: 'doc', content: [{ type: 'paragraph' }] }; // the ~381-byte clobber

ok('THE INCIDENT: a 271KB doc collapsing to a handful of nodes is REFUSED', () => {
  const v = shrinkVerdict(nineNodes, bigDoc);
  assert.equal(v.ok, false);
  assert.ok(v.ratio < 0.01, 'ratio reflects a near-total wipe');
});
ok('a doc overwriting itself (no shrink) is allowed', () => {
  assert.equal(shrinkVerdict(bigDoc, bigDoc).ok, true);
});
ok('a doc GROWING is always allowed', () => {
  assert.equal(shrinkVerdict(docOfBytes(300000), bigDoc).ok, true);
});
ok('writing into an empty/absent stored doc is allowed (first save)', () => {
  assert.equal(shrinkVerdict(bigDoc, null).ok, true);
  assert.equal(shrinkVerdict(nineNodes, null).ok, true);
});
ok('a SMALL stored doc (< floor) is never guarded — legit tiny/new scripts edit freely', () => {
  assert.equal(shrinkVerdict(docOfBytes(10), docOfBytes(3000)).ok, true);
});
ok('a MODERATE edit to a big doc (keeps > 20%) is allowed — no false-positive on real editing', () => {
  assert.equal(shrinkVerdict(docOfBytes(150000), bigDoc).ok, true); // deleted ~45%, still fine
  assert.equal(shrinkVerdict(docOfBytes(60000), bigDoc).ok, true);  // deleted ~78%, still fine (just above floor+ratio)
});
ok('a near-total collapse just under the ratio IS refused', () => {
  assert.equal(shrinkVerdict(docOfBytes(40000), docOfBytes(250000)).ok, false); // 16% remains → refused
});
ok('thresholds are tunable', () => {
  assert.equal(shrinkVerdict(docOfBytes(30000), docOfBytes(100000), { floorBytes: 40000 }).ok, true); // stored under custom floor
  assert.equal(shrinkVerdict(docOfBytes(45000), docOfBytes(100000), { minRatio: 0.6 }).ok, false);    // stricter ratio
});

console.log(`\nshrink-quarantine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
