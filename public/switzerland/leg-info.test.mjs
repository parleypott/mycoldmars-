// Verifier-layer test for the SWITZERLAND map's leg core — legInfo (popup text), legFeatures
// (render path) and journeyCoords (bounds path). These three functions plus the _hav haversine
// helper are BYTE-COPIES of the Lauterbrunnen page's tested originals
// (public/lauterbrunnen/{leg-info,leg-features,journey-bounds}.test.mjs) — but the switzerland
// page is brand-new and being actively edited (multiple commits the day this landed), and its
// copies carried ZERO test of their own. A divergent edit here — tweak the speed table, swap the
// mode branch, drop the empty-safe filter — would be silent and live on the published page.
//
// This test does three things:
//   1. LOCKS the legInfo contract over an independent reference (mutation-proven: break the
//      km↔mi constant, the mode branch, or the speed table and the assertions go RED).
//   2. PROBES the REAL shipped JOURNEYS data — every leg's popup text must be sane (right branch
//      per mode, finite, ≥1 min for transit, label preserved). Catches a future data edit that
//      slips in an empty/short polyline or an unknown mode.
//   3. TWIN-LOCKS byte-parity of _hav/legInfo/legFeatures/journeyCoords against the tested
//      Lauterbrunnen copies, so any future divergence forces a human to either re-sync the pages
//      or write a switzerland-specific contract — it can't drift in silence.
//
// EXTRACTS the real shipped functions + data from index.html at runtime (regex + new Function /
// JSON.parse) so the test can't drift from a hand-mirrored copy.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const lauterHtml = readFileSync(
  new URL('../lauterbrunnen/index.html', import.meta.url), 'utf8');

// --- extract the live functions ---
const grab = (src, re, name) => {
  const m = src.match(re);
  assert.ok(m, `could not find ${name}() in index.html`);
  return m[0];
};
const havSrc = grab(html, /function _hav\(a,b\)\{[\s\S]*?\n?\}/, '_hav');
const liSrc = grab(html, /function legInfo\(lg\)\{[\s\S]*?\n\}/, 'legInfo');
const lfSrc = grab(html, /function legFeatures\(j\)\{[\s\S]*?\n\}/, 'legFeatures');
const jcSrc = grab(html, /function journeyCoords\(journeys, id\)\{[\s\S]*?\n\}/, 'journeyCoords');

const legInfo = new Function(`${havSrc}\n${liSrc}\nreturn legInfo;`)();
const legFeatures = new Function(`${havSrc}\n${liSrc}\n${lfSrc}\nreturn legFeatures;`)();
const journeyCoords = new Function(`${jcSrc}\nreturn journeyCoords;`)();

// --- extract the REAL shipped JOURNEYS data (single-line `let JOURNEYS = [...]`) ---
const jm = html.match(/let JOURNEYS = (\[.*\]);/);
assert.ok(jm, 'could not find JOURNEYS data in index.html');
const JOURNEYS = JSON.parse(jm[1]);
assert.ok(Array.isArray(JOURNEYS) && JOURNEYS.length >= 5, 'JOURNEYS should be a non-trivial array');

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
const SPEEDS = { train: 16, gondola: 21, cablecar: 21, funicular: 10 };

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// A ~1.1 km two-segment line in the valley (multi-segment so the haversine SUM is exercised).
const LINE = [[7.9089, 46.5936], [7.9085, 46.5870], [7.9075, 46.5790]];

// 1. DISTANCE branch — hike/walk/bike show miles to 1 decimal, no time, label preserved.
for (const mode of ['hike', 'walk', 'bike']) {
  const out = legInfo({ mode, label: 'L', line: LINE });
  ok(out === `L · ${refMi(LINE).toFixed(1)} mi`, `${mode} should render distance in mi`);
  ok(/· \d+\.\d mi$/.test(out), `${mode} output shape`);
  ok(!/min/.test(out), `${mode} must NOT render time`);
}

// 2. TIME branch — transit modes show "~N min", never miles, using the per-mode speed.
for (const [mode, spd] of Object.entries(SPEEDS)) {
  const out = legInfo({ mode, label: 'T', line: LINE });
  ok(out === `T · ~${refMin(LINE, spd)} min`, `${mode} should render time at ${spd} km/h`);
  ok(!/mi$/.test(out), `${mode} must NOT render miles`);
}

// 3. Unknown mode falls back to 18 km/h (not distance, not a crash).
ok(legInfo({ mode: 'helicopter', label: 'H', line: LINE }) === `H · ~${refMin(LINE, 18)} min`,
  'unknown mode falls back to 18 km/h time');

// 4. Transit time floored at 1 minute — a one-metre ride never shows "~0 min".
ok(legInfo({ mode: 'train', label: 'X', line: [[7.9, 46.5], [7.90001, 46.50001]] }) === 'X · ~1 min',
  'tiny transit leg floors at ~1 min');

// 5. Label preserved verbatim, including unicode arrows used throughout the real data.
ok(legInfo({ mode: 'gondola', label: 'Wengen → Männlichen', line: LINE })
  .startsWith('Wengen → Männlichen · '), 'label preserved verbatim');

// --- PROBE every real leg in the shipped data: the published popups must all be sane ---
let legCount = 0;
for (const j of JOURNEYS) {
  for (const lg of (j.legs || [])) {
    legCount++;
    const out = legInfo(lg);
    ok(typeof out === 'string' && out.length > 0, `real leg "${lg.label}" yields non-empty text`);
    ok(out.startsWith(lg.label + ' · '), `real leg "${lg.label}" preserves its label`);
    ok(!/(NaN|undefined|Infinity)/.test(out), `real leg "${lg.label}" has no NaN/undefined/Infinity`);
    const isDistance = lg.mode === 'hike' || lg.mode === 'walk' || lg.mode === 'bike';
    if (isDistance) {
      ok(/· \d+\.\d mi$/.test(out), `real ${lg.mode} leg renders miles`);
    } else {
      const mins = out.match(/· ~(\d+) min$/);
      ok(mins && Number(mins[1]) >= 1, `real ${lg.mode} leg renders ≥1 min`);
    }
  }
}
ok(legCount >= 15, `probed a real corpus of legs (got ${legCount})`);

// 6. legFeatures: empty-safe + one feature per ≥2-point leg, info text wired through legInfo.
ok(legFeatures({}).features.length === 0, 'legFeatures: missing .legs → empty (no crash)');
ok(legFeatures({ legs: [{ mode: 'hike', label: 'A', line: [[0, 0]] }] }).features.length === 0,
  'legFeatures: a <2-point leg contributes no feature');
{
  const fc = legFeatures(JOURNEYS[0]);
  ok(fc.type === 'FeatureCollection', 'legFeatures returns a FeatureCollection');
  ok(fc.features.length === (JOURNEYS[0].legs || []).filter(
    l => Array.isArray(l.line) && l.line.length >= 2).length,
    'legFeatures emits one feature per valid leg');
  ok(fc.features.every(f => f.geometry.type === 'LineString' && f.properties.info.includes(' · ')),
    'every feature carries a LineString + legInfo text');
}

// 7. journeyCoords: empty-safe + flattens to [lng,lat] pairs; entryId scopes to one journey.
ok(journeyCoords([], null).length === 0, 'journeyCoords: empty input → empty');
ok(journeyCoords([{ entryId: 9 }], null).length === 0, 'journeyCoords: legless journey → empty');
{
  const all = journeyCoords(JOURNEYS, null);
  ok(all.length > 100 && all.every(p => Array.isArray(p) && p.length === 2),
    'journeyCoords flattens real data to [lng,lat] pairs');
  const scoped = journeyCoords(JOURNEYS, JOURNEYS[0].entryId);
  ok(scoped.length > 0 && scoped.length < all.length,
    'journeyCoords(id) scopes to one journey');
}

// --- 8. TWIN-LOCK: byte-parity with the TESTED Lauterbrunnen copies. If these diverge, this test
// goes RED on purpose — re-sync the pages or give switzerland its own contract; no silent drift. ---
for (const [re, name] of [
  [/function _hav\(a,b\)\{[\s\S]*?\n?\}/, '_hav'],
  [/function legInfo\(lg\)\{[\s\S]*?\n\}/, 'legInfo'],
  [/function legFeatures\(j\)\{[\s\S]*?\n\}/, 'legFeatures'],
  [/function journeyCoords\(journeys, id\)\{[\s\S]*?\n\}/, 'journeyCoords'],
]) {
  const a = grab(html, re, name);
  const b = grab(lauterHtml, re, name);
  ok(a === b, `${name} is byte-identical to the tested Lauterbrunnen copy (twin-lock)`);
}

console.log(`switzerland leg-info: ${pass} passed, 0 failed (probed ${legCount} real legs)`);
