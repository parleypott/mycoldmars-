// Locks savedAudioIdx(), the ▶-resume position picker for the BURGUNDY reader's
// audiobook player (public/burgundy/index.html). Sliced from the shipped HTML at
// runtime — a drift in index.html breaks this test.
//
// Behavior locked (rewritten in commit c2f687d, the "enterprise pass"): resume
// from the FURTHEST point reached, whether that came from listening (AUDIO_PLACE)
// or from reading ahead silently (bg-place2). The old code returned the
// last-LISTENED index whenever it was present, so a reader who listened to
// para 5, then read ahead to para 20 with their eyes, would tap ▶ and be yanked
// BACKWARD to para 5. The furthest-wins fix makes ▶ continue from para 20.
// A silent revert to "audio-place wins" is exactly the regression this guards.
//
// savedAudioIdx reads localStorage via safeGet(AUDIO_PLACE)/safeGet('bg-place2');
// we inject those as free variables so the sliced body runs pure.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function savedAudioIdx\(flat\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract savedAudioIdx() from index.html — did the signature change?');

// Build the fn with safeGet + AUDIO_PLACE injected. store: { key -> value }.
function build(store) {
  const safeGet = (k) => (k in store ? store[k] : null);
  const factory = new Function('safeGet', 'AUDIO_PLACE', `return (${m[0]});`);
  return factory(safeGet, 'bg-audio-place');
}
const AUDIO = 'bg-audio-place', READ = 'bg-place2';
// a 30-paragraph book: keys "ci:pi" — the exact shape flatParas() emits.
const flat = Array.from({ length: 30 }, (_, i) => ({ key: `0:${i}` }));

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ── 1. the load-bearing case: listened to 5, then read ahead to 20 ───────────
{
  const f = build({ [AUDIO]: '0:5', [READ]: '0:20' });
  ok(f(flat) === 20, 'read-ahead (20) beats last-listened (5) → resume at the furthest');
}

// ── 2. listened furthest, then re-read BACKWARD — resume must not regress ─────
{
  const f = build({ [AUDIO]: '0:20', [READ]: '0:5' });
  ok(f(flat) === 20, 'scrolling back to re-read (5) does NOT drag ▶ back from the furthest listen (20)');
}

// ── 3. equal points ─────────────────────────────────────────────────────────
{
  const f = build({ [AUDIO]: '0:12', [READ]: '0:12' });
  ok(f(flat) === 12, 'listened == read → that point');
}

// ── 4. only one signal present ───────────────────────────────────────────────
ok(build({ [AUDIO]: '0:8' })(flat) === 8, 'only a listen place → resume there');
ok(build({ [READ]: '0:17' })(flat) === 17, 'only a read place → resume there');

// ── 5. fresh reader: nothing stored → start at the top ───────────────────────
ok(build({})(flat) === 0, 'no place at all → paragraph 0');

// ── 6. stale keys (book republished; a saved key no longer exists) ───────────
ok(build({ [AUDIO]: '9:99', [READ]: '0:14' })(flat) === 14, 'stale audio key ignored, valid read place wins');
ok(build({ [AUDIO]: '9:99', [READ]: '9:98' })(flat) === 0, 'both keys stale → never returns -1, floors at 0');
ok(build({ [AUDIO]: '0:0' })(flat) === 0, 'a legit place at index 0 resolves to 0 (not treated as "not found")');

// ── MUTATION PROOF ───────────────────────────────────────────────────────────
// Reconstruct the OLD (pre-c2f687d) picker — "the last-listened index wins
// whenever it resolves; only fall back to the read place if it does not" — and
// prove it yanks ▶ backward on the exact read-ahead case the fix rejects.
const oldWins = (store) => {
  const g = (k) => (k in store ? store[k] : null);
  const key = g(AUDIO);
  if (key) { const i = flat.findIndex(u => u.key === key); if (i >= 0) return i; }
  const read = g(READ);
  if (read) { const i = flat.findIndex(u => u.key === read); if (i >= 0) return i; }
  return 0;
};
const readAhead = { [AUDIO]: '0:5', [READ]: '0:20' };
assert.equal(oldWins(readAhead), 5, 'sanity: the OLD code resumed at the last-listened para (5), ignoring the read-ahead');
assert.equal(build(readAhead)(flat), 20, 'the FIX resumes at the furthest-read para (20) — the regression this locks');
pass += 2;

console.log(`audio-resume-furthest: ${pass} assertions passed`);
