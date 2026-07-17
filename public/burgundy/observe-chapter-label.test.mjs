// Locks the SCROLL-MODE chapter-label guard added to observeChapters() in the
// BURGUNDY reader (public/burgundy/index.html, commit f5ebeff added a "Prologue"
// front-matter section rendered as a .chapter element with data-ch="pro").
//
// THE BUG this pins (scroll mode only): observeChapters()'s IntersectionObserver
// observes EVERY .chapter element — now including the new prologue. Its callback did
//     const ci = +en.target.dataset.ch;              // prologue: +("pro") === NaN
//     $('chap-label').textContent = `ch ${ci + 1}...` // → "ch NaN"
// so scrolling into the prologue (the first thing every onboarded reader sees via a
// ?r= link) painted "ch NaN" in the running header. Paged mode already treats the
// prologue as front matter (firstParaOnPage returns null → afterPageChange's
// `if (!p) return` leaves the label alone); scroll mode had no such guard.
//
// THE FIX (mirrors paged mode's front-matter handling): a `Number.isFinite(ci)` guard
// skips the label update for any non-numeric data-ch. Byte-identical for every real
// chapter (data-ch is a number); only the prologue case changes (no "ch NaN").
//
// This test does two things:
//  (1) SOURCE-LOCK: asserts the shipped observeChapters() still carries the guard, so a
//      revert of the one-line fix breaks this test.
//  (2) BEHAVIOR + MUTATION: models the label rule both WITH and WITHOUT the guard and
//      proves the guarded form skips the prologue while the unguarded form emits "ch NaN".

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// ── (1) SOURCE-LOCK: the guard must live inside observeChapters() ──────────────
const obs = html.match(/function observeChapters\(\)\s*\{[\s\S]*?\n\}/);
assert.ok(obs, 'could not extract observeChapters() — did the function signature change?');
assert.match(
  obs[0],
  /const ci = \+en\.target\.dataset\.ch;\s*\n\s*if \(!Number\.isFinite\(ci\)\) continue;/,
  'observeChapters() is missing the `if (!Number.isFinite(ci)) continue;` front-matter guard — ' +
  'the prologue (data-ch="pro") would paint "ch NaN" in scroll mode'
);

// ── (2) BEHAVIOR + MUTATION ────────────────────────────────────────────────────
// The shipped label rule, modeled as a pure function of (dataCh, title). Returns the
// text the header WOULD be set to, or null when the guard skips the update (label left
// as-is). `bareTitle('')` → '' in the reader, so an unknown/empty title just drops the
// " · title" suffix.
const bareTitle = (t) => String(t || '');
const chapters = ['One', 'Two', 'Three']; // stand-in BOOK.chapters titles

function labelGuarded(dataCh) {
  const ci = +dataCh;
  if (!Number.isFinite(ci)) return null;              // <-- the fix
  const bt = bareTitle(chapters[ci] || '');
  return `ch ${ci + 1}${bt ? ' · ' + bt : ''}`;
}
function labelUnguarded(dataCh) {                       // the pre-fix form
  const ci = +dataCh;
  const bt = bareTitle(chapters[ci] || '');
  return `ch ${ci + 1}${bt ? ' · ' + bt : ''}`;
}

// Real chapters: guard is transparent — identical to the old behavior.
assert.equal(labelGuarded('0'), 'ch 1 · One', 'chapter 0 label');
assert.equal(labelGuarded('1'), 'ch 2 · Two', 'chapter 1 label');
assert.equal(labelGuarded('2'), 'ch 3 · Three', 'chapter 2 label');
for (const dc of ['0', '1', '2']) {
  assert.equal(labelGuarded(dc), labelUnguarded(dc),
    `guard must be byte-identical for real chapter data-ch=${dc}`);
}

// The prologue: guarded form skips (label untouched); unguarded form paints "ch NaN".
assert.equal(labelGuarded('pro'), null, 'prologue (data-ch="pro") must NOT update the chapter label');
assert.equal(labelUnguarded('pro'), 'ch NaN', 'proves the pre-fix form emitted "ch NaN" — the bug this locks');

// A missing data-ch attribute (dataset.ch === undefined → +undefined === NaN) is front
// matter too, not chapter 1. (An empty string is NOT a real case here — every rendered
// section carries either a numeric data-ch or the literal "pro"; and +("") === 0, which
// is why the guard keys on Number.isFinite rather than truthiness.)
assert.equal(labelGuarded(undefined), null, 'missing data-ch is front matter, not "ch 1"');

console.log('observe-chapter-label: all assertions passed');
