/**
 * Tests for the Liveblocks -> Supabase persistence webhook — api/liveblocks-webhook.js.
 * Covers the four load-bearing behaviors: svix-style signature verification (valid / tampered /
 * replayed), room->project mapping, idempotent double-delivery, and the version-CAS write gates —
 * all against a stubbed fetch (no network, no DB, no Liveblocks).
 *
 * Run: bun api/liveblocks-webhook.test.mjs
 */
import crypto from 'node:crypto';
import * as Y from 'yjs';

const {
  roomToProjectRef, stableStringify, docsContentEqual, isMeaningfulDoc,
  decodeYDocBinary, verifyWebhookRequest, processYDocUpdated,
} = await import('./liveblocks-webhook.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

/* ---- room -> project mapping (must track collabRoomId()'s `script-<ref>` shape) ---- */
eq(roomToProjectRef('script-burma'), 'burma', 'm1. burma room -> burma project ref (slug)');
eq(roomToProjectRef('script-palau2'), 'palau2', 'm2. generalized slug room maps');
eq(roomToProjectRef('script-9b58c466-d083-4ed7-8e6f-cc13184adad8'), '9b58c466-d083-4ed7-8e6f-cc13184adad8',
  'm3. library-uuid room maps to the uuid ref');
eq(roomToProjectRef('lobby'), null, 'm4. non-script room ignored');
eq(roomToProjectRef('script-'), null, 'm5. empty ref rejected (auth-endpoint shape law)');
eq(roomToProjectRef('script-bad room!'), null, 'm6. junk chars rejected');
eq(roomToProjectRef('script-' + 'a'.repeat(200)), null, 'm7. overlong ref rejected');
eq(roomToProjectRef(null), null, 'm8. null never throws');

/* ---- content equality (the idempotency core; jsonb key reorder must not read as an edit) ---- */
{
  const a = { type: 'doc', content: [{ type: 'p', attrs: { x: 1, y: 2 } }] };
  const b = { content: [{ attrs: { y: 2, x: 1 }, type: 'p' }], type: 'doc' }; // reordered keys
  ok(docsContentEqual(a, b), 'i1. key-reordered same content -> equal');
  ok(!docsContentEqual(a, { type: 'doc', content: [] }), 'i2. different content -> not equal');
  ok(!docsContentEqual(a, null), 'i3. null side -> not equal (write proceeds)');
  eq(stableStringify({ b: 1, a: [2, null] }), '{"a":[2,null],"b":1}', 'i4. stable sorted-key serialization');
}

/* ---- empty-room guard (the server-side blank-clobber refusal) ---- */
ok(!isMeaningfulDoc(null), 'e1. null doc refused');
ok(!isMeaningfulDoc({ type: 'doc' }), 'e2. fragment-less decode refused');
ok(!isMeaningfulDoc({ type: 'doc', content: [] }), 'e3. empty room refused');
ok(isMeaningfulDoc({ type: 'doc', content: [{ type: 'paragraph' }] }), 'e4. real content accepted');

/* ---- Y.Doc binary -> ProseMirror JSON (fragment "default", the field Collaboration binds) ---- */
function makeYDocBinary(text, field = 'default') {
  const d = new Y.Doc();
  const frag = d.getXmlFragment(field);
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.insert(0, [p]);
  const buf = Y.encodeStateAsUpdate(d);
  d.destroy();
  return buf;
}
{
  const json = decodeYDocBinary(makeYDocBinary('hello burma'));
  eq(json?.content?.[0]?.type, 'paragraph', 'y1. decodes fragment "default" to PM JSON');
  eq(json?.content?.[0]?.content?.[0]?.text, 'hello burma', 'y2. text survives the round trip');
  const empty = decodeYDocBinary(makeYDocBinary('x', 'other-field'));
  ok(!isMeaningfulDoc(empty), 'y3. content on a different field decodes as empty on "default"');
}

/* ---- signature verification (svix-style: webhook-id / webhook-timestamp / webhook-signature) ---- */
const SECRET_B64 = crypto.randomBytes(24).toString('base64');
const SECRET = 'whsec_' + SECRET_B64;
function signedHeaders(rawBody, { id = 'msg_1', ts = Math.floor(Date.now() / 1000), sig = null } = {}) {
  const mac = crypto.createHmac('sha256', Buffer.from(SECRET_B64, 'base64'));
  mac.update(`${id}.${ts}.${rawBody}`);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': sig ?? 'v1,' + mac.digest('base64'),
  };
}
const EVENT_BODY = JSON.stringify({
  type: 'ydocUpdated',
  data: { projectId: 'proj', roomId: 'script-burma', updatedAt: '2026-07-07T00:00:00.000Z' },
});
{
  const event = verifyWebhookRequest(signedHeaders(EVENT_BODY), EVENT_BODY, SECRET);
  eq(event.type, 'ydocUpdated', 's1. valid signature verifies and parses the event');
  eq(event.data.roomId, 'script-burma', 's2. roomId carried through');
}
{
  let threw = false;
  try { verifyWebhookRequest(signedHeaders(EVENT_BODY, { sig: 'v1,AAAAinvalidAAAA=' }), EVENT_BODY, SECRET); }
  catch { threw = true; }
  ok(threw, 's3. tampered signature rejected');
}
{
  let threw = false;
  const tampered = EVENT_BODY.replace('script-burma', 'script-other');
  try { verifyWebhookRequest(signedHeaders(EVENT_BODY), tampered, SECRET); }
  catch { threw = true; }
  ok(threw, 's4. signature over a DIFFERENT body rejected (body swap)');
}
{
  let threw = false;
  try {
    const old = Math.floor(Date.now() / 1000) - 600; // beyond the 5-minute svix tolerance
    verifyWebhookRequest(signedHeaders(EVENT_BODY, { ts: old }), EVENT_BODY, SECRET);
  } catch { threw = true; }
  ok(threw, 's5. replayed (too-old) timestamp rejected even with a valid signature');
}
{
  let threw = false;
  try {
    const future = Math.floor(Date.now() / 1000) + 600;
    verifyWebhookRequest(signedHeaders(EVENT_BODY, { ts: future }), EVENT_BODY, SECRET);
  } catch { threw = true; }
  ok(threw, 's6. future timestamp rejected');
}

/* ---- processYDocUpdated against a stubbed fetch: the version-CAS write pipeline ---- */
const PID = '267bb0ec-215c-45bb-9a18-c2c5d4a68ef5';
const ROOM_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello burma' }] }] };

// One stub per scenario. Routes by URL substring, records every call, and answers from `state`.
function makeStub(state) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    const res = (status, body, binary = null) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      arrayBuffer: async () => binary,
      text: async () => JSON.stringify(body),
    });
    if (url.includes('/v2/rooms/')) {
      if (state.ydocStatus && state.ydocStatus !== 200) return res(state.ydocStatus, {});
      return res(200, null, state.ydocBinary.buffer.slice(state.ydocBinary.byteOffset, state.ydocBinary.byteOffset + state.ydocBinary.byteLength));
    }
    if (url.includes('/rest/v1/script_projects?slug=eq.')) {
      return res(200, state.slugRows ?? [{ id: PID }]);
    }
    if (url.includes('/rest/v1/script_docs?project_id=') && method === 'GET') {
      return res(200, state.storedRows);
    }
    if (url.includes('/rest/v1/script_docs?project_id=') && method === 'PATCH') {
      return res(200, state.patchResult);
    }
    if (url.endsWith('/rest/v1/script_docs') && method === 'POST') {
      return res(201, [{ version: init.body ? JSON.parse(init.body).version : 0 }]);
    }
    if (url.includes('/rest/v1/script_doc_revisions')) return res(201, []);
    if (url.includes('/rest/v1/script_projects?id=eq.')) return res(204, []);
    throw new Error('unexpected fetch: ' + method + ' ' + url);
  };
  return { calls, fetchImpl };
}
const DEPS = (stub) => ({ fetchImpl: stub.fetchImpl, liveblocksSecret: 'sk_test', supabaseUrl: 'https://db.test', supabaseKey: 'svc' });

// c1 — the happy path: stored v5, differing content -> CAS PATCH eq.5, write v6, revision appended.
{
  const stub = makeStub({
    ydocBinary: makeYDocBinary('hello burma'),
    storedRows: [{ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'OLD' }] }] }, version: 5 }],
    patchResult: [{ version: 6 }],
  });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'written', 'c1a. differing room content is written');
  eq(r.version, 6, 'c1b. version advances to stored+1');
  const patch = stub.calls.find((c) => c.method === 'PATCH' && c.url.includes('script_docs'));
  ok(patch && patch.url.includes('version=eq.5'), 'c1c. DB write is a TRUE CAS on the stored version (eq.5, never lt.)');
  eq(patch.body.version, 6, 'c1d. patched row carries stored+1');
  eq(patch.body.updated_by, null, 'c1e. webhook writes are unattributed (updated_by null)');
  const rev = stub.calls.find((c) => c.url.includes('script_doc_revisions'));
  ok(!!rev, 'c1f. accepted write appends an append-only revision row');
  eq(rev.body.source, 'collab-webhook', 'c1g. revision source marks the webhook');
  eq(rev.body.version, 6, 'c1h. revision version matches the accepted write');
  ok(stub.calls.some((c) => c.url.includes('script_projects?id=eq.') && c.method === 'PATCH'),
    'c1i. project updated_at touched');
}

// c2 — IDEMPOTENT DOUBLE-DELIVERY: stored content identical (even with jsonb-reordered keys) -> skip.
{
  const reordered = JSON.parse(stableStringify(ROOM_DOC)); // same content, canonical key order
  const stub = makeStub({
    ydocBinary: makeYDocBinary('hello burma'),
    storedRows: [{ doc: reordered, version: 9 }],
  });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'identical', 'c2a. duplicate delivery skips the write');
  eq(r.version, 9, 'c2b. reports the standing version');
  ok(!stub.calls.some((c) => c.method === 'PATCH' && c.url.includes('script_docs')), 'c2c. no doc write on duplicate');
  ok(!stub.calls.some((c) => c.url.includes('script_doc_revisions')), 'c2d. no revision row on duplicate');
}

// c3 — RACED WRITER: a concurrent writer advanced the row between read and PATCH -> 0 rows -> skip,
// never a stomp (the same-gate guarantee: the CAS eq.<stored> filter matched nothing).
{
  const stub = makeStub({
    ydocBinary: makeYDocBinary('hello burma'),
    storedRows: [{ doc: { type: 'doc', content: [{ type: 'paragraph' }] }, version: 5 }],
    patchResult: [],
  });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'raced', 'c3a. lost CAS race skips cleanly');
  ok(!r.retryable, 'c3b. race is NOT retried (next ydocUpdated carries the converged doc)');
  ok(!stub.calls.some((c) => c.url.includes('script_doc_revisions')), 'c3c. no revision row on a refused write');
}

// c4 — EMPTY ROOM: an unseeded/blank room must never clobber the cloud doc.
{
  const stub = makeStub({
    ydocBinary: makeYDocBinary('x', 'not-the-default-field'), // "default" fragment decodes empty
    storedRows: [{ doc: ROOM_DOC, version: 12 }],
  });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'empty-room', 'c4a. empty room skipped');
  ok(!stub.calls.some((c) => c.method === 'PATCH' || c.method === 'POST'), 'c4b. zero writes on empty room');
}

// c5 — FIRST SAVE: no stored row -> INSERT at v1 (stored 0 + 1), with a revision from the very first save.
{
  const stub = makeStub({ ydocBinary: makeYDocBinary('hello burma'), storedRows: [] });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'written', 'c5a. first save inserts');
  ok(r.inserted === true, 'c5b. reports insert path');
  eq(r.version, 1, 'c5c. first version is 1');
  ok(stub.calls.some((c) => c.url.includes('script_doc_revisions')), 'c5d. history starts at the first save');
}

// c6 — mapping edges through the full pipeline.
{
  const r = await processYDocUpdated('lobby', DEPS(makeStub({})));
  eq(r.outcome, 'ignored-room', 'c6a. non-script room ignored before any fetch');
}
{
  const stub = makeStub({ ydocBinary: makeYDocBinary('x'), slugRows: [] });
  const r = await processYDocUpdated('script-nope', DEPS(stub));
  eq(r.outcome, 'unknown-project', 'c6b. unknown slug -> clean skip (no retry value)');
}
{
  // uuid room: resolves directly, never hits the slug lookup.
  const stub = makeStub({ ydocBinary: makeYDocBinary('hello burma'), storedRows: [], patchResult: [] });
  await processYDocUpdated('script-' + PID, DEPS(stub));
  ok(!stub.calls.some((c) => c.url.includes('script_projects?slug=eq.')), 'c6c. uuid ref skips slug resolution');
}

// c7 — transient Liveblocks failure is marked retryable (handler maps it to a non-2xx so Liveblocks
// re-delivers); a 404 room is a clean non-retryable skip.
{
  const stub = makeStub({ ydocBinary: makeYDocBinary('x'), ydocStatus: 500 });
  const r = await processYDocUpdated('script-burma', DEPS(stub));
  eq(r.outcome, 'ydoc-fetch-failed', 'c7a. ydoc 5xx surfaces');
  ok(r.retryable === true, 'c7b. ...and is retryable');
  const gone = makeStub({ ydocBinary: makeYDocBinary('x'), ydocStatus: 404 });
  const r2 = await processYDocUpdated('script-burma', DEPS(gone));
  eq(r2.outcome, 'room-gone', 'c7c. deleted room skips without retry');
}

/* ---- n. Vercel Node adapter (the FUNCTION_INVOCATION_FAILED regression, 2026-07-08) ---- */
// runtime:'nodejs' invokes default(IncomingMessage, ServerResponse) — the web-shaped handler
// crashed at req.text() on EVERY delivery. The adapter must bridge Node->web, end the response,
// and verify the svix HMAC over the EXACT raw stream bytes (Buffer-concat, no utf8 chunk seams).
{
  // handler() checks module-level SUPABASE consts — arm env, then cache-bust reimport.
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'stub-key';
  process.env.LIVEBLOCKS_WEBHOOK_SECRET = SECRET;
  process.env.LIVEBLOCKS_SECRET_KEY = process.env.LIVEBLOCKS_SECRET_KEY || 'sk_stub';
  const { default: nodeHandler } = await import('./liveblocks-webhook.js?node-adapter-test');

  function makeNodeReq({ method = 'POST', headers = {}, bodyChunks = [] } = {}) {
    return {
      method,
      url: '/api/liveblocks-webhook',
      headers: { host: 'test.local', 'x-forwarded-proto': 'https', ...headers },
      readableEnded: false,
      body: undefined,
      on(ev, cb) {
        if (ev === 'data') setImmediate(() => { for (const c of bodyChunks) cb(Buffer.from(c)); });
        if (ev === 'end') setImmediate(() => setImmediate(cb)); // after all data ticks
      },
    };
  }
  function makeNodeRes() {
    const res = { statusCode: 0, headers: {}, body: null, ended: false };
    res.setHeader = (k, v) => { res.headers[String(k).toLowerCase()] = v; };
    res.end = (buf) => { res.body = buf ? buf.toString('utf8') : ''; res.ended = true; };
    return res;
  }

  { // unsigned POST -> 401 BAD_SIGNATURE, written through `res` (no hang, no throw)
    const res = makeNodeRes();
    await nodeHandler(makeNodeReq({ bodyChunks: ['{}'] }), res);
    ok(res.ended, 'n1. node-style invocation ends the response (the crash regression)');
    eq(res.statusCode, 401, 'n2. unsigned delivery -> 401 through the adapter');
    eq(JSON.parse(res.body)?.error?.code, 'BAD_SIGNATURE', 'n3. ...with code BAD_SIGNATURE');
  }

  { // signed non-ydocUpdated event: HMAC must verify over raw bytes read from the stream —
    // multibyte content split MID-CHARACTER across chunks proves Buffer-concat fidelity.
    const body = JSON.stringify({ type: 'roomCreated', data: { roomId: 'x', note: 'émojis 🦉' } });
    const bytes = Buffer.from(body, 'utf8');
    const cut = body.indexOf('é') >= 0 ? Buffer.byteLength(body.slice(0, body.indexOf('é'))) + 1 : 10;
    const chunks = [bytes.subarray(0, cut), bytes.subarray(cut)]; // seam inside the é bytes
    const res = makeNodeRes();
    await nodeHandler(makeNodeReq({ headers: signedHeaders(body), bodyChunks: chunks }), res);
    eq(res.statusCode, 200, 'n4. signed event verifies over exact raw stream bytes (chunk-seam safe)');
    eq(JSON.parse(res.body)?.ignored, true, 'n5. ...and a non-ydocUpdated type is acknowledged-ignored');
  }

  { // GET through the adapter -> clean 405 (used to crash before reaching the method check)
    const res = makeNodeRes();
    await nodeHandler(makeNodeReq({ method: 'GET' }), res);
    eq(res.statusCode, 405, 'n6. GET -> 405 through the adapter');
  }
}

console.log(`\nliveblocks-webhook: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
