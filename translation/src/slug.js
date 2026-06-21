// Transcript permalink slug generation.
//
// Extracted from main.js so it can be unit-tested. generateSlug turns a
// transcript name (often the uploaded FILE NAME, e.g. "Mehdi's Interview.mp4")
// into the URL slug used for the permalink hash and for ensureUniqueSlug.
//
// The apostrophe strip MUST cover the curly variants. The intent is that a
// contraction ("Johnny's") collapses to "johnnys", not "johnny-s" — but the
// original class was straight-apostrophe-only (U+0027), so a name carrying a
// curly apostrophe (U+2019, the default macOS Finder / smart-quote substitution
// in file names) fell through to the `[^a-z0-9]+ -> '-'` pass and produced an
// ugly "johnny-s-..." slug. Same incomplete-char-class family as the b-roll \b
// and strip-quotes fixes. Strip straight ' (U+0027), left curly ' (U+2018),
// and right curly ' (U+2019) so the result is identical regardless of which
// apostrophe glyph the source used.
export function generateSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}
