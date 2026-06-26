// Mutation-lock for the Interpreter upload-dialog stat-pill formatters.
//
// LIVE bug fixed here: fmtBytes rolled a value one byte under a unit
// boundary up into a phantom unit — 1 048 575 B rendered as "1024 KB"
// (should be "1.0 MB") and 1 073 741 823 B as "1024.0 MB" (should be
// "1.00 GB"), because each tier's toFixed() rounds the displayed number
// to a full next unit. Same rollover class as views-growth "1000K"->"1.0M".
//
// To prove the lock catches the bug, the BUGGY_fmtBytes below reproduces the
// old inline version; the boundary assertions go RED against it (see the
// commented mutation block at the bottom).

import { fmtBytes, fmtDuration } from './format-pills.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// ── fmtBytes: the rollover boundaries (the actual fix) ──
t('1 byte under 1 MiB promotes KB -> MB (was "1024 KB")', () => {
  assert.equal(fmtBytes(1024 * 1024 - 1), '1.0 MB');
});
t('1 byte under 1 GiB promotes MB -> GB (was "1024.0 MB")', () => {
  assert.equal(fmtBytes(1024 * 1024 * 1024 - 1), '1.00 GB');
});
t('exact MiB renders 1.0 MB', () => assert.equal(fmtBytes(1024 * 1024), '1.0 MB'));
t('exact GiB renders 1.00 GB', () => assert.equal(fmtBytes(1024 * 1024 * 1024), '1.00 GB'));

// ── fmtBytes: unit thresholds ──
t('0 -> 0 B', () => assert.equal(fmtBytes(0), '0 B'));
t('1023 stays in bytes', () => assert.equal(fmtBytes(1023), '1023 B'));
t('exactly 1024 -> 1 KB', () => assert.equal(fmtBytes(1024), '1 KB'));

// ── fmtBytes: well-formed mid-range values unchanged from old version ──
t('1536 -> 2 KB (rounds, unchanged)', () => assert.equal(fmtBytes(1536), '2 KB'));
t('5 MiB -> 5.0 MB (unchanged)', () => assert.equal(fmtBytes(5 * 1024 * 1024), '5.0 MB'));
t('2.5 GiB -> 2.50 GB (unchanged)', () => assert.equal(fmtBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB'));
t('a real-ish 734003 B -> 717 KB', () => assert.equal(fmtBytes(734003), '717 KB'));

// ── fmtDuration: regression lock (already correct, keep it correct) ──
t('falsy -> em dash', () => assert.equal(fmtDuration(0), '—'));
t('non-finite -> em dash', () => assert.equal(fmtDuration(Infinity), '—'));
t('NaN -> em dash', () => assert.equal(fmtDuration(NaN), '—'));
t('45s -> 45s', () => assert.equal(fmtDuration(45), '45s'));
t('90s -> 1m 30s', () => assert.equal(fmtDuration(90), '1m 30s'));
t('3600s carries the hour, drops seconds -> 1h 0m', () => assert.equal(fmtDuration(3600), '1h 0m'));
t('3661s -> 1h 1m (hour never dropped)', () => assert.equal(fmtDuration(3661), '1h 1m'));
t('rounds sub-second up', () => assert.equal(fmtDuration(44.6), '45s'));

// ── Mutation proof (run-once self-check): the OLD inline fmtBytes must
//    FAIL the two boundary assertions, proving the test would catch a regress.
const BUGGY_fmtBytes = (n) => {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (n >= 1024 * 1024)        return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024)               return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
t('MUTATION: old fmtBytes mis-renders the KB->MB boundary as "1024 KB"', () => {
  assert.equal(BUGGY_fmtBytes(1024 * 1024 - 1), '1024 KB'); // documents the bug
  assert.notEqual(BUGGY_fmtBytes(1024 * 1024 - 1), fmtBytes(1024 * 1024 - 1));
});
t('MUTATION: old fmtBytes mis-renders the MB->GB boundary as "1024.0 MB"', () => {
  assert.equal(BUGGY_fmtBytes(1024 * 1024 * 1024 - 1), '1024.0 MB');
  assert.notEqual(BUGGY_fmtBytes(1024 * 1024 * 1024 - 1), fmtBytes(1024 * 1024 * 1024 - 1));
});

console.log(`format-pills: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
