// STICKY HEADER visibility — the one pure rule that decides whether the slim sticky strip
// (title + workspaces + share) is on screen. Kept out of the component so it can be tested
// headless and can never drift from the interplay contract.
//
// The strip exists ONLY to keep the workspaces menu (and share) reachable once the real
// masthead has scrolled away. So it shows when, and only when, ALL of these hold:
//   • the masthead is NOT currently visible (scrolled out — IntersectionObserver reports it)
//   • we are NOT in a ?read SHARE (readOnly) — a viewer has no owner chrome to carry
//   • NO workspace view is active — the wp-wsbar already owns the top edge there
//   • NOT in chapter-focus — the wp-chfocus-bar owns the top edge there
//
// Note this gates on readOnly (the SHARE capability), not the READ/EDIT toggle: an owner
// reading their own script still has the masthead workspaces button, so the strip still
// carries it. Only a true ?read share drops the whole strip.
export function stickyHeaderVisible({ mastheadVisible, readOnly, wsActive, chFocusActive }) {
  if (readOnly) return false;
  if (wsActive) return false;
  if (chFocusActive) return false;
  if (mastheadVisible) return false;
  return true;
}
