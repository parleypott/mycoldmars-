// Verifier-layer test for the legacy localStorage index reader (ls-index.js).
//
// THE BUG (established JSON.parse(localStorage) type-confusion class): the old
// db.js `lsGetIndex` returned `lsGet(...) || []`, so a corrupt/legacy/tampered
// index holding a valid-but-NON-array value (object/number/true) passed the
// truthy `||` verbatim and the migration's `for (const id of index)` then threw
// "object is not iterable" — aborting migrateLocalStorageToSupabase, which is
// caught by the call-site `.catch`, never sets MIGRATION_KEY, and so RE-RUNS and
// re-crashes every app load, leaving the user's legacy local transcripts stuck
// in localStorage forever. lsGetIndex now GUARANTEES an array.
//
// Imports the REAL shipped functions; injects a Map-backed localStorage mock
// (ls-index.js reads the global per-call, never at import, so a static import is
// safe). Mutation-proven: revert the Array.isArray guard → the consumer-crash
// cases go RED.

import { lsGet, lsDelete, lsGetIndex, LS_PREFIX } from './ls-index.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

function setStore(obj) {
  const store = new Map(Object.entries(obj));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  };
  return store;
}

// ---- INLINE RED PROOF: the OLD lsGetIndex returned a non-array that crashes the consumer ----
function oldLsGetIndex(collection) {
  // verbatim reconstruction of the pre-fix db.js logic
  const v = lsGet(`index_${collection}`);
  return v || [];
}
function iterates(idx) {
  try { for (const _ of idx) { /* migration loop */ } return true; } catch { return false; }
}
{
  setStore({ [`${LS_PREFIX}index_projects`]: '{}' });
  const old = oldLsGetIndex('projects');
  ok(!Array.isArray(old), 'RED proof: old lsGetIndex returns a non-array on a {} index');
  ok(!iterates(old), 'RED proof: old non-array index CRASHES the migration for...of');
  const fixed = lsGetIndex('projects');
  ok(Array.isArray(fixed), 'fixed lsGetIndex returns an array on a {} index');
  ok(iterates(fixed), 'fixed index is safely iterable');
}

// ---- every non-array shape degrades to [] (no crash) ----
for (const [label, raw] of [
  ['empty object', '{}'],
  ['populated object', '{"a":1}'],
  ['number', '5'],
  ['zero', '0'],
  ['boolean true', 'true'],
  ['string', '"x"'],
  ['JSON null', 'null'],
]) {
  setStore({ [`${LS_PREFIX}index_transcripts`]: raw });
  const idx = lsGetIndex('transcripts');
  eq(idx, [], `non-array index (${label}) → []`);
  ok(Array.isArray(idx) && iterates(idx), `non-array index (${label}) is iterable`);
}

// ---- malformed / missing → [] ----
setStore({ [`${LS_PREFIX}index_projects`]: '{not json' });
eq(lsGetIndex('projects'), [], 'malformed JSON → []');
setStore({ [`${LS_PREFIX}index_projects`]: '' });
eq(lsGetIndex('projects'), [], 'empty string store → []');
setStore({}); // key absent
eq(lsGetIndex('projects'), [], 'absent index key → []');

// ---- NO-REGRESSION: a real array passes through verbatim (order + contents) ----
setStore({ [`${LS_PREFIX}index_projects`]: JSON.stringify(['p_1', 'p_2', 'p_3']) });
eq(lsGetIndex('projects'), ['p_1', 'p_2', 'p_3'], 'real string-id array preserved verbatim');
setStore({ [`${LS_PREFIX}index_transcripts`]: JSON.stringify([{ id: 't_1' }]) });
eq(lsGetIndex('transcripts'), [{ id: 't_1' }], 'real object array preserved');
setStore({ [`${LS_PREFIX}index_projects`]: '[]' });
eq(lsGetIndex('projects'), [], 'empty array store → []');

// ---- INVARIANT: lsGetIndex is ALWAYS for...of / .length-safe across hostile inputs ----
{
  let allSafe = true;
  for (const raw of ['{}', '5', '0', 'true', 'false', '"x"', 'null', '{not json', '', '[1]', '{"length":3}']) {
    setStore({ [`${LS_PREFIX}index_x`]: raw });
    const idx = lsGetIndex('x');
    if (!Array.isArray(idx) || typeof idx.length !== 'number' || !iterates(idx)) { allSafe = false; break; }
  }
  ok(allSafe, 'lsGetIndex() is ALWAYS an iterable array across 11 hostile inputs');
}

// ---- lsGet passthrough (used directly by the migration for per-row reads) ----
setStore({ [`${LS_PREFIX}project_abc`]: JSON.stringify({ name: 'Old', description: 'd' }) });
eq(lsGet('project_abc'), { name: 'Old', description: 'd' }, 'lsGet returns the parsed object verbatim');
setStore({ [`${LS_PREFIX}project_abc`]: '{bad' });
eq(lsGet('project_abc'), null, 'lsGet → null on malformed JSON (caught)');
setStore({});
eq(lsGet('missing'), null, 'lsGet → null on absent key');

// ---- lsDelete removes the prefixed key, no-throw ----
{
  const store = setStore({ [`${LS_PREFIX}index_projects`]: '[]', [`${LS_PREFIX}project_1`]: '{}' });
  lsDelete('project_1');
  ok(!store.has(`${LS_PREFIX}project_1`), 'lsDelete removes the prefixed key');
  ok(store.has(`${LS_PREFIX}index_projects`), 'lsDelete leaves other keys');
  let threw = false; try { lsDelete('nope'); } catch { threw = true; }
  ok(!threw, 'lsDelete on an absent key does not throw');
}

console.log(`ls-index: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
