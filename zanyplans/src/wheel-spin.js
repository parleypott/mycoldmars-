// Pure spin math for the glitch-effect wheel — extracted so it can be tested
// without a DOM, and so the landing/selection contract stays locked.
//
// The wheel is an SVG rotated by `targetAngle` degrees clockwise. A fixed
// pointer sits at the top (12 o'clock). Segment i occupies the clockwise range
// [i*segAngle, (i+1)*segAngle] measured from the top, so its CENTER sits at
// i*segAngle + segAngle/2.
//
// THE BUG THIS REPLACES: the old click handler built
//   targetAngle = currentRotation + extra*360 + randomSegment*segAngle + segAngle/2
// which folded the half-segment centering offset into `currentRotation` on EVERY
// spin. After the first spin that offset compounded — every other spin landed the
// pointer dead on a segment boundary (looks broken), and the announced effect
// drifted away from the wedge actually under the pointer (defeats the whole point
// of a spin wheel). See wheel-spin.test.mjs.
//
// THE FIX: floor `currentRotation` to whole turns before adding the segment
// offset, so targetAngle % 360 is ALWAYS randomSegment*segAngle + segAngle/2 — a
// clean center landing — no matter how many times you've spun before.

// Plan one spin. `rand` defaults to Math.random; injectable for tests.
// Returns the absolute target rotation (degrees) to animate to.
export function planSpin(currentRotation, n, rand = Math.random) {
  const segAngle = 360 / n;
  const extraRotations = 3 + Math.floor(rand() * 4);
  const randomSegment = Math.floor(rand() * n);
  // Strip the current partial turn so the half-segment offset never accumulates.
  const base = currentRotation - (((currentRotation % 360) + 360) % 360);
  let targetAngle = base + extraRotations * 360 + randomSegment * segAngle + segAngle / 2;
  // Safety: always spin forward (extraRotations >= 3 makes this a no-op).
  while (targetAngle <= currentRotation) targetAngle += 360;
  return targetAngle;
}

// Which segment index sits under the top pointer at this rotation. This inverts
// the rotation: a clockwise wheel rotation moves segment 0 away from the top, so
// the segment now at the pointer is the one rotated into place from the other
// direction.
export function selectedFromAngle(targetAngle, n) {
  const segAngle = 360 / n;
  const normalizedAngle = ((targetAngle % 360) + 360) % 360;
  const idx = Math.round(normalizedAngle / segAngle) % n;
  return (n - idx) % n;
}
