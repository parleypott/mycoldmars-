// Locks the QSS block-summaries Henry-facing normalization (api/_lib/block-summaries.js).
// The load-bearing property: zipSummaries maps the model's reply back onto the
// blocks IN INPUT ORDER, keyed by id — the client zips block ↔ summary by
// position, so a regression (returning model order, or attaching by the wrong
// key) silently shows every story-spine brick the WRONG block's "what happens".
//
// Mutation-proven a real verifier:
//   - zip by list index instead of id-map        -> wrong-block attachment RED
//   - drop the >120 clamp                          -> over-long summary RED
//   - drop the empty-text filter in select         -> empty block included RED
//   - drop the .slice(0, MAX_BLOCKS) cap            -> 61st block included RED

import {
  selectSummarizableBlocks,
  zipSummaries,
  MAX_BLOCKS,
  MAX_ID_LEN,
  MAX_TEXT_LEN,
  MAX_SUMMARY_LEN,
} from './_lib/block-summaries.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  got:  ${A}\n  want: ${B}`); }
};
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.error(`FAIL: ${msg}`); } };

// ---------- RED PROOF: the OLD-style index-zip attaches the wrong block ----------
// Reconstruct the bug a regression would reintroduce: zip the model's reply by
// LIST POSITION instead of by id. The model is free to return ITS OWN order, so
// position-zipping mis-attaches.
function zipByIndex(blocks, parsed) {
  const list = Array.isArray(parsed?.summaries) ? parsed.summaries : [];
  return blocks.map((b, i) => ({ id: b.id, summary: (list[i]?.summary || '') }));
}
{
  const blocks = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }];
  // Model returned them in REVERSE order (legal — it keys by id, not position).
  const parsed = { summaries: [{ id: 'b', summary: 'beta happens' }, { id: 'a', summary: 'alpha happens' }] };
  const buggy = zipByIndex(blocks, parsed);
  ok(buggy[0].summary === 'beta happens', 'RED proof: index-zip mis-attaches block a → block b summary');
  const fixed = zipSummaries(blocks, parsed);
  eq(fixed, [{ id: 'a', summary: 'alpha happens' }, { id: 'b', summary: 'beta happens' }],
    'zipSummaries keys by id, not position — correct attachment regardless of model order');
}

// ---------- zipSummaries: input-order preservation ----------
{
  const blocks = [{ id: 'b1', text: 't' }, { id: 'b2', text: 't' }, { id: 'b3', text: 't' }];
  const parsed = { summaries: [
    { id: 'b3', summary: 'third' }, { id: 'b1', summary: 'first' }, { id: 'b2', summary: 'second' },
  ] };
  eq(zipSummaries(blocks, parsed).map(s => s.id), ['b1', 'b2', 'b3'], 'output in INPUT order');
  eq(zipSummaries(blocks, parsed).map(s => s.summary), ['first', 'second', 'third'], 'each block its own summary');
}

// ---------- zipSummaries: missing / extra / malformed ----------
{
  const blocks = [{ id: 'a', text: 't' }, { id: 'b', text: 't' }];
  // model omits b, adds an extra unknown id
  const parsed = { summaries: [{ id: 'a', summary: 'aa' }, { id: 'zzz', summary: 'ghost' }] };
  eq(zipSummaries(blocks, parsed), [{ id: 'a', summary: 'aa' }, { id: 'b', summary: '' }],
    'block missing from model → ""; extra model id ignored');
}
{
  const blocks = [{ id: 'a', text: 't' }];
  eq(zipSummaries(blocks, { summaries: [null, 5, 'x', { summary: 'no id' }, { id: '', summary: 'empty id' }, { id: 'a', summary: 'good' }] }),
    [{ id: 'a', summary: 'good' }], 'malformed items (null/number/string/no-id/empty-id) dropped');
}
{
  const blocks = [{ id: 'a', text: 't' }];
  // duplicate id → last wins (deterministic)
  eq(zipSummaries(blocks, { summaries: [{ id: 'a', summary: 'first' }, { id: 'a', summary: 'last' }] }),
    [{ id: 'a', summary: 'last' }], 'duplicate model id → last-wins');
}
{
  const blocks = [{ id: 'a', text: 't' }, { id: 'b', text: 't' }];
  eq(zipSummaries(blocks, {}), [{ id: 'a', summary: '' }, { id: 'b', summary: '' }], 'no summaries field → all ""');
  eq(zipSummaries(blocks, null), [{ id: 'a', summary: '' }, { id: 'b', summary: '' }], 'null parsed → all "" no-throw');
  eq(zipSummaries(blocks, { summaries: 'nope' }), [{ id: 'a', summary: '' }, { id: 'b', summary: '' }], 'non-array summaries → all ""');
  eq(zipSummaries([], { summaries: [{ id: 'a', summary: 'x' }] }), [], 'no blocks → []');
  eq(zipSummaries(null, { summaries: [] }), [], 'null blocks → [] no-throw');
}

// ---------- zipSummaries: summary normalization ----------
{
  const blocks = [{ id: 'a', text: 't' }];
  eq(zipSummaries(blocks, { summaries: [{ id: 'a', summary: '  trimmed  ' }] }), [{ id: 'a', summary: 'trimmed' }], 'summary trimmed');
  eq(zipSummaries(blocks, { summaries: [{ id: 'a' }] }), [{ id: 'a', summary: '' }], 'missing summary → ""');
  eq(zipSummaries(blocks, { summaries: [{ id: 'a', summary: 42 }] }), [{ id: 'a', summary: '42' }], 'numeric summary coerced');
  // over-long clamp: 130 chars → 117 + ellipsis (118 total)
  const long = 'x'.repeat(130);
  const r = zipSummaries(blocks, { summaries: [{ id: 'a', summary: long }] })[0].summary;
  ok(r.length === 118 && r.endsWith('…') && r.slice(0, 117) === 'x'.repeat(117), 'summary >120 clamped to 117+…');
  // exactly 120 → kept as-is
  const exact = 'y'.repeat(120);
  eq(zipSummaries(blocks, { summaries: [{ id: 'a', summary: exact }] })[0].summary, exact, 'summary at MAX_SUMMARY_LEN kept verbatim');
  ok(MAX_SUMMARY_LEN === 120, 'MAX_SUMMARY_LEN is 120');
}
{
  // id is sliced to MAX_ID_LEN on the model side too, so a model echoing the long id still matches
  const longId = 'z'.repeat(100);
  const blocks = selectSummarizableBlocks([{ id: longId, text: 't' }]); // id now 80 chars
  const slicedId = 'z'.repeat(MAX_ID_LEN);
  eq(zipSummaries(blocks, { summaries: [{ id: slicedId, summary: 'matched' }] }), [{ id: slicedId, summary: 'matched' }],
    'model id sliced to MAX_ID_LEN matches the sliced block id');
}

// ---------- selectSummarizableBlocks ----------
{
  eq(selectSummarizableBlocks([{ id: 'a', text: 'hi' }]), [{ id: 'a', text: 'hi' }], 'keeps a usable block');
  eq(selectSummarizableBlocks([{ id: 'a', text: '   ' }]), [], 'drops whitespace-only text');
  eq(selectSummarizableBlocks([{ id: 'a', text: '' }]), [], 'drops empty text');
  eq(selectSummarizableBlocks([{ text: 'hi' }]), [], 'drops missing id');
  eq(selectSummarizableBlocks([{ id: '', text: 'hi' }]), [], 'drops empty id');
  eq(selectSummarizableBlocks([null, 5, 'x', { id: 'a', text: 'hi' }]), [{ id: 'a', text: 'hi' }], 'drops non-object items');
  eq(selectSummarizableBlocks(null), [], 'non-array → []');
  eq(selectSummarizableBlocks(undefined), [], 'undefined → []');
}
{
  // cap at MAX_BLOCKS
  const many = Array.from({ length: MAX_BLOCKS + 5 }, (_, i) => ({ id: 'b' + i, text: 't' }));
  const sel = selectSummarizableBlocks(many);
  ok(sel.length === MAX_BLOCKS, `caps at MAX_BLOCKS (${MAX_BLOCKS})`);
  ok(sel[sel.length - 1].id === 'b' + (MAX_BLOCKS - 1), 'keeps the FIRST MAX_BLOCKS in order');
  ok(MAX_BLOCKS === 60, 'MAX_BLOCKS is 60');
}
{
  // id sliced to 80, text sliced to 1200
  const sel = selectSummarizableBlocks([{ id: 'z'.repeat(120), text: 'w'.repeat(2000) }]);
  ok(sel[0].id.length === MAX_ID_LEN, 'id sliced to MAX_ID_LEN');
  ok(sel[0].text.length === MAX_TEXT_LEN, 'text sliced to MAX_TEXT_LEN');
  ok(MAX_ID_LEN === 80 && MAX_TEXT_LEN === 1200, 'id/text caps are 80/1200');
}
{
  // numeric id coerced to string, preserved as a usable block
  eq(selectSummarizableBlocks([{ id: 7, text: 'hi' }]), [{ id: '7', text: 'hi' }], 'numeric id coerced to string');
}

// ---------- end-to-end: select → zip round-trips the spine in order ----------
{
  const raw = [
    { id: 'k1', text: 'Kevin straps on the calculator helmet and marches in.' },
    { id: 'k2', text: '' }, // dropped by select
    { id: 'k3', text: 'A glowing barrel rolls across the cafeteria.' },
  ];
  const blocks = selectSummarizableBlocks(raw);
  eq(blocks.map(b => b.id), ['k1', 'k3'], 'select drops the empty block, keeps order');
  // model replies out of order
  const parsed = { summaries: [
    { id: 'k3', summary: 'a glowing barrel rolls in' },
    { id: 'k1', summary: 'kevin straps on the helmet' },
  ] };
  eq(zipSummaries(blocks, parsed), [
    { id: 'k1', summary: 'kevin straps on the helmet' },
    { id: 'k3', summary: 'a glowing barrel rolls in' },
  ], 'spine zips correctly in input order despite reversed model reply');
}

console.log(`\nblock-summaries: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
