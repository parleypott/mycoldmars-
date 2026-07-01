// Locks initialsOf — the avatar monogram helper consolidated from FIVE
// byte-identical inline copies in main.js (editor badge, header identity,
// revision author, presence pill, share avatar). Mutation guards below prove
// the test catches (a) losing the two-initial cap, (b) losing uppercasing,
// (c) losing the '?' empty fallback, and (d) losing null-safety — the exact
// behavior each inline copy relied on.
import { initialsOf } from './initials.js';

let passed = 0, failed = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ── Core behavior ──
eq(initialsOf('Johnny Harris'), 'JH', 'two words → first two initials');
eq(initialsOf('bob jones'), 'BJ', 'lowercase input is uppercased');
eq(initialsOf('Madonna'), 'M', 'single word → single initial');
eq(initialsOf('John Adam Smith'), 'JA', 'three words capped at two initials');
eq(initialsOf('Mary  Jane'), 'MJ', 'collapsed whitespace run splits cleanly');
eq(initialsOf('Jean-Luc Picard'), 'JP', 'hyphenated first name counts once');

// ── Empty / degenerate → '?' fallback (load-bearing: callers show a pill) ──
eq(initialsOf(''), '?', 'empty string → ?');
eq(initialsOf('   '), '?', 'whitespace-only → ?');

// ── Null-safety (the property four of the five inline copies LACKED) ──
eq(initialsOf(null), '?', 'null → ? (no crash)');
eq(initialsOf(undefined), '?', 'undefined → ? (no crash)');
eq(initialsOf(42), '4', 'a bare number coerces to its digits without throwing');

// ── Parity with the old `(name || "?")` share-avatar variant ──
eq(initialsOf('Pending invite'), 'PI', 'multi-word fallback label still monograms');

// ── Mutation guards: neutering the impl must turn these RED ──
// If someone drops `.slice(0, 2)`, 'John Adam Smith' → 'JAS' (guard #4 fails).
// If someone drops `.toUpperCase()`, 'bob jones' → 'bj' (guard #2 fails).
// If someone drops `|| '?'`, '' → '' (guards #7-11 fail).
// If someone reverts to `name.split(...)`, null/undefined/42 throw (guards #9-11 fail).

console.log(`\ninitials: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
