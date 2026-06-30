// Newpress INVESTOR DECK — pure navigation-target decision.
//
// THE RISK this isolates: the live deck (mycoldmars.vercel.app/newpress-deck/) drives
// every slide change through goTo(index). next()/prev() call goTo(current ± 1), and the
// only thing standing between a key/click/swipe at the deck's edge and a crash is the
// bounds clamp. If that clamp ever regresses, prev() at slide 0 sets current = -1 and the
// very next updateProgress() dereferences `slides[current].bg` → TypeError, and the WHOLE
// deck dies mid-pitch (blank/error screen, nobody watching to catch it). Likewise a
// "fix" that turned the hard-stop into a wrap-around would silently change deck behavior.
//
// navTarget() is the pure heart of that decision, extracted so it can be mutation-locked:
//   - returns the index to navigate to, or
//   - returns null to mean "no-op" (out of range, or already there).
//
// Behavior is byte-identical to the original inline guard in goTo():
//   if (index < 0 || index >= total || index === current) return;  // no-op
export function navTarget(index, current, total) {
  if (!Number.isInteger(index)) return null;
  if (index < 0 || index >= total) return null; // off either end → hard stop (no wrap)
  if (index === current) return null;            // already there → nothing to do
  return index;
}
