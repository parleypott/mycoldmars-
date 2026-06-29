// Lock for the PUBLIC, unauthenticated /api/commentbank-ask cost guard.
// The endpoint runs Sonnet on every POST with NO access gate, so these caps
// ARE the only thing standing between a hostile/oversized body and real
// Anthropic spend. It shipped with a documented byte-vs-char fix (the corpus
// cap must measure UTF-8 BYTES, not UTF-16 .length, or a non-ASCII corpus
// over the byte cap slips UNDER the unit count and under-enforces the guard)
// but had NO test — a refactor back to `.length` would silently reopen the
// hole. This locks: the structural caps, the per-comment char cap, and — the
// load-bearing one — that the corpus cap counts real bytes.
//
// Imports the REAL shipped fns — no mirror, can't drift.
import { validateCommentbankInput, COMMENTBANK_LIMITS } from './commentbank-validate.js';
import { utf8ByteLength, validateStatePayload } from './winchester-validate.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// ── utf8ByteLength: the shared primitive both validators lean on ────────────
// A char-based count (str.length) would return the UTF-16 unit count; these
// assertions go RED if utf8ByteLength is ever reverted to `.length`.
eq(utf8ByteLength('abc'), 3, 'ASCII: bytes == chars');
eq(utf8ByteLength(''), 0, 'empty string is 0 bytes');
eq(utf8ByteLength('é'), 2, 'Latin-1 accent is 2 UTF-8 bytes (1 UTF-16 unit)');
eq(utf8ByteLength('好'), 3, 'CJK glyph is 3 UTF-8 bytes (1 UTF-16 unit)');
eq(utf8ByteLength('😀'), 4, 'emoji is 4 UTF-8 bytes (2 UTF-16 units)');
ok(utf8ByteLength('好') > '好'.length, 'CJK: byte count strictly exceeds char count');

// ── commentbank: structural caps ────────────────────────────────────────────
eq(validateCommentbankInput(null).ok, false, 'null body rejected');
eq(validateCommentbankInput({}).status, 400, 'missing question+comments -> 400');
eq(validateCommentbankInput({ question: 'hi' }).status, 400, 'missing comments array -> 400');
eq(validateCommentbankInput({ question: 'hi', comments: 'nope' }).status, 400, 'non-array comments -> 400');
eq(validateCommentbankInput({ question: 'hi', comments: [] }).ok, true, 'minimal valid payload ok');

// question char cap (status 413)
{
  const long = 'x'.repeat(COMMENTBANK_LIMITS.maxQuestionChars + 1);
  eq(validateCommentbankInput({ question: long, comments: [] }).status, 413, 'over-long question -> 413');
  const atCap = 'x'.repeat(COMMENTBANK_LIMITS.maxQuestionChars);
  eq(validateCommentbankInput({ question: atCap, comments: [] }).ok, true, 'question exactly at cap ok');
  // non-string question is rejected by the typeof gate, not treated as 0-length
  eq(validateCommentbankInput({ question: 123, comments: [] }).status, 413, 'non-string question -> 413');
}

// too-many-comments cap (status 413)
{
  const many = Array.from({ length: COMMENTBANK_LIMITS.maxComments + 1 }, () => ({ text: 'a' }));
  eq(validateCommentbankInput({ question: 'q', comments: many }).status, 413, 'too many comments -> 413');
  const exactly = Array.from({ length: COMMENTBANK_LIMITS.maxComments }, () => ({ text: 'a' }));
  // at the count cap, small ASCII corpus stays under the byte cap -> ok
  eq(validateCommentbankInput({ question: 'q', comments: exactly }).ok, true, 'exactly maxComments ok');
}

// per-comment char cap (status 413)
{
  const bigText = 'x'.repeat(COMMENTBANK_LIMITS.maxCommentChars + 1);
  eq(validateCommentbankInput({ question: 'q', comments: [{ text: bigText }] }).status, 413, 'over-long single comment -> 413');
  // a non-string text is skipped by the per-comment check (the corpus byte cap
  // is the backstop), so it must NOT 413 on the char rule for a tiny payload
  eq(validateCommentbankInput({ question: 'q', comments: [{ text: 42 }] }).ok, true, 'non-string comment text skips char cap');
}

// ── commentbank: the LOAD-BEARING byte cap (UTF-8, not UTF-16) ───────────────
// Build a corpus whose UTF-16 .length is UNDER the byte cap but whose true
// UTF-8 byte size is OVER it. Only a real byte count rejects this; a `.length`
// regression would wrongly pass it. CJK is 3 bytes / 1 unit, so ~3x ratio.
{
  const cap = COMMENTBANK_LIMITS.maxCorpusBytes; // 200_000
  // Choose a glyph count that lands chars < cap < bytes.
  // chars ≈ glyphs (+JSON punctuation); bytes ≈ 3*glyphs. Pick glyphs so that
  // 3*glyphs > cap but glyphs < cap.
  const glyphs = Math.floor(cap / 2); // 100_000 glyphs: chars≈100k (<200k), bytes≈300k (>200k)
  const cjk = '好'.repeat(glyphs);
  const comments = [{ text: cjk }];
  const serialized = JSON.stringify(comments);
  ok(serialized.length < cap, 'sanity: UTF-16 length is UNDER the byte cap (a .length check would pass it)');
  ok(utf8ByteLength(serialized) > cap, 'sanity: real UTF-8 size is OVER the byte cap');
  // NOTE: this single comment exceeds maxCommentChars, which 413s first — so to
  // isolate the BYTE rule, spread the glyphs across many in-spec comments.
  const per = COMMENTBANK_LIMITS.maxCommentChars - 1; // under the per-comment char cap
  const n = Math.ceil(glyphs / per);
  const spread = Array.from({ length: Math.min(n, COMMENTBANK_LIMITS.maxComments) }, () => ({ text: '好'.repeat(per) }));
  const res = validateCommentbankInput({ question: 'q', comments: spread });
  // spread corpus: each comment in-spec, count in-spec, but total UTF-8 bytes over cap
  eq(res.ok, false, 'non-ASCII corpus over the BYTE cap is rejected');
  eq(res.status, 413, 'over-byte corpus -> 413');
  ok(/bytes serialized/.test(res.error || ''), 'error names the byte cap');
  // the reported "got N" must be the real byte count, not the unit count
  const reported = Number(((res.error || '').match(/got (\d+)/) || [])[1]);
  ok(reported > JSON.stringify(spread).length, 'reported size is UTF-8 bytes (exceeds UTF-16 char count)');
}

// an ASCII corpus of the same char size stays UNDER the byte cap (byte==char)
{
  const asciiPer = COMMENTBANK_LIMITS.maxCommentChars - 1;
  const small = Array.from({ length: 10 }, () => ({ text: 'a'.repeat(asciiPer) }));
  eq(validateCommentbankInput({ question: 'q', comments: small }).ok, true, 'modest ASCII corpus passes');
}

// ── winchester-validate: same byte-cap discipline on the state-sync path ─────
eq(validateStatePayload(null).status, 400, 'null body -> 400 BAD_BODY');
eq(validateStatePayload([]).status, 400, 'array body -> 400 BAD_BODY');
eq(validateStatePayload({ state: 'nope' }).status, 400, 'non-object state -> 400 BAD_STATE');
eq(validateStatePayload({ state: [] }).status, 400, 'array state -> 400 BAD_STATE');
{
  const good = validateStatePayload({ state: { a: 1, b: 'hi' } });
  eq(good.ok, true, 'plain-object state ok');
  eq(good.bytes, utf8ByteLength(good.serialized), 'reported bytes == real UTF-8 size of serialized state');
}
{
  // A small non-ASCII state under a tiny byte cap: bytes>chars must trip the cap
  // where a char count would not. state {"k":"好好好好"} -> serialized has 4 CJK
  // = 12 bytes of glyph + JSON punctuation; pick a cap between chars and bytes.
  const state = { k: '好好好好好' }; // 5 CJK = 15 bytes, but few UTF-16 units
  const serialized = JSON.stringify(state);
  const chars = serialized.length;
  const bytes = utf8ByteLength(serialized);
  ok(bytes > chars, 'sanity: serialized state has more UTF-8 bytes than chars');
  // cap strictly between chars and bytes: a .length check passes, a byte check rejects
  const cap = Math.floor((chars + bytes) / 2);
  eq(validateStatePayload({ state }, cap).status, 413, 'non-ASCII state over BYTE cap -> 413 STATE_TOO_BIG');
  eq(validateStatePayload({ state }, cap).code, 'STATE_TOO_BIG', 'over-byte state code is STATE_TOO_BIG');
  // same state under a generous cap passes
  eq(validateStatePayload({ state }, bytes + 10).ok, true, 'state under the byte cap passes');
}

console.log(`\ncommentbank-validate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
