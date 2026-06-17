// Guards the PinGlobe correctness atlas: every country-type clue MUST resolve to
// a polygon feature in getCountryFeatures(), or that clue is unwinnable.
//
// game.js checkGuess() judges a country clue by:
//   const feature = this.countryFeatures.find(f => f.id === clue.countryId);
//   if (feature) correct = pointInFeature(lat, lon, feature);
// — a strict === on string ids, polygon containment only, NO proximity fallback.
// So a clue whose countryId has no feature can NEVER be answered correctly.
//
// The bug this locks: countries.js used the coarse 110m atlas, which omits small
// countries (Maldives 462, Palau 585, Monaco 492). Those three country clues were
// permanently unwinnable. The fix points countries.js at the 50m atlas (the one
// main.js already draws the visible borders from), which carries all three.
//
// Run: node pinglobe/src/countries.test.mjs   (also picked up by `bun run test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as topojson from 'topojson-client';
import topo110 from 'world-atlas/countries-110m.json' with { type: 'json' };
import { getCountryFeatures } from './countries.js';

const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// --- parse every country-type clue id out of the shipped clues.js ---
const cluesSrc = readFileSync(join(here, 'clues.js'), 'utf8');
const clueRe = /answer:\s*"([^"]+)",\s*\n\s*type:\s*"country",\s*\n\s*countryId:\s*"([0-9]+)"/g;
const countryClues = [];
for (let m; (m = clueRe.exec(cluesSrc)); ) countryClues.push({ answer: m[1], id: m[2] });

ok(countryClues.length > 50, `parsed a realistic number of country clues (got ${countryClues.length})`);

// --- the REAL shipped feature list (post-fix: 50m atlas) ---
const features = getCountryFeatures();
const featById = new Map(features.map(f => [f.id, f]));

// game.js compares with strict === against a string countryId, so the matching
// feature id MUST be a string. (Some atlas features carry non-string/absent ids
// for unnamed geometries; no clue references those — but every clue's id must.)
ok(features.length >= 200, `50m atlas loaded (got ${features.length} features, expected ~241)`);

// --- THE LOCK: every country clue resolves to a feature, the way game.js does it ---
const unwinnable = [];
for (const c of countryClues) {
  const feature = features.find(f => f.id === c.id); // mirror game.js exactly
  if (!feature) unwinnable.push(`${c.id} ${c.answer}`);
  else ok(typeof feature.id === 'string', `clue ${c.id} (${c.answer}) feature has string id (strict === works)`);
}
eq(unwinnable.length, 0, `no country clue is unwinnable; offenders: ${unwinnable.join(', ') || '(none)'}`);

// --- the three that the fix specifically rescues ---
for (const [id, name] of [['462', 'Maldives'], ['585', 'Palau'], ['492', 'Monaco']]) {
  ok(featById.has(id), `${name} (${id}) present in the correctness atlas (was missing under 110m)`);
}

// --- INLINE RED PROOF: the pre-fix 110m atlas genuinely left those three unwinnable ---
const f110 = topojson.feature(topo110, topo110.objects.countries).features;
const has110 = (id) => f110.some(f => f.id === id);
ok(!has110('462') && !has110('585') && !has110('492'),
   'RED proof: 110m atlas (old countries.js source) is missing 462/585/492 — those clues were unwinnable before the fix');
// and the rest of the clue ids that the old atlas DID carry still carry over,
// so the swap is additive (no clue that worked before stops working):
const regressed110to50 = countryClues.filter(c => has110(c.id) && !featById.has(c.id));
eq(regressed110to50.length, 0, `every clue the 110m atlas resolved is still resolved by 50m (no regression): ${regressed110to50.map(c=>c.id).join(', ') || '(none)'}`);

console.log(`\ncountries.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
