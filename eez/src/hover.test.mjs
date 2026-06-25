// Mutation-locked tests for the EEZ globe hover resolution.
// Run: bun eez/src/hover.test.mjs  (picked up by scripts/run-tests.mjs)
import assert from 'node:assert/strict';
import { resolveEezHover } from './hover.js';

let pass = 0;
function t(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

t('Country present -> label + highlight both key off Country', () => {
  const hit = resolveEezHover({ Country: 'Palau', ISO_A3: 'PLW' });
  assert.deepEqual(hit, { name: 'Palau', field: 'Country', value: 'Palau' });
});

t('Country missing, ISO_A3 present -> highlight keys off ISO_A3, NOT Country', () => {
  const hit = resolveEezHover({ ISO_A3: 'USA' });
  assert.equal(hit.name, 'USA');
  // The load-bearing fix: the highlight must compare against the field the
  // label came from. The old code always used 'Country', so this feature
  // showed a tooltip but never lit up.
  assert.equal(hit.field, 'ISO_A3');
  assert.notEqual(hit.field, 'Country');
  assert.equal(hit.value, 'USA');
});

t('Country empty string falls through to ISO_A3', () => {
  const hit = resolveEezHover({ Country: '', ISO_A3: 'FJI' });
  assert.deepEqual(hit, { name: 'FJI', field: 'ISO_A3', value: 'FJI' });
});

t('Country whitespace-only is treated as empty', () => {
  const hit = resolveEezHover({ Country: '   ', ISO_A3: 'NRU' });
  assert.equal(hit.name, 'NRU');
  assert.equal(hit.field, 'ISO_A3');
});

t('both missing -> null (no blank tooltip, no degenerate highlight)', () => {
  assert.equal(resolveEezHover({}), null);
  assert.equal(resolveEezHover({ Country: '', ISO_A3: '' }), null);
  assert.equal(resolveEezHover({ Country: '  ', ISO_A3: '  ' }), null);
});

t('non-object props degrade to null instead of crashing', () => {
  assert.equal(resolveEezHover(null), null);
  assert.equal(resolveEezHover(undefined), null);
  assert.equal(resolveEezHover('Palau'), null);
});

t('non-string Country/ISO values are ignored, not coerced', () => {
  // A numeric or object value must not become a bogus label.
  assert.equal(resolveEezHover({ Country: 42 }), null);
  assert.deepEqual(resolveEezHover({ Country: 42, ISO_A3: 'JPN' }),
    { name: 'JPN', field: 'ISO_A3', value: 'JPN' });
});

console.log(`\n${pass} passed, 0 failed`);
