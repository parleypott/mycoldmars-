// STICKY HEADER visibility — the one pure rule that decides whether the slim sticky strip
// (title + workspaces, plus SHARE for the owner) is on screen. Kept out of the component so it
// can be tested headless and can never drift from the interplay contract.
//
// The strip exists ONLY to keep the workspaces menu reachable once the real masthead has
// scrolled away. The masthead's workspaces menu now mounts in ?read shares too (a teammate's
// craft lens + cutout view are read-safe, decoration-only paint), so the strip follows it in
// EITHER mode. It shows when, and only when, ALL of these hold:
//   • the masthead is NOT currently visible (scrolled out — IntersectionObserver reports it)
//   • NO workspace view is active — the wp-wsbar already owns the top edge there
//   • NOT in chapter-focus — the wp-chfocus-bar owns the top edge there
//
// readOnly is NOT a hide gate anymore: a ?read viewer still gets the (read-safe) workspaces
// menu in the strip — just without the owner-only SHARE control, which the StickyHeader
// component omits when readOnly. The pre-v1 rule dropped the whole strip in a share; that was
// the "workspaces excluded from ?read" scope cut this change reverses.
export function stickyHeaderVisible({ mastheadVisible, wsActive, chFocusActive } = {}) {
  if (wsActive) return false;
  if (chFocusActive) return false;
  if (mastheadVisible) return false;
  return true;
}
