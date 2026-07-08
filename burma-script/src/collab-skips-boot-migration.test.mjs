/*
 * collab-skips-boot-migration.test.mjs — locks the fix for the "clunky reload + red SAVE FAILED
 * flash" Johnny reported 2026-07-08 on his live (collab) #burma doc.
 *
 * THE LIVE FAILURE: his collab doc carries a bare top-level node, so migrateStoredDoc's
 * "already migrated" early-return never fires and the full single-writer boot migration re-ran
 * on EVERY reload — a ~167KB parse/rewrite before first paint (the clunk) whose STEP-1 backup
 * could fail on his near-quota origin and raise a big red "SAVE FAILED" banner that the first
 * real save cleared 1-2s later (the flash). Untrue in collab: the Yjs room is canonical and the
 * local store is a demoted snapshot healed by ensureTableDoc at load.
 *
 * THE FIX (two belts, both source-grepped here like self-clearing-banners.test.mjs):
 *   (1) main.jsx startup() gates the migration on the already-known collabActive flag:
 *       `if (!collabActive) runStartupMigration();` — no boot migration in a collab session.
 *   (2) backupRaw (migrate-doc.js) gains the same makeQuotaEscalator retry loop the canonical
 *       write uses, so a tight (non-collab) origin can't false-abort migration either.
 *
 * MUST STAY TRUE: the migration STILL runs for single-writer (non-collab) projects — the gate is
 * `!collabActive`, not an unconditional skip.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, 'main.jsx'), 'utf8');
const migrate = readFileSync(join(here, 'migrate-doc.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('  ✗', name); } };

// ── isolate the startup() body so a match elsewhere in main can't satisfy these.
function sliceFn(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  const next = src.indexOf('\nfunction ', start + 1);
  const nextAsync = src.indexOf('\nasync function ', start + 1);
  const ends = [next, nextAsync].filter((n) => n > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}
const startup = sliceFn(main, 'async function startup');

ok('startup() found', startup.length > 0);

// (1) migration is gated on !collabActive — not called unconditionally.
ok('boot migration is gated on !collabActive', /if\s*\(\s*!collabActive\s*\)\s*runStartupMigration\(\)/.test(startup));
ok('there is NO unconditional runStartupMigration() call in startup()',
  !/(^|[^)]\s)runStartupMigration\(\)/m.test(startup.replace(/if\s*\(\s*!collabActive\s*\)\s*runStartupMigration\(\)/g, '')));

// collabActive must be resolved BEFORE the gated call (order guard — a gate on an undefined flag
// would silently always-run). Both appear; collabActive's `let`/assignment precedes the call.
const flagAt = startup.indexOf('collabActive =');
const callAt = startup.indexOf('if (!collabActive) runStartupMigration()');
ok('collabActive is resolved before the gated migration call', flagAt > 0 && callAt > 0 && flagAt < callAt);

// (2) backupRaw uses the quota escalator (isolate its body).
const backup = sliceFn(migrate, 'export function backupRaw');
ok('backupRaw found', backup.length > 0);
ok('backupRaw uses makeQuotaEscalator (belt for non-collab tight origins)', backup.includes('makeQuotaEscalator()'));
ok('backupRaw retries the setItem in a loop, only returning null when eviction is exhausted',
  /for\s*\(;;\)/.test(backup) && /if\s*\(\s*!evict\(\)\s*\)\s*return null/.test(backup));

console.log(`\ncollab-skips-boot-migration: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
