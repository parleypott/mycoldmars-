// Newpress INVESTOR DECK — navTarget() navigation-clamp coverage (first coverage).
//
// THE RISK (latent, zero prior coverage): the live deck
// (mycoldmars.vercel.app/newpress-deck/) routes every slide change through goTo(index),
// and next()/prev() feed it current ± 1 off key/click/swipe. The ONLY thing between an
// edge input and a crash is the bounds clamp. The render-contract test (render-slide.test)
// deliberately STOPS before the NAVIGATION section, so this clamp was never locked.
// If it regresses: prev() at slide 0 → current = -1 → updateProgress() reads
// slides[-1].bg → TypeError → the whole deck blanks mid-pitch.
//
// This imports the REAL shipped navTarget() from src/nav.js — the SAME function main.js's
// goTo() now calls — so the test can never drift from the live code.

import assert from 'node:assert/strict';
import { navTarget } from './src/nav.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TOTAL = 19; // a representative deck length

// ── Interior moves return the requested index. ──
eq(navTarget(5, 4, TOTAL), 5, 'next from 4 should target 5');
eq(navTarget(3, 4, TOTAL), 3, 'prev from 4 should target 3');
eq(navTarget(12, 0, TOTAL), 12, 'segment-click jump to 12 should target 12');

// ── Edges: hard stop, NO wrap. (next() at last / prev() at first must no-op.) ──
eq(navTarget(TOTAL, TOTAL - 1, TOTAL), null, 'next() past the last slide must no-op (no wrap to 0)');
eq(navTarget(-1, 0, TOTAL), null, 'prev() before the first slide must no-op (no wrap to last)');
eq(navTarget(TOTAL - 1, TOTAL - 2, TOTAL), TOTAL - 1, 'reaching the genuine last slide is allowed');
eq(navTarget(0, 1, TOTAL), 0, 'reaching the genuine first slide is allowed');

// ── Already-there is a no-op (avoids needless re-render / passed-class churn). ──
eq(navTarget(4, 4, TOTAL), null, 'navigating to the current slide must no-op');
eq(navTarget(0, 0, TOTAL), null, 'navigating to current at slide 0 must no-op');

// ── Out-of-range jumps (stale segment idx, bad deep-link) clamp to no-op, never crash. ──
eq(navTarget(999, 4, TOTAL), null, 'far-out-of-range index must no-op');
eq(navTarget(-50, 4, TOTAL), null, 'far-negative index must no-op');

// ── Non-integer / garbage indices must no-op, not navigate to all[NaN] (undefined → crash). ──
eq(navTarget(NaN, 4, TOTAL), null, 'NaN index must no-op');
eq(navTarget(2.5, 4, TOTAL), null, 'fractional index must no-op');
eq(navTarget(undefined, 4, TOTAL), null, 'undefined index must no-op');

// ── A single-slide deck: there is nowhere to go from slide 0. ──
eq(navTarget(1, 0, 1), null, 'next() in a 1-slide deck must no-op');
eq(navTarget(-1, 0, 1), null, 'prev() in a 1-slide deck must no-op');

// ════════════════════════════════════════════════════════════════════════
//  MUTATION PROOF — the clamp has teeth. These assert the SPECIFIC crash the
//  guard prevents, so the invariants above can't pass vacuously.
// ════════════════════════════════════════════════════════════════════════

// 1) If the lower bound were dropped (`index < 0` removed), prev-at-0 would return -1,
//    and goTo would later do slides[-1].bg → crash. Lock that it returns null, not -1.
ok(navTarget(-1, 0, TOTAL) !== -1, 'CLAMP: prev at slide 0 must NOT yield -1 (that crashes the deck)');

// 2) If the upper bound were dropped (`index >= total` removed), next-at-last would return
//    `total` (one past the end) → all[total] undefined → crash. Lock it returns null.
ok(navTarget(TOTAL, TOTAL - 1, TOTAL) !== TOTAL, 'CLAMP: next at last slide must NOT yield total (off the end)');

// 3) No-wrap proof: an honest wrap implementation would map next-past-last → 0. Ours must NOT.
ok(navTarget(TOTAL, TOTAL - 1, TOTAL) !== 0, 'NO-WRAP: next past last must not silently jump to slide 0');

console.log(`newpress-deck nav: ${checks} checks passed (clamp + no-wrap + non-integer guard)`);
