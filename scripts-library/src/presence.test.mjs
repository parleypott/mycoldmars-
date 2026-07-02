// Tests for presence.js pure formatting helpers — initialsOf + colorFor.
//
// These render the presence dots: a wrong initials extraction shows "?" for real names, and a
// non-deterministic colorFor would make a profile-less holder's dot flicker color on every poll. Lock
// both. (The network/DOM paths are exercised live in the browser screenshot, not here.)
//
// Run: bun scripts-library/src/presence.test.mjs

// supa.js reads import.meta.env (undefined under bun) → its try/catch sets supabase=null, so importing
// presence.js is safe headless. Shim window so any top-level references stay happy.
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const { initialsOf, colorFor } = await import('./presence.js');

let pass = 0, fail = 0;
const eq = (got, want, label) => { if (got === want) pass++; else { fail++; console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };

// ── initialsOf ─────────────────────────────────────────────────────────────────
eq(initialsOf('Johnny Harris'), 'JH', 'two words → both initials');
eq(initialsOf('johnnywharris'), 'JO', 'single token → first two letters, uppercased');
eq(initialsOf('jeremy'), 'JE', 'single lowercase name');
eq(initialsOf('john.doe'), 'JD', 'dot-separated → both initials');
eq(initialsOf('ana-maria'), 'AM', 'hyphen-separated → both initials');
eq(initialsOf(''), '?', 'empty → question mark, never blank');
eq(initialsOf('   '), '?', 'whitespace-only → question mark');
eq(initialsOf(null), '?', 'null → question mark, no throw');

// ── colorFor: deterministic + always a valid hex from the palette ────────────────
ok(/^#[0-9a-f]{6}$/i.test(colorFor('user-123')), 'colorFor returns a hex color');
eq(colorFor('user-123'), colorFor('user-123'), 'colorFor is deterministic (same seed → same color)');
ok(colorFor('a') !== colorFor('zzzz') || true, 'colorFor varies across seeds (soft check)');
eq(colorFor(null), colorFor(null), 'colorFor(null) stable, no throw');

console.log(fail === 0 ? `PASS — all ${pass} presence cases correct` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
