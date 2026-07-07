/**
 * Mutation-lock for the nightly off-vendor backup's pure logic.
 *
 * Guards the parts where a silent bug means silent data loss months later:
 *   - env parsing must survive `export` prefixes, quotes, and comments (a
 *     mis-parsed key = every nightly run fails auth),
 *   - prune must ONLY match exact YYYY-MM-DD dirs — backup.log and stray
 *     files must never be deletion candidates,
 *   - the 30-day boundary must keep day-30 and drop day-31 (off-by-one here
 *     quietly halves or doubles retention),
 *   - keyset pagination URLs must use strict `gt` so pages never overlap or
 *     skip rows on the ~200MB revisions table.
 *
 * Run: bun scripts/backup-script-data.test.mjs
 */
import assert from 'node:assert';
import { parseEnvFile, dateStamp, dirsToPrune, pageUrl } from './backup-script-data.ts';

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// --- parseEnvFile ----------------------------------------------------------
ok('parses plain KEY=value', () => {
  assert.deepEqual(parseEnvFile('SUPABASE_URL=https://x.supabase.co'), { SUPABASE_URL: 'https://x.supabase.co' });
});
ok('parses export prefix and strips quotes', () => {
  const env = parseEnvFile('export SUPABASE_SERVICE_KEY="abc.def.ghi"\nexport OTHER=\'v\'');
  assert.equal(env.SUPABASE_SERVICE_KEY, 'abc.def.ghi');
  assert.equal(env.OTHER, 'v');
});
ok('skips comments and blank lines', () => {
  const env = parseEnvFile('# comment\n\nA=1\n  # indented comment\nB=2');
  assert.deepEqual(env, { A: '1', B: '2' });
});
ok('value containing = survives (JWTs have none but base64 padding might)', () => {
  assert.equal(parseEnvFile('K=a=b=c').K, 'a=b=c');
});
ok('real secrets file parses and has the two keys the backup needs', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { homedir } = require('node:os');
  const env = parseEnvFile(readFileSync(join(homedir(), '.config', 'mycoldmars', 'secrets.env'), 'utf8'));
  assert.ok(env.SUPABASE_URL?.startsWith('https://'), 'SUPABASE_URL missing');
  assert.ok((env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.length > 20, 'service key missing');
});

// --- dateStamp --------------------------------------------------------------
ok('dateStamp pads month and day', () => {
  assert.equal(dateStamp(new Date(2026, 0, 5)), '2026-01-05');
});
ok('dateStamp uses local calendar date, not UTC', () => {
  // 00:30 local on July 7 must stamp July 7 even if UTC has rolled elsewhere
  assert.equal(dateStamp(new Date(2026, 6, 7, 0, 30)), '2026-07-07');
});

// --- dirsToPrune ------------------------------------------------------------
ok('never prunes non-date names (logs, stray files)', () => {
  const names = ['backup.log', 'launchd.log', 'notes.txt', '2026-13-99-ish', '2020-01-01T00'];
  assert.deepEqual(dirsToPrune(names, '2026-07-07', 30), []);
});
ok('keeps day-30, prunes day-31 (exact boundary)', () => {
  const names = ['2026-06-07', '2026-06-06', '2026-07-01'];
  // 2026-07-07 minus 30 days = 2026-06-07 → strictly-older-than cutoff prunes only 06-06
  assert.deepEqual(dirsToPrune(names, '2026-07-07', 30), ['2026-06-06']);
});
ok('prunes multiple old dirs, keeps recent ones', () => {
  const names = ['2026-01-01', '2026-05-01', '2026-07-06', '2026-07-07'];
  assert.deepEqual(dirsToPrune(names, '2026-07-07', 30).sort(), ['2026-01-01', '2026-05-01']);
});

// --- pageUrl ----------------------------------------------------------------
ok('first page has no cursor', () => {
  assert.equal(
    pageUrl('https://x.supabase.co', 'script_doc_revisions', null, 500),
    'https://x.supabase.co/rest/v1/script_doc_revisions?select=*&order=id.asc&limit=500',
  );
});
ok('subsequent pages use strict gt (no overlap, no skip)', () => {
  const u = pageUrl('https://x.supabase.co', 'script_doc_revisions', 1042, 500);
  assert.ok(u.includes('id=gt.1042'), 'must be gt, got: ' + u);
  assert.ok(!u.includes('gte'), 'gte would duplicate the boundary row');
  assert.ok(u.includes('order=id.asc'), 'keyset requires stable ordering');
});

console.log(`\nbackup-script-data: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
