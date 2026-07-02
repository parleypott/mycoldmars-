// Tests for api/script-projects.js — the SHARED PROJECT LIST endpoint (Wave 2 multi-user fix).
//
// The pure boundary here is INPUT VALIDATION: what slugs/titles/config a project row may carry, and
// which fields a PATCH may touch. A regression that let a reserved slug ('library') or a non-object
// config through would corrupt routing or the jsonb column; a PATCH that stopped whitelisting could let
// a caller stomp created_by / id. These lock the shape.
//
// Run: bun api/script-projects.test.mjs
import assert from 'node:assert';

const { validateCreateBody, buildPatch, SLUG_RE, RESERVED_SLUGS, projectView } = await import('./script-projects.js');

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// ── slug shape ───────────────────────────────────────────────────────────────
ok('SLUG_RE accepts clean slugs', () => {
  for (const s of ['burma', 'palau', 'my-script', 'a', 'day-2-final', 'x123']) {
    assert.ok(SLUG_RE.test(s), `should accept ${s}`);
  }
});
ok('SLUG_RE rejects malformed slugs', () => {
  for (const s of ['', 'Burma', 'my script', 'trailing-', '-leading', 'double--hyphen', 'has_underscore', 'café']) {
    assert.ok(!SLUG_RE.test(s), `should reject ${JSON.stringify(s)}`);
  }
});

// ── validateCreateBody ─────────────────────────────────────────────────────────
ok('valid create body passes and normalizes', () => {
  const v = validateCreateBody({ slug: 'my-script', title: '  My Script  ' });
  assert.equal(v.ok, true);
  assert.equal(v.slug, 'my-script');
  assert.equal(v.title, 'My Script');   // trimmed
  assert.equal(v.episode, null);         // omitted → null
  assert.deepEqual(v.config, {});        // omitted → {}
});
ok('episode + config carried through', () => {
  const v = validateCreateBody({ slug: 'burma', title: 'Burma', episode: 'burma', config: { genres: [] } });
  assert.equal(v.ok, true);
  assert.equal(v.episode, 'burma');
  assert.deepEqual(v.config, { genres: [] });
});
ok('missing slug refused', () => {
  assert.equal(validateCreateBody({ title: 'x' }).code, 'BAD_SLUG');
  assert.equal(validateCreateBody({ slug: '   ', title: 'x' }).code, 'BAD_SLUG');
});
ok('malformed slug refused', () => {
  assert.equal(validateCreateBody({ slug: 'My Script', title: 'x' }).code, 'BAD_SLUG');
  assert.equal(validateCreateBody({ slug: 'a'.repeat(61), title: 'x' }).code, 'BAD_SLUG');
});
ok('reserved slug refused', () => {
  for (const s of RESERVED_SLUGS) {
    assert.equal(validateCreateBody({ slug: s, title: 'x' }).code, 'RESERVED_SLUG', `${s} must be reserved`);
  }
});
ok('missing / empty title refused', () => {
  assert.equal(validateCreateBody({ slug: 'x' }).code, 'BAD_TITLE');
  assert.equal(validateCreateBody({ slug: 'x', title: '   ' }).code, 'BAD_TITLE');
});
ok('non-object config refused', () => {
  assert.equal(validateCreateBody({ slug: 'x', title: 'X', config: [1, 2] }).code, 'BAD_CONFIG');
  assert.equal(validateCreateBody({ slug: 'x', title: 'X', config: 'nope' }).code, 'BAD_CONFIG');
});
ok('non-object body refused', () => {
  assert.equal(validateCreateBody(null).code, 'BAD_BODY');
  assert.equal(validateCreateBody('str').code, 'BAD_BODY');
});

// ── buildPatch — the write whitelist ────────────────────────────────────────────
ok('rename patch keeps only title', () => {
  const p = buildPatch({ title: '  New Name  ', id: 'should-be-ignored', created_by: 'evil' });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, { title: 'New Name' });
});
ok('trash patch (ISO string) accepted', () => {
  const iso = new Date().toISOString();
  const p = buildPatch({ trashed_at: iso });
  assert.equal(p.ok, true);
  assert.equal(p.fields.trashed_at, iso);
});
ok('restore patch (null) accepted', () => {
  const p = buildPatch({ trashed_at: null });
  assert.equal(p.ok, true);
  assert.equal(p.fields.trashed_at, null);
  assert.ok('trashed_at' in p.fields);
});
ok('config patch accepted', () => {
  const p = buildPatch({ config: { accent: '#000' } });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields.config, { accent: '#000' });
});
ok('empty title in patch refused', () => {
  assert.equal(buildPatch({ title: '   ' }).code, 'BAD_TITLE');
});
ok('bad trashed_at refused', () => {
  assert.equal(buildPatch({ trashed_at: 123 }).code, 'BAD_TRASHED');
  assert.equal(buildPatch({ trashed_at: '' }).code, 'BAD_TRASHED');
});
ok('empty patch refused', () => {
  assert.equal(buildPatch({}).code, 'NO_FIELDS');
  assert.equal(buildPatch({ id: 'x', created_by: 'y' }).code, 'NO_FIELDS'); // non-whitelisted only
});
ok('non-object patch body refused', () => {
  assert.equal(buildPatch(null).code, 'BAD_BODY');
});

// ── projectView — never leak created_by ─────────────────────────────────────────
ok('projectView drops created_by and preserves shape', () => {
  const v = projectView({
    id: 'uuid', slug: 's', title: 't', episode: null, config: { a: 1 },
    created_by: 'SECRET', created_at: 'c', updated_at: 'u', trashed_at: null,
  });
  assert.ok(!('created_by' in v), 'created_by must not be on the wire');
  assert.equal(v.id, 'uuid');
  assert.deepEqual(v.config, { a: 1 });
});

console.log(failed === 0
  ? `PASS — all ${passed} script-projects cases correct`
  : `\n${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
