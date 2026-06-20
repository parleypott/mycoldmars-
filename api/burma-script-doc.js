export const config = { runtime: 'edge' };

import { pgrValue } from './_lib/pgrest.js';

/**
 * Burma Script — CLOUD SYNC for the single canonical script doc.
 *
 *   GET  /api/burma-script-doc            -> { doc, version }   ({ doc:null, version:0 } when empty)
 *   PUT  /api/burma-script-doc  { doc, version }
 *        version > stored  -> upsert accepted, returns { version } of the stored row
 *        version <= stored -> 409 { doc, version } (the current row) so the client reconciles
 *
 * Mirrors burma-essays.js: same SUPABASE_URL / SUPABASE_SERVICE_KEY|SERVICE_ROLE_KEY env handling,
 * the same fetch-based PostgREST `sb()` helper, the same { error:{ code, message } } error shape,
 * and the same NO_DB 500 when env is unconfigured. Single-user, no auth; the service-role key
 * (RLS-bypassing) is server-only.
 *
 * Concurrency: `version` is the client's monotonic LS_DOC_VER. The write is OPTIMISTIC — a PUT is
 * only accepted when the incoming version is strictly greater than the stored version. This makes an
 * empty / older / out-of-date client structurally incapable of overwriting newer cloud work, and a
 * newer-on-cloud state returns 409 with the current row so the client can snapshot-and-adopt.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// SHARE-SAFETY WRITE GATE (server-side). When set, every PUT must carry a matching X-Burma-Write-Token
// header or it is refused 401 BEFORE any DB read. This is what makes the `?read` share STRUCTURALLY safe:
// the read link does NOT carry the secret, and the secret is NOT in the shipped bundle (it lives in
// Johnny's browser localStorage, provisioned once via `?key=` — see burma-script/src/write-token.js).
// So a recipient with DevTools who hand-crafts a PUT has no token and is rejected here — read-only is no
// longer merely client-enforced. GRACEFUL DEGRADATION: if BURMA_WRITE_TOKEN is UNSET (local dev, or
// before Johnny provisions one), PUT stays open exactly as before — turning the gate on is a pure env
// flip. GET is ALWAYS open (a read-share recipient must be able to read).
const WRITE_TOKEN = process.env.BURMA_WRITE_TOKEN || '';
const WRITE_TOKEN_HEADER = 'x-burma-write-token'; // header names are case-insensitive; compare lowercased

// The one canonical doc. There is no multi-doc concept in the tool — one row, fixed id.
const DOC_ID = 'wp01-burma';
const idEq = (id) => `id=eq.${pgrValue(id)}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  // Allow the write-token header on cross-origin preflight so the gated PUT isn't blocked by CORS.
  'Access-Control-Allow-Headers': 'Content-Type, X-Burma-Write-Token',
  'Access-Control-Max-Age': '86400',
};

// PURE write-auth decision (exported for unit tests, no Request/DB needed). Returns true when the PUT is
// authorized: either no server token is configured (open, graceful), or the presented token EXACTLY
// matches the configured one. A configured-but-missing/mismatched token is refused.
//   serverToken : the configured BURMA_WRITE_TOKEN ('' / undefined => gate disabled => always authorized)
//   presented   : the X-Burma-Write-Token header value from the request (may be null/undefined)
function isWriteAuthorized(serverToken, presented) {
  const want = typeof serverToken === 'string' ? serverToken : '';
  if (want.length === 0) return true; // gate disabled — open, as before
  return typeof presented === 'string' && presented.length > 0 && presented === want;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(500, 'NO_DB', 'Supabase env not configured');

  try {
    if (req.method === 'GET') return await getDoc();
    if (req.method === 'PUT') {
      // SHARE-SAFETY WRITE GATE — refuse an unauthorized write BEFORE reading the body or touching the
      // DB. A `?read` recipient (no device token) hand-crafting a PUT lands here as a clean 401, so the
      // read-only guarantee is server-enforced, not merely client-side. Open when no token is configured.
      const presented = req.headers.get(WRITE_TOKEN_HEADER);
      if (!isWriteAuthorized(WRITE_TOKEN, presented)) {
        return err(401, 'UNAUTHORIZED', 'A valid write token is required to modify the cloud doc');
      }
      let body;
      try { body = await req.json(); } catch { return err(400, 'BAD_JSON', 'Body must be JSON'); }
      return await putDoc(body);
    }
    return err(405, 'METHOD', `Method ${req.method} not allowed`);
  } catch (e) {
    return err(500, 'INTERNAL', e?.message || 'unknown error');
  }
}

/* ------------------------------------------------------------------- read */

async function getDoc() {
  const r = await sb(`/rest/v1/burma_script_docs?${idEq(DOC_ID)}&select=doc,version`);
  if (!r.ok) return err(502, 'DB_READ', await r.text());
  const rows = await r.json();
  if (!rows.length) return ok({ doc: null, version: 0 });
  return ok({ doc: rows[0].doc ?? null, version: toVersion(rows[0].version) });
}

/* ------------------------------------------------------------------ write */

async function putDoc(body) {
  // Validate the request shape BEFORE touching the DB (a malformed PUT must not cost a read).
  const v = validatePutBody(body);
  if (!v.ok) return err(400, v.code, v.message);
  const { doc, version } = v;

  // Read the current row to decide accept vs. 409. (Read-then-write; the write itself is also
  // version-guarded below so a concurrent writer can't slip a newer row past us between the two.)
  const cur = await sb(`/rest/v1/burma_script_docs?${idEq(DOC_ID)}&select=doc,version`);
  if (!cur.ok) return err(502, 'DB_READ', await cur.text());
  const curRows = await cur.json();
  const stored = curRows.length ? toVersion(curRows[0].version) : 0;

  // STALE: incoming is not strictly newer than what's stored. Refuse and hand back the current row
  // so the client can snapshot-its-local + adopt cloud (see cloud-sync reconcile). 409 = conflict.
  if (!isWriteAcceptable(version, stored)) {
    return err409({ doc: curRows.length ? (curRows[0].doc ?? null) : null, version: stored });
  }

  const payload = JSON.stringify({ doc, version, updated_at: new Date().toISOString() });

  if (!curRows.length) {
    // cloud-4 — RE-SEED-AFTER-VANISH ALERT. The row is absent (stored===0) but the client is sending
    // a SUBSTANTIAL version. The version counter starts at 1 and climbs by 1 per save, so a large
    // incoming version against an empty row means the canonical row was DELETED/TRUNCATED/restore-
    // gapped and this device is about to RE-SEED the cloud from its local copy. That doesn't lose
    // data (local is authoritative) but it resets the shared monotonic baseline, so cross-device
    // version numbers are no longer comparable to pre-deletion numbers. Log it loudly so a vanished
    // row is visible in the function logs rather than silently re-seeded.
    if (version > 1) {
      try {
        console.warn('[burma-script-doc] cloud row VANISHED — re-seeding from a client at v' + version +
          ' against an empty row (stored=0). The canonical row was deleted/truncated; the shared ' +
          'version baseline is being reset. If multiple devices hold divergent local docs, whichever ' +
          'pushes first wins the re-seed.');
      } catch {}
    }
    // FIRST write — insert. If a racing writer inserted between our read and here, the PK conflict
    // surfaces as a non-2xx; we retry once through the guarded PATCH path below to resolve cleanly.
    const ins = await sb(`/rest/v1/burma_script_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ id: DOC_ID, doc, version }),
    });
    if (ins.ok) {
      const row = (await ins.json())[0];
      return ok({ version: toVersion(row?.version ?? version) });
    }
    // fall through to a guarded update (handles the rare insert race)
  }

  // GUARDED UPDATE — only patch when the stored version is still strictly less than incoming. This
  // is the atomic backstop: even if another writer landed a newer row after our read, `version=lt.`
  // makes this PATCH a no-op (0 rows) rather than a stomp. 0 rows back => someone won the race.
  const upd = await sb(`/rest/v1/burma_script_docs?${idEq(DOC_ID)}&version=lt.${pgrValue(version)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: payload,
  });
  if (!upd.ok) return err(502, 'DB_WRITE', await upd.text());
  const updated = await upd.json();
  if (updated.length) return ok({ version: toVersion(updated[0].version) });

  // 0 rows updated — a concurrent writer landed a >= version. Re-read and 409 with the current row.
  const re = await sb(`/rest/v1/burma_script_docs?${idEq(DOC_ID)}&select=doc,version`);
  const reRows = re.ok ? await re.json() : [];
  const reStored = reRows.length ? toVersion(reRows[0].version) : 0;
  return err409({ doc: reRows.length ? (reRows[0].doc ?? null) : null, version: reStored });
}

/* ---------------------------------------------------------------- helpers */

// Coerce a possibly-string/float version to a safe non-negative integer (PostgREST returns bigint
// as a JSON number, but a client could send a string; never let NaN through as a comparison).
function toVersion(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// PURE input validation for a PUT body. Mirrors the inline checks the handler used to do:
// a doc must be a non-null object, a version must coerce to a positive integer. Returns the
// coerced { doc, version } on success so the caller never re-coerces. (Optional chaining means a
// null/primitive body is handled here, not as a 500.)
function validatePutBody(body) {
  const doc = body?.doc;
  if (doc == null || typeof doc !== 'object') {
    return { ok: false, code: 'BAD_DOC', message: 'doc (object) required' };
  }
  const version = toVersion(body?.version);
  if (!(version > 0)) {
    return { ok: false, code: 'BAD_VERSION', message: 'version (positive integer) required' };
  }
  return { ok: true, doc, version };
}

// THE data-integrity contract, in one pure place: a write is accepted ONLY when the incoming
// version is STRICTLY greater than what's stored. This is what makes an empty / older / equal
// client structurally incapable of overwriting newer cloud work — the whole reason this endpoint
// exists. Both sides are toVersion-coerced so a stringy/NaN version can never sneak past as a write.
function isWriteAcceptable(incomingVersion, storedVersion) {
  return toVersion(incomingVersion) > toVersion(storedVersion);
}

async function sb(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_KEY);
  headers.set('Authorization', `Bearer ${SUPABASE_KEY}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return fetch(`${SUPABASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
}

function ok(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
// 409 carries the CURRENT { doc, version } at the top level (not under `error`) so the client can
// reconcile directly: snapshot local, then adopt this doc if it is genuinely newer.
function err409(current) {
  return new Response(JSON.stringify({ error: { code: 'STALE', message: 'stored version is newer' }, ...current }), {
    status: 409, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Exported for unit tests (pure decision logic + id filter).
export { DOC_ID, idEq, toVersion, validatePutBody, isWriteAcceptable, isWriteAuthorized };
