/**
 * STICKY HEADER — show/hide contract (vector: sticky-header).
 *
 * The slim sticky strip carries the workspaces menu (and, for the owner, share) once the masthead
 * scrolls away. stickyHeaderVisible() is the ONE rule that decides whether it's on screen, and this
 * suite pins every branch so the interplay with workspace views and chapter-focus can never
 * silently regress:
 *
 *   • masthead visible            → HIDDEN (the real masthead already carries workspaces)
 *   • scrolled past the masthead  → SHOWN
 *   • a workspace view is active  → HIDDEN, even scrolled past (the wsbar owns the top edge)
 *   • chapter-focus is active     → HIDDEN, even scrolled past (the chfocus bar owns the top)
 *
 * READ-SHARE CONTRACT (workspaces-in-read): readOnly is NOT a hide gate. A ?read viewer gets the
 * read-safe workspaces menu in the strip too (the StickyHeader component drops only the owner-only
 * SHARE control) — so the rule returns the SAME answer for a share as for the owner. The combo
 * sweep below asserts exactly that: the result is independent of readOnly.
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

// THE ONE POSITIVE — scrolled past the masthead, no view holding the top edge → SHOWN.
ok(stickyHeaderVisible(base) === true, 'scrolled past masthead (no view) → SHOWN');

// Masthead visible always wins to HIDDEN — the strip never doubles the real masthead.
ok(stickyHeaderVisible({ ...base, mastheadVisible: true }) === false, 'masthead visible → HIDDEN');

// READ-SHARE: workspaces are read-safe, so the strip still carries them when scrolled past.
ok(stickyHeaderVisible({ ...base, readOnly: true }) === true, '?read share, scrolled past → SHOWN (carries read-safe workspaces)');
ok(stickyHeaderVisible({ ...base, readOnly: true, mastheadVisible: true }) === false, '?read share + masthead visible → HIDDEN');

// A workspace view owns the top edge (wp-wsbar) — strip yields.
ok(stickyHeaderVisible({ ...base, wsActive: true }) === false, 'workspace active → HIDDEN even scrolled past');

// Chapter-focus owns the top edge (wp-chfocus-bar) — strip yields.
ok(stickyHeaderVisible({ ...base, chFocusActive: true }) === false, 'chapter-focus active → HIDDEN even scrolled past');

// The show/hide answer is INDEPENDENT of readOnly — only the view gates and masthead visibility
// decide it (readOnly only changes WHAT the strip carries, handled in the component, not here).
for (const readOnly of [true, false]) {
  for (const wsActive of [true, false]) {
    for (const chFocusActive of [true, false]) {
      for (const mastheadVisible of [true, false]) {
        const expected = !wsActive && !chFocusActive && !mastheadVisible;
        const got = stickyHeaderVisible({ mastheadVisible, readOnly, wsActive, chFocusActive });
        ok(got === expected, `combo r=${readOnly} ws=${wsActive} ch=${chFocusActive} mh=${mastheadVisible} → ${expected}`);
      }
    }
  }
}

console.log(`\nsticky-header.test.mjs — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
