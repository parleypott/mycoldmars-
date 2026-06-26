// First coverage for resolveEezHover (eez/src/hover.js) — the pure core that
// decides, on every EEZ-globe hover, what name the tooltip shows AND which property
// the map highlight `case` compares against so the polygon under the cursor lights up.
//
// Two contracts locked:
//   1. Country wins over ISO_A3; a blank/whitespace-only/missing pair => null
//      (no leaked empty tooltip, no degenerate highlight).
//   2. The label-vs-highlight match contract: `name` is trimmed for display, but
//      `value` is the RAW property string. The live map runs
//      `['==', ['get', field], value]` and Mapbox `['get', field]` returns the
//      UNMODIFIED feature property — so a trimmed `value` would fail to match any
//      whitespace-padded feature (" Palau "), showing a tooltip with no polygon lit.
//      The buggy form returned the trimmed value for matching; this mutation-proves
//      `value === raw` so the highlight always targets the hovered polygon.

import assert from 'node:assert/strict';
import { resolveEezHover } from './src/hover.js';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); pass++; };

// ── null / non-nameable ───────────────────────────────────────────────
eq(resolveEezHover(null), null, 'null props => null');
eq(resolveEezHover(undefined), null, 'undefined props => null');
eq(resolveEezHover('Palau'), null, 'string props => null');
eq(resolveEezHover(42), null, 'number props => null');
eq(resolveEezHover({}), null, 'empty props => null');
eq(resolveEezHover({ Country: '' }), null, 'empty Country => null');
eq(resolveEezHover({ Country: '   ' }), null, 'whitespace-only Country => null');
eq(resolveEezHover({ Country: 5, ISO_A3: 7 }), null, 'non-string fields => null');
eq(resolveEezHover({ ISO_A3: '   ' }), null, 'whitespace-only ISO_A3 => null');

// ── Country wins, clean values ────────────────────────────────────────
eq(
  resolveEezHover({ Country: 'Palau', ISO_A3: 'PLW' }),
  { name: 'Palau', field: 'Country', value: 'Palau' },
  'Country present => Country wins over ISO_A3',
);
eq(
  resolveEezHover({ ISO_A3: 'PLW' }),
  { name: 'PLW', field: 'ISO_A3', value: 'PLW' },
  'ISO_A3 fallback when no Country',
);
eq(
  resolveEezHover({ Country: '', ISO_A3: 'FRA' }),
  { name: 'FRA', field: 'ISO_A3', value: 'FRA' },
  'blank Country falls through to ISO_A3',
);

// ── label-vs-highlight match contract (the load-bearing one) ──────────
// A whitespace-padded property: display trims, but the match value must stay RAW
// so `['==', ['get','Country'], value]` matches the actual feature property.
const padded = resolveEezHover({ Country: ' Palau ' });
eq(padded.name, 'Palau', 'padded Country: name is TRIMMED for display');
eq(padded.value, ' Palau ', 'padded Country: value is RAW so the GL == match hits');
eq(padded.field, 'Country', 'padded Country: field is Country');
// Mutation guard: the old buggy form set value = trimmed. Prove value !== trimmed
// whenever there is padding — that inequality is exactly what the fix restores.
assert.notEqual(padded.value, padded.name, 'value must NOT collapse to the trimmed name (the bug)');
pass++;

const paddedIso = resolveEezHover({ ISO_A3: '  PLW  ' });
eq(paddedIso.name, 'PLW', 'padded ISO_A3: name trimmed');
eq(paddedIso.value, '  PLW  ', 'padded ISO_A3: value raw');
assert.notEqual(paddedIso.value, paddedIso.name, 'ISO value must NOT collapse to trimmed name');
pass++;

console.log(`eez/hover.test.mjs: ${pass} assertions passed`);
