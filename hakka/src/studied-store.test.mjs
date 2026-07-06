// Mutation-proven lock for parseStudiedSet — the guard that stops a corrupt
// 'hk-studied' localStorage value from crashing the WHOLE Hakka tool at module
// load.
//
// The bug it replaces (main.js, top level, no try/catch):
//   const studied = new Set(JSON.parse(localStorage.getItem('hk-studied') || '[]'));
//   - malformed JSON           -> JSON.parse throws -> blank tool.
//   - valid non-iterable ('{}')-> new Set(<obj>) throws -> blank tool.
//
// RED proof below reconstructs that old inline form and asserts it throws on the
// exact inputs the fix survives, so a reversion to the unguarded form fails here.

import { parseStudiedSet, safeLsGet } from './studied-store.js';

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } }
function eqSet(a, expectedArr, msg) {
  ok(a instanceof Set, msg + ' (is a Set)');
  ok(a.size === expectedArr.length, `${msg} (size ${a.size} === ${expectedArr.length})`);
  for (const v of expectedArr) ok(a.has(v), `${msg} (has ${JSON.stringify(v)})`);
}

// The OLD inline behavior, reconstructed verbatim for the RED proof.
function oldInline(raw) {
  return new Set(JSON.parse(raw || '[]'));
}

// ── Happy path: a real array passes through verbatim (zero regression) ──
eqSet(parseStudiedSet(JSON.stringify(['a', 'b', 'c'])), ['a', 'b', 'c'], 'real string-id array');
eqSet(parseStudiedSet(JSON.stringify([1, 2, 3])), [1, 2, 3], 'real numeric-id array');
eqSet(parseStudiedSet('[]'), [], 'empty array');
// Dedup is Set semantics — duplicate ids collapse.
eqSet(parseStudiedSet(JSON.stringify(['x', 'x', 'y'])), ['x', 'y'], 'duplicate ids dedup');

// For the common case the fix must equal the old behavior exactly.
{
  const raw = JSON.stringify(['a', 'b']);
  const a = parseStudiedSet(raw);
  const b = oldInline(raw);
  ok(a.size === b.size && [...a].every(v => b.has(v)), 'fix === old inline on a valid array');
}

// ── Missing / empty ──
eqSet(parseStudiedSet(null), [], 'null (missing key)');
eqSet(parseStudiedSet(undefined), [], 'undefined');

// Every malformed input: the fix never throws and always yields a Set.
const allBad = ['{bad json', '{}', '5', 'null', 'true', '"abc"', '[1,2', ''];
for (const raw of allBad) {
  let threw = false, result = null;
  try { result = parseStudiedSet(raw); } catch { threw = true; }
  ok(!threw, `parseStudiedSet does NOT throw on ${JSON.stringify(raw)}`);
  ok(result instanceof Set && result.size === 0, `parseStudiedSet -> empty Set on ${JSON.stringify(raw)}`);
}

// ── RED proof: the OLD inline form CRASHES on these (the actual bug) ──
// Reconstruct `new Set(JSON.parse(raw || '[]'))` and assert it throws, so any
// reversion to the unguarded code makes this test fail.
const crashers = ['{bad json', '{}', '5', 'true', '[1,2'];
for (const raw of crashers) {
  let oldThrew = false;
  try { oldInline(raw); } catch { oldThrew = true; }
  ok(oldThrew, `old inline THROWS on ${JSON.stringify(raw)} (the bug the guard fixes)`);
}

// '"abc"' is iterable: old form does NOT throw but silently seeds the Set with
// single characters (size 3). The fix correctly yields an empty Set instead.
ok(oldInline('"abc"').size === 3, 'old inline mis-seeds chars from a bare string');
ok(parseStudiedSet('"abc"').size === 0, 'fix yields empty Set for a bare string (not char-seeded)');

// ── safeLsGet: crash-safe storage ACCESS guard ──────────────────────────────
// parseStudiedSet guards the VALUE; safeLsGet guards the ACT of touching the
// store. main.js reads 'hk-studied' at MODULE TOP LEVEL, so a bare
// localStorage.getItem there THROWS on a storage-blocked browser (Safari "Block
// All Cookies", in-app webviews) and blanks the whole tool before the grid
// renders. safeLsGet degrades to null; parseStudiedSet(null) -> empty Set.
{
  const realLS = globalThis.localStorage;
  // Happy path: safeLsGet returns exactly what the store holds (byte-identical to
  // a bare getItem), and the whole chain yields the studied Set.
  globalThis.localStorage = { getItem: (k) => k === 'hk-studied' ? JSON.stringify(['a', 'b']) : null };
  ok(safeLsGet('hk-studied') === JSON.stringify(['a', 'b']), 'safeLsGet returns the stored value on the happy path');
  eqSet(parseStudiedSet(safeLsGet('hk-studied')), ['a', 'b'], 'safeLsGet -> parseStudiedSet yields the studied Set');

  // Storage-blocked: getItem THROWS. The OLD bare read propagates the throw
  // (RED proof — this is the boot brick); safeLsGet swallows it and returns null.
  const blocked = { getItem: () => { throw new DOMException('blocked', 'SecurityError'); } };
  globalThis.localStorage = blocked;
  let bareThrew = false;
  try { blocked.getItem('hk-studied'); } catch { bareThrew = true; }
  ok(bareThrew, 'a bare localStorage.getItem THROWS on a blocked store (the boot brick this guards)');
  let safeThrew = false, safeVal = 'x';
  try { safeVal = safeLsGet('hk-studied'); } catch { safeThrew = true; }
  ok(!safeThrew, 'safeLsGet does NOT throw on a blocked store');
  ok(safeVal === null, 'safeLsGet degrades to null on a blocked store');
  eqSet(parseStudiedSet(safeLsGet('hk-studied')), [], 'blocked store -> empty studied Set (tool still boots)');

  globalThis.localStorage = realLS;
}

console.log(`\nstudied-store (hakka): ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
