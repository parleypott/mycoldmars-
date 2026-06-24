// Tests for api-client.js pure cores — focus on extractJSON, the JSON-from-LLM
// extractor that feeds the WHOLE interpreter translation pipeline (analyze,
// translate, themes, soundbites, polish — 5 call sites). Its 3rd-tier fallback
// brace matcher used a naive depth counter that miscounted when a JSON string
// VALUE contained a literal bracket (a transcript string like `[inaudible` or a
// note ending in `}`) — closing the structure early (or never), throwing away
// the entire model response. Same bug class as sot-hunter parseHunterJSON and
// qss-arc-extract balanceJson. This locks the string-aware fix + the surrounding
// already-correct paths so it can't regress.
// Run: node translation/src/api-client.test.mjs  (or via `bun run test`)
import { extractJSON, isGenericSpeaker, reassembleBatch } from './api-client.js';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}
function threw(fn, label) {
  let t = false;
  try { fn(); } catch { t = true; }
  if (t) { pass++; }
  else { fail++; console.error(`FAIL (expected throw): ${label}`); }
}
// Safe-call extractJSON so a regression that makes it THROW (e.g. reverting the
// string-aware matcher) produces a counted FAIL rather than aborting the run.
function eqJSON(input, expected, label) {
  let actual;
  try { actual = extractJSON(input); }
  catch (e) { fail++; console.error(`FAIL (unexpected throw): ${label}\n  ${e.message}`); return; }
  eq(actual, expected, label);
}
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${label}`); }
}

// ── Reconstruct the OLD naive matcher as an inline RED proof. These assertions
//    document that the shipped fix is load-bearing: the old code THROWS on the
//    realistic prose-wrapped-with-bracket cases the new code recovers. ──
function oldExtractJSON(text) {
  try { return JSON.parse(text.trim()); } catch {}
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}
  const startArr = text.indexOf('['), startObj = text.indexOf('{');
  const start = startArr === -1 ? startObj : startObj === -1 ? startArr : Math.min(startArr, startObj);
  if (start !== -1) {
    const open = text[start], close = open === '[' ? ']' : '}';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) depth--;
      if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch {} break; }
    }
  }
  throw new Error('Could not parse response from Claude');
}

// ── RED proof: the load-bearing cases. Old throws; new recovers. ──
{
  const objLoneClose = `Here you go: {"summary": "the deal collapsed }"}`;
  threw(() => oldExtractJSON(objLoneClose), 'RED: old matcher throws on object string-value with lone }');
  eqJSON(objLoneClose, { summary: 'the deal collapsed }' }, 'object: lone } inside a string value is recovered');

  const arrLoneOpen = `Sure: [{"text": "she said [inaudible"}]`;
  threw(() => oldExtractJSON(arrLoneOpen), 'RED: old matcher throws on array string-value with lone [');
  eqJSON(arrLoneOpen, [{ text: 'she said [inaudible' }], 'array: lone [ inside a string value is recovered');

  const objCloseThenMore = `Result: {"note": "ends here }", "ok": true}`;
  threw(() => oldExtractJSON(objCloseThenMore), 'RED: old matcher throws on } in string before more keys');
  eqJSON(objCloseThenMore, { note: 'ends here }', ok: true }, 'object: } in string does not truncate remaining keys');
}

// ── Tier 1: clean JSON parses directly (most common path). ──
eqJSON('{"a":1}', { a: 1 }, 'clean object');
eqJSON('[1,2,3]', [1, 2, 3], 'clean array');
eqJSON('  \n {"a":1} \n ', { a: 1 }, 'clean object with surrounding whitespace (trim)');
eqJSON('"just a string"', 'just a string', 'clean bare JSON string');
eqJSON('42', 42, 'clean bare number');

// ── Tier 2: fenced code block. ──
eqJSON('```json\n{"a":1}\n```', { a: 1 }, 'fenced json block');
eqJSON('```\n[1,2]\n```', [1, 2], 'fenced block, no lang tag');
eqJSON('Sure!\n```json\n{"k":"v"}\n```\nHope that helps',
   { k: 'v' }, 'fenced block surrounded by prose');
// A fenced value whose string contains a brace must survive (fence path parses it whole).
eqJSON('```json\n{"q":"a } b"}\n```', { q: 'a } b' }, 'fenced value containing a brace');

// ── Tier 3: prose-wrapped, no fence — the string-aware matcher. ──
eqJSON('The answer is {"x": 5} and that is all', { x: 5 }, 'prose-wrapped object');
eqJSON('Items: [{"id":1},{"id":2}] done', [{ id: 1 }, { id: 2 }], 'prose-wrapped array of objects');
// First bracket wins: object before array.
eqJSON('text {"o":1} then [9]', { o: 1 }, 'object appears before array -> object chosen');
eqJSON('text [1] then {"o":1}', [1], 'array appears before object -> array chosen');

// ── Brackets INSIDE strings must not move structural depth. ──
eqJSON('out: {"v": "wide {shot} of the [market]"}',
   { v: 'wide {shot} of the [market]' }, 'balanced brackets inside a string value');
eqJSON('out: [{"t":"[crosstalk] hello"},{"t":"bye"}]',
   [{ t: '[crosstalk] hello' }, { t: 'bye' }], 'bracketed transcript markers inside array strings');
eqJSON('x {"a":"he said \\"hi}\\" loudly"}',
   { a: 'he said "hi}" loudly' }, 'escaped quote + brace inside string');
eqJSON('x {"path":"C:\\\\dir\\\\file"}',
   { path: 'C:\\dir\\file' }, 'escaped backslashes inside string');

// ── Nested structures. ──
eqJSON('note {"a":{"b":{"c":1}}} end', { a: { b: { c: 1 } } }, 'deeply nested object recovered from prose');
eqJSON('[[1,2],[3,4]]', [[1, 2], [3, 4]], 'nested arrays');

// ── Unrecoverable input throws (the documented contract). ──
threw(() => extractJSON('no json here at all'), 'plain prose with no bracket throws');
threw(() => extractJSON('{"a": '), 'genuinely truncated object (never closes) throws');
threw(() => extractJSON('{"a": 1, oops}'), 'malformed object that closes but is invalid throws');

// ── isGenericSpeaker (regression lock — the diarization-label predicate). ──
ok(isGenericSpeaker('Speaker 1') === true, 'Speaker 1 is generic');
ok(isGenericSpeaker('speaker 2') === true, 'lowercase speaker 2 is generic');
ok(isGenericSpeaker('Speaker12') === true, 'Speaker12 (no space) is generic');
ok(isGenericSpeaker('  Speaker 3  ') === true, 'padded Speaker 3 is generic (trim)');
ok(isGenericSpeaker('') === true, 'empty name is generic');
ok(isGenericSpeaker(null) === true, 'null name is generic');
ok(isGenericSpeaker(undefined) === true, 'undefined name is generic');
ok(isGenericSpeaker('Johnny') === false, 'a real name is not generic');
ok(isGenericSpeaker('Speaker Wong') === false, 'Speaker followed by a word is NOT generic');
ok(isGenericSpeaker('260317-04-JERRY') === false, 'a sequence-coded name is not generic');

// ── reassembleBatch — re-attaching the model's batch output to segments. ──
// The original code paired results PURELY by position (`translated[j]`), so one
// dropped/merged item from the model (a real LLM failure on a 20-item list)
// shifted every later segment onto the WRONG translation. reassembleBatch keys
// on the returned `number` first, with positional + pass-through fallbacks.
//
// Reconstruct the OLD positional reassembly as an inline RED proof — it
// mislabels on a dropped middle item where the number-aware version recovers.
function oldReassemble(batch, translated, segments) {
  const arr = Array.isArray(translated) ? translated : [];
  return batch.map(({ resultIndex }, j) => ({
    resultIndex,
    value: arr[j] || {
      number: segments[resultIndex].number,
      original: segments[resultIndex].text,
      translated: segments[resultIndex].text,
      language: 'unknown', kept_original: true,
    },
  }));
}
const seg = (n) => ({ number: n, text: `orig ${n}`, speaker: 'Johnny' });
const tr = (n, txt) => ({ number: n, original: `orig ${n}`, translated: txt, language: 'en', kept_original: false });
// A batch of 3 segments at result indices 10,11,12 (offset to prove indices flow through).
const SEGMENTS = [];
for (let i = 0; i < 13; i++) SEGMENTS.push(seg(i + 1));
const BATCH = [
  { segment: SEGMENTS[10], resultIndex: 10 }, // number 11
  { segment: SEGMENTS[11], resultIndex: 11 }, // number 12
  { segment: SEGMENTS[12], resultIndex: 12 }, // number 13
];

// Happy path: full, in-order, correctly-numbered → byte-identical to positional.
{
  const model = [tr(11, 'A'), tr(12, 'B'), tr(13, 'C')];
  const got = reassembleBatch(BATCH, model, SEGMENTS);
  eq(got.map(g => [g.resultIndex, g.value.translated]),
     [[10, 'A'], [11, 'B'], [12, 'C']], 'happy path maps each segment to its translation');
  eq(reassembleBatch(BATCH, model, SEGMENTS).map(g => g.value.translated),
     oldReassemble(BATCH, model, SEGMENTS).map(g => g.value.translated),
     'happy path identical to old positional behaviour');
}

// THE BUG: model drops the MIDDLE item (returns 11 and 13 only).
{
  const dropped = [tr(11, 'A'), tr(13, 'C')];
  const oldOut = oldReassemble(BATCH, dropped, SEGMENTS);
  // RED proof: old positional pairing snaps seg 12's slot onto C (number 13's
  // translation) and seg 13 falls to the pass-through fallback. Corruption.
  ok(oldOut[1].value.translated === 'C', 'RED: old code mislabels segment 12 with segment 13\'s translation');
  ok(oldOut[2].value.kept_original === true, 'RED: old code drops segment 13 to fallback');

  const got = reassembleBatch(BATCH, dropped, SEGMENTS);
  eq(got[0].value.translated, 'A', 'recover: seg 11 -> A');
  ok(got[1].value.translated === 'orig 12' && got[1].value.kept_original === true,
     'recover: dropped seg 12 falls to its OWN fallback (not seg 13\'s text)');
  eq(got[2].value.translated, 'C', 'recover: seg 13 -> C by number despite the gap');
}

// Reordered output still aligns by number.
{
  const shuffled = [tr(13, 'C'), tr(11, 'A'), tr(12, 'B')];
  const got = reassembleBatch(BATCH, shuffled, SEGMENTS);
  eq(got.map(g => g.value.translated), ['A', 'B', 'C'], 'reordered model output realigned by number');
}

// Stringified numbers from the model still match numeric segment numbers.
{
  const strNums = [{ ...tr(11, 'A'), number: '11' }, { ...tr(12, 'B'), number: '12' }, { ...tr(13, 'C'), number: '13' }];
  const got = reassembleBatch(BATCH, strNums, SEGMENTS);
  eq(got.map(g => g.value.translated), ['A', 'B', 'C'], 'string "11" aligns with numeric segment 11');
}

// Untagged objects (model omitted `number`) fall back to positional pairing.
{
  const untagged = [{ translated: 'A' }, { translated: 'B' }, { translated: 'C' }];
  const got = reassembleBatch(BATCH, untagged, SEGMENTS);
  eq(got.map(g => g.value.translated), ['A', 'B', 'C'], 'untagged output uses positional fallback');
}

// A mis-numbered object is NOT snapped onto a slot — that slot takes its fallback.
{
  const wrongNum = [tr(999, 'X'), tr(12, 'B'), tr(13, 'C')];
  const got = reassembleBatch(BATCH, wrongNum, SEGMENTS);
  ok(got[0].value.kept_original === true && got[0].value.translated === 'orig 11',
     'mis-numbered object does not hijack seg 11; seg 11 takes its fallback');
  eq(got[1].value.translated, 'B', 'seg 12 still aligns by number');
}

// Non-array model reply (null / object) → every segment to its fallback, no throw.
{
  const got = reassembleBatch(BATCH, null, SEGMENTS);
  ok(got.length === 3 && got.every(g => g.value.kept_original === true), 'null model reply -> all fallbacks, no crash');
  const got2 = reassembleBatch(BATCH, { not: 'an array' }, SEGMENTS);
  ok(got2.every(g => g.value.kept_original === true), 'non-array object reply -> all fallbacks');
}

// resultIndex passes through untouched (the slot the value lands in).
{
  const got = reassembleBatch(BATCH, [tr(11, 'A'), tr(12, 'B'), tr(13, 'C')], SEGMENTS);
  eq(got.map(g => g.resultIndex), [10, 11, 12], 'resultIndex preserved for write-back');
}

console.log(`\napi-client.test.mjs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
