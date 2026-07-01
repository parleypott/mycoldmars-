// Avatar initials — the 1-2 letter monogram shown in collaborator/presence/
// share/editor avatars when there's no photo. This was hand-inlined FIVE times
// across main.js with byte-identical logic (`name.split(/\s+/).map(s => s[0])
// .join('').slice(0, 2).toUpperCase() || '?'`); four of those copies called
// `.split` on a raw name and only survived because every caller pre-guarded
// with `|| fallback`. Consolidated here so the null-safety is guaranteed at the
// source, not left to each caller to remember.
//
// Contract (matches the prior inline behavior for every string input):
//   - takes the first character of each whitespace-run-separated word,
//   - keeps at most the first two, uppercased,
//   - returns '?' when there's nothing usable (null / undefined / empty /
//     whitespace-only / non-string).
export function initialsOf(name) {
  return String(name ?? '')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}
