// Locks the NaN-safe trash-retention + relative-time helpers in library-time.js
// (the two display-site follow-ups the recent-view sort fix 4ead52a logged).
//
// The bugs (same unguarded-`new Date(x).getTime()` class as the sort):
//   • trash filter: `Date.now() - new Date(deletedAt).getTime() < window` is
//     `NaN < window === false` for a bad/missing deleted_at -> a deleted
//     transcript was silently DROPPED from the recovery UI (unrecoverable);
//     and the days-left expr yielded "NaNd left".
//   • relativeTime: a NaN diff fell through to toLocaleDateString -> "Invalid Date".
//
// Strategy: import the REAL shipped helpers, prove the OLD inline logic was buggy
// (inline RED proofs), assert the fix keeps a bad-dated item recoverable + renders
// sensibly, and lock byte-identical behavior for every VALID date (zero regression).

import assert from 'node:assert';
import {
  parseDateMs,
  isInTrashWindow,
  trashDaysLeft,
  relativeTimeFrom,
} from './library-time.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL:', name, '\n  ', e.message); } };

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 20, 23, 0, 0); // fixed "now" so every case is deterministic
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// ── inline reconstruction of the OLD buggy logic (the RED proofs) ──
const OLD_inWindow = (deletedAt) => (NOW - new Date(deletedAt).getTime()) < 30 * DAY;
const OLD_daysLeft = (deletedAt) => Math.max(0, 30 - Math.floor((NOW - new Date(deletedAt).getTime()) / DAY));
const OLD_relativeTime = (dateStr) => {
  const then = new Date(dateStr).getTime();
  const diff = NOW - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ════════ RED proofs: the old logic was genuinely broken ════════
t('RED: OLD trash filter DROPS an undefined/garbage deleted_at (unrecoverable)', () => {
  assert.strictEqual(OLD_inWindow(undefined), false, 'undefined should be dropped by old code');
  assert.strictEqual(OLD_inWindow('garbage'), false, 'garbage should be dropped by old code');
  // the fix keeps them:
  assert.strictEqual(isInTrashWindow(undefined, NOW), true);
  assert.strictEqual(isInTrashWindow('garbage', NOW), true);
});
t('RED: OLD daysLeft renders "NaNd left" on a garbage deleted_at', () => {
  assert.ok(Number.isNaN(OLD_daysLeft('garbage')), 'old daysLeft is NaN -> "NaNd left"');
  assert.strictEqual(trashDaysLeft('garbage', NOW), null); // caller renders "—"
});
t('RED: OLD relativeTime renders "Invalid Date" on a bad date', () => {
  assert.strictEqual(OLD_relativeTime('garbage'), 'Invalid Date');
  assert.strictEqual(relativeTimeFrom('garbage', NOW), 'unknown');
});

// ════════ parseDateMs ════════
t('parseDateMs: valid ISO -> exact epoch ms', () => {
  const s = iso(0);
  assert.strictEqual(parseDateMs(s), new Date(s).getTime());
});
t('parseDateMs: numeric epoch 0 is a valid finite date', () => {
  assert.strictEqual(parseDateMs(0), 0);
});
t('parseDateMs: missing (null/undefined/empty) -> null', () => {
  assert.strictEqual(parseDateMs(null), null);
  assert.strictEqual(parseDateMs(undefined), null);
  assert.strictEqual(parseDateMs(''), null);
});
t('parseDateMs: unparseable -> null', () => {
  assert.strictEqual(parseDateMs('not-a-date'), null);
  assert.strictEqual(parseDateMs('Invalid Date'), null);
  assert.strictEqual(parseDateMs(NaN), null);
});

// ════════ isInTrashWindow ════════
t('isInTrashWindow: deleted within 30d -> kept', () => {
  assert.strictEqual(isInTrashWindow(iso(5 * DAY), NOW), true);
  assert.strictEqual(isInTrashWindow(iso(29 * DAY), NOW), true);
});
t('isInTrashWindow: deleted just over 30d -> dropped', () => {
  assert.strictEqual(isInTrashWindow(iso(31 * DAY), NOW), false);
});
t('isInTrashWindow: boundary at exactly 30d -> dropped (strict <)', () => {
  assert.strictEqual(isInTrashWindow(iso(30 * DAY), NOW), false);
  assert.strictEqual(isInTrashWindow(iso(30 * DAY - 1), NOW), true);
});
t('isInTrashWindow: missing/unparseable deleted_at -> KEPT (recoverable)', () => {
  assert.strictEqual(isInTrashWindow(undefined, NOW), true);
  assert.strictEqual(isInTrashWindow(null, NOW), true);
  assert.strictEqual(isInTrashWindow('', NOW), true);
  assert.strictEqual(isInTrashWindow('garbage', NOW), true);
});
t('isInTrashWindow: future deletion (negative elapsed) -> kept (matches old)', () => {
  assert.strictEqual(isInTrashWindow(iso(-DAY), NOW), true);
});
t('isInTrashWindow: equivalence with OLD logic for every VALID date (no regression)', () => {
  for (const d of [0, 1, 5, 15, 29, 30, 31, 100]) {
    const s = iso(d * DAY);
    assert.strictEqual(isInTrashWindow(s, NOW), OLD_inWindow(s), `mismatch at ${d}d`);
  }
});

// ════════ trashDaysLeft ════════
t('trashDaysLeft: fresh deletion -> ~30', () => {
  assert.strictEqual(trashDaysLeft(iso(0), NOW), 30);
});
t('trashDaysLeft: 5 days in -> 25', () => {
  assert.strictEqual(trashDaysLeft(iso(5 * DAY), NOW), 25);
});
t('trashDaysLeft: past window -> floored at 0', () => {
  assert.strictEqual(trashDaysLeft(iso(40 * DAY), NOW), 0);
});
t('trashDaysLeft: missing/unparseable -> null (caller renders dash)', () => {
  assert.strictEqual(trashDaysLeft(undefined, NOW), null);
  assert.strictEqual(trashDaysLeft('garbage', NOW), null);
});
t('trashDaysLeft: equivalence with OLD logic for every VALID date (no regression)', () => {
  for (const d of [0, 1, 5, 15, 29, 30, 31]) {
    const s = iso(d * DAY);
    assert.strictEqual(trashDaysLeft(s, NOW), OLD_daysLeft(s), `mismatch at ${d}d`);
  }
});

// ════════ relativeTimeFrom ════════
t('relativeTimeFrom: tiers (just now / m / h / yesterday / d / date)', () => {
  assert.strictEqual(relativeTimeFrom(iso(30 * 1000), NOW), 'just now');
  assert.strictEqual(relativeTimeFrom(iso(5 * 60 * 1000), NOW), '5m ago');
  assert.strictEqual(relativeTimeFrom(iso(3 * 60 * 60 * 1000), NOW), '3h ago');
  assert.strictEqual(relativeTimeFrom(iso(DAY), NOW), 'yesterday');
  assert.strictEqual(relativeTimeFrom(iso(3 * DAY), NOW), '3d ago');
  // >=7d falls through to a localized date string
  assert.strictEqual(relativeTimeFrom(iso(40 * DAY), NOW), OLD_relativeTime(iso(40 * DAY)));
});
t('relativeTimeFrom: missing/unparseable -> "unknown" (not "Invalid Date")', () => {
  assert.strictEqual(relativeTimeFrom(null, NOW), 'unknown');
  assert.strictEqual(relativeTimeFrom(undefined, NOW), 'unknown');
  assert.strictEqual(relativeTimeFrom('', NOW), 'unknown');
  assert.strictEqual(relativeTimeFrom('garbage', NOW), 'unknown');
});
t('relativeTimeFrom: equivalence with OLD logic for every VALID date (no regression)', () => {
  for (const ms of [0, 30 * 1000, 5 * 60 * 1000, 90 * 60 * 1000, DAY, 3 * DAY, 6 * DAY, 8 * DAY, 60 * DAY]) {
    const s = iso(ms);
    assert.strictEqual(relativeTimeFrom(s, NOW), OLD_relativeTime(s), `mismatch at ${ms}ms`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
