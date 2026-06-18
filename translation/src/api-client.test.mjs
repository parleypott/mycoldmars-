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
import { extractJSON, isGenericSpeaker } from './api-client.js';

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

console.log(`\napi-client.test.mjs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
