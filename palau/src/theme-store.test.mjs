// Locks readTheme — the boot-time theme restore read for the Palau map.
// palau/src/main.js reads the saved theme at MODULE TOP-LEVEL:
//   let currentTheme = readTheme(localStorage, 'palau-theme', 'neon', t => !!THEMES[t]);
// The OLD form was a bare `localStorage.getItem('palau-theme') || 'neon'` with NO
// guard. In a blocked-storage context (Safari "Block All Cookies", Brave shields,
// strict private mode) the very `getItem` access throws SecurityError — and because
// it runs at module top-level, that abort kills the whole module: the map never
// initializes and the entire Palau page is dead on load. This is the READ-side
// sibling of the WRITE guard (saveTheme, obs from the vibes-toggle sweep). Same
// private-browsing storage-crash class hardened across pinglobe theme, laserspace
// hi-score, and every JSON.parse(localStorage) consumer in the repo.
//
// Run: node palau/src/theme-store.test.mjs  (or `bun run test`)

import { readTheme, saveTheme } from './save-theme.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// A store whose access throws — models blocked/disabled localStorage.
const throwingStore = {
  getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  setItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
};

function memStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const THEMES = { neon: 1, realistic: 1 };
const isValid = (t) => !!THEMES[t];

// ── RED proof: the OLD bare read crashes on a throwing store (module-fatal at boot).
// Removing the try/catch inside readTheme makes THIS case throw → RED.
function oldBareRead(store) {
  return store.getItem('palau-theme') || 'neon'; // exact pre-fix shape
}
{
  let threw = false;
  try { oldBareRead(throwingStore); } catch { threw = true; }
  ok(threw, 'RED proof: OLD bare read throws on a blocked/throwing store');
}

// ── The FIX: a throwing store degrades to the fallback, never throws ──
{
  let threw = false, val;
  try { val = readTheme(throwingStore, 'palau-theme', 'neon', isValid); } catch { threw = true; }
  ok(!threw, 'fixed: throwing store does NOT crash readTheme');
  eq(val, 'neon', 'fixed: throwing store falls back to neon');
}

// ── Valid saved value is honored ──
eq(readTheme(memStore({ 'palau-theme': 'realistic' }), 'palau-theme', 'neon', isValid), 'realistic', 'valid saved -> honored');
eq(readTheme(memStore({ 'palau-theme': 'neon' }), 'palau-theme', 'neon', isValid), 'neon', 'valid saved (neon) -> honored');

// ── Missing value -> fallback ──
eq(readTheme(memStore({}), 'palau-theme', 'neon', isValid), 'neon', 'missing -> neon');

// ── Present-but-invalid value -> fallback ──
eq(readTheme(memStore({ 'palau-theme': 'garbage' }), 'palau-theme', 'neon', isValid), 'neon', 'invalid saved -> neon fallback');

// ── Default isValid (no validator) honors any truthy saved value ──
eq(readTheme(memStore({ 'palau-theme': 'anything' }), 'palau-theme', 'neon'), 'anything', 'no validator -> any truthy saved honored');

// ── Sanity: saveTheme round-trips through a mem store and readTheme reads it back ──
{
  const s = memStore({});
  ok(saveTheme(s, 'palau-theme', 'realistic'), 'saveTheme returns true on a writable store');
  eq(readTheme(s, 'palau-theme', 'neon', isValid), 'realistic', 'round-trip: saved value reads back');
}

// ── saveTheme swallows a throwing store (returns false, no throw) ──
{
  let threw = false, ret;
  try { ret = saveTheme(throwingStore, 'palau-theme', 'neon'); } catch { threw = true; }
  ok(!threw, 'saveTheme does not throw on a blocked store');
  eq(ret, false, 'saveTheme returns false on a blocked store');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
