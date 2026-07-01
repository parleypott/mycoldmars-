// Supabase/Postgres error → app-shaped Error normalizer.
//
// Load-bearing: EVERY db.js write/read funnels its `error` through this before
// throwing. It decides three things the rest of the Interpreter depends on:
//   1. The user-facing message ("Already exists" / "…: not found" / raw).
//   2. The classification `.code` callers branch on — CONSTRAINT for a unique
//      violation (23505), NOT_FOUND for an empty `.single()` (PGRST116). Drop
//      either branch and a friendly, actionable failure silently degrades into
//      a raw Postgres string, and any caller doing `if (e.code === 'NOT_FOUND')`
//      stops recognizing the miss.
//   3. That a falsy error never crashes the thrower (returns a generic Error).
//
// Extracted verbatim from db.js so it's a pure, testable unit — it closed over
// nothing from module scope, so nothing changes at the call sites.
//
// @param {any} err       the raw Supabase/PG error (may be null/undefined)
// @param {string} [context]  the calling operation name, for the message
// @returns {Error} app-shaped Error with an optional `.code` / `.context`
export function normalizeError(err, context) {
  if (!err) return new Error('Unknown error');
  // Supabase unique-constraint violation
  if (err.code === '23505') {
    const e = new Error(`Already exists: ${err.message || err.details || ''}`);
    e.code = 'CONSTRAINT';
    e.context = context;
    return e;
  }
  // Postgres "no rows returned" from .single() — treat as NOT_FOUND
  if (err.code === 'PGRST116') {
    const e = new Error(context ? `${context}: not found` : 'Not found');
    e.code = 'NOT_FOUND';
    return e;
  }
  const e = new Error(err.message || String(err));
  e.code = err.code;
  return e;
}
