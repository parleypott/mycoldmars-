// Tests for the QSS STORY-SAVE character-card sanitizer
// (api/qss-stories.js sanitizeCharacterCards). Imports the REAL shipped
// function — no mirror, can't drift.
//
// Headline bug it locks: sanitizeCharacterCards capped each card's portraits
// with a plain `.slice(-MAX_PORTRAITS_PER_CARD)` (newest 10 by insertion
// order), blind to the `loved` flag every portrait carries. So a LOVED
// portrait among the OLDEST in a >10-portrait card was silently dropped on the
// next STORY save. This is a divergent copy of the exact bug fixed in
// qss-cast's sanitizeCard (commit 5bc471d) — the per-world cast endpoint was
// fixed, but this story-row persistence path (handleSave -> sanitizeCharacterCards,
// character_cards column) kept the naive slice. The fix routes the count cap
// through capLovedAware (keep every loved + most-recent unloved up to the cap).
import { sanitizeCharacterCards } from './qss-stories.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

const B64 = 'QQ'.repeat(40); // tiny, well within MAX_IMAGE_BYTES / total budget
const idsOf = (card) => card.portraits.map((p) => p.id);
const card = (overrides = {}) => ({ name: 'Sparkle', ...overrides });

// ── INLINE RED PROOF: the OLD cap dropped a loved-but-old portrait ───────────
// Reconstruct the old `.slice(-MAX_PORTRAITS_PER_CARD)` and show it loses the
// loved oldest one, while the shipped sanitizeCharacterCards keeps it.
function oldSlice(items, max) { return items.slice(-max); }
{
  const portraits = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, dataBase64: B64, loved: i === 0 }));
  const oldKept = oldSlice(portraits, 10).map((p) => p.id);
  ok(!oldKept.includes('p0'), 'RED proof: old slice(-10) drops the loved oldest portrait p0');

  const out = sanitizeCharacterCards([card({ portraits })]);
  const kept = idsOf(out[0]);
  ok(kept.includes('p0'), 'FIX: loved oldest portrait p0 survives the count cap');
  eq(kept.length, 10, 'FIX: exactly 10 portraits kept (the cap)');
  // keep p0 (loved) + the 9 most-recent unloved (p3..p11); drop oldest unloved p1,p2
  ok(!kept.includes('p1') && !kept.includes('p2'), 'FIX: oldest UNLOVED p1,p2 dropped first');
  ok(['p3','p4','p5','p6','p7','p8','p9','p10','p11'].every((id) => kept.includes(id)),
     'FIX: the 9 most-recent unloved all kept');
}

// ── Multiple loved scattered through the history all survive ─────────────────
{
  const portraits = Array.from({ length: 15 }, (_, i) => ({
    id: 'p' + i, dataBase64: B64, loved: i === 0 || i === 1 || i === 7,
  }));
  const out = sanitizeCharacterCards([card({ portraits })]);
  const kept = idsOf(out[0]);
  eq(kept.length, 10, 'multi-loved: cap respected');
  ok(kept.includes('p0') && kept.includes('p1') && kept.includes('p7'),
     'multi-loved: all 3 scattered loved portraits survive');
  // 3 loved + 7 most-recent unloved (p8..p14) = 10
  ok(['p8','p9','p10','p11','p12','p13','p14'].every((id) => kept.includes(id)),
     'multi-loved: 7 most-recent unloved kept');
}

// ── Under the cap: order preserved, nothing dropped ──────────────────────────
{
  const portraits = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, dataBase64: B64, loved: false }));
  const out = sanitizeCharacterCards([card({ portraits })]);
  eq(idsOf(out[0]).join(','), 'p0,p1,p2,p3,p4', 'under cap: all kept in order');
}

// ── All loved beyond the cap: every loved survives (matches variations policy) ─
{
  const portraits = Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, dataBase64: B64, loved: true }));
  const out = sanitizeCharacterCards([card({ portraits })]);
  const kept = idsOf(out[0]);
  eq(kept.length, 13, 'all-loved: every loved portrait survives even beyond cap');
}

// ── Loved flag is preserved through sanitize ─────────────────────────────────
{
  const portraits = [
    { id: 'a', dataBase64: B64, loved: true },
    { id: 'b', dataBase64: B64, loved: false },
  ];
  const out = sanitizeCharacterCards([card({ portraits })]);
  const a = out[0].portraits.find((p) => p.id === 'a');
  const b = out[0].portraits.find((p) => p.id === 'b');
  ok(a && a.loved === true, 'loved:true preserved');
  ok(b && b.loved === false, 'loved:false preserved');
}

// ── Per-image byte cap still drops an oversize portrait (loved or not) ────────
// The count cap is loved-aware, but the hard byte budget is a separate, real
// constraint — an oversize portrait can't be persisted regardless.
{
  const huge = 'Q'.repeat(600 * 1024 + 10); // > MAX_IMAGE_BYTES (600 KB)
  const portraits = [
    { id: 'ok', dataBase64: B64, loved: false },
    { id: 'huge', dataBase64: huge, loved: true },
  ];
  const out = sanitizeCharacterCards([card({ portraits })]);
  const kept = idsOf(out[0]);
  ok(kept.includes('ok'), 'byte cap: normal portrait kept');
  ok(!kept.includes('huge'), 'byte cap: oversize portrait dropped (hard constraint, separate from count cap)');
}

// ── Non-array / missing portraits → empty list, no throw ─────────────────────
{
  const out1 = sanitizeCharacterCards([card({ portraits: undefined })]);
  eq(out1[0].portraits.length, 0, 'missing portraits → empty');
  const out2 = sanitizeCharacterCards([card({ portraits: 'nope' })]);
  eq(out2[0].portraits.length, 0, 'non-array portraits → empty');
  const out3 = sanitizeCharacterCards([card({ portraits: [null, 7, { id: 'real', dataBase64: B64 }] })]);
  eq(idsOf(out3[0]).join(','), 'real', 'junk entries filtered, real kept');
}

// ── Name required (sanity that we still exercise the real function path) ──────
{
  const out = sanitizeCharacterCards([{ name: '', portraits: [{ id: 'x', dataBase64: B64 }] }]);
  eq(out.length, 0, 'card with no name is dropped');
}

console.log(`\nqss-stories-sanitize: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
