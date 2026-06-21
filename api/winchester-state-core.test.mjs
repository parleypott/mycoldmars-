// Locks the Winchester (Westchester House Hunter) cross-machine state-sync
// data-integrity core: extractStateRow (never returns a broken state) +
// the optimistic-concurrency decision (wantsConcurrencyCheck / shouldReject409).
// These protect Johnny's ACTIVE house-hunt state (saved listings, scores,
// notes) from being wiped on cold-start hydration or clobbered across machines.
//
// Behavior-identical extraction from api/winchester-state.js — this is a lock,
// not a fix. Mutation-proven: each assertion fails if the corresponding
// contract regresses (see the cp-backup mutation runs in the BACKLOG entry).

import { extractStateRow, wantsConcurrencyCheck, shouldReject409 } from './_lib/winchester-state-core.js';

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } }

// ----- inline RED proofs: reconstruct the OLD inline logic and show the
// contract each helper enforces would be violated by a naive regression. -----

// OLD handleGet row default did `rows[0]` with no null-state guard at the row
// level — extractStateRow's `state || {}` is what keeps a null-state row safe.
const naiveExtract = (rows) => {
  const row = Array.isArray(rows) && rows.length ? rows[0] : { state: {}, updated_at: null };
  return { state: row.state, updated_at: row.updated_at }; // <-- no `|| {}`
};
ok('RED proof: a null-state row leaks `state:null` without the guard',
  naiveExtract([{ state: null, updated_at: 'T1' }]).state === null);
ok('FIX: extractStateRow degrades a null-state row to {}',
  eq(extractStateRow([{ state: null, updated_at: 'T1' }]), { state: {}, updated_at: 'T1' }));

// OLD concurrency guard was `serverTs && serverTs !== expected`. The data-
// integrity meaning: a server that has advanced past the client's known
// timestamp MUST be rejected so the client merges (else it clobbers).
ok('RED proof: a mismatched server timestamp must reject (else clobber)',
  shouldReject409('SERVER_NEWER', 'CLIENT_OLD') === true);

// ----- extractStateRow: the never-broken-state contract -----
ok('happy: real row passes through state + updated_at',
  eq(extractStateRow([{ state: { saved: [1, 2], score: 9 }, updated_at: 'T1' }]),
     { state: { saved: [1, 2], score: 9 }, updated_at: 'T1' }));
ok('empty array → empty state, null ts (first-ever GET)',
  eq(extractStateRow([]), { state: {}, updated_at: null }));
ok('null rows → empty state, null ts',
  eq(extractStateRow(null), { state: {}, updated_at: null }));
ok('undefined rows → empty state, null ts',
  eq(extractStateRow(undefined), { state: {}, updated_at: null }));
ok('non-array rows → empty state, null ts',
  eq(extractStateRow({ not: 'an array' }), { state: {}, updated_at: null }));
ok('null-state row → {} (the load-bearing guard)',
  eq(extractStateRow([{ state: null, updated_at: 'T2' }]), { state: {}, updated_at: 'T2' }));
ok('undefined-state row → {}',
  eq(extractStateRow([{ updated_at: 'T3' }]), { state: {}, updated_at: 'T3' }));
ok('row with state but null updated_at → keeps state, null ts',
  eq(extractStateRow([{ state: { x: 1 }, updated_at: null }]), { state: { x: 1 }, updated_at: null }));
ok('row with state but missing updated_at → null ts',
  eq(extractStateRow([{ state: { x: 1 } }]), { state: { x: 1 }, updated_at: null }));
ok('multi-row result → first row only',
  eq(extractStateRow([{ state: { a: 1 }, updated_at: 'A' }, { state: { b: 2 }, updated_at: 'B' }]),
     { state: { a: 1 }, updated_at: 'A' }));
ok('state can be a falsy-but-present empty object → preserved as {}',
  eq(extractStateRow([{ state: {}, updated_at: 'T4' }]), { state: {}, updated_at: 'T4' }));
// never throws on hostile input
let threw = false;
try { extractStateRow('garbage'); extractStateRow(42); extractStateRow([null]); } catch { threw = true; }
ok('extractStateRow never throws on hostile input', threw === false);
ok('row that is itself null in the array → empty state (no crash)',
  eq(extractStateRow([null]), { state: {}, updated_at: null }));

// ----- wantsConcurrencyCheck: only when a non-empty string was supplied -----
ok('wants: non-empty string → true', wantsConcurrencyCheck('2026-06-21T00:00:00Z') === true);
ok('wants: empty string → false', wantsConcurrencyCheck('') === false);
ok('wants: null → false', wantsConcurrencyCheck(null) === false);
ok('wants: undefined → false', wantsConcurrencyCheck(undefined) === false);
ok('wants: number → false (typeof guard)', wantsConcurrencyCheck(12345) === false);
ok('wants: object → false', wantsConcurrencyCheck({}) === false);
ok('wants: boolean → false', wantsConcurrencyCheck(true) === false);

// ----- shouldReject409: the optimistic-concurrency decision -----
ok('reject: server advanced past client → 409', shouldReject409('NEWER', 'OLD') === true);
ok('allow: server matches client (client has latest) → no 409', shouldReject409('SAME', 'SAME') === false);
ok('allow: fresh row, null server ts (nothing to clobber) → no 409', shouldReject409(null, 'OLD') === false);
ok('allow: empty server ts → no 409', shouldReject409('', 'OLD') === false);
ok('allow: empty expected ts → no 409 (defensive; gated upstream anyway)', shouldReject409('NEWER', '') === false);
ok('allow: both empty → no 409', shouldReject409('', '') === false);
ok('allow: undefined server ts → no 409', shouldReject409(undefined, 'OLD') === false);
ok('allow: non-string server ts → no 409 (no false reject)', shouldReject409(12345, 'OLD') === false);
ok('reject: realistic ISO timestamps differing by a second',
  shouldReject409('2026-06-21T10:00:01Z', '2026-06-21T10:00:00Z') === true);
ok('allow: identical realistic ISO timestamps',
  shouldReject409('2026-06-21T10:00:00Z', '2026-06-21T10:00:00Z') === false);
// never throws
let threw2 = false;
try { shouldReject409(null, null); shouldReject409({}, []); wantsConcurrencyCheck([]); } catch { threw2 = true; }
ok('concurrency helpers never throw on hostile input', threw2 === false);

console.log(`winchester-state-core.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
