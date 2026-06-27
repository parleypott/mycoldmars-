// Shared parser for "model returns a JSON object, sometimes wrapped in a ```json
// fence" replies. Consolidates the identical fence-strip + JSON.parse dance that
// was copy-pasted across the QSS LLM endpoints, and closes a real crash class:
//
//   const parsed = JSON.parse(cleaned);          // JSON.parse('null') === null
//   const list = Array.isArray(parsed.scenes)... // → TypeError on a bare-null reply → 500
//
// JSON.parse('null') SUCCEEDS and returns null, so a model that replies with the
// literal "null" (or ```json null```) slipped past the try/catch and crashed the
// handler at the first `parsed.<prop>` access. Same class already hardened in
// qss-story-report-normalize.js and touch-base-normalize.js — these endpoints were
// the surviving copies.
//
// Contract:
//   - ok:false   ONLY when the text is not valid JSON at all (caller maps to 502,
//                preserving the existing "parse_failed" behavior).
//   - ok:true    valid JSON. `value` is GUARANTEED a non-null object, so callers
//                that read parsed.someArray never crash. A valid-but-null / primitive
//                reply is coerced to {} (graceful — the handlers already treat a
//                missing array field as "empty result", so this degrades the same way).

/**
 * Strip a leading/trailing ```json … ``` fence (if present) and trim.
 * Byte-identical to the inline dance it replaces.
 */
export function stripCodeFence(rawText) {
  return String(rawText ?? '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Extract the FIRST balanced JSON object/array from a string that may carry
 * prose around it — a leading preamble ("Sure! Here you go:\n{…}") OR a
 * trailing aside ("{…}\n\nHope that helps!"). A bare `JSON.parse` throws on
 * either, throwing away the whole reply. String-aware matcher: tracks whether
 * we're inside a quoted string and skips escaped chars, so a literal `{`/`}`/
 * `[`/`]` INSIDE a JSON string value never miscounts the depth. Same hardening
 * already proven in api-client.js extractJSON and sot-hunter.js parseHunterJSON.
 * @returns the parsed value, or `undefined` when no balanced JSON is present.
 */
export function extractBalancedJSON(rawText) {
  const s = String(rawText ?? '');
  const startArr = s.indexOf('[');
  const startObj = s.indexOf('{');
  const start = startArr === -1 ? startObj
    : startObj === -1 ? startArr
    : Math.min(startArr, startObj);
  if (start === -1) return undefined;
  const open = s[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); }
        catch { return undefined; }
      }
    }
  }
  return undefined;
}

/**
 * Fence-strip + parse a model reply into a guaranteed-object result.
 * @returns {{ ok: boolean, value: object }} ok:false → invalid JSON (caller 502s);
 *          ok:true → value is always a non-null object (arrays pass through, since
 *          the callers read named props off it and Array.isArray(arr.prop) is false).
 */
export function parseModelObject(rawText) {
  const cleaned = stripCodeFence(rawText);
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch {
    // Direct parse failed — the reply likely carries prose around the JSON
    // (leading preamble or trailing aside). Try the string-aware balanced
    // matcher before giving up. This branch ONLY runs when the old code already
    // returned ok:false, so the success path is byte-for-byte unchanged.
    value = extractBalancedJSON(cleaned);
    if (value === undefined) return { ok: false, value: {} };
  }
  // Coerce null / primitive to {} so `.prop` access is always safe. This is the
  // fix for the bare-null crash; arrays (typeof 'object') pass through unchanged.
  if (!value || typeof value !== 'object') return { ok: true, value: {} };
  return { ok: true, value };
}
