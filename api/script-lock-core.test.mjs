/**
 * Pure-logic tests for the Offline Lock core — api/_lib/script-lock-core.js.
 * The "who may write" predicate is the watertight heart of the exclusive lock; test it with plain
 * values (no DB, no network, no clock).
 *
 * Run: bun api/script-lock-core.test.mjs
 */
const { LOCK_STALE_MS, isStale, lockBlocks, lockView } = await import('./_lib/script-lock-core.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const eq = (g, w, m) => ok(g === w, `${m} (got ${JSON.stringify(g)}, want ${JSON.stringify(w)})`);

const NOW = 1_700_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const ME = 'user-me';
const THEM = 'user-them';

/* ---- isStale ---- */
ok(isStale(null, NOW) === true, 'null lockedAt is stale');
ok(isStale('not-a-date', NOW) === true, 'garbage lockedAt is stale');
ok(isStale(iso(NOW - 1000), NOW) === false, 'a lock from 1s ago is fresh');
ok(isStale(iso(NOW - LOCK_STALE_MS - 1), NOW) === true, 'past the stale window is stale');
ok(isStale(iso(NOW - LOCK_STALE_MS + 1000), NOW) === false, 'just inside the window is fresh');

/* ---- lockBlocks: the write gate ---- */
ok(lockBlocks(null, { userId: ME }, NOW) === false, 'no row → does not block');
ok(lockBlocks({}, { userId: ME }, NOW) === false, 'unlocked row → does not block');
ok(lockBlocks({ locked_by: null }, { userId: ME }, NOW) === false, 'explicit null holder → does not block');

const fresh = (holder, tok) => ({ locked_by: holder, locked_at: iso(NOW - 1000), lock_token: tok || 'lk_x' });

ok(lockBlocks(fresh(THEM), { userId: ME }, NOW) === true, 'someone else holds a fresh lock → BLOCKS me');
ok(lockBlocks(fresh(ME), { userId: ME }, NOW) === false, 'I hold it (by id) → does not block me');
ok(lockBlocks(fresh(THEM, 'lk_secret'), { userId: ME, token: 'lk_secret' }, NOW) === false,
   'I carry the matching lock_token → does not block me (offline-flush edge)');
ok(lockBlocks(fresh(THEM, 'lk_secret'), { userId: ME, token: 'lk_wrong' }, NOW) === true,
   'a WRONG token → still blocks');
ok(lockBlocks({ locked_by: THEM, locked_at: iso(NOW - LOCK_STALE_MS - 1), lock_token: 'lk_x' }, { userId: ME }, NOW) === false,
   'a stale foreign lock is breakable → does not block');
ok(lockBlocks(fresh(THEM), { userId: null }, NOW) === true,
   'unknown caller identity + fresh foreign lock → BLOCKS (fail safe)');

/* ---- lockView: the wire shape (never leaks lock_token) ---- */
const vMine = lockView(fresh(ME), ME, NOW);
eq(vMine.locked, true, 'view: mine → locked true');
eq(vMine.mine, true, 'view: mine → mine true');
ok(!('lock_token' in vMine), 'view NEVER includes lock_token');

const vTheirs = lockView({ locked_by: THEM, locked_by_label: 'Ryan', locked_at: iso(NOW - 1000), lock_token: 'lk_x' }, ME, NOW);
eq(vTheirs.locked, true, 'view: theirs → locked true');
eq(vTheirs.mine, false, 'view: theirs → mine false');
eq(vTheirs.lockedByLabel, 'Ryan', 'view: surfaces holder label for the banner');

const vStale = lockView({ locked_by: THEM, locked_at: iso(NOW - LOCK_STALE_MS - 1) }, ME, NOW);
eq(vStale.locked, false, 'view: stale lock reads as unlocked');
eq(vStale.stale, true, 'view: stale flag set');

const vNone = lockView(null, ME, NOW);
eq(vNone.locked, false, 'view: no row → unlocked');
eq(vNone.mine, false, 'view: no row → not mine');

console.log(`\nscript-lock-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
