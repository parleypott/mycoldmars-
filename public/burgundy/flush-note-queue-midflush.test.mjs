// Locks the MID-FLUSH-WRITE SURVIVAL contract of flushNoteQueue(), the offline
// note-sync drainer of the BURGUNDY reader (public/burgundy/index.html). This is a
// SEPARATE property from the reentrancy guard (that lives in
// flush-note-queue-reentrancy.test.mjs) — here we pin commit 1b6559f ("audit critical 1").
//
// The bug this locks: flushNoteQueue snapshots the queue (`const q = queuedNotes()`),
// then POSTs each row across `await` points. A user can write a NEW note DURING that
// flush (saveNote's offline path calls queueNote → safeSet('bg-note-queue', ...)), so
// the fresh queue on disk = [old rows..., NEW]. The OLD code wrote back a value derived
// ONLY from the stale snapshot `q` (`safeSet('bg-note-queue', JSON.stringify(still))`),
// silently CLOBBERING the note written mid-flush — permanent local data loss of a note
// in Johnny's private novel margin. The fix re-reads the LIVE queue after the loop and
// removes only the lids that actually sent:
//   const still = queuedNotes().filter(row => !sentLids.has(row._lid));
// so a mid-flush note survives, and a failed-send row is still retried.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// Slice the real queuedNotes() + the real flushNoteQueue() (with its guard flag) verbatim.
const qm = html.match(/function queuedNotes\(\)\s*\{[^\n]*\}/);
const fm = html.match(/let flushingQueue = false;\nasync function flushNoteQueue\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(qm, 'could not extract queuedNotes() — did index.html change?');
assert.ok(fm, 'could not extract flushNoteQueue() — did index.html change?');
// Guard against a silent revert to the snapshot-writeback form: the fix MUST re-read
// the live queue after the send loop, not write back a value built only from `q`.
assert.ok(
  /queuedNotes\(\)\.filter\(row => !sentLids\.has\(row\._lid\)\)/.test(fm[0]),
  'flushNoteQueue no longer re-reads the live queue after sending — the mid-flush-write fix was reverted',
);

let pass = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// Sandbox: inject every free var flushNoteQueue references. `midWrite` (optional) fires
// on the FIRST POST to simulate a user writing a note DURING the flush; `failIds` marks
// rows whose POST returns !ok (to prove failed rows are retried, not dropped).
function makeSandbox(flushBody, initialQueue, { midWrite = null, failIds = [] } = {}) {
  const store = new Map([['bg-note-queue', JSON.stringify(initialQueue)]]);
  const safeGet = (k) => (store.has(k) ? store.get(k) : null);
  const safeSet = (k, v) => { store.set(k, v); };
  const navigator = { onLine: true };
  const API = '/api/burgundy-notes';
  let NOTES = [];
  const readerId = () => 'r1';
  const rerenderMarks = () => {};
  const posted = [];
  let firstPost = true;
  const fetchMock = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      await Promise.resolve(); // yield so a mid-flush write can land before we resolve
      if (firstPost && midWrite) { midWrite(store, safeGet, safeSet); }
      firstPost = false;
      const body = JSON.parse(opts.body);
      posted.push(body.id);
      const okFlag = !failIds.includes(body.id);
      return { ok: okFlag, json: async () => ({ note: { id: body.id } }) };
    }
    return { ok: true, json: async () => ({ notes: [] }) }; // the ?page=0 refetch
  };
  const src = `${qm[0]}\n${flushBody}\nreturn { flushNoteQueue };`;
  const factory = new Function(
    'safeGet', 'safeSet', 'navigator', 'fetch', 'API', 'NOTES', 'readerId', 'rerenderMarks',
    src,
  );
  const api = factory(safeGet, safeSet, navigator, fetchMock, API, NOTES, readerId, rerenderMarks);
  return { ...api, store, posted, queue: () => JSON.parse(store.get('bg-note-queue')) };
}

// Pre-1b6559f reconstruction: writes back a snapshot-derived value → the load-bearing bug.
const buggyFlush = `
let flushingQueue = false;
async function flushNoteQueue() {
  if (flushingQueue) return;
  const q = queuedNotes();
  if (!q.length || !navigator.onLine) return;
  flushingQueue = true;
  try {
    const still = [];
    for (const row of q) {
      try {
        const { _lid, ...clean } = row;
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean) });
        if (!r.ok) still.push(row);
      } catch { still.push(row); }
    }
    safeSet('bg-note-queue', JSON.stringify(still));
    if (q.length !== still.length) { try { const d = await (await fetch(API + '?page=0')).json(); NOTES = (d.notes || []).filter(n => n.reader === readerId()); rerenderMarks(); } catch {} }
  } finally { flushingQueue = false; }
}`;

// A note that lands in the queue DURING the flush (user saved offline mid-drain).
const enqueueMid = (store, safeGet, safeSet) => {
  const cur = JSON.parse(safeGet('bg-note-queue'));
  cur.push({ id: 'mid', _lid: 'local-mid', text: 'written during the flush' });
  safeSet('bg-note-queue', JSON.stringify(cur));
};

const oneRow = [{ id: 'a', _lid: 'local-a', text: 'A' }];

// 1. REAL: a note written mid-flush SURVIVES; the sent row is drained.
{
  const sb = makeSandbox(fm[0], oneRow, { midWrite: enqueueMid });
  await sb.flushNoteQueue();
  eq(sb.posted.join(','), 'a', 'real: only the snapshotted row was POSTed');
  const q = sb.queue();
  eq(q.length, 1, 'real: exactly one row remains after flush (the mid-flush note)');
  eq(q[0]._lid, 'local-mid', 'real: the note written DURING the flush survived');
  eq(q.some(r => r._lid === 'local-a'), false, 'real: the successfully-sent row was removed');
}

// 2. BUGGY (pre-fix): the mid-flush note is CLOBBERED by the snapshot writeback.
//    These asserts pass ONLY because the old form is wrong — the load-bearing proof.
{
  const sb = makeSandbox(buggyFlush, oneRow, { midWrite: enqueueMid });
  await sb.flushNoteQueue();
  eq(sb.queue().length, 0, 'buggy: snapshot writeback wiped the queue (mid-flush note LOST)');
}

// 3. REAL: a failed-send row is KEPT (retry survives), even alongside a mid-flush write.
{
  const sb = makeSandbox(fm[0], [{ id: 'a', _lid: 'local-a' }, { id: 'b', _lid: 'local-b' }], {
    failIds: ['b'], midWrite: enqueueMid,
  });
  await sb.flushNoteQueue();
  const lids = sb.queue().map(r => r._lid).sort();
  eq(lids.join(','), 'local-b,local-mid', 'real: failed row b retried + mid-flush note both kept; sent row a dropped');
}

// 4. REAL: plain happy path (no mid-write, all send) fully drains — zero regression.
{
  const sb = makeSandbox(fm[0], [{ id: 'a', _lid: 'local-a' }, { id: 'b', _lid: 'local-b' }]);
  await sb.flushNoteQueue();
  eq(sb.posted.join(','), 'a,b', 'real: both rows POSTed');
  eq(sb.queue().length, 0, 'real: queue fully drained when nothing is written mid-flush');
}

// 5. REAL: the POST body strips the client-only _lid (server never sees it).
{
  let sawLid = false;
  const store = new Map([['bg-note-queue', JSON.stringify(oneRow)]]);
  const safeGet = (k) => (store.has(k) ? store.get(k) : null);
  const safeSet = (k, v) => store.set(k, v);
  const navigator = { onLine: true };
  const fetchMock = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      if ('_lid' in JSON.parse(opts.body)) sawLid = true;
      return { ok: true, json: async () => ({ note: {} }) };
    }
    return { ok: true, json: async () => ({ notes: [] }) };
  };
  const factory = new Function(
    'safeGet', 'safeSet', 'navigator', 'fetch', 'API', 'NOTES', 'readerId', 'rerenderMarks',
    `${qm[0]}\n${fm[0]}\nreturn { flushNoteQueue };`,
  );
  const { flushNoteQueue } = factory(safeGet, safeSet, navigator, fetchMock, '/api/burgundy-notes', [], () => 'r1', () => {});
  await flushNoteQueue();
  eq(sawLid, false, 'real: _lid is destructured out of the POST body — server never receives the client-only id');
}

console.log(`flush-note-queue-midflush: ${pass} assertions passed`);
