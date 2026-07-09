/*
 * mapdata-chip.test.mjs — locks the /map-data direction-chip kind + the Cartography craft.
 *
 * The feature spans four hand-maintained files with nothing binding them: the mark-attrs
 * factory (direction-chip.js), the slash command (slash-menu.js), the craft row (roles.js),
 * and the CSS chip-color + lens + boost (styles.css). roles-lens-contract.test.mjs already
 * binds ROLE_DEFS <-> CSS for EVERY craft (so cartography's lens/boost/tint are covered there
 * once styles.css lands). This file locks the mapdata-specific plumbing the contract test
 * can't see: the slash item exists and applies the right kind, and the chip color rule ships.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SLASH_ITEMS } from './extensions/slash-menu.js';
import { defaultDirectionMarkAttrs, DIRECTION_CHIP_KINDS } from './extensions/direction-chip.js';
import { ROLE_DEFS } from './roles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'styles.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

ok('defaultDirectionMarkAttrs("mapdata") is a single-state colored run', () => {
  assert.deepEqual(defaultDirectionMarkAttrs('mapdata'), { kind: 'mapdata', status: 'static' });
});

ok('mapdata is a declared direction-chip kind', () => {
  assert.ok(DIRECTION_CHIP_KINDS.includes('mapdata'));
});

ok('the /map-data slash item exists and applies the mapdata kind', () => {
  const item = SLASH_ITEMS.find((i) => i.title === 'map-data');
  assert.ok(item, 'map-data slash item present');
  assert.equal(item.group, 'mark', 'map-data is an inline mark, not structure');
  for (const q of ['map', 'map-data', 'carto', 'cartography']) {
    assert.ok(item.match(q), `alias "${q}" resolves to map-data`);
  }
  assert.equal(item.match('data'), false, '"data" must not match map-data (prefix-only law)');
});

ok('the Cartography craft points at the mapdata chip', () => {
  const c = ROLE_DEFS.find((r) => r.id === 'cartography');
  assert.ok(c, 'cartography ROLE_DEF present');
  assert.equal(c.label, 'Cartography');
  assert.equal(c.tint, '#9c5a3c');
  assert.equal(c.sel, '.wp-dhl[data-kind="mapdata"]');
});

ok('styles.css ships a mapdata chip-color rule (brownish red, distinct from the other reds)', () => {
  assert.ok(css.includes('.wp-dhl[data-kind="mapdata"]'), 'mapdata chip color rule present');
  assert.ok(css.includes('#9c5a3c'), 'the burnt-sienna tint is used');
});

console.log(`\nmapdata-chip: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
