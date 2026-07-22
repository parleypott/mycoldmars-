// SLUG DRIFT FIX — the client half (project-store.js): renameProject now syncs the slug to the cloud,
// and healSlugDrift reconciles legacy drift on a signed-in open.
//
// Why this matters: guest ?slug= links resolve via the CLOUD slug and teammates refresh their slug from
// the cloud list. renameProject used to PATCH only the title, so the cloud slug went stale — the
// renamer's own browser looked fine (local index + URL carried the new slug) while shared links broke.
//
// Locked here (fetch + storage mocked; the module reads bare globals):
//   • RENAME CONTRACT: renameProject PATCHes BOTH title and the regenerated slug.
//   • RENAME COLLISION (409): the cache reverts to the OLD slug (both sides stay consistent), still
//     lands the title via a title-only retry, and fires SLUG_CONFLICT_EVENT.
//   • DRIFT-HEAL CONTRACT: local == cloud → insync; local ≠ cloud & pushable → push local up;
//     push rejected (409) → adopt the cloud slug locally; ONE attempt per project per session;
//     offline (no cloud list) does NOT burn the one attempt.
//
// Run: bun scripts-library/src/project-store-slug-sync.test.mjs

// ── storage + window shims ──────────────────────────────────────────────────────
function mapStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}
globalThis.localStorage = mapStore();
globalThis.sessionStorage = mapStore();
const events = [];
globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
globalThis.CustomEvent = class { constructor(t, opts) { this.type = t; this.detail = opts && opts.detail; } };

// ── programmable fetch (fake /api/script-projects) ──────────────────────────────
let listActive = [];       // rows a GET list answers with; set to null to simulate OFFLINE (non-ok)
const patchQueue = [];     // sequence of PATCH responses: { status, project? }
const patchCalls = [];     // recorded PATCH bodies
function jsonRes(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const u = String(url);
  if (u.includes('/api/script-projects') && method === 'GET') {
    if (u.includes('trashed=1')) return jsonRes({ projects: [] });   // heal reads the ACTIVE list only
    if (listActive == null) return jsonRes({}, 500);                 // offline → apiList returns null
    return jsonRes({ projects: listActive });
  }
  if (u.includes('/api/script-projects') && method === 'PATCH') {
    patchCalls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
    const next = patchQueue.length ? patchQueue.shift() : { status: 200, project: null };
    if (next.status >= 400) return jsonRes({ error: { code: 'SLUG_TAKEN', message: 'slug taken' } }, next.status);
    return jsonRes({ project: next.project ?? null }, next.status);
  }
  return jsonRes({}, 404);
};

const {
  INDEX_KEY, renameProject, healSlugDrift, findById, SLUG_CONFLICT_EVENT,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);
const flush = async () => { await new Promise((r) => setTimeout(r, 10)); await new Promise((r) => setTimeout(r, 10)); };

function reset() {
  localStorage.clear(); sessionStorage.clear();
  events.length = 0; patchCalls.length = 0; patchQueue.length = 0; listActive = [];
}
function seed(rows) { localStorage.setItem(INDEX_KEY, JSON.stringify(rows)); }

/* ── 1. RENAME syncs title + slug ───────────────────────────────────────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'old-title', title: 'Old Title' }]);
  patchQueue.push({ status: 200, project: { id: 'c1', slug: 'new-title', title: 'New Title' } });

  const r = renameProject('p1', 'New Title');
  eq(r.slug, 'new-title', 'rename: local slug regenerated optimistically');
  await flush();

  const dbPatch = patchCalls[0];
  ok(dbPatch, 'rename: a cloud PATCH was fired');
  eq(dbPatch.body.title, 'New Title', 'rename: PATCH carries the new title');
  eq(dbPatch.body.slug, 'new-title', 'rename: PATCH carries the new slug (THE FIX)');
  eq(findById('p1').slug, 'new-title', 'rename: cache holds the new slug');
}

/* ── 2. RENAME collision (409) → revert slug, keep title, fire conflict event ── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'old', title: 'Old' }]);
  patchQueue.push({ status: 409 });                                             // slug+title PATCH collides
  patchQueue.push({ status: 200, project: { id: 'c1', slug: 'old', title: 'New Name' } }); // title-only retry

  renameProject('p1', 'New Name');   // generateSlug → 'new-name'
  await flush();

  eq(findById('p1').slug, 'old', 'collision: local slug reverted to the previous one (no drift)');
  eq(findById('p1').title, 'New Name', 'collision: title still applied (rename not lost)');
  eq(patchCalls.length, 2, 'collision: exactly two PATCHes (combined, then title-only retry)');
  ok(patchCalls[0].body.slug === 'new-name' && patchCalls[0].body.title === 'New Name', 'collision: first PATCH was title+slug');
  ok(!('slug' in patchCalls[1].body) && patchCalls[1].body.title === 'New Name', 'collision: retry PATCH is title-only');
  const conflict = events.find((e) => e.type === SLUG_CONFLICT_EVENT);
  ok(conflict && conflict.detail.slug === 'new-name', 'collision: SLUG_CONFLICT_EVENT fired with the refused slug');
}

/* ── 3. HEAL: local == cloud → insync, no PATCH ─────────────────────────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile-river', title: 'Nile' }]);
  listActive = [{ id: 'c1', slug: 'nile-river', title: 'Nile' }];
  const res = await healSlugDrift(findById('p1'));
  eq(res.action, 'insync', 'heal: matching slugs → insync');
  eq(patchCalls.length, 0, 'heal: insync fires no PATCH');
}

/* ── 4. HEAL: local ≠ cloud & pushable → push local slug up ──────────────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile-river', title: 'Nile' }]);
  listActive = [{ id: 'c1', slug: 'untitled-script-5', title: 'Nile' }];       // cloud slug is stale (pre-fix rename)
  patchQueue.push({ status: 200, project: { id: 'c1', slug: 'nile-river', title: 'Nile' } });

  const res = await healSlugDrift(findById('p1'));
  eq(res.action, 'pushed', 'heal: local≠cloud pushable → pushed');
  eq(res.slug, 'nile-river', 'heal: pushed the local slug');
  eq(patchCalls.length, 1, 'heal: one slug PATCH');
  eq(patchCalls[0].body.slug, 'nile-river', 'heal: PATCH carries the local slug');
  ok(!('title' in patchCalls[0].body), 'heal: push is slug-only (title untouched)');
  eq(findById('p1').slug, 'nile-river', 'heal: cache keeps the local slug');
}

/* ── 5. HEAL: push rejected (409) → adopt the cloud slug locally ─────────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile-river', title: 'Nile' }]);
  listActive = [{ id: 'c1', slug: 'taken-elsewhere', title: 'Nile' }];
  patchQueue.push({ status: 409 });                                            // local slug is taken in the cloud

  const res = await healSlugDrift(findById('p1'));
  eq(res.action, 'adopted', 'heal: push 409 → adopt cloud slug');
  eq(res.slug, 'taken-elsewhere', 'heal: adopted the cloud slug');
  eq(findById('p1').slug, 'taken-elsewhere', 'heal: cache now holds the cloud slug (never wedges)');
}

/* ── 6. HEAL: one attempt per session (a second call is a no-op skip) ────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'aaa', title: 'A' }]);
  listActive = [{ id: 'c1', slug: 'bbb', title: 'A' }];
  patchQueue.push({ status: 409 });                                            // first attempt adopts 'bbb', marks c1
  const first = await healSlugDrift(findById('p1'));
  eq(first.action, 'adopted', 'heal: first attempt acts');
  const second = await healSlugDrift(findById('p1'));
  eq(second.action, 'skip', 'heal: second attempt this session is skipped (marked)');
}

/* ── 7. HEAL: offline (no cloud list) does NOT burn the one attempt ──────────── */
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile-river', title: 'Nile' }]);
  listActive = null;                                                           // offline
  const off = await healSlugDrift(findById('p1'));
  eq(off.action, 'skip', 'heal: offline → skip');

  // now the cloud is reachable and drifted — the attempt was NOT consumed, so heal proceeds
  listActive = [{ id: 'c1', slug: 'untitled-script-9', title: 'Nile' }];
  patchQueue.push({ status: 200, project: { id: 'c1', slug: 'nile-river', title: 'Nile' } });
  const on = await healSlugDrift(findById('p1'));
  eq(on.action, 'pushed', 'heal: offline attempt was not burned — later heal still runs');
}

/* ── 8. HEAL: local-only project (no cloudId) is a no-op ─────────────────────── */
{
  reset();
  seed([{ id: 'local_x', slug: 'draft', title: 'Draft' }]);                    // no cloudId
  const res = await healSlugDrift(findById('local_x'));
  eq(res.action, 'skip', 'heal: local-only project → skip (nothing to drift against)');
  eq(patchCalls.length, 0, 'heal: local-only fires no network');
}

console.log(fail === 0 ? `PASS — all ${pass} slug-sync cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
