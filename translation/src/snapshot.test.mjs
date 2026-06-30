// Locks the LIVE local snapshot vault (translation/src/snapshot.js) — the
// last-resort crash-recovery layer that mirrors every transcript save to
// localStorage so a network partition / browser crash mid-save doesn't lose
// Johnny's editing work. It had ZERO coverage. This suite imports the REAL
// shipped functions (no byte-copy mirror, so it can't drift) and pins the
// subtle parts: LRU ordering, the MAX_TRANSCRIPTS cap eviction, the dirty-flag
// crash-recovery semantics, isSnapshotNewerThan's restore decision, the size
// cap, QuotaExceededError eviction-and-retry, and the draft (pre-id) snapshot.
//
// No live bug was found here — the vault logic is correct — so this is
// verifier-layer hardening (same standard as geo-utils / qss-report): every
// assertion below is mutation-proven to go RED if the matching source logic
// regresses (a few representative mutations are noted inline).
//
// snapshot.js talks to the global `localStorage`. There's no DOM here, so we
// install a Map-backed mock on globalThis before any call. The module reads
// the global per-call (never at import), so a static import is safe.
//
// run: bun translation/src/snapshot.test.mjs   (or: bun run test)

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };

// ---- Map-backed localStorage mock (optionally quota-limited) ----
function makeLS({ maxEntries = Infinity } = {}) {
  const m = new Map();
  return {
    _m: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      // Simulate a browser quota: refuse a NEW key once we're at the cap.
      if (!m.has(k) && m.size >= maxEntries) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

let LS = makeLS();
globalThis.localStorage = LS;

const {
  saveSnapshot, loadSnapshot, clearSnapshot, isSnapshotNewerThan,
  saveDraftSnapshot, loadDraftSnapshot, clearDraftSnapshot, snapshotStats,
  readIndex: readIndexReal,
} = await import('./snapshot.js');

const INDEX_KEY = 'mcm_snap_index';
const SNAP_PREFIX = 'mcm_snap_';
const DRAFT_KEY = 'mcm_draft_snapshot';
const readIndex = () => JSON.parse(LS.getItem(INDEX_KEY) || '[]');
const rawSnap = (id) => LS.getItem(SNAP_PREFIX + id);
const reset = () => { LS = makeLS(); globalThis.localStorage = LS; };

// ──────────────────────────────────────────────────────────────────────────
// isSnapshotNewerThan — the restore decision (pure, no localStorage)
// ──────────────────────────────────────────────────────────────────────────
ok('null snap → false',                       isSnapshotNewerThan(null, '2026-01-01') === false);
ok('undefined snap → false',                  isSnapshotNewerThan(undefined, '2026-01-01') === false);
// dirty = unsaved local work → ALWAYS offer to restore, even with no/older ts
ok('dirty snap → true (no updatedAt)',         isSnapshotNewerThan({ dirty: true }, '2026-01-01') === true);
ok('dirty snap → true (older updatedAt)',      isSnapshotNewerThan({ dirty: true, updatedAt: '2000-01-01' }, '2026-01-01') === true);
ok('dirty snap → true (server null)',          isSnapshotNewerThan({ dirty: true }, null) === true);
// non-dirty with no updatedAt → can't compare → don't restore
ok('clean snap, no updatedAt → false',         isSnapshotNewerThan({ dirty: false }, '2026-01-01') === false);
// clean snap, server has nothing → snapshot wins
ok('clean snap w/ ts, server null → true',     isSnapshotNewerThan({ updatedAt: '2026-01-01' }, null) === true);
ok('clean snap w/ ts, server "" → true',       isSnapshotNewerThan({ updatedAt: '2026-01-01' }, '') === true);
// strictly-newer comparison
ok('snap newer than server → true',            isSnapshotNewerThan({ updatedAt: '2026-06-02T00:00:00Z' }, '2026-06-01T00:00:00Z') === true);
ok('snap older than server → false',           isSnapshotNewerThan({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-02T00:00:00Z') === false);
ok('snap EQUAL to server → false (strict)',    isSnapshotNewerThan({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-01T00:00:00Z') === false);
ok('snap 1ms newer → true',                    isSnapshotNewerThan({ updatedAt: '2026-06-01T00:00:00.002Z' }, '2026-06-01T00:00:00.001Z') === true);
// present-but-UNPARSEABLE timestamp (corrupt/legacy/tampered store) — `new
// Date(x).getTime()` is NaN, and `NaN > anything` is always false, so the OLD
// code silently DROPPED a snapshot that may hold crash-recovery work. When we
// can't order them, the vault must lean toward OFFERING the restore (user can
// decline) — same "can't order → recover" stance as the trash filter + devchat.
// RED proof: the old comparison returns false for both of these.
const oldIsNewer = (snap, srv) => {
  if (!snap) return false;
  if (snap.dirty) return true;
  if (!snap.updatedAt) return false;
  if (!srv) return true;
  return new Date(snap.updatedAt).getTime() > new Date(srv).getTime(); // NaN > x === false
};
ok('RED: old logic drops corrupt-snap-ts',     oldIsNewer({ updatedAt: 'not-a-date' }, '2026-06-01T00:00:00Z') === false);
ok('corrupt snap updatedAt → true (offer)',    isSnapshotNewerThan({ updatedAt: 'not-a-date' }, '2026-06-01T00:00:00Z') === true);
ok('corrupt snap updatedAt (garbage) → true',  isSnapshotNewerThan({ dirty: false, updatedAt: 'xyz' }, '2026-06-01T00:00:00Z') === true);
ok('corrupt server ts → true (offer)',         isSnapshotNewerThan({ updatedAt: '2026-06-02T00:00:00Z' }, 'garbage') === true);
ok('both ts corrupt → true (offer)',           isSnapshotNewerThan({ updatedAt: 'nope' }, 'nope') === true);
// no-regression: every valid-timestamp case is byte-identical to the old logic
ok('no-regress: newer matches old',            isSnapshotNewerThan({ updatedAt: '2026-06-02T00:00:00Z' }, '2026-06-01T00:00:00Z') === oldIsNewer({ updatedAt: '2026-06-02T00:00:00Z' }, '2026-06-01T00:00:00Z'));
ok('no-regress: older matches old',            isSnapshotNewerThan({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-02T00:00:00Z') === oldIsNewer({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-02T00:00:00Z'));
ok('no-regress: equal matches old',            isSnapshotNewerThan({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-01T00:00:00Z') === oldIsNewer({ updatedAt: '2026-06-01T00:00:00Z' }, '2026-06-01T00:00:00Z'));
ok('no-regress: dirty still wins',             isSnapshotNewerThan({ dirty: true, updatedAt: 'not-a-date' }, '2026-06-01T00:00:00Z') === true);
ok('no-regress: clean no-updatedAt → false',   isSnapshotNewerThan({ dirty: false }, '2026-06-01T00:00:00Z') === false);

// ──────────────────────────────────────────────────────────────────────────
// saveSnapshot + loadSnapshot — round-trip + dirty flag
// ──────────────────────────────────────────────────────────────────────────
reset();
saveSnapshot('t1', { foo: 'bar' }, '2026-06-01T00:00:00Z');
const r1 = loadSnapshot('t1');
ok('round-trip: transcriptId preserved',       r1 && r1.transcriptId === 't1');
ok('round-trip: payload preserved',            r1 && r1.payload && r1.payload.foo === 'bar');
ok('round-trip: updatedAt preserved',          r1 && r1.updatedAt === '2026-06-01T00:00:00Z');
ok('round-trip: savedAt is ISO string',        r1 && typeof r1.savedAt === 'string' && r1.savedAt.includes('T'));
ok('save w/ updatedAt → dirty=false',          r1 && r1.dirty === false);

reset();
saveSnapshot('t1', { foo: 1 }, null);
const rDirty = loadSnapshot('t1');
ok('save w/ null updatedAt → dirty=true',      rDirty && rDirty.dirty === true);
ok('dirty save: updatedAt is null',            rDirty && rDirty.updatedAt === null);

// empty/missing transcriptId → no-op
reset();
saveSnapshot('', { foo: 1 }, '2026-06-01T00:00:00Z');
saveSnapshot(null, { foo: 1 }, '2026-06-01T00:00:00Z');
ok('empty id → nothing written',               LS.length === 0);
ok('empty id → index untouched',               readIndex().length === 0);
ok('loadSnapshot("") → null',                  loadSnapshot('') === null);
ok('loadSnapshot(missing) → null',             loadSnapshot('nope') === null);

// corrupt stored JSON → loadSnapshot degrades to null (try/catch)
reset();
LS.setItem(SNAP_PREFIX + 'bad', '{not json');
ok('corrupt snapshot JSON → null',             loadSnapshot('bad') === null);

// ──────────────────────────────────────────────────────────────────────────
// Index = LRU, newest-first
// ──────────────────────────────────────────────────────────────────────────
reset();
saveSnapshot('a', { n: 1 }, 'ts');
saveSnapshot('b', { n: 2 }, 'ts');
saveSnapshot('c', { n: 3 }, 'ts');
// MUTATION GUARD: if unshift→push, this order flips (RED).
ok('index newest-first after 3 saves',         JSON.stringify(readIndex()) === JSON.stringify(['c', 'b', 'a']));
// re-save an existing id → it moves to the FRONT (most-recently-used)
saveSnapshot('a', { n: 99 }, 'ts2');
ok('re-save moves id to front (MRU)',          JSON.stringify(readIndex()) === JSON.stringify(['a', 'c', 'b']));
ok('re-save: no duplicate index entry',        readIndex().filter((x) => x === 'a').length === 1);
ok('re-save overwrites payload',               loadSnapshot('a').payload.n === 99);
ok('re-save updates updatedAt',                loadSnapshot('a').updatedAt === 'ts2');

// ──────────────────────────────────────────────────────────────────────────
// MAX_TRANSCRIPTS cap (10) — oldest evicted from index AND from storage
// ──────────────────────────────────────────────────────────────────────────
reset();
for (let i = 1; i <= 11; i++) saveSnapshot('x' + i, { n: i }, 'ts');
const idx = readIndex();
ok('cap holds at 10 transcripts',              idx.length === 10);
ok('newest (x11) is at front',                 idx[0] === 'x11');
ok('oldest (x1) evicted from index',           !idx.includes('x1'));
// MUTATION GUARD: if pop→shift, the WRONG end is evicted (RED here + above).
ok('oldest (x1) removed from storage',         rawSnap('x1') === null);
ok('oldest (x1) loadSnapshot → null',          loadSnapshot('x1') === null);
ok('survivor x2..x11 all still present',       ['x2','x3','x4','x5','x6','x7','x8','x9','x10','x11'].every((id) => loadSnapshot(id) !== null));
ok('exactly 10 snapshot keys in storage',      [...LS._m.keys()].filter((k) => k.startsWith(SNAP_PREFIX) && k !== INDEX_KEY).length === 10);

// ──────────────────────────────────────────────────────────────────────────
// Size cap (MAX_BYTES = 4MB) — oversized blob is skipped, not crashed
// ──────────────────────────────────────────────────────────────────────────
reset();
saveSnapshot('big', { blob: 'x'.repeat(4 * 1024 * 1024 + 100) }, 'ts');
ok('oversized snapshot skipped (not stored)',  loadSnapshot('big') === null);
ok('oversized snapshot: index untouched',      readIndex().length === 0);
// a normal-sized one right after still works (cap didn't poison state)
saveSnapshot('small', { ok: true }, 'ts');
ok('normal save after oversized still works',  loadSnapshot('small') !== null);

// UTF-16 storage cost — the cap measures `length * 2` (real localStorage cost),
// NOT `.length`. A blob whose `.length` is UNDER MAX_BYTES but whose UTF-16
// storage cost is OVER it must still be rejected — and rejected UP FRONT, so it
// never touches the index/eviction loop (the bug: under a `.length` cap this
// slips through, then the QuotaExceededError loop sacrifices every other
// transcript's snapshot trying to fit it). Bites non-Latin transcripts hardest.
// MUTATION: reverting either guard to `json.length > MAX_BYTES` re-admits this
// blob → both asserts below go RED.
reset();
const MAX_BYTES = 4 * 1024 * 1024;
const midBlob = 'x'.repeat(2_200_000); // .length ~2.2M < 4MB, but *2 = 4.4M > 4MB
ok('test fixture: blob.length is under the cap', (JSON.stringify({ blob: midBlob }).length) < MAX_BYTES);
saveSnapshot('mid', { blob: midBlob }, 'ts');
ok('UTF-16-oversized snapshot rejected',        loadSnapshot('mid') === null);
ok('UTF-16-oversized: index untouched',         readIndex().length === 0);
// guard against over-rejection: a real non-Latin snapshot well under the cap
// (Burmese text, BMP code units) must still save.
saveSnapshot('my', { text: 'မြန်မာစာ '.repeat(50) }, 'ts');
ok('real non-Latin snapshot still saves',       loadSnapshot('my') !== null);

// ──────────────────────────────────────────────────────────────────────────
// clearSnapshot — removes key AND index entry, leaves others intact
// ──────────────────────────────────────────────────────────────────────────
reset();
saveSnapshot('p', { n: 1 }, 'ts');
saveSnapshot('q', { n: 2 }, 'ts');
clearSnapshot('p');
ok('clearSnapshot removes the storage key',    rawSnap('p') === null);
ok('clearSnapshot removes the index entry',    !readIndex().includes('p'));
ok('clearSnapshot leaves sibling intact',      loadSnapshot('q') !== null);
ok('clearSnapshot keeps sibling in index',     readIndex().includes('q'));
clearSnapshot('');           // no-op, must not throw
clearSnapshot('not-there');  // no-op, must not throw
ok('clearSnapshot(empty/missing) is safe',     readIndex().length === 1);

// ──────────────────────────────────────────────────────────────────────────
// snapshotStats — count + summed bytes over the index
// ──────────────────────────────────────────────────────────────────────────
reset();
ok('stats on empty vault → count 0',           snapshotStats().count === 0);
ok('stats on empty vault → bytes 0',           snapshotStats().bytes === 0);
saveSnapshot('s1', { n: 1 }, 'ts');
saveSnapshot('s2', { n: 2 }, 'ts');
const st = snapshotStats();
ok('stats count matches index length',         st.count === 2);
ok('stats bytes = sum of stored lengths',      st.bytes === (rawSnap('s1').length + rawSnap('s2').length));
ok('stats bytes is positive',                  st.bytes > 0);

// ──────────────────────────────────────────────────────────────────────────
// Draft snapshot — the pre-id window before the first server save
// ──────────────────────────────────────────────────────────────────────────
reset();
ok('loadDraftSnapshot when none → null',       loadDraftSnapshot() === null);
saveDraftSnapshot({ stage: 'pre-id', words: [1, 2, 3] });
const draft = loadDraftSnapshot();
ok('draft round-trips payload',                draft && draft.payload && draft.payload.stage === 'pre-id');
ok('draft has savedAt timestamp',              draft && typeof draft.savedAt === 'string');
ok('draft stored under fixed DRAFT_KEY',       LS.getItem(DRAFT_KEY) !== null);
ok('draft does NOT touch the indexed vault',   readIndex().length === 0);
clearDraftSnapshot();
ok('clearDraftSnapshot removes it',            loadDraftSnapshot() === null);
// oversized draft is skipped too
saveDraftSnapshot({ blob: 'y'.repeat(4 * 1024 * 1024 + 100) });
ok('oversized draft skipped',                  loadDraftSnapshot() === null);
// corrupt draft JSON → null
LS.setItem(DRAFT_KEY, '{broken');
ok('corrupt draft JSON → null',                loadDraftSnapshot() === null);

// ──────────────────────────────────────────────────────────────────────────
// QuotaExceededError — saveSnapshot evicts older snaps and retries
// ──────────────────────────────────────────────────────────────────────────
// A vault that can hold at most 3 keys total (index + snaps). Pre-load it with
// 2 existing snapshots, then save a 3rd: the index write + 3rd snap would push
// past the quota, so saveSnapshot must evict an older snapshot and retry until
// the new one fits — never throwing.
reset();
LS = makeLS({ maxEntries: 3 });
globalThis.localStorage = LS;
saveSnapshot('q1', { n: 1 }, 'ts');   // keys: index, q1  (2)
saveSnapshot('q2', { n: 2 }, 'ts');   // keys: index, q1, q2 (3 = cap)
let threw = false;
try { saveSnapshot('q3', { n: 3 }, 'ts'); } catch { threw = true; }
ok('save under quota pressure never throws',   threw === false);
ok('newest (q3) survives the quota squeeze',   loadSnapshot('q3') !== null);
ok('quota eviction kept total within cap',     LS.length <= 3);
// restore the default unlimited mock for any later additions
reset();

// ──────────────────────────────────────────────────────────────────────────
// readIndex — non-array store hardening (JSON.parse type-confusion class)
// A valid-but-non-array stored INDEX_KEY ('{}', '5', '"x"') parses without
// throwing, so the try/catch alone does NOT catch it. Returning it verbatim
// crashes every consumer: saveSnapshot's readIndex().filter() (the vault stops
// mirroring saves → no crash recovery) and snapshotStats's `for...of`.
// Mutation: revert `Array.isArray(v) ? v : []` to `return v` → these go RED.
// ──────────────────────────────────────────────────────────────────────────

// RED proof: the OLD verbatim-return reproduced here returns a non-array AND
// crashes the real consumers, while the shipped readIndex degrades to [].
const oldReadIndex = () => {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
  catch { return []; }
};
reset();
LS.setItem(INDEX_KEY, '{}');               // corrupt: object, not array
ok('RED proof: old readIndex returns non-array', !Array.isArray(oldReadIndex()));
let oldCrashed = false;
try { oldReadIndex().filter((x) => x); } catch { oldCrashed = true; }
ok('RED proof: old non-array crashes .filter (saveSnapshot)', oldCrashed === true);

// The fix: every non-array shape degrades to []
for (const [label, raw] of [
  ['object {}', '{}'],
  ['populated object', '{"a":1}'],
  ['number', '5'],
  ['string', '"x"'],
  ['boolean', 'true'],
  ['null literal', 'null'],
]) {
  reset();
  LS.setItem(INDEX_KEY, raw);
  ok(`non-array INDEX_KEY (${label}) → readIndex []`, Array.isArray(readIndexReal()) && readIndexReal().length === 0);
}
// malformed JSON still → [] (the original try/catch path)
reset();
LS.setItem(INDEX_KEY, '{broken');
ok('malformed INDEX_KEY → readIndex []',        Array.isArray(readIndexReal()) && readIndexReal().length === 0);
// absent key → []
reset();
ok('absent INDEX_KEY → readIndex []',           Array.isArray(readIndexReal()) && readIndexReal().length === 0);
// no-regression: a real array passes through verbatim
reset();
LS.setItem(INDEX_KEY, '["a","b","c"]');
ok('real array INDEX_KEY → preserved',          JSON.stringify(readIndexReal()) === JSON.stringify(['a', 'b', 'c']));

// end-to-end: a corrupt INDEX_KEY no longer crashes the public consumers, and
// saveSnapshot recovers the vault (rewrites a clean array index).
reset();
LS.setItem(INDEX_KEY, '{"corrupt":true}');     // non-array store
let saveThrew = false;
try { saveSnapshot('e2e', { n: 1 }, 'ts'); } catch { saveThrew = true; }
ok('corrupt INDEX_KEY: saveSnapshot never throws', saveThrew === false);
ok('corrupt INDEX_KEY: vault recovered (snapshot saved)', loadSnapshot('e2e') !== null);
ok('corrupt INDEX_KEY: index rewritten as clean array',   JSON.stringify(readIndexReal()) === JSON.stringify(['e2e']));
reset();
LS.setItem(INDEX_KEY, '42');                    // non-array store, non-iterable
let statsThrew = false;
try { snapshotStats(); } catch { statsThrew = true; }
ok('corrupt INDEX_KEY: snapshotStats never throws', statsThrew === false);
ok('corrupt INDEX_KEY: snapshotStats count 0',      snapshotStats().count === 0);
reset();

console.log(`snapshot: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
