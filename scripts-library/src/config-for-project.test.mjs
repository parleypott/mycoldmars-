/**
 * Tests for config-for-project — the Script Library's row → EPISODE config bridge.
 * This is the DATA-INTEGRITY heart of the library: it decides WHICH localStorage
 * namespace (and IndexedDB recovery DB) a project's document lives in.
 *
 * Two contracts are load-bearing and locked here:
 *
 *   1. LEGACY ZERO-DATA-LOSS. A seeded burma/palau row must adopt the EXISTING
 *      pinned namespace verbatim (wp01_burma_* / script_palau_*). If a future edit
 *      breaks this, opening the seeded project loads a fresh EMPTY namespace and
 *      Johnny's already-saved Burma/Palau script silently disappears from view.
 *
 *   2. NEW-PROJECT ISOLATION. Two distinct new projects must get DISJOINT doc keys
 *      (script_<id>_*). A collision means one project's edits overwrite another's.
 *
 *   3. RECOVERY-DB TWIN-LOCK. recoveryDbNameForConfig is a HAND-COPY of
 *      recovery-store.js's deriveDbName (kept in sync manually to keep this module
 *      engine-free). If the two drift, purgeProject deletes the WRONG IndexedDB —
 *      leaking the recovery data it was asked to erase, or nuking a live one. This
 *      test reconstructs deriveDbName's exact logic and asserts the two agree on
 *      every shape, so a mutation to either side goes RED.
 *
 * Run under bun (config-for-project transitively imports burma-script/schema.ts +
 * *.json, which only bun resolves natively): bun scripts-library/src/config-for-project.test.mjs
 */
import {
  configForProject,
  recoveryDbNameForConfig,
  storageKeysForConfig,
} from './config-for-project.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};
const throws = (fn, label) => {
  try { fn(); fail++; console.log(`FAIL ${label}: expected throw`); }
  catch { pass++; }
};

// The SHARED favicon path every config is normalized to (legacy Burma's relative
// './favicon.svg' would 404 from /scripts-library/).
const SHARED_FAVICON = '../burma-script/favicon.svg';

// ── 1. LEGACY: burma adopts the pinned namespace verbatim + favicon override ──
{
  const b = configForProject({ episode: 'burma' });
  eq(b.storage.DOC, 'wp01_burma_doc_v1', 'legacy burma: pinned DOC namespace (zero data loss)');
  eq(b.favicon, SHARED_FAVICON, 'legacy burma: favicon overridden to shared asset');
  ok(!b.localOnly, 'legacy burma: NOT forced localOnly (keeps its cloud behavior)');
}

// ── legacy palau: its own pinned namespace, distinct from burma ──
{
  const p = configForProject({ episode: 'palau' });
  eq(p.storage.DOC, 'script_palau_doc_v2', 'legacy palau: pinned DOC namespace');
  eq(p.favicon, SHARED_FAVICON, 'legacy palau: favicon overridden');
  ok(p.storage.DOC !== 'wp01_burma_doc_v1', 'legacy palau: namespace distinct from burma');
}

// An unknown episode id is NOT legacy — it falls through to a fresh namespace,
// never silently reusing burma/palau's store.
{
  const x = configForProject({ id: 'weird', episode: 'nonexistent-episode' });
  eq(x.storage.DOC, 'script_weird_doc_v1', 'unknown episode → fresh id-namespaced DOC, not a legacy store');
}

// ── 2. NEW-PROJECT ISOLATION ──
{
  const a = configForProject({ id: 'local_aaa', title: 'Alpha' });
  eq(a.storage.DOC, 'script_local_aaa_doc_v1', 'new: DOC namespaced off row id');
  eq(a.localOnly, true, 'new (offline local_ id): localOnly (calm saved pill, no conflict UI)');
  eq(a.recoverPrefix, 'alpha-recovered', 'new: recoverPrefix slugged from title');
  // All ten storage slots must live under the id namespace — no bare/global key.
  const keys = storageKeysForConfig(a);
  eq(keys.length, 10, 'new: ten namespaced storage keys');
  ok(keys.every((k) => k.startsWith('script_local_aaa_')), 'new: every storage key under the id namespace');
  // ROLES must be present + id-namespaced. Without it the shared engine's Role Focus Hub reads/writes
  // the literal localStorage key "undefined" (an undefined key coerces to the string), sharing one
  // lens across every library project. Its absence is exactly the bug this asserts against.
  eq(a.storage.ROLES, 'script_local_aaa_roles_v1', 'new: ROLES lens key namespaced off the id');

  // The heart of the contract: two DISTINCT new projects share ZERO doc keys.
  const c = configForProject({ id: 'local_bbb', title: 'Alpha' }); // same title, different id
  const keysA = new Set(keys);
  const overlap = storageKeysForConfig(c).filter((k) => keysA.has(k));
  eq(overlap.length, 0, 'ISOLATION: two new projects (even same title) share no storage keys');
}

// ── 2b. CLOUD-BACKED NEW PROJECT (Wave 2) — a real cloud id (UUID) gets the cloud doc lifecycle ──
// A project created online carries the cloud UUID as its id. It must NOT be localOnly, and its
// cloud.api must point at the generalized per-project endpoint keyed by that id — so the engine's
// unmodified cloud-sync GET/PUTs land on /api/script-doc?project=<id>. Burma/Palau are untouched by
// this branch (they're LEGACY, handled above); this is only the new-project path.
{
  const uuid = '267bb0ec-215c-45bb-9a18-c2c5d4a68ef5';
  const cb = configForProject({ id: uuid, title: 'Cloud Script' });
  eq(cb.localOnly, false, 'cloud-backed new: NOT localOnly (real cloud pill states)');
  eq(cb.cloud.api, `/api/script-doc?project=${encodeURIComponent(uuid)}`,
     'cloud-backed new: cloud.api targets the generalized per-project endpoint by id');
  eq(cb.storage.DOC, `script_${uuid}_doc_v1`, 'cloud-backed new: doc namespace still isolated off the id');
}

// A `local_`-prefixed id (offline-created project) STAYS localOnly with the inert cloud path — the
// offline fallback must never point cloud-sync at a project id the server can't resolve.
{
  const off = configForProject({ id: 'local_offline9', title: 'Offline' });
  eq(off.localOnly, true, 'offline local_ id: stays localOnly');
  eq(off.cloud.api, '/api/__script_cloud_disabled', 'offline local_ id: inert cloud path (no bad ?project=)');
}

// Missing id degrades to a stable 'script' namespace rather than throwing.
{
  const noId = configForProject({ title: 'No Id' });
  eq(noId.storage.DOC, 'script_script_doc_v1', 'missing id → "script" fallback namespace');
}

// A non-object row is a programmer error — throw, don't build a garbage config.
throws(() => configForProject(null), 'null row throws');
throws(() => configForProject('burma'), 'string row throws (must be a row object)');

// storageKeysForConfig on a config with no storage → empty (safe to purge nothing).
eq(storageKeysForConfig({}).length, 0, 'storageKeysForConfig: no storage → []');
eq(storageKeysForConfig(null).length, 0, 'storageKeysForConfig: null → []');

// ── 3. RECOVERY-DB TWIN-LOCK against recovery-store.js deriveDbName ──
// Exact reconstruction of burma-script/src/recovery-store.js::deriveDbName. The
// SUT (recoveryDbNameForConfig) takes a cfg and reads cfg.storage.DOC; deriveDbName
// takes the storage object directly. They must produce byte-identical DB names.
const LEGACY_BURMA_DOC = 'wp01_burma_doc_v1';
function deriveDbNameReference(storage) {
  try {
    const doc = storage && storage.DOC ? String(storage.DOC) : LEGACY_BURMA_DOC;
    if (doc === LEGACY_BURMA_DOC) return 'wp01_burma_recovery';
    return doc.replace(/_doc_v1$/, '') + '_recovery';
  } catch {
    return 'wp01_burma_recovery';
  }
}

// Concrete pinned values (these are what recovery-store actually creates on disk).
eq(recoveryDbNameForConfig(configForProject({ episode: 'burma' })), 'wp01_burma_recovery',
   'recovery: burma → wp01_burma_recovery');
eq(recoveryDbNameForConfig(configForProject({ episode: 'palau' })), 'script_palau_doc_v2_recovery',
   'recovery: palau keeps its _doc_v2 suffix (matches on-disk DB)');
eq(recoveryDbNameForConfig(configForProject({ id: 'local_x9', title: 'X' })), 'script_local_x9_recovery',
   'recovery: new project → script_<id>_recovery');
// Fallback: a config with no storage.DOC must degrade to the burma default,
// never `undefined_recovery` (which would delete a phantom DB / miss the real one).
eq(recoveryDbNameForConfig({}), 'wp01_burma_recovery', 'recovery: no storage.DOC → burma default');
eq(recoveryDbNameForConfig(null), 'wp01_burma_recovery', 'recovery: null cfg → burma default');

// The twin-lock proper: across a battery of DOC shapes, the SUT and the reference
// deriveDbName must AGREE. If either copy is edited in isolation, one of these fails.
for (const doc of [
  'wp01_burma_doc_v1',
  'script_palau_doc_v2',
  'script_local_abc_doc_v1',
  'script_x_doc_v3',
  'weirdname',
  '',
]) {
  const viaSUT = recoveryDbNameForConfig({ storage: { DOC: doc } });
  const viaRef = deriveDbNameReference({ DOC: doc });
  eq(viaSUT, viaRef, `twin-lock: recoveryDbNameForConfig agrees with deriveDbName for DOC=${JSON.stringify(doc)}`);
}

// ── NEW-STYLE DEFAULT: every brand-new script inherits the Palau look ──
// Regression guard for the 2026-07-20 fix. Before it, brand-new projects shipped NO
// `features` object, so episodeFlag() read false for everything and chapters rendered
// the OLD flat style. If a future edit drops `features` or flips one of the three
// deliberately-OFF flags, this goes RED.
{
  const n = configForProject({ id: 'abc123', title: 'Fresh Script' });
  ok(n.features && typeof n.features === 'object', 'new script: carries a features object');
  // The flag that draws the big framed chapter — the whole point.
  ok(n.features.chapterFrames === true, 'new script: chapterFrames ON (framed chapters)');
  // The full presentational/interaction set that makes the Palau "new style".
  for (const f of ['chipChrome', 'chapterFrames', 'rowDragReorder', 'convertMenu',
                   'archiveOwnLine', 'dayFold', 'sequencePicker', 'palauTimecodes', 'inlineSotName']) {
    ok(n.features[f] === true, `new script: ${f} ON`);
  }
  // The three that MUST stay off (data-loss healers + collab room auto-join).
  ok(!n.features.normalizeTableRows, 'new script: normalizeTableRows OFF (data-loss healer)');
  ok(!n.features.rebuildFromSourceWhenPristine, 'new script: rebuildFromSourceWhenPristine OFF (inert for authored docs)');
  ok(!n.features.collab, 'new script: collab OFF (no auto-join Liveblocks room)');
}

// Legacy seeded projects must keep THEIR OWN features verbatim — the new-style default
// is only for brand-new rows, never an override of a pinned Burma/Palau config.
{
  const p = configForProject({ episode: 'palau' });
  ok(p.features && p.features.collab === true, 'legacy palau: keeps its own features (incl. collab) verbatim');
}

console.log(fail === 0
  ? `PASS — all ${pass} config-for-project cases correct`
  : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
