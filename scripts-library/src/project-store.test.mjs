// Tests for project-store.js — the CLOUD-BACKED project index with localStorage as an offline cache.
//
// The load-bearing logic locked here is mergeCloudRows: the audit's "no whole-list clobber, merge by
// id, read-back after write" discipline made concrete. A regression that keyed the merge by slug (not
// cloudId) would DUPLICATE a renamed project; one that dropped the legacy slug-adoption would create a
// SECOND burma card next to the seeded one; one that ignored the purge tombstone would RESURRECT a
// forever-deleted project on the next background sync.
//
// Run: bun scripts-library/src/project-store.test.mjs

// ── minimal localStorage + window shims (module reads bare globals) ─────────────
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => _store.clear(),
};
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };

const {
  INDEX_KEY, seedIfAbsent, mergeCloudRows, readIndex, activeProjects, trashedProjects, purgeProject,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
function reset() { _store.clear(); }

// ── seeder + legacy adoption by slug (burma/palau LINK to their cloud rows, no duplicates) ──
{
  reset();
  seedIfAbsent();
  eq(readIndex().length, 3, 'seed: three legacy rows (burma, palau, palau2)');
  const BURMA_UUID = '267bb0ec-215c-45bb-9a18-c2c5d4a68ef5';
  const PALAU_UUID = 'e8b9513c-98de-4950-8ba3-b660f0f5e2e4';
  const changed = mergeCloudRows([
    { id: BURMA_UUID, slug: 'burma', title: 'Burma — cloud title', episode: 'burma', updated_at: '2026-07-02T18:00:00Z', trashed_at: null },
    { id: PALAU_UUID, slug: 'palau', title: 'Palau', episode: 'palau', updated_at: '2026-07-02T17:00:00Z', trashed_at: null },
  ]);
  ok(changed, 'merge: legacy adoption changed the cache');
  const rows = readIndex();
  eq(rows.length, 3, 'merge: still exactly three rows (no duplicate burma/palau)');
  const burma = rows.find((r) => r.slug === 'burma');
  eq(burma.id, 'local_seed_burma', 'legacy: local id preserved (keeps pinned namespace)');
  eq(burma.cloudId, BURMA_UUID, 'legacy: linked to its cloud id by slug');
  eq(burma.episode, 'burma', 'legacy: episode pin preserved');
  eq(burma.title, 'Burma — cloud title', 'legacy: cloud title adopted (shared visibility)');
}

// ── a teammate's NEW project appears; keyed by cloud UUID as its id ──
{
  const TEAM_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  mergeCloudRows([{ id: TEAM_UUID, slug: 'teammate-doc', title: 'Teammate Doc', episode: null, updated_at: '2026-07-02T19:00:00Z', trashed_at: null }]);
  const row = readIndex().find((r) => r.slug === 'teammate-doc');
  ok(row, 'merge: teammate project added');
  eq(row.id, TEAM_UUID, 'teammate: cloud UUID is the id (drives its namespace + doc path)');
  eq(row.cloudId, TEAM_UUID, 'teammate: cloudId set');
  eq(activeProjects().length, 4, 'active: burma + palau + palau2 + teammate');
}

// ── rename-safe: merge is keyed by cloudId, so a locally-renamed slug does NOT duplicate ──
{
  const TEAM_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  // Simulate a local rename that changed the slug but kept id+cloudId.
  const rows = readIndex();
  const r = rows.find((x) => x.id === TEAM_UUID);
  r.slug = 'renamed-locally';
  localStorage.setItem(INDEX_KEY, JSON.stringify(rows));
  // Cloud still reports the OLD slug for the same cloudId.
  mergeCloudRows([{ id: TEAM_UUID, slug: 'teammate-doc', title: 'Teammate Doc', episode: null, updated_at: '2026-07-02T20:00:00Z', trashed_at: null }]);
  const matches = readIndex().filter((x) => x.cloudId === TEAM_UUID);
  eq(matches.length, 1, 'rename-safe: still ONE row for the cloudId (no slug-keyed duplicate)');
  eq(matches[0].slug, 'renamed-locally', 'rename-safe: local slug preserved, not reverted to cloud slug');
}

// ── trash state flows from cloud (a teammate trashed it) ──
{
  const TEAM_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  mergeCloudRows([{ id: TEAM_UUID, slug: 'teammate-doc', title: 'Teammate Doc', episode: null, updated_at: '2026-07-02T21:00:00Z', trashed_at: '2026-07-02T21:00:00Z' }]);
  ok(trashedProjects().some((r) => r.cloudId === TEAM_UUID), 'trash: cloud trashed_at moved the row to trash');
  ok(!activeProjects().some((r) => r.cloudId === TEAM_UUID), 'trash: no longer active');
}

// ── purge tombstone: a purged project can NOT be resurrected by a later cloud merge ──
{
  const TEAM_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  purgeProject(TEAM_UUID, {});
  ok(!readIndex().some((r) => r.cloudId === TEAM_UUID), 'purge: row removed from cache');
  const changed = mergeCloudRows([{ id: TEAM_UUID, slug: 'teammate-doc', title: 'Zombie', episode: null, updated_at: '2026-07-02T22:00:00Z', trashed_at: null }]);
  ok(!readIndex().some((r) => r.cloudId === TEAM_UUID), 'purge tombstone: cloud merge did NOT resurrect it');
  ok(!changed, 'purge tombstone: merge reports no change (nothing added)');
}

// ── resilience: a null / non-array cloud payload never throws and never clobbers ──
{
  const beforeLen = readIndex().length;
  eq(mergeCloudRows(null), false, 'resilience: null payload → no change, no throw');
  eq(mergeCloudRows([]), false, 'resilience: empty payload → no change');
  eq(readIndex().length, beforeLen, 'resilience: cache untouched by empty/null merges');
}

console.log(fail === 0 ? `PASS — all ${pass} project-store cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
