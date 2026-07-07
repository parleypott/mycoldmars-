// Verifier-layer test for the ASCENT poster's RIDGE-SCALING INVARIANT (public/ascent/src/app.js).
// Sibling to hike-data-contract.test.mjs (data shape) and landmark-data-contract.test.mjs (axis
// ladders) — this one locks the one relationship neither of those touches: the deal between each
// hike's GPS SERIES and its STATS block that makes the whole ridge honest.
//
// WHY THIS BITES. The HEIGHT view doesn't plot raw GPS climb — it SCALES it. For each hike app.js
// (lines ~106-116) computes:
//     let naive = 0, pe = series[0].ele;
//     series.forEach((p,i) => { if (i>0 && p.ele > pe) naive += p.ele - pe; pe = p.ele; });  // raw ascent
//     const scale = naive > 0 ? stats.gainM / naive : 1;                                     // normalise
//     ...each rising step plots (p.ele - prevEle) * scale...
//     Hpts.push({ x: gClimb, y: gCum + stats.gainM });                                       // PIN the end
// so the plotted ridge rises with the real GPS texture but ENDS exactly at the honest total gainM.
// The catch: `naive` (from the series) and `gainM` (from the stats block) are computed by DIFFERENT
// code in build/gpx-to-hike.ts. If a future regenerate ever ships them out of agreement, the render
// silently breaks in ways no shape check sees:
//   • naive === 0 but gainM > 0  → scale falls back to 1, every step adds 0, the ridge is DEAD FLAT
//     across the hike's whole x-band, then line 116 PINS a vertical cliff straight up to gainM. A
//     flatline-then-cliff ridge — structurally valid data, visually broken poster.
//   • a metres/feet unit mismatch between the two derivations (series in ft, gainM in m, or vice
//     versa) → scale ≈ 3.28 or ≈ 0.30 instead of ~1. The ridge's texture is stretched/squashed 3.3x
//     relative to its honest endpoint — a warped, wrong-shaped mountain.
// Both are invisible in code review and undefended by the data-shape test (which happily passes a
// descending-only series with a positive gainM, or ele/gainM in different units). This is the
// front-loaded verifier: it states what "an honest ridge" means and proves the shipped data meets it.
//
// It replicates app.js's EXACT `naive` loop against the live shipped data so the contract can't drift
// from a hand-mirrored copy, checks the invariants on BOTH the live data (must be clean) and crafted
// bad fixtures (each must be caught), and is mutation-proven: neuter any check → the bad fixtures go
// GREEN (i.e. the assertions guarding them go RED).

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// --- load the shipped data: the file is `window.FAMILY_MOUNTAIN_DATA = { ...json... };` ---
const src = readFileSync(new URL('./data/hikes.js', import.meta.url), 'utf8');
const dm = src.match(/window\.FAMILY_MOUNTAIN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
assert.ok(dm, 'could not find window.FAMILY_MOUNTAIN_DATA assignment in data/hikes.js');
const DATA = JSON.parse(dm[1]);

// Exact replica of the renderer's raw-ascent sum (app.js ~106-107). Kept byte-for-byte faithful so
// the invariant tracks what actually gets plotted, not an idealised recomputation.
function naiveAscent(series) {
  let naive = 0, pe = series[0].ele;
  series.forEach((p, i) => { if (i > 0 && p.ele > pe) naive += p.ele - pe; pe = p.ele; });
  return naive;
}

// Units-divergence band for scale = gainM/naive. gainM is a DENOISED total ascent, so it is always
// somewhat BELOW the raw GPS-jittery sum → scale sits comfortably under 1.0 (the 5 shipped hikes:
// 0.75-0.94). This band is deliberately GENEROUS — it exists only to catch a gross metres↔feet
// mismatch between the series and the stats (which lands scale at ~3.28 or ~0.30), never a merely
// noisy-but-legitimate track. If a real ultra-noisy future hike ever trips the low end, relax it —
// but a scale outside [0.4, 2.0] almost certainly means the two derivations disagree about units.
const SCALE_LO = 0.4, SCALE_HI = 2.0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Returns a list of human-readable problems ([] === honest). Each rule mirrors a real dependency of
// the ridge-scaling code path in app.js.
function validateScaling(data) {
  const problems = [];
  if (!data || !Array.isArray(data.hikes)) return ['data.hikes is not an array'];

  data.hikes.forEach((h, hi) => {
    const tag = `hike[${hi}] ${h && h.name ? `"${h.name}"` : ''}`.trim();
    if (!Array.isArray(h.series) || h.series.length === 0) { problems.push(`${tag}: series empty`); return; }
    const st = h.stats;
    if (!st || !isNum(st.gainM)) { problems.push(`${tag}: stats.gainM not a finite number`); return; }

    const gainM = st.gainM;
    const naive = naiveAscent(h.series);

    // A "mountain" hike with no net ascent is degenerate for this poster (flat step, no ridge). The
    // sibling shape-test tolerates gainM===0; the SCALING contract does not — a real hike climbs.
    if (!(gainM > 0)) { problems.push(`${tag}: gainM is ${gainM} (a hike with no ascent renders as a flat step)`); return; }

    // THE flatline-then-cliff bug: a positive honest gain but zero raw ascent in the series means the
    // series descends/flat-lines the whole way, scale falls back to 1, and line 116 pins a vertical
    // cliff at the end. gainM>0 must be BACKED by real rises in the series it's plotted from.
    if (!(naive > 0)) { problems.push(`${tag}: gainM=${gainM} but naive raw ascent is ${naive} → ridge flatlines then cliffs`); return; }

    const scale = gainM / naive;
    if (!isNum(scale) || scale <= 0) { problems.push(`${tag}: scale (gainM/naive) is ${scale}`); return; }
    if (scale < SCALE_LO || scale > SCALE_HI) {
      problems.push(`${tag}: scale ${scale.toFixed(3)} outside [${SCALE_LO}, ${SCALE_HI}] — series vs stats likely disagree about units (m/ft?)`);
    }
  });
  return problems;
}

// ============ THE LIVE CONTRACT: shipped data must be honest ============
const live = validateScaling(DATA);
assert.deepEqual(live, [], `shipped FAMILY_MOUNTAIN_DATA violates the ridge-scaling contract:\n  ${live.join('\n  ')}`);
assert.ok(DATA.hikes.length >= 3, `expected several hikes, got ${DATA.hikes.length}`);

// report the live scales so a regression shows its work in the log
const scales = DATA.hikes.map((h) => (h.stats.gainM / naiveAscent(h.series)));

// ============ MUTATION PROOF: each invariant must actually bite ============
// good fixture: a clean rising track whose raw ascent (200) matches its honest gain (180) → scale 0.9
const okPoint = (d, ele) => ({ d, ele, cum: 0 });
const goodHike = () => ({
  name: 'Test Trail', stats: { gainM: 180, distanceM: 3000, minEleM: 2400, maxEleM: 2600 },
  series: [okPoint(0, 2400), okPoint(500, 2500), okPoint(1500, 2450), okPoint(3000, 2600)],
});
const wrap = (h) => ({ generated: 't', hikes: [h] });
// good fixture's raw ascent: +100 (2400->2500) then +150 (2450->2600) = 250; gainM 180 → scale 0.72 ✓
assert.deepEqual(validateScaling(wrap(goodHike())), [], 'an honest hike (scale in band) is accepted');

// flatline-then-cliff: positive gainM but a descending-only series (naive === 0)
{ const h = goodHike(); h.series = [okPoint(0, 2600), okPoint(1000, 2500), okPoint(3000, 2400)];
  assert.ok(validateScaling(wrap(h)).some(p => /flatlines then cliffs/.test(p)),
    'a positive gainM with zero raw ascent (flatline-then-cliff) is caught'); }

// zero-gain hike: renders as a flat step, no ridge
{ const h = goodHike(); h.stats.gainM = 0;
  assert.ok(validateScaling(wrap(h)).some(p => /no ascent/.test(p)), 'a zero-gain hike is caught'); }

// units mismatch HIGH: gainM in ft while series is metres → scale ~3.28 (here 250 raw, gainM 820 → 3.28)
{ const h = goodHike(); h.stats.gainM = 820;
  assert.ok(validateScaling(wrap(h)).some(p => /disagree about units/.test(p)),
    'a metres/feet mismatch inflating scale is caught'); }

// units mismatch LOW: series in ft (naive ~3.28x too big) → scale ~0.30. Simulate with a raw ascent
// of 820 (ft-scale rises) against a metres gainM of 180 → scale 0.22.
{ const h = goodHike(); h.series = [okPoint(0, 2400), okPoint(500, 2810), okPoint(1500, 2700), okPoint(3000, 3110)];
  // rises: +410 then +410 = 820; gainM 180 → scale 0.22 (< 0.4)
  assert.ok(validateScaling(wrap(h)).some(p => /disagree about units/.test(p)),
    'a metres/feet mismatch deflating scale is caught'); }

// non-finite gainM
{ const h = goodHike(); h.stats.gainM = NaN;
  assert.ok(validateScaling(wrap(h)).some(p => /gainM not a finite/.test(p)), 'a NaN gainM is caught'); }

// empty series guarded (no crash)
{ const h = goodHike(); h.series = [];
  assert.ok(validateScaling(wrap(h)).some(p => /series empty/.test(p)), 'an empty series is caught'); }

console.log(`ok — ASCENT ridge-scaling contract: ${DATA.hikes.length} hikes, scales [${scales.map(s => s.toFixed(2)).join(', ')}] all in [${SCALE_LO}, ${SCALE_HI}], every honest gain backed by real ascent`);
