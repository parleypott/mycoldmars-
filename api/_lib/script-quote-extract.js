// Pure parsing/validation for the transcript-screenshot → quote endpoint (api/script-quote-extract.js).
// Split out so the strict-output contract is unit-testable with a MOCKED model string, no network.
//
// The vision model is asked for strict JSON { found, tcIn, tcOut, speaker, text }. This validates
// that shape into the editor's insertion contract { tcIn, tcOut, text, speaker } — or null when the
// model refused (found:false) or returned something unusable. Refusing here (→ 422 upstream) is the
// safety valve that stops a non-transcript image from ever producing a fabricated soundbite.

// A broadcast timecode as the transcript tools print it: HH:MM:SS:FF (4-part) or HH:MM:SS (3-part).
// Kept in lockstep with the editor's TC shape (marks.js TC_RE / document-builder TIMECODE_RE); the
// hour is a hard 2 digits so a stray longer number can't masquerade as a code.
const TC_RE = /^\d{2}:\d{2}:\d{2}(?::\d{2})?$/;

// Pull the first legible timecode out of a looser string ("IN 00:25:14:22", "00:25:14"), returning
// the canonical digits-and-colons code or ''. Never throws.
export function normalizeTimecode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (TC_RE.test(s)) return s;
  const m = s.match(/\d{2}:\d{2}:\d{2}(?::\d{2})?/);
  return m ? m[0] : '';
}

// Strip the "[...]" / "[…]" ellipsis markers Interpreter/Trint insert, and any leading "NAME:" the
// model left on the text, then collapse whitespace. Pure.
export function cleanQuoteText(raw) {
  return String(raw || '')
    .replace(/\[\s*(?:\.\.\.|…)\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse the model's raw text into the editor insertion contract, or null.
// Accepts either a bare JSON object string or one wrapped in ```json fences (some models add them
// even under responseMimeType). Refuses when found !== true, no valid tcIn, or no text.
export function parseQuoteExtraction(modelText) {
  const raw = String(modelText || '').trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let obj;
  try { obj = JSON.parse(unfenced); } catch { return null; }
  if (!obj || typeof obj !== 'object' || obj.found !== true) return null;

  const tcIn = normalizeTimecode(obj.tcIn);
  if (!tcIn) return null;
  const tcOut = normalizeTimecode(obj.tcOut);
  const text = cleanQuoteText(obj.text);
  if (!text) return null;
  const speaker = String(obj.speaker || '').replace(/\s+/g, ' ').trim().replace(/:$/, '');

  return { tcIn, tcOut, text, speaker };
}
