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

const API = '/api/burma-script-doc';
const LS_DOC = 'wp01_burma_doc_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';

// Cloud-status events the SaveStatus pill listens for (distinct from the local wp-saved family):
//   wp-cloud-saved   — a cloud push confirmed (green "Saved to cloud")
//   wp-cloud-offline — a cloud push could not reach the API / table (amber "Saved on this device · cloud offline")
// The LOCAL save is the source of truth for "is my work safe"; these only say WHERE it also lives.
const EVT_CLOUD_SAVED = 'wp-cloud-saved';
const EVT_CLOUD_OFFLINE = 'wp-cloud-offline';

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
//   { ok:false, stale:true, doc, version }— 409: cloud already has a >= version (caller may adopt)
//   { ok:false, offline:true }            — API unreachable / NO_DB / table missing (fires wp-cloud-offline)
export async function pushDoc(doc, version, fetchImpl = globalThis.fetch) {
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
      // ahead. Surface the current cloud row so the caller can snapshot-and-adopt on next load; for
      // the pill we treat "reachable but ahead" as still cloud-connected (don't flip to offline).
      const body = await res.json().catch(() => ({}));
      emit(EVT_CLOUD_SAVED, { version: toInt(body?.version), reconciled: true });
      return { ok: false, stale: true, doc: body?.doc ?? null, version: toInt(body?.version) };
    }
    // Any other non-2xx (500 NO_DB, 404 table-missing routed as error, 502 …) => cloud unavailable.
    emit(EVT_CLOUD_OFFLINE, { status: res?.status });
    return { ok: false, offline: true, status: res?.status };
  } catch {
    emit(EVT_CLOUD_OFFLINE, {});
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
    const key = CONFLICT_PREFIX + Date.now();
    localStorage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
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

  if (decision.action === 'seed-from-cloud' || decision.action === 'adopt-cloud') {
    // On ADOPT (cloud newer than an existing local doc) snapshot the local doc FIRST so it is never
    // lost. On a fresh SEED there is no local doc to snapshot.
    if (decision.snapshotLocal) { try { snapshotConflict(); } catch {} }
    // Align the local version stamp to cloud's BEFORE writing, so saveDoc stamps cloud+1 and the
    // subsequent push (after reload) is accepted rather than bouncing as stale.
    try { if (prime) prime(decision.version); } catch {}
    let res = { ok: false };
    try { res = save ? save(decision.doc) : { ok: false }; } catch {}
    return { action: decision.action, wrote: !!res?.ok, version: decision.version, shouldReload: !!res?.ok };
  }

  if (decision.action === 'keep-local' && decision.push) {
    // KEEP LOCAL — the safest branch (covers cloud empty / API down / older cloud). Push local up so
    // the cloud copy catches up. Fire-and-forget; pushDoc fires its own cloud-status events.
    try { if (local.doc != null) pushDoc(local.doc, local.version); } catch {}
    return { action: 'keep-local', shouldReload: false };
  }

  return { action: 'noop', shouldReload: false };
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

export { API, LS_DOC, CONFLICT_PREFIX, EVT_CLOUD_SAVED, EVT_CLOUD_OFFLINE, toInt, defaultReadLocal };
