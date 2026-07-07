// Verifier-layer test for the ASCENT poster's DISTANCE-AXIS INVARIANT (public/ascent/src/app.js).
// Fourth sibling to hike-data-contract (shape), landmark-data-contract (axis ladders), and
// hike-scaling-contract (the HEIGHT axis's series↔stats deal). This one locks the SAME class of
// series↔stats agreement the scaling contract guards — but for the DISTANCE axis, which the scaling
// contract leaves completely undefended.
//
// WHY THIS BITES. The two views pin their ridges to the honest headline number DIFFERENTLY:
//   • HEIGHT is pinned EXPLICITLY. app.js line ~116 pushes a final point at `gCum + stats.gainM`, so
//     no matter what the series does, the height ridge ENDS exactly at the honest gainM. The scaling
//     contract guards the texture in between.
//   • DISTANCE is pinned IMPLICITLY. app.js plots every point at `{ x: idx++, y: gDist + p.d }` and
//     then advances the baseline by `gDist += stats.distanceM`. There is NO explicit endpoint push.
//     So the distance ridge only reaches the headline total — TOTAL_DIST = Σ stats.distanceM, shown in
//     #big-total and used for every distance-landmark "passed" threshold — IFF each hike's final
//     cumulative series distance (`series[last].d`) equals that hike's `stats.distanceM`.
//
// `series[].d` (cumulative metres, straight off the GPX) and `stats.distanceM` (the headline total) are
// computed by DIFFERENT code in build/gpx-to-hike.ts — the exact split that lets the HEIGHT axis's
// naive/gainM disagree. If a future regenerate ever ships them out of agreement, the distance story
// breaks in ways no shape check sees:
//   • last.d < distanceM (or >)  → the distance ridge's top stops SHORT of (or overshoots) the
//     #big-total mileage the poster proudly counts up to, AND every following hike's ridge starts at a
//     baseline offset from where the previous one visually ended — a torn, discontinuous line.
//   • a metres↔miles unit mismatch between the series and the stats (last.d in m, distanceM in mi, or
//     vice versa) → the ridge top lands ~1609x off its headline number.
//   • a non-monotonic series (`d` steps backward) → "cumulative miles travelled" visibly REVERSES
//     mid-hike, which is nonsense for the distance story (distance only ever grows).
//   • first.d far from 0 → the hike's ridge starts already offset above its baseline (a gap/jump at
//     the boundary with the prior hike).
// All invisible in code review and undefended by the data-shape and scaling tests. This states what
// "an honest distance ridge" means and proves the shipped data meets it.
//
// It replicates app.js's EXACT cumulative-distance construction against the live shipped data so the
// contract can't drift from a hand-mirrored copy, checks the invariants on BOTH the live data (must be
// clean) and crafted bad fixtures (each must be caught), and is mutation-proven: neuter any check →
// the bad fixtures go GREEN (i.e. the assertions guarding them go RED).

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// --- load the shipped data: the file is `window.FAMILY_MOUNTAIN_DATA = { ...json... };` ---
const src = readFileSync(new URL('./data/hikes.js', import.meta.url), 'utf8');
const dm = src.match(/window\.FAMILY_MOUNTAIN_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
assert.ok(dm, 'could not find window.FAMILY_MOUNTAIN_DATA assignment in data/hikes.js');
const DATA = JSON.parse(dm[1]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// How far each hike's final plotted cumulative distance (series[last].d) may sit from its stats
// headline (distanceM) before we call the ridge dishonest. Deliberately GENEROUS in absolute terms
// (a couple of metres of GPX rounding is fine) but tight in relative terms — a real m↔mi unit mismatch
// (~1609x) or a denoise divergence blows straight past it. Live data: exact (diff 0.0 on all 5 hikes).
const endpointTol = (distanceM) => Math.max(3, 0.01 * distanceM); // ≥3 m, or 1% of the leg

// Returns a list of human-readable problems ([] === honest). Each rule mirrors a real dependency of
// the distance-ridge code path in app.js. Also accumulates gDist exactly as the renderer does so the
// FINAL ridge y can be checked against the headline TOTAL_DIST.
function validateDistance(data) {
  const problems = [];
  if (!data || !Array.isArray(data.hikes)) return { problems: ['data.hikes is not an array'], ridgeEnd: NaN, total: NaN };

  let gDist = 0;        // baseline carried between hikes (app.js `gDist`)
  let ridgeEnd = 0;     // y of the very last plotted distance point across all hikes
  let total = 0;        // Σ stats.distanceM  === TOTAL_DIST / #big-total

  data.hikes.forEach((h, hi) => {
    const tag = `hike[${hi}] ${h && h.name ? `"${h.name}"` : ''}`.trim();
    if (!Array.isArray(h.series) || h.series.length === 0) { problems.push(`${tag}: series empty`); return; }
    const st = h.stats;
    if (!st || !isNum(st.distanceM)) { problems.push(`${tag}: stats.distanceM not a finite number`); return; }

    const distanceM = st.distanceM;
    // A distance leg with no length is degenerate — nothing to travel, no ridge segment.
    if (!(distanceM > 0)) { problems.push(`${tag}: distanceM is ${distanceM} (a zero-length leg has no distance ridge)`); return; }

    const first = h.series[0].d;
    const last = h.series[h.series.length - 1].d;
    if (!isNum(first) || !isNum(last)) { problems.push(`${tag}: series d is non-numeric (first=${first}, last=${last})`); return; }

    // ridge must START at (or very near) the baseline: first cumulative d ≈ 0.
    if (Math.abs(first) > endpointTol(distanceM)) {
      problems.push(`${tag}: series starts at d=${first} (should be ~0 so the ridge meets its baseline)`);
    }

    // ridge must only ever CLIMB: cumulative distance is non-decreasing (miles travelled never reverse).
    for (let i = 1; i < h.series.length; i++) {
      if (h.series[i].d < h.series[i - 1].d - 1e-6) {
        problems.push(`${tag}: series d reverses at index ${i} (${h.series[i - 1].d} → ${h.series[i].d}) — cumulative distance can't shrink`);
        break;
      }
    }

    // THE endpoint pin: the distance ridge ends at gDist + last.d, but the headline advances by
    // distanceM. They agree — and the ridge reaches TOTAL_DIST — only if last.d ≈ distanceM.
    if (Math.abs(last - distanceM) > endpointTol(distanceM)) {
      const ratio = last / distanceM;
      const unitHint = (ratio > 100 || ratio < 0.01) ? ' — series vs stats likely disagree about units (m/mi?)' : '';
      problems.push(`${tag}: series ends at d=${last} but distanceM=${distanceM} (Δ${(last - distanceM).toFixed(1)}) → distance ridge won't reach the headline total${unitHint}`);
    }

    ridgeEnd = gDist + last;   // last point plotted for this hike (final hike's value survives)
    gDist += distanceM;        // app.js: advance baseline by the honest leg
    total = gDist;
  });

  return { problems, ridgeEnd, total };
}

// ============ THE LIVE CONTRACT: shipped data must be honest ============
const live = validateDistance(DATA);
assert.deepEqual(live.problems, [], `shipped FAMILY_MOUNTAIN_DATA violates the distance-axis contract:\n  ${live.problems.join('\n  ')}`);
assert.ok(DATA.hikes.length >= 3, `expected several hikes, got ${DATA.hikes.length}`);
// the whole point: the distance ridge's top must land on the headline #big-total mileage.
assert.ok(Math.abs(live.ridgeEnd - live.total) <= endpointTol(live.total),
  `distance ridge ends at ${live.ridgeEnd} but TOTAL_DIST (#big-total) is ${live.total} — the ridge doesn't reach the number the poster counts up to`);

// ============ MUTATION PROOF: each invariant must actually bite ============
const pt = (d) => ({ d, ele: 2500, cum: 0 });
const goodHike = () => ({
  name: 'Test Trail', stats: { gainM: 180, distanceM: 3000, minEleM: 2400, maxEleM: 2600 },
  series: [pt(0), pt(800), pt(1900), pt(3000)],   // cumulative, monotone, ends exactly at distanceM
});
const wrap = (h) => ({ generated: 't', hikes: [h] });

assert.deepEqual(validateDistance(wrap(goodHike())).problems, [], 'an honest distance leg is accepted');

// endpoint short: series stops well before the headline distanceM → ridge falls short of TOTAL_DIST
{ const h = goodHike(); h.series = [pt(0), pt(800), pt(1900), pt(2400)];   // ends at 2400, distanceM 3000
  assert.ok(validateDistance(wrap(h)).problems.some(p => /won't reach the headline total/.test(p)),
    'a series ending short of distanceM is caught'); }

// unit mismatch: series in metres (ends ~3000) but distanceM in miles (~1.86) → ratio ~1609
{ const h = goodHike(); h.stats.distanceM = 1.86;
  const probs = validateDistance(wrap(h)).problems;
  assert.ok(probs.some(p => /disagree about units/.test(p)), 'a metres/miles endpoint mismatch is caught'); }

// non-monotonic: cumulative distance steps backward mid-hike
{ const h = goodHike(); h.series = [pt(0), pt(1500), pt(900), pt(3000)];
  assert.ok(validateDistance(wrap(h)).problems.some(p => /reverses at index/.test(p)),
    'a non-monotonic (reversing) cumulative distance is caught'); }

// offset start: first cumulative d far from 0 → ridge starts above its baseline
{ const h = goodHike(); h.series = [pt(500), pt(1200), pt(2100), pt(3000)];
  assert.ok(validateDistance(wrap(h)).problems.some(p => /should be ~0/.test(p)),
    'a series that starts offset from 0 is caught'); }

// zero-length leg
{ const h = goodHike(); h.stats.distanceM = 0;
  assert.ok(validateDistance(wrap(h)).problems.some(p => /zero-length leg/.test(p)), 'a zero-length leg is caught'); }

// non-finite distanceM
{ const h = goodHike(); h.stats.distanceM = NaN;
  assert.ok(validateDistance(wrap(h)).problems.some(p => /distanceM not a finite/.test(p)), 'a NaN distanceM is caught'); }

// empty series guarded (no crash)
{ const h = goodHike(); h.series = [];
  assert.ok(validateDistance(wrap(h)).problems.some(p => /series empty/.test(p)), 'an empty series is caught'); }

const legs = DATA.hikes.map((h) => h.stats.distanceM);
console.log(`ok — ASCENT distance-axis contract: ${DATA.hikes.length} hikes, legs [${legs.map(d => (d / 1000).toFixed(2) + 'km').join(', ')}], ridge ends at ${(live.ridgeEnd / 1000).toFixed(2)}km === headline ${(live.total / 1000).toFixed(2)}km`);
