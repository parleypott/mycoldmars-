/**
 * Tests for the CLOUD SYNC client layer (cloud-follow-me) — src/cloud-sync.js.
 *
 * Johnny's exact fear: an empty or older or unreachable cloud copy silently STOMPS good local work.
 * These tests prove that is structurally impossible, and that cloud only wins when it is strictly
 * newer AND only after the local doc is snapshotted to a .conflict.<ts> recovery key.
 *
 *   (a) an empty / older / DOWN cloud response can NEVER replace a newer (or any) local doc.
 *   (b) cloud wins ONLY when strictly newer, and ONLY after a conflict snapshot is taken.
 *   (c) a stale PUT (409) reconciles without losing local edits.
 *
 * decideReconcile is a PURE function — tested directly with plain values, no browser/network.
 * reconcileOnLoad is tested with injected deps (fetchCloud / saveDoc / primeVersionFloor / snapshot).
 *
 * Run: bun src/cloud-sync.test.mjs   (auto-discovered by `bun run test`)
 */

// minimal browser shims so the module's CustomEvent / window references load under bun.
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

const { decideReconcile, reconcileOnLoad, bootstrapFromCloud, fetchCloud, pushDoc } = await import('./cloud-sync.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });

/* ───────────────────────── (a) empty / older / DOWN cloud can never replace local ──────────── */

// cloud EMPTY (ok, doc:null, version 0) + local exists -> keep local, push up.
{
  const d = decideReconcile({ localVersion: 5, hasLocalDoc: true, cloud: { ok: true, doc: null, version: 0 } });
  eq(d.action, 'keep-local', 'a1. empty cloud + local present -> keep-local');
  ok(d.push === true, 'a1b. keep-local pushes local up');
}
// cloud OLDER (version 2 < local 5) -> keep local.
{
  const d = decideReconcile({ localVersion: 5, hasLocalDoc: true, cloud: { ok: true, doc: DOC('old'), version: 2 } });
  eq(d.action, 'keep-local', 'a2. older cloud -> keep-local (never adopt)');
}
// cloud EQUAL (version 5 === local 5) -> keep local (strictly-newer rule; ties keep local).
{
  const d = decideReconcile({ localVersion: 5, hasLocalDoc: true, cloud: { ok: true, doc: DOC('same'), version: 5 } });
  eq(d.action, 'keep-local', 'a3. equal-version cloud -> keep-local (only STRICTLY newer wins)');
}
// cloud DOWN / table missing / malformed (ok:false) + local exists -> keep local, push up.
{
  const d = decideReconcile({ localVersion: 5, hasLocalDoc: true, cloud: { ok: false } });
  eq(d.action, 'keep-local', 'a4. cloud DOWN/unknown -> keep-local');
  ok(d.push === true, 'a4b. and still pushes local up so cloud catches up later');
}
// cloud DOWN + NO local doc -> noop (nothing anywhere; do not invent a doc).
{
  const d = decideReconcile({ localVersion: 0, hasLocalDoc: false, cloud: { ok: false } });
  eq(d.action, 'noop', 'a5. cloud down + no local -> noop');
}
// even a cloud that claims a HUGE version but ok:false (e.g. malformed) cannot win.
{
  const d = decideReconcile({ localVersion: 1, hasLocalDoc: true, cloud: { ok: false, version: 9999 } });
  eq(d.action, 'keep-local', 'a6. malformed cloud (ok:false) with big version is ignored');
}

/* ───────────────────────── (b) cloud wins only when strictly newer + snapshot first ────────── */

// no local doc + cloud has one -> seed from cloud (fresh device / wiped laptop).
{
  const d = decideReconcile({ localVersion: 0, hasLocalDoc: false, cloud: { ok: true, doc: DOC('cloud'), version: 7 } });
  eq(d.action, 'seed-from-cloud', 'b1. no local + cloud has doc -> seed-from-cloud');
  eq(d.version, 7, 'b1b. seeds at cloud version');
}
// cloud strictly newer than local -> adopt, with snapshotLocal flag set.
{
  const d = decideReconcile({ localVersion: 3, hasLocalDoc: true, cloud: { ok: true, doc: DOC('newer'), version: 9 } });
  eq(d.action, 'adopt-cloud', 'b2. strictly-newer cloud -> adopt-cloud');
  ok(d.snapshotLocal === true, 'b2b. adopt REQUIRES a local snapshot first');
  eq(d.version, 9, 'b2c. adopts cloud version');
}
// cloud newer but doc null (shouldn't happen, but guard it) -> keep local (never adopt a null doc).
{
  const d = decideReconcile({ localVersion: 3, hasLocalDoc: true, cloud: { ok: true, doc: null, version: 99 } });
  eq(d.action, 'keep-local', 'b3. newer-version but null doc -> keep-local (never adopt nothing)');
}

/* ───────────────────────── reconcileOnLoad orchestration (with injected deps) ──────────────── */

// helper: build deps that record what happened
function makeDeps({ local, cloud }) {
  const calls = { saved: [], primed: [], snapshots: 0 };
  return {
    deps: {
      readLocal: () => local,
      fetchCloud: async () => cloud,
      saveDoc: (doc) => { calls.saved.push(doc); return { ok: true, version: 0 }; },
      primeVersionFloor: (v) => { calls.primed.push(v); },
      snapshotConflict: () => { calls.snapshots++; return 'wp01_burma_doc_v1.conflict.123'; },
    },
    calls,
  };
}

// ADOPT path: cloud newer -> snapshot BEFORE save, prime to cloud version, write cloud doc, reload.
{
  const { deps, calls } = makeDeps({
    local: { hasDoc: true, version: 2, doc: DOC('local-older') },
    cloud: { ok: true, doc: DOC('cloud-newer'), version: 8 },
  });
  const r = await reconcileOnLoad(deps);
  eq(r.action, 'adopt-cloud', 'c1. reconcile adopts strictly-newer cloud');
  eq(calls.snapshots, 1, 'c1b. local was snapshotted to .conflict BEFORE adopt');
  eq(calls.primed[0], 8, 'c1c. version floor primed to cloud version (so next push isn\'t stale)');
  eq(calls.saved.length, 1, 'c1d. cloud doc written through canonical saveDoc');
  eq(JSON.stringify(calls.saved[0]), JSON.stringify(DOC('cloud-newer')), 'c1e. the CLOUD doc is what got saved');
  ok(r.shouldReload === true, 'c1f. signals reload so the editor re-seeds from adopted doc');
}

// KEEP-LOCAL path: cloud DOWN -> never snapshot, never save, just push local. No reload.
{
  const { deps, calls } = makeDeps({
    local: { hasDoc: true, version: 4, doc: DOC('local-good') },
    cloud: { ok: false },
  });
  const r = await reconcileOnLoad(deps);
  eq(r.action, 'keep-local', 'c2. cloud down -> keep-local');
  eq(calls.snapshots, 0, 'c2b. NO snapshot taken (local untouched)');
  eq(calls.saved.length, 0, 'c2c. NO save called (local doc never overwritten)');
  ok(r.shouldReload === false, 'c2d. no reload — local stays as-is');
}

// KEEP-LOCAL path: cloud EMPTY -> push local up, never overwrite local.
{
  const { deps, calls } = makeDeps({
    local: { hasDoc: true, version: 6, doc: DOC('local-only') },
    cloud: { ok: true, doc: null, version: 0 },
  });
  const r = await reconcileOnLoad(deps);
  eq(r.action, 'keep-local', 'c3. empty cloud -> keep-local');
  eq(calls.saved.length, 0, 'c3b. empty cloud cannot trigger a local overwrite');
}

// SEED path: fresh device (no local) + cloud has doc -> save cloud doc, prime, reload.
{
  const { deps, calls } = makeDeps({
    local: { hasDoc: false, version: 0, doc: null },
    cloud: { ok: true, doc: DOC('from-cloud'), version: 3 },
  });
  const r = await reconcileOnLoad(deps);
  eq(r.action, 'seed-from-cloud', 'c4. fresh device seeds from cloud');
  eq(calls.snapshots, 0, 'c4b. nothing local to snapshot on a fresh seed');
  eq(calls.saved.length, 1, 'c4c. cloud doc written locally');
  ok(r.shouldReload === true, 'c4d. reload to re-seed');
}

/* ───────────────────────── (c) a stale PUT (409) reconciles without losing local edits ─────── */

// pushDoc gets a 409 from the API -> returns { stale, doc, version } and does NOT throw / clobber.
{
  const fake = async (url, init) => ({
    ok: false,
    status: 409,
    json: async () => ({ error: { code: 'STALE' }, doc: DOC('cloud-ahead'), version: 12 }),
  });
  const res = await pushDoc(DOC('my-local'), 5, fake);
  ok(res.ok === false && res.stale === true, 'c5. 409 -> stale result, not a hard failure');
  eq(res.version, 12, 'c5b. surfaces the current cloud version for the client to reconcile to');
  eq(JSON.stringify(res.doc), JSON.stringify(DOC('cloud-ahead')), 'c5c. hands back the newer cloud doc');
  // Now feed that 409 outcome back through the decision: cloud(12) > local(5) -> adopt + snapshot.
  const d = decideReconcile({ localVersion: 5, hasLocalDoc: true, cloud: { ok: true, doc: res.doc, version: res.version } });
  eq(d.action, 'adopt-cloud', 'c5d. the 409\'s cloud doc reconciles via adopt-cloud on next load');
  ok(d.snapshotLocal === true, 'c5e. and STILL snapshots local first — no edits lost');
}

// pushDoc to a DOWN api (network throw) -> offline result, never throws.
{
  const boom = async () => { throw new Error('network down'); };
  const res = await pushDoc(DOC('x'), 5, boom);
  ok(res.ok === false && res.offline === true, 'c6. push to down API -> offline, no throw');
}

// pushDoc with version 0 (nothing meaningful yet) -> skipped, no network call.
{
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const res = await pushDoc(DOC('x'), 0, spy);
  ok(res.skipped === true && called === false, 'c7. version 0 push is a no-op (no network)');
}

/* ───────────────────────── fetchCloud graceful degradation ─────────────────────────────────── */

// table missing -> API returns 500/NO_DB error shape -> fetchCloud reports ok:false (-> keep local).
{
  const fake = async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'NO_DB' } }) });
  const c = await fetchCloud(fake);
  ok(c.ok === false, 'c8. NO_DB / table-missing -> fetchCloud ok:false (graceful, keeps local)');
}
// clean empty cloud -> ok:true, doc:null, version 0.
{
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ doc: null, version: 0 }) });
  const c = await fetchCloud(fake);
  ok(c.ok === true && c.doc === null && c.version === 0, 'c9. empty cloud parsed as ok/null/0');
}

/* ───────────────────────── bootstrapFromCloud — cold-start, AWAIT BEFORE PAINT ───────────────────
 * The reported bug: a fresh/incognito browser showed the bundled SOURCE script, not the cloud copy,
 * because main.jsx rendered the editor (seeding from source) BEFORE the async reconcile could swap in
 * the cloud doc. bootstrapFromCloud is the fix: on a no-local-doc device, main.jsx AWAITS this BEFORE
 * render(), so the cloud doc is written locally first and the editor seeds it on the first paint.
 */

// helper: bootstrap deps that record what happened. saveDoc returns ok:true by default.
function makeBootstrapDeps({ cloud, saveOk = true, saveReason }) {
  const calls = { saved: [], primed: [] };
  return {
    deps: {
      fetchCloud: async () => cloud,
      primeVersionFloor: (v) => { calls.primed.push(v); },
      saveDoc: (doc) => { calls.saved.push(doc); return { ok: saveOk, reason: saveReason, version: 0 }; },
    },
    calls,
  };
}

// (a) no-local-doc + cloud HAS a doc -> SEED cloud before render: primeVersionFloor + saveDoc(cloud).
{
  const { deps, calls } = makeBootstrapDeps({ cloud: { ok: true, doc: DOC('johnnys-real-script'), version: 429 } });
  const r = await bootstrapFromCloud(deps);
  ok(r.seeded === true, 'd1. fresh device + cloud has doc -> seeded:true (paints cloud, not source)');
  eq(r.version, 429, 'd1b. seeded at the cloud version');
  eq(calls.primed[0], 429, 'd1c. primeVersionFloor called with cloud version BEFORE the write');
  eq(calls.saved.length, 1, 'd1d. cloud doc written through canonical saveDoc');
  eq(JSON.stringify(calls.saved[0]), JSON.stringify(DOC('johnnys-real-script')), 'd1e. the CLOUD doc is what got saved (not source)');
}

// (b) no-local-doc + cloud EMPTY -> fall back to source: no prime, no save, seeded:false (no stomp).
{
  const { deps, calls } = makeBootstrapDeps({ cloud: { ok: true, doc: null, version: 0 } });
  const r = await bootstrapFromCloud(deps);
  ok(r.seeded === false, 'd2. fresh device + empty cloud -> seeded:false (render from source)');
  eq(calls.saved.length, 0, 'd2b. empty cloud writes NOTHING locally');
  eq(calls.primed.length, 0, 'd2c. empty cloud primes NOTHING');
}

// (b cont.) no-local-doc + cloud UNREACHABLE (ok:false) -> fall back to source, no write.
{
  const { deps, calls } = makeBootstrapDeps({ cloud: { ok: false } });
  const r = await bootstrapFromCloud(deps);
  ok(r.seeded === false, 'd3. fresh device + cloud down -> seeded:false (graceful, render source)');
  eq(calls.saved.length, 0, 'd3b. unreachable cloud writes nothing');
}

// (b cont.) no-local-doc + cloud TABLE MISSING (ok:false, big version) -> still source, never seeds.
{
  const { deps, calls } = makeBootstrapDeps({ cloud: { ok: false, version: 9999 } });
  const r = await bootstrapFromCloud(deps);
  ok(r.seeded === false, 'd4. table-missing cloud (ok:false) cannot seed even with a big version');
  eq(calls.saved.length, 0, 'd4b. no local write on a malformed/unreachable cloud');
}

// (a edge) cloud has a doc but the local WRITE fails (quota/blocked) -> seeded:false, fall to source.
{
  const { deps, calls } = makeBootstrapDeps({ cloud: { ok: true, doc: DOC('cloud'), version: 5 }, saveOk: false, saveReason: 'quota' });
  const r = await bootstrapFromCloud(deps);
  ok(r.seeded === false, 'd5. cloud doc present but save refused -> seeded:false (source fallback, loud)');
  eq(calls.saved.length, 1, 'd5b. the write was ATTEMPTED through saveDoc (which fires its own banner)');
}

/* ───────────────────────── (c)/(d) has-local-doc reconcile — adopt vs keep, conflict-guard proof ──
 * These re-verify with a REAL (non-stub) saveDoc + primeVersionFloor + the cross-tab conflict guard
 * imported from migrate-doc.js, proving the adopt-cloud write is NOT refused by the guard when the
 * version floor is primed first. This is the path that, if it returned ok:false, would leave stale
 * local on screen with no reload — exactly the silent-stale failure we hardened against.
 */
{
  // A localStorage shim so the real migrate-doc.js machinery runs under bun.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };

  const LS_DOC = 'wp01_burma_doc_v1';
  const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
  const md = await import('./migrate-doc.js');

  // (c) has-local-doc + cloud STRICTLY NEWER -> snapshot + prime + saveDoc SUCCEEDS (not refused),
  //     and reconcile signals reload. Simulate a tab that seeded a local doc at version 3.
  {
    store.clear();
    store.set(LS_DOC, JSON.stringify(DOC('local-v3')));
    store.set(LS_DOC_VER, '3|tab_seed');
    md.syncBaseVersion(); // adopt on-disk v3 as this tab's base (what seedDoc does on load)
    eq(md.getKnownBaseVersion(), 3, 'd6pre. base adopted as on-disk v3');

    let snapped = 0;
    const r = await reconcileOnLoad({
      readLocal: () => ({ hasDoc: true, version: 3, doc: DOC('local-v3') }),
      fetchCloud: async () => ({ ok: true, doc: DOC('cloud-v10'), version: 10 }),
      saveDoc: md.saveDoc,
      primeVersionFloor: md.primeVersionFloor,
      snapshotConflict: () => { snapped++; return LS_DOC + '.conflict.1'; },
    });
    eq(r.action, 'adopt-cloud', 'd6. cloud strictly newer -> adopt-cloud');
    eq(snapped, 1, 'd6b. local snapshotted BEFORE adopt');
    ok(r.wrote === true, 'd6c. the adopt write SUCCEEDED — NOT refused by the cross-tab conflict guard');
    ok(r.shouldReload === true, 'd6d. signals reload so the editor re-seeds the adopted cloud doc');
    eq(JSON.stringify(JSON.parse(store.get(LS_DOC))), JSON.stringify(DOC('cloud-v10')), 'd6e. cloud doc is now the on-disk doc');
    ok(md.getKnownBaseVersion() === 11, 'd6f. version stamped to cloud+1 (=11) — next push is accepted, not stale');
  }

  // (d) has-local-doc + cloud OLDER/EMPTY -> keep local, push up, NEVER overwrite local. No reload.
  {
    store.clear();
    store.set(LS_DOC, JSON.stringify(DOC('local-good-v7')));
    store.set(LS_DOC_VER, '7|tab_seed');
    md.syncBaseVersion();

    const r = await reconcileOnLoad({
      readLocal: () => ({ hasDoc: true, version: 7, doc: DOC('local-good-v7') }),
      fetchCloud: async () => ({ ok: true, doc: DOC('cloud-old'), version: 2 }),
      saveDoc: md.saveDoc,
      primeVersionFloor: md.primeVersionFloor,
      snapshotConflict: () => LS_DOC + '.conflict.x',
    });
    eq(r.action, 'keep-local', 'd7. older cloud -> keep-local');
    ok(r.shouldReload !== true, 'd7b. no reload — local stays on screen');
    eq(JSON.stringify(JSON.parse(store.get(LS_DOC))), JSON.stringify(DOC('local-good-v7')), 'd7c. local doc NEVER overwritten by an older cloud');
  }

  delete globalThis.localStorage;
}

console.log(`\ncloud-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
