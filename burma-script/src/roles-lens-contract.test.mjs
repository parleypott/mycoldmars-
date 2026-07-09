/*
 * roles-lens-contract.test.mjs — the ROLE FOCUS HUB's THREE-WAY selector contract.
 *
 * The hub is the crew-lens Johnny's team uses on ?read share links: check your craft, every
 * row that isn't your work fades. It has NO runtime engine — the actual dimming is pure CSS in
 * styles.css, keyed off `.wp-page[data-roles~="<id>"] … :has(<selector>)`. So the behavior is a
 * contract spread across THREE hand-maintained files that nothing binds together:
 *
 *   1. roles.js       — ROLE_DEFS[].sel  (the declared selector for each craft)
 *   2. styles.css     — the LENS block   (the CSS that actually re-lights a row)
 *   3. convert-menu.js / slash-menu.js — the editor kinds a chip can actually carry
 *
 * roles.test.mjs already locks parse/serialize/toggle — the STRING plumbing. But it never
 * checks that a craft's declared `sel` is the selector the stylesheet matches, nor that the
 * craft's `data-kind` is a kind the editor can actually PRODUCE. If any one drifts (a kind
 * renamed in the editor, a lens selector hand-edited, a `sel` typo), the hub keeps serializing
 * a valid attribute and the CSS keeps loading — but a teammate's lens silently lights NOTHING.
 * That is the exact silent-divergence class this loop kills. These bind the three copies.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROLE_DEFS } from './roles.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'styles.css'), 'utf8');
const convertMenu = readFileSync(join(HERE, 'extensions/convert-menu.js'), 'utf8');
const slashMenu = readFileSync(join(HERE, 'extensions/slash-menu.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('  ✗', name, '—', e.message); } };

// The craft's kind is the token inside its data-kind="…" — the atom shared by all three files.
const kindOf = (sel) => (sel.match(/data-kind="([^"]+)"/) || [])[1];

ok('every craft declares a data-kind that the extraction can read', () => {
  for (const r of ROLE_DEFS) {
    assert.ok(kindOf(r.sel), `ROLE_DEF "${r.id}" has a data-kind in its sel: ${r.sel}`);
  }
});

// (1) roles.js .sel  ⇄  styles.css LENS.  The lens re-lights a row iff it `:has(<sel>)`. If the
// declared selector isn't the one the stylesheet matches on, the craft's rows never re-light.
ok('every craft.sel is the EXACT selector the CSS lens re-lights on (:has(sel))', () => {
  for (const r of ROLE_DEFS) {
    assert.ok(
      css.includes(`:has(${r.sel})`),
      `styles.css lens must re-light rows with :has(${r.sel}) for craft "${r.id}" — ` +
      `roles.js and the stylesheet have DRIFTED (the lens would silently do nothing)`,
    );
  }
});

// The lens is ALSO gated on the craft's id token: `.wp-page[data-roles~="animation"] …`. If the id
// the hub serializes isn't the token the stylesheet keys on, checking that craft does nothing.
ok('every craft id is the token the CSS lens is gated on ([data-roles~="id"])', () => {
  for (const r of ROLE_DEFS) {
    assert.ok(
      css.includes(`[data-roles~="${r.id}"]`),
      `styles.css must gate the lens on [data-roles~="${r.id}"] for craft "${r.id}"`,
    );
  }
});

// (2) roles.js .sel  ⇄  the editor's producible kinds.  A chip can only carry a kind the editor
// offers via the convert menu (VIZ_KINDS) or the slash menu. If a craft points at a kind the
// editor can't produce, no chip will EVER match — a dead lens by construction.
ok('every craft kind is a kind the editor can actually produce (convert ∪ slash menu)', () => {
  for (const r of ROLE_DEFS) {
    const kind = kindOf(r.sel);
    const inConvert = convertMenu.includes(`kind: '${kind}'`);
    const inSlash = slashMenu.includes(`makeItem('${kind}'`) || slashMenu.includes(`, '${kind}'`);
    assert.ok(
      inConvert || inSlash,
      `craft "${r.id}" kind "${kind}" is not offered by the convert menu OR the slash menu — ` +
      `the editor can never produce a chip the "${r.id}" lens matches`,
    );
  }
});

// The two fail-generous crafts also union a legacy surface ([data-fc] spans, [data-broll] blocks).
// The lens must re-light on that surface too, or a factcheck/b-roll teammate misses their legacy work.
ok('factcheck + broll lenses also re-light on their legacy surface', () => {
  assert.ok(css.includes('[data-fc]'), 'the fact-check legacy span surface [data-fc] is styled/matched');
  assert.ok(css.includes('[data-broll]'), 'the b-roll legacy block surface [data-broll] is styled/matched');
  const fc = ROLE_DEFS.find((r) => r.id === 'factcheck');
  const br = ROLE_DEFS.find((r) => r.id === 'broll');
  // The union appears verbatim inside the lens :has() (asserted above) — here just pin the shape.
  assert.ok(fc.sel.includes('[data-fc]') && css.includes(':has(.wp-dhl[data-kind="factcheck"], [data-fc])'));
  assert.ok(br.sel.includes('[data-broll]') && css.includes(':has(.wp-dhl[data-kind="broll"], [data-broll])'));
});

console.log(`\nroles-lens-contract: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
