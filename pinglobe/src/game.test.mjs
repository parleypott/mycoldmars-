// Locks the LIVE judging engine of PinGlobe — game.js checkGuess() + the pin /
// clue-progression accounting that wraps it. This is the function Johnny's geo
// game actually runs every time a player drops a pin: it decides correct/wrong,
// counts how many pins a clue cost, accumulates the running total, blocks
// double-scoring once a clue is resolved, and surfaces the answer/blurb only on
// a win. The clue DATA contract is locked by clues.test.mjs and the geo MATH by
// geo-utils.test.mjs / countries.test.mjs — but the method that ties them
// together had ZERO coverage. This test drives the REAL shipped Game class (no
// reimplementation — it imports game.js and calls checkGuess directly), so it
// can't drift from the code it guards.
//
// Two fixtures stand in for the locked-elsewhere data: a synthetic country
// feature (a 10×10° square) injected into game.countryFeatures so polygon
// containment is deterministic, and two hand-built clues. Everything judged is
// the real checkGuess / pointInFeature / haversine path.
//
// Run: bun pinglobe/src/game.test.mjs   (also picked up by `bun run test`)

// ── Minimal DOM stub: the Game constructor + updateUI touch ~16 elements. ──
function fakeEl() {
  return {
    textContent: '', innerHTML: '', className: '', offsetHeight: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, setAttribute() {},
  };
}
globalThis.document = {
  getElementById: () => fakeEl(),
  createElement: () => fakeEl(),
};

const { Game } = await import('./game.js');
const { haversine, kmToMiles } = await import('./geo-utils.js');

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) pass++;
  else { fail++; console.error(`  FAIL: ${msg}\n    expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── Build a Game with deterministic clues + a synthetic country polygon. ──
function freshGame() {
  const g = new Game();
  // A 10×10° square covering lat 0..10, lon 0..10. Ring coords are [lon, lat].
  g.countryFeatures = [{
    id: 'TESTLAND',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]] },
  }];
  g.clues = [
    { type: 'country', countryId: 'TESTLAND', center: { lat: 5, lon: 5 },
      answer: 'Testland', blurb: 'a test country', clue: 'find testland' },
    { type: 'point', center: { lat: 0, lon: 0 }, acceptRadius: 120,
      answer: 'Origin', blurb: 'the origin point', clue: 'find the origin' },
  ];
  g.pinsPerClue = [0, 0];
  g.totalPins = 0;
  g.currentClueIndex = 0;
  g.currentClueResolved = false;
  g.isActive = true;
  return g;
}

// ── 1. Country clue: a guess OUTSIDE the polygon scores wrong, costs a pin, ──
//      reports a sane rounded distance, and hides the answer/blurb.
{
  const g = freshGame();
  const r = g.checkGuess(50, 50); // far outside the square
  eq(r.correct, false, 'country: far guess is wrong');
  eq(r.pinsUsed, 1, 'country: first guess uses 1 pin');
  eq(g.totalPins, 1, 'country: totalPins incremented');
  eq(r.answer, null, 'country wrong: answer withheld');
  eq(r.blurb, null, 'country wrong: blurb withheld');
  const expKm = Math.round(haversine(50, 50, 5, 5));
  eq(r.distanceKm, expKm, 'country wrong: distanceKm is rounded haversine to center');
  eq(r.distanceMi, Math.round(kmToMiles(expKm === 0 ? 0 : haversine(50, 50, 5, 5))), 'country wrong: distanceMi rounded');
  ok(Number.isInteger(r.distanceKm) && Number.isInteger(r.distanceMi), 'distances are integers');
  ok(r.distanceMi < r.distanceKm, 'miles < km for a nonzero distance');
  eq(g.currentClueResolved, false, 'wrong guess does NOT resolve the clue');
}

// ── 2. Country clue: a guess INSIDE the polygon scores correct, resolves the ──
//      clue, and reveals answer + blurb.
{
  const g = freshGame();
  g.checkGuess(50, 50);           // one miss first
  const r = g.checkGuess(5, 5);   // dead center of the square → inside
  eq(r.correct, true, 'country: inside guess is correct');
  eq(r.pinsUsed, 2, 'country: correct on 2nd guess → 2 pins');
  eq(g.totalPins, 2, 'totalPins counts both attempts');
  eq(r.answer, 'Testland', 'country correct: answer revealed');
  eq(r.blurb, 'a test country', 'country correct: blurb revealed');
  eq(g.currentClueResolved, true, 'correct guess resolves the clue');
}

// ── 3. Double-scoring guard: once resolved, further guesses return null and ──
//      do NOT inflate the pin count. (Locks the `currentClueResolved` gate.)
{
  const g = freshGame();
  g.checkGuess(5, 5); // correct → resolved, 1 pin
  const again = g.checkGuess(5, 5);
  eq(again, null, 'resolved clue: extra guess returns null');
  eq(g.pinsPerClue[0], 1, 'resolved clue: pin count frozen');
  eq(g.totalPins, 1, 'resolved clue: totalPins frozen');
}

// ── 4. Point clue: judged by radius, not polygon. Beyond acceptRadius = wrong, ──
//      at-center = correct. Pins + totals accumulate across clues.
{
  const g = freshGame();
  g.checkGuess(5, 5);             // resolve country clue (1 pin)
  eq(g.nextClue(), true, 'nextClue advances to the point clue');
  eq(g.currentClueIndex, 1, 'now on clue index 1');
  eq(g.currentClueResolved, false, 'new clue starts unresolved');

  const far = g.checkGuess(5, 0); // ~555 km from (0,0) ≫ 120 km radius
  eq(far.correct, false, 'point: beyond acceptRadius is wrong');
  ok(far.distanceKm > 120, 'point miss: distance exceeds radius');
  eq(far.answer, null, 'point wrong: answer withheld');

  const hit = g.checkGuess(0, 0); // exact center → 0 km ≤ 120
  eq(hit.correct, true, 'point: within acceptRadius is correct');
  eq(hit.distanceKm, 0, 'point center: 0 km');
  eq(hit.pinsUsed, 2, 'point: correct on 2nd guess → 2 pins for this clue');
  eq(hit.answer, 'Origin', 'point correct: answer revealed');
  eq(g.totalPins, 3, 'totalPins = 1 (country) + 2 (point)');
}

// ── 5. End of round: nextClue past the last clue ends the game. ──
{
  const g = freshGame();
  g.checkGuess(5, 5);  // resolve clue 0
  g.nextClue();        // → clue 1
  g.checkGuess(0, 0);  // resolve clue 1
  eq(g.nextClue(), false, 'nextClue past the last clue returns false');
  eq(g.isActive, false, 'game goes inactive at end of round');
}

// ── 6. Unresolved guard the other way: checkGuess on an out-of-range index ──
//      (no current clue) returns null without throwing.
{
  const g = freshGame();
  g.currentClueIndex = 99; // past the end → getCurrentClue() === null
  eq(g.checkGuess(5, 5), null, 'no current clue: checkGuess returns null');
}

console.log(`game.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
