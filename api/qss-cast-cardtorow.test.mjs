// First coverage on cardToRow — the SAVE serializer that turns an in-memory
// QSS character card into the Supabase row (api/qss-cast.js). Imports the REAL
// shipped function — no mirror, can't drift.
//
// Headline fragility it locks: cardToRow stamps the row's `generated_at` by
// calling `new Date(card.generated_at).toISOString()`. That was the LONE
// unguarded generated_at access in the whole file — every sibling (line ~546,
// sanitizeCard @527, rowToCard @580) guards `typeof === 'number'`. A card whose
// generated_at is undefined / NaN / a bad string makes `new Date(...)
// .toISOString()` throw "Invalid time value" (RangeError), which 500s the
// upsert and silently loses Henry's save. Current callers always pre-sanitize,
// so it can't fire today — but the inconsistency is a save-losing landmine for
// any future caller. The fix coerces to a finite epoch, else stamps Date.now().
import { cardToRow } from './qss-cast.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }
function isISO(s) { return typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(s); }

// ── RED PROOF: the OLD unguarded form threw on a non-numeric timestamp ───────
function oldCardToRow(card) {
  // The exact pre-fix expression.
  return { generated_at: new Date(card.generated_at).toISOString() };
}
// (null coerces to a valid Date — epoch 0 / 1970 — so it doesn't throw; the
//  throwing inputs are undefined / NaN / unparseable string / object / Infinity.)
for (const bad of [undefined, NaN, 'not-a-date', {}]) {
  let threw = false;
  try { oldCardToRow({ name: 'Scarlet', generated_at: bad }); } catch { threw = true; }
  ok(threw, `RED proof: old unguarded form throws on generated_at=${JSON.stringify(bad)}`);
}

// ── GREEN: the shipped cardToRow never throws and always emits a valid ISO ────
for (const bad of [undefined, NaN, null, 'not-a-date', {}, [], Infinity, -Infinity]) {
  let row, threw = false;
  try { row = cardToRow({ name: 'Scarlet', portraits: [], generated_at: bad }); }
  catch { threw = true; }
  ok(!threw, `cardToRow tolerates generated_at=${JSON.stringify(bad)} without throwing`);
  ok(row && isISO(row.generated_at), `cardToRow emits a valid ISO for generated_at=${JSON.stringify(bad)}`);
}

// ── A real numeric timestamp is preserved exactly (round-trips through ISO) ───
{
  const ms = 1_700_000_000_000; // fixed epoch — Date.now() not used (deterministic)
  const row = cardToRow({ name: 'Scarlet', portraits: [], generated_at: ms });
  ok(row.generated_at === new Date(ms).toISOString(), 'cardToRow preserves a valid numeric generated_at');
}

// ── Sanity: cardToRow carries the identity fields through ─────────────────────
{
  const row = cardToRow({ name: 'Henry', synopsis: 'a boy', portraits: [], generated_at: 1 });
  ok(row.name === 'Henry', 'cardToRow carries name');
  ok(row.name_key === 'henry', 'cardToRow lowercases name_key');
  ok(row.synopsis === 'a boy', 'cardToRow carries synopsis');
  ok(Array.isArray(row.portraits), 'cardToRow emits a portraits array');
}

console.log(`\nqss-cast-cardtorow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
