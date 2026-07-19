// Locks the DURABLE-STORAGE HONESTY contract of queueNote() in the BURGUNDY reader
// (public/burgundy/index.html), pinning commit 589374a ("Reader audit fixes ... honest
// 'couldn't save' instead of false '✓ saved' on quota-full").
//
// Before this commit, saveNote()'s catch did `queueNote(...); return true;` unconditionally
// — so when the device's shared 5MB origin quota was FULL, the queue write silently failed,
// the note was LOST, yet the sheet still flashed "✓ saved" over it. The fix makes queueNote
// RETURN a boolean the whole chain now propagates:
//   saveNote catch → `return queueNote({ ...row, _lid: lid });`
//   sheet-save handler → `if (ok) { flash '✓ saved' } else { flash "couldn't save — free some space" }`
//
// The contract queueNote must honour:
//   - returns TRUE iff the row is DURABLY persisted (queue re-read reflects the push),
//   - on a full quota, evicts the biggest cache (bg-tts-urls) and RETRIES ONCE,
//   - returns TRUE if that retry lands, FALSE only if the store is still full after eviction,
//   - a FALSE return must NEVER be flashed as success — that's the whole point of the fix.
//
// A silent revert to a void / always-true queueNote reintroduces the exact false-"✓ saved"
// bug — the mutation oracle below proves it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

const qnotes = html.match(/function queuedNotes\(\)\s*\{[^\n]*\}/);
const qnote = html.match(/function queueNote\(row\)\s*\{[\s\S]*?\n\}/);
assert.ok(qnotes, 'could not extract queuedNotes() — did index.html change?');
assert.ok(qnote, 'could not extract queueNote() — did index.html change?');

// SOURCE-LOCK 1: queueNote must be able to report failure (return false). A void/always-true
// revert loses the honesty signal.
assert.ok(/return false;/.test(qnote[0]), 'queueNote no longer returns false on quota-full — the honesty signal was reverted');
assert.ok(/=== q\.length\) return true;/.test(qnote[0]), 'queueNote no longer confirms the durable write before returning true');
assert.ok(/removeItem\('bg-tts-urls'\)/.test(qnote[0]), 'queueNote no longer evicts the audio cache to retry on a full quota');

// SOURCE-LOCK 2: saveNote's catch must PROPAGATE queueNote's boolean, not swallow it into
// an unconditional `return true`.
assert.ok(
  /return queueNote\(\{ \.\.\.row, _lid: lid \}\);/.test(html),
  "saveNote's catch no longer returns queueNote's boolean — a lost note would flash a false '✓ saved'",
);

let pass = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// Build a faithful sandbox: a fake localStorage whose setItem throws (quota) per `mode`,
// and safeGet/safeSet matching the real one-liners in index.html (try/catch swallow).
//   mode 'ok'          → never full
//   mode 'recoverable' → full WHILE bg-tts-urls is present, frees up once it's evicted
//   mode 'hard'        → always full, even after eviction
function makeQueueNote({ mode = 'ok', seed = {} } = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const quotaFull = () => {
    if (mode === 'ok') return false;
    if (mode === 'hard') return true;
    return store.has('bg-tts-urls'); // recoverable: full until the cache is evicted
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { if (quotaFull()) throw new Error('QuotaExceededError'); store.set(k, v); },
  };
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const factory = new Function(
    'safeGet', 'safeSet', 'localStorage', 'console',
    `${qnotes[0]}\n${qnote[0]}\nreturn { queueNote, queuedNotes };`,
  );
  const warnings = [];
  const api = factory(safeGet, safeSet, localStorage, { warn: (...a) => warnings.push(a.join(' ')) });
  return { ...api, store, warnings };
}

// 1) Happy path, empty queue → durably stored, returns true, queue has the row.
{
  const { queueNote, queuedNotes } = makeQueueNote({ mode: 'ok' });
  eq(queueNote({ note: 'hi', _lid: 'local-1' }), true, 'empty+ok → true');
  eq(queuedNotes().length, 1, 'empty+ok → 1 row persisted');
}

// 2) Happy path with an existing row → appends, returns true, queue has both.
{
  const { queueNote, queuedNotes } = makeQueueNote({ mode: 'ok', seed: { 'bg-note-queue': [{ _lid: 'a' }] } });
  eq(queueNote({ _lid: 'b' }), true, 'append+ok → true');
  eq(queuedNotes().length, 2, 'append+ok → 2 rows persisted');
}

// 3) Recoverable quota → first write throws, evict bg-tts-urls, retry lands → true.
{
  const { queueNote, queuedNotes, store } = makeQueueNote({
    mode: 'recoverable',
    seed: { 'bg-note-queue': [{ _lid: 'a' }], 'bg-tts-urls': '{"0":"x"}' },
  });
  eq(queueNote({ _lid: 'b' }), true, 'recoverable quota → true after eviction retry');
  eq(queuedNotes().length, 2, 'recoverable → both rows persisted after retry');
  ok(!store.has('bg-tts-urls'), 'recoverable → the audio cache was evicted to make room');
}

// 4) HARD full (even after eviction) → returns FALSE, and the note is NOT persisted.
//    This is the honest-failure path the fix exists for.
{
  const { queueNote, queuedNotes, warnings } = makeQueueNote({
    mode: 'hard',
    seed: { 'bg-note-queue': [{ _lid: 'a' }], 'bg-tts-urls': '{"0":"x"}' },
  });
  eq(queueNote({ _lid: 'b' }), false, 'hard full → FALSE (honest failure)');
  eq(queuedNotes().length, 1, 'hard full → the lost note was NOT persisted (still 1)');
  ok(warnings.some((w) => /NOT saved/.test(w)), 'hard full → warns the note was NOT saved');
}

// 5) Hard full with NOTHING to evict → still FALSE, no crash on the missing cache key.
{
  const { queueNote } = makeQueueNote({ mode: 'hard', seed: { 'bg-note-queue': [] } });
  eq(queueNote({ _lid: 'b' }), false, 'hard full, no cache to evict → FALSE, no throw');
}

// 6) LOAD-BEARING mutation oracle: reconstruct the PRE-COMMIT behaviour — a queueNote that
//    ignores the quota and always signals success (the old saveNote `queueNote(...); return
//    true;`). Prove it reports TRUE on the exact hard-full input where the shipped queueNote
//    honestly returns FALSE. That divergence IS the bug this commit fixed.
{
  const alwaysTrueQueueNote = (store, row) => {
    const q = JSON.parse(store.get('bg-note-queue') || '[]'); q.push(row);
    // pretend to write, swallow the quota throw, but claim success regardless
    return true;
  };
  const buggyStore = new Map([['bg-note-queue', JSON.stringify([{ _lid: 'a' }])]]);
  const buggyResult = alwaysTrueQueueNote(buggyStore, { _lid: 'b' });

  const { queueNote } = makeQueueNote({ mode: 'hard', seed: { 'bg-note-queue': [{ _lid: 'a' }] } });
  const shippedResult = queueNote({ _lid: 'b' });

  ok(buggyResult === true, 'oracle: the pre-commit always-true form claims success on a full quota');
  ok(shippedResult === false, 'oracle: the shipped form honestly reports failure on the same input');
  ok(buggyResult !== shippedResult, 'oracle: the fix CHANGES the answer on quota-full (false "✓ saved" is gone)');
}

console.log(`queue-note-durable: ${pass} passed, 0 failed`);
