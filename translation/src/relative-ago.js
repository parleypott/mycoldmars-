// Human "N ago" label for an ELAPSED-DURATION in milliseconds (not a timestamp).
//
// This is the save-status pill's formatter ("Saved 5s ago" / "Saved 3 min ago"),
// pulled out of main.js so it can be unit-tested and mutation-locked.
//
// THE BUG THIS FIXES (round-vs-floor divergence): the inline copy in main.js
// derived each unit with Math.round, so the label read AHEAD of reality by up to
// nearly a whole unit — 90 seconds showed "2 min ago", 90 minutes showed "2h
// ago", 36 hours showed "2d ago". The correct convention for an elapsed "N ago"
// label is FLOOR: you have not been away "2 hours" until a full 2 hours passed.
// The library's own relative-time formatter (library-time.js relativeTimeFrom)
// already floors every unit; this pill was the outlier divergent-weaker copy.
//
// Also NaN-safe: a non-finite input degrades to 'just now' instead of the old
// "NaNd ago" the round path produced (NaN < 5 is false, so every threshold fell
// through to the final `${NaN}d ago`). The caller guards lastSavedAt != null, so
// this only bites on a corrupt clock value, but the guard is free.

export function relativeAgo(ms) {
  const sec = Math.floor(Number(ms) / 1000);
  if (!Number.isFinite(sec) || sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
