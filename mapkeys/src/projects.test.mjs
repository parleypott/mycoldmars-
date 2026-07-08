// First coverage for mapkeys/src/projects.js — the CLOUD-BACKED map-project store
// with localStorage as the offline cache (shipped today, previously untested).
//
// The load-bearing logic locked here:
//   • generateSlug — the apostrophe-safe slugger, a byte-copy of the Script Library's
//     tested slug.js. A curly-quote regression re-introduces the "johnny-s-" ugliness.
//   • ensureUniqueSlug — RESERVED slugs must dodge ('library' → 'library-1') and
//     collisions must suffix (-2, -3…), excludeId must let a rename keep its own slug.
//   • readIndex — shape-safety: a corrupt / non-array cache degrades to empty arrays,
//     never a throw (the whole tool boots off this synchronously).
//   • activeProjects / trashedProjects — trashed_at filter split + newest-first sort
//     that must NOT be NaN-poisoned by a garbage updated_at (the ts() guard).
//   • mergeCloud — cloud wins by id, local_ rows survive, folders mirror wholesale,
//     and the changed flag only fires on a real delta (drives the sync event).
//
// Run: bun mapkeys/src/projects.test.mjs

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
  INDEX_KEY, RESERVED_SLUGS,
  generateSlug, ensureUniqueSlug, readIndex,
  activeProjects, trashedProjects, mergeCloud, findBySlug,
} = await import('./projects.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
function reset() { _store.clear(); }
function seed(projects, folders) {
  _store.set(INDEX_KEY, JSON.stringify({ projects, folders: folders || [] }));
}

// ── generateSlug ────────────────────────────────────────────────────────────
{
  eq(generateSlug("Johnny's Map"), 'johnnys-map', 'slug: straight apostrophe stripped, not dashed');
  eq(generateSlug('Johnny’s Map'), 'johnnys-map', 'slug: curly apostrophe (U+2019) stripped too');
  eq(generateSlug('  Hello,  World!  '), 'hello-world', 'slug: punctuation collapses, ends trimmed');
  eq(generateSlug(''), 'untitled', 'slug: empty → untitled');
  eq(generateSlug(null), 'untitled', 'slug: null → untitled');
  eq(generateSlug('!!!'), 'untitled', 'slug: all-punctuation → untitled');
  eq(generateSlug('UPPER Case'), 'upper-case', 'slug: lowercased');
}

// ── ensureUniqueSlug ──────────────────────────────────────────────────────────
{
  reset();
  eq(ensureUniqueSlug('my-map'), 'my-map', 'unique: free slug returned as-is');

  // RESERVED slug must dodge the router words.
  for (const r of RESERVED_SLUGS) {
    ok(ensureUniqueSlug(r) !== r, `unique: reserved '${r}' is never returned bare`);
  }
  eq(ensureUniqueSlug('library'), 'library-1', 'unique: reserved library → library-1');

  reset();
  seed([{ id: 'a', slug: 'coast' }, { id: 'b', slug: 'coast-2' }]);
  eq(ensureUniqueSlug('coast'), 'coast-3', 'unique: collision skips taken -2, lands -3');

  // excludeId lets a project keep its OWN slug on rename.
  reset();
  seed([{ id: 'a', slug: 'coast' }]);
  eq(ensureUniqueSlug('coast', 'a'), 'coast', 'unique: excludeId keeps own slug');
  eq(ensureUniqueSlug('coast', 'b'), 'coast-2', 'unique: a DIFFERENT id still collides');
}

// ── readIndex shape-safety ────────────────────────────────────────────────────
{
  reset();
  const empty = readIndex();
  ok(Array.isArray(empty.projects) && empty.projects.length === 0, 'readIndex: no cache → empty projects[]');
  ok(Array.isArray(empty.folders) && empty.folders.length === 0, 'readIndex: no cache → empty folders[]');

  _store.set(INDEX_KEY, 'not json{');
  ok(Array.isArray(readIndex().projects), 'readIndex: corrupt JSON → empty (no throw)');

  _store.set(INDEX_KEY, JSON.stringify({ projects: 'nope', folders: 42 }));
  const shaped = readIndex();
  ok(Array.isArray(shaped.projects) && shaped.projects.length === 0, 'readIndex: non-array projects → []');
  ok(Array.isArray(shaped.folders) && shaped.folders.length === 0, 'readIndex: non-array folders → []');
}

// ── activeProjects / trashedProjects: filter + newest-first sort, NaN-safe ─────
{
  reset();
  // 'bad' is seeded FIRST with a garbage date. With the ts() NaN-guard it scores 0
  // and sorts to the BOTTOM; without the guard its comparisons return NaN (coerced
  // to 0 by Array.sort → no reorder) so it stays wrongly pinned at the front.
  seed([
    { id: 'bad', slug: 'bad', updated_at: 'garbage-date' },
    { id: 'new', slug: 'new', updated_at: '2026-06-01T00:00:00Z' },
    { id: 'old', slug: 'old', updated_at: '2026-01-01T00:00:00Z' },
    { id: 'gone', slug: 'gone', updated_at: '2026-05-01T00:00:00Z', trashed_at: '2026-05-02T00:00:00Z' },
  ]);
  const active = activeProjects();
  eq(active.length, 3, 'active: trashed row excluded');
  ok(!active.some((r) => r.id === 'gone'), 'active: trashed never leaks in');
  eq(active[0].id, 'new', 'active: newest updated_at first (ts NaN-guard keeps bad off the top)');
  eq(active[2].id, 'bad', 'active: garbage-date row sorts to the bottom, not the top');

  const trash = trashedProjects();
  eq(trash.length, 1, 'trash: only the trashed row');
  eq(trash[0].id, 'gone', 'trash: the trashed row');
}

// ── mergeCloud: cloud wins by id, local_ survives, folders wholesale ──────────
{
  reset();
  // srv1 was RENAMED in the cloud: same id, DIFFERENT slug. Keying the merge by id
  // updates the one row (count stays 1); keying by slug would treat old/new as two
  // keys and DUPLICATE the project — the exact bug the id-key discipline prevents.
  seed(
    [
      { id: 'srv1', slug: 'old-slug', name: 'Local A' },
      { id: 'local_x', slug: 'z', name: 'Offline-made' },
    ],
    [{ id: 'f_old', name: 'old folder' }],
  );
  const changed = mergeCloud(
    [{ id: 'srv1', slug: 'new-slug', name: 'Cloud A (renamed)' }, { id: 'srv2', slug: 'b', name: 'New from cloud' }],
    [{ id: 'f_new', name: 'cloud folder' }],
  );
  ok(changed, 'mergeCloud: real delta → changed=true');
  const idx = readIndex();
  const srv1Rows = idx.projects.filter((r) => r.id === 'srv1');
  eq(srv1Rows.length, 1, 'mergeCloud: renamed row keyed by id — NOT duplicated');
  eq(srv1Rows[0].name, 'Cloud A (renamed)', 'mergeCloud: cloud row overwrites local by id');
  eq(srv1Rows[0].slug, 'new-slug', 'mergeCloud: cloud slug wins on the merged row');
  ok(idx.projects.some((r) => r.id === 'local_x'), 'mergeCloud: local_ row survives (not clobbered)');
  ok(idx.projects.some((r) => r.id === 'srv2'), 'mergeCloud: brand-new cloud row added');
  eq(idx.folders.length, 1, 'mergeCloud: folders mirror the cloud list wholesale');
  eq(idx.folders[0].id, 'f_new', 'mergeCloud: cloud folders replace local');

  // No-op merge (same data) must NOT report a change → no spurious sync event.
  const again = mergeCloud(
    [{ id: 'srv1', slug: 'new-slug', name: 'Cloud A (renamed)' }, { id: 'srv2', slug: 'b', name: 'New from cloud' }],
    [{ id: 'f_new', name: 'cloud folder' }],
  );
  ok(again === false, 'mergeCloud: identical re-merge → changed=false (no spurious event)');
}

// ── QUOTA-DEATH survival (the mycoldmars.com "New map does nothing" bug) ──────
// When the origin's localStorage is FULL, setItem throws QuotaExceededError.
// The store must stay coherent in memory: a write that can't persist must
// still be visible to the very next read (findBySlug), or the router bounces
// every freshly-created project back to the library. LOAD-BEARING: removing
// the memIndex mirror in projects.js makes this fail.
{
  reset();
  const realSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    const e = new Error('exceeded the quota');
    e.name = 'QuotaExceededError';
    throw e;
  };
  const changed = mergeCloud([{ id: 'srv_q', slug: 'quota-map', name: 'Quota Map' }], null);
  ok(changed === true, 'quota: merge with dead storage still reports the change');
  const row = findBySlug('quota-map');
  ok(!!row && row.id === 'srv_q', 'quota: row written under QuotaExceededError is readable in-session');
  globalThis.localStorage.setItem = realSetItem;
}

console.log(`\nprojects (mapkeys store): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
