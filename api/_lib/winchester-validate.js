/**
 * Pure validation for the Winchester (Westchester House Hunter) state-sync
 * POST body. Extracted from winchester-state.js so the rules that guard what
 * gets persisted to Johnny's house-hunt state row are unit-testable headless.
 *
 * validateStatePayload(body, maxBytes) -> discriminated result:
 *   { ok: true,  state, serialized, bytes }
 *   { ok: false, status, code, message }
 *
 * The size cap is a BYTE cap (UTF-8 wire/storage size), matching the
 * MAX_BYTES name and the "state is N bytes" error text. We count real UTF-8
 * bytes via TextEncoder, NOT serialized.length — JS string length is UTF-16
 * code units, which undercounts every non-ASCII char (a CJK glyph is 1 unit
 * but 3 bytes), so a char-based check would silently let an over-cap blob
 * through.
 */

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1MB

// UTF-8 byte length. Injectable for tests; defaults to the platform encoder.
export function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

export function validateStatePayload(body, maxBytes = DEFAULT_MAX_BYTES, byteLen = utf8ByteLength) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'BAD_BODY', message: 'Body must be an object' };
  }

  const state = body.state;
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, status: 400, code: 'BAD_STATE', message: 'state must be a plain object' };
  }

  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch (err) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_STATE',
      message: 'state is not JSON-serializable: ' + (err?.message || ''),
    };
  }
  // JSON.stringify can return undefined (e.g. a non-plain object that
  // stringifies to nothing); treat that as unserializable rather than crash.
  if (typeof serialized !== 'string') {
    return { ok: false, status: 400, code: 'BAD_STATE', message: 'state is not JSON-serializable' };
  }

  const bytes = byteLen(serialized);
  if (bytes > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: 'STATE_TOO_BIG',
      message: `state is ${bytes} bytes; max ${maxBytes}`,
    };
  }

  return { ok: true, state, serialized, bytes };
}
