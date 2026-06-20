// Tests for api/burma-script-doc.js — the CLOUD SYNC endpoint for Johnny's one
// canonical Burma Script doc (WP-01). This is the data-integrity boundary for his
// actual writing: its whole job is that an empty / older / equal client is
// STRUCTURALLY incapable of overwriting newer cloud work. A silent regression in
// the version comparison (e.g. `<=` drifting to `<`, or dropping the toVersion
// coercion) would let a stale client clobber his script with no signal.
//
// Imports the REAL shipped pure functions (validatePutBody, isWriteAcceptable,
// toVersion) — no mirror, can't drift. Carries an inline RED proof reconstructing
// the OLD inline `version <= stored` decision and is mutation-proven: revert the
// contract in source and these go RED.
//
// Live, non-destructive outside signal confirmed this iteration against the real
// endpoint (version 601): a stale PUT (version 1) → 409 STALE (his doc untouched),
// malformed JSON → 400 BAD_JSON, a literal `null` body → 400 BAD_DOC (no 500).

import assert from 'node:assert';

const { validatePutBody, isWriteAcceptable, toVersion, isWriteAuthorized } = await import('./burma-script-doc.js');

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── RED PROOF: the data-integrity contract is real ──────────────────────────
// The endpoint's reason to exist: incoming must be STRICTLY newer to be accepted.
// Reconstruct the bug a `>` → `>=` (or `<=` → `<`) drift would introduce: an
// EQUAL-version write would be accepted, letting a client that never saw newer
// cloud work overwrite it. Prove the shipped contract refuses the equal case.
ok('RED: an equal-version write would clobber under a >= contract; shipped refuses it', () => {
  const buggyAcceptable = (inc, stored) => toVersion(inc) >= toVersion(stored); // the regression
  assert.equal(buggyAcceptable(601, 601), true, 'a >= contract would ACCEPT an equal version (the clobber)');
  assert.equal(isWriteAcceptable(601, 601), false, 'shipped contract must REFUSE an equal version');
});

// ── isWriteAcceptable: the core contract ────────────────────────────────────
ok('strictly-newer is accepted', () => {
  assert.equal(isWriteAcceptable(602, 601), true);
  assert.equal(isWriteAcceptable(2, 1), true);
});
ok('equal version is refused (the data-integrity guarantee)', () => {
  assert.equal(isWriteAcceptable(601, 601), false);
  assert.equal(isWriteAcceptable(1, 1), false);
});
ok('older version is refused', () => {
  assert.equal(isWriteAcceptable(1, 601), false);
  assert.equal(isWriteAcceptable(600, 601), false);
});
ok('first write (stored 0) accepts any positive version', () => {
  assert.equal(isWriteAcceptable(1, 0), true);
  assert.equal(isWriteAcceptable(601, 0), true);
});
ok('a version-0 / invalid incoming can never be a write (even against stored 0)', () => {
  assert.equal(isWriteAcceptable(0, 0), false);
  assert.equal(isWriteAcceptable(NaN, 0), false);
  assert.equal(isWriteAcceptable(undefined, 0), false);
});
ok('stringy versions are coerced before comparison (PostgREST/client can send strings)', () => {
  assert.equal(isWriteAcceptable('602', '601'), true);
  assert.equal(isWriteAcceptable('601', '601'), false);
  assert.equal(isWriteAcceptable('601', 601), false);
});
ok('float versions floor before comparison — no accept on a sub-integer bump', () => {
  assert.equal(isWriteAcceptable(601.9, 601), false, '601.9 floors to 601, not newer than 601');
  assert.equal(isWriteAcceptable(602.1, 601), true);
});

// ── validatePutBody: input shape (runs BEFORE any DB read) ───────────────────
ok('valid body returns coerced { ok, doc, version }', () => {
  const doc = { type: 'doc', content: [] };
  const r = validatePutBody({ doc, version: 5 });
  assert.deepEqual(r, { ok: true, doc, version: 5 });
});
ok('valid body coerces a stringy version', () => {
  const r = validatePutBody({ doc: { type: 'doc' }, version: '42' });
  assert.equal(r.ok, true);
  assert.equal(r.version, 42);
});
ok('missing/null/primitive doc -> BAD_DOC (matches live)', () => {
  for (const body of [{ version: 5 }, { doc: null, version: 5 }, { doc: 'x', version: 5 }, { doc: 7, version: 5 }]) {
    const r = validatePutBody(body);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BAD_DOC');
  }
});
ok('null / non-object body itself -> BAD_DOC, never a throw (the optional-chaining guard)', () => {
  for (const body of [null, undefined, 42, 'hi', true]) {
    const r = validatePutBody(body);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BAD_DOC', `body ${JSON.stringify(body)} must be a clean BAD_DOC`);
  }
});
ok('an array doc passes the object check (ProseMirror sends an object; arrays are objects)', () => {
  // Documents the current behavior: typeof [] === 'object', so an array doc is shape-valid here.
  const r = validatePutBody({ doc: [], version: 3 });
  assert.equal(r.ok, true);
});
ok('missing / zero / negative / NaN version -> BAD_VERSION', () => {
  for (const v of [undefined, 0, -1, -5, NaN, 'abc', null]) {
    const r = validatePutBody({ doc: { type: 'doc' }, version: v });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BAD_VERSION', `version ${JSON.stringify(v)} must be BAD_VERSION`);
  }
});
ok('doc check precedes version check (a bad doc reports BAD_DOC even with a bad version)', () => {
  const r = validatePutBody({ doc: null, version: 0 });
  assert.equal(r.code, 'BAD_DOC');
});

// ── toVersion: the coercion underpinning both ───────────────────────────────
ok('toVersion floors positives, clamps everything else to 0', () => {
  assert.equal(toVersion(601), 601);
  assert.equal(toVersion('601'), 601);
  assert.equal(toVersion(601.9), 601);
  assert.equal(toVersion(0), 0);
  assert.equal(toVersion(-3), 0);
  assert.equal(toVersion(NaN), 0);
  assert.equal(toVersion(undefined), 0);
  assert.equal(toVersion('abc'), 0);
  assert.equal(toVersion(Infinity), 0);
});

// ── end-to-end decision: validate then decide, the way putDoc does ──────────
ok('integration: a stale client (v1) against stored 601 validates OK but is NOT acceptable', () => {
  const v = validatePutBody({ doc: { type: 'doc' }, version: 1 });
  assert.equal(v.ok, true);
  assert.equal(isWriteAcceptable(v.version, 601), false, 'stale write must be refused -> 409');
});
ok('integration: a fresh client (v602) against stored 601 validates OK and IS acceptable', () => {
  const v = validatePutBody({ doc: { type: 'doc' }, version: 602 });
  assert.equal(v.ok, true);
  assert.equal(isWriteAcceptable(v.version, 601), true, 'newer write accepted');
});

// ── isWriteAuthorized: the SHARE-SAFETY write gate (server side) ─────────────
// The reason a `?read` recipient can no longer clobber Johnny's cloud doc even with DevTools: the PUT
// now demands a write secret the read link does NOT carry. This pure decision is the gate's core.
ok('gate DISABLED (no server token) — any PUT authorized (graceful degradation / local dev)', () => {
  assert.equal(isWriteAuthorized('', 'anything'), true);
  assert.equal(isWriteAuthorized('', null), true);
  assert.equal(isWriteAuthorized('', undefined), true);
  assert.equal(isWriteAuthorized(undefined, undefined), true);
});
ok('gate ENABLED — exact token match authorizes', () => {
  assert.equal(isWriteAuthorized('s3cret', 's3cret'), true);
});
ok('gate ENABLED — missing / empty / wrong token is REFUSED (the share-safety guarantee)', () => {
  assert.equal(isWriteAuthorized('s3cret', null), false, 'a reader sends no token');
  assert.equal(isWriteAuthorized('s3cret', undefined), false);
  assert.equal(isWriteAuthorized('s3cret', ''), false);
  assert.equal(isWriteAuthorized('s3cret', 'wrong'), false);
  assert.equal(isWriteAuthorized('s3cret', 's3cre'), false, 'no prefix/partial match');
  assert.equal(isWriteAuthorized('s3cret', 's3cret '), false, 'no trailing-space slop');
});
ok('RED: a recipient hand-crafting a PUT with a huge version is still REFUSED when the gate is on', () => {
  // The DevTools attack: fetch PUT { doc, version: 999999 } with NO token. Version concurrency alone
  // (isWriteAcceptable) would ACCEPT it — that was the old gap. The gate refuses it first.
  const stolenVersion = 999999;
  assert.equal(isWriteAcceptable(stolenVersion, 601), true, 'version-only check would let the clobber through');
  assert.equal(isWriteAuthorized('s3cret', null), false, 'but the write gate refuses the tokenless PUT');
});

console.log(`\nburma-script-doc: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
