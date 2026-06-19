// Tests for the bare-null MODEL-REPLY parse crash in two QSS endpoints the
// earlier null-body sweep did NOT cover (they crash AFTER the model fetch, not
// on the request body):
//
//   api/qss-character-compare.js  — `parsed.incompatible`  (line ~151)
//   api/qss-story-title.js        — `parsed.title`         (line ~121)
//
// Both did `parsed = JSON.parse(cleaned)` INSIDE a try/catch (so MALFORMED JSON
// was a clean 502 parse_failed) but then accessed `parsed.<prop>` OUTSIDE the
// catch. JSON.parse('null') SUCCEEDS and returns null, so a model reply of the
// literal "null" (or ```json null```) slipped past the catch and threw a
// TypeError at the first property access -> unhandled HTTP 500. Same class
// already hardened this week in qss-story-report / touch-base / block-summaries /
// scene-build via the shared parseModelObject helper; these two used their own
// inline parse and were missed. (whh-score spreads `{...parsed}` which tolerates
// null; commentbank's access is inside its catch -> graceful 500, not a crash.)
//
// Fix: route both through the shared, mutation-locked api/_lib/model-json.js
// parseModelObject -> { ok, value }: ok:false ONLY on invalid JSON (caller 502s,
// preserving behavior); ok:true -> value is GUARANTEED a non-null object, so a
// null/primitive reply degrades to {} (compare -> "not incompatible"; title ->
// empty title) instead of a 500. Valid-object replies are byte-identical.
//
// Drives the REAL default exports end-to-end with mock Requests and a STUBBED
// global.fetch returning the model reply. ACCESS_CODE is unset so checkAccess
// runs in dev/open mode and never fetches; the provider keys are set so each
// handler REACHES the model call. No external network is touched.

import assert from 'node:assert';

delete process.env.ACCESS_CODE;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';
process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test-key';

const compare = (await import('./qss-character-compare.js')).default;
const title = (await import('./qss-story-title.js')).default;

let passed = 0, failed = 0;
async function aok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Stub global.fetch so the handler's provider call returns a chosen model text.
// Anthropic shape: { content: [{ text }] }.  Gemini shape:
// { candidates: [{ content: { parts: [{ text }] } }] }.  checkAccess never
// fetches with ACCESS_CODE unset, so this only intercepts the model call.
const realFetch = global.fetch;
function stubModel(modelText) {
  global.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('generativelanguage')
      ? { candidates: [{ content: { parts: [{ text: modelText }] } }] }
      : { content: [{ text: modelText }] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}
function restoreFetch() { global.fetch = realFetch; }

// A valid reference image that passes safeImageRef (object shape, no url field,
// non-empty base64 under the cap, png mime).
const IMG = { mimeType: 'image/png', dataBase64: 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH' };

function postCompare(bodyObj) {
  return new Request('https://x/api/qss-character-compare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
}
function postTitle(bodyObj) {
  return new Request('https://x/api/qss-story-title', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
}

// ── RED PROOF: the OLD final-access logic crashes on a bare-null parse ──
await aok('RED: old compare `parsed.incompatible` throws on JSON.parse("null")', async () => {
  const oldFinal = (parsed) => ({
    incompatible: !!parsed.incompatible,
    reason: String(parsed.reason || '').slice(0, 240),
    wordy_message: String(parsed.wordy_message || '').slice(0, 280),
  });
  let threw = false;
  try { oldFinal(JSON.parse('null')); } catch { threw = true; }
  assert.equal(threw, true, 'old code reads .incompatible on null -> TypeError -> 500');
});
await aok('RED: old title `parsed.title` throws on JSON.parse("null")', async () => {
  const oldTitle = (parsed) => String(parsed.title || '').trim();
  let threw = false;
  try { oldTitle(JSON.parse('null')); } catch { threw = true; }
  assert.equal(threw, true, 'old code reads .title on null -> TypeError -> 500');
});

// ── COMPARE: the fix — a bare-null reply is a clean 200 safe default, not 500 ──
for (const reply of ['null', '```json\nnull\n```', 'null\n']) {
  await aok(`compare: model reply ${JSON.stringify(reply)} -> 200 safe default (was 500 crash)`, async () => {
    stubModel(reply);
    let res;
    try { res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG, IMG] })); }
    catch (e) { assert.fail(`handler threw (HTTP 500): ${e.message}`); }
    finally { restoreFetch(); }
    assert.equal(res.status, 200, 'bare-null reply must degrade to 200, not crash');
    const j = await res.json();
    assert.equal(j.incompatible, false);
    assert.equal(j.reason, '');
    assert.equal(j.wordy_message, '');
  });
}
await aok('compare: array reply [] -> 200 not-incompatible (no crash)', async () => {
  stubModel('[]');
  let res;
  try { res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG, IMG] })); }
  catch (e) { assert.fail(`handler threw: ${e.message}`); }
  finally { restoreFetch(); }
  assert.equal(res.status, 200);
  assert.equal((await res.json()).incompatible, false);
});
await aok('compare: valid object reply is byte-identical (incompatible passthrough)', async () => {
  stubModel('{"incompatible":true,"reason":"different faces","wordy_message":"hey these two look like different kids — which one?"}');
  const res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG, IMG] }));
  restoreFetch();
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.incompatible, true);
  assert.equal(j.reason, 'different faces');
  assert.match(j.wordy_message, /different kids/);
});
await aok('compare: fenced valid object still parses (fence-strip parity)', async () => {
  stubModel('```json\n{"incompatible":false,"reason":"","wordy_message":""}\n```');
  const res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG, IMG] }));
  restoreFetch();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).incompatible, false);
});
await aok('compare: genuinely non-JSON reply -> 502 parse_failed (back-compat)', async () => {
  stubModel('sorry, I cannot do that');
  const res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG, IMG] }));
  restoreFetch();
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'parse_failed');
});
await aok('compare: <2 valid images -> 200 fallback BEFORE any model call', async () => {
  // no fetch stub: if it tried to fetch the real network this would throw/hang
  const res = await compare(postCompare({ character_name: 'Scarlet', images: [IMG] }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).incompatible, false);
});

// ── TITLE: the fix — a bare-null reply is a clean 200 empty title, not 500 ──
for (const reply of ['null', '```json\nnull\n```']) {
  await aok(`title: model reply ${JSON.stringify(reply)} -> 200 empty title (was 500 crash)`, async () => {
    stubModel(reply);
    let res;
    try { res = await title(postTitle({ blocks: [{ text: 'Once upon a time the dragon woke up.' }] })); }
    catch (e) { assert.fail(`handler threw (HTTP 500): ${e.message}`); }
    finally { restoreFetch(); }
    assert.equal(res.status, 200, 'bare-null reply must degrade to 200, not crash');
    assert.equal((await res.json()).title, '');
  });
}
await aok('title: valid object reply is byte-identical (title passthrough + quote strip)', async () => {
  stubModel('{"title":"The Apocalypse Box"}');
  const res = await title(postTitle({ blocks: [{ text: 'A box that ends the world.' }] }));
  restoreFetch();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, 'The Apocalypse Box');
});
await aok('title: genuinely non-JSON reply -> 502 parse_failed (back-compat)', async () => {
  stubModel('here is a title for you');
  const res = await title(postTitle({ blocks: [{ text: 'A box.' }] }));
  restoreFetch();
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'parse_failed');
});
await aok('title: no usable blocks -> 200 empty title BEFORE any model call', async () => {
  const res = await title(postTitle({ blocks: [] }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).title, '');
});

console.log(`\nqss-model-null-parse: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
