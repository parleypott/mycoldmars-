/**
 * Pure-logic tests for the generalized script cloud endpoint — api/script-doc.js.
 * The data-integrity contract (compare-and-swap + strictly-greater), body validation, and the
 * project-ref shape are pure functions, tested here with plain values (no DB, no network).
 *
 * Run: bun api/script-doc.test.mjs
 */
const { toVersion, validatePutBody, isWriteAcceptable, UUID_RE } = await import('./script-doc.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);
const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });

/* ---- toVersion coercion ---- */
eq(toVersion('7'), 7, 'v1. numeric string coerces');
eq(toVersion(0), 0, 'v2. zero stays zero');
eq(toVersion(-3), 0, 'v3. negative clamps to 0');
eq(toVersion('x'), 0, 'v4. NaN -> 0');
eq(toVersion(4.9), 4, 'v5. floors');

/* ---- validatePutBody ---- */
ok(!validatePutBody({}).ok, 'b1. empty body rejected');
ok(!validatePutBody({ doc: DOC('x') }).ok, 'b2. missing version rejected');
ok(!validatePutBody({ doc: null, version: 5 }).ok, 'b3. null doc rejected');
ok(!validatePutBody({ doc: 'str', version: 5 }).ok, 'b4. non-object doc rejected');
{
  const v = validatePutBody({ doc: DOC('x'), version: 5 });
  ok(v.ok && v.baseVersion === null, 'b5. no baseVersion -> null (optimistic mode)');
}
{
  const v = validatePutBody({ doc: DOC('x'), version: 6, baseVersion: 5 });
  ok(v.ok && v.baseVersion === 5, 'b6. baseVersion carried through for CAS');
}

/* ---- isWriteAcceptable: optimistic (no baseVersion) ---- */
ok(isWriteAcceptable({ version: 6, stored: 5 }), 'o1. strictly-greater accepted');
ok(!isWriteAcceptable({ version: 5, stored: 5 }), 'o2. equal rejected (only strictly newer)');
ok(!isWriteAcceptable({ version: 4, stored: 5 }), 'o3. older rejected — cannot stomp newer cloud');
ok(isWriteAcceptable({ version: 1, stored: 0 }), 'o4. first write onto empty accepted');

/* ---- isWriteAcceptable: compare-and-swap (baseVersion present) ---- */
ok(isWriteAcceptable({ version: 6, baseVersion: 5, stored: 5 }), 'c1. built-on-current + advances -> accept');
ok(!isWriteAcceptable({ version: 6, baseVersion: 4, stored: 5 }),
  'c2. built on a STALE base (someone else moved cloud to 5) -> reject even though 6 > 5');
ok(!isWriteAcceptable({ version: 5, baseVersion: 5, stored: 5 }), 'c3. base==stored but no advance -> reject');
ok(isWriteAcceptable({ version: 2, baseVersion: 1, stored: 1 }), 'c4. clean linear CAS accepted');
ok(!isWriteAcceptable({ version: 9, baseVersion: 0, stored: 3 }),
  'c5. base 0 against a populated row -> reject (the two-device stranding case the audit named)');

/* ---- UUID shape ---- */
ok(UUID_RE.test('a4b1c2d3-1111-2222-3333-444455556666'), 'u1. uuid matches');
ok(!UUID_RE.test('burma'), 'u2. slug is not a uuid (resolves via slug lookup)');

console.log(`\nscript-doc: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
