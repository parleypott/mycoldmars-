// Direction-arrow screen geometry for the "wrong guess" hint.
//
// After a miss, PinGlobe draws a small arrow next to the guess pin that points
// toward the correct country (in SCREEN space, using mapbox's project()). Two
// things must stay true or the hint silently lies to the player:
//   1. the SVG rotation (angleDeg) points the arrow at the target, and
//   2. the marker offset nudges the arrow toward the target, not away from it.
//
// The arrow SVG points UP at 0deg (north on screen). Screen y grows DOWNWARD.
// So the angle is measured clockwise from up: atan2(dx, -dy).
//   - target due north (dx=0, dy<0)  -> 0deg,  offset up
//   - target due east  (dx>0, dy=0)  -> 90deg, offset right
//
// This was extracted verbatim from the confirmGuess() handler to lock the
// contract — a refactor that flipped the atan2 args or an offset sign would
// point the hint the wrong way with no test to catch it (the same class as the
// flight-animation "panned the wrong way around the globe" bug).

// Clockwise-from-up screen angle (degrees) from the guess pin to the target,
// given the screen-space delta (dx = target.x - guess.x, dy = target.y - guess.y).
export function arrowAngleDeg(dx, dy) {
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}

// Pixel offset that nudges the arrow marker `offsetDist` px toward the target,
// given the angle from arrowAngleDeg. y is negated because screen y grows down.
export function arrowOffsetPx(angleDeg, offsetDist) {
  const rad = angleDeg * Math.PI / 180;
  return { x: Math.sin(rad) * offsetDist, y: -Math.cos(rad) * offsetDist };
}
