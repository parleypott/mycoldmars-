// Locks the QUEUED-DELETE DRAIN contract of flushNoteQueue(), the offline note-sync
// drainer of the BURGUNDY reader (public/burgundy/index.html). This is a SEPARATE
// property from the reentrancy guard (flush-note-queue-reentrancy.test.mjs) and the
// mid-flush-write survival (flush-note-queue-midflush.test.mjs) — here we pin commit
// 2b54d7c ("instant highlight paint, iOS pill dock"), which added the `_delete` branch.
//
// The path this locks: when the reader deletes (or edits) a SERVER note while the
// network is flaky, the DELETE request can fail. Instead of silently losing the delete
// (leaving the note on the server to RESURRECT on the next boot reconciliation), the
// reader queues a delete row `{ _delete: <serverId>, _lid: 'local-...' }`, and
// flushNoteQueue issues the DELETE later:
//     if (row._delete) {
//       const r = await fetch(`${API}?id=${row._delete}`, { method: 'DELETE' });
//       if (r.ok || r.status === 404) sentLids.add(row._lid);   // 404 = already gone
//       continue;                                               // never POST a delete row
//     }
// The invariants: a queued delete DRAINS on ok/404, is RETAINED (retried) on a real
// failure (5xx / network throw) so the deleted note can't come back, and is issued as a
// DELETE — never POSTed as a brand-new note (which would create a garbage `{_delete}` row
// server-side). A delete and a save in the same queue drain independently.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

const qm = html.match(/function queuedNotes\(\)\s*\{[^\n]*\}/);
const fm = html.match(/let flushingQueue = false;\nasync function flushNoteQueue\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(qm, 'could not extract queuedNotes() — did index.html change?');
assert.ok(fm, 'could not extract flushNoteQueue() — did index.html change?');
// Guard against a silent revert that drops queued-delete handling: the fix MUST branch
// on row._delete and issue a DELETE for it, otherwise a delete row gets POSTed as a note.
assert.ok(
  /if \(row\._delete\)/.test(fm[0]) && /method: 'DELETE' \}\)/.test(fm[0]),
  'flushNoteQueue no longer handles queued `_delete` rows — the queued-delete drain was reverted',
);

let pass = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// Sandbox: inject every free var flushNoteQueue references. `deleteResults` maps a
// server id → { ok, status } (or 'throw') to control what each DELETE returns; `failIds`
// marks POST ids that return !ok. Every request is recorded as `<METHOD> <id>`.
function makeSandbox(flushBody, initialQueue, { deleteResults = {}, failIds = [] } = {}) {
  const store = new Map([['bg-note-queue', JSON.stringify(initialQueue)]]);
  const safeGet = (k) => (store.has(k) ? store.get(k) : null);
  const safeSet = (k, v) => { store.set(k, v); };
  const navigator = { onLine: true };
  const API = '/api/burgundy-notes';
  let NOTES = [];
  const readerId = () => 'r1';
  const rerenderMarks = () => {};
  const calls = [];
  const fetchMock = async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'DELETE') {
      const id = new URLSearchParams(url.split('?')[1]).get('id');
      calls.push(`DELETE ${id}`);
      const res = deleteResults[id];
      if (res === 'throw') throw new Error('network down');
      if (res) return { ok: !!res.ok, status: res.status || (res.ok ? 200 : 500) };
      return { ok: true, status: 200 }; // default: server accepted the delete
    }
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      calls.push(`POST ${body.id ?? '(new)'}`);
      const okFlag = !failIds.includes(body.id);
      return { ok: okFlag, json: async () => ({ note: { id: body.id } }) };
    }
    return { ok: true, json: async () => ({ notes: [] }) };
  };
  const src = `${qm[0]}\n${flushBody}\nreturn { flushNoteQueue };`;
  const factory = new Function(
    'safeGet', 'safeSet', 'navigator', 'fetch', 'API', 'NOTES', 'readerId', 'rerenderMarks',
    src,
  );
  const api = factory(safeGet, safeSet, navigator, fetchMock, API, NOTES, readerId, rerenderMarks);
  return { ...api, store, calls, queue: () => JSON.parse(store.get('bg-note-queue')) };
}

// Pre-2b54d7c reconstruction: NO `_delete` branch — every row is POSTed. A queued delete
// row is sent as a brand-new note (garbage), and its DELETE never happens → the note the
// reader deleted survives on the server. The load-bearing wrong behavior.
const noDeleteBranchFlush = `
let flushingQueue = false;
async function flushNoteQueue() {
  if (flushingQueue) return;
  const q = queuedNotes();
  if (!q.length || !navigator.onLine) return;
  flushingQueue = true;
  try {
    const sentLids = new Set();
    for (const row of q) {
      try {
        const { _lid, ...clean } = row;
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean) });
        if (r.ok) sentLids.add(row._lid);
      } catch {}
    }
    const still = queuedNotes().filter(row => !sentLids.has(row._lid));
    safeSet('bg-note-queue', JSON.stringify(still));
  } finally { flushingQueue = false; }
}`;

const delRow = (serverId, lid) => ({ _delete: serverId, _lid: lid });

// 1. REAL: a queued delete whose DELETE succeeds is issued as a DELETE and drains.
{
  const sb = makeSandbox(fm[0], [delRow(42, 'local-d1')]);
  await sb.flushNoteQueue();
  eq(sb.calls.join(','), 'DELETE 42', 'real: the queued delete was issued as a DELETE for the server id');
  eq(sb.queue().length, 0, 'real: the drained delete was removed from the queue');
}

// 2. REAL: a 404 (already gone server-side) also counts as drained — no infinite retry.
{
  const sb = makeSandbox(fm[0], [delRow(7, 'local-d2')], { deleteResults: { 7: { ok: false, status: 404 } } });
  await sb.flushNoteQueue();
  eq(sb.calls.join(','), 'DELETE 7', 'real: 404 delete still attempted once');
  eq(sb.queue().length, 0, 'real: a 404 delete is treated as done (the note is already gone)');
}

// 3. REAL: a 5xx delete is RETAINED so the deleted note cannot resurrect — retried later.
{
  const sb = makeSandbox(fm[0], [delRow(9, 'local-d3')], { deleteResults: { 9: { ok: false, status: 500 } } });
  await sb.flushNoteQueue();
  const q = sb.queue();
  eq(q.length, 1, 'real: a failed (5xx) delete is kept for retry');
  eq(q[0]._delete, 9, 'real: the retained row is still the delete for id 9');
}

// 4. REAL: a delete whose request THROWS (network dead) is likewise retained.
{
  const sb = makeSandbox(fm[0], [delRow(11, 'local-d4')], { deleteResults: { 11: 'throw' } });
  await sb.flushNoteQueue();
  eq(sb.queue().length, 1, 'real: a thrown delete is kept (never silently lost)');
}

// 5. REAL: a save row and a delete row in one queue drain INDEPENDENTLY and by the right
//    method — the save is POSTed, the delete is DELETEd; a failed delete stays behind.
{
  const sb = makeSandbox(fm[0], [
    { id: 'note-a', _lid: 'local-a', quote: 'hi' },
    delRow(88, 'local-del'),
  ], { deleteResults: { 88: { ok: false, status: 503 } } });
  await sb.flushNoteQueue();
  eq(sb.calls.join(','), 'POST note-a,DELETE 88', 'real: save POSTed, delete DELETEd — right method each');
  const lids = sb.queue().map(r => r._lid).sort();
  eq(lids.join(','), 'local-del', 'real: the sent save drained; only the failed delete is retried');
}

// 6. LOAD-BEARING (pre-fix): with NO `_delete` branch, the delete row is POSTed as a new
//    note and never DELETEd — proving the branch is what makes deletes actually delete.
{
  const sb = makeSandbox(noDeleteBranchFlush, [delRow(42, 'local-d1')]);
  await sb.flushNoteQueue();
  ok(sb.calls.join(',').startsWith('POST'), 'buggy: without the branch, a delete row is POSTed as a note');
  eq(sb.calls.some(c => c.startsWith('DELETE')), false, 'buggy: no DELETE ever issued — the note survives on the server');
}

console.log(`flush-note-queue-delete-drain: ${pass} passed, 0 failed`);
