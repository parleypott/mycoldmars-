/*
 * self-clearing-banners.test.mjs — phase-4 SELF-HEALING banners guard.
 *
 * THE LIVE FAILURE this locks: localStorage quota filled with full-size recovery snapshots →
 * "SAVE FAILED" banner + an "unsynced backup" recovery banner. After Johnny freed space / a save
 * succeeded, BOTH banners lingered until a manual full reload — he had to clear them by hand.
 *
 * The fix lives in src/main.jsx:
 *   (1) SaveStatus: a SUBSEQUENT verified save (`wp-saved`, which fires ONLY after saveDoc's
 *       read-back invariant passes) CLEARS a standing 'failed' state and returns the pill to normal —
 *       no reload. (Before: onSaved bailed while `s === 'failed'`, so the banner was sticky forever.)
 *   (2) RecoveryBanner: re-scans the snapshot stores on `wp-saved` / `wp-recovery-changed` (and on
 *       dismiss), so once snapshots are recovered/pruned/dismissed the banner disappears WITHOUT a
 *       reload. (Before: it scanned ONCE at mount and never again.)
 *
 * MUST STAY INTACT (these are NOT self-clearing — they are reload-to-merge):
 *   • the cross-tab/cloud CONFLICT banner (cloudConflict) — sticky until the page reloads.
 *   • the stale-tab amber notice — its own reload affordance.
 *   • saveDoc fires `wp-saved` ONLY on a read-back-verified success (so clearing on it is sound).
 *
 * Source-grep guards (no browser), matching the existing save-pill-actionable.test.mjs convention,
 * plus an assertion against migrate-doc.js that `wp-saved` is gated on the invariant.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, 'main.jsx'), 'utf8');
const migrate = readFileSync(join(here, 'migrate-doc.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗', name); } }

// ── helpers to isolate a function body so a match in SaveStatus can't be satisfied by RecoveryBanner.
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) return '';
  // crude but sufficient: take until the next top-level `\nfunction ` after the declaration.
  const next = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}
const saveStatus = sliceFn(main, 'SaveStatus');
const recoveryBanner = sliceFn(main, 'RecoveryBanner');

ok('SaveStatus function found', saveStatus.length > 0);
ok('RecoveryBanner function found', recoveryBanner.length > 0);

/* ───────────────────────── (1) SaveStatus: verified save clears the failed banner ───────────── */

// onSaved must UNCONDITIONALLY set 'saved' (no `s === 'failed' ? s : ...` bail). The bug was the
// ternary that kept failed sticky; the fix sets 'saved' outright. We assert the onSaved handler
// flips to 'saved' AND clears the fail message, and that it does NOT re-introduce the sticky bail.
const onSavedLine = (saveStatus.match(/const onSaved = .*/) || [''])[0];
ok('onSaved handler present in SaveStatus', onSavedLine.length > 0);
ok('onSaved sets state to "saved" (clears failed)', /setState\(\s*['"]saved['"]\s*\)/.test(onSavedLine));
ok('onSaved no longer bails while failed (sticky ternary removed)',
  !/onSaved\s*=\s*\(\)\s*=>\s*\{[^}]*s\s*===\s*['"]failed['"]/.test(saveStatus));
ok('onSaved clears the failure message', /const onSaved =[\s\S]{0,160}setFailMsg\(\s*['"]['"]\s*\)/.test(saveStatus));

// onDirty MUST still bail while failed — a mere keystroke is NOT proof storage recovered, and more
// unsaved edits are still at risk, so the banner stays until a save actually lands.
ok('onDirty STILL keeps failed sticky (keystroke does not clear)',
  /const onDirty = \(\) =>[\s\S]{0,120}s === ['"]failed['"] \? s : ['"]saving['"]/.test(saveStatus));

// The genuine cross-tab/cloud CONFLICT must remain reload-to-merge (NOT self-clearing).
ok('cloud conflict still sticky until reload (onCloudSaved keeps conflict)',
  /onCloudSaved = \(\) =>[\s\S]{0,80}c === ['"]conflict['"] \? c/.test(saveStatus));
ok('conflict banner still offers a RELOAD action', /is-conflict[\s\S]{0,700}location\.reload\(\)/.test(saveStatus));

/* ───────────────────────── (2) RecoveryBanner: self-clears without a reload ──────────────────── */

// It must attach listeners that re-run the async store scan when the picture could have changed.
ok('RecoveryBanner listens for wp-saved (storage recovered → re-scan)',
  /addEventListener\(\s*['"]wp-saved['"]/.test(recoveryBanner));
ok('RecoveryBanner listens for wp-recovery-changed (explicit recover/clear → re-scan)',
  /addEventListener\(\s*['"]wp-recovery-changed['"]/.test(recoveryBanner));
ok('RecoveryBanner re-scans via scanRecoverySnapshotsAsync in the handler',
  /scanRecoverySnapshotsAsync\(/.test(recoveryBanner));
ok('RecoveryBanner removes both listeners on unmount',
  /removeEventListener\(\s*['"]wp-saved['"]/.test(recoveryBanner) &&
  /removeEventListener\(\s*['"]wp-recovery-changed['"]/.test(recoveryBanner));
ok('RecoveryBanner unmounts when no snapshots remain (returns null on empty)',
  /snaps\.length === 0\) return null/.test(recoveryBanner));

// dismiss must broadcast wp-recovery-changed so other surfaces re-sync, and still remove locally.
ok('dismissOne broadcasts wp-recovery-changed', /function dismissOne[\s\S]{0,700}wp-recovery-changed/.test(recoveryBanner));
ok('dismissOne still removes the snapshot locally (instant feedback)',
  /function dismissOne[\s\S]{0,700}list\.filter\(/.test(recoveryBanner));

/* ── soundness: wp-saved is ONLY fired on a read-back-verified save, so clearing on it is correct ── */
ok('migrate-doc fires wp-saved only after the invariant + version bump (success path)',
  /STEP 4[\s\S]{0,400}dispatchEvent\(new CustomEvent\(['"]wp-saved['"]\)\)/.test(migrate) ||
  /SUCCESS[\s\S]{0,200}dispatchEvent\(new CustomEvent\(['"]wp-saved['"]\)\)/.test(migrate));
ok('a save FAILURE fires wp-save-failed (never wp-saved)',
  /notifySaveFailed/.test(migrate) && /wp-save-failed/.test(migrate));

console.log(`self-clearing-banners: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
