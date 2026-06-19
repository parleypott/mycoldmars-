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
