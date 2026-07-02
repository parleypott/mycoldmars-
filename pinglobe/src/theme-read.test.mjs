// Locks readSavedTheme — the boot-time theme restore behind PinGlobe's initThemes
// (pinglobe/src/main.js calls initThemes(map) inside the mapbox `style.load`
// handler, with NO try/catch). The OLD inline form was a bare
// `localStorage.getItem('globe-theme')` (+ removeItem) with NO guard, so a
// blocked-storage context — Safari "Block All Cookies", Brave shields, strict
// private mode — threw SecurityError on the very access and crashed theme init
// at boot (the globe never got its saved theme / map paint applied). This is the
// READ-side sibling of the WRITE guard already added to the vibes handler
// (obs 5923 guarded setItem only; the read stayed exposed). Same private-browsing
// storage-crash class hardened across laserspace hi-score, the vibes toggles
// (palau/borders/pinglobe/modern-middle-east), and every JSON.parse(localStorage)
// consumer in the repo.
//
// Run: node pinglobe/src/theme-read.test.mjs  (or `bun run test`)

import { readSavedTheme } from './theme.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// A store whose access throws — models blocked/disabled localStorage.
const throwingStore = {
  getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  removeItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
};

// A plain in-memory store with a call spy on removeItem.
function memStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  const calls = { removeItem: [] };
  return {
    calls,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => { calls.removeItem.push(k); data.delete(k); },
  };
}

// ── RED proof: the OLD inline read (no try/catch) crashes on a throwing store.
// Removing the try/catch in readSavedTheme makes THIS case throw → RED.
function oldInlineRead(store) {
  // exact pre-fix shape: bare access + getItem, no guard
  const saved = store.getItem('globe-theme');
  return saved && saved;
}
{
  let threw = false;
  try { oldInlineRead(throwingStore); } catch { threw = true; }
  ok(threw, 'RED proof: OLD bare read throws on a blocked/throwing store');
}

// ── The FIX: a throwing store degrades to the fallback, never throws ──
{
  let threw = false, val;
  try { val = readSavedTheme(throwingStore); } catch { threw = true; }
  ok(!threw, 'fixed: throwing store does NOT crash readSavedTheme');
  eq(val, 'bold', 'fixed: throwing store falls back to bold');
}

// ── Valid saved value is honored ──
eq(readSavedTheme(memStore({ 'globe-theme': 'neon' })), 'neon', 'valid saved -> honored');
eq(readSavedTheme(memStore({ 'globe-theme': 'monochrome' })), 'monochrome', 'valid saved (monochrome) -> honored');
eq(readSavedTheme(memStore({ 'globe-theme': 'bold' })), 'bold', 'valid saved (bold) -> honored');

// ── Missing value -> fallback, no prune ──
{
  const s = memStore({});
  eq(readSavedTheme(s), 'bold', 'missing -> bold');
  eq(s.calls.removeItem.length, 0, 'missing -> no removeItem');
}

// ── Present-but-invalid value -> fallback AND pruned ──
{
  const s = memStore({ 'globe-theme': 'garbage-theme' });
  eq(readSavedTheme(s), 'bold', 'invalid saved -> bold');
  eq(s.calls.removeItem.length, 1, 'invalid saved -> pruned once');
  ok(s.calls.removeItem[0] === 'globe-theme', 'invalid saved -> pruned the right key');
}

// ── A store that throws only on removeItem (prune failure) still returns fallback ──
{
  const s = {
    getItem: () => 'garbage-theme',
    removeItem: () => { throw new Error('nope'); },
  };
  let threw = false, val;
  try { val = readSavedTheme(s); } catch { threw = true; }
  ok(!threw, 'prune failure does not propagate');
  eq(val, 'bold', 'prune failure still falls back to bold');
}

// ── Custom fallback respected ──
eq(readSavedTheme(throwingStore, 'neon'), 'neon', 'custom fallback honored on throw');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
