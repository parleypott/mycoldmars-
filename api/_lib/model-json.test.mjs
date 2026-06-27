// Tests for api/_lib/model-json.js — the shared fence-strip + object-guard parser
// that closes the bare-null-reply crash class in qss-block-summaries + qss-scene-build.
//
// Run: node api/_lib/model-json.test.mjs   (also auto-discovered by `bun run test`)
//
// Outside signal under the deploy freeze: the live endpoints are auth-gated + Sonnet/
// Haiku-backed (can't drive headless), so a deterministic test importing the REAL
// shipped helper is the strongest verification. Mutation-proven: see the RED proofs.

import { parseModelObject, stripCodeFence, extractBalancedJSON } from './model-json.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ── RED PROOF ───────────────────────────────────────────────────────────────
// Reconstruct the EXACT inline dance both endpoints shipped before this fix and
// prove it CRASHES on a bare-null reply (the 500 bug). The shipped parseModelObject
// must instead return a safe object so the caller's `parsed.<prop>` never throws.
function oldShippedDance(rawText) {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleaned); // JSON.parse('null') === null
  // The post-try property access that the old handlers did (block-summaries / scene-build):
  return Array.isArray(parsed.summaries) ? parsed.summaries : [];
}
{
  // The old dance throws on bare null...
  let threw = false;
  try { oldShippedDance('null'); } catch (e) { threw = e instanceof TypeError; }
  ok(threw, 'RED proof: old inline dance THROWS TypeError on a bare "null" reply');

  let threw2 = false;
  try { oldShippedDance('```json\nnull\n```'); } catch (e) { threw2 = e instanceof TypeError; }
  ok(threw2, 'RED proof: old inline dance THROWS on a fence-wrapped null reply');

  // ...the shipped helper does NOT — it returns a safe object so `.summaries` is fine.
  const r1 = parseModelObject('null');
  ok(r1.ok === true, 'bare null → ok:true (valid JSON, just empty)');
  ok(r1.value && typeof r1.value === 'object', 'bare null → value is a non-null object');
  ok(!Array.isArray(r1.value.summaries), 'bare null → value.summaries access is SAFE (undefined, no throw)');

  const r2 = parseModelObject('```json\nnull\n```');
  ok(r2.ok === true && r2.value && typeof r2.value === 'object', 'fence-wrapped null → safe object');
}

// ── invalid JSON → ok:false (caller maps to 502, preserving existing behavior) ─
{
  eq(parseModelObject('not json at all').ok, false, 'garbage text → ok:false');
  eq(parseModelObject('{unterminated').ok, false, 'unterminated object → ok:false');
  eq(parseModelObject('{"a":').ok, false, 'truncated → ok:false');
  // even on ok:false, value is a usable object (never null) so a careless caller is safe
  ok(parseModelObject('garbage').value && typeof parseModelObject('garbage').value === 'object',
    'ok:false still returns a non-null object value');
}

// ── valid object passthrough ──────────────────────────────────────────────────
{
  const r = parseModelObject('{"summaries":[{"id":"a","summary":"x"}]}');
  ok(r.ok === true, 'valid object → ok:true');
  ok(Array.isArray(r.value.summaries) && r.value.summaries.length === 1, 'valid object → fields preserved');
  eq(r.value.summaries[0].id, 'a', 'nested field intact');

  const sb = parseModelObject('{"scenes":[{"first_line":"once upon a time there"}],"characters":[]}');
  ok(Array.isArray(sb.value.scenes) && sb.value.scenes.length === 1, 'scene-build shape: scenes preserved');
  ok(Array.isArray(sb.value.characters), 'scene-build shape: characters preserved');
}

// ── fence handling (byte-identical to the old inline regex) ────────────────────
{
  eq(stripCodeFence('```json\n{"a":1}\n```'), '{"a":1}', 'strips ```json fence');
  eq(stripCodeFence('```\n{"a":1}\n```'), '{"a":1}', 'strips bare ``` fence');
  eq(stripCodeFence('  {"a":1}  '), '{"a":1}', 'trims surrounding whitespace');
  eq(stripCodeFence('{"a":1}'), '{"a":1}', 'no fence → unchanged');
  eq(stripCodeFence('```JSON\n{"a":1}\n```'), '{"a":1}', 'case-insensitive json tag');
  eq(stripCodeFence(null), '', 'null input → empty string (no throw)');
  eq(stripCodeFence(undefined), '', 'undefined input → empty string (no throw)');

  // parse round-trips through the fence
  const r = parseModelObject('```json\n{"summaries":[]}\n```');
  ok(r.ok && Array.isArray(r.value.summaries), 'fence-wrapped valid object parses to fields');
}

// ── primitives coerced to {} (the crash class) ────────────────────────────────
{
  for (const [text, label] of [['42', 'number'], ['"hi"', 'string'], ['true', 'boolean']]) {
    const r = parseModelObject(text);
    ok(r.ok === true, `${label} reply → ok:true`);
    ok(r.value && typeof r.value === 'object' && !Array.isArray(r.value),
      `${label} reply → value coerced to plain object (safe for .prop access)`);
  }
  // array passes through as an object (callers read named props → Array.isArray(arr.prop) is false)
  const arr = parseModelObject('[1,2,3]');
  ok(arr.ok === true && typeof arr.value === 'object', 'array reply → ok:true, object-typed');
  ok(!Array.isArray(arr.value.summaries), 'array reply → .summaries access is safe (undefined)');
}

// ── empty / whitespace ────────────────────────────────────────────────────────
{
  eq(parseModelObject('').ok, false, 'empty string → ok:false (not valid JSON)');
  eq(parseModelObject('   ').ok, false, 'whitespace only → ok:false');
  eq(parseModelObject(null).ok, false, 'null arg → ok:false');
  eq(parseModelObject(undefined).ok, false, 'undefined arg → ok:false');
}

// ── prose-tolerant fallback (leading preamble OR trailing aside) ──────────────
// The qss-scene-detect / qss-explorer endpoints used to slice from the first `{`
// then JSON.parse the REST — which throws on a TRAILING aside ("{…} hope it
// helps!"), dropping Henry's whole scene/explorer batch. parseModelObject now
// falls back to a string-aware balanced matcher that ignores surrounding prose.
{
  // RED proof: the exact old slicer dance THROWS on trailing prose.
  function oldSlicer(rawText) {
    let cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const fb = cleaned.indexOf('{');
    if (fb > 0) cleaned = cleaned.slice(fb);
    return JSON.parse(cleaned); // throws on trailing non-whitespace
  }
  let threw = false;
  try { oldSlicer('{"scenes":[{"scene_index":0}]}\n\nHope that helps!'); }
  catch { threw = true; }
  ok(threw, 'RED proof: old slicer THROWS on a trailing aside after the JSON');

  // The shipped parser recovers it.
  const tail = parseModelObject('{"scenes":[{"scene_index":0}]}\n\nHope that helps!');
  ok(tail.ok === true && Array.isArray(tail.value.scenes) && tail.value.scenes.length === 1,
    'trailing aside → recovered scenes array');

  const lead = parseModelObject('Sure! Here you go:\n{"items":[{"id":1},{"id":2}]}');
  ok(lead.ok === true && Array.isArray(lead.value.items) && lead.value.items.length === 2,
    'leading preamble → recovered items array');

  const both = parseModelObject('Here:\n```json\n{"items":[{"id":1}]}\n```\nlet me know!');
  ok(both.ok === true && Array.isArray(both.value.items) && both.value.items.length === 1,
    'fence + prose on both sides → recovered');

  // A literal brace INSIDE a string value must not close the object early.
  const innerBrace = parseModelObject('{"items":[{"caption":"the cost was high }"}]} trailing words');
  ok(innerBrace.ok === true && innerBrace.value.items[0].caption === 'the cost was high }',
    'string-internal `}` does not miscount depth (string-aware)');

  // Top-level array with surrounding prose, too.
  const arrProse = parseModelObject('Items:\n[{"id":1}]\ndone');
  ok(arrProse.ok === true && typeof arrProse.value === 'object',
    'array-with-prose → ok:true (object-typed value)');
}

// ── extractBalancedJSON direct contract ───────────────────────────────────────
{
  ok(extractBalancedJSON('no json here') === undefined, 'no bracket → undefined');
  ok(extractBalancedJSON('{unterminated') === undefined, 'unbalanced → undefined');
  const v = extractBalancedJSON('prefix {"a":1} suffix');
  ok(v && v.a === 1, 'balanced object extracted, prose ignored');
  // first balanced object wins when two are present
  const first = extractBalancedJSON('{"a":1} {"b":2}');
  ok(first && first.a === 1 && first.b === undefined, 'first balanced object wins');
}

console.log(`model-json: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗', f); process.exit(1); }
