// Guards the PinGlobe game-content data contract: every shipped clue MUST be
// well-formed AND winnable.
//
// game.js checkGuess() judges a clue two ways, by type:
//   if (clue.type === 'country') {
//     const feature = this.countryFeatures.find(f => f.id === clue.countryId);
//     if (feature) correct = pointInFeature(lat, lon, feature);   // polygon containment
//   } else {
//     correct = distanceKm <= clue.acceptRadius;                  // proximity
//   }
//
// So winnability has two separate failure modes:
//   - a COUNTRY clue whose countryId resolves to no atlas feature is unwinnable
//     (locked separately by countries.test.mjs against the real 50m atlas).
//   - a POINT clue whose acceptRadius is null / 0 / missing / negative is unwinnable:
//     `distanceKm <= null` is `distanceKm <= 0`, so only an exact-center click (or
//     never) scores. A future clue added with `acceptRadius: null` (the shape
//     country clues use) would silently ship an impossible point clue with no signal.
//
// This test locks that point-clue dimension + the full per-clue schema + the
// getClueSet() selection invariants. Country atlas resolution stays in
// countries.test.mjs (this file does not re-import the atlas).
//
// Run: node pinglobe/src/clues.test.mjs   (also picked up by `bun run test`)

import { EASY_CLUES, HARD_CLUES, getClueSet } from './clues.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// --- the pure validator under test: returns a list of issues for one clue ---
// Mirrors exactly what game.js requires to be able to score a clue correct.
function clueIssues(c) {
  const issues = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  // shared shape
  if (typeof c.clue !== 'string' || c.clue.trim() === '') issues.push('empty clue text');
  if (typeof c.answer !== 'string' || c.answer.trim() === '') issues.push('empty answer');
  if (typeof c.blurb !== 'string' || c.blurb.trim() === '') issues.push('empty blurb');
  if (!c.center || typeof c.center.lat !== 'number' || typeof c.center.lon !== 'number'
      || !Number.isFinite(c.center.lat) || !Number.isFinite(c.center.lon)) {
    issues.push('bad center');
  } else if (Math.abs(c.center.lat) > 90 || Math.abs(c.center.lon) > 180) {
    issues.push('center out of range');
  }
  // per-type winnability
  if (c.type === 'country') {
    if (typeof c.countryId !== 'string' || c.countryId.trim() === '') issues.push('country: missing countryId');
    if (c.acceptRadius !== null) issues.push('country: acceptRadius should be null (convention)');
  } else if (c.type === 'point') {
    if (typeof c.acceptRadius !== 'number' || !Number.isFinite(c.acceptRadius) || c.acceptRadius <= 0) {
      issues.push('point: unwinnable acceptRadius=' + JSON.stringify(c.acceptRadius));
    }
  } else {
    issues.push('unknown type=' + JSON.stringify(c.type));
  }
  return issues;
}

// ── 1. INLINE RED PROOFS: the validator catches every known-bad shape ──
// (proves clueIssues is a real check before we trust its silence on real data)
const goodPoint   = { clue: 'x', answer: 'a', blurb: 'b', type: 'point',   center: { lat: 0, lon: 0 }, acceptRadius: 100 };
const goodCountry = { clue: 'x', answer: 'a', blurb: 'b', type: 'country', center: { lat: 0, lon: 0 }, acceptRadius: null, countryId: '158' };

eq(clueIssues(goodPoint).length, 0, 'a well-formed point clue has no issues');
eq(clueIssues(goodCountry).length, 0, 'a well-formed country clue has no issues');

// the headline bug: a point clue carrying the country-shaped null radius is unwinnable
ok(clueIssues({ ...goodPoint, acceptRadius: null }).some(i => i.includes('unwinnable')),
   'RED proof: point clue with acceptRadius:null flagged unwinnable');
ok(clueIssues({ ...goodPoint, acceptRadius: 0 }).some(i => i.includes('unwinnable')),
   'RED proof: point clue with acceptRadius:0 flagged unwinnable');
ok(clueIssues({ ...goodPoint, acceptRadius: -50 }).some(i => i.includes('unwinnable')),
   'RED proof: point clue with negative acceptRadius flagged unwinnable');
const noRadius = { ...goodPoint }; delete noRadius.acceptRadius;
ok(clueIssues(noRadius).some(i => i.includes('unwinnable')),
   'RED proof: point clue with missing acceptRadius flagged unwinnable');
ok(clueIssues({ ...goodCountry, countryId: undefined }).some(i => i.includes('missing countryId')),
   'RED proof: country clue with no countryId flagged');
ok(clueIssues({ ...goodPoint, type: 'region' }).some(i => i.includes('unknown type')),
   'RED proof: unknown clue type flagged');
ok(clueIssues({ ...goodPoint, center: { lat: 200, lon: 0 } }).some(i => i.includes('out of range')),
   'RED proof: center latitude out of range flagged');
ok(clueIssues({ ...goodPoint, center: null }).some(i => i.includes('bad center')),
   'RED proof: missing center flagged');
ok(clueIssues({ ...goodPoint, answer: '   ' }).some(i => i.includes('empty answer')),
   'RED proof: blank answer flagged');

// ── 2. THE LOCK: every shipped clue is well-formed AND winnable ──
ok(EASY_CLUES.length > 50, `EASY pool is a realistic size (got ${EASY_CLUES.length})`);
ok(HARD_CLUES.length > 50, `HARD pool is a realistic size (got ${HARD_CLUES.length})`);

let cleanPoints = 0, cleanCountries = 0;
for (const [name, pool] of [['EASY', EASY_CLUES], ['HARD', HARD_CLUES]]) {
  pool.forEach((c, i) => {
    const issues = clueIssues(c);
    eq(issues.length, 0, `${name}[${i}] "${(c && c.answer || '').slice(0, 30)}" winnable + well-formed: ${issues.join('; ')}`);
    if (issues.length === 0) { c.type === 'point' ? cleanPoints++ : cleanCountries++; }
  });
}
ok(cleanPoints > 0, `swept real point clues (got ${cleanPoints} clean)`);
ok(cleanCountries > 0, `swept real country clues (got ${cleanCountries} clean)`);

// ── 3. getClueSet() selection invariants ──
// (module-level `seen` Sets persist across calls — invariants must hold regardless)
for (const diff of ['easy', 'hard', undefined]) {
  const pool = diff === 'hard' ? HARD_CLUES : EASY_CLUES;
  for (let draw = 0; draw < 20; draw++) {
    const picked = getClueSet(diff);
    ok(Array.isArray(picked), `getClueSet(${diff}) returns an array`);
    ok(picked.length <= 5, `getClueSet(${diff}) returns at most 5 (got ${picked.length})`);
    eq(picked.length, 5, `getClueSet(${diff}) returns exactly 5 from a large pool`);
    ok(picked.every(c => pool.includes(c)), `getClueSet(${diff}) picks only from its own pool`);
    eq(new Set(picked).size, picked.length, `getClueSet(${diff}) has no duplicate within a draw`);
  }
}
// default difficulty is easy: a default-pick is always an EASY-pool member
ok(getClueSet().every(c => EASY_CLUES.includes(c)), 'getClueSet() defaults to the EASY pool');
// hard picks are HARD-pool members (the two pools are distinct objects)
ok(getClueSet('hard').every(c => HARD_CLUES.includes(c)), "getClueSet('hard') draws from the HARD pool");

console.log(`\nclues: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
