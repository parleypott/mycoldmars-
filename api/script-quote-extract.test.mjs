// Contract tests for the transcript-screenshot → quote endpoint (api/script-quote-extract.js) and its
// pure parser (api/_lib/script-quote-extract.js).
//
// Two surfaces:
//   1. parseQuoteExtraction — validates the model's strict JSON into { tcIn, tcOut, text, speaker },
//      or refuses (null) when the model returned found:false / no timecode / no text. This is the
//      safety valve that stops a non-transcript image fabricating a soundbite.
//   2. the default handler — end-to-end with a MOCKED Gemini response (never a real network call):
//      a good read → { ok, quote }; a refusal → 422; the AUTH GATE (checkAccess) → 401 without a
//      valid access code; a non-POST → 405.
//
// Run: bun api/script-quote-extract.test.mjs

import assert from 'node:assert/strict';
import { parseQuoteExtraction, normalizeTimecode, cleanQuoteText } from './_lib/script-quote-extract.js';

let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); } };
const checkA = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); } };

// ── PURE PARSER ────────────────────────────────────────────────────────────────────────────────────
check('normalizeTimecode keeps a clean 4-part / 3-part code and extracts from a loose string', () => {
  assert.equal(normalizeTimecode('00:25:14:22'), '00:25:14:22');
  assert.equal(normalizeTimecode('00:25:14'), '00:25:14');
  assert.equal(normalizeTimecode('IN 00:25:14:22'), '00:25:14:22');
  assert.equal(normalizeTimecode('not a code'), '');
});

check('cleanQuoteText strips Interpreter [...] / [ellipsis] markers and collapses whitespace', () => {
  assert.equal(cleanQuoteText('life  [...] depends on   the ocean'), 'life depends on the ocean');
  assert.equal(cleanQuoteText('[…] and then [...]'), 'and then');
});

check('parseQuoteExtraction accepts a valid found:true object (range + speaker)', () => {
  const q = parseQuoteExtraction(JSON.stringify({
    found: true, tcIn: '00:25:14:22', tcOut: '00:25:38:20', speaker: 'TOMMY:', text: 'life on Earth depends on the ocean',
  }));
  assert.deepEqual(q, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'life on Earth depends on the ocean', speaker: 'TOMMY' });
});

check('parseQuoteExtraction unwraps a ```json fenced object', () => {
  const q = parseQuoteExtraction('```json\n{"found":true,"tcIn":"00:25:14:22","text":"hello"}\n```');
  assert.ok(q && q.tcIn === '00:25:14:22' && q.text === 'hello' && q.tcOut === '');
});

check('parseQuoteExtraction REFUSES found:false / no timecode / no text / garbage', () => {
  assert.equal(parseQuoteExtraction(JSON.stringify({ found: false })), null);
  assert.equal(parseQuoteExtraction(JSON.stringify({ found: true, text: 'hi' })), null);            // no tcIn
  assert.equal(parseQuoteExtraction(JSON.stringify({ found: true, tcIn: '00:25:14:22' })), null);   // no text
  assert.equal(parseQuoteExtraction('not json at all'), null);
  assert.equal(parseQuoteExtraction(''), null);
});

// ── ENDPOINT (mocked model, no real network) ─────────────────────────────────────────────────────────
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
delete process.env.ACCESS_CODE; // dev/open mode so checkAccess passes for the happy-path tests

const { default: handler } = await import('./script-quote-extract.js');

// 1x1 transparent PNG — a real, valid base64 image so parseImageInput accepts it.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function post(body, headers = {}) {
  return new Request('http://x/api/script-quote-extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function withMockedGemini(modelText, fn) {
  const realFetch = global.fetch;
  let sawImagePart = false;
  global.fetch = async (url, opts) => {
    const payload = JSON.parse(opts.body);
    sawImagePart = JSON.stringify(payload).includes('inlineData');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: modelText }] } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return Promise.resolve(fn(() => sawImagePart)).finally(() => { global.fetch = realFetch; });
}

await checkA('GET → 405', async () => {
  const res = await handler(new Request('http://x/api/script-quote-extract', { method: 'GET' }));
  assert.equal(res.status, 405);
});

await checkA('a readable transcript image → { ok:true, quote } (image sent to the model)', async () => {
  await withMockedGemini(
    JSON.stringify({ found: true, tcIn: '00:25:14:22', tcOut: '00:25:38:20', speaker: 'TOMMY', text: 'life depends on the ocean' }),
    async (sawImage) => {
      const res = await handler(post({ dataBase64: PNG_1x1, mimeType: 'image/png' }));
      assert.equal(res.status, 200);
      const j = await res.json();
      assert.equal(j.ok, true);
      assert.deepEqual(j.quote, { tcIn: '00:25:14:22', tcOut: '00:25:38:20', text: 'life depends on the ocean', speaker: 'TOMMY' });
      assert.equal(sawImage(), true, 'the image must be sent to the vision model as inlineData');
    },
  );
});

await checkA('model refusal (found:false) → 422, never a fabricated quote', async () => {
  await withMockedGemini(JSON.stringify({ found: false }), async () => {
    const res = await handler(post({ dataBase64: PNG_1x1, mimeType: 'image/png' }));
    assert.equal(res.status, 422);
    const j = await res.json();
    assert.equal(j.ok, false);
  });
});

await checkA('no readable image in the request → 400 (before any model call)', async () => {
  const realFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => { fetched = true; return new Response('{}'); };
  try {
    const res = await handler(post({ dataBase64: '', mimeType: '' }));
    assert.equal(res.status, 400);
    assert.equal(fetched, false, 'must refuse before spending a model call');
  } finally { global.fetch = realFetch; }
});

await checkA('AUTH GATE: with ACCESS_CODE set, a request with no code → 401 (never reaches the model)', async () => {
  process.env.ACCESS_CODE = 'secret-code';
  const realFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => { fetched = true; return new Response('{}'); };
  try {
    const res = await handler(post({ dataBase64: PNG_1x1, mimeType: 'image/png' }));
    assert.equal(res.status, 401);
    assert.equal(fetched, false, 'a gate rejection must never call the vision model');
  } finally {
    global.fetch = realFetch;
    delete process.env.ACCESS_CODE;
  }
});

await checkA('AUTH GATE: the correct x-access-code passes the gate through to the model', async () => {
  process.env.ACCESS_CODE = 'secret-code';
  try {
    await withMockedGemini(
      JSON.stringify({ found: true, tcIn: '00:25:14:22', text: 'hello' }),
      async () => {
        const res = await handler(post({ dataBase64: PNG_1x1, mimeType: 'image/png' }, { 'x-access-code': 'secret-code' }));
        assert.equal(res.status, 200);
        const j = await res.json();
        assert.equal(j.ok, true);
      },
    );
  } finally { delete process.env.ACCESS_CODE; }
});

console.log(`\nscript-quote-extract: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
