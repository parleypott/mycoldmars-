// NODEJS runtime (not edge): yjs + @tiptap/y-tiptap decode the room's Y.Doc binary here, and
// @liveblocks/node's WebhookHandler needs Buffer. burma-tk.js proves the web-Request handler
// signature works on the nodejs runtime in this repo.
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { WebhookHandler } from '@liveblocks/node';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { pgrValue } from './_lib/pgrest.js';
// Sentry: the shared _lib/sentry.js wrapper is built on @sentry/vercel-edge, which is fetch-
// transport only — no Node-specific APIs — so it works on this nodejs-runtime handler too
// (Vercel's node runtime has global fetch). Same no-op-without-SENTRY_DSN contract as everywhere.
import { withSentry, captureServerError } from './_lib/sentry.js';
// THE SHARED WRITE GATES — imported from the generalized doc endpoint, never re-implemented, so a
// webhook write obeys the exact same version contract as every client PUT: strictly-advancing
// versions vetted by isWriteAcceptable, made atomic at the DB by updateGuardClause's CAS filter.
import { toVersion, isWriteAcceptable, updateGuardClause, UUID_RE } from './script-doc.js';
// The room-id shape is owned by the auth endpoint (only `script-*` rooms are mintable there);
// reusing its validator means the webhook accepts exactly the rooms auth can create — no drift.
import { isValidCollabRoom } from './liveblocks-auth.js';

/**
 * Script Library — LIVEBLOCKS WEBHOOK (collab server-side persistence).
 *
 * Closes the "cloud saving depends on a browser tab" gap: in a collab session the Yjs room is the
 * canonical doc, and until now the ONLY path from room -> Supabase was the 20-second snapshot timer
 * in an open editor tab (Editor.jsx). Close the last tab mid-thought and the final keystrokes lived
 * only in Liveblocks. This endpoint receives Liveblocks' `ydocUpdated` webhook (fired at most every
 * few seconds per room while it's being edited), pulls the room's converged Y.Doc via the REST API,
 * converts fragment 'default' to ProseMirror JSON, and writes it through the SAME version-CAS +
 * append-only-revision semantics as api/script-doc.js. The client timer STAYS as the belt; this is
 * the suspenders that works with zero tabs open.
 *
 *   POST /api/liveblocks-webhook   (Liveblocks -> us; svix-style signature headers)
 *        -> 200 handled/skipped (identical content, empty room, non-script room, unknown project,
 *               raced writer — all outcomes where a Liveblocks retry would change nothing)
 *        -> 401 bad/missing/replayed signature
 *        -> 503 LIVEBLOCKS_WEBHOOK_SECRET or LIVEBLOCKS_SECRET_KEY not configured
 *        -> 502 transient infra failure (ydoc fetch / DB) — non-2xx so Liveblocks RETRIES
 *
 * ROOM -> PROJECT: collabRoomId() (burma-script/src/collab.js) mints `script-<projectRef>` where
 * <projectRef> is the exact ref /api/script-doc?project=<ref> routes on (a slug like 'burma' or a
 * library row's uuid). So the mapping is: validate the `script-*` shape, strip the prefix, resolve
 * slug->id through script_projects exactly like script-doc.js does.
 *
 * VERSION SEMANTICS: the webhook has no client version stamp, so it writes stored+1 with a TRUE
 * compare-and-swap (baseVersion = stored -> DB filter version=eq.<stored>). A concurrent writer that
 * lands between our read and the PATCH makes it a 0-row no-op — we skip, and the next ydocUpdated
 * delivery carries the converged content. A webhook write can NEVER clobber a newer version, and
 * every accepted write appends a script_doc_revisions row (source 'collab-webhook') — same
 * append-only history backstop as every other save.
 *
 * IDEMPOTENT DOUBLE-DELIVERY: before writing we compare the decoded doc against the stored doc on a
 * sorted-key canonical serialization (same trick as cloud-sync.js's docsDiffer, so jsonb key
 * reordering from the Postgres round-trip can't masquerade as a change). Identical -> skip, no
 * version bump, no revision row.
 *
 * EMPTY-ROOM GUARD: a room whose fragment decodes to no content (unseeded, wiped, or a decode of a
 * partial state) is NEVER written — the audited blank-editor-overwrites-cloud failure mode, applied
 * server-side. An empty webhook doc is structurally incapable of replacing a real cloud doc.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const LIVEBLOCKS_API = 'https://api.liveblocks.io';
// The Yjs fragment tiptap's Collaboration extension binds ({ field: 'default' } — collab-runtime.js).
const Y_FIELD = 'default';
const REVISION_SOURCE = 'collab-webhook';

/* ------------------------------------------------------------ pure helpers */

// PURE — map a Liveblocks room id to the project ref /api/script-doc routes on, or null when the
// room is not a script room (shape owned by liveblocks-auth's validator). Exported for tests.
export function roomToProjectRef(roomId) {
  if (!isValidCollabRoom(roomId)) return null;
  return String(roomId).slice('script-'.length);
}

// PURE — sorted-key canonical serialization, mirroring cloud-sync.js's stableStringify: identical
// content serializes identically regardless of key insertion order, so a Postgres jsonb round-trip
// can never masquerade as a real edit. Exported for tests.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// PURE — is the decoded room doc content-identical to the stored cloud doc? True -> the delivery is
// a duplicate (or the client timer already mirrored it) and no write happens. Exported for tests.
export function docsContentEqual(a, b) {
  if (a == null || b == null) return false;
  try { return stableStringify(a) === stableStringify(b); } catch { return false; }
}

// PURE — only a doc with actual top-level nodes may be persisted. An empty/unseeded room decodes to
// {type:'doc'} or {type:'doc',content:[]} — writing that over a real script is the blank-editor
// clobber, so it is refused structurally. Exported for tests.
export function isMeaningfulDoc(json) {
  if (!json || typeof json !== 'object') return false;
  return Array.isArray(json.content) && json.content.length > 0;
}

// Decode a Liveblocks ydoc-binary payload (a full Yjs state update) into ProseMirror JSON via the
// same y-tiptap conversion family the client's seed path uses (prosemirrorJSONToYDoc's inverse).
// Exported for tests. Throws on corrupt input — the caller maps that to a skip, not a crash.
export function decodeYDocBinary(binary, field = Y_FIELD) {
  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, binary instanceof Uint8Array ? binary : new Uint8Array(binary));
  try {
    return yDocToProsemirrorJSON(yDoc, field);
  } finally {
    try { yDoc.destroy(); } catch {}
  }
}

// Verify the svix-style signature headers (webhook-id / webhook-timestamp / webhook-signature)
// against the raw body. Throws on any failure — bad signature, missing headers, replayed/future
// timestamp — via @liveblocks/node's WebhookHandler (the official verifier). Exported for tests.
export function verifyWebhookRequest(headers, rawBody, secret) {
  const handler = new WebhookHandler(secret);
  return handler.verifyRequest({ headers, rawBody });
}

/* ------------------------------------------------------- the persistence core */

// The whole room->cloud write, with every side effect injectable so tests run it against a stubbed
// fetch (no network, no DB). Returns { outcome, ... }; `retryable: true` marks transient failures
// the HTTP layer converts to a non-2xx so Liveblocks re-delivers.
export async function processYDocUpdated(roomId, deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    liveblocksSecret = process.env.LIVEBLOCKS_SECRET_KEY,
    supabaseUrl = SUPABASE_URL,
    supabaseKey = SUPABASE_KEY,
  } = deps;

  const projectRef = roomToProjectRef(roomId);
  if (!projectRef) return { outcome: 'ignored-room', roomId };

  const sb = (path, init = {}) => {
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: 'application/json', ...(init.headers || {}) };
    return fetchImpl(`${supabaseUrl}${path}`, { ...init, headers });
  };

  // 1. Resolve the project ref exactly like script-doc.js: uuid = direct id, else slug lookup.
  let pid = null;
  if (UUID_RE.test(projectRef)) {
    pid = projectRef;
  } else {
    const r = await sb(`/rest/v1/script_projects?slug=eq.${pgrValue(projectRef)}&select=id&limit=1`);
    if (!r.ok) return { outcome: 'db-read-failed', retryable: true };
    const rows = await r.json().catch(() => []);
    pid = rows.length ? rows[0].id : null;
  }
  if (!pid) return { outcome: 'unknown-project', projectRef };

  // 2. Pull the room's converged Y.Doc. A transient Liveblocks failure is retryable; a 404 (room
  //    deleted between event and delivery) is a clean skip.
  const yRes = await fetchImpl(`${LIVEBLOCKS_API}/v2/rooms/${encodeURIComponent(roomId)}/ydoc-binary`, {
    headers: { Authorization: `Bearer ${liveblocksSecret}` },
  });
  if (!yRes.ok) {
    if (yRes.status === 404) return { outcome: 'room-gone' };
    return { outcome: 'ydoc-fetch-failed', retryable: true, status: yRes.status };
  }
  let doc;
  try {
    doc = decodeYDocBinary(await yRes.arrayBuffer());
  } catch (e) {
    // Corrupt/undecodable state won't improve on retry; the next real edit fires a fresh event.
    console.warn('[liveblocks-webhook] ydoc decode failed for ' + roomId + ':', e?.message);
    return { outcome: 'decode-failed' };
  }
  if (!isMeaningfulDoc(doc)) return { outcome: 'empty-room' }; // the blank-clobber guard

  // 3. Read the stored row — the base for both the idempotency check and the CAS.
  const cur = await sb(`/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&select=doc,version`);
  if (!cur.ok) return { outcome: 'db-read-failed', retryable: true };
  const curRows = await cur.json().catch(() => []);
  const exists = curRows.length > 0;
  const stored = exists ? toVersion(curRows[0].version) : 0;

  // 4. IDEMPOTENCY — double-delivery / already-mirrored content writes nothing.
  if (exists && docsContentEqual(doc, curRows[0].doc)) {
    return { outcome: 'identical', version: stored };
  }

  // 5. The shared write gate. version = stored+1 built on base = stored always passes in memory —
  //    asserting it through the SAME isWriteAcceptable as script-doc.js keeps the contract literal,
  //    and the DB-level CAS below is what makes it atomic against a racing writer.
  const version = stored + 1;
  if (!isWriteAcceptable({ version, baseVersion: stored, stored })) {
    return { outcome: 'gate-refused', stored }; // unreachable by construction; belt anyway
  }

  const nowIso = new Date().toISOString();
  if (!exists) {
    const ins = await sb(`/rest/v1/script_docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ project_id: pid, doc, version, updated_by: null, updated_at: nowIso }),
    });
    if (ins.ok) {
      const row = (await ins.json().catch(() => []))[0];
      await appendRevision(sb, pid, doc, version);
      await touchProject(sb, pid, nowIso);
      return { outcome: 'written', inserted: true, version: toVersion(row?.version ?? version) };
    }
    // insert race — a first save landed concurrently; fall through to the guarded update.
  }

  // 6. GUARDED UPDATE — same CAS clause generator as script-doc.js (version=eq.<stored>): a writer
  //    that advanced the row between our read and this PATCH turns it into a 0-row no-op, never a
  //    stomp. We skip instead of 409ing — Liveblocks fires again and the next pass converges.
  const upd = await sb(
    `/rest/v1/script_docs?project_id=eq.${pgrValue(pid)}&${updateGuardClause({ version, baseVersion: stored })}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ doc, version, updated_by: null, updated_at: nowIso }),
    }
  );
  if (!upd.ok) return { outcome: 'db-write-failed', retryable: true };
  const updated = await upd.json().catch(() => []);
  if (!updated.length) return { outcome: 'raced', stored };

  await appendRevision(sb, pid, doc, version);
  await touchProject(sb, pid, nowIso);
  return { outcome: 'written', version: toVersion(updated[0].version) };
}

// Append-only history — same best-effort contract as script-doc.js's appendRevision: a failed
// revision write never fails the (already-durable) save. source marks it as the webhook's work.
async function appendRevision(sb, pid, doc, version) {
  try {
    await sb(`/rest/v1/script_doc_revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: pid, doc, version, source: REVISION_SOURCE, user_id: null }),
    });
  } catch {}
}

async function touchProject(sb, pid, iso) {
  try {
    await sb(`/rest/v1/script_projects?id=eq.${pgrValue(pid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: iso }),
    });
  } catch {}
}

/* ----------------------------------------------------------------- handler */

export default withSentry(async function handler(req) {
  if (req.method !== 'POST') return err(405, 'METHOD', `Method ${req.method} not allowed`);

  const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!webhookSecret) return err(503, 'NO_WEBHOOK_SECRET', 'LIVEBLOCKS_WEBHOOK_SECRET not configured');
  if (!process.env.LIVEBLOCKS_SECRET_KEY) return err(503, 'NO_LIVEBLOCKS', 'LIVEBLOCKS_SECRET_KEY not configured');
  if (!SUPABASE_URL || !SUPABASE_KEY) return err(503, 'NO_DB', 'Supabase env not configured');

  // Signature verification needs the EXACT raw bytes Liveblocks signed — req.text(), never a parsed
  // body re-stringified (key-order/whitespace drift would break the HMAC).
  const rawBody = await req.text();
  let event;
  try {
    event = verifyWebhookRequest(req.headers, rawBody, webhookSecret);
  } catch (e) {
    // Bad signature, missing svix headers, or a replayed/too-old timestamp. 401, no retry value.
    return err(401, 'BAD_SIGNATURE', e?.message || 'webhook verification failed');
  }

  if (event?.type !== 'ydocUpdated') return ok({ ignored: true, type: event?.type ?? null });

  try {
    const result = await processYDocUpdated(event.data?.roomId);
    if (result.retryable) {
      // Non-2xx -> Liveblocks re-delivers with backoff. Transient infra failures only.
      return err(502, 'TRANSIENT', result.outcome);
    }
    console.info('[liveblocks-webhook] ' + (event.data?.roomId ?? '?') + ' -> ' + result.outcome +
      (result.version ? ' v' + result.version : ''));
    return ok(result);
  } catch (e) {
    // The catch-all keeps the webhook contract clean (non-2xx -> Liveblocks re-delivers) — but it
    // also means withSentry's own catch never fires. Report explicitly: a silently-failing webhook
    // is exactly the "cloud save quietly stopped" failure this endpoint exists to prevent.
    // (No-op when SENTRY_DSN is unset.)
    await captureServerError(e, { route: 'liveblocks-webhook' });
    return err(502, 'INTERNAL', e?.message || 'unknown error');
  }
});

function ok(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function err(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
