// SLUG DRIFT FIX — the PATCH-slug contract (api/script-projects PATCH).
//
// Before this fix, renaming a project PATCHed only the title; the cloud SLUG never moved. Guest ?slug=
// links resolve via the cloud slug and teammates refresh their slug from the cloud list, so the stale
// cloud slug broke shared links and split the owner's slug from everyone else's. The fix: PATCH accepts
// `slug` with the SAME shape/reserved guards as create, and a slug that collides with another row's
// (the DB unique index) comes back 409 SLUG_TAKEN — never a silently-dropped rename.
//
// Locked here against the pure validator (buildPatch) AND the real handler with a fake PostgREST:
//   1. buildPatch VALIDATION MATRIX: happy, format-reject, reserved-reject, length, non-string,
//      title+slug together, and "slug NOT in body → not touched" (title-only rename still works).
//   2. patchProject 409: a PostgREST 409 (or 23505 body) on the slug UPDATE → 409 SLUG_TAKEN to the
//      client, with the attempted slug in the message. A happy PATCH echoes the updated row.
//
// Run: bun api/script-projects-slug-patch.test.mjs

process.env.SUPABASE_URL = 'https://db.test.local';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
process.env.ACCESS_CODE = 'sesame-test';
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;

// ── recording fetch mock (fake PostgREST) ─────────────────────────────────────
const calls = [];
let patchStatus = 200;     // what a PATCH to script_projects answers with
let patchBody = null;      // the row(s) or error text the PATCH returns
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url).includes('/rest/v1/script_projects') && method === 'PATCH') {
    if (patchStatus === 409) return new Response('conflict', { status: 409 });
    if (patchStatus >= 400) return new Response(String(patchBody ?? 'boom'), { status: patchStatus });
    return json(patchBody ?? [], patchStatus);
  }
  return json({}, 404);
};

const mod = await import('./script-projects.js');
const handler = mod.default;
const { buildPatch } = mod;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PATCH = (id, body, headers = { 'x-access-code': 'sesame-test' }) =>
  handler(new Request(`https://x.test/api/script-projects?id=${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));

/* ── 1. buildPatch validation matrix (pure) ─────────────────────────────────── */
{
  // happy
  const h = buildPatch({ slug: 'nile-river' });
  ok(h.ok && h.fields.slug === 'nile-river', 'slug: well-shaped slug accepted');

  const both = buildPatch({ title: 'Nile River', slug: 'nile-river' });
  ok(both.ok && both.fields.title === 'Nile River' && both.fields.slug === 'nile-river',
    'slug: title + slug together both ride through');

  const trimmed = buildPatch({ slug: '  nile-river  ' });
  ok(trimmed.ok && trimmed.fields.slug === 'nile-river', 'slug: trimmed before validation');

  // title-only rename must NOT invent a slug field (drift-safe: leaves the slug alone)
  const titleOnly = buildPatch({ title: 'Just A Retitle' });
  ok(titleOnly.ok && !('slug' in titleOnly.fields), 'slug: absent from body → not in fields (title-only rename)');

  // format rejects
  for (const bad of ['Has Spaces', 'UPPER', 'a--b', '-lead', 'trail-', 'under_score', 'emoji🎬']) {
    const r = buildPatch({ slug: bad });
    ok(!r.ok && r.code === 'BAD_SLUG', `slug: format-reject ${JSON.stringify(bad)} → BAD_SLUG`);
  }
  // empty / non-string / too long
  ok(buildPatch({ slug: '' }).code === 'BAD_SLUG', 'slug: empty string → BAD_SLUG');
  ok(buildPatch({ slug: 42 }).code === 'BAD_SLUG', 'slug: non-string → BAD_SLUG');
  ok(buildPatch({ slug: 'x'.repeat(61) }).code === 'BAD_SLUG', 'slug: >60 chars → BAD_SLUG');
  // reserved
  for (const r of ['library', 'trash', 'new', 'home']) {
    ok(buildPatch({ slug: r }).code === 'RESERVED_SLUG', `slug: reserved ${JSON.stringify(r)} → RESERVED_SLUG`);
  }
}

/* ── 2. handler: happy slug PATCH echoes the updated row ─────────────────────── */
{
  calls.length = 0;
  patchStatus = 200;
  patchBody = [{ id: ID, slug: 'nile-river', title: 'Nile River', episode: null, config: {},
    created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-22T00:00:00Z', trashed_at: null, deleted_at: null, is_public: true }];
  const res = await PATCH(ID, { title: 'Nile River', slug: 'nile-river' });
  eq(res.status, 200, 'happy slug PATCH → 200');
  const body = await res.json();
  eq(body.project.slug, 'nile-river', 'happy slug PATCH echoes the new slug');
  // the PATCH body carried BOTH fields to the DB
  const dbPatch = calls.find((c) => c.method === 'PATCH');
  ok(dbPatch && dbPatch.body.slug === 'nile-river' && dbPatch.body.title === 'Nile River',
    'happy slug PATCH sends title + slug to the DB');
}

/* ── 3. handler: reserved / malformed slug rejected BEFORE the DB ────────────── */
{
  calls.length = 0;
  const res = await PATCH(ID, { slug: 'library' });
  eq(res.status, 400, 'reserved slug PATCH → 400');
  const body = await res.json();
  eq(body.error.code, 'RESERVED_SLUG', 'reserved slug PATCH → RESERVED_SLUG');
  eq(calls.filter((c) => c.method === 'PATCH').length, 0, 'reserved slug never reaches the DB');
}

/* ── 4. handler: slug collision → 409 SLUG_TAKEN ────────────────────────────── */
{
  patchStatus = 409;
  const res = await PATCH(ID, { slug: 'nile-river' });
  eq(res.status, 409, 'colliding slug PATCH → 409');
  const body = await res.json();
  eq(body.error.code, 'SLUG_TAKEN', 'colliding slug PATCH → SLUG_TAKEN');
  ok(body.error.message.includes('nile-river'), 'SLUG_TAKEN message names the attempted slug');
}

/* ── 5. handler: 23505 in a 4xx body also maps to 409 (defensive) ───────────── */
{
  patchStatus = 400;
  patchBody = 'duplicate key value violates unique constraint (23505)';
  const res = await PATCH(ID, { slug: 'nile-river' });
  eq(res.status, 409, '23505 body → 409 (defensive mapping)');
  const body = await res.json();
  eq(body.error.code, 'SLUG_TAKEN', '23505 body → SLUG_TAKEN');
  patchStatus = 200; patchBody = null;
}

/* ── 6. handler: PATCH is login-gated (anonymous → 401, no DB) ───────────────── */
{
  calls.length = 0;
  const res = await PATCH(ID, { slug: 'nile-river' }, {}); // no x-access-code
  eq(res.status, 401, 'anonymous slug PATCH → 401 (checkAccess-gated)');
  eq(calls.filter((c) => c.method === 'PATCH').length, 0, 'anonymous slug PATCH never touches the DB');
}

console.log(`script-projects-slug-patch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
