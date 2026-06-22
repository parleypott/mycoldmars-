// Locks buildGeminiReport — the Gemini deep-research report assembler.
// Imports the REAL shipped function. Mutation-proven a real verifier.
import assert from 'node:assert';
import { buildGeminiReport } from './_lib/research-gemini-report.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`FAIL: ${name}\n  ${e.message}`); } };

// ---- helpers to build a realistic Gemini generateContent response ----
const resp = ({ text = 'Body.', chunks = [], queries = [] } = {}) => ({
  candidates: [{
    content: { parts: text == null ? undefined : [{ text }] },
    groundingMetadata: {
      groundingChunks: chunks.map(uri => (uri == null ? {} : { web: { uri } })),
      webSearchQueries: queries,
    },
  }],
});

// ---- inline RED proof: the OLD inline assembler returned the RAW (non-deduped)
//      chunk count, overstating the sources the report actually lists ----
function oldInlineCounts(data) {
  const cand = data.candidates?.[0];
  const sources = [];
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    if (ch.web?.uri) sources.push(ch.web.uri);
  }
  return sources.length; // RAW count — the bug
}
t('RED proof: old inline count is RAW (overstates) on duplicate chunks', () => {
  // 4 chunks, 2 unique URIs (Gemini repeats a uri across grounding spans)
  const data = resp({ chunks: ['https://a.com', 'https://b.com', 'https://a.com', 'https://b.com'] });
  assert.strictEqual(oldInlineCounts(data), 4, 'old code counts 4 raw chunks');
  const { sources, report } = buildGeminiReport(data);
  assert.strictEqual(sources, 2, 'fixed: count is the deduped 2');
  // and the report lists exactly 2 sources, matching the count
  assert.ok(report.includes('1. https://a.com'));
  assert.ok(report.includes('2. https://b.com'));
  assert.ok(!report.includes('3. '), 'no third source listed');
});

// ---- the fix: count matches what the report lists ----
t('deduped source count matches the listed Sources', () => {
  const data = resp({ chunks: ['https://x.io', 'https://x.io', 'https://y.io'] });
  const { sources, report } = buildGeminiReport(data);
  assert.strictEqual(sources, 2);
  const listed = (report.match(/^\d+\. https?:\/\//gm) || []).length;
  assert.strictEqual(listed, sources, 'every listed source counted, no overstatement');
});

t('all-distinct sources: count == listed == raw', () => {
  const data = resp({ chunks: ['https://a', 'https://b', 'https://c'] });
  const { sources } = buildGeminiReport(data);
  assert.strictEqual(sources, 3);
});

t('Sources section numbered 1..n in order, deduped preserves first-seen order', () => {
  const data = resp({ chunks: ['https://z', 'https://a', 'https://z', 'https://m'] });
  const { report } = buildGeminiReport(data);
  const idx = report.indexOf('## Sources');
  const tail = report.slice(idx);
  assert.ok(/1\. https:\/\/z\n2\. https:\/\/a\n3\. https:\/\/m/.test(tail), tail);
});

// ---- text extraction ----
t('text joins parts with newline and trims', () => {
  const data = {
    candidates: [{
      content: { parts: [{ text: 'one' }, { text: 'two' }] },
      groundingMetadata: { groundingChunks: [], webSearchQueries: [] },
    }],
  };
  const { report } = buildGeminiReport(data);
  assert.strictEqual(report, 'one\ntwo');
});

t('missing text part coerces to empty string (no "undefined")', () => {
  const data = {
    candidates: [{
      content: { parts: [{ text: 'kept' }, {}] },
      groundingMetadata: {},
    }],
  };
  const { report } = buildGeminiReport(data);
  assert.strictEqual(report, 'kept'); // ['kept',''].join('\n').trim()
  assert.ok(!report.includes('undefined'));
});

t('absent candidate content -> "(empty)" body', () => {
  const { report } = buildGeminiReport({ candidates: [{}] });
  assert.strictEqual(report, '(empty)');
});

t('no candidates at all -> "(empty)", no throw', () => {
  assert.strictEqual(buildGeminiReport({ candidates: [] }).report, '(empty)');
  assert.strictEqual(buildGeminiReport({}).report, '(empty)');
});

t('null/undefined data -> "(empty)", no throw (hardening)', () => {
  assert.strictEqual(buildGeminiReport(null).report, '(empty)');
  assert.strictEqual(buildGeminiReport(undefined).report, '(empty)');
  assert.strictEqual(buildGeminiReport(null).sources, 0);
});

// ---- conditional sections ----
t('no sources -> no "## Sources" section, count 0', () => {
  const data = resp({ text: 'Just prose.', chunks: [] });
  const { report, sources } = buildGeminiReport(data);
  assert.ok(!report.includes('## Sources'));
  assert.strictEqual(sources, 0);
});

t('chunks without web.uri are ignored', () => {
  const data = resp({ chunks: [null, 'https://real', null] });
  const { sources, report } = buildGeminiReport(data);
  assert.strictEqual(sources, 1);
  assert.ok(report.includes('1. https://real'));
});

t('queries footer present when queries exist', () => {
  const data = resp({ queries: ['foo bar', 'baz'] });
  const { report, queries } = buildGeminiReport(data);
  assert.strictEqual(queries, 2);
  assert.ok(report.includes('_Search queries used: `foo bar`, `baz`_'));
});

t('no queries -> no queries footer, count 0', () => {
  const data = resp({ queries: [] });
  const { report, queries } = buildGeminiReport(data);
  assert.ok(!report.includes('Search queries used'));
  assert.strictEqual(queries, 0);
});

t('full report: text + deduped Sources + queries footer in order', () => {
  const data = resp({
    text: 'Report body here.',
    chunks: ['https://one', 'https://one', 'https://two'],
    queries: ['q1'],
  });
  const { report, sources, queries } = buildGeminiReport(data);
  assert.strictEqual(sources, 2);
  assert.strictEqual(queries, 1);
  const tIdx = report.indexOf('Report body here.');
  const sIdx = report.indexOf('## Sources');
  const qIdx = report.indexOf('Search queries used');
  assert.ok(tIdx >= 0 && sIdx > tIdx && qIdx > sIdx, 'body -> sources -> queries order');
});

t('returns the three-field shape', () => {
  const out = buildGeminiReport(resp());
  assert.deepStrictEqual(Object.keys(out).sort(), ['queries', 'report', 'sources']);
  assert.strictEqual(typeof out.report, 'string');
  assert.strictEqual(typeof out.sources, 'number');
  assert.strictEqual(typeof out.queries, 'number');
});

console.log(`\nresearch-gemini-report: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
