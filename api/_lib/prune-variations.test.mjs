// Tests for pruneVariations — the loved-aware variation pruner for QSS
// saved stories. Imports the REAL shipped function (no mirror, can't drift).
//
// Headline bug it locks: the old inline code used `unloved.slice(-count)`,
// and slice(-0) returns the WHOLE array — so when loved.length >= max the
// cap was defeated and every unloved variation survived.
import { pruneVariations } from './prune-variations.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${a}, want ${b})`); }

const lovedN = (n) => Array.from({ length: n }, (_, i) => ({ id: 'L' + i, loved: true }));
const unlovedN = (n) => Array.from({ length: n }, (_, i) => ({ id: 'U' + i }));
const ids = (arr) => arr.map(v => v.id);

// ── INLINE RED PROOF: reconstruct the OLD buggy logic and show it leaks ──────
function oldBuggyPrune(variations) {
  const MAX = 12;
  let working = variations.slice();
  if (working.length > MAX) {
    const loved = working.filter(v => v?.loved);
    const unloved = working.filter(v => !v?.loved);
    const keepUnlovedCount = Math.max(0, MAX - loved.length);
    const keptUnloved = unloved.slice(-keepUnlovedCount); // <-- slice(-0) bug
    const keepSet = new Set([...loved, ...keptUnloved].map(v => v.id));
    working = variations.filter(v => keepSet.has(v.id));
  }
  return working;
}
{
  const v = [...lovedN(12), ...unlovedN(8)]; // 20 total
  const old = oldBuggyPrune(v);
  ok(old.length === 20, 'RED PROOF: old code keeps ALL 20 (cap defeated)');
  ok(old.filter(x => !x.loved).length === 8, 'RED PROOF: old code keeps all 8 unloved');
  const fixed = pruneVariations(v, 12);
  ok(fixed.length === 12, 'fixed keeps exactly 12');
  ok(fixed.filter(x => !x.loved).length === 0, 'fixed drops all unloved when loved fills cap');
  ok(fixed.every(x => x.loved), 'fixed keeps only the loved ones');
}

// ── THE FIX: loved.length >= max ⇒ zero unloved kept ─────────────────────────
{
  const v = [...lovedN(13), ...unlovedN(5)]; // loved exceeds cap
  const out = pruneVariations(v, 12);
  // All loved are always kept (loved are never dropped), zero unloved.
  eq(out.length, 13, 'loved>max: keeps all 13 loved');
  eq(out.filter(x => !x.loved).length, 0, 'loved>max: keeps zero unloved');
}
{
  const v = [...lovedN(12), ...unlovedN(1)]; // loved == cap, one unloved
  const out = pruneVariations(v, 12);
  eq(out.length, 12, 'loved==max: caps at 12');
  eq(out.filter(x => !x.loved).length, 0, 'loved==max: drops the one unloved');
}

// ── Normal top-up: keep all loved + most-recent unloved to fill cap ──────────
{
  const v = [...lovedN(3), ...unlovedN(15)]; // 18 total
  const out = pruneVariations(v, 12);
  eq(out.length, 12, 'top-up: caps at 12');
  eq(out.filter(x => x.loved).length, 3, 'top-up: keeps all 3 loved');
  eq(out.filter(x => !x.loved).length, 9, 'top-up: keeps 9 unloved (12-3)');
  // Most-recent unloved kept = U6..U14 (drops oldest U0..U5)
  const keptUnloved = ids(out.filter(x => !x.loved));
  ok(keptUnloved.includes('U14'), 'top-up: keeps newest unloved U14');
  ok(!keptUnloved.includes('U0'), 'top-up: drops oldest unloved U0');
  ok(!keptUnloved.includes('U5'), 'top-up: drops U5 (boundary)');
  ok(keptUnloved.includes('U6'), 'top-up: keeps U6 (boundary)');
}

// ── Order preservation (returns in original array order) ─────────────────────
{
  const v = [{ id: 'a' }, { id: 'b', loved: true }, { id: 'c' }, { id: 'd' }];
  // length 4 <= max 12 ⇒ returned untouched, original order
  const out = pruneVariations(v, 12);
  ok(JSON.stringify(ids(out)) === JSON.stringify(['a', 'b', 'c', 'd']), 'order preserved when under cap');
}
{
  // interleaved loved/unloved, must prune to 4 preserving original order
  const v = [
    { id: 'u0' }, { id: 'l0', loved: true }, { id: 'u1' }, { id: 'l1', loved: true },
    { id: 'u2' }, { id: 'u3' }, { id: 'u4' },
  ]; // 7 total, 2 loved
  const out = pruneVariations(v, 4); // keep 2 loved + 2 most-recent unloved (u3,u4)
  eq(out.length, 4, 'interleaved: caps at 4');
  ok(JSON.stringify(ids(out)) === JSON.stringify(['l0', 'l1', 'u3', 'u4']), 'interleaved: original order, newest unloved');
}

// ── No-op paths (≤ max) return a copy, identical contents ────────────────────
{
  const v = unlovedN(12); // exactly max
  const out = pruneVariations(v, 12);
  eq(out.length, 12, 'exactly max: no prune');
  ok(out !== v, 'returns a copy, not the same reference');
  ok(JSON.stringify(ids(out)) === JSON.stringify(ids(v)), 'exactly max: identical contents');
}
{
  const v = unlovedN(5);
  eq(pruneVariations(v, 12).length, 5, 'under max: all kept');
}
{
  eq(pruneVariations([], 12).length, 0, 'empty array: empty out');
}

// ── Robustness ───────────────────────────────────────────────────────────────
ok(Array.isArray(pruneVariations(null)) && pruneVariations(null).length === 0, 'null → []');
ok(pruneVariations(undefined).length === 0, 'undefined → []');
ok(pruneVariations('nope').length === 0, 'string → []');
{
  // all loved, over cap → all kept (loved never dropped)
  const v = lovedN(20);
  eq(pruneVariations(v, 12).length, 20, 'all loved over cap: keeps all loved');
}
{
  // all unloved, over cap → keep exactly max most-recent
  const v = unlovedN(20);
  const out = pruneVariations(v, 12);
  eq(out.length, 12, 'all unloved over cap: keeps max');
  ok(ids(out).includes('U19') && !ids(out).includes('U0'), 'all unloved: keeps newest, drops oldest');
}
{
  // default max = 12 when omitted
  const v = unlovedN(15);
  eq(pruneVariations(v).length, 12, 'default max is 12');
}

console.log(`\nprune-variations: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
