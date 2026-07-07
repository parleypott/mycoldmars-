// Tests for the per-user random password generator (api/_lib/generate-password.js).
//
// This replaced the fixed 'newpress' default that was printed on the public
// login page. The properties that matter: correct length, the exact
// unambiguous alphabet (no l/o/0/1 — passwords get read aloud / retyped),
// and real randomness (no two calls collide, characters spread across the
// alphabet). Mutation targets: hardcoding the output, shrinking the length,
// or sampling from a biased/ambiguous alphabet all go RED here.

import assert from 'node:assert/strict';
import { generatePassword, GENERATED_PASSWORD_LENGTH } from './generate-password.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
};

t('default length matches the exported constant (14)', () => {
  assert.equal(GENERATED_PASSWORD_LENGTH, 14);
  assert.equal(generatePassword().length, 14);
});

t('custom length is honored', () => {
  assert.equal(generatePassword(20).length, 20);
  assert.equal(generatePassword(1).length, 1);
});

t('only unambiguous lowercase+digit chars — never l, o, 0, 1, uppercase, or symbols', () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.match(p, /^[abcdefghijkmnpqrstuvwxyz23456789]+$/, `bad chars in ${p}`);
  }
});

t('is never the old shared default', () => {
  for (let i = 0; i < 50; i++) assert.notEqual(generatePassword(), 'newpress');
});

t('no collisions across 1000 generations (would catch a hardcoded/seeded output)', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generatePassword());
  assert.equal(seen.size, 1000);
});

t('uses the whole alphabet (would catch a truncated/biased sampler)', () => {
  // 500 passwords × 14 chars = 7000 draws over 32 symbols — every symbol
  // appears with overwhelming probability (miss chance < 1e-90 per symbol).
  const seen = new Set();
  for (let i = 0; i < 500; i++) for (const c of generatePassword()) seen.add(c);
  assert.equal(seen.size, 32, `only saw ${seen.size} distinct chars`);
});

console.log(`generate-password: ${pass} passed${process.exitCode ? ' (with failures)' : ''}`);
