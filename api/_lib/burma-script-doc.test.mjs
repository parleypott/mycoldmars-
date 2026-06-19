/**
 * Tests for the CLOUD SYNC serverless API — api/burma-script-doc.js.
 *
 * Proves the optimistic-concurrency contract that protects Johnny's doc:
 *   • GET on empty            -> { doc:null, version:0 }
 *   • first PUT               -> insert, returns stored { version }
 *   • PUT strictly newer      -> accepted, returns new { version }
 *   • PUT stale (<= stored)   -> 409 with the CURRENT { doc, version } (so the client reconciles)
 *   • env not configured      -> 500 NO_DB (same shape as burma-essays)
 *
 * The handler talks to Supabase via fetch(`${SUPABASE_URL}/rest/v1/...`). We stub globalThis.fetch
 * with a tiny in-memory PostgREST that honours the version=lt.<n> guard the handler relies on, so the
 * concurrency logic is exercised end-to-end without a live database.
 *
 * Run: bun api/_lib/burma-script-doc.test.mjs   (auto-discovered by `bun run test`)
 */

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

// ── in-memory PostgREST over a single row keyed by id ───────────────────────────────────────────
function makeDb() {
  const rows = new Map(); // id -> { id, doc, version, updated_at }
  async function fetchImpl(url, init = {}) {
    const u = new URL(url, 'http://sb.local');
    const method = (init.method || 'GET').toUpperCase();
    const params = u.searchParams;
    // id=eq.<id>
    const idEq = params.get('id'); // "eq.wp01-burma"
    const id = idEq ? decodeURIComponent(idEq.replace(/^eq\./, '')) : null;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (method === 'GET') {
      const row = id ? rows.get(id) : null;
      return json(row ? [{ doc: row.doc, version: row.version }] : []);
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      if (rows.has(body.id)) return json({ message: 'duplicate key' }, 409); // PK conflict
      const row = { id: body.id, doc: body.doc, version: body.version, updated_at: new Date().toISOString() };
      rows.set(body.id, row);
      return json([row]);
    }
    if (method === 'PATCH') {
      // honour the version=lt.<n> guard exactly like PostgREST: only patch if stored < n.
      const ltRaw = params.get('version'); // "lt.<n>"
      const lt = ltRaw ? Number(decodeURIComponent(ltRaw.replace(/^lt\./, ''))) : Infinity;
      const row = id ? rows.get(id) : null;
      if (!row || !(row.version < lt)) return json([]); // 0 rows updated
      const patch = JSON.parse(init.body);
      Object.assign(row, patch);
      return json([row]);
    }
    return json({ message: 'unhandled' }, 500);
  }
  return { rows, fetchImpl };
}

const DOC = (t) => ({ type: 'doc', content: [{ type: 'p', text: t }] });
const callJson = async (handler, method, body) => {
  const req = new Request('http://app.local/api/burma-script-doc', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handler(req);
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
};

// ── configured handler (env set BEFORE import so the module captures it) ─────────────────────────
process.env.SUPABASE_URL = 'http://sb.local';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const db = makeDb();
globalThis.fetch = db.fetchImpl;

const mod = await import('../burma-script-doc.js');
const handler = mod.default;

// GET empty -> { doc:null, version:0 }
{
  const { status, body } = await callJson(handler, 'GET');
  eq(status, 200, 'g1. GET on empty is 200');
  ok(body.doc === null && body.version === 0, 'g1b. empty cloud -> { doc:null, version:0 }');
}

// first PUT (version 1) -> insert, returns version 1
{
  const { status, body } = await callJson(handler, 'PUT', { doc: DOC('first'), version: 1 });
  eq(status, 200, 'p1. first PUT accepted');
  eq(body.version, 1, 'p1b. returns stored version 1');
  eq(db.rows.get('wp01-burma').version, 1, 'p1c. row landed at v1');
}

// GET now returns the stored doc + version
{
  const { body } = await callJson(handler, 'GET');
  eq(body.version, 1, 'g2. GET returns version 1');
  eq(JSON.stringify(body.doc), JSON.stringify(DOC('first')), 'g2b. GET returns the stored doc');
}

// PUT strictly newer (version 2) -> accepted
{
  const { status, body } = await callJson(handler, 'PUT', { doc: DOC('second'), version: 2 });
  eq(status, 200, 'p2. strictly-newer PUT accepted');
  eq(body.version, 2, 'p2b. advances to version 2');
  eq(JSON.stringify(db.rows.get('wp01-burma').doc), JSON.stringify(DOC('second')), 'p2c. doc updated');
}

// STALE PUT (version 2 again, == stored) -> 409 with current { doc, version }
{
  const { status, body } = await callJson(handler, 'PUT', { doc: DOC('stale-equal'), version: 2 });
  eq(status, 409, 'p3. equal-version PUT is 409 (not strictly newer)');
  eq(body.version, 2, 'p3b. 409 carries the current version');
  eq(JSON.stringify(body.doc), JSON.stringify(DOC('second')), 'p3c. 409 carries the current (un-stomped) doc');
  // the stale write did NOT land
  eq(JSON.stringify(db.rows.get('wp01-burma').doc), JSON.stringify(DOC('second')), 'p3d. stale doc was NOT written');
}

// STALE PUT (older version 1) -> 409, current doc preserved
{
  const { status, body } = await callJson(handler, 'PUT', { doc: DOC('older'), version: 1 });
  eq(status, 409, 'p4. older-version PUT is 409');
  eq(JSON.stringify(db.rows.get('wp01-burma').doc), JSON.stringify(DOC('second')), 'p4b. older PUT could not overwrite newer cloud');
}

// bad body -> 400
{
  const { status } = await callJson(handler, 'PUT', { doc: 'not-an-object', version: 9 });
  eq(status, 400, 'p5. non-object doc -> 400');
}
{
  const { status } = await callJson(handler, 'PUT', { doc: DOC('x'), version: 0 });
  eq(status, 400, 'p6. version 0 -> 400 (must be positive)');
}

// ── unconfigured env -> 500 NO_DB (fresh import via cache-buster after clearing env) ─────────────
{
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mod2 = await import('../burma-script-doc.js?noenv=1');
  const { status, body } = await callJson(mod2.default, 'GET');
  eq(status, 500, 'e1. no env -> 500');
  eq(body.error?.code, 'NO_DB', 'e1b. error code is NO_DB (same shape as burma-essays)');
}

console.log(`\nburma-script-doc API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
