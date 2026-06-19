// Tests for the QSS character-card save sanitizer (api/qss-cast.js sanitizeCard)
// and its reference-safe loved-aware portrait cap (api/_lib/cap-loved.js).
// Imports the REAL shipped functions — no mirror, can't drift.
//
// Headline bug it locks: sanitizeCard capped portraits with a plain
// `.slice(-MAX_PORTRAITS)` (newest 10 by insertion order), so a LOVED portrait
// sitting among the oldest in a >10-portrait card was silently dropped on the
// next save — the same loved-item-eaten-by-a-naive-cap class fixed for scene
// variations in prune-variations (commit f60ce17). The fix routes the cap
// through capLovedAware, which keeps every loved portrait + the most-recent
// unloved up to the cap.
import { capLovedAware } from './_lib/cap-loved.js';
import { sanitizeCard } from './qss-cast.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const ids = (arr) => arr.map((p) => p.id);

// ── INLINE RED PROOF: the OLD cap dropped a loved-but-old portrait ───────────
// Reconstruct the old `.slice(-MAX)` and show it loses the loved oldest one.
function oldCap(items, max) {
  return items.slice(-max);
}
{
  const portraits = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, loved: i === 0 }));
  const oldKept = ids(oldCap(portraits, 10));
  ok(!oldKept.includes('p0'), 'RED proof: old slice(-10) drops the loved oldest portrait p0');
  const newKept = ids(capLovedAware(portraits, 10));
  ok(newKept.includes('p0'), 'GREEN: capLovedAware keeps the loved oldest portrait p0');
}

// ── capLovedAware unit behavior ──────────────────────────────────────────────
{
  // ≤ max → returns a copy, unchanged order, all kept.
  const items = [{ id: 'a' }, { id: 'b', loved: true }, { id: 'c' }];
  const out = capLovedAware(items, 10);
  eq(out.length, 3, 'under cap keeps all');
  ok(out !== items, 'under cap returns a new array (copy)');
  eq(ids(out).join(','), 'a,b,c', 'under cap preserves order');
}
{
  // Over cap: keep every loved + most-recent unloved, drop oldest unloved, keep order.
  const items = [
    { id: 'u0' }, { id: 'u1' }, { id: 'L', loved: true }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' },
  ];
  const out = capLovedAware(items, 4); // loved=1, keepUnloved=3 → drop oldest 2 unloved (u0,u1)
  eq(out.length, 4, 'over cap trims to max');
  eq(ids(out).join(','), 'L,u2,u3,u4', 'keeps loved + 3 most-recent unloved, in original order');
  ok(!ids(out).includes('u0') && !ids(out).includes('u1'), 'drops the two oldest unloved');
}
{
  // loved.length >= max → keep ALL loved (may exceed max), no unloved. slice(-0) guard.
  const items = [
    { id: 'L0', loved: true }, { id: 'L1', loved: true }, { id: 'L2', loved: true },
    { id: 'u0' }, { id: 'u1' },
  ];
  const out = capLovedAware(items, 2);
  eq(ids(out).join(','), 'L0,L1,L2', 'all loved survive even past max; zero unloved (no slice(-0) leak)');
}
{
  // Reference identity: duplicate AND missing ids must still cap correctly.
  const dup = { id: 'same' };
  const items = [{ id: 'same' }, dup, { id: 'same', loved: true }, {}, {}, {}];
  const out = capLovedAware(items, 3); // 1 loved + 2 most-recent unloved
  eq(out.length, 3, 'caps to max even with duplicate/missing ids (reference-keyed)');
  ok(out.includes(items[2]), 'the loved duplicate-id item is kept');
  ok(out.includes(items[5]) && out.includes(items[4]), 'two most-recent (missing-id) unloved kept');
}
{
  // Robustness: non-array / bad max.
  eq(capLovedAware(null, 5).length, 0, 'non-array → []');
  eq(capLovedAware([{ id: 'a' }], 0).length, 0, 'max 0 → []');
  eq(capLovedAware([{ id: 'a' }], -3).length, 0, 'negative max → []');
}

// ── sanitizeCard integration ─────────────────────────────────────────────────
const mkPortraits = (n, lovedIdx) =>
  Array.from({ length: n }, (_, i) => ({ id: 'p' + i, image_url: 'https://x/' + i + '.png', loved: i === lovedIdx }));

{
  // THE FIX: loved oldest portrait survives a >10-portrait card.
  const card = sanitizeCard({ name: 'Scarlet', portraits: mkPortraits(12, 0) });
  eq(card.portraits.length, 10, 'card capped to 10 portraits');
  ok(ids(card.portraits).includes('p0'), 'loved oldest portrait p0 survives the cap');
  ok(!ids(card.portraits).includes('p1') && !ids(card.portraits).includes('p2'), 'oldest unloved p1,p2 dropped');
  ok(ids(card.portraits).includes('p11'), 'newest portrait still kept');
}
{
  // Common path: ≤10 portraits, none over cap → all kept, order preserved.
  const card = sanitizeCard({ name: 'Kevin', portraits: mkPortraits(5, 2) });
  eq(card.portraits.length, 5, '≤10 portraits all kept');
  eq(ids(card.portraits).join(','), 'p0,p1,p2,p3,p4', 'order preserved on the common path');
}
{
  // Primary selection still works after a loved-aware cap.
  const portraits = mkPortraits(12, 0);
  // request the loved oldest as primary — it survives, so it must remain primary.
  const card = sanitizeCard({ name: 'Scarlet', portraits, primary_portrait_id: 'p0' });
  eq(card.primary_portrait_id, 'p0', 'surviving loved portrait stays the requested primary');
  // request a dropped portrait as primary → falls back to the last kept.
  const card2 = sanitizeCard({ name: 'Scarlet', portraits, primary_portrait_id: 'p1' });
  eq(card2.primary_portrait_id, card2.portraits[card2.portraits.length - 1].id,
    'primary pointing at a dropped portrait falls back to the last kept');
}
{
  // Portraits with neither bytes nor url are dropped (orphan-metadata guard) — unchanged.
  const card = sanitizeCard({ name: 'X', portraits: [{ id: 'good', image_url: 'https://x/a.png' }, { id: 'orphan' }] });
  eq(card.portraits.length, 1, 'orphan portrait (no bytes, no url) dropped');
  eq(card.portraits[0].id, 'good', 'the portrait carrying a url is kept');
}
{
  // Oversize inline base64 dropped — unchanged guard, but must still cap-interact cleanly.
  const big = 'A'.repeat(3 * 1024 * 1024 * 1.4 + 10);
  const card = sanitizeCard({ name: 'X', portraits: [{ id: 'huge', dataBase64: big }, { id: 'ok', image_url: 'https://x/a.png' }] });
  eq(card.portraits.length, 1, 'oversize portrait dropped');
  eq(card.portraits[0].id, 'ok', 'the in-budget portrait survives');
}
{
  // Name is required; non-object → null.
  ok(sanitizeCard({ portraits: [] }) === null, 'missing name → null');
  ok(sanitizeCard(null) === null, 'null card → null');
  ok(sanitizeCard('nope') === null, 'non-object card → null');
}
{
  // No portraits at all → empty list, null primary, no throw.
  const card = sanitizeCard({ name: 'Empty' });
  eq(card.portraits.length, 0, 'no portraits → empty');
  eq(card.primary_portrait_id, null, 'no portraits → null primary');
}

if (fail === 0) console.log(`qss-cast-sanitize: ${pass} passed, 0 failed`);
else { console.error(`qss-cast-sanitize: ${fail} FAILED, ${pass} passed`); process.exit(1); }
