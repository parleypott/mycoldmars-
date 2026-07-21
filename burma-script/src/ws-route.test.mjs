/*
 * ws-route.test.mjs — the ?ws= workspace routing flag contract (ws-route.js).
 *
 * Proves:
 *   1. PARSE — the flag reads from location.search AND from the hash-query
 *      (#slug?ws=key), search first; unknown keys are dropped (never trusted);
 *      every WORKSPACE_ROLES key plus 'map' is legal.
 *   2. WRITE (hash) — setWsInHash adds/replaces/removes ws= while preserving the
 *      slug and every other hash-query flag (?backups, ?bm= survive).
 *   3. WRITE (search) — setWsInSearch same contract for hashless standalone doors.
 *   4. ROUND TRIP — what setWsInHash writes, parseWsFlag reads back.
 *
 * Run: bun src/ws-route.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { WS_KEYS, WS_MAP_KEY, parseWsFlag, setWsInHash, setWsInSearch } from './ws-route.js';
import { WORKSPACE_ROLES } from './workspaces.js';
import { setEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// ── 1. PARSE ─────────────────────────────────────────────────────────────────
ok('WS_KEYS = every workspace role key + map', () => {
  for (const r of WORKSPACE_ROLES) assert.ok(WS_KEYS.has(r.key), r.key);
  assert.ok(WS_KEYS.has(WS_MAP_KEY));
  assert.equal(WS_KEYS.size, WORKSPACE_ROLES.length + 1);
});

ok('parse: from search, from hash-query, search wins, unknown dropped', () => {
  assert.equal(parseWsFlag('?ws=broll', ''), 'broll');
  assert.equal(parseWsFlag('', '#burma?ws=pending'), 'pending');
  assert.equal(parseWsFlag('?read&ws=map', '#x'), 'map');
  assert.equal(parseWsFlag('?ws=vo', '#burma?ws=broll'), 'vo', 'search parses first');
  assert.equal(parseWsFlag('?ws=zzz', ''), null, 'unknown token is never trusted');
  assert.equal(parseWsFlag('?ws=zzz', '#s?ws=3d'), '3d', 'bad search falls through to hash');
  assert.equal(parseWsFlag('', ''), null);
  assert.equal(parseWsFlag('', '#burma'), null, 'hash without a query carries no flag');
  assert.equal(parseWsFlag('', '#burma?backups'), null);
  assert.equal(parseWsFlag('', '#burma?backups=&ws=archive'), 'archive', 'URLSearchParams bare-flag form');
  assert.equal(parseWsFlag('?WS=broll', ''), null, 'param name is case-sensitive (ws only)');
  assert.equal(parseWsFlag('?ws=BROLL', ''), 'broll', 'key value normalizes lowercase');
});

// ── 2. WRITE — hash ──────────────────────────────────────────────────────────
ok('setWsInHash: add / replace / remove, slug + other flags preserved', () => {
  assert.equal(setWsInHash('#burma', 'broll'), '#burma?ws=broll');
  assert.equal(setWsInHash('burma', 'broll'), '#burma?ws=broll', 'leading # optional');
  assert.equal(setWsInHash('#burma?ws=broll', 'pending'), '#burma?ws=pending');
  assert.equal(setWsInHash('#burma?ws=broll', null), '#burma');
  assert.equal(setWsInHash('', null), '', 'nothing to write, nothing written');
  assert.equal(setWsInHash('', 'map'), '#?ws=map', 'hashless callers should prefer setWsInSearch');
  const withBackups = setWsInHash('#my-script?backups', 'vo');
  assert.ok(withBackups.startsWith('#my-script?'), 'slug untouched');
  assert.ok(/[?&]ws=vo\b/.test(withBackups));
  assert.ok(/[?&]backups\b/.test(withBackups), 'the ?backups flag still matches its reader regex');
  const removed = setWsInHash(withBackups, null);
  assert.ok(/[?&]backups\b/.test(removed) && !/[?&]ws=/.test(removed));
  const withBm = setWsInHash('#burma?bm=blk_abc123', 'factcheck');
  assert.ok(/[?&]bm=blk_abc123\b/.test(withBm), 'bookmark deep-link rides along');
});

// ── 3. WRITE — search ────────────────────────────────────────────────────────
ok('setWsInSearch: add / replace / remove, other flags preserved', () => {
  assert.equal(setWsInSearch('', 'broll'), '?ws=broll');
  assert.equal(setWsInSearch('?ws=broll', 'mapdata'), '?ws=mapdata');
  assert.equal(setWsInSearch('?ws=broll', null), '');
  const s = setWsInSearch('?read', 'animation');
  assert.ok(/[?&]read\b/.test(s) && /[?&]ws=animation\b/.test(s));
});

// ── 4. ROUND TRIP ────────────────────────────────────────────────────────────
ok('round trip: written flags parse back for every legal key', () => {
  for (const key of WS_KEYS) {
    assert.equal(parseWsFlag('', setWsInHash('#burma?backups', key)), key);
    assert.equal(parseWsFlag(setWsInSearch('?read', key), ''), key);
  }
});

console.log(`ws-route: ${pass} passed, 0 failed`);
