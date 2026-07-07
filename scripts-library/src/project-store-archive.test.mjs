// TRASH AUTO-ARCHIVE — the project-store (client/offline-cache) half of the 90-day window.
//
// The server's ?trashed=1 list already excludes rows archived past 90 days; trashedProjects() is the
// BELT for the offline cache (rows the cloud stopped listing keep their old trashedAt locally, and a
// fully-offline device has no server filter at all). These tests lock:
//   • the boundary: a row trashed 89d ago is in trashedProjects, 91d ago is NOT;
//   • archived ≠ destroyed: the archived row STAYS in the index (readIndex) — it is only hidden;
//   • restore still works on an archived row: restoreProject clears both flags locally AND fires the
//     direct cloud PATCH {trashed_at:null, deleted_at:null}, and the row rejoins activeProjects;
//   • the no-clock safety posture: a trash row whose clock is garbage is KEPT visible.
//
// Run: bun scripts-library/src/project-store-archive.test.mjs

// ── shims (module reads bare globals) ───────────────────────────────────────────
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => _store.clear(),
};
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
// Recording fetch: capture every cloud call and answer success so the .then() read-backs run.
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
  INDEX_KEY, readIndex, activeProjects, trashedProjects, restoreProject,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`FAIL ${m}`); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)} want ${JSON.stringify(w)})`);
const tick = () => new Promise((r) => setTimeout(r, 0));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 7, 12, 0, 0); // fixed "now" for the boundary cases
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

const CLOUD_ID = 'dddddddd-3333-4333-8333-000000000004';
const seed = () => {
  _store.clear();
  netCalls.length = 0;
  localStorage.setItem(INDEX_KEY, JSON.stringify([
    { id: 'p-active', slug: 'active', title: 'Active', updatedAt: iso(1), trashedAt: null },
    { id: 'p-fresh', slug: 'fresh', title: 'Fresh trash', updatedAt: iso(2), trashedAt: iso(2) },
    { id: 'p-89d', slug: 'edge-in', title: 'Edge in', updatedAt: iso(89), trashedAt: iso(89) },
    { id: 'p-91d', cloudId: CLOUD_ID, slug: 'archived', title: 'Archived', updatedAt: iso(91), trashedAt: iso(91) },
    { id: 'p-del-91d', slug: 'deleted-old', title: 'Deleted old', updatedAt: iso(91), trashedAt: null, deletedAt: iso(91) },
    { id: 'p-badclock', slug: 'bad-clock', title: 'Bad clock', updatedAt: iso(3), trashedAt: 'garbage' },
  ]));
};

/* ── boundary: 89d shown, 91d hidden ── */
{
  seed();
  const ids = trashedProjects(NOW).map((r) => r.id);
  ok(ids.includes('p-89d'), 'trash view SHOWS a row trashed 89d ago');
  ok(ids.includes('p-fresh'), 'trash view shows fresh trash');
  ok(!ids.includes('p-91d'), 'trash view HIDES a row trashed 91d ago (archived)');
  ok(!ids.includes('p-del-91d'), 'deleted-only row 91d old is archived too (deletedAt is the fallback clock)');
  ok(ids.includes('p-badclock'), 'a trash row with an unparseable clock is KEPT visible (recoverable)');
  ok(!ids.includes('p-active'), 'active rows never appear in the trash view');
}

/* ── archived ≠ destroyed: the hidden row still lives in the index ── */
{
  seed();
  trashedProjects(NOW); // the query must be a pure read — never a prune
  const raw = readIndex();
  ok(raw.some((r) => r.id === 'p-91d'), 'archived row SURVIVES in the local index — hidden, not removed');
  eq(raw.length, 6, 'trashedProjects mutated nothing (all 6 rows intact)');
}

/* ── restore still works on an ARCHIVED row (the admin/direct-PATCH path) ── */
{
  seed();
  const row = restoreProject('p-91d');
  ok(row && row.trashedAt === null && row.deletedAt === null,
    'restoreProject on a 91d-archived row clears both flags — archive never blocks restore');
  ok(activeProjects().some((r) => r.id === 'p-91d'), 'restored row rejoins the ACTIVE library');
  ok(!trashedProjects(NOW).some((r) => r.id === 'p-91d'), 'and leaves the trash view');
  await tick(); // let the fire-and-forget cloud PATCH land in the recorder
  const patch = netCalls.find((c) => c.method === 'PATCH' && c.url.includes(CLOUD_ID));
  ok(patch, 'restore fired the direct cloud PATCH by id (the age-blind path)');
  ok(patch && patch.body && patch.body.trashed_at === null && patch.body.deleted_at === null,
    'the PATCH body is the full restore {trashed_at:null, deleted_at:null}');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
