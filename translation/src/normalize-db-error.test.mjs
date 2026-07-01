// Mutation-lock for normalizeError — the Supabase/PG error classifier every
// db.js write/read throws through. See ./normalize-db-error.js for why each
// branch is load-bearing.
//
// Run: node translation/src/normalize-db-error.test.mjs
import { normalizeError } from './normalize-db-error.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ---- falsy error never crashes the thrower ----
for (const bad of [null, undefined, 0, '', false, NaN]) {
  const e = normalizeError(bad, 'ctx');
  ok(e instanceof Error, `falsy(${String(bad)}) → Error`);
  eq(e.message, 'Unknown error', `falsy(${String(bad)}) → generic message`);
  eq(e.code, undefined, `falsy(${String(bad)}) → no .code`);
}

// ---- 23505 unique-constraint → CONSTRAINT ----
{
  const e = normalizeError({ code: '23505', message: 'dup key', details: 'Key (slug)' }, 'createTag');
  eq(e.code, 'CONSTRAINT', '23505 → code CONSTRAINT');
  eq(e.context, 'createTag', '23505 → context carried');
  eq(e.message, 'Already exists: dup key', '23505 → "Already exists: <message>"');
  ok(e instanceof Error, '23505 → Error instance');
}
{
  // message absent → falls back to details
  const e = normalizeError({ code: '23505', details: 'Key (name)=(x) exists' }, 'createProject');
  eq(e.message, 'Already exists: Key (name)=(x) exists', '23505 → falls back to details when no message');
  eq(e.code, 'CONSTRAINT', '23505 (details-only) → CONSTRAINT');
}
{
  // neither message nor details → trailing empty
  const e = normalizeError({ code: '23505' }, 'op');
  eq(e.message, 'Already exists: ', '23505 → empty tail when no message/details');
  eq(e.code, 'CONSTRAINT', '23505 (bare) → CONSTRAINT');
}

// ---- PGRST116 no-rows → NOT_FOUND ----
{
  const e = normalizeError({ code: 'PGRST116', message: 'JSON object requested, 0 rows' }, 'getTranscript');
  eq(e.code, 'NOT_FOUND', 'PGRST116 → code NOT_FOUND');
  eq(e.message, 'getTranscript: not found', 'PGRST116 → "<context>: not found"');
}
{
  // no context → bare "Not found"
  const e = normalizeError({ code: 'PGRST116' });
  eq(e.message, 'Not found', 'PGRST116 (no context) → "Not found"');
  eq(e.code, 'NOT_FOUND', 'PGRST116 (no context) → NOT_FOUND');
}

// ---- passthrough: any other coded error keeps message + code ----
{
  const e = normalizeError({ code: '42501', message: 'permission denied for table x' }, 'listTags');
  eq(e.message, 'permission denied for table x', 'other → keeps raw message');
  eq(e.code, '42501', 'other → passes .code through unchanged (callers may branch on it)');
}
{
  // message absent → String(err) fallback
  const weird = { code: 'XX000' };
  const e = normalizeError(weird, 'op');
  eq(e.message, String(weird), 'other w/o message → String(err) fallback');
  eq(e.code, 'XX000', 'other w/o message → code still passed through');
}
{
  // uncoded error (plain throw) → message kept, code undefined
  const e = normalizeError({ message: 'network down' }, 'sync');
  eq(e.message, 'network down', 'uncoded → keeps message');
  eq(e.code, undefined, 'uncoded → code undefined');
}

// ---- MUTATION PROOFS (each documents a regression this lock catches) ----
// M1: if the 23505 branch were dropped, a dup would fall through to passthrough
//     → message would be the raw "dup key" and code would be '23505', NOT
//     'Already exists: …' / 'CONSTRAINT'. Assert the classified form.
{
  const e = normalizeError({ code: '23505', message: 'dup key' }, 'x');
  ok(e.code === 'CONSTRAINT' && e.message.startsWith('Already exists:'),
    'M1: dup is CLASSIFIED (not raw passthrough) — drop the 23505 branch → RED');
}
// M2: if the PGRST116 branch were dropped, an empty .single() would surface as
//     the raw PostgREST string with code 'PGRST116' instead of a NOT_FOUND miss.
{
  const e = normalizeError({ code: 'PGRST116', message: 'raw pgrst' }, 'get');
  ok(e.code === 'NOT_FOUND' && e.message === 'get: not found',
    'M2: empty single() is a NOT_FOUND miss (not raw) — drop the branch → RED');
}
// M3: passthrough must PRESERVE .code — if it stopped copying err.code, caller
//     branching (e.g. retry on a specific PG code) would break.
{
  const e = normalizeError({ code: '40001', message: 'serialization failure' });
  ok(e.code === '40001', 'M3: passthrough preserves .code — stop copying it → RED');
}

console.log(`normalize-db-error: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
