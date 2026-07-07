// Locks the 90-day trash-ARCHIVE helpers in library-time.js (the script library's auto-archive).
//
// Johnny's decision: nothing is ever destroyed. After 90 days in the trash a project is ARCHIVED —
// it stops appearing in the trash view (server filter + these client-belt helpers) but the row and
// its full revision history stay in the DB, restorable by an admin via direct PATCH. So:
//   • isArchivedTrash decides visibility: 89d in trash -> shown, 91d -> hidden; a missing or
//     unparseable trash clock is NEVER archived (never hide what you can't date — same safety
//     posture as isInTrashWindow, and the same NaN-guard class as the rest of this module);
//   • archiveDaysLeft feeds the honest "archives in Nd" label (archive is NOT deletion — the old
//     "Nd left" wording implied a countdown to destruction);
//   • the boundary matches the server's strict-gt cutoff exactly (90d on the nose = archived).
//
// Run: bun scripts-library/src/library-archive-time.test.mjs

import assert from 'node:assert';
import {
  isArchivedTrash,
  archiveDaysLeft,
  TRASH_ARCHIVE_DAYS,
} from './library-time.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL:', name, '\n  ', e.message); } };

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 7, 12, 0, 0); // fixed "now" so every case is deterministic
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

t('window is 90 days', () => {
  assert.strictEqual(TRASH_ARCHIVE_DAYS, 90);
});

// ════════ isArchivedTrash — the visibility boundary ════════
t('89d in trash -> NOT archived (shown in the trash view)', () => {
  assert.strictEqual(isArchivedTrash(iso(89), NOW), false);
});
t('91d in trash -> archived (hidden from the trash view)', () => {
  assert.strictEqual(isArchivedTrash(iso(91), NOW), true);
});
t('boundary: exactly 90d -> archived; a millisecond younger -> shown (matches server strict gt)', () => {
  assert.strictEqual(isArchivedTrash(iso(90), NOW), true);
  assert.strictEqual(isArchivedTrash(new Date(NOW - 90 * DAY + 1).toISOString(), NOW), false);
});
t('fresh trash -> not archived', () => {
  assert.strictEqual(isArchivedTrash(iso(0), NOW), false);
});
t('missing/unparseable trash clock -> NEVER archived (kept visible + recoverable)', () => {
  assert.strictEqual(isArchivedTrash(null, NOW), false);
  assert.strictEqual(isArchivedTrash(undefined, NOW), false);
  assert.strictEqual(isArchivedTrash('', NOW), false);
  assert.strictEqual(isArchivedTrash('garbage', NOW), false);
});
t('future trash clock (clock skew) -> not archived', () => {
  assert.strictEqual(isArchivedTrash(iso(-1), NOW), false);
});

// ════════ archiveDaysLeft — the "archives in Nd" label ════════
t('freshly trashed -> archives in 90d', () => {
  assert.strictEqual(archiveDaysLeft(iso(0), NOW), 90);
});
t('89d in -> archives in 1d (still listed)', () => {
  assert.strictEqual(archiveDaysLeft(iso(89), NOW), 1);
});
t('past the window -> floored at 0, never negative', () => {
  assert.strictEqual(archiveDaysLeft(iso(90), NOW), 0);
  assert.strictEqual(archiveDaysLeft(iso(200), NOW), 0);
});
t('partial days floor toward archive (89.5d in -> 1d, not 0.5d)', () => {
  assert.strictEqual(archiveDaysLeft(new Date(NOW - 89.5 * DAY).toISOString(), NOW), 1);
});
t('missing/unparseable -> null (caller renders "in trash", never "NaNd")', () => {
  assert.strictEqual(archiveDaysLeft(null, NOW), null);
  assert.strictEqual(archiveDaysLeft(undefined, NOW), null);
  assert.strictEqual(archiveDaysLeft('garbage', NOW), null);
});

// ════════ coherence: the label never says "archives in 0d" for a row the view still shows ════════
t('every visible trash row reads "archives in >=1d"; 0 only once already hidden', () => {
  // The floor only reaches 0 at >=90d elapsed — exactly when isArchivedTrash flips to hidden — so
  // a card the trash view renders can never carry a confusing "archives in 0d". Lock the pairing
  // right up to the last second of visibility.
  const lastSecond = new Date(NOW - (90 * DAY - 1000)).toISOString(); // 1s from archiving
  assert.strictEqual(isArchivedTrash(lastSecond, NOW), false); // still shown...
  assert.strictEqual(archiveDaysLeft(lastSecond, NOW), 1);     // ...and still says 1d
  assert.strictEqual(isArchivedTrash(iso(90), NOW), true);     // hidden the moment...
  assert.strictEqual(archiveDaysLeft(iso(90), NOW), 0);        // ...the count hits 0
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
