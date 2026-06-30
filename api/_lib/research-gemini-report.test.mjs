// Tests for the Gemini deep-research report assembler (api/_lib/research-gemini-report.js).
// Imports the REAL shipped function. Locks the load-bearing CONTRACT the file's own
// header documents: the returned `sources` count is the DEDUPED count — it must equal
// the number of sources the "## Sources" list actually renders, NOT the raw chunk count.
// The frontend renders "grounded on N sources" from this number, so an overcount lies
// to Johnny about how many distinct sources the report shows. (The old inline code in
// api/research-gemini.js returned the raw groundingChunks count, overstating it.)
import { buildGeminiReport } from './research-gemini-report.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

// Count the "N. url" lines actually rendered under "## Sources" in the markdown.
function listedSourceCount(report) {
  const m = report.match(/## Sources\n([\s\S]*?)(\n\n_Search queries|$)/);
  if (!m) return 0;
  return m[1].split('\n').filter(l => /^\d+\.\s/.test(l)).length;
}

// A realistic Gemini response: groundingChunks repeat the same web.uri across multiple
// grounding spans (one source cited many times), plus a chunk with no web.uri.
const realistic = {
  candidates: [{
    content: { parts: [{ text: 'Para one.' }, { text: 'Para two.' }] },
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: 'https://a.com/x' } },
        { web: { uri: 'https://a.com/x' } }, // dup of #1 — same source, second span
        { web: { uri: 'https://b.com/y' } },
        { retrievedContext: { text: 'no web uri here' } }, // not a web source — skipped
      ],
      webSearchQueries: ['taiwan identity', 'kmt poll'],
    },
  }],
};

// ── RED PROOF: the old inline path returned the RAW chunk count. ──
function oldRawSourceCount(data) {
  const cand = data?.candidates?.[0];
  let n = 0;
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    if (ch.web?.uri) n++; // raw web-bearing count, NO dedup
  }
  return n;
}
t('RED proof: raw count (3) overstates the deduped list (2)', () => {
  assert.equal(oldRawSourceCount(realistic), 3);          // the bug: counts the dup
  assert.equal(buildGeminiReport(realistic).sources, 2);  // the fix: deduped
});

t('sources count EQUALS the number of sources the report lists', () => {
  const r = buildGeminiReport(realistic);
  assert.equal(r.sources, listedSourceCount(r.report), 'count must match the rendered list');
  assert.equal(r.sources, 2);
  assert.equal(listedSourceCount(r.report), 2);
});

t('dedup preserves first-seen order in the rendered list', () => {
  const { report } = buildGeminiReport(realistic);
  assert.match(report, /1\. https:\/\/a\.com\/x\n2\. https:\/\/b\.com\/y/);
});

t('the report carries the model text and the queries footer', () => {
  const { report, queries } = buildGeminiReport(realistic);
  assert.match(report, /^Para one\.\nPara two\./);
  assert.equal(queries, 2);
  assert.match(report, /_Search queries used: `taiwan identity`, `kmt poll`_/);
});

t('every grounding chunk pointing at ONE source still counts as one', () => {
  const data = { candidates: [{
    content: { parts: [{ text: 'Body.' }] },
    groundingMetadata: { groundingChunks: Array.from({ length: 9 }, () => ({ web: { uri: 'https://one.example/p' } })) },
  }] };
  const r = buildGeminiReport(data);
  assert.equal(r.sources, 1, '9 spans of the same uri = 1 source');
  assert.equal(listedSourceCount(r.report), 1);
});

t('no grounding metadata → no Sources section, zero counts', () => {
  const r = buildGeminiReport({ candidates: [{ content: { parts: [{ text: 'Just prose.' }] } }] });
  assert.equal(r.sources, 0);
  assert.equal(r.queries, 0);
  assert.equal(r.report, 'Just prose.');
  assert.doesNotMatch(r.report, /## Sources/);
});

t('empty / malformed response degrades to "(empty)" without throwing', () => {
  for (const bad of [undefined, null, {}, { candidates: [] }, { candidates: [{}] }, { candidates: [{ content: {} }] }]) {
    const r = buildGeminiReport(bad);
    assert.equal(r.report, '(empty)');
    assert.equal(r.sources, 0);
    assert.equal(r.queries, 0);
  }
});

t('parts with no .text field are skipped, not stringified as undefined', () => {
  const data = { candidates: [{ content: { parts: [{ text: 'Kept.' }, { inlineData: { mimeType: 'image/png' } }] } }] };
  const r = buildGeminiReport(data);
  assert.equal(r.report, 'Kept.');
  assert.doesNotMatch(r.report, /undefined/);
});

console.log(`\nresearch-gemini-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
