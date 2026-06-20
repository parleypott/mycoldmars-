/*
 * chrome-legibility.test.mjs — L1 / L4 / ux-07 CSS guards (browser-free, string-parsing styles.css).
 *
 * L1   — structural chrome labels must not be hard-coded below the 11px floor, and must read the
 *        scalable --chrome-size token so the SIZE knob can enlarge them.
 * L4   — a prefers-reduced-motion block must exist and freeze animations/transitions/scroll.
 * ux-07 — the .wp-cart whole-cart background transition (the scroll shimmer) must be gone, and the
 *        cart-level hover tints must be gated behind a fine pointer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'styles.css'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) pass++; else { fail++; console.error('  ✗', name, extra != null ? '— ' + extra : ''); } }

// ── L1 ────────────────────────────────────────────────────────────────────────────────────────
ok('L1: --chrome-size token defined', /--chrome-size\s*:\s*11px/.test(css));
ok('L1: --chrome-size-sm token defined', /--chrome-size-sm\s*:\s*10px/.test(css));
// No structural label may still be pinned at the old sub-floor sizes.
const tiny = css.match(/font-size:\s*[78]px/g) || [];
ok('L1: no font-size 7px/8px left in chrome labels', tiny.length === 0, JSON.stringify(tiny));
// The scalable token is actually consumed by labels.
ok('L1: labels consume var(--chrome-size)', (css.match(/font-size:\s*var\(--chrome-size\)/g) || []).length >= 15,
  String((css.match(/font-size:\s*var\(--chrome-size\)/g) || []).length));

// ── L4 ────────────────────────────────────────────────────────────────────────────────────────
ok('L4: prefers-reduced-motion media block present', /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css));
const rm = css.slice(css.indexOf('prefers-reduced-motion'));
ok('L4: reduced motion freezes animation-duration', /animation-duration:\s*\.001ms\s*!important/.test(rm));
ok('L4: reduced motion freezes transition-duration', /transition-duration:\s*\.001ms\s*!important/.test(rm));
ok('L4: reduced motion forces scroll-behavior auto', /scroll-behavior:\s*auto\s*!important/.test(rm));
ok('L4: save pill pinned visible under reduced motion', /\.wp-save-pill[^{]*\{\s*opacity:\s*1\s*!important/.test(rm));

// ── ux-07 ─────────────────────────────────────────────────────────────────────────────────────
const cartRule = css.match(/\.wp-cart\s*\{[^}]*\}/);
ok('ux-07: .wp-cart rule found', !!cartRule);
ok('ux-07: .wp-cart has NO background transition (no scroll shimmer)',
  !!cartRule && !/transition:[^;]*background/.test(cartRule[0]), cartRule && cartRule[0]);
// The cart-wide hover tints are gated behind a real mouse.
ok('ux-07: .wp-cart:hover gated by fine pointer',
  /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*\.wp-cart:hover/.test(css));

console.log(`chrome-legibility: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
