/**
 * Mutation-lock for the weekly offsite backup's pure logic.
 *
 * Guards the failure modes that would quietly rot the offsite copies:
 *   - newestDatedDir must ignore non-date names (weeklies/, backup.log) or the
 *     tar would snapshot garbage,
 *   - stampOfWeekly must recognize split parts, or pruning strands .part-*
 *     files forever while deleting their siblings,
 *   - weekliesToPrune must keep exactly the newest 8 stamps — an off-by-one
 *     here either bloats the private repo past GitHub limits or silently
 *     drops retention to 7 weeks,
 *   - generatePassphrase output must be shell-safe (base64url) because it
 *     rides through env vars and an env file.
 *
 * Run: bun scripts/backup-offsite-weekly.test.mjs
 */
import assert from 'node:assert';
import { newestDatedDir, weeklyArchiveName, stampOfWeekly, weekliesToPrune, generatePassphrase } from './backup-offsite-weekly.ts';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// --- newestDatedDir ----------------------------------------------------------
ok('picks the newest dated dir', () => {
  assert.equal(newestDatedDir(['2026-07-01', '2026-07-07', '2026-06-30']), '2026-07-07');
});
ok('ignores logs, weeklies dir, and near-miss names', () => {
  assert.equal(newestDatedDir(['backup.log', 'weeklies', '2026-07-07T03', 'offsite.log']), null);
});
ok('null on empty root (nightly never ran)', () => {
  assert.equal(newestDatedDir([]), null);
});

// --- weeklyArchiveName / stampOfWeekly ---------------------------------------
ok('archive name round-trips through stamp parser', () => {
  assert.equal(stampOfWeekly(weeklyArchiveName('2026-07-07')), '2026-07-07');
});
ok('split parts parse to the same stamp as the whole', () => {
  assert.equal(stampOfWeekly('weekly-2026-07-07.tar.enc.part-aa'), '2026-07-07');
  assert.equal(stampOfWeekly('weekly-2026-07-07.tar.enc.part-ab'), '2026-07-07');
});
ok('non-weekly names never parse (never prune candidates)', () => {
  for (const n of ['offsite.log', '.weekly-2026-07-07.tar.tmp', 'weekly-2026-07-07.tar', 'README.md']) {
    assert.equal(stampOfWeekly(n), null, n);
  }
});

// --- weekliesToPrune ----------------------------------------------------------
const stamps = (n) => Array.from({ length: n }, (_, i) => `weekly-2026-0${Math.floor(i / 9) + 1}-0${(i % 9) + 1}.tar.enc`);
ok('keeps everything at or under the cap', () => {
  assert.deepEqual(weekliesToPrune(stamps(8), 8), []);
});
ok('prunes exactly the oldest stamp when one over the cap', () => {
  const names = ['weekly-2026-05-01.tar.enc', 'weekly-2026-06-01.tar.enc', 'weekly-2026-07-01.tar.enc'];
  assert.deepEqual(weekliesToPrune(names, 2), ['weekly-2026-05-01.tar.enc']);
});
ok('prunes ALL parts of an old split archive together', () => {
  const names = [
    'weekly-2026-05-01.tar.enc.part-aa',
    'weekly-2026-05-01.tar.enc.part-ab',
    'weekly-2026-06-01.tar.enc',
    'weekly-2026-07-01.tar.enc',
  ];
  assert.deepEqual(weekliesToPrune(names, 2).sort(), [
    'weekly-2026-05-01.tar.enc.part-aa',
    'weekly-2026-05-01.tar.enc.part-ab',
  ]);
});
ok('split parts count as ONE stamp toward the cap, not two', () => {
  const names = ['weekly-2026-06-01.tar.enc.part-aa', 'weekly-2026-06-01.tar.enc.part-ab', 'weekly-2026-07-01.tar.enc'];
  assert.deepEqual(weekliesToPrune(names, 2), []);
});
ok('stray files are never pruned', () => {
  assert.deepEqual(weekliesToPrune(['offsite.log', 'notes.txt'], 1), []);
});

// --- generatePassphrase --------------------------------------------------------
ok('passphrase is long, base64url, and unique per call', () => {
  const a = generatePassphrase(), b = generatePassphrase();
  assert.ok(a.length >= 42, `too short: ${a.length}`); // 32 bytes → 43 base64url chars
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), 'must be shell/env-safe base64url');
  assert.notEqual(a, b);
});

console.log(`\nbackup-offsite-weekly: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
