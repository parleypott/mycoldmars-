// SOFT-DELETE gate for api/script-projects.js — the "nobody can hard-delete, ever" contract.
//
// The audit found any pool member could DELETE any non-protected project and the FK cascade took the
// doc + its entire append-only revision history with it. The fix: the DELETE verb is now a SOFT delete
// (PATCH stamping deleted_at/deleted_by), deleted rows surface in the trash list, and restore clears
// the flag. These tests drive the REAL handler with a mocked fetch and prove:
//   (a) DELETE = soft — the outgoing DB traffic is a PATCH, the row survives
//   (b) restore works — PATCH deleted_at:null clears the soft delete (and its attribution)
//   (c) NO code path reaches a real REST DELETE — asserted at runtime (every recorded DB call across
//       every verb) AND statically (the source contains no `method: 'DELETE'` DB call)
//   (d) protected trio (burma/palau/palau2) still 403s before ANY write is attempted
//
// Run: bun api/script-projects-soft-delete.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// Env BEFORE import — the module reads these at load time. No ACCESS_CODE = dev-mode open gate,
// which is exactly what we want: these tests target the delete semantics, not the auth gate.
process.env.SUPABASE_URL = 'https://db.test.local';
process.env.SUPABASE_SERVICE_KEY = 'service-key-test';
delete process.env.ACCESS_CODE;

// ── recording fetch mock (the fake PostgREST) ──────────────────────────────────
// Every outgoing DB call is recorded {url, method, body} so the no-DELETE assertion can sweep the
// WHOLE run at the end. Lookup GETs answer from `dbRow`; PATCHes echo the merged row back.
const calls = [];
let dbRow = null; // the single script_projects row the fake DB holds
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
    if (method === 'POST') { dbRow = { id: 'aaaaaaaa-0000-4000-8000-000000000001', ...body }; return json([dbRow], 201); }
    // A real DELETE reaching the fake DB is the exact catastrophe this suite exists to prevent.
    if (method === 'DELETE') return json({ boom: 'HARD DELETE REACHED THE DB' }, 500);
  }
  return json({}, 404);
};

const mod = await import('./script-projects.js');
const handler = mod.default;
const { buildPatch, projectView } = mod;
const { softDeleteFields, restoreFields, ACTIVE_LIST_FILTER, TRASH_LIST_FILTER, isTrashRow } = await import('./_lib/soft-delete.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

const PID = 'bbbbbbbb-1111-4111-8111-000000000002';
const req = (method, qs, body) => new Request(`https://x.test/api/script-projects${qs}`, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
});

/* ── (a) DELETE = SOFT: row survives, deleted_at/deleted_by stamped via PATCH ── */
{
  dbRow = { id: PID, slug: 'my-script', title: 'My Script', episode: null, config: {}, trashed_at: null, deleted_at: null };
  calls.length = 0;
  const res = await handler(req('DELETE', `?id=${PID}`));
  eq(res.status, 200, 'a1. soft delete responds 200');
  const body = await res.json();
  eq(body.ok, true, 'a2. responds ok:true');
  ok(typeof body.deleted_at === 'string' && body.deleted_at, 'a3. responds with the deleted_at stamp');
  ok(dbRow !== null, 'a4. the row SURVIVES in the DB (soft, not destroyed)');
  ok(typeof dbRow.deleted_at === 'string', 'a5. deleted_at stamped on the row');
  eq(dbRow.deleted_by, null, 'a6. deleted_by null for an unauthenticated (dev-mode) caller');
  ok(typeof dbRow.trashed_at === 'string', 'a7. trashed_at set too, so the row lands in the trash view');
  const patches = calls.filter((c) => c.method === 'PATCH');
  eq(patches.length, 1, 'a8. exactly one PATCH carried the soft delete');
}

/* ── (a2) DELETE on an already-trashed row preserves its original trash clock ── */
{
  const TRASHED_ISO = '2026-07-01T00:00:00.000Z';
  dbRow = { id: PID, slug: 'my-script', title: 'My Script', trashed_at: TRASHED_ISO, deleted_at: null };
  const res = await handler(req('DELETE', `?id=${PID}`));
  eq(res.status, 200, 'a9. delete of trashed row accepted');
  eq(dbRow.trashed_at, TRASHED_ISO, 'a10. pre-existing trashed_at preserved (trash clock not reset)');
  ok(typeof dbRow.deleted_at === 'string', 'a11. deleted_at stamped on top');
}

/* ── (b) RESTORE: PATCH deleted_at:null clears the soft delete + attribution ── */
{
  dbRow = { id: PID, slug: 'my-script', title: 'My Script', trashed_at: '2026-07-01T00:00:00.000Z', deleted_at: '2026-07-02T00:00:00.000Z', deleted_by: 'someone' };
  const res = await handler(req('PATCH', `?id=${PID}`, { trashed_at: null, deleted_at: null }));
  eq(res.status, 200, 'b1. restore PATCH accepted');
  eq(dbRow.deleted_at, null, 'b2. deleted_at cleared');
  eq(dbRow.deleted_by, null, 'b3. stale deleted_by attribution cleared with it');
  eq(dbRow.trashed_at, null, 'b4. trashed_at cleared — row is fully active again');
  const view = (await res.json()).project;
  eq(view.deleted_at, null, 'b5. wire view reflects the restore');
}

/* ── (b2) buildPatch: deleted_at is RESTORE-ONLY ── */
{
  const p = buildPatch({ deleted_at: null });
  ok(p.ok && p.fields.deleted_at === null && p.fields.deleted_by === null,
    'b6. buildPatch accepts deleted_at:null and clears deleted_by alongside');
  eq(buildPatch({ deleted_at: new Date().toISOString() }).code, 'BAD_DELETED',
    'b7. buildPatch REFUSES setting deleted_at (deleting must go through DELETE for attribution)');
  eq(buildPatch({ deleted_at: true }).code, 'BAD_DELETED', 'b8. non-null junk refused too');
}

/* ── (d) PROTECTED trio: 403 before any write ── */
{
  for (const slug of ['burma', 'palau', 'palau2']) {
    dbRow = { id: PID, slug, title: slug, trashed_at: null, deleted_at: null };
    calls.length = 0;
    const res = await handler(req('DELETE', `?id=${PID}`));
    eq(res.status, 403, `d1. ${slug}: DELETE refused with 403`);
    eq(calls.filter((c) => c.method !== 'GET').length, 0, `d2. ${slug}: NO write of any kind attempted`);
    eq(dbRow.deleted_at, null, `d3. ${slug}: row untouched`);
  }
}

/* ── list filters: deleted rows are TRASH, never library ── */
{
  dbRow = { id: PID, slug: 'my-script', title: 'x', trashed_at: null, deleted_at: '2026-07-02T00:00:00.000Z' };
  calls.length = 0;
  await handler(req('GET', ''));
  ok(calls[0].url.includes(ACTIVE_LIST_FILTER), 'l1. active list filters out BOTH trashed and deleted rows');
  calls.length = 0;
  await handler(req('GET', '?trashed=1'));
  ok(calls[0].url.includes(encodeURI(TRASH_LIST_FILTER)) || calls[0].url.includes(TRASH_LIST_FILTER),
    'l2. trash list is trashed OR deleted — deleted rows surface for the trash UI / restore');
  ok(calls[0].url.includes('deleted_at'), 'l3. deleted_at selected onto the wire for the client');
}

/* ── (c) NO code path reaches a real DELETE ── */
{
  // Runtime sweep: across EVERY handler call this suite made (delete, restore, lists, protected),
  // not one outgoing DB request used the DELETE method.
  // (calls was reset per-case above, so drive one more full pass and sweep it.)
  calls.length = 0;
  dbRow = { id: PID, slug: 'sweep', title: 'x', trashed_at: null, deleted_at: null };
  await handler(req('DELETE', `?id=${PID}`));
  await handler(req('PATCH', `?id=${PID}`, { deleted_at: null }));
  await handler(req('GET', ''));
  await handler(req('GET', '?trashed=1'));
  eq(calls.filter((c) => c.method === 'DELETE').length, 0,
    'c1. runtime: zero outgoing REST DELETE across delete/restore/list flows');

  // Static sweep: the sources physically contain no DB call with method DELETE — the destructive
  // path (and its FK cascade over script_doc_revisions) is REMOVED, not merely routed around.
  for (const f of ['./script-projects.js', './script-doc.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    ok(!/method:\s*['"]DELETE['"]/.test(src), `c2. static: ${f} contains no method:'DELETE' DB call`);
  }
}

/* ── _lib/soft-delete pure helpers ── */
{
  const f = softDeleteFields('user-1', '2026-07-07T00:00:00.000Z', null);
  eq(f.deleted_at, '2026-07-07T00:00:00.000Z', 's1. softDeleteFields stamps deleted_at');
  eq(f.deleted_by, 'user-1', 's2. attributes the deleter');
  eq(f.trashed_at, '2026-07-07T00:00:00.000Z', 's3. trashes if not already trashed');
  const g = softDeleteFields(null, '2026-07-07T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
  eq(g.trashed_at, '2026-07-01T00:00:00.000Z', 's4. preserves an existing trash clock');
  eq(g.deleted_by, null, 's5. unknown deleter is an honest null');
  const r = restoreFields('2026-07-07T00:00:00.000Z');
  ok(r.trashed_at === null && r.deleted_at === null && r.deleted_by === null, 's6. restoreFields clears all three');
  ok(isTrashRow({ deleted_at: 'x' }) && isTrashRow({ trashed_at: 'x' }) && !isTrashRow({ trashed_at: null, deleted_at: null }),
    's7. isTrashRow: trashed OR deleted');
}

/* ── projectView carries deleted_at, still never leaks created_by/deleted_by ── */
{
  const v = projectView({ id: 'u', slug: 's', title: 't', created_by: 'SECRET', deleted_by: 'SECRET2', deleted_at: 'd', trashed_at: null });
  eq(v.deleted_at, 'd', 'v1. deleted_at on the wire');
  ok(!('created_by' in v) && !('deleted_by' in v), 'v2. created_by/deleted_by never leak');
}

console.log(fail === 0 ? `PASS — all ${pass} soft-delete gate cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
