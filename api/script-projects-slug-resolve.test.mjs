// GOOGLE-DOCS LINK SHARING — the API contract for the guest door (api/script-projects GET).
//
// Two laws, both pinned here against the REAL handler with a fake PostgREST:
//   1. THE INDEX NEVER LEAKS: the plain list GET (and ?trashed=1) is login-gated. An anonymous
//      caller gets 401 and ZERO project rows; a caller with credentials gets the list as before.
//   2. SCOPED SLUG RESOLUTION IS THE ONLY ANONYMOUS READ: GET ?slug=<slug> resolves exactly ONE
//      public + active row with minimal fields (never config / is_public / created_by), and
//      unknown, private, trashed, reserved and malformed slugs are indistinguishable
//      ({ project: null }) — no slug-existence oracle for probers.
//
// Run: bun api/script-projects-slug-resolve.test.mjs

// Env BEFORE import — the module reads these at load time. ACCESS_CODE IS SET here (unlike the
// sibling suites): this suite is specifically about the auth gate on the list vs the open slug door.
process.env.SUPABASE_URL = 'https://db.test.local';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
process.env.ACCESS_CODE = 'sesame-test';
// checkAccess's JWT branch needs these to even try; unset so only x-access-code can pass.
delete process.env.SUPABASE_ANON_KEY;
delete process.env.VITE_SUPABASE_ANON_KEY;

// ── recording fetch mock (the fake PostgREST) ─────────────────────────────────
const calls = [];
let dbRows = [];   // what a script_projects GET answers with
let dbFail = false;
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ url: String(url), method });
  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  if (dbFail) return json({ boom: true }, 500);
  if (String(url).includes('/rest/v1/script_projects') && method === 'GET') return json(dbRows);
  return json({}, 404);
};

const mod = await import('./script-projects.js');
const handler = mod.default;
const { publicProjectView } = mod;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

const GET = (qs, headers = {}) => handler(new Request(`https://x.test/api/script-projects${qs}`, { headers }));

const ROW = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  slug: 'nile-river',
  title: 'Nile River',
  episode: null,
  config: { secret: 'team-only' },
  created_by: 'user-1',
  is_public: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
  trashed_at: null,
  deleted_at: null,
};

/* ── 1. the LIST is gated ───────────────────────────────────────────────────── */
{
  calls.length = 0;
  const res = await GET('');
  eq(res.status, 401, 'anonymous plain list GET → 401');
  eq(calls.length, 0, 'anonymous list never even reaches the DB');

  const res2 = await GET('?trashed=1');
  eq(res2.status, 401, 'anonymous trash list GET → 401');

  dbRows = [ROW];
  const res3 = await GET('', { 'x-access-code': 'sesame-test' });
  eq(res3.status, 200, 'credentialed list GET still 200 (teammates unaffected)');
  const body3 = await res3.json();
  ok(Array.isArray(body3.projects) && body3.projects.length === 1, 'credentialed list returns rows');
}

/* ── 2. ?slug= is the anonymous scoped door ─────────────────────────────────── */
{
  calls.length = 0;
  dbRows = [ROW];
  const res = await GET('?slug=nile-river');
  eq(res.status, 200, 'anonymous ?slug= GET → 200 (no credentials needed)');
  const body = await res.json();
  ok(body.project && body.project.id === ROW.id, 'resolves the row');
  eq(body.project.slug, 'nile-river', 'slug rides through');
  eq(body.project.title, 'Nile River', 'title rides through');
  ok(!('config' in body.project), 'config NEVER in the guest shape');
  ok(!('created_by' in body.project), 'created_by NEVER in the guest shape');
  ok(!('is_public' in body.project), 'is_public bookkeeping not echoed');
  ok(!('projects' in body), 'a slug resolution is never a LIST');

  // The DB query itself is scoped: public + active + limit 1 + minimal select.
  eq(calls.length, 1, 'exactly one DB call');
  const q = calls[0].url;
  ok(q.includes('slug=eq.nile-river'), 'DB query filters by slug');
  ok(q.includes('is_public=not.is.false'), 'DB query filters to PUBLIC rows');
  ok(q.includes('trashed_at=is.null') && q.includes('deleted_at=is.null'), 'DB query filters to ACTIVE rows');
  ok(q.includes('limit=1'), 'DB query is limit 1');
  ok(q.includes('select=id,slug,title,episode,updated_at'), 'DB select is the minimal field set');
  ok(!q.includes('config'), 'DB select never pulls config');
}

/* ── 3. unknown / private / trashed are indistinguishable ───────────────────── */
{
  dbRows = []; // the scoped filter already excluded it — private/trashed/unknown all land here
  const res = await GET('?slug=does-not-exist');
  eq(res.status, 200, 'unknown slug → calm 200');
  const body = await res.json();
  eq(body.project, null, 'unknown slug → { project: null }');
}

/* ── 4. malformed / reserved slugs short-circuit without touching the DB ────── */
{
  for (const bad of ['', '   ', 'Has Spaces', 'UPPER', 'x'.repeat(61), 'library', 'trash', 'home', 'new', 'a--b', '-lead']) {
    calls.length = 0;
    const res = await GET(`?slug=${encodeURIComponent(bad)}`);
    eq(res.status, 200, `malformed slug ${JSON.stringify(bad)} → calm 200`);
    const body = await res.json();
    eq(body.project, null, `malformed slug ${JSON.stringify(bad)} → null`);
    eq(calls.length, 0, `malformed slug ${JSON.stringify(bad)} never reaches the DB`);
  }
}

/* ── 5. DB trouble fails CLOSED (502), never over-serves ────────────────────── */
{
  dbFail = true;
  const res = await GET('?slug=nile-river');
  eq(res.status, 502, 'DB failure → 502 (fail closed — never hand out unverified rows)');
  dbFail = false;
}

/* ── 6. publicProjectView shape (pure) ──────────────────────────────────────── */
{
  const v = publicProjectView(ROW);
  eq(
    JSON.stringify(v),
    JSON.stringify({ id: ROW.id, slug: ROW.slug, title: ROW.title, episode: null, updated_at: ROW.updated_at }),
    'guest shape is exactly the minimal five fields',
  );
  eq(publicProjectView(null), null, 'null-safe');
  eq(publicProjectView('x'), null, 'non-object-safe');
}

console.log(`script-projects-slug-resolve: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
