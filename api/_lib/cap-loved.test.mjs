// Lock for capLovedAware — the loved-aware cap that decides which of Henry's
// character portraits survive a save. Used by TWO Henry-facing save paths:
// api/qss-cast.js (sanitizeCard) and api/qss-stories.js (story save). It was
// shipped with a documented bug history but NO test, so the contract below
// (never drop a loved portrait; the slice(-0) trap; keep-most-recent-unloved;
// reference identity, never id) could be silently broken by a refactor.
//
// Imports the REAL shipped fn — no mirror, can't drift.
import { capLovedAware } from './cap-loved.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);
const names = (arr) => arr.map((x) => (x && x.n) ?? null).join(',');

// ── Guards: non-array / non-positive max → [] ──────────────────────────────
eq(JSON.stringify(capLovedAware(null, 5)), '[]', 'null items → []');
eq(JSON.stringify(capLovedAware(undefined, 5)), '[]', 'undefined items → []');
eq(JSON.stringify(capLovedAware('nope', 5)), '[]', 'non-array items → []');
eq(JSON.stringify(capLovedAware([{ n: 1 }], 0)), '[]', 'max 0 → []');
eq(JSON.stringify(capLovedAware([{ n: 1 }], -3)), '[]', 'negative max → []');
eq(JSON.stringify(capLovedAware([{ n: 1 }], NaN)), '[]', 'NaN max → []');

// ── Under cap: returns a COPY of all items, same order ──────────────────────
{
  const items = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const out = capLovedAware(items, 5);
  eq(names(out), '1,2,3', 'under cap keeps all in order');
  ok(out !== items, 'under cap returns a fresh array (not the same ref)');
  eq(out.length, 3, 'under cap length unchanged');
}

// ── CORE CONTRACT: an OLD loved item is never dropped by the cap ────────────
// 'a' is the oldest AND loved; the cap must keep it and top up with the most
// recent unloved (d,e), dropping the oldest unloved (b,c).
{
  const items = [
    { n: 'a', loved: true },
    { n: 'b' }, { n: 'c' }, { n: 'd' }, { n: 'e' },
  ];
  const out = capLovedAware(items, 3);
  eq(names(out), 'a,d,e', 'keeps oldest loved + 2 most-recent unloved, in order');
  ok(out.some((x) => x.n === 'a'), 'the oldest LOVED portrait survives (the bug class)');

  // RED proof: the old naive cap (items.slice(-max)) eats the loved 'a'.
  const naive = items.slice(-3);
  ok(!naive.some((x) => x.n === 'a'),
    'RED proof: naive slice(-max) DROPS the oldest loved portrait');
}

// ── slice(-0) trap: when loved.length === max, keep ZERO unloved (not all) ──
// keepUnlovedCount = max(0, max - loved.length) = 0. A buggy `unloved.slice(-0)`
// returns the WHOLE unloved array, blowing the cap wide open.
{
  const x = { n: 'x', loved: true };
  const y = { n: 'y', loved: true };
  const items = [{ n: 'u1' }, x, { n: 'u2' }, y, { n: 'u3' }];
  const out = capLovedAware(items, 2);
  eq(names(out), 'x,y', 'loved fills the cap exactly → no unloved kept');
  eq(out.length, 2, 'slice(-0) guard holds: exactly max, not the whole list');

  // RED proof: reconstruct the buggy slice(-0) form and show it leaks everything.
  const loved = items.filter((it) => it && it.loved);
  const unloved = items.filter((it) => !(it && it.loved));
  const keepUnlovedCount = Math.max(0, 2 - loved.length); // === 0
  const buggyKept = unloved.slice(-keepUnlovedCount); // slice(-0) === whole array
  eq(buggyKept.length, 3, 'RED proof: slice(-0) returns the WHOLE unloved list');
}

// ── Loved overflow: more loved than max → keep ALL loved (may exceed max) ───
// Spec is explicit: NEVER drop a loved portrait, even past the count cap.
{
  const items = [
    { n: 1, loved: true }, { n: 2, loved: true }, { n: 3, loved: true },
  ];
  const out = capLovedAware(items, 2);
  eq(names(out), '1,2,3', 'all loved kept even though that exceeds max');
  eq(out.length, 3, 'loved overflow returns more than max (never drops a loved)');
}

// ── Reference identity, NEVER id: an id collision must not collapse items ───
// p1 (loved) and p2 (unloved) share the SAME id 'dup'. A naive id-based merge
// would collapse them; capLovedAware keeps by reference, so the LOVED one
// survives and its unloved id-twin is dropped as the oldest unloved.
{
  const p1 = { n: 'p1', id: 'dup', loved: true };
  const p2 = { n: 'p2', id: 'dup' };
  const p3 = { n: 'p3', id: 'other' };
  const out = capLovedAware([p1, p2, p3], 2);
  ok(out.includes(p1), 'loved item kept by reference despite shared id');
  ok(!out.includes(p2), 'its unloved id-twin dropped (oldest unloved), not merged');
  ok(out.includes(p3), 'most-recent unloved kept');
  eq(out.length, 2, 'capped to max with id collisions present');
}

// ── Garbage entries (null / non-object) are treated as unloved, never crash ─
{
  const live = { n: 'keep', loved: true };
  const out = capLovedAware([null, live, undefined, { n: 'recent' }], 2);
  ok(!out.includes(null) || out.includes(live), 'does not crash on null entries');
  ok(out.includes(live), 'loved item still kept among garbage');
  eq(out.length, 2, 'garbage counted but cap still honored');
}

console.log(`\ncap-loved: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
