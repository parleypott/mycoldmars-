/*
 * sot-mark-attrs.test.mjs — locks the /sot SOUNDBITE direction-mark kind (commit 4dc3598) and,
 * more importantly, the SILENT-COERCION class that guards EVERY slash-produced mark kind.
 *
 * /sot marks the selected prose as an interview quote / spoken line — a red-purple ITALIC run
 * (`.wp-dhl[data-kind="sot"]`) plus a SOTS craft in the Role Focus Hub lens. The feature spans
 * four hand-maintained files with nothing binding them: the mark-attrs factory
 * (direction-chip.js defaultDirectionMarkAttrs), the slash command (slash-menu.js), the craft row
 * (roles.js), and the CSS chip color + lens + boost (styles.css). roles-lens-contract.test.mjs
 * already binds ROLE_DEFS <-> CSS for EVERY craft (so SOTS's lens/boost/tint are covered there).
 *
 * The gap this file closes is the one the contract test CANNOT see: what the editor actually
 * PRODUCES when you type /sot. `setDirectionMark(editor, range, 'sot')` resolves its attrs through
 * `defaultDirectionMarkAttrs('sot')`, whose switch DEFAULT-case silently coerces any unswitched
 * kind to `{ kind: 'direction', status: 'default' }`. So the slash item can exist, the CSS + role
 * lens can ship, and yet — if the `case 'sot'` line is ever dropped in a merge/refactor — /sot
 * would produce a grey `data-kind="direction"` chip: no red-purple, no italic, and the SOTS lens
 * silently lights NOTHING. No error, no other test fails. That is the exact silent-divergence
 * class this loop kills; mapdata + oncam each got their own lock, sot had none.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SLASH_ITEMS } from './extensions/slash-menu.js';
import { defaultDirectionMarkAttrs, DIRECTION_CHIP_KINDS } from './extensions/direction-chip.js';
import { ROLE_DEFS } from './roles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'styles.css'), 'utf8');
const slashSrc = readFileSync(join(HERE, 'extensions/slash-menu.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// ── the sot-specific plumbing ───────────────────────────────────────────────────────────────
ok('defaultDirectionMarkAttrs("sot") is a single-state soundbite run — NOT coerced to direction', () => {
  assert.deepEqual(defaultDirectionMarkAttrs('sot'), { kind: 'sot', status: 'static' });
});

ok('sot is a declared direction-chip kind', () => {
  assert.ok(DIRECTION_CHIP_KINDS.includes('sot'));
});

ok('the /sot slash item exists, is an inline mark, and applies the sot kind', () => {
  const item = SLASH_ITEMS.find((i) => i.title === 'sot');
  assert.ok(item, 'sot slash item present');
  assert.equal(item.group, 'mark', 'sot is an inline mark, not structure');
  for (const q of ['sot', 'sound', 'quote', 'speak', 'speech', 'interview']) {
    assert.ok(item.match(q), `alias prefix "${q}" resolves to sot`);
  }
});

ok('the SOTS craft points at the sot chip with the red-purple tint', () => {
  const c = ROLE_DEFS.find((r) => r.id === 'sot');
  assert.ok(c, 'sot ROLE_DEF present');
  assert.equal(c.label, 'SOTS');
  assert.equal(c.tint, '#a02c62');
  assert.equal(c.sel, '.wp-dhl[data-kind="sot"]');
});

ok('styles.css ships the sot chip rule — filled, red-purple, and ITALIC (it is speech)', () => {
  const rule = css.split('\n').find((l) => l.includes('.wp-dhl[data-kind="sot"]') && l.includes('background'));
  assert.ok(rule, 'sot chip color rule present');
  assert.ok(rule.includes('#a02c62'), 'the red-purple border tint is used');
  assert.ok(/font-style:\s*italic/.test(rule), 'sot text renders italic — it is someone speaking');
});

// ── the CLASS lock: no slash-produced mark kind may silently coerce to "direction" ──────────
// Extract EVERY kind the slash menu produces via setDirectionMark(editor, range, 'KIND') straight
// from the shipped source, then assert the attrs factory returns that SAME kind (never the
// default-coerced 'direction'). This catches sot AND any future kind added to the slash menu
// without a matching switch case in defaultDirectionMarkAttrs — the silent-drift the /sot commit
// warns about ("the default case silently coerces unknown kinds to 'direction'").
ok('every setDirectionMark kind in slash-menu.js has an explicit (non-coerced) attrs case', () => {
  const kinds = [...slashSrc.matchAll(/setDirectionMark\(editor,\s*range,\s*'([a-z0-9]+)'/g)].map((m) => m[1]);
  assert.ok(kinds.includes('sot'), 'source-extraction found the /sot producer (guards the test itself)');
  assert.ok(kinds.length >= 6, `expected several mark kinds, found ${kinds.length}: ${kinds}`);
  for (const kind of [...new Set(kinds)]) {
    const produced = defaultDirectionMarkAttrs(kind).kind;
    assert.equal(
      produced, kind,
      `/${kind} routes through setDirectionMark but defaultDirectionMarkAttrs('${kind}') produced ` +
      `kind '${produced}' — the switch is missing a 'case ${kind}' and the mark silently coerces to ` +
      `a grey "direction" chip (wrong color, no lens match). Add the explicit case.`,
    );
  }
});

console.log(`\nsot-mark-attrs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
