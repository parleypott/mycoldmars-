// Mutation-lock + TWIN-LOCK for the Hunter's normalizeError — the Supabase/PG
// error classifier every hunter/src/db.js write/read throws through. See
// ./normalize-db-error.js for why each branch is load-bearing.
//
// This copy is a VERBATIM twin of the Interpreter's translation/src/normalize-db-error.js.
// Two locks here:
//   1. Behaviour lock (M1-M3 + branch coverage) — proves each classification branch
//      is live; neuter any branch and the run goes RED.
//   2. TWIN lock — reads BOTH source files, extracts the normalizeError body, strips
//      comments/whitespace, and asserts they're byte-identical. The day someone
//      hardens one copy (a new PG code, a changed message) without the other, this
//      goes RED — closing the divergent-copy landmine for good.
//
// Run: node hunter/src/normalize-db-error.test.mjs
import { normalizeError } from './normalize-db-error.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  const e = normalizeError({ code: '23505', message: 'dup key', details: 'Key (slug)' }, 'createProject');
  eq(e.code, 'CONSTRAINT', '23505 → code CONSTRAINT');
  eq(e.context, 'createProject', '23505 → context carried');
  eq(e.message, 'Already exists: dup key', '23505 → "Already exists: <message>"');
  ok(e instanceof Error, '23505 → Error instance');
}
{
  const e = normalizeError({ code: '23505', details: 'Key (name)=(x) exists' }, 'createProject');
  eq(e.message, 'Already exists: Key (name)=(x) exists', '23505 → falls back to details when no message');
  eq(e.code, 'CONSTRAINT', '23505 (details-only) → CONSTRAINT');
}
{
  const e = normalizeError({ code: '23505' }, 'op');
  eq(e.message, 'Already exists: ', '23505 → empty tail when no message/details');
  eq(e.code, 'CONSTRAINT', '23505 (bare) → CONSTRAINT');
}

// ---- PGRST116 no-rows → NOT_FOUND ----
{
  const e = normalizeError({ code: 'PGRST116', message: 'JSON object requested, 0 rows' }, 'getProject');
  eq(e.code, 'NOT_FOUND', 'PGRST116 → code NOT_FOUND');
  eq(e.message, 'getProject: not found', 'PGRST116 → "<context>: not found"');
}
{
  const e = normalizeError({ code: 'PGRST116' });
  eq(e.message, 'Not found', 'PGRST116 (no context) → "Not found"');
  eq(e.code, 'NOT_FOUND', 'PGRST116 (no context) → NOT_FOUND');
}

// ---- passthrough: any other coded error keeps message + code ----
{
  const e = normalizeError({ code: '42501', message: 'permission denied for table x' }, 'listProjects');
  eq(e.message, 'permission denied for table x', 'other → keeps raw message');
  eq(e.code, '42501', 'other → passes .code through unchanged (callers may branch on it)');
}
{
  const weird = { code: 'XX000' };
  const e = normalizeError(weird, 'op');
  eq(e.message, String(weird), 'other w/o message → String(err) fallback');
  eq(e.code, 'XX000', 'other w/o message → code still passed through');
}
{
  const e = normalizeError({ message: 'network down' }, 'sync');
  eq(e.message, 'network down', 'uncoded → keeps message');
  eq(e.code, undefined, 'uncoded → code undefined');
}

// ---- MUTATION PROOFS (each documents a regression this lock catches) ----
{
  const e = normalizeError({ code: '23505', message: 'dup key' }, 'x');
  ok(e.code === 'CONSTRAINT' && e.message.startsWith('Already exists:'),
    'M1: dup is CLASSIFIED (not raw passthrough) — drop the 23505 branch → RED');
}
{
  const e = normalizeError({ code: 'PGRST116', message: 'raw pgrst' }, 'get');
  ok(e.code === 'NOT_FOUND' && e.message === 'get: not found',
    'M2: empty single() is a NOT_FOUND miss (not raw) — drop the branch → RED');
}
{
  const e = normalizeError({ code: '40001', message: 'serialization failure' });
  ok(e.code === '40001', 'M3: passthrough preserves .code — stop copying it → RED');
}

// ---- TWIN LOCK: hunter copy must stay byte-identical to the Interpreter's tested copy ----
// Extracts the normalizeError function body from each source, strips comments +
// leading `export ` + all whitespace, and compares. Any future divergence → RED.
function extractBody(src) {
  const start = src.indexOf('function normalizeError');
  if (start < 0) return null;
  // Walk braces from the first `{` after the signature to the matching close.
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
function canonical(body) {
  return body
    .replace(/\/\/[^\n]*/g, '')      // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\s+/g, '');             // all whitespace
}
{
  const here = dirname(fileURLToPath(import.meta.url));
  const hunterSrc = readFileSync(join(here, 'normalize-db-error.js'), 'utf8');
  const transSrc = readFileSync(join(here, '..', '..', 'translation', 'src', 'normalize-db-error.js'), 'utf8');
  const hb = extractBody(hunterSrc), tb = extractBody(transSrc);
  ok(hb !== null, 'TWIN: found normalizeError body in hunter copy');
  ok(tb !== null, 'TWIN: found normalizeError body in Interpreter copy');
  ok(hb && tb && canonical(hb) === canonical(tb),
    'TWIN: hunter normalizeError is byte-identical to the Interpreter tested copy (drift → RED)');
}

console.log(`hunter/normalize-db-error: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
