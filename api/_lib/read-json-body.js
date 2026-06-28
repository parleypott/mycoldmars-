// Shared safe JSON-body reader for edge handlers that POST a JSON object.
//
// Closes two crash modes that were previously UNHANDLED and surfaced as an
// opaque HTTP 500 across every research-* endpoint:
//   (1) a malformed request body -> req.json() rejects -> the async handler
//       throws -> 500.
//   (2) a structurally-valid but non-object body -> a JSON literal `null`,
//       a number, a string, an array -> the handler's `const { x } = body`
//       destructure throws a TypeError on null (and silently mis-reads the
//       others) -> 500.
//
// readJsonBody turns both into a clean discriminated result the caller maps
// to a 400, so a bad request is a bad request, never a server error.
//
// Returns:
//   { ok: true,  body }                       — body is a guaranteed plain object
//   { ok: false, status: 400, error: string } — caller should respond with status+error
export async function readJsonBody(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return { ok: false, status: 400, error: 'invalid json' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'body must be a json object' };
  }
  return { ok: true, body };
}

// Coerce an already-parsed body to a guaranteed plain object.
//
// For handlers that read the body inline with the weaker
// `await req.json().catch(() => ({}))` idiom and then access `body.x` RAW
// (no optional chaining). That idiom only guards a MALFORMED body — a
// structurally-valid JSON literal `null` (or a number/string/array) sails
// through `.catch` and lands as a non-object, so the first `body.x` throws a
// TypeError that surfaces as an opaque HTTP 500 instead of the handler's own
// 400 validation. Wrapping the parse result in coerceObjectBody turns every
// non-object body into `{}`, so each handler's existing field validation
// returns its intended 400 ("name is required", "no_editable_fields", …)
// rather than a server error. Plain objects pass through by reference
// unchanged, so there is zero behavior change for any valid request.
export function coerceObjectBody(raw) {
  return (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}
