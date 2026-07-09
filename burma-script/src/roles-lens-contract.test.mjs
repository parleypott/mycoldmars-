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
// Two craft archetypes: CHIP crafts key on an inline directionMark (`.wp-dhl[data-kind="…"]`);
// BLOCK crafts key on a whole block's data-attr (VO → `[data-vo]` → voBlock). The block attr atom.
const isChip = (sel) => /data-kind="/.test(sel);
const blockAttrOf = (sel) => (sel.match(/\[data-([a-z-]+)\]/) || [])[1];

ok('every craft declares a readable selector (chip data-kind OR block data-attr)', () => {
  for (const r of ROLE_DEFS) {
    if (isChip(r.sel)) assert.ok(kindOf(r.sel), `chip craft "${r.id}" has a data-kind: ${r.sel}`);
    else assert.ok(blockAttrOf(r.sel), `block craft "${r.id}" targets a data-attr: ${r.sel}`);
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
ok('every craft kind/block is something the editor can actually produce (convert ∪ slash menu)', () => {
  for (const r of ROLE_DEFS) {
    if (isChip(r.sel)) {
      const kind = kindOf(r.sel);
      const inConvert = convertMenu.includes(`kind: '${kind}'`);
      const inSlash = slashMenu.includes(`makeItem('${kind}'`) || slashMenu.includes(`, '${kind}'`);
      assert.ok(
        inConvert || inSlash,
        `craft "${r.id}" kind "${kind}" is not offered by the convert menu OR the slash menu — ` +
        `the editor can never produce a chip the "${r.id}" lens matches`,
      );
    } else {
      // BLOCK craft (VO → [data-vo] → voBlock): the block must be a real slash/convert target,
      // else the lens keys on a block the editor can never make. VO: /vo makeItem + "Make VO" __vo.
      const attr = blockAttrOf(r.sel);
      const inSlash = slashMenu.includes(`makeItem('${attr}'`);
      const inConvert = convertMenu.includes(`__${attr}`);
      assert.ok(
        inSlash || inConvert,
        `block craft "${r.id}" ([data-${attr}]) is not producible via slash (makeItem('${attr}')) ` +
        `or convert (__${attr}) — the "${r.id}" lens keys on a block the editor can never make`,
      );
    }
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

// (3) roles.js .tint  ⇄  styles.css BOOST underlay.  Inside a lit row, the boost rule paints
// YOUR craft's chip with a highlighter underlay: `.wp-page[data-roles~="id"] …data-kind="kind"
// { box-shadow: inset 0 -.55em 0 rgba(R,G,B,A) }`. The module header promises "the hub's checkbox
// list, the legend swatch tints, and the CSS selectors must never drift apart — one list, one
// truth." The lens selectors are locked above; the tint↔boost color binding was NOT. If a craft's
// tint is recolored (or the boost rgba is) without the other, the hub's legend swatch would LIE
// about the highlight a crew member actually sees on their chip in the doc. Bind them.
const hexToRgb = (hex) => {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
};
// A boost line is one gated on [data-roles~="id"] that carries a highlighter shadow (lens
// rules on the same id use opacity/filter, never a box-shadow) — so matching box-shadow+rgba is
// unique. Chip crafts underlay the chip (`inset 0 -.55em 0`) with ONE such rule; VO (a block)
// carries TWO — a cart-body spine (`inset 3px 0 0`) AND the vo-tag ring (`0 0 0 2px`) — and BOTH
// paint the craft's tint. Return EVERY boost line's rgb (not just the first): a block craft with a
// multi-surface boost must have ALL of them agree with the legend swatch, else a recolor that
// touches one rule but not the other silently drifts the second surface off the tint — exactly the
// legend⇄doc-highlight drift this contract exists to kill (the first-line-only check missed it).
const boostRgbsFor = (id) => {
  const out = [];
  for (const l of css.split('\n')) {
    if (!(l.includes(`[data-roles~="${id}"]`) && l.includes('box-shadow') && l.includes('rgba('))) continue;
    const m = l.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return out;
};

ok('every craft has a BOOST underlay rule (the "your chip pops" affordance)', () => {
  for (const r of ROLE_DEFS) {
    assert.ok(
      boostRgbsFor(r.id).length > 0,
      `styles.css must carry a boost box-shadow gated on [data-roles~="${r.id}"] for craft "${r.id}" — ` +
      `without it, checking your craft lights the row but your own chip never highlights`,
    );
  }
});

ok('EVERY boost surface for a craft equals craft.tint (legend ⇄ doc-highlight, all rules)', () => {
  for (const r of ROLE_DEFS) {
    const want = hexToRgb(r.tint);
    const got = boostRgbsFor(r.id);
    // A block craft (VO) paints more than one surface — assert each one, so a recolor of the
    // vo-tag ring alone (leaving the cart-body spine on the old tint, or vice-versa) is caught.
    for (const rgb of got) {
      assert.deepEqual(
        rgb, want,
        `craft "${r.id}" tint ${r.tint} (rgb ${want}) must match its boost underlay rgb ${rgb} — ` +
        `the hub's legend swatch and an in-document boost surface have DRIFTED to different colors`,
      );
    }
  }
});

console.log(`\nroles-lens-contract: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
