// First coverage for the CRUD + slug core of project-store.js — the untested other half of the
// module (the sibling project-store.test.mjs locks mergeCloudRows; this locks the create/rename/
// trash/restore + slug-uniqueness logic Johnny + his editors hit on EVERY project action).
//
// Load-bearing properties locked here:
//   • ensureUniqueSlug appends -2/-3… on collision, prefixes a RESERVED routing slug with -1, and —
//     the non-obvious one — honors excludeId so a RENAME keeps its own slug instead of self-colliding
//     into "…-2". Drop the excludeId filter and rename-to-same-title silently bumps the slug (breaking
//     the doc permalink); this test goes RED on exactly that mutation.
//   • createProject degrades to a device-local `local_`-id row when the cloud is unreachable — the
//     real path for an editor on a flaky connection (and for Johnny in the field). It must still land
//     in the index with a collision-free slug.
//   • trash/restore move a row between the active and trashed lists and toggle trashedAt.
//
// Run: bun scripts-library/src/project-store-crud.test.mjs

// ── minimal shims (module reads bare globals) ───────────────────────────────────
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => _store.clear(),
};
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
// Force the OFFLINE path: every cloud call rejects, so apiCreate/apiPatch hit their try/catch and
// return null. createProject then falls back to a local_ id; rename/trash/restore keep the optimistic
// local write and never fire reconcileCloudRow. This is the exact behavior on a dead connection.
globalThis.fetch = () => Promise.reject(new Error('offline'));

const {
  INDEX_KEY, ensureUniqueSlug, createProject, renameProject, trashProject, restoreProject,
  findBySlug, findById, activeProjects, trashedProjects, readIndex,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
function reset() { _store.clear(); }
function seedRows(rows) { localStorage.setItem(INDEX_KEY, JSON.stringify(rows)); }

// ── ensureUniqueSlug: uniqueness, collision suffixing, reserved-slug guard ───────
{
  reset();
  eq(ensureUniqueSlug('alpha'), 'alpha', 'unique: free slug returned as-is');

  seedRows([{ id: 'a', slug: 'alpha' }]);
  eq(ensureUniqueSlug('alpha'), 'alpha-2', 'collision: first dupe → -2');

  seedRows([{ id: 'a', slug: 'alpha' }, { id: 'b', slug: 'alpha-2' }]);
  eq(ensureUniqueSlug('alpha'), 'alpha-3', 'collision: second dupe → -3 (walks the suffix)');

  reset();
  eq(ensureUniqueSlug('library'), 'library-1', 'reserved: routing keyword prefixed with -1');
  eq(ensureUniqueSlug('trash'), 'trash-1', 'reserved: trash → trash-1');
  eq(ensureUniqueSlug(''), 'untitled', 'empty base → untitled');
}

// ── ensureUniqueSlug excludeId: a RENAME keeps its own slug (does NOT self-collide) ──
{
  reset();
  seedRows([{ id: 'self', slug: 'alpha' }, { id: 'other', slug: 'beta' }]);
  // Re-slugging 'alpha' while excluding its OWN row must return 'alpha', not 'alpha-2'.
  eq(ensureUniqueSlug('alpha', 'self'), 'alpha', 'excludeId: renamed row keeps its own slug');
  // But excluding a DIFFERENT row still sees the collision.
  eq(ensureUniqueSlug('alpha', 'other'), 'alpha-2', 'excludeId: a foreign collision still bumps');
}

// ── createProject: offline → device-local row, collision-free slug, lands in index ──
{
  reset();
  const p1 = await createProject('My First Script');
  ok(p1 && String(p1.id).startsWith('local_'), 'createProject: offline row gets a local_ id');
  eq(p1.slug, 'my-first-script', 'createProject: slug generated from title');
  eq(p1.trashedAt, null, 'createProject: new row is active (not trashed)');
  eq(readIndex().length, 1, 'createProject: row persisted to the index');

  const p2 = await createProject('My First Script'); // same title → slug must not duplicate
  eq(p2.slug, 'my-first-script-2', 'createProject: duplicate title gets a unique slug');
  eq(activeProjects().length, 2, 'createProject: both projects active');

  eq(findBySlug('my-first-script').id, p1.id, 'findBySlug: resolves the first row');
  eq(findById(p2.id).slug, 'my-first-script-2', 'findById: resolves the second row');
  eq(findBySlug('does-not-exist'), null, 'findBySlug: miss → null');
}

// ── renameProject: retitle + re-slug; rename-to-same keeps slug (excludeId in action) ──
{
  reset();
  const p = await createProject('Draft One');
  eq(p.slug, 'draft-one', 'setup: initial slug');

  const r1 = renameProject(p.id, 'Draft Two');
  eq(r1.title, 'Draft Two', 'rename: title updated');
  eq(r1.slug, 'draft-two', 'rename: slug regenerated');

  // Rename to the SAME title again: excludeId must prevent a self-collision bump.
  const r2 = renameProject(p.id, 'Draft Two');
  eq(r2.slug, 'draft-two', 'rename-to-same: slug stays draft-two (NOT draft-two-2)');

  // Empty/whitespace title is ignored (no clobber of title or slug).
  const r3 = renameProject(p.id, '   ');
  eq(r3.title, 'Draft Two', 'rename: blank title ignored (title kept)');
  eq(r3.slug, 'draft-two', 'rename: blank title ignored (slug kept)');

  eq(renameProject('no-such-id', 'X'), null, 'rename: unknown id → null');
}

// ── trash / restore: row moves between the active and trashed lists ─────────────
{
  reset();
  const p = await createProject('Trashable');
  ok(activeProjects().some((r) => r.id === p.id), 'setup: starts active');

  const t = trashProject(p.id);
  ok(t.trashedAt, 'trash: trashedAt stamped');
  ok(!activeProjects().some((r) => r.id === p.id), 'trash: gone from active');
  ok(trashedProjects().some((r) => r.id === p.id), 'trash: present in trash');

  const r = restoreProject(p.id);
  eq(r.trashedAt, null, 'restore: trashedAt cleared');
  ok(activeProjects().some((r2) => r2.id === p.id), 'restore: back in active');
  ok(!trashedProjects().some((r2) => r2.id === p.id), 'restore: gone from trash');
}

console.log(fail === 0 ? `PASS — all ${pass} project-store CRUD cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
