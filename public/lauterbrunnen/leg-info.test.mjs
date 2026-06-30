// Verifier-layer test for the Lauterbrunnen map's LEG-POPUP TEXT (sibling to leg-features.test.mjs,
// which locks the RENDER path, and journey-bounds.test.mjs, which locks the BOUNDS path).
//
// CONTRACT: legInfo(lg) is the user-facing string shown in every leg popup on map click —
// "<label> · X.X mi" for self-powered legs (hike/walk/bike) and "<label> · ~N min" for
// every transit mode (train/gondola/cablecar/funicular/…). It must:
//   1. sum the leg's polyline with the haversine helper and convert metres → miles (km/1.609),
//   2. branch on mode: hike|walk|bike render DISTANCE (mi); everything else renders TIME (min),
//   3. use the per-mode km/h speed table (train 16, gondola/cablecar 21, funicular 10) with an
//      18 km/h fallback for any unknown mode,
//   4. floor transit time at 1 minute (Math.max(1, …)) so a tiny ride never shows "~0 min",
//   5. preserve the leg label verbatim.
// A regression here is silent and live: tweak the speed table or the mode list and a gondola
// starts claiming "mi", or a hike shows a bogus "min", or every distance is off by the km↔mi
// constant — all wrong text in front of Johnny on the published page, no crash to flag it.
//
// EXTRACTS the real shipped _hav + legInfo from index.html at runtime (regex + new Function) so it
// can't drift from a hand-mirrored copy. Mutation-proven: break the km↔mi constant, swap the
// mode branch, or neuter the speed table and the matching assertions below go RED.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

const havSrc = html.match(/function _hav\(a,b\)\{[\s\S]*?\n\}/);
const liSrc = html.match(/function legInfo\(lg\)\{[\s\S]*?\n\}/);
assert.ok(havSrc, 'could not find _hav() in index.html');
assert.ok(liSrc, 'could not find legInfo() in index.html');
const legInfo = new Function(`${havSrc[0]}\n${liSrc[0]}\nreturn legInfo;`)();

// --- independent reference haversine (so a mutation to the shipped _hav diverges → RED) ---
function refMeters(line) {
  const R = 6371000, r = Math.PI / 180;
  let m = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const la1 = a[1] * r, la2 = b[1] * r, dla = (b[1] - a[1]) * r, dlo = (b[0] - a[0]) * r;
    const x = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
    m += 2 * R * Math.asin(Math.sqrt(x));
  }
  return m;
}
const refMi = (line) => (refMeters(line) / 1000) / 1.609;
const refMin = (line, spd) => Math.max(1, Math.round((refMeters(line) / 1000) / spd * 60));

// A ~1.1 km two-segment line in the Lauterbrunnen valley (real-ish coords, multi-segment so the
// haversine SUM is exercised, not just one hop).
const LINE = [[7.9089, 46.5936], [7.9085, 46.5870], [7.9075, 46.5790]];

// 1. DISTANCE branch — hike/walk/bike show miles to 1 decimal, no time, label preserved.
for (const mode of ['hike', 'walk', 'bike']) {
  const out = legInfo({ mode, label: 'L', line: LINE });
  assert.equal(out, `L · ${refMi(LINE).toFixed(1)} mi`, `${mode} should render distance in mi`);
  assert.match(out, /· \d+\.\d mi$/, `${mode} output shape`);
  assert.ok(!/min/.test(out), `${mode} must NOT render time`);
}

// 2. TIME branch — transit modes show "~N min", never miles, using the per-mode speed.
const SPEEDS = { train: 16, gondola: 21, cablecar: 21, funicular: 10 };
for (const [mode, spd] of Object.entries(SPEEDS)) {
  const out = legInfo({ mode, label: 'T', line: LINE });
  assert.equal(out, `T · ~${refMin(LINE, spd)} min`, `${mode} should render time at ${spd} km/h`);
  assert.match(out, /~\d+ min$/, `${mode} output shape`);
  assert.ok(!/mi$/.test(out), `${mode} must NOT render miles`);
}

// 3. Speed table actually differentiates: the slowest mode (funicular 10) takes MORE minutes than
//    the fastest (gondola 21) over the identical line. Collapse the table to one speed → RED.
const funMin = refMin(LINE, 10), gonMin = refMin(LINE, 21);
assert.ok(funMin > gonMin, 'funicular (10 km/h) must take longer than gondola (21 km/h)');
assert.equal(legInfo({ mode: 'funicular', label: 'F', line: LINE }), `F · ~${funMin} min`);
assert.equal(legInfo({ mode: 'gondola', label: 'G', line: LINE }), `G · ~${gonMin} min`);

// 4. Unknown mode falls back to 18 km/h (NOT the distance branch).
assert.equal(legInfo({ mode: 'rocket', label: 'R', line: LINE }), `R · ~${refMin(LINE, 18)} min`,
  'unknown mode → 18 km/h time fallback');

// 5. Tiny transit leg floors at 1 minute (never "~0 min").
const TINY = [[7.9000, 46.6000], [7.90001, 46.60001]];
assert.ok(refMeters(TINY) < 5, 'TINY line is sub-5m (would round to 0 min without the floor)');
assert.equal(legInfo({ mode: 'train', label: 'X', line: TINY }), 'X · ~1 min', 'min floor of 1');

console.log('leg-info.test.mjs: all assertions passed');
