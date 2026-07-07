// TRASH AUTO-ARCHIVE for api/script-projects.js — the 90-day window on the ?trashed=1 list.
//
// Johnny's rule: nothing is ever destroyed. A row that has sat in the trash for 90 days simply stops
// appearing in the trash LIST (trashListFilter bounds the PostgREST query); the row and its full
// revision history stay in the DB untouched, and restore-by-id (direct PATCH) is age-blind. These
// tests lock:
//   (a) the filter boundary — a row trashed 89d ago is INSIDE the window (listed), 91d ago OUTSIDE
//       (hidden). PostgREST's `gt` on timestamptz is proven via same-format ISO string comparison,
//       which is chronologically ordered — the exact semantics of the generated filter.
//   (b) the filter shape — trashed_at is the archive clock; deleted_at only counts when trashed_at
//       is absent (mirrors softDeleteFields preserving the original trash clock).
//   (c) restore still works on an ARCHIVED row — a direct PATCH {trashed_at:null, deleted_at:null}
//       against a 200d-old trash row succeeds and fully reactivates it. Nothing about age gates it.
//
// Run: bun api/script-projects-archive.test.mjs
import assert from 'node:assert';

// Env BEFORE import — the module reads these at load time. No ACCESS_CODE = dev-mode open gate.
process.env.SUPABASE_URL = 'https://db.test.local';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
delete process.env.ACCESS_CODE;

// ── recording fetch mock (the fake PostgREST) ──────────────────────────────────
const calls = [];
let dbRow = null;
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method, body });
  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url).includes('/rest/v1/script_projects')) {
    if (method === 'GET') return json(dbRow ? [dbRow] : []);
    if (method === 'PATCH') {
      if (!dbRow) return json([]);
      dbRow = { ...dbRow, ...body };
      return json([dbRow]);
    }
  }
  return json({}, 404);
};

const mod = await import('./script-projects.js');
const handler = mod.default;
const { trashListFilter, TRASH_ARCHIVE_DAYS, buildPatch } = mod;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 7, 12, 0, 0); // fixed "now" so every case is deterministic
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

// Evaluate the generated filter the way PostgREST does. Same-format ISO-8601 strings compare
// lexicographically = chronologically, and `col.gt.value` is false when col is NULL — so this tiny
// evaluator IS the semantics of `or=(trashed_at.gt.C,and(trashed_at.is.null,deleted_at.gt.C))`.
const cutoffOf = (filter) => {
  const m = filter.match(/trashed_at\.gt\.([^,)]+)/);
  return m ? m[1] : null;
};
const listedBy = (filter, row) => {
  const cutoff = cutoffOf(filter);
  return (row.trashed_at != null && row.trashed_at > cutoff)
    || (row.trashed_at == null && row.deleted_at != null && row.deleted_at > cutoff);
};

/* ── (a) the 90-day boundary ── */
{
  eq(TRASH_ARCHIVE_DAYS, 90, 'a0. archive window is 90 days');
  const filter = trashListFilter(NOW);
  eq(cutoffOf(filter), iso(90), 'a1. cutoff embedded in the filter is exactly now - 90d');

  ok(listedBy(filter, { trashed_at: iso(89), deleted_at: null }), 'a2. trashed 89d ago -> SHOWN');
  ok(!listedBy(filter, { trashed_at: iso(91), deleted_at: null }), 'a3. trashed 91d ago -> HIDDEN (archived)');
  ok(!listedBy(filter, { trashed_at: iso(90), deleted_at: null }), 'a4. exactly 90d -> HIDDEN (strict gt)');
  ok(listedBy(filter, { trashed_at: iso(0), deleted_at: null }), 'a5. freshly trashed -> shown');

  // deleted_at is the fallback clock ONLY when trashed_at is absent
  ok(listedBy(filter, { trashed_at: null, deleted_at: iso(89) }), 'a6. deleted-only 89d ago -> shown');
  ok(!listedBy(filter, { trashed_at: null, deleted_at: iso(91) }), 'a7. deleted-only 91d ago -> hidden');
  // trashed_at is THE clock — a later delete never resets it (softDeleteFields preserves it)
  ok(!listedBy(filter, { trashed_at: iso(91), deleted_at: iso(5) }),
    'a8. trashed 91d ago then deleted 5d ago -> still archived (trash clock is not reset)');
  // active rows never leak into the trash list
  ok(!listedBy(filter, { trashed_at: null, deleted_at: null }), 'a9. active row -> never in trash list');
}

/* ── (b) the handler sends the archive-bounded filter on ?trashed=1 ── */
{
  dbRow = null;
  calls.length = 0;
  const res = await handler(new Request('https://x.test/api/script-projects?trashed=1'));
  eq(res.status, 200, 'b1. trash list responds 200');
  ok(calls[0].url.includes('or=(trashed_at.gt.'), 'b2. outgoing trash query is archive-bounded');
  ok(calls[0].url.includes('and(trashed_at.is.null,deleted_at.gt.'),
    'b3. deleted-only fallback branch rides along');
  // the cutoff on the wire is ~now-90d (runtime clock; allow a minute of slack)
  const wire = cutoffOf(decodeURIComponent(calls[0].url.split('?')[1]));
  const drift = Math.abs(new Date(wire).getTime() - (Date.now() - 90 * DAY));
  ok(Number.isFinite(new Date(wire).getTime()) && drift < 60 * 1000,
    `b4. wire cutoff is a real timestamp ~90d back (drift ${drift}ms)`);
}

/* ── (c) restore on an ARCHIVED row still works via direct PATCH (age-blind) ── */
{
  const PID = 'bbbbbbbb-1111-4111-8111-000000000002';
  dbRow = {
    id: PID, slug: 'ancient', title: 'Ancient', episode: null, config: {},
    trashed_at: iso(200), deleted_at: iso(200), deleted_by: 'someone',
  };
  calls.length = 0;
  const res = await handler(new Request(`https://x.test/api/script-projects?id=${PID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed_at: null, deleted_at: null }),
  }));
  eq(res.status, 200, 'c1. restore PATCH on a 200d-archived row accepted — archive never blocks restore');
  eq(dbRow.trashed_at, null, 'c2. trashed_at cleared');
  eq(dbRow.deleted_at, null, 'c3. deleted_at cleared');
  eq(dbRow.deleted_by, null, 'c4. stale attribution cleared');
  const view = (await res.json()).project;
  eq(view.trashed_at, null, 'c5. wire view reflects the restore — row is active again');
}

/* ── (c2) buildPatch is age-blind by construction — no timestamp inspection on restore ── */
{
  const p = buildPatch({ trashed_at: null, deleted_at: null });
  ok(p.ok && p.fields.trashed_at === null && p.fields.deleted_at === null,
    'c6. buildPatch accepts the full restore regardless of how old the row is (it never sees age)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
