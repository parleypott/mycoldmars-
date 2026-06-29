// First coverage for the modern-middle-east THEME system — the one piece of
// hand-authored, load-bearing config in this project that had no guard at all.
//
// modern-middle-east is the architecturally-unique quiz game (obs 5332): the
// other two (fascism, flyingmoney) ship static single-theme constants, but this
// one has a 3-theme switcher (bold / neon / monochrome) driven by two
// hand-edited structures in src/main.js:
//
//   const THEMES = { bold:{css,map}, neon:{...}, monochrome:{...} }
//   const THEME_ORDER = ['bold','neon','monochrome']
//
// Three live contracts depend on these two staying well-formed and in sync. All
// three break SILENTLY (no crash, no test failure) on a plausible authoring edit:
//
//   1. ORDER↔THEMES sync. The "vibes" button cycles:
//        const idx  = THEME_ORDER.indexOf(currentTheme);
//        const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
//        applyTheme(next);
//      and applyTheme silently no-ops on an unknown name (`if (!theme) return`).
//      So if Johnny adds a name to THEME_ORDER but forgets to add it to THEMES
//      (or renames a theme in one place only), the vibes button visibly does
//      NOTHING for that step — a dead-feeling control, fully shipped.
//
//   2. required shape. applyTheme reads `Object.entries(theme.css)` (unguarded —
//      a missing/non-object css throws and breaks that click) and applyMapTheme
//      reads `m.bg / m.fill / m.outline`. Every theme that ORDER can reach must
//      carry a non-empty css object and a map object with those three keys.
//
//   3. uniform css keys. applyTheme only SETS CSS custom properties
//      (root.style.setProperty) and never CLEARS them. So a property defined in
//      ONE theme but absent from another persists STALE after a switch
//      (e.g. neon-only `--glow` lingers on :root after neon→bold). The only way
//      a theme switch fully re-skins is if every theme defines the SAME set of
//      custom-property keys. This is the subtle, real visual bug the lock guards.
//
// This is a DATA-CONTRACT test, not a code mutation lock: it re-extracts the
// EXACT shipped literals from main.js source (so there's zero served-code change
// and zero regression surface) and re-derives the invariants the live tool relies
// on. Any future theme edit that breaks them goes RED in `bun run test` before it
// can ship.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'main.js');

// ── Extract the two shipped literals straight from source ──
// main.js can't be imported in node (it builds a mapbox map + touches the DOM at
// module top level), and THEMES/THEME_ORDER aren't exported. So scan the source
// for each declaration and eval ONLY its literal (object/array literals are inert
// — no calls, no identifiers). A balanced-delimiter scan keeps it robust to the
// nested braces inside THEMES.
function extractLiteral(src, decl, open, close) {
  const at = src.indexOf(decl);
  assert.notEqual(at, -1, `could not find \`${decl}\` in main.js`);
  const start = src.indexOf(open, at);
  assert.notEqual(start, -1, `no \`${open}\` after \`${decl}\``);
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  assert.notEqual(end, -1, `unbalanced ${open}${close} for \`${decl}\``);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src.slice(start, end + 1)});`)();
}

const src = readFileSync(SRC, 'utf8');
const THEMES = extractLiteral(src, 'const THEMES', '{', '}');
const THEME_ORDER = extractLiteral(src, 'const THEME_ORDER', '[', ']');
// The module's initial `currentTheme` default — the theme shown before any click
// and the value the vibes cycle starts from.
const DEFAULT_MATCH = src.match(/let\s+currentTheme\s*=\s*'([^']+)'/);
assert.ok(DEFAULT_MATCH, 'could not find `let currentTheme = ...` default');
const DEFAULT_THEME = DEFAULT_MATCH[1];

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('modern-middle-east THEME contract:');

t('THEME_ORDER is a non-empty array of strings', () => {
  assert.ok(Array.isArray(THEME_ORDER) && THEME_ORDER.length > 0, 'THEME_ORDER must be a non-empty array');
  THEME_ORDER.forEach((n, i) => assert.equal(typeof n, 'string', `THEME_ORDER[${i}] must be a string`));
  // no dupes — a repeated name makes the cycle stutter
  assert.equal(new Set(THEME_ORDER).size, THEME_ORDER.length, 'THEME_ORDER has duplicate entries');
});

t('THEMES is a non-empty object', () => {
  assert.ok(THEMES && typeof THEMES === 'object' && !Array.isArray(THEMES), 'THEMES must be an object');
  assert.ok(Object.keys(THEMES).length > 0, 'THEMES is empty');
});

t('the default currentTheme exists in THEMES (initial paint is real)', () => {
  assert.ok(THEMES[DEFAULT_THEME], `default theme '${DEFAULT_THEME}' is not a key of THEMES`);
});

t('every THEME_ORDER name exists in THEMES (vibes button never no-ops)', () => {
  for (const name of THEME_ORDER) {
    assert.ok(THEMES[name], `THEME_ORDER lists '${name}' but THEMES has no such theme — vibes button would dead-no-op on it`);
  }
});

t('every reachable theme has a non-empty css object + map{bg,fill,outline}', () => {
  for (const name of THEME_ORDER) {
    const th = THEMES[name];
    assert.ok(th.css && typeof th.css === 'object', `theme '${name}': css must be an object (applyTheme does Object.entries(theme.css))`);
    assert.ok(Object.keys(th.css).length > 0, `theme '${name}': css is empty`);
    assert.ok(th.map && typeof th.map === 'object', `theme '${name}': map must be an object`);
    for (const k of ['bg', 'fill', 'outline']) {
      assert.equal(typeof th.map[k], 'string', `theme '${name}': map.${k} must be a string (applyMapTheme reads it)`);
      assert.ok(th.map[k].trim().length > 0, `theme '${name}': map.${k} is blank`);
    }
  }
});

t('all reachable themes define the SAME css custom-property keys (no stale-prop leak on switch)', () => {
  // applyTheme only SETS properties, never clears — so divergent key sets leave
  // stale custom properties on :root after a theme switch. Pin every theme to the
  // default theme's key set.
  const ref = Object.keys(THEMES[DEFAULT_THEME].css).sort();
  for (const name of THEME_ORDER) {
    const keys = Object.keys(THEMES[name].css).sort();
    assert.deepEqual(
      keys, ref,
      `theme '${name}' css keys diverge from the default theme '${DEFAULT_THEME}'. ` +
      `A key in one theme but not another persists STALE after a switch (applyTheme never clears props). ` +
      `Missing: [${ref.filter(k => !keys.includes(k))}]  Extra: [${keys.filter(k => !ref.includes(k))}]`
    );
  }
});

t('every css custom property is a non-empty --kebab token with a string value', () => {
  for (const name of THEME_ORDER) {
    for (const [prop, value] of Object.entries(THEMES[name].css)) {
      assert.ok(/^--[a-z][a-z0-9-]*$/.test(prop), `theme '${name}': css key '${prop}' is not a --custom-property`);
      assert.equal(typeof value, 'string', `theme '${name}': css['${prop}'] must be a string`);
      assert.ok(value.trim().length > 0, `theme '${name}': css['${prop}'] is blank`);
    }
  }
});

console.log(`\n${pass} assertions passed.`);
