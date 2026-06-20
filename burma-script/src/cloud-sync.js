// Burma Script Tool — CLOUD SYNC client layer (cloud-follow-me).
//
// localStorage stays the instant local cache + OFFLINE SOURCE OF TRUTH. This module is the cloud
// mirror on top of it: push the doc up after every local save, and on load reconcile the cloud copy
// against the local version stamp. It NEVER forks persistence — every write still flows through
// saveDoc() in migrate-doc.js (the only place LS_DOC is written), and conflict snapshots reuse the
// existing .conflict.<ts> machinery (snapshotLocalConflict here mirrors migrate-doc's snapshotConflict).
//
// ── THE THREE SAFETY RULES (decideReconcile — pure, unit-tested) ───────────────────────────────
//   1. No local doc + cloud has one          -> SEED from cloud.
//   2. cloud.version  >  local.version        -> cloud is newer: snapshot local to .conflict.<ts>
//                                                FIRST, THEN adopt cloud.
//   3. local.version  >= cloud.version        -> KEEP LOCAL, push local up. This INCLUDES cloud
//      (incl. cloud empty / API down / table   empty (version 0), the API being down, and the table
//       missing)                                not existing yet. An empty/older/unreachable cloud
//                                                is STRUCTURALLY INCAPABLE of replacing good local
//                                                work — that stomp is Johnny's exact fear.
//
// Rule 3 is the load-bearing one: any ambiguity (no cloud answer, malformed answer, older answer)
// resolves to KEEP LOCAL. Cloud only wins when it answers cleanly AND is strictly newer.

import { isReadOnly } from './read-mode.js';

const API = '/api/burma-script-doc';
const LS_DOC = 'wp01_burma_doc_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';

// COLLISION-PROOF SNAPSHOT KEY (snapshot-key-collision) — mirrors migrate-doc.js's snapshotKey:
// PREFIX + Date.now() + '-' + monotonic seq, so two snapshots in the same millisecond never
// collide and silently overwrite each other. The fixed-width ms prefix keeps lexical sort
// chronological for the shared recovery tooling.
let _csSnapSeq = 0;
function conflictKey() {
  const seq = String((_csSnapSeq++) % 1000000).padStart(6, '0');
  return CONFLICT_PREFIX + Date.now() + '-' + seq;
}

// Cloud-status events the SaveStatus pill listens for (distinct from the local wp-saved family):
//   wp-cloud-saved    — a cloud push confirmed (green "Saved to cloud")
//   wp-cloud-offline  — a cloud push could not reach the API / table (amber "Saved on this device · cloud offline")
//   wp-cloud-conflict — a HOT-PATH push 409: the cloud already holds a strictly-newer doc, so THIS
//                       device's just-saved local edit was NEVER merged into the canonical cloud copy
//                       (the two-device concurrent-edit case). This is NOT "saved to cloud" and NOT
//                       merely "offline" — it is a real divergence. We snapshot BOTH docs to
//                       .conflict.<ts> (lossless) and raise the reload/merge banner so Johnny pulls the
//                       newer doc and re-applies. The pill must NEVER show green on this event.
// The LOCAL save is the source of truth for "is my work safe"; these only say WHERE it also lives.
const EVT_CLOUD_SAVED = 'wp-cloud-saved';
const EVT_CLOUD_OFFLINE = 'wp-cloud-offline';
const EVT_CLOUD_CONFLICT = 'wp-cloud-conflict';

function emit(type, detail) {
  try {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    }
  } catch {}
}

// ── PURE DECISION CORE ─────────────────────────────────────────────────────────────────────────
// Inputs are plain values so this is fully testable with no browser, no network, no localStorage:
//   localVersion : number  — the local LS_DOC_VER (0 if none / unknown)
//   hasLocalDoc  : boolean — is there a local doc at all?
//   cloud        : { ok, doc, version } | { ok:false }
//                   ok===true  means the API answered cleanly (doc may be null when cloud is empty)
//                   ok===false means API down / table missing / network error / malformed — UNKNOWN
//
// Returns one of:
//   { action: 'seed-from-cloud', doc, version }                  (rule 1)
//   { action: 'adopt-cloud', doc, version, snapshotLocal: true } (rule 2 — snapshot BEFORE adopt)
//   { action: 'keep-local', push: true }                         (rule 3 — keep + push local up)
//   { action: 'noop' }                                           (nothing to do: no local, no cloud)
export function decideReconcile({ localVersion, hasLocalDoc, cloud }) {
  const lv = toInt(localVersion);

  // Cloud answer is UNKNOWN (API down / table missing / malformed) -> treat as "no newer cloud".
  // Rule 3: keep local, and (if we have something local) push it up so the cloud catches up later.
  const cloudOk = !!(cloud && cloud.ok === true);
  if (!cloudOk) {
    return hasLocalDoc ? { action: 'keep-local', push: true } : { action: 'noop' };
  }

  const cloudHasDoc = cloud.doc != null;
  const cv = toInt(cloud.version);

  // Rule 1 — no local doc, cloud has one -> seed from cloud (this device is fresh / wiped laptop).
  if (!hasLocalDoc) {
    return cloudHasDoc
      ? { action: 'seed-from-cloud', doc: cloud.doc, version: cv }
      : { action: 'noop' }; // neither side has anything yet
  }

  // We HAVE a local doc from here on.
  // Rule 2 — cloud strictly newer AND cloud actually has a doc -> snapshot local FIRST, then adopt.
  if (cloudHasDoc && cv > lv) {
    return { action: 'adopt-cloud', doc: cloud.doc, version: cv, snapshotLocal: true };
  }

  // Rule 3 — local >= cloud (incl. cloud empty / equal / older) -> KEEP LOCAL, push local up.
  return { action: 'keep-local', push: true };
}

function toInt(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : 0;
}

// ── BROWSER GLUE (thin; all decisions live in decideReconcile) ──────────────────────────────────

// Fetch the cloud copy. NEVER throws — any failure (network, 5xx, NO_DB, table missing, bad JSON)
// resolves to { ok:false }, which decideReconcile reads as "unknown -> keep local". A 200 with the
// expected shape resolves to { ok:true, doc, version }.
export async function fetchCloud(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(API, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return { ok: false, status: res?.status };
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || 'error' in body) return { ok: false };
    // doc may legitimately be null (cloud empty); version defaults to 0.
    return { ok: true, doc: 'doc' in body ? body.doc : null, version: toInt(body.version) };
  } catch {
    return { ok: false };
  }
}

// Push the local doc + version to the cloud. Returns a result object; NEVER throws and NEVER touches
// localStorage — a cloud-push failure must never block or undo the local save that already landed.
//   { ok:true, version }                  — accepted (fires wp-cloud-saved)
//   { ok:false, stale:true, doc, version }— 409: cloud already has a >= version. THIS device's push
//                                            was NOT merged. Caller MUST run handlePushResult to
//                                            snapshot-and-adopt — pushDoc itself does NOT fire a
//                                            "saved" event here (that would be a false green).
//   { ok:false, offline:true }            — API unreachable / NO_DB / table missing (fires wp-cloud-offline)
export async function pushDoc(doc, version, fetchImpl = globalThis.fetch) {
  // READ-ONLY SHARE GUARD (read-only-share) — a recipient on a `?read`/`?view` link must never PUT
  // to the cloud. This is the cloud half of the safety core (saveDoc is the local half): refuse the
  // write structurally so a reader's browser is incapable of advancing or clobbering Johnny's
  // canonical cloud doc. No-op success, no event, no network call.
  if (isReadOnly()) {
    return { ok: false, skipped: true, readOnly: true };
  }
  if (doc == null || !(toInt(version) > 0)) {
    // Nothing meaningful to push yet (e.g. version 0). Treat as a no-op success, no event.
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetchImpl(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, version: toInt(version) }),
    });
    if (res && res.ok) {
      const body = await res.json().catch(() => ({}));
      emit(EVT_CLOUD_SAVED, { version: toInt(body?.version ?? version) });
      return { ok: true, version: toInt(body?.version ?? version) };
    }
    if (res && res.status === 409) {
      // Cloud is newer than what we tried to push. NOT an offline state — the cloud is reachable and
      // ahead — but it is ALSO NOT "saved to cloud": THIS device's just-pushed edit was REFUSED and
      // never merged into the canonical cloud copy (the two-device concurrent-edit case). We MUST NOT
      // fire wp-cloud-saved here — doing so falsely turns the pill green and tells Johnny his edit is
      // safe in the cloud when it lives ONLY in this device's localStorage and would be lost on the
      // next adopt/reload. Hand the current cloud row back to the caller (handlePushResult) which
      // snapshots BOTH docs and raises the conflict banner. The event is fired there, once, with the
      // local doc in hand — not here, where we only know the cloud side.
      const body = await res.json().catch(() => ({}));
      return { ok: false, stale: true, doc: body?.doc ?? null, version: toInt(body?.version) };
    }
    // Any other non-2xx (500 NO_DB, 404 table-missing routed as error, 502 …) => cloud unavailable.
    emit(EVT_CLOUD_OFFLINE, { status: res?.status });
    scheduleOfflinePushRetry(); // DL-06: catch the cloud up the moment connectivity returns.
    return { ok: false, offline: true, status: res?.status };
  } catch {
    emit(EVT_CLOUD_OFFLINE, {});
    scheduleOfflinePushRetry();
    return { ok: false, offline: true };
  }
}

// Snapshot the current LOCAL doc to a .conflict.<ts> recovery key BEFORE we adopt a newer cloud doc
// over it — mirrors migrate-doc.js's snapshotConflict so the existing recovery tooling finds it.
// Returns the key, or null if storage refused. NEVER throws.
export function snapshotLocalConflict() {
  try {
    const raw = localStorage.getItem(LS_DOC);
    if (!raw) return null;
    const key = conflictKey();
    localStorage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

// Snapshot an ARBITRARY doc object (e.g. the incoming cloud doc returned by a 409) to its own
// .conflict.<ts> recovery key, so the cloud side of a divergence is preserved too — not just local.
// Returns the key, or null if the doc is empty / storage refused. NEVER throws.
export function snapshotDocConflict(doc) {
  try {
    if (doc == null) return null;
    const raw = JSON.stringify(doc);
    const key = conflictKey();
    localStorage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

// ── OFFLINE PUSH RETRY (DL-06) ───────────────────────────────────────────────────────────────────
// A keep-local reconcile push (or any hot-path push) can come back OFFLINE — the local save is safe,
// but the cloud silently stays a version BEHIND local forever, until the next successful save. A
// single offline blip on the LAST edit of a session means the cloud permanently lags, and a fresh
// device (or an adopt) could then seed/adopt the OLDER cloud doc, losing the last edits. There was
// no "cloud is behind — retry the push" path. This arms a ONE-SHOT retry that fires on the next
// `online` / `visibilitychange→visible` event and pushes the LIVE on-disk doc+version (not whatever
// stale snapshot triggered the offline), so the cloud catches up the instant connectivity returns.
// Idempotent: re-arming while a retry is already pending is a no-op (we don't stack listeners).
let _offlineRetryArmed = false;
function readLiveLocal() {
  // Read the CURRENT on-disk doc + version straight from localStorage (not a captured snapshot),
  // so the retry pushes the freshest local content the editor has persisted. NEVER throws.
  try { return defaultReadLocal(); } catch { return { hasDoc: false, version: 0, doc: null }; }
}
export function scheduleOfflinePushRetry() {
  if (_offlineRetryArmed) return;
  if (typeof window === 'undefined' || !window.addEventListener) return;
  _offlineRetryArmed = true;
  const fire = () => {
    // Disarm FIRST so a push that itself comes back offline can re-arm cleanly for the next event.
    disarm();
    const live = readLiveLocal();
    if (!live.hasDoc || live.doc == null || !(toInt(live.version) > 0)) return;
    Promise.resolve(pushDoc(live.doc, live.version))
      .then((res) => {
        // A retry can ALSO 409 (another device moved ahead) → snapshot-and-conflict like any push.
        // Or it can come back offline again → re-arm for the next connectivity event.
        if (res && res.offline) { scheduleOfflinePushRetry(); return; }
        handlePushResult(res, live.doc);
      })
      .catch(() => {});
  };
  function onVisible() { if (typeof document === 'undefined' || document.visibilityState === 'visible') fire(); }
  function disarm() {
    _offlineRetryArmed = false;
    try { window.removeEventListener('online', fire); } catch {}
    try { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible); } catch {}
  }
  try { window.addEventListener('online', fire); } catch {}
  try { if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible); } catch {}
}

// PUBLIC (test): is an offline retry currently armed?
export function isOfflineRetryArmed() { return _offlineRetryArmed; }

// ── HOT-PATH PUSH-409 CONSUMER (the two-device concurrent-edit stranding fix) ────────────────────
// Every push path (Editor.flushSave, reconcile keep-local) feeds its pushDoc() result through here.
// A push 409 means: while THIS device was editing, another device advanced the cloud past us, so our
// just-pushed local edit was REFUSED and is NOT in the canonical cloud copy. Discarding that (the old
// behaviour) silently strands this device's word in localStorage only — and the false wp-cloud-saved
// told Johnny it was safe. We instead treat the 409 EXACTLY like the load-time adopt path:
//
//   1. snapshot the LOCAL doc (this device's stranded edit) to .conflict.<ts>  — never lose OUR word
//   2. snapshot the incoming CLOUD doc (the other device's newer edit) to .conflict.<ts> — never lose THEIRS
//   3. emit wp-cloud-conflict so SaveStatus raises the reload/merge banner (NOT a green pill)
//
// The actual merge is a human reload (the banner's RELOAD button) → reconcileOnLoad sees cloud strictly
// newer → adopt-cloud (which snapshots local again and re-seeds the editor from the newer cloud doc).
// Both devices' words survive on disk; Johnny re-applies his stranded edit from the .conflict snapshot.
//
// `localDoc` is the doc THIS device just tried to push (so we snapshot the exact bytes that were
// refused, not whatever LS_DOC happens to hold a moment later). Falls back to LS_DOC if not supplied.
// Returns a structured outcome for tests: { conflict, localSnapshot, cloudSnapshot, cloudVersion }.
// NEVER throws — a push-result handler must never break the (already-durable) local save.
export function handlePushResult(result, localDoc) {
  if (!result || result.ok === true || result.stale !== true) {
    // Accepted, skipped, or offline — pushDoc already emitted the right event (saved/offline). Nothing
    // to reconcile here; only a 409 ('stale') is a true divergence that strands a local edit.
    return { conflict: false };
  }
  // A real two-device divergence. Snapshot BOTH sides before anything can overwrite either.
  let localSnapshot = null;
  try {
    localSnapshot = localDoc != null ? snapshotDocConflict(localDoc) : snapshotLocalConflict();
  } catch {}
  let cloudSnapshot = null;
  try { cloudSnapshot = snapshotDocConflict(result.doc); } catch {}
  // Raise the conflict banner. Carry the recovery keys + cloud version so the UI/console can point
  // Johnny straight at his preserved edit. This is the signal that REPLACES the old false green.
  emit(EVT_CLOUD_CONFLICT, {
    cloudVersion: toInt(result.version),
    localSnapshot,
    cloudSnapshot,
  });
  try {
    console.warn('[burma] cloud push CONFLICT (409): another device advanced the cloud to v' +
      toInt(result.version) + ' while this device was editing. This device\'s edit was NOT merged — ' +
      'preserved at ' + localSnapshot + ' (local) and ' + cloudSnapshot + ' (cloud). RELOAD to adopt ' +
      'the newer doc, then re-apply your change.');
  } catch {}
  return { conflict: true, localSnapshot, cloudSnapshot, cloudVersion: toInt(result.version) };
}

// ── LOAD-TIME RECONCILE ORCHESTRATION ───────────────────────────────────────────────────────────
// Runs once at startup (main.jsx), AFTER the local safe-migration, BEFORE the editor seeds. Fetches
// the cloud copy, runs the pure decision, and applies it through the EXISTING persistence machinery:
//   • adopt/seed -> primeVersionFloor(cloud.version) then saveDoc(cloudDoc) (so LS_DOC_VER = cloud+1,
//                   keeping the next push in lockstep), snapshot local FIRST on adopt. Returns
//                   { reloaded:false, action } and signals the caller to reload so the editor
//                   re-seeds from the freshly-written local doc.
//   • keep-local -> push the local doc up (fire-and-forget) so an empty/older cloud catches up.
//
// Dependencies are injected so this is testable without a bundler. NEVER throws.
//   deps.readLocal()        -> { hasDoc, version, doc }  (reads LS_DOC + LS_DOC_VER)
//   deps.saveDoc(doc)       -> writes LS_DOC via the canonical guarded path
//   deps.primeVersionFloor  -> raises LS_DOC_VER floor to cloud.version
//   deps.snapshotConflict   -> snapshots local to .conflict.<ts> before adopt
//   deps.fetchCloud         -> fetchCloud (overridable for tests)
export async function reconcileOnLoad(deps = {}) {
  const {
    readLocal = defaultReadLocal,
    saveDoc: save,
    primeVersionFloor: prime,
    snapshotConflict = snapshotLocalConflict,
    fetchCloud: fetchC = fetchCloud,
  } = deps;

  let local;
  try { local = readLocal(); } catch { local = { hasDoc: false, version: 0, doc: null }; }

  const cloud = await fetchC();
  const decision = decideReconcile({
    localVersion: local.version,
    hasLocalDoc: local.hasDoc,
    cloud,
  });

  logDecision('reconcile', decision.action, local.version, cloud);

  if (decision.action === 'seed-from-cloud' || decision.action === 'adopt-cloud') {
    // On ADOPT (cloud newer than an existing local doc) snapshot the local doc FIRST so it is never
    // lost. On a fresh SEED there is no local doc to snapshot.
    //
    // SILENT-BYTE-LOSS GUARD (adopt-snapshot-must-land): the adopt write below routes through saveDoc,
    // whose quota loop EVICTS existing .bak/.conflict backups to make room and then succeeds — so a
    // failed snapshot is NOT a soft "we'll keep local anyway", it is a hard "we are about to overwrite
    // an unsynced local edit with no recovery copy and no banner". snapshotLocalConflict() returns
    // null (it does NOT throw) when localStorage refuses (quota full / private mode). The old code
    // discarded that return inside `try {} catch {}`, so the null branch was unguarded and untested.
    // We now REQUIRE the snapshot to land before adopting: if snapshotLocal was requested and the
    // snapshot did not produce a key, we ABORT the adopt entirely — do NOT prime, do NOT write, do NOT
    // reload. The cloud doc is still safely in the cloud (we never touched it), so refusing to adopt
    // loses NOTHING; adopting without a snapshot can lose the local word forever. Mirror resetDoc /
    // saveDoc's "could not back up → abort" contract and fire the loud wp-save-failed banner so a
    // dyslexic non-coder SEES that their on-screen local copy is the one to trust, then reload later.
    if (decision.snapshotLocal) {
      let snapKey = null;
      try { snapKey = snapshotConflict(); } catch { snapKey = null; }
      if (!snapKey) {
        // Could not back up the local doc. Adopting now would evict the safety net and clobber the
        // unsynced local edit with no recovery copy. Refuse: keep local on screen, warn LOUDLY.
        emit('wp-save-failed', {
          reason: 'adopt-snapshot-failed',
          message: 'A newer cloud version exists, but this device could not back up your current ' +
            'copy first (storage is full). Keeping your on-screen copy. Free up space, then reload.',
          action: decision.action,
          cloudVersion: decision.version,
        });
        try {
          console.warn('[burma] cloud reconcile: ' + decision.action + ' ABORTED — could not snapshot ' +
            'local before adopt (storage refused / quota). NOT writing cloud doc, NOT reloading. Local ' +
            'stays on screen; cloud v' + decision.version + ' is untouched and still adoptable after ' +
            'space is freed.');
        } catch {}
        return { action: decision.action, wrote: false, version: decision.version,
                 shouldReload: false, aborted: true, reason: 'adopt-snapshot-failed' };
      }
    }
    // Align the local version stamp to cloud's BEFORE writing, so saveDoc stamps cloud+1 and the
    // subsequent push (after reload) is accepted rather than bouncing as stale. primeVersionFloor
    // raises BOTH the on-disk LS_DOC_VER AND this tab's knownBaseVersion to cloud.version, so the
    // very next saveDoc sees storedVersion === knownBaseVersion (guard passes, no false conflict)
    // and stamps cloud.version + 1 — the adopt write is NEVER refused by the cross-tab guard.
    try { if (prime) prime(decision.version); } catch {}
    let res = { ok: false };
    try { res = save ? save(decision.doc) : { ok: false }; } catch {}
    // HARDENING: if the adopt write was refused (res.ok === false — e.g. the conflict guard rejected
    // it, leaving stale local on screen), say so LOUDLY rather than silently signalling no-reload.
    // With primeVersionFloor aligning the base above this should be unreachable, but if it ever
    // happens we want a console trail, not a silent stale-local paint.
    if (!res?.ok) {
      console.warn('[burma] cloud reconcile: ' + decision.action + ' write REFUSED (reason=' +
        (res?.reason || 'unknown') + ') — local left as-is, NOT reloading. cloud=v' + decision.version);
    }
    return { action: decision.action, wrote: !!res?.ok, version: decision.version, shouldReload: !!res?.ok };
  }

  if (decision.action === 'keep-local' && decision.push) {
    // KEEP LOCAL — the safest branch (covers cloud empty / API down / older cloud). Push local up so
    // the cloud copy catches up. Fire-and-forget for the SAVE, but we now CONSUME the push result:
    // a keep-local push can still 409 (local.version === cloud.version but the docs diverged — the
    // exact two-device stranding case), and that 409 must snapshot-and-adopt via handlePushResult,
    // not be swallowed. pushDoc still fires saved/offline itself; only the 409 path routes here.
    //
    // DL-06: read the LIVE on-disk doc at push time, NOT the snapshot captured at the top of
    // reconcileOnLoad. The editor may have already saved a newer doc between reconcile-start and
    // here; pushing the stale start snapshot could no-op against an equal cloud version and leave
    // the cloud permanently a version behind the live local doc. pushDoc itself arms an offline
    // retry, so an unreachable cloud here is caught up on the next connectivity event.
    try {
      let live = local;
      try { live = readLiveLocal(); } catch {}
      const pushDocBody = (live && live.doc != null) ? live.doc : local.doc;
      const pushVer = (live && live.hasDoc) ? live.version : local.version;
      if (pushDocBody != null) {
        Promise.resolve(pushDoc(pushDocBody, pushVer))
          .then((res) => handlePushResult(res, pushDocBody))
          .catch(() => {});
      }
    } catch {}
    return { action: 'keep-local', shouldReload: false };
  }

  return { action: 'noop', shouldReload: false };
}

// ── COLD-START BOOTSTRAP (no-local-doc, AWAIT BEFORE FIRST PAINT) ─────────────────────────────────
// The fresh/incognito-browser path. main.jsx calls this BEFORE render() when there is no local doc,
// AWAITING it so the cloud copy is written locally before the editor's seedDoc runs — the editor then
// paints Johnny's real cloud script on the FIRST frame, with NO flash of the bundled source and NO
// reload. The old path (render source → background reconcile → saveDoc → location.reload) was racy:
// the user saw source, and the reload-to-cloud could be slow, interrupted, or never visibly land.
//
// Returns { seeded:boolean }:
//   • seeded:true  — the cloud answered cleanly with a doc; it was written locally (primeVersionFloor
//                    then saveDoc through the canonical guarded path). Caller renders normally and the
//                    editor seeds the freshly-written cloud doc.
//   • seeded:false — cloud empty / unreachable / table missing / no doc. Caller renders from SOURCE
//                    exactly as before (graceful degradation, unchanged). An empty/unreachable cloud
//                    can NEVER write here (Rule 1 only seeds when cloud has a doc) — so source shows.
//
// NEVER throws. Dependencies injected for tests (no bundler / browser / network needed).
export async function bootstrapFromCloud(deps = {}) {
  const {
    saveDoc: save,
    primeVersionFloor: prime,
    fetchCloud: fetchC = fetchCloud,
  } = deps;

  const cloud = await fetchC();
  // Reuse the SAME pure decision core, with hasLocalDoc:false hardwired — this is the cold-start path.
  // Only a clean cloud answer that actually HAS a doc yields 'seed-from-cloud'; everything else
  // (empty cloud, API down, table missing) yields 'noop' and we fall back to source.
  const decision = decideReconcile({ localVersion: 0, hasLocalDoc: false, cloud });

  logDecision('bootstrap', decision.action, 0, cloud);

  if (decision.action === 'seed-from-cloud') {
    // Canonical write path: prime the version floor to cloud.version first (so the post-seed editor
    // saves stamp cloud+1 and the first push is accepted, not bounced as stale), THEN saveDoc.
    try { if (prime) prime(decision.version); } catch {}
    let res = { ok: false };
    try { res = save ? save(decision.doc) : { ok: false }; } catch {}
    if (res?.ok) {
      return { seeded: true, version: decision.version };
    }
    // Cloud had a doc but the local write failed (quota / blocked). Fall back to source — the editor
    // will paint source, and saveDoc already fired its loud wp-save-failed banner. Never silent.
    console.warn('[burma] cloud bootstrap: seed write FAILED (reason=' + (res?.reason || 'unknown') +
      ') — falling back to source');
    return { seeded: false };
  }

  // noop — no cloud doc to seed. Render from source.
  return { seeded: false };
}

// READ-ONLY SHARE LOADER (read-only-share) — fetch Johnny's latest CLOUD doc for a `?read`/`?view`
// recipient WITHOUT writing anything anywhere. This is deliberately separate from bootstrapFromCloud:
// bootstrap's job is to SEED localStorage (it calls saveDoc/primeVersionFloor), which a reader must
// never do. Here we only READ: return the cloud doc so the editor can seed its in-memory copy from it,
// and the caller renders a non-editable view. If the cloud is unreachable / empty, the caller falls
// back to whatever local doc exists, else the bundled source — exactly the graceful degradation the
// spec asks for. NEVER throws; NEVER touches localStorage or the cloud beyond the single GET.
export async function fetchCloudDocReadOnly(deps = {}) {
  const { fetchCloud: fetchC = fetchCloud } = deps;
  const cloud = await fetchC();
  logDecision('read-only', cloud && cloud.ok ? 'cloud-doc' : 'noop', 0, cloud);
  if (cloud && cloud.ok && cloud.doc != null) {
    return { ok: true, doc: cloud.doc, version: toInt(cloud.version) };
  }
  return { ok: false };
}

// Compact decision diagnostics so behaviour is confirmable in the browser console without a debugger.
//   [burma] cloud bootstrap: seed-from-cloud local=v0 cloud.ok=true cloud=v429
function logDecision(phase, action, localVersion, cloud) {
  try {
    const okFlag = !!(cloud && cloud.ok === true);
    const cv = okFlag ? toInt(cloud.version) : '?';
    console.info('[burma] cloud ' + phase + ': ' + action +
      ' local=v' + toInt(localVersion) + ' cloud.ok=' + okFlag + ' cloud=v' + cv);
  } catch {}
}

// Default local reader — pulls LS_DOC + LS_DOC_VER straight from localStorage. NEVER throws.
function defaultReadLocal() {
  let raw = null, verRaw = null;
  try { raw = localStorage.getItem(LS_DOC); } catch {}
  try { verRaw = localStorage.getItem('wp01_burma_doc_ver_v1'); } catch {}
  let doc = null;
  if (raw) { try { doc = JSON.parse(raw); } catch { doc = null; } }
  const version = verRaw != null ? toInt(String(verRaw).split('|')[0]) : 0;
  return { hasDoc: !!raw, version, doc };
}

export { API, LS_DOC, CONFLICT_PREFIX, EVT_CLOUD_SAVED, EVT_CLOUD_OFFLINE, EVT_CLOUD_CONFLICT, toInt, defaultReadLocal };
