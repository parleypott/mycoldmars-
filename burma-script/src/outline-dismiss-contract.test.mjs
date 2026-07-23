/**
 * OUTLINE DRAWER — DISMISS + SCROLL CONTRACT (vector: outline-dismiss).
 *
 * Johnny hit a hard trap: the OUTLINE drawer got stuck open, covered the script, and its collapse
 * button was buried under fixed top chrome (the sticky strip, z above the drawer), so there was no
 * way to close it — "can't scroll up to collapse it." This pins EVERY escape hatch so that trap can
 * never come back:
 *
 *   1. clicking a chapter jumps AND closes                 (main.jsx OutlinePanel item onClick)
 *   2. Esc closes the panel (works even when buried)        (main.jsx OutlinePanel keydown effect)
 *   3. a click-away backdrop closes it                      (main.jsx .wp-outline-backdrop onClose)
 *   4. the sticky strip YIELDS while the drawer is open     (sticky-header.js outlineOpen gate)
 *   5. the list is viewport-bounded and scrolls (min-height:0 + overflow-y:auto) so a 17+ chapter
 *      outline never spills past the screen with no way down (styles.css .wp-outline-list)
 *   6. the row-drag grip carries NO native `title` — a browser tooltip that wouldn't dismiss under
 *      the drawer was leaking and sticking on screen (extensions/table.js)
 *
 * The JSX/CSS mount sites aren't headless-mountable (Preact), so — like read-gates-contract — this
 * scans source and asserts each path is wired. stickyHeaderVisible IS pure, so #4 is checked live.
 *
 * Run: bun src/outline-dismiss-contract.test.mjs   (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stickyHeaderVisible } from './sticky-header.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(HERE, 'main.jsx'), 'utf8');
const css = readFileSync(join(HERE, 'styles.css'), 'utf8');
const table = readFileSync(join(HERE, 'extensions', 'table.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

ok('clicking a chapter jumps AND closes the drawer', () => {
  assert.ok(/onClick=\{\(\) => \{ jump\(it\.id\); onClose\?\.\(\); \}\}/.test(main),
    'the browse-mode outline item onClick calls jump(it.id) then onClose()');
});

ok('Esc closes the drawer (a keydown effect gated on open, calling onClose)', () => {
  // The effect keys on `open`, ignores an in-progress reorder drag, and calls onClose on Escape.
  assert.ok(/if \(!open\) return undefined;[\s\S]{0,260}?e\.key !== 'Escape' \|\| dragRef\.current[\s\S]{0,80}?onClose\?\.\(\)/.test(main),
    'an open-gated Escape handler calls onClose (and defers to a live drag)');
});

ok('a click-away backdrop closes the drawer', () => {
  assert.ok(/\{open && <div class="wp-outline-backdrop" onClick=\{onClose\}/.test(main),
    'the backdrop renders only while open and closes on click');
  assert.ok(/\.wp-outline-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0/.test(css),
    'the backdrop is a fixed full-viewport click-catcher');
});

ok('the drawer sits ABOVE its backdrop so the drawer stays interactive', () => {
  const bd = css.match(/\.wp-outline-backdrop\s*\{[^}]*z-index:\s*(\d+)/);
  const panel = css.match(/\.wp-outline\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(bd && panel, 'both z-indexes are declared');
  assert.ok(Number(panel[1]) > Number(bd[1]), 'drawer z-index is above the backdrop z-index');
});

ok('sticky strip YIELDS the top edge while the outline drawer is open', () => {
  assert.equal(stickyHeaderVisible({ mastheadVisible: false, wsActive: false, chFocusActive: false, outlineOpen: true }), false,
    'scrolled past + outline open → strip HIDDEN (never buries the drawer collapse)');
  assert.equal(stickyHeaderVisible({ mastheadVisible: false, wsActive: false, chFocusActive: false, outlineOpen: false }), true,
    'scrolled past + outline closed → strip SHOWN (unchanged)');
  // The component must actually feed outlineOpen into the rule.
  assert.ok(/stickyHeaderVisible\(\{[^}]*outlineOpen: !!outlineOpen/.test(main),
    'StickyHeader passes outlineOpen into stickyHeaderVisible');
});

ok('the outline list is viewport-bounded and scrolls (min-height:0 + overflow-y:auto)', () => {
  assert.ok(/\.wp-outline-list\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/.test(css),
    'the list has min-height:0 so overflow-y:auto actually scrolls a long outline');
  assert.ok(/\.wp-outline\s*\{[^}]*height:\s*100vh/.test(css), 'the drawer is hard-bounded to the viewport height');
});

ok('the row-drag grip carries NO native title (stuck-tooltip leak killed)', () => {
  const line = table.split('\n').find((l) => l.includes("'wp-row-drag'"));
  assert.ok(line, 'the wp-row-drag handle is created');
  assert.ok(!/title:/.test(line), 'the wp-row-drag handle has no native title attribute');
  assert.ok(/aria-label/.test(line), 'it keeps an aria-label for accessibility');
});

console.log(`\noutline-dismiss-contract.test.mjs — ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
