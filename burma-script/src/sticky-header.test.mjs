/**
 * STICKY HEADER — show/hide contract (vector: sticky-header).
 *
 * The slim sticky strip carries the workspaces menu (and share) once the masthead scrolls away.
 * stickyHeaderVisible() is the ONE rule that decides whether it's on screen, and this suite pins
 * every branch of that rule so the interplay with ?read shares, workspace views and chapter-focus
 * can never silently regress:
 *
 *   • masthead visible            → HIDDEN (the real masthead already carries workspaces)
 *   • scrolled past the masthead  → SHOWN
 *   • ?read SHARE (readOnly)      → HIDDEN, even scrolled past (a viewer has no owner chrome)
 *   • a workspace view is active  → HIDDEN, even scrolled past (the wsbar owns the top edge)
 *   • chapter-focus is active     → HIDDEN, even scrolled past (the chfocus bar owns the top)
 *
 * The "scrolled past" case is the one that must be SHOWN — it's the whole reason the strip exists.
 * If it were false the suite would be vacuously satisfiable by a function that always returns
 * false, so that positive case is what makes this real.
 *
 * Run: bun src/sticky-header.test.mjs   (auto-discovered by `bun run test`)
 */

import { stickyHeaderVisible } from './sticky-header.js';

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } }

const base = { mastheadVisible: false, readOnly: false, wsActive: false, chFocusActive: false };

// THE ONE POSITIVE — scrolled past the masthead, owner, no view holding the top edge → SHOWN.
ok(stickyHeaderVisible(base) === true, 'scrolled past masthead (owner, no view) → SHOWN');

// Masthead visible always wins to HIDDEN — the strip never doubles the real masthead.
ok(stickyHeaderVisible({ ...base, mastheadVisible: true }) === false, 'masthead visible → HIDDEN');

// ?read SHARE drops the whole strip, even scrolled deep.
ok(stickyHeaderVisible({ ...base, readOnly: true }) === false, '?read share → HIDDEN even scrolled past');
ok(stickyHeaderVisible({ ...base, readOnly: true, mastheadVisible: true }) === false, '?read share + masthead visible → HIDDEN');

// A workspace view owns the top edge (wp-wsbar) — strip yields.
ok(stickyHeaderVisible({ ...base, wsActive: true }) === false, 'workspace active → HIDDEN even scrolled past');

// Chapter-focus owns the top edge (wp-chfocus-bar) — strip yields.
ok(stickyHeaderVisible({ ...base, chFocusActive: true }) === false, 'chapter-focus active → HIDDEN even scrolled past');

// Any combination of the "never" gates stays HIDDEN regardless of scroll.
for (const readOnly of [true, false]) {
  for (const wsActive of [true, false]) {
    for (const chFocusActive of [true, false]) {
      for (const mastheadVisible of [true, false]) {
        const expected = !readOnly && !wsActive && !chFocusActive && !mastheadVisible;
        const got = stickyHeaderVisible({ mastheadVisible, readOnly, wsActive, chFocusActive });
        ok(got === expected, `combo r=${readOnly} ws=${wsActive} ch=${chFocusActive} mh=${mastheadVisible} → ${expected}`);
      }
    }
  }
}

console.log(`\nsticky-header.test.mjs — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
