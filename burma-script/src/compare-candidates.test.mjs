/**
 * compareDocCandidates — the CRASH-RECOVERY RANKER lock.
 *
 * On every reload of Johnny's live Burma/Palau script tool, the newest canonical doc may live in
 * THREE places: the fat LS_DOC key, the compressed `.z` crash-belt, or the async IndexedDB row.
 * resolveNewestCanonicalDoc() reads all three, then `[ls, z, idb].sort(compareDocCandidates)` and
 * takes candidates[0]. That comparator IS the decision of which copy of the script survives — a
 * wrong ordering silently seeds a STALE doc over fresh work (Johnny's exact fear). It carries a
 * 6-rung tie-break ladder and had NO direct unit coverage (only exercised end-to-end through the
 * localStorage/IDB integration tests, which can't cover the ladder rung-by-rung).
 *
 * This locks the ladder AND transitivity. Each rung is mutation-proven: neuter that rung in
 * migrate-doc.js and the matching assertion goes RED. The order the comparator produces is
 * "best first" (candidates[0] wins), i.e. compare<0 means `a` is the better/newer candidate.
 *
 * Ladder (top wins):
 *   1. higher version                              (b.version - a.version)
 *   2. renderable beats non-renderable             (same version)
 *   3. parseable beats non-parseable
 *   4. present beats absent
 *   5. equal-version + both renderable + DIFFERENT bytes → idb (a legacy build stamped the version
 *      forward while the sync body stayed stale; the equal-version idb row holds the fresh bytes)
 *   6. source rank: z (3) > ls (2) > idb (1)       (fresh `.z` still beats fat LS_DOC on a tie)
 *
 * Run: bun src/compare-candidates.test.mjs  (auto-discovered by run-tests.mjs)
 */

// compareDocCandidates is pure (operates on plain candidate objects), so no browser is needed.
// A trivial localStorage shim only guards migrate-doc.js's module-init (episode key sync); the
// comparator itself never touches it. Cache-bust the import so this file gets a clean module.
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => Array.from(store.keys())[i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const { compareDocCandidates } = await import('./migrate-doc.js?ccd');

let pass = 0, fail = 0;
const results = [];
function ok(name, cond) {
  if (cond) { pass++; results.push('  ok   ' + name); }
  else { fail++; results.push('  FAIL ' + name); }
}

// Candidate factory mirroring parseCandidateRaw's shape. `raw` distinct bytes let the equal-version
// idb-freshness rung fire (it requires a.raw !== b.raw).
function cand(source, { version = 0, present = true, parseable = true, renderable = true, raw } = {}) {
  return {
    source,
    version,
    present,
    parseable,
    renderable,
    raw: raw != null ? raw : (present ? source + '-bytes-v' + version : null),
    doc: null,
  };
}

// A comparator is "best-first": <0 means `a` sorts before `b` (a is the winner).
const aWins = (a, b) => compareDocCandidates(a, b) < 0;
const bWins = (a, b) => compareDocCandidates(a, b) > 0;

// ── null handling ────────────────────────────────────────────────────────────────────────────
ok('both null → 0', compareDocCandidates(null, null) === 0);
ok('null a → b wins (a sorts last)', compareDocCandidates(null, cand('ls')) === 1);
ok('null b → a wins', compareDocCandidates(cand('ls'), null) === -1);

// ── RUNG 1: higher version wins, regardless of source rank ─────────────────────────────────────
// ls@v5 must beat z@v4 even though z out-ranks ls — a newer version is always fresher.
ok('rung1: higher version beats lower (even vs better source)',
  aWins(cand('ls', { version: 5 }), cand('z', { version: 4 })));
ok('rung1: lower version loses',
  bWins(cand('ls', { version: 4 }), cand('z', { version: 5 })));
ok('rung1: version dominates renderable',
  aWins(cand('ls', { version: 5, renderable: true }), cand('z', { version: 4, renderable: false })));

// ── RUNG 2: at equal version, renderable beats non-renderable ──────────────────────────────────
ok('rung2: renderable beats non-renderable (same version)',
  aWins(cand('z', { version: 3, renderable: true }), cand('ls', { version: 3, renderable: false })));
// Isolate rung 2 from rung 6: give the non-renderable one the BETTER source (z), renderable one ls.
ok('rung2: renderable ls beats non-renderable z (renderable overrides source rank)',
  aWins(cand('ls', { version: 3, renderable: true }), cand('z', { version: 3, renderable: false })));

// ── RUNG 3: at equal version, both non-renderable, parseable beats non-parseable ───────────────
ok('rung3: parseable beats non-parseable',
  aWins(
    cand('z',  { version: 2, renderable: false, parseable: true }),
    cand('ls', { version: 2, renderable: false, parseable: false })));
ok('rung3: parseable ls beats non-parseable z (overrides source rank)',
  aWins(
    cand('ls', { version: 2, renderable: false, parseable: true }),
    cand('z',  { version: 2, renderable: false, parseable: false })));

// ── RUNG 4: present beats absent (both non-renderable, non-parseable) ──────────────────────────
ok('rung4: present beats absent',
  aWins(
    cand('z',  { version: 1, renderable: false, parseable: false, present: true,  raw: 'x' }),
    cand('ls', { version: 1, renderable: false, parseable: false, present: false, raw: null })));
ok('rung4: present ls beats absent z (overrides source rank)',
  aWins(
    cand('ls', { version: 1, renderable: false, parseable: false, present: true,  raw: 'x' }),
    cand('z',  { version: 1, renderable: false, parseable: false, present: false, raw: null })));

// ── RUNG 5: equal version + both renderable + DIFFERENT bytes → idb is the fresh one ───────────
// This is the defense-in-depth branch: a legacy build bumped LS_DOC_VER forward while the sync body
// stayed stale, but IDB got the fresh bytes. At equal version, idb's different renderable bytes win.
ok('rung5: idb beats ls at equal version with different renderable bytes',
  aWins(
    cand('idb', { version: 7, raw: 'FRESH-idb' }),
    cand('ls',  { version: 7, raw: 'stale-ls' })));
ok('rung5: idb beats z at equal version with different renderable bytes',
  aWins(
    cand('idb', { version: 7, raw: 'FRESH-idb' }),
    cand('z',   { version: 7, raw: 'stale-z' })));
ok('rung5: symmetric — order of args does not change the idb winner (ls,idb)',
  bWins(
    cand('ls',  { version: 7, raw: 'stale-ls' }),
    cand('idb', { version: 7, raw: 'FRESH-idb' })));
// Rung 5 must NOT fire when the bytes are IDENTICAL (nothing fresher about idb) — falls to rung 6,
// where idb (rank 1) LOSES to ls (rank 2). Same raw on both sides.
ok('rung5 guard: identical bytes → idb does NOT win, source rank applies (ls beats idb)',
  bWins(
    cand('idb', { version: 7, raw: 'same-bytes' }),
    cand('ls',  { version: 7, raw: 'same-bytes' })));

// ── RUNG 6: source rank z(3) > ls(2) > idb(1) on a genuine tie ─────────────────────────────────
// Identical everything except source → fresh `.z` crash-belt beats fat LS_DOC (the `.z` copy is the
// one that still lands when the fat LS_DOC write is quota-skipped).
ok('rung6: z beats ls on a tie (identical bytes)',
  aWins(cand('z', { version: 4, raw: 'tie' }), cand('ls', { version: 4, raw: 'tie' })));
ok('rung6: ls beats idb on a tie (identical bytes)',
  aWins(cand('ls', { version: 4, raw: 'tie' }), cand('idb', { version: 4, raw: 'tie' })));

// ── TRANSITIVITY: a real 3-way sort must land on the right winner and be self-consistent ───────
// Equal version, all renderable, all DIFFERENT bytes → rung 5 makes idb outrank both sync copies;
// between z and ls, rung 6 puts z first. Expected best-first order: idb, z, ls.
{
  const ls  = cand('ls',  { version: 9, raw: 'ls-9' });
  const z   = cand('z',   { version: 9, raw: 'z-9' });
  const idb = cand('idb', { version: 9, raw: 'idb-9' });
  const sorted = [ls, z, idb].sort(compareDocCandidates).map((c) => c.source);
  ok('transitivity: [ls,z,idb] equal-version different-bytes sorts idb,z,ls',
    JSON.stringify(sorted) === JSON.stringify(['idb', 'z', 'ls']));
  // Order-independence: shuffle the input, same winner.
  const sorted2 = [idb, ls, z].sort(compareDocCandidates).map((c) => c.source);
  ok('transitivity: winner is idb regardless of input order', sorted2[0] === 'idb');
}
// Realistic quota-skip scenario: fat LS write was skipped (stale ls@v2), `.z` holds the fresh doc
// at v3. Highest version wins outright → z.
{
  const ls  = cand('ls', { version: 2, raw: 'stale' });
  const z   = cand('z',  { version: 3, raw: 'fresh' });
  const idb = cand('idb', { version: 2, present: false, parseable: false, renderable: false, raw: null });
  const winner = [ls, z, idb].sort(compareDocCandidates)[0].source;
  ok('scenario: fresh .z at higher version wins over stale ls', winner === 'z');
}

console.log(results.join('\n'));
console.log(`\ncompare-candidates: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
