// Pure input validation for the PUBLIC, unauthenticated /api/commentbank-ask
// endpoint. Extracted from the handler so the cost-guard caps are unit-testable.
//
// The endpoint runs Sonnet on every POST with no access gate, so its size caps
// ARE the cost boundary. The corpus cap is a BYTE cap — it guards Anthropic
// input-token cost and the wire — but the original inline check measured
// JSON.stringify(comments).length, i.e. UTF-16 code UNITS, not bytes, while the
// error text promised "max 200,000 bytes serialized". YouTube comments (this
// corpus) are heavily non-ASCII: an emoji is 1-2 UTF-16 units but 4 UTF-8 bytes,
// CJK is 1 unit / 3 bytes. So a corpus OVER the byte cap could slip UNDER the
// unit count — under-enforcing the guard — and the reported "N bytes" was a unit
// count. Count real UTF-8 bytes via the shared utf8ByteLength (same fix shipped
// for winchester-state + nile-flights). ASCII corpora are byte-identical.

import { utf8ByteLength } from './winchester-validate.js';

export const COMMENTBANK_LIMITS = {
  maxQuestionChars: 2000,
  maxComments: 500,
  maxCommentChars: 1000,
  maxCorpusBytes: 200_000,
};

// Returns { ok: true } on a valid payload, or
// { ok: false, status, error } mirroring the handler's existing responses.
// byteLen is injectable so tests don't depend on the platform TextEncoder.
export function validateCommentbankInput(body, limits = COMMENTBANK_LIMITS, byteLen = utf8ByteLength) {
  const { question, comments } = body || {};

  if (!question || !Array.isArray(comments)) {
    return { ok: false, status: 400, error: 'missing question or comments' };
  }
  if (typeof question !== 'string' || question.length > limits.maxQuestionChars) {
    return { ok: false, status: 413, error: `question too long (max ${limits.maxQuestionChars} chars)` };
  }
  if (comments.length > limits.maxComments) {
    return { ok: false, status: 413, error: `too many comments (max ${limits.maxComments})` };
  }
  for (const c of comments) {
    if (typeof c?.text === 'string' && c.text.length > limits.maxCommentChars) {
      return {
        ok: false,
        status: 413,
        error: `comment text too long (max ${limits.maxCommentChars} chars per comment)`,
      };
    }
  }
  const bytes = byteLen(JSON.stringify(comments));
  if (bytes > limits.maxCorpusBytes) {
    return {
      ok: false,
      status: 413,
      error: `corpus too large (max ${limits.maxCorpusBytes} bytes serialized, got ${bytes})`,
    };
  }
  return { ok: true };
}
