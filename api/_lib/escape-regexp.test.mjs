// Mutation-lock for the shared regex-literal escaper (api/_lib/escape-regexp.js).
// Consolidated from byte-identical private copies in qss-canon.js + qss-signals.js
// (obs 6441). The load-bearing property: EVERY regex metacharacter must be
// escaped so a character name / alias / category verb interpolated into a
// `new RegExp(...)` matches LITERALLY — a missed metachar either silently
// mis-matches (a bare '.' matches any char) or throws SyntaxError and crashes
// the whole pass. Neutering any escaped char in the class turns these RED.
import { escapeRegExp } from './escape-regexp.js';
import assert from 'node:assert';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. Round-trip: the escaped string, used as a RegExp, matches the ORIGINAL literally.
// Every metachar in the class is exercised here, so dropping any one breaks the match.
for (const raw of [
  'Dr. Periwinkle',        // '.'
  'K.O.',                  // '.' x2
  'a*b',                   // '*'
  'a+b',                   // '+'
  'who?',                  // '?'
  '^top',                  // '^'
  '$cash',                 // '$'
  'a{2}',                  // '{' '}'
  'f(x)',                  // '(' ')'
  'a|b',                   // '|'
  '[tag]',                 // '[' ']'
  'back\\slash',           // '\\'
  'Myanmar (Burma)',       // realistic alias with parens
  'all: . * + ? ^ $ { } ( ) | [ ] \\ at once',
]) {
  const re = new RegExp(escapeRegExp(raw));
  ok(re.test(raw), `escaped "${raw}" must match itself literally`);
  // And it must NOT be treatable as a live pattern: e.g. 'a.b' must NOT match 'axb'.
}

// 2. A dot must be literal, not a wildcard.
ok(!new RegExp(escapeRegExp('a.b')).test('axb'), "'a.b' escaped must NOT match 'axb'");
ok(new RegExp(escapeRegExp('a.b')).test('a.b'), "'a.b' escaped must match 'a.b'");

// 3. A metachar-only string must not throw and must match itself.
ok(new RegExp(escapeRegExp('(')).test('('), "lone '(' must not throw and matches");
ok(new RegExp(escapeRegExp('[')).test('['), "lone '[' must not throw and matches");

// 4. Non-string input is coerced (String(s)) — never throws.
ok(escapeRegExp(42) === '42', 'number coerced to string');
ok(escapeRegExp(null) === 'null', 'null coerced to string');
ok(escapeRegExp(undefined) === 'undefined', 'undefined coerced to string');

// 5. Plain text is untouched (byte-identical to input when no metachars).
ok(escapeRegExp('Scarlet') === 'Scarlet', 'plain word unchanged');
ok(escapeRegExp('Queen Scarlet') === 'Queen Scarlet', 'plain phrase unchanged');

console.log(`escape-regexp.test.mjs: ${n} assertions passed`);
