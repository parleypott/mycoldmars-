// Tests for the QSS character-card save-MERGE core (api/qss-cast.js mergeCardData).
// Imports the REAL shipped function — no mirror, can't drift.
//
// mergeCardData is the data-integrity boundary for EVERY character-card save:
// it reconciles the already-sanitized INCOMING card against the EXISTING DB row
// so a thin/partial client push can never erase Henry's accumulated portraits,
// loved flags, notes, chat history, or story appearances. Its own contract:
// "server NEVER reduces portrait count, NEVER drops visual_notes, NEVER drops
// loved flags." Historically the source of a 15-time silent-erase bug (the
// comment in the source documents it) — and it had ZERO coverage. This locks
// the contract so a regression that re-opens the silent-erase class goes RED.
import { mergeCardData } from './qss-cast.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const ids = (arr) => (arr || []).map((p) => p.id);
const has = (arr, id) => ids(arr).includes(id);

// A portrait that renders (carries bytes-or-URL).
const por = (id, extra = {}) => ({ id, image_url: `https://cdn/${id}.png`, ...extra });

// ── INLINE RED PROOF: a naive destructive merge erases existing data ─────────
// The pre-fix behavior was effectively "incoming card replaces existing" — the
// exact silent-erase the merge exists to prevent. Reconstruct it and show it
// loses the existing loved portrait + visual_notes, while mergeCardData keeps both.
function naiveMerge(card /* , existing */) { return card; }
{
  const existing = {
    portraits: [por('p_old', { loved: true, note: 'the scary one' })],
    primary_portrait_id: 'p_old',
    visual_notes: 'green dragon, scary at scale',
    synopsis: 'a real dragon',
    chat: [{ id: 'c1', ts: 1 }],
    story_appearances: [{ story_id: 's1', last_seen_at: 5 }],
    generated_at: '2026-01-01T00:00:00.000Z',
  };
  // Thin incoming push: one new portrait, no visual_notes, no synopsis.
  const incoming = { name: 'Scarlet', portraits: [por('p_new')] };

  const old = naiveMerge(incoming, existing);
  ok(!has(old.portraits, 'p_old'), 'RED proof: naive merge erases the existing loved portrait p_old');
  ok(!old.visual_notes, 'RED proof: naive merge drops visual_notes');

  const merged = mergeCardData(incoming, existing);
  ok(has(merged.portraits, 'p_old'), 'GREEN: mergeCardData keeps the existing loved portrait p_old');
  ok(has(merged.portraits, 'p_new'), 'GREEN: mergeCardData adds the new portrait p_new');
  eq(merged.visual_notes, 'green dragon, scary at scale', 'GREEN: keeps existing visual_notes on empty incoming');
  eq(merged.synopsis, 'a real dragon', 'GREEN: keeps existing synopsis on empty incoming');
}

// ── no existing row → incoming returned verbatim ─────────────────────────────
{
  const card = { name: 'Newbie', portraits: [por('x')] };
  ok(mergeCardData(card, null) === card, 'no existing → returns incoming card by reference');
  ok(mergeCardData(card, undefined) === card, 'undefined existing → returns incoming');
}

// ── portrait union: existing preserved + incoming added (count never reduced) ─
{
  const existing = { portraits: [por('a'), por('b'), por('c')] };
  const incoming = { name: 'N', portraits: [por('d')] };
  const m = mergeCardData(incoming, existing);
  eq(m.portraits.length, 4, 'union keeps all existing + adds incoming (never reduces)');
  ok(['a', 'b', 'c', 'd'].every((id) => has(m.portraits, id)), 'all four ids present');
}

// ── same id on both sides: existing bytes preserved, incoming refreshes meta ──
{
  const existing = { portraits: [por('a', { loved: true, note: 'keep', storage_path: 'store/a' })] };
  const incoming = {
    name: 'N',
    // incoming for 'a' carries DIFFERENT (newer) inline bytes + un-loves + new note.
    portraits: [{ id: 'a', dataBase64: 'AAAA', loved: false, note: 'new note', generated_at: 999 }],
  };
  const m = mergeCardData(incoming, existing);
  const a = m.portraits.find((p) => p.id === 'a');
  eq(a.image_url, 'https://cdn/a.png', 'existing server bytes (image_url) win over incoming inline');
  eq(a.storage_path, 'store/a', 'existing storage_path preserved');
  eq(a.dataBase64, '', 'inline bytes dropped when existing has image_url');
  eq(a.loved, false, 'incoming boolean loved refreshes (false honored)');
  eq(a.note, 'new note', 'incoming non-empty note refreshes');
  eq(a.generated_at, 999, 'incoming numeric generated_at refreshes');
}

// ── loved flag is never silently lost when incoming omits it ─────────────────
{
  const existing = { portraits: [por('a', { loved: true, note: 'cherished' })] };
  // incoming refreshes 'a' but omits loved + note entirely.
  const incoming = { name: 'N', portraits: [{ id: 'a', image_url: 'https://cdn/a2.png' }] };
  const m = mergeCardData(incoming, existing);
  const a = m.portraits.find((p) => p.id === 'a');
  eq(a.loved, true, 'existing loved=true preserved when incoming omits loved');
  eq(a.note, 'cherished', 'existing note preserved when incoming omits note');
}

// ── orphan portraits (no bytes, no url) are dropped ──────────────────────────
{
  // New incoming orphan id → dropped. Existing orphan → filtered out at the end.
  const existing = { portraits: [{ id: 'ghost' }, por('real')] };
  const incoming = { name: 'N', portraits: [{ id: 'orphan_in' }, por('fresh')] };
  const m = mergeCardData(incoming, existing);
  ok(!has(m.portraits, 'ghost'), 'existing orphan (no bytes) dropped');
  ok(!has(m.portraits, 'orphan_in'), 'incoming new orphan (no bytes) dropped');
  ok(has(m.portraits, 'real') && has(m.portraits, 'fresh'), 'real portraits kept');
  eq(m.portraits.length, 2, 'only the two real portraits survive');
}

// ── primary: incoming valid > existing valid > last in merged ────────────────
{
  // incoming primary valid → wins.
  let m = mergeCardData(
    { name: 'N', primary_portrait_id: 'b', portraits: [por('b')] },
    { portraits: [por('a')], primary_portrait_id: 'a' },
  );
  eq(m.primary_portrait_id, 'b', 'incoming primary wins when valid');

  // incoming primary points at a dropped/absent id → fall back to existing valid.
  m = mergeCardData(
    { name: 'N', primary_portrait_id: 'gone', portraits: [] },
    { portraits: [por('a')], primary_portrait_id: 'a' },
  );
  eq(m.primary_portrait_id, 'a', 'falls back to existing primary when incoming invalid');

  // neither valid → last in merged.
  m = mergeCardData(
    { name: 'N', primary_portrait_id: 'gone', portraits: [por('x'), por('y')] },
    { portraits: [], primary_portrait_id: 'also-gone' },
  );
  eq(m.primary_portrait_id, 'y', 'neither valid → last portrait in merged set');

  // no portraits at all → null.
  m = mergeCardData({ name: 'N', portraits: [] }, { portraits: [] });
  eq(m.primary_portrait_id, null, 'no portraits → null primary');
}

// ── chat: union by id, sorted ascending by ts, capped at 200 ─────────────────
{
  const existing = { chat: [{ id: 'c1', ts: 10 }, { id: 'c2', ts: 30 }] };
  const incoming = { name: 'N', chat: [{ id: 'c3', ts: 20 }, { id: 'c2', ts: 99 }] };
  const m = mergeCardData(incoming, existing);
  eq(m.chat.length, 3, 'chat union dedups by id (c2 once)');
  eq(m.chat.map((x) => x.id).join(','), 'c1,c3,c2', 'chat sorted ascending by ts');

  // > 200 messages → capped to last 200 (most recent by ts).
  const many = Array.from({ length: 250 }, (_, i) => ({ id: 'm' + i, ts: i }));
  const big = mergeCardData({ name: 'N', chat: many }, { chat: [] });
  eq(big.chat.length, 200, 'chat capped at 200');
  eq(big.chat[big.chat.length - 1].id, 'm249', 'newest message survives the cap');
  eq(big.chat[0].id, 'm50', 'oldest 50 dropped by the cap');
}

// ── story_appearances: union by story_id, most-recent last_seen_at wins (tie → incoming) ─
{
  const existing = { story_appearances: [{ story_id: 's1', last_seen_at: 5, who: 'old' }] };
  // incoming s1 newer → wins; incoming tie should also win (>=); s2 new.
  const incoming = {
    name: 'N',
    story_appearances: [{ story_id: 's1', last_seen_at: 7, who: 'new' }, { story_id: 's2', last_seen_at: 1, who: 'new2' }],
  };
  const m = mergeCardData(incoming, existing);
  eq(m.story_appearances.length, 2, 'apps union by story_id');
  eq(m.story_appearances.find((a) => a.story_id === 's1').who, 'new', 'newer last_seen_at wins for s1');

  // older incoming should NOT overwrite a newer existing.
  const m2 = mergeCardData(
    { name: 'N', story_appearances: [{ story_id: 's1', last_seen_at: 2, who: 'stale' }] },
    { story_appearances: [{ story_id: 's1', last_seen_at: 9, who: 'fresh' }] },
  );
  eq(m2.story_appearances.find((a) => a.story_id === 's1').who, 'fresh', 'older incoming does NOT clobber newer existing');

  // tie → incoming wins (>=).
  const m3 = mergeCardData(
    { name: 'N', story_appearances: [{ story_id: 's1', last_seen_at: 5, who: 'incoming' }] },
    { story_appearances: [{ story_id: 's1', last_seen_at: 5, who: 'existing' }] },
  );
  eq(m3.story_appearances.find((a) => a.story_id === 's1').who, 'incoming', 'tie → incoming wins');
}

// ── visual_notes / synopsis: incoming non-empty wins, else existing preserved ─
{
  // incoming non-empty → wins.
  let m = mergeCardData(
    { name: 'N', visual_notes: 'new notes', synopsis: 'new syn', portraits: [] },
    { visual_notes: 'old notes', synopsis: 'old syn', portraits: [] },
  );
  eq(m.visual_notes, 'new notes', 'incoming visual_notes wins when non-empty');
  eq(m.synopsis, 'new syn', 'incoming synopsis wins when non-empty');

  // incoming empty → existing preserved (the never-drop contract).
  m = mergeCardData(
    { name: 'N', visual_notes: '', synopsis: '', portraits: [] },
    { visual_notes: 'old notes', synopsis: 'old syn', portraits: [] },
  );
  eq(m.visual_notes, 'old notes', 'empty incoming visual_notes → keep existing');
  eq(m.synopsis, 'old syn', 'empty incoming synopsis → keep existing');
}

// ── generated_at: max(incoming numeric, existing-as-epoch) ───────────────────
{
  // existing is an ISO string; incoming is a smaller number → existing (newer) wins.
  let m = mergeCardData(
    { name: 'N', generated_at: 1000, portraits: [] },
    { generated_at: '2026-06-01T00:00:00.000Z', portraits: [] },
  );
  const existingMs = new Date('2026-06-01T00:00:00.000Z').getTime();
  eq(m.generated_at, existingMs, 'newer existing timestamp wins over smaller incoming');

  // incoming larger number wins.
  m = mergeCardData(
    { name: 'N', generated_at: existingMs + 5000, portraits: [] },
    { generated_at: '2026-06-01T00:00:00.000Z', portraits: [] },
  );
  eq(m.generated_at, existingMs + 5000, 'larger incoming timestamp wins');

  // neither carries one → falls back to a positive Date.now()-ish number.
  m = mergeCardData({ name: 'N', portraits: [] }, { portraits: [] });
  ok(typeof m.generated_at === 'number' && m.generated_at > 0, 'no timestamp on either side → positive fallback');
}

// ── robustness: non-array fields on either side never throw ───────────────────
{
  const m = mergeCardData(
    { name: 'N', portraits: null, chat: null, story_appearances: null },
    { portraits: undefined, chat: 'nope', story_appearances: 42 },
  );
  eq(m.portraits.length, 0, 'non-array portraits → empty, no throw');
  eq(m.chat.length, 0, 'non-array chat → empty, no throw');
  eq(m.story_appearances.length, 0, 'non-array story_appearances → empty, no throw');
}

if (fail === 0) console.log(`qss-cast-merge: ${pass} passed, 0 failed`);
else { console.error(`qss-cast-merge: ${fail} FAILED, ${pass} passed`); process.exit(1); }
