// Sub-carousel index wrap for the founder-photo carousel on the investor deck.
//
// Extracted from initCarousel()'s inline `(n + imgs.length) % imgs.length` so it
// can be unit-tested WITHOUT a DOM. The inline form has two latent throw sites the
// static deck never trips today but that a bad edit could reach:
//   - len === 0 (a .sub-carousel with no .sub-carousel-img): `n % 0` is NaN, so
//     `imgs[NaN]` is undefined and `.classList` throws — a blank slide that hard-
//     crashes the deck's keyboard/click nav instead of just showing nothing.
//   - n non-finite: a dot whose `data-idx` is missing/garbage yields `+undefined`
//     === NaN → same NaN index → same throw.
// wrapIndex() folds any target into [0, len) for a positive len and degrades to 0
// (a safe, always-present first slide) for an empty carousel or a non-finite target.
// For every finite n with len > 0 it is byte-identical to `(n + len) % len` — the
// double-add-then-mod that makes a backward step from 0 wrap to the last slide.

/**
 * @param {number} n    requested target index (may be negative, out of range, or NaN)
 * @param {number} len  number of slides
 * @returns {number}    an index in [0, len), or 0 when len <= 0 / n is non-finite
 */
export function wrapIndex(n, len) {
  if (!Number.isInteger(len) || len <= 0) return 0;
  if (!Number.isFinite(n)) return 0;
  return ((n % len) + len) % len;
}
