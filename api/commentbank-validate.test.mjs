// Tests for the public /api/commentbank-ask cost-guard validator.
//
// Headline bug: the corpus cap is a BYTE cap (its name + error text say
// "bytes"), but the original inline check measured JSON.stringify(...).length
// — UTF-16 code UNITS, not bytes. YouTube comments are heavily non-ASCII, so a
// corpus OVER the byte cap could slip UNDER the unit count, under-enforcing the
// cost guard on an unauthenticated Sonnet endpoint. Imports the REAL shipped
// validator. Mutation-proven: reverting to a unit count goes RED.

import assert from 'node:assert/strict';
import {
  validateCommentbankInput,
  COMMENTBANK_LIMITS,
} from './_lib/commentbank-validate.js';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { console.error(`FAIL: ${name}\n  ${e.message}`); process.exitCode = 1; }
};

const enc = new TextEncoder();
const bytesOf = (s) => enc.encode(s).length;

// ── Happy path ────────────────────────────────────────────────────────────
t('valid ASCII payload passes', () => {
  const r = validateCommentbankInput({
    question: 'what do people say about the music?',
    comments: [{ id: '1', text: 'loved the score' }, { id: '2', text: 'great pacing' }],
  });
  assert.deepEqual(r, { ok: true });
});

t('empty comments array is allowed (no matches, but valid)', () => {
  assert.deepEqual(validateCommentbankInput({ question: 'hi', comments: [] }), { ok: true });
});

t('non-ASCII corpus UNDER the byte cap passes', () => {
  const comments = [{ id: '1', text: '🦐 great 评论 café' }];
  assert.deepEqual(validateCommentbankInput({ question: 'q', comments }), { ok: true });
});

// ── Missing / malformed shape → 400 ─────────────────────────────────────────
t('missing question → 400', () => {
  const r = validateCommentbankInput({ comments: [] });
  assert.equal(r.ok, false); assert.equal(r.status, 400);
  assert.match(r.error, /missing question or comments/);
});
t('empty-string question → 400 (falsy)', () => {
  assert.equal(validateCommentbankInput({ question: '', comments: [] }).status, 400);
});
t('comments not an array → 400', () => {
  assert.equal(validateCommentbankInput({ question: 'q', comments: 'nope' }).status, 400);
});
t('null body → 400, no throw', () => {
  assert.equal(validateCommentbankInput(null).status, 400);
});
t('undefined body → 400, no throw', () => {
  assert.equal(validateCommentbankInput(undefined).status, 400);
});

// ── Question length → 413 ───────────────────────────────────────────────────
t('question over 2000 chars → 413', () => {
  const r = validateCommentbankInput({ question: 'x'.repeat(2001), comments: [] });
  assert.equal(r.status, 413);
  assert.match(r.error, /question too long \(max 2000 chars\)/);
});
t('question exactly 2000 chars → ok', () => {
  assert.deepEqual(validateCommentbankInput({ question: 'x'.repeat(2000), comments: [] }), { ok: true });
});
t('non-string question (object) → 413', () => {
  // truthy but not a string: skips the 400 falsy branch, fails the typeof check
  assert.equal(validateCommentbankInput({ question: { a: 1 }, comments: [] }).status, 413);
});

// ── Comment count → 413 ─────────────────────────────────────────────────────
t('over 500 comments → 413', () => {
  const comments = Array.from({ length: 501 }, (_, i) => ({ id: String(i), text: 'x' }));
  const r = validateCommentbankInput({ question: 'q', comments });
  assert.equal(r.status, 413);
  assert.match(r.error, /too many comments \(max 500\)/);
});
t('exactly 500 comments → ok', () => {
  const comments = Array.from({ length: 500 }, (_, i) => ({ id: String(i), text: 'x' }));
  assert.deepEqual(validateCommentbankInput({ question: 'q', comments }), { ok: true });
});

// ── Per-comment text length → 413 ───────────────────────────────────────────
t('a comment over 1000 chars → 413', () => {
  const comments = [{ id: '1', text: 'ok' }, { id: '2', text: 'y'.repeat(1001) }];
  const r = validateCommentbankInput({ question: 'q', comments });
  assert.equal(r.status, 413);
  assert.match(r.error, /comment text too long \(max 1000 chars per comment\)/);
});
t('comment exactly 1000 chars → ok', () => {
  assert.deepEqual(
    validateCommentbankInput({ question: 'q', comments: [{ id: '1', text: 'y'.repeat(1000) }] }),
    { ok: true },
  );
});
t('comment with non-string text is skipped, not rejected', () => {
  assert.deepEqual(
    validateCommentbankInput({ question: 'q', comments: [{ id: '1', text: 12345 }] }),
    { ok: true },
  );
});

// ── Corpus byte cap (the headline fix) → 413 ────────────────────────────────
// Build a non-ASCII corpus OVER the 200,000-byte cap but UNDER the UTF-16 unit
// count (each 🦐 = 2 units / 4 bytes). The old unit check would NOT reject it.
function emojiCorpusOverByteCap() {
  // Each comment's text is 490 emoji = 980 UTF-16 units (< the 1000 per-comment
  // cap) but 1960 bytes. 120 such comments stay well under the corpus UNIT count
  // yet blow past the 200,000 real-BYTE cap.
  return Array.from({ length: 120 }, (_, i) => ({ id: 'c' + i, text: '🦐'.repeat(490) }));
}

t('RED PROOF: old unit count would NOT reject this corpus, byte count DOES', () => {
  const comments = emojiCorpusOverByteCap();
  const json = JSON.stringify(comments);
  const units = json.length;                 // what the OLD check measured
  const bytes = bytesOf(json);               // what the cap actually means
  assert.ok(units <= COMMENTBANK_LIMITS.maxCorpusBytes, 'fixture must slip the old unit cap');
  assert.ok(bytes > COMMENTBANK_LIMITS.maxCorpusBytes, 'fixture must exceed the real byte cap');
  // The shipped validator (byte-accurate) rejects it.
  const r = validateCommentbankInput({ question: 'q', comments });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
  assert.match(r.error, /corpus too large/);
  assert.match(r.error, new RegExp(`got ${bytes}\\b`)); // reports real bytes, not units
});

t('ASCII corpus just over the byte cap → 413 (bytes == units here)', () => {
  // 1 ASCII char = 1 byte, so this also tripped the old check — back-compat.
  const big = 'a'.repeat(200_050);
  const comments = [{ id: '1', text: big }]; // > maxCommentChars too, but text>1000 fires first
  const r = validateCommentbankInput({ question: 'q', comments });
  assert.equal(r.status, 413); // rejected (per-comment cap), still a 413
});

t('byte counter is injectable (deterministic, no platform TextEncoder dep)', () => {
  // Force a tiny cap via a fake byteLen to prove the corpus branch is reached.
  const r = validateCommentbankInput(
    { question: 'q', comments: [{ id: '1', text: 'hi' }] },
    { ...COMMENTBANK_LIMITS, maxCorpusBytes: 5 },
    () => 6, // pretend the serialized corpus is 6 bytes > cap 5
  );
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
  assert.match(r.error, /got 6\b/);
});

t('non-ASCII corpus under both caps passes (no false reject)', () => {
  const comments = [{ id: '1', text: 'café 评论 🦐' }];
  assert.deepEqual(validateCommentbankInput({ question: 'q', comments }), { ok: true });
});

console.log(`commentbank-validate: ${pass} passed`);
