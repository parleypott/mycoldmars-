// shortcuts-overlay.test.mjs — the ⌘/ help card's data contract + drift locks.
//
// The card renders SHORTCUT_GROUPS from shortcuts-list.js (pure data, imported LIVE).
// Three things get locked, browser-free:
//   1. SHAPE — every item has plain-words copy and either key tokens or a mouse gesture;
//      the load-bearing bindings Johnny relies on are all present.
//   2. TRUTH — every keyboard row on the card is cross-checked against the REAL keymap
//      source (table.js Tab hop, link-kbd.js Mod-k, slash-menu.js char '/', FindReplace
//      Cmd+F, main.jsx chapter-focus Esc, ShortcutsOverlay ⌘/ + Esc-capture) so the help
//      card cannot drift from the code it documents.
//   3. CHROME — the appended styles.css block exists, stays FLAT (3px ink border, no
//      box-shadow, one accent), and main.jsx actually mounts the overlay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SHORTCUT_GROUPS, comboLabels, keyLabel, isMacPlatform } from './shortcuts-list.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, p), 'utf8');

let pass = 0;
function ok(label, fn) { fn(); pass++; }

// ── 1. shape ─────────────────────────────────────────────────────────────────────────
ok('four groups, in reading order', () => {
  assert.deepEqual(
    SHORTCUT_GROUPS.map((g) => g.title),
    ['move around', 'write', 'with the mouse', 'this card'],
  );
});

ok('every item is well-formed: plain-words copy + keys XOR mouse', () => {
  for (const g of SHORTCUT_GROUPS) {
    assert.ok(g.items.length, `${g.title} has items`);
    for (const it of g.items) {
      assert.ok(typeof it.does === 'string' && it.does.length > 4, `bad copy on ${JSON.stringify(it)}`);
      const hasKeys = Array.isArray(it.keys) && it.keys.length > 0;
      const hasMouse = typeof it.mouse === 'string' && it.mouse.length > 0;
      assert.ok(hasKeys !== hasMouse, `keys XOR mouse on "${it.does}"`);
      if (hasKeys) for (const t of it.keys) assert.equal(typeof t, 'string', `bad token in "${it.does}"`);
    }
  }
});

const allKeyItems = SHORTCUT_GROUPS.flatMap((g) => g.items).filter((i) => i.keys);
const hasCombo = (...tokens) =>
  allKeyItems.some((i) => i.keys.length === tokens.length && i.keys.every((t, n) => t === tokens[n]));

ok('the load-bearing bindings are all on the card', () => {
  for (const combo of [
    ['Tab'], ['Shift', 'Tab'],          // cell hop
    ['Mod', 'F'],                       // find
    ['Mod', 'K'],                       // link
    ['Mod', 'Z'], ['Mod', 'Shift', 'Z'],// undo / redo
    ['/'],                              // slash menu
    ['Esc'],                            // exit focus / close menus
    ['Mod', '/'],                       // the card itself
  ]) assert.ok(hasCombo(...combo), `missing ${combo.join('+')}`);
});

ok('mouse rows cover the shipped gestures', () => {
  const gestures = SHORTCUT_GROUPS.flatMap((g) => g.items).filter((i) => i.mouse).map((i) => i.mouse).join(' | ');
  for (const needle of ['timecode', 'READ / EDIT', '⛶', '⊟']) {
    assert.ok(gestures.includes(needle), `missing gesture: ${needle}`);
  }
});

ok('copy stays plain + lowercase-friendly (no marketing shout)', () => {
  for (const it of SHORTCUT_GROUPS.flatMap((g) => g.items)) {
    assert.ok(!/[A-Z]{2}/.test(it.does.replace(/READ|EDIT|Esc/g, '')), `shouty copy: "${it.does}"`);
    assert.ok(!/!$/.test(it.does), `exclamation copy: "${it.does}"`);
  }
});

// ── platform helpers ─────────────────────────────────────────────────────────────────
ok('Mod renders ⌘ on mac, Ctrl elsewhere; plain tokens pass through', () => {
  assert.equal(keyLabel('Mod', true), '⌘');
  assert.equal(keyLabel('Mod', false), 'Ctrl');
  assert.equal(keyLabel('Shift', true), '⇧');
  assert.equal(keyLabel('Shift', false), 'Shift');
  assert.equal(keyLabel('Tab', true), 'Tab');
  assert.deepEqual(comboLabels(['Mod', 'Shift', 'Z'], true), ['⌘', '⇧', 'Z']);
  assert.deepEqual(comboLabels(['Mod', 'Shift', 'Z'], false), ['Ctrl', 'Shift', 'Z']);
});

ok('isMacPlatform sniffs mac + iOS, rejects the rest', () => {
  assert.ok(isMacPlatform('MacIntel'));
  assert.ok(isMacPlatform('macOS'));
  assert.ok(isMacPlatform('iPhone'));
  assert.ok(!isMacPlatform('Win32'));
  assert.ok(!isMacPlatform('Linux x86_64'));
  assert.ok(!isMacPlatform(''));
  assert.ok(!isMacPlatform(undefined));
});

// ── 2. truth — cross-check the card against the real keymap sources ────────────────
ok('Tab / Shift+Tab cell hop still bound in table.js', () => {
  const table = src('extensions/table.js');
  assert.ok(/Tab:\s*\(\)\s*=>\s*doCellHop\(/.test(table), 'Tab → doCellHop');
  assert.ok(/'Shift-Tab':\s*\(\)\s*=>\s*doCellHop\(/.test(table), 'Shift-Tab → doCellHop');
});

ok('Cmd+F still bound in FindReplace.jsx', () => {
  assert.ok(/\(e\.metaKey \|\| e\.ctrlKey\)[^\n]*e\.key === 'f'/.test(src('FindReplace.jsx')));
});

ok("Cmd+K still bound in link-kbd.js", () => {
  assert.ok(/'Mod-k':/.test(src('extensions/link-kbd.js')));
});

ok("the slash menu still triggers on '/' (anywhere, not just line start)", () => {
  const slash = src('extensions/slash-menu.js');
  assert.ok(/char:\s*'\/'/.test(slash));
  assert.ok(/startOfLine:\s*false/.test(slash));
});

ok('undo/redo history is still on (StarterKit undoRedo tuning present)', () => {
  assert.ok(/undoRedo/.test(src('Editor.jsx')), 'undoRedo config in Editor.jsx');
});

ok('Esc still exits chapter focus, honouring defaultPrevented', () => {
  const main = src('main.jsx');
  assert.ok(/e\.key !== 'Escape'/.test(main));
  assert.ok(/e\.defaultPrevented/.test(main), 'the "someone consumed this Esc" check');
});

ok('the overlay itself binds ⌘/ toggle + capture-phase Esc with preventDefault', () => {
  const overlay = src('ShortcutsOverlay.jsx');
  assert.ok(/\(e\.metaKey \|\| e\.ctrlKey\)[^\n]*e\.key === '\/'/.test(overlay), '⌘/ toggle');
  assert.ok(/addEventListener\('keydown', onKey, true\)/.test(overlay), 'capture phase');
  assert.ok(/e\.preventDefault\(\)/.test(overlay), 'preventDefault marks the Esc consumed');
});

ok('the overlay is pure chrome — no editor / collab / write-path imports', () => {
  const overlay = src('ShortcutsOverlay.jsx');
  for (const banned of ['Editor.jsx', 'collab', 'migrate-doc', 'cloud-sync', 'write-token']) {
    assert.ok(!new RegExp(`from '\\./${banned}`).test(overlay), `must not import ${banned}`);
  }
});

// ── 3. chrome — the appended CSS block + the main.jsx mount ─────────────────────────
const css = src('styles.css');
const start = css.indexOf('SHORTCUTS OVERLAY (night/shortcuts-overlay)');
const end = css.indexOf('end SHORTCUTS OVERLAY');
ok('styles.css carries the delimited SHORTCUTS OVERLAY block at the tail', () => {
  assert.ok(start !== -1, 'block header present');
  assert.ok(end > start, 'block terminator present');
});
const block = css.slice(start, end);

ok('the card is FLAT: 3px ink border, no shadows, accent via var(--ep-accent)', () => {
  assert.ok(/\.wp-keys-card\s*{[^}]*border:\s*3px solid var\(--ink\)/.test(block), '3px ink border');
  assert.ok(!/box-shadow/.test(block), 'no box-shadow anywhere in the block');
  assert.ok(/var\(--ep-accent/.test(block), 'accent reads var(--ep-accent)');
  assert.ok(/font-family:\s*var\(--mono\)/.test(block), 'mono chrome');
});

ok('the veil outranks the banners (z-1000) and the library backbar (z-9999)', () => {
  const z = block.match(/\.wp-keys-veil\s*{[^}]*z-index:\s*(\d+)/);
  assert.ok(z && Number(z[1]) > 9999, `veil z-index ${z && z[1]} must beat 9999`);
});

ok('help chrome is stripped from print', () => {
  assert.ok(/@media print\s*{[^}]*\.wp-keys/.test(block));
});

ok('main.jsx mounts the overlay with one import + one line', () => {
  const main = src('main.jsx');
  assert.ok(/import { ShortcutsOverlay } from '\.\/ShortcutsOverlay\.jsx'/.test(main));
  assert.ok(/<ShortcutsOverlay \/>/.test(main));
});

console.log(`shortcuts-overlay.test.mjs: ${pass} assertions passed`);
