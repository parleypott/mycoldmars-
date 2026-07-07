// Soft-delete semantics for project-store.js — the client half of the "nobody can hard-delete" fix.
//
// Server-side, DELETE is now a soft delete (api/script-projects stamps deleted_at, never cascades).
// This locks the client contract that rides on it:
//   • purgeProject ("Delete forever" in the trash UI) NO LONGER destroys local data — it must not
//     touch the passed storageKeys or the IndexedDB recovery DB (for a never-synced local_ project
//     those bytes are the only copy in existence). It still hides the row locally (remove + tombstone)
//     and still fires the — now soft — cloud DELETE for non-protected rows.
//   • restoreProject clears BOTH flags and tells the cloud to clear BOTH (trashed_at + deleted_at),
//     so a teammate-deleted project can be brought back from the trash view.
//   • a cloud row deleted by a teammate (deleted_at set) lands in trashedProjects, never in the
//     active library — the existing trash UI shows it with a working Restore.
//
// Run: bun scripts-library/src/project-store-soft-delete.test.mjs

// ── shims (module reads bare globals) ───────────────────────────────────────────
const _store = new Map();
const removedKeys = [];
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { removedKeys.push(k); _store.delete(k); },
  clear: () => _store.clear(),
};
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
// Any deleteDatabase call is a data-destruction regression — record it so a test can fail on it.
const deletedDbs = [];
globalThis.indexedDB = { deleteDatabase: (name) => { deletedDbs.push(name); } };
// Recording fetch: capture every cloud call (url, method, parsed body) and answer with a minimal
// success so the fire-and-forget .then() paths run. Never rejects — we want the ONLINE path here.
const netCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const method = (init && init.method) || 'GET';
  const body = init && init.body ? JSON.parse(init.body) : null;
  netCalls.push({ url: String(url), method, body });
  return new Response(JSON.stringify({ ok: true, project: null, projects: [] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

const {
  INDEX_KEY, readIndex, mergeCloudRows, activeProjects, trashedProjects,
  restoreProject, purgeProject,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL ${m}`); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)} want ${JSON.stringify(w)})`);
const tick = () => new Promise((r) => setTimeout(r, 0));

const CLOUD_ID = 'cccccccc-2222-4222-8222-000000000003';

/* ── a teammate-deleted cloud row lands in TRASH, not the library ── */
{
  _store.clear();
  localStorage.setItem(INDEX_KEY, JSON.stringify([]));
  mergeCloudRows([{
    id: CLOUD_ID, slug: 'doomed', title: 'Doomed', episode: null,
    updated_at: '2026-07-05T00:00:00Z', trashed_at: '2026-07-05T00:00:00Z', deleted_at: '2026-07-05T00:00:00Z',
  }]);
  ok(trashedProjects().some((r) => r.cloudId === CLOUD_ID), 't1. deleted cloud row shows in the trash view');
  ok(!activeProjects().some((r) => r.cloudId === CLOUD_ID), 't2. deleted cloud row hidden from the library');
  eq(readIndex().find((r) => r.cloudId === CLOUD_ID).deletedAt, '2026-07-05T00:00:00Z', 't3. deletedAt carried into the cache');
}

/* ── even a deleted_at WITHOUT trashed_at is still trash (belt-and-suspenders) ── */
{
  const ODD_ID = 'dddddddd-3333-4333-8333-000000000004';
  mergeCloudRows([{ id: ODD_ID, slug: 'odd', title: 'Odd', episode: null, updated_at: '2026-07-05T01:00:00Z', trashed_at: null, deleted_at: '2026-07-05T01:00:00Z' }]);
  ok(trashedProjects().some((r) => r.cloudId === ODD_ID), 't4. deleted-but-not-trashed row still classed as trash');
  ok(!activeProjects().some((r) => r.cloudId === ODD_ID), 't5. …and never active');
}

/* ── restoreProject clears BOTH flags locally and on the wire ── */
{
  netCalls.length = 0;
  const row = restoreProject(readIndex().find((r) => r.cloudId === CLOUD_ID).id);
  eq(row.trashedAt, null, 'r1. optimistic cache: trashedAt cleared');
  eq(row.deletedAt, null, 'r2. optimistic cache: deletedAt cleared');
  await tick();
  const patch = netCalls.find((c) => c.method === 'PATCH');
  ok(patch, 'r3. restore fired a cloud PATCH');
  ok(patch && patch.body && patch.body.trashed_at === null && patch.body.deleted_at === null,
    'r4. PATCH body clears BOTH trashed_at and deleted_at (server accepts deleted_at only as null)');
  ok(activeProjects().some((r) => r.cloudId === CLOUD_ID), 'r5. row back in the active library');
}

/* ── purgeProject: hides the row but DESTROYS NOTHING ── */
{
  // Re-trash then "delete forever" it.
  mergeCloudRows([{ id: CLOUD_ID, slug: 'doomed', title: 'Doomed', episode: null, updated_at: '2026-07-06T00:00:00Z', trashed_at: '2026-07-06T00:00:00Z', deleted_at: null }]);
  const localId = readIndex().find((r) => r.cloudId === CLOUD_ID).id;
  // Park a doc key that the OLD purge would have removed.
  localStorage.setItem('script_doc_key_1', 'precious bytes');
  removedKeys.length = 0;
  deletedDbs.length = 0;
  netCalls.length = 0;

  purgeProject(localId, { storageKeys: ['script_doc_key_1'], dbName: 'recovery-db' });
  await tick();

  ok(!readIndex().some((r) => r.cloudId === CLOUD_ID), 'p1. row removed from THIS device\'s cache');
  eq(localStorage.getItem('script_doc_key_1'), 'precious bytes', 'p2. local doc keys NOT deleted (data preserved)');
  eq(removedKeys.length, 0, 'p3. no localStorage.removeItem fired at all');
  eq(deletedDbs.length, 0, 'p4. IndexedDB recovery DB NOT deleted');
  const del = netCalls.find((c) => c.method === 'DELETE');
  ok(del && del.url.includes(encodeURIComponent(CLOUD_ID)), 'p5. cloud DELETE (soft server-side) fired for the cloudId');

  // Tombstone: a later sync can't resurrect it on this device.
  mergeCloudRows([{ id: CLOUD_ID, slug: 'doomed', title: 'Zombie', episode: null, updated_at: '2026-07-06T01:00:00Z', trashed_at: '2026-07-06T00:00:00Z', deleted_at: '2026-07-06T01:00:00Z' }]);
  ok(!readIndex().some((r) => r.cloudId === CLOUD_ID), 'p6. tombstone: merge did not resurrect the purged row');
}

/* ── purgeProject on a PROTECTED slug never fires a cloud delete ── */
{
  const BURMA_ID = 'eeeeeeee-4444-4444-8444-000000000005';
  mergeCloudRows([{ id: BURMA_ID, slug: 'burma', title: 'Burma', episode: 'burma', updated_at: '2026-07-06T02:00:00Z', trashed_at: '2026-07-06T02:00:00Z', deleted_at: null }]);
  const localId = readIndex().find((r) => r.cloudId === BURMA_ID).id;
  netCalls.length = 0;
  purgeProject(localId, { storageKeys: [], dbName: null });
  await tick();
  eq(netCalls.filter((c) => c.method === 'DELETE').length, 0, 'p7. protected slug: no cloud DELETE even attempted');
  ok(!readIndex().some((r) => r.cloudId === BURMA_ID), 'p8. …but it still hides locally (tombstoned)');
}

/* ── static sweep: the store contains NO local-data destruction in the purge path ── */
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./project-store.js', import.meta.url), 'utf8');
  ok(!/deleteDatabase/.test(src), 's1. static: no indexedDB.deleteDatabase left in project-store.js');
  const purgeBody = src.slice(src.indexOf('export function purgeProject'));
  ok(!/removeItem/.test(purgeBody.slice(0, purgeBody.indexOf('\n}'))), 's2. static: purgeProject body has no removeItem');
}

console.log(fail === 0 ? `PASS — all ${pass} client soft-delete cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
