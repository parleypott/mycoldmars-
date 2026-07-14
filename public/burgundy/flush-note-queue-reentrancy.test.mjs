// Locks the reentrancy guard on flushNoteQueue(), the offline note-sync drainer of
// the BERGUNDY reader (public/burgundy/index.html). Extracted from the shipped HTML
// at runtime so a drift in index.html breaks this test.
//
// Bug fixed + locked here: flushNoteQueue is fired from FOUR triggers — the 'online'
// event, 'visibilitychange' (foreground), a 60s setInterval heartbeat, and boot.
// Network-return and app-foreground routinely coincide on mobile, so two of those
// fire near-simultaneously. The queued rows are only cleared (safeSet('bg-note-queue'))
// AFTER every POST resolves, so before the guard a second concurrent flush read the
// SAME un-cleared queue and re-POSTed every row → permanent DUPLICATE notes in
// Johnny's private novel margin (server rows; does not self-heal). The guard
// (`if (flushingQueue) return;` + a try/finally reset) makes the second overlapping
// call bail. Happy path (a single flush) is byte-identical.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// Slice the two real functions + the shared guard flag verbatim from the shipped HTML.
const qm = html.match(/function queuedNotes\(\)\s*\{[^\n]*\}/);
const fm = html.match(/let flushingQueue = false;\nasync function flushNoteQueue\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(qm, 'could not extract queuedNotes() — did index.html change?');
assert.ok(fm, 'could not extract flushNoteQueue() + its flushingQueue guard — did index.html change?');
assert.ok(/if \(flushingQueue\) return;/.test(fm[0]), 'the reentrancy guard is GONE from flushNoteQueue');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// Build a sandbox that injects every free variable flushNoteQueue references.
// `body` is the flush source (real or a buggy no-guard reconstruction).
function makeSandbox(flushBody, initialQueue) {
  const store = new Map([['bg-note-queue', JSON.stringify(initialQueue)]]);
  const safeGet = (k) => (store.has(k) ? store.get(k) : null);
  const safeSet = (k, v) => { store.set(k, v); };
  const navigator = { onLine: true };
  const API = '/api/burgundy-notes';
  let NOTES = [];
  const paintNotes = () => {};
  const posted = []; // row ids POSTed to the server
  const fetchMock = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      await Promise.resolve(); // force a microtask yield so overlapping flushes interleave
      posted.push(JSON.parse(opts.body).id);
      return { ok: true, json: async () => ({ note: { id: JSON.parse(opts.body).id } }) };
    }
    // the q.length !== still.length refetch (GET ?page=0)
    return { ok: true, json: async () => ({ notes: [] }) };
  };
  const src = `${qm[0]}\n${flushBody}\nreturn { flushNoteQueue };`;
  const factory = new Function(
    'safeGet', 'safeSet', 'navigator', 'fetch', 'API', 'NOTES', 'paintNotes',
    src
  );
  const api = factory(safeGet, safeSet, navigator, fetchMock, API, NOTES, paintNotes);
  return { ...api, posted, store };
}

// The pre-fix reconstruction (no guard) — kept to PROVE the test is load-bearing.
const buggyFlush = `
async function flushNoteQueue() {
  const q = queuedNotes();
  if (!q.length || !navigator.onLine) return;
  const still = [];
  for (const row of q) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) });
      if (!r.ok) still.push(row);
    } catch { still.push(row); }
  }
  safeSet('bg-note-queue', JSON.stringify(still));
  if (q.length !== still.length) { try { const d = await (await fetch(API + '?page=0')).json(); NOTES = d.notes || NOTES; paintNotes(); } catch {} }
}`;

const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

// 1. REAL (guarded): two concurrent flushes POST each row EXACTLY ONCE.
{
  const sb = makeSandbox(fm[0], queue);
  await Promise.all([sb.flushNoteQueue(), sb.flushNoteQueue()]); // fire both without awaiting the first
  eq(sb.posted.length, 3, 'guarded: exactly 3 POSTs for 3 queued rows across two concurrent flushes');
  eq(sb.posted.filter(x => x === 'a').length, 1, 'guarded: row a POSTed once');
  eq(sb.posted.filter(x => x === 'b').length, 1, 'guarded: row b POSTed once');
  eq(JSON.parse(sb.store.get('bg-note-queue')).length, 0, 'guarded: queue drained after flush');
}

// 2. BUGGY (no guard): two concurrent flushes DOUBLE-POST every row.
//    These asserts pass ONLY because the un-guarded form is wrong — the load-bearing proof.
{
  const sb = makeSandbox(buggyFlush, queue);
  await Promise.all([sb.flushNoteQueue(), sb.flushNoteQueue()]);
  eq(sb.posted.length, 6, 'unguarded: 3 rows double-POSTed to 6 (the bug the guard kills)');
  eq(sb.posted.filter(x => x === 'a').length, 2, 'unguarded: row a POSTed twice (duplicate note)');
}

// 3. REAL (guarded): a single flush still fully drains the queue (zero regression on the happy path).
{
  const sb = makeSandbox(fm[0], queue);
  await sb.flushNoteQueue();
  eq(sb.posted.length, 3, 'guarded single flush: all 3 rows POSTed');
  eq(JSON.parse(sb.store.get('bg-note-queue')).length, 0, 'guarded single flush: queue emptied');
}

// 4. REAL (guarded): the flag RESETS — a later flush after the first completes still runs.
{
  const sb = makeSandbox(fm[0], [{ id: 'x' }]);
  await sb.flushNoteQueue();               // drains x
  sb.store.set('bg-note-queue', JSON.stringify([{ id: 'y' }])); // new offline note queued later
  await sb.flushNoteQueue();               // must run again (flag reset in finally)
  eq(sb.posted.join(','), 'x,y', 'guarded: flag resets so a subsequent flush drains the newly-queued note');
}

// 5. Guarded: empty queue is a no-op, no POSTs.
{
  const sb = makeSandbox(fm[0], []);
  await sb.flushNoteQueue();
  eq(sb.posted.length, 0, 'guarded: empty queue → no POSTs');
}

// 6. Guarded queuedNotes(): a corrupt-but-valid-JSON non-array store (e.g. a number or
//    object synced/tampered into localStorage) must degrade to [] — NOT crash a flush,
//    and NOT crash queueNote's q.push. Reconstructs the buggy pre-guard form to prove
//    it would return the non-array (which queueNote.push / for..of would then choke on).
{
  assert.ok(/Array\.isArray\(v\)/.test(qm[0]), 'queuedNotes lost its Array.isArray guard');
  for (const corrupt of ['5', '{}', '"x"', 'true']) {
    const store = new Map([['bg-note-queue', corrupt]]);
    const safeGet = (k) => (store.has(k) ? store.get(k) : null);
    const qn = new Function('safeGet', `${qm[0]}\nreturn queuedNotes;`)(safeGet);
    const out = qn();
    ok(Array.isArray(out) && out.length === 0, `guarded queuedNotes → [] on corrupt store ${corrupt} (queueNote.push stays safe)`);
  }
}

console.log(`flush-note-queue-reentrancy: ${pass} assertions passed`);
