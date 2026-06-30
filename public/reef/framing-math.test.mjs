// Verifier-layer test for the reef player's PER-FRAME FRAMING math (commit 766e2a5).
//
// reef/index.html lets you pause and "reframe" a single frame — zoom (scale) + pan
// (translate) — and that framing is persisted forever in localStorage. The load-
// bearing design decision: pan is stored as a FRACTION of the legal max-translate,
// NOT as pixels. That is what makes a frame locked on a 2560-wide laptop re-apply
// with no black bars on a phone, in fullscreen, or after a resize. The contracts:
//
//   1. LOAD VALIDATION — only entries with finite s/x/y survive, and they are
//      clamped: s -> [1.0, 3.0], x,y -> [-1, 1]. Junk (NaN/Infinity/missing/
//      wrong-type) is dropped; a non-object store yields {} (no crash, no garbage).
//   2. NO BLACK BARS — for ANY valid framing and ANY viewport, the applied pixel
//      translate never exceeds the legal max-translate. This is the whole reason
//      pan is a fraction: |fraction| <= 1  =>  |px| = |fraction*maxTx| <= maxTx.
//   3. ROUND-TRIP — commit stores fraction = px/maxTx; apply recovers px =
//      fraction*maxTx. At one viewport, apply(commit(px)) == px (no drift).
//   4. s == 1 EDGE — at min scale maxTx == 0; the `maxTx > 0 ?` guards must yield
//      fraction 0 (NOT NaN from a 0/0 divide). This is the truthy-zero / divide-by-
//      zero trap this loop has been bitten by repeatedly.
//
// The load predicate, the clamp ranges, the apply math, and the commit math are all
// EXTRACTED LIVE from index.html (regex + new Function) so this lock can't drift
// from a hand-copy. Mutation proofs at the bottom verify the test has teeth.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-9, `${msg} (got ${a}, want ${b})`); passed++; };

// --- extract the shared `clamp` primitive (everything below leans on it) ---
const clampSrc = html.match(/const clamp = .*/);
assert.ok(clampSrc, 'could not find clamp in reef/index.html');
const clamp = new Function(`${clampSrc[0]}\nreturn clamp;`)();

// --- extract the scale constants ---
const sConst = html.match(/const S_MIN = ([\d.]+), S_DEF = ([\d.]+), S_MAX = ([\d.]+);/);
assert.ok(sConst, 'could not find S_MIN/S_DEF/S_MAX');
const S_MIN = +sConst[1], S_DEF = +sConst[2], S_MAX = +sConst[3];
eq(S_MIN, 1.0, 'S_MIN is 1.0 (min scale = no zoom)');
eq(S_MAX, 3.0, 'S_MAX is 3.0 (max zoom)');
ok(S_DEF > S_MIN && S_DEF < S_MAX, 'S_DEF sits strictly inside [S_MIN, S_MAX] (room to zoom OUT)');

// --- 1. LOAD VALIDATOR: extract the live guard + normalize expression ---
// guard:    e && Number.isFinite(e.s) && Number.isFinite(e.x) && Number.isFinite(e.y)
// normalize: { s: clamp(e.s, S_MIN, S_MAX), x: clamp(e.x, -1, 1), y: clamp(e.y, -1, 1) }
const guardSrc = html.match(/if \((e && Number\.isFinite[^{]*?)\)\s*\{/);
assert.ok(guardSrc, 'could not find the per-entry finite guard');
const normSrc = html.match(/framing\[k\] = (\{ s: clamp[^;]*\});/);
assert.ok(normSrc, 'could not find the per-entry normalize expression');

const loadFraming = new Function('raw', 'clamp', 'S_MIN', 'S_MAX', `
  const framing = {};
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      const e = raw[k];
      if (${guardSrc[1]}) { framing[k] = ${normSrc[1]}; }
    }
  }
  return framing;
`);
const load = (raw) => loadFraming(raw, clamp, S_MIN, S_MAX);

// a clean entry survives and is clamped into range
{
  const out = load({ a: { s: 2.0, x: 0.5, y: -0.25 } });
  ok(out.a, 'a finite entry survives the load');
  near(out.a.s, 2.0, 'in-range scale kept');
  near(out.a.x, 0.5, 'in-range x kept');
  near(out.a.y, -0.25, 'in-range y kept');
}
// out-of-range values are CLAMPED, not dropped
{
  const out = load({ a: { s: 9, x: 5, y: -5 } });
  near(out.a.s, S_MAX, 'over-max scale clamped to S_MAX');
  near(out.a.x, 1, 'over-1 x clamped to 1');
  near(out.a.y, -1, 'under -1 y clamped to -1');
}
{
  const out = load({ a: { s: 0.1, x: 0, y: 0 } });
  near(out.a.s, S_MIN, 'sub-min scale clamped to S_MIN (no negative/zero zoom)');
}
// non-finite or partial entries are DROPPED (would otherwise feed NaN into transforms)
ok(!load({ a: { s: NaN, x: 0, y: 0 } }).a, 'NaN scale dropped');
ok(!load({ a: { s: Infinity, x: 0, y: 0 } }).a, 'Infinity scale dropped');
ok(!load({ a: { s: 2, x: 0 } }).a, 'missing y dropped');
ok(!load({ a: { s: '2', x: 0, y: 0 } }).a, 'string scale dropped (Number.isFinite is type-strict)');
ok(!load({ a: null }).a, 'null entry dropped');
// wrong-type / junk store degrades to empty (the wrongtype-json-parse contract)
eq(Object.keys(load([{ s: 2, x: 0, y: 0 }])).length, 1, 'array store: numeric-index entries still validated (no crash)');
eq(Object.keys(load(42)).length, 0, 'number store -> empty framing');
eq(Object.keys(load('nope')).length, 0, 'string store -> empty framing');
eq(Object.keys(load(null)).length, 0, 'null store -> empty framing');

// --- 2 & 3. APPLY + COMMIT math, extracted live ---
// apply:  maxTx = (f.s-1)/2*W ; px = f.x * maxTx
const applySrc = html.match(/const maxTx = \(f\.s - 1\) \/ 2 \* W, maxTy = \(f\.s - 1\) \/ 2 \* H;/);
assert.ok(applySrc, 'could not find applyFraming maxTx/maxTy math');
const applyPx = new Function('f', 'W', 'H', `
  ${applySrc[0]}
  return { tx: f.x * maxTx, ty: f.y * maxTy, maxTx, maxTy };
`);
// commit: x = maxTx > 0 ? clamp(edit.tx/maxTx, -1, 1) : 0
const commitX = html.match(/x: (maxTx > 0 \? clamp\(edit\.tx \/ maxTx, -1, 1\) : 0)/);
const commitY = html.match(/y: (maxTy > 0 \? clamp\(edit\.ty \/ maxTy, -1, 1\) : 0)/);
assert.ok(commitX && commitY, 'could not find commitReframe fraction math');
const commitFraction = new Function('edit', 'W', 'H', 'clamp', `
  const maxTx = (edit.s - 1) / 2 * W, maxTy = (edit.s - 1) / 2 * H;
  return { x: ${commitX[1]}, y: ${commitY[1]} };
`);
const commit = (s, tx, ty, W, H) => commitFraction({ s, tx, ty }, W, H, clamp);

// NO BLACK BARS: for any valid fraction and any viewport, |px| <= maxTx
for (const W of [320, 800, 2560]) {
  for (const H of [240, 600, 1440]) {
    for (const s of [1.0, 1.5, 2.0, 3.0]) {
      for (const x of [-1, -0.37, 0, 0.5, 1]) {
        const { tx, maxTx } = applyPx({ s, x, y: 0 }, W, H);
        ok(Math.abs(tx) <= maxTx + 1e-9,
          `applied |tx| within legal max-translate (W=${W},s=${s},x=${x})`);
      }
    }
  }
}

// ROUND-TRIP at a fixed viewport: commit(px) -> fraction -> apply -> same px
{
  const W = 1920, H = 1080, s = 2.2;
  const maxTx = (s - 1) / 2 * W;
  const px = 0.4 * maxTx;                       // some legal pixel pan
  const frac = commit(s, px, 0, W, H);
  const back = applyPx({ s, x: frac.x, y: 0 }, W, H);
  near(back.tx, px, 'commit->apply round-trips pixel pan at a fixed viewport');
}

// VIEWPORT INDEPENDENCE: the same stored fraction stays legal at a different size
{
  const frac = commit(2.0, 0.6 * ((2.0 - 1) / 2 * 1000), 0, 1000, 1000); // locked on 1000px
  near(frac.x, 0.6, 'pixel pan converts to the intended fraction');
  const phone = applyPx({ s: 2.0, x: frac.x, y: 0 }, 375, 667);          // replay on a phone
  ok(Math.abs(phone.tx) <= phone.maxTx + 1e-9, 'same fraction stays within bounds on a smaller viewport');
}

// 4. s == 1 EDGE: maxTx == 0 must give fraction 0, never NaN (truthy-zero guard)
{
  const frac = commit(1.0, 0, 0, 1920, 1080);
  eq(frac.x, 0, 's==1 commit gives x=0 (guarded divide, no NaN)');
  eq(frac.y, 0, 's==1 commit gives y=0 (guarded divide, no NaN)');
  ok(Number.isFinite(frac.x) && Number.isFinite(frac.y), 's==1 fractions are finite');
}

// --- mutation proofs: the lock must FAIL if the load-bearing logic regresses ---
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}
// drop the `maxTx > 0 ?` guard -> s==1 divides 0/0 -> NaN -> assertion fails
mustThrow(() => {
  const bad = new Function('edit', 'W', 'H', 'clamp', `
    const maxTx = (edit.s - 1) / 2 * W, maxTy = (edit.s - 1) / 2 * H;
    return { x: clamp(edit.tx / maxTx, -1, 1), y: clamp(edit.ty / maxTy, -1, 1) };
  `);
  const f = bad({ s: 1.0, tx: 0, ty: 0 }, 1920, 1080, clamp);
  assert.equal(f.x, 0, 'unguarded s==1 must NOT cleanly equal 0');
}, 'removing the maxTx>0 guard yields NaN at s==1');
// drop the finite check -> a NaN scale survives load -> assertion fails
mustThrow(() => {
  const lax = new Function('raw', 'clamp', 'S_MIN', 'S_MAX', `
    const framing = {};
    for (const k of Object.keys(raw)) { framing[k] = { s: clamp(raw[k].s, S_MIN, S_MAX), x: 0, y: 0 }; }
    return framing;
  `);
  const out = lax({ a: { s: NaN } }, clamp, S_MIN, S_MAX);
  assert.ok(!out.a, 'a finite-check-less load must NOT drop the NaN entry');
}, 'removing Number.isFinite lets NaN framing through');

console.log(`reef framing-math: ${passed} assertions passed`);
