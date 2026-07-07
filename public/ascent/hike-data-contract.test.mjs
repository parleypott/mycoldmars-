// Verifier-layer test for the ASCENT page's SHIPPED HIKE DATA (public/ascent/data/hikes.js).
// Sibling in spirit to Lauterbrunnen's journey-data-contract test: it guards the hand/GPX-
// generated data the renderer trusts, which no other test touches (ascent/src/app.js is an
// IIFE with no exported cores).
//
// WHY: FAMILY_MOUNTAIN_DATA is real GPX exports (5 hikes, ~5,400 points) and Johnny is actively
// building this page — 5 commits this cycle, more hikes coming. The renderer (app.js) trusts the
// data blindly: its ONLY guard is `DATA.hikes.length`, then it immediately reads `h.series[0].ele`
// and iterates `h.series.forEach(p => ... p.ele ... p.d ...)`, scaling by `h.stats.gainM`. So a
// future regenerate that ships a hike with an EMPTY series → `h.series[0].ele` throws → the WHOLE
// poster is a blank error page. A point with a NaN `ele`, a backwards `d`, or a stats block whose
// gainM is 0/negative silently corrupts the ridge line or the distance axis — invisible in review,
// impossible for the render code to defend against (it can't tell valid-shaped-but-wrong data from
// good data).
//
// This is a data-contract regression gate (same category as the Lauterbrunnen trip-data,
// quiz-bank, and bounce-level locks): a pure validateHikeData() checks the invariants the
// renderer actually depends on, run against BOTH the LIVE shipped data (must be clean) AND crafted
// bad fixtures (each must be caught). Mutation-proven: the bad-fixture assertions go RED the
// instant any invariant check is neutered.
//
// It parses FAMILY_MOUNTAIN_DATA straight out of data/hikes.js (a `window.X = {json};` assignment)
// so the contract tracks the real shipped data and can't drift from a hand-mirrored copy.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// --- load the shipped data: the file is `window.FAMILY_MOUNTAIN_DATA = { ...json... };` ---
const src = readFileSync(new URL('./data/hikes.js', import.meta.url), 'utf8');
const dm = src.match(/window\.FAMILY_MOUNTAIN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
assert.ok(dm, 'could not find window.FAMILY_MOUNTAIN_DATA assignment in data/hikes.js');
const DATA = JSON.parse(dm[1]);

// Generous, LOCATION-INDEPENDENT sanity band. "Family Mountain" can be any real trail on Earth
// (the shipped hikes span 2.2–2.9 km altitude; the landmarks note a 1.3 km one too), so we do NOT
// hard-code a tight range. This band (Dead-Sea shore to above Everest) only catches garbage — a
// NaN, an extra digit (26620), or a sign flip — not a legitimate hike somewhere new.
const ELE_MIN = -500, ELE_MAX = 9000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// The invariant checker. Returns a list of human-readable problems ([] === valid).
// Each rule mirrors a real read the renderer (public/ascent/src/app.js) performs.
function validateHikeData(data) {
  const problems = [];
  if (!data || !Array.isArray(data.hikes)) return ['data.hikes is not an array'];
  if (data.hikes.length === 0) problems.push('data.hikes is empty (page shows the no-data fallback)');

  data.hikes.forEach((h, hi) => {
    const tag = `hike[${hi}] ${h && h.name ? `"${h.name}"` : ''}`.trim();

    // name: printed as the hike label + hover name
    if (typeof h.name !== 'string' || h.name.trim() === '') problems.push(`${tag}: name missing/blank`);

    // stats: gainM scales the whole ridge (scale = gainM/naive); distanceM drives the mileage axis
    const st = h.stats;
    if (!st || typeof st !== 'object') { problems.push(`${tag}: stats missing`); }
    else {
      if (!isNum(st.gainM) || st.gainM < 0) problems.push(`${tag}: stats.gainM not a finite >=0 number (${st && st.gainM})`);
      if (!isNum(st.distanceM) || st.distanceM <= 0) problems.push(`${tag}: stats.distanceM not a finite >0 number (${st && st.distanceM})`);
    }

    // series: renderer reads series[0].ele immediately, then every point's .d and .ele
    if (!Array.isArray(h.series) || h.series.length === 0) {
      problems.push(`${tag}: series is empty (renderer reads series[0].ele → crash)`);
      return; // nothing more to check on this hike
    }
    // self-consistent elevation band from the hike's own declared stats (catches an intra-track
    // spike/dropped digit even when it's inside the global sanity band). Tolerance for rounding.
    const haveDeclared = st && isNum(st.minEleM) && isNum(st.maxEleM);
    const eLo = haveDeclared ? st.minEleM - 3 : ELE_MIN;
    const eHi = haveDeclared ? st.maxEleM + 3 : ELE_MAX;

    let prevD = -Infinity;
    for (let i = 0; i < h.series.length; i++) {
      const p = h.series[i];
      if (!p || typeof p !== 'object') { problems.push(`${tag}: point[${i}] is not an object`); break; }
      if (!isNum(p.d) || p.d < 0) { problems.push(`${tag}: point[${i}].d not a finite >=0 number (${p.d})`); break; }
      if (!isNum(p.ele) || p.ele < ELE_MIN || p.ele > ELE_MAX) { problems.push(`${tag}: point[${i}].ele out of sanity band (${p.ele})`); break; }
      if (p.ele < eLo || p.ele > eHi) { problems.push(`${tag}: point[${i}].ele ${p.ele} outside declared [${st.minEleM},${st.maxEleM}]`); break; }
      // d is cumulative distance ALONG the track → must be non-decreasing, else `p.d - prevD`
      // goes negative and the HEIGHT x-axis (gClimb) walks backwards.
      if (p.d < prevD) { problems.push(`${tag}: point[${i}].d decreased ${prevD} → ${p.d}`); break; }
      prevD = p.d;
    }
  });
  return problems;
}

// ============ THE LIVE CONTRACT: shipped data must be clean ============
const live = validateHikeData(DATA);
assert.deepEqual(live, [], `shipped FAMILY_MOUNTAIN_DATA violates the hike-data contract:\n  ${live.join('\n  ')}`);

// sanity: we actually loaded real data, not an empty structure that passes vacuously
assert.ok(DATA.hikes.length >= 3, `expected several hikes, got ${DATA.hikes.length}`);
const totalPts = DATA.hikes.reduce((a, h) => a + h.series.length, 0);
assert.ok(totalPts > 2000, `expected the full GPX geodata, got only ${totalPts} points`);

// ============ MUTATION PROOF: each invariant must actually bite ============
const okPoint = (d, ele) => ({ d, ele, cum: 0 });
const goodHike = () => ({
  name: 'Test Trail', stats: { gainM: 200, distanceM: 3000, minEleM: 2400, maxEleM: 2600 },
  series: [okPoint(0, 2400), okPoint(500, 2500), okPoint(3000, 2600)],
});
const wrap = (h) => ({ generated: 't', hikes: [h] });

assert.deepEqual(validateHikeData(wrap(goodHike())), [], 'a well-formed hike is accepted');

// empty series -> the crash case (renderer reads series[0].ele)
{ const h = goodHike(); h.series = [];
  assert.ok(validateHikeData(wrap(h)).some(p => /series is empty/.test(p)), 'an empty series is caught'); }

// NaN elevation
{ const h = goodHike(); h.series[1] = okPoint(500, NaN);
  assert.ok(validateHikeData(wrap(h)).some(p => /\.ele/.test(p)), 'a NaN elevation is caught'); }

// backwards distance (d decreases) -> corrupts the ridge x-axis
{ const h = goodHike(); h.series = [okPoint(0, 2400), okPoint(1200, 2500), okPoint(800, 2550)];
  assert.ok(validateHikeData(wrap(h)).some(p => /\.d decreased/.test(p)), 'a backwards distance is caught'); }

// gainM missing/negative -> ridge scale breaks
{ const h = goodHike(); h.stats.gainM = -5;
  assert.ok(validateHikeData(wrap(h)).some(p => /gainM/.test(p)), 'a negative gainM is caught'); }

// distanceM zero -> mileage axis collapses
{ const h = goodHike(); h.stats.distanceM = 0;
  assert.ok(validateHikeData(wrap(h)).some(p => /distanceM/.test(p)), 'a zero distanceM is caught'); }

// blank name
{ const h = goodHike(); h.name = '   ';
  assert.ok(validateHikeData(wrap(h)).some(p => /name missing/.test(p)), 'a blank name is caught'); }

// extra-digit elevation (2600 -> 26000) inside the global band but outside the declared range
{ const h = goodHike(); h.series[2] = okPoint(3000, 26000);
  assert.ok(validateHikeData(wrap(h)).some(p => /out of sanity band|outside declared/.test(p)),
    'an extra-digit elevation is caught'); }

// no hikes at all
assert.ok(validateHikeData({ hikes: [] }).some(p => /empty/.test(p)), 'an empty hikes array is caught');

console.log(`ok — ASCENT hike-data contract: ${DATA.hikes.length} hikes, ${totalPts} GPS points, all series non-empty, all d monotonic, all ele in-range`);
