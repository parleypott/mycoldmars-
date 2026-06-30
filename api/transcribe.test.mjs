// Verifier-layer lock for the transcription router's PURE core
// (api/transcribe.js) — the largest untested API module.
//
// Why this matters: redactApiErrorText is DEFENSE-IN-DEPTH against leaking a
// provider credential back to the client when an upstream API echoes it in an
// error body. A silent regression there (a future edit loosening a regex, or
// reordering so a token slips through) would be a real credential leak with no
// other guard behind it. normalizeDeepgram is the contract both providers are
// normalized to — if it drops segments or mislabels speakers, every downstream
// Interpreter export is wrong. extractFilenameFromUrl decides the filename
// Whisper sees (which drives format detection).
//
// No live bug was found in the pure core (the redactor was checked against the
// real OpenAI/Deepgram/JWT echo shapes; the normalizer against Deepgram's
// paragraph/utterance/fallback response shapes). So this is a LOCK: every
// assertion below is mutation-proven to go RED if the corresponding logic
// regresses. Run with: node api/transcribe.test.mjs   (or `bun run test`).

import {
  normalizeDeepgram,
  redactApiErrorText,
  extractFilenameFromUrl,
} from './transcribe.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ───────────────────────── redactApiErrorText ─────────────────────────
// The security-critical core. Each credential class must be scrubbed, and
// ordinary text must survive untouched.

// OpenAI keys (incl. project-scoped sk-proj-…)
ok(!redactApiErrorText('Incorrect API key provided: sk-proj-ABCD1234abcd5678WXYZ').includes('sk-proj-ABCD1234abcd5678WXYZ'),
  'sk- project key scrubbed');
ok(redactApiErrorText('key sk-ABCDEFGHIJKLMNOP1234').includes('REDACTED'),
  'sk- key replaced with REDACTED marker');
// Classic OpenAI key
ok(!redactApiErrorText('bad key sk-1234567890abcdefghij').includes('sk-1234567890abcdefghij'),
  'classic sk- key scrubbed');

// Bearer tokens
ok(!redactApiErrorText('Authorization: Bearer abcdef1234567890ABCDEF').includes('abcdef1234567890ABCDEF'),
  'Bearer token scrubbed');
ok(redactApiErrorText('Bearer abcdef1234567890ABCDEF').includes('Bearer ***REDACTED***'),
  'Bearer redaction keeps the scheme word');

// Deepgram-style 40+ char lowercase hex token
const dgKey = 'a'.repeat(40);
ok(!redactApiErrorText(`Token ${dgKey} invalid`).includes(dgKey),
  'Deepgram 40-hex token scrubbed');
ok(redactApiErrorText(`abcdef0123456789abcdef0123456789abcdef01`).includes('REDACTED'),
  'mixed 40-hex token scrubbed');
// A short hex string (under 40) must NOT be redacted — it is not a credential.
eq(redactApiErrorText('color #abc123 and id deadbeef'), 'color #abc123 and id deadbeef',
  'short hex left intact (not a credential)');

// Supabase / generic JWTs
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
ok(!redactApiErrorText(`signed url token=${jwt}`).includes(jwt),
  'JWT scrubbed');
ok(redactApiErrorText(`token=${jwt}`).includes('***JWT***'),
  'JWT replaced with JWT marker');

// Passthrough — ordinary error text must be byte-identical.
eq(redactApiErrorText('Deepgram: 401 Unauthorized'), 'Deepgram: 401 Unauthorized',
  'ordinary error text untouched');
eq(redactApiErrorText(''), '', 'empty string → empty');
eq(redactApiErrorText(null), '', 'null → empty string (no throw)');
eq(redactApiErrorText(undefined), '', 'undefined → empty string (no throw)');

// HARD GUARANTEE: a blob containing every credential class at once leaks NONE.
{
  const blob = `err sk-proj-LEAKLEAKLEAK1234567 and Bearer LEAKbearer1234567890XY and ${dgKey} and ${jwt}`;
  const out = redactApiErrorText(blob);
  ok(!out.includes('sk-proj-LEAKLEAKLEAK1234567'), 'combined blob: sk- leaked? no');
  ok(!out.includes('LEAKbearer1234567890XY'), 'combined blob: Bearer leaked? no');
  ok(!out.includes(dgKey), 'combined blob: hex leaked? no');
  ok(!out.includes(jwt), 'combined blob: JWT leaked? no');
}

// ───────────────────────── extractFilenameFromUrl ─────────────────────────
eq(extractFilenameFromUrl('https://x.supabase.co/storage/v1/object/sign/media/interview.mp3'),
  'interview.mp3', 'extracts the last path segment');
eq(extractFilenameFromUrl('https://x.co/a/b/clip.wav?token=abc&t=1'),
  'clip.wav', 'query string stripped from filename');
eq(extractFilenameFromUrl('https://x.co/'), null, 'trailing slash → no filename → null');
eq(extractFilenameFromUrl('not a url'), null, 'non-URL → null (no throw)');
eq(extractFilenameFromUrl(''), null, 'empty → null (no throw)');

// ───────────────────────── normalizeDeepgram ─────────────────────────
// Build a realistic verbose Deepgram response: two diarized paragraphs, each
// with one sentence, plus word timings, plus a top-level transcript.
const dgParagraphs = {
  metadata: { duration: 12.5 },
  results: {
    channels: [{
      detected_language: 'en',
      alternatives: [{
        transcript: 'Hello world. How are you?',
        words: [
          { word: 'hello', punctuated_word: 'Hello', start: 0.1, end: 0.5, speaker: 0 },
          { word: 'world', punctuated_word: 'world.', start: 0.6, end: 1.0, speaker: 0 },
          { word: 'how', punctuated_word: 'How', start: 1.2, end: 1.4, speaker: 1 },
        ],
        paragraphs: {
          paragraphs: [
            { sentences: [{ text: 'Hello world.', start: 0.1, end: 1.0 }], speaker: 0, start: 0.1, end: 1.0 },
            { sentences: [{ text: 'How are you?', start: 1.2, end: 2.0 }], speaker: 1, start: 1.2, end: 2.0 },
          ],
        },
      }],
    }],
    language: 'en',
  },
};
{
  const r = normalizeDeepgram(dgParagraphs);
  eq(r.provider, 'deepgram', 'provider tag');
  eq(r.language, 'en', 'detected language preferred');
  eq(r.duration_seconds, 12.5, 'duration from metadata');
  eq(r.full_text, 'Hello world. How are you?', 'full_text from alternative transcript');
  eq(r.segments.length, 2, 'two paragraphs → two segments');
  // 1-based numbering, 0-based index, sequential across paragraphs.
  eq(r.segments[0].number, 1, 'first segment number is 1');
  eq(r.segments[0].index, 0, 'first segment index is 0');
  eq(r.segments[1].number, 2, 'second segment number is 2 (counter continues across paragraphs)');
  eq(r.segments[1].index, 1, 'second segment index is 1');
  // Speaker label is 1-based (raw 0 → "Speaker 1").
  eq(r.segments[0].speaker, 'Speaker 1', 'speaker 0 → "Speaker 1" (1-based label)');
  eq(r.segments[1].speaker, 'Speaker 2', 'speaker 1 → "Speaker 2"');
  eq(r.segments[0].original, 'Hello world.', 'segment text from sentence, trimmed');
  eq(r.segments[0].start, 0.1, 'segment start from sentence');
  eq(r.segments[0].end, 1.0, 'segment end from sentence');
  // Word timings keep the RAW (0-based) speaker number and punctuated form.
  eq(r.word_timings.length, 3, 'three word timings');
  eq(r.word_timings[0].word, 'Hello', 'word uses punctuated_word when present');
  eq(r.word_timings[0].speaker, 0, 'word keeps raw 0-based speaker index');
}

// Multi-sentence paragraph → each sentence becomes its own segment.
{
  const dg = JSON.parse(JSON.stringify(dgParagraphs));
  dg.results.channels[0].alternatives[0].paragraphs.paragraphs = [
    { sentences: [
      { text: 'One.', start: 0, end: 1 },
      { text: 'Two.', start: 1, end: 2 },
    ], speaker: 0, start: 0, end: 2 },
  ];
  const r = normalizeDeepgram(dg);
  eq(r.segments.length, 2, 'two sentences in one paragraph → two segments');
  eq(r.segments[1].number, 2, 'second sentence numbered 2');
  eq(r.segments[0].original, 'One.', 'first sentence text');
  eq(r.segments[1].original, 'Two.', 'second sentence text');
}

// EMPTY-sentences paragraph → must NOT be silently dropped; falls back to p.text.
// (Regression guard: the old `p.sentences || [...]` form treated an empty array
// as truthy, skipped the loop, and lost the paragraph's text entirely.)
{
  const dg = JSON.parse(JSON.stringify(dgParagraphs));
  dg.results.channels[0].alternatives[0].paragraphs.paragraphs = [
    { sentences: [], text: 'Salvaged from p.text', speaker: 0, start: 0, end: 4 },
  ];
  const r = normalizeDeepgram(dg);
  eq(r.segments.length, 1, 'empty sentences[] → one fallback segment (not dropped)');
  eq(r.segments[0].original, 'Salvaged from p.text', 'empty sentences[] falls back to paragraph text');
  eq(r.segments[0].start, 0, 'fallback segment start from paragraph');
  eq(r.segments[0].end, 4, 'fallback segment end from paragraph');
}

// Non-array sentences (malformed) → same fallback, no throw.
{
  const dg = JSON.parse(JSON.stringify(dgParagraphs));
  dg.results.channels[0].alternatives[0].paragraphs.paragraphs = [
    { sentences: 'oops', text: 'Still salvaged', speaker: 1, start: 1, end: 2 },
  ];
  const r = normalizeDeepgram(dg);
  eq(r.segments.length, 1, 'non-array sentences → one fallback segment, no throw');
  eq(r.segments[0].original, 'Still salvaged', 'non-array sentences falls back to paragraph text');
}

// Missing speaker number → defaults to "Speaker 1".
{
  const dg = JSON.parse(JSON.stringify(dgParagraphs));
  delete dg.results.channels[0].alternatives[0].paragraphs.paragraphs[0].speaker;
  const r = normalizeDeepgram(dg);
  eq(r.segments[0].speaker, 'Speaker 1', 'absent speaker → "Speaker 1" default');
}

// No paragraphs → falls back to utterances.
{
  const dg = {
    metadata: { duration: 3 },
    results: {
      channels: [{ alternatives: [{ transcript: 'Utterance text', words: [] }] }],
      utterances: [
        { transcript: 'First utt', start: 0, end: 1, speaker: 2 },
        { transcript: 'Second utt', start: 1, end: 2, speaker: 0 },
      ],
    },
  };
  const r = normalizeDeepgram(dg);
  eq(r.segments.length, 2, 'utterance fallback → two segments');
  eq(r.segments[0].speaker, 'Speaker 3', 'utterance speaker 2 → "Speaker 3"');
  eq(r.segments[0].original, 'First utt', 'utterance transcript field used');
  eq(r.segments[1].number, 2, 'utterance numbering continues');
}

// No paragraphs AND no utterances → single fallback segment from full transcript.
{
  const dg = {
    metadata: { duration: 5 },
    results: { channels: [{ alternatives: [{ transcript: 'Whole thing', words: [] }] }] },
  };
  const r = normalizeDeepgram(dg);
  eq(r.segments.length, 1, 'no paragraphs/utterances → one fallback segment');
  eq(r.segments[0].original, 'Whole thing', 'fallback segment uses full transcript');
  eq(r.segments[0].end, 5, 'fallback segment end uses duration');
  eq(r.segments[0].speaker, 'Speaker 1', 'fallback segment speaker label');
}

// Totally empty / malformed response must not throw and must degrade cleanly.
{
  const r = normalizeDeepgram({});
  eq(r.segments.length, 1, 'empty response → one (empty) fallback segment, no throw');
  eq(r.full_text, '', 'empty response → empty full_text');
  eq(r.language, null, 'empty response → null language');
  eq(r.word_timings.length, 0, 'empty response → no word timings');
}

// ───────────────────────── INLINE RED PROOFS ─────────────────────────
// Reconstruct the *failure modes this lock guards against* and assert that the
// shipped functions do NOT exhibit them — so these stay meaningful even if
// someone deletes the mutation-test scaffolding.

// If the Deepgram hex regex were dropped, a 40-hex key would survive. Prove the
// shipped redactor removes it.
ok(redactApiErrorText(dgKey) === '***REDACTED***',
  'RED-proof: a bare 40-hex credential is fully replaced, not passed through');

// If speaker labels were emitted 0-based (raw number), speaker 0 would render
// as "Speaker 0". Prove the shipped normalizer is 1-based.
ok(normalizeDeepgram(dgParagraphs).segments[0].speaker !== 'Speaker 0',
  'RED-proof: speaker label is never the raw 0-based number');

// ───────────────────────── report ─────────────────────────
if (fail === 0) {
  console.log(`transcribe: ${pass} passed, 0 failed`);
} else {
  console.log(`transcribe: ${pass} passed, ${fail} FAILED`);
  for (const m of fails) console.log('  ✗ ' + m);
  process.exit(1);
}
