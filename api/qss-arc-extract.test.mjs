// Tests for the arc-extraction salvage cores in api/qss-arc-extract.js:
//   balanceJson  — repairs a truncated LLM JSON tail (the bug fixed here)
//   extractArc   — pulls the arc JSON out of the model's <arc>…</arc> reply,
//                  falling back to balanceJson on a truncated object
//   normalizeArc — coerces/clamps the parsed object into the stored shape
//
// THE BUG: the old balanceJson appended every `]` then every `}` regardless of
// actual nesting, so a truncation inside an array-of-objects — the dominant
// shape for this nested arc schema ({"characters":[{"name":… ) — was closed as
// `]}}` instead of `}]}`, producing invalid JSON. It also never closed an
// unterminated string. Both meant a recoverable, near-complete arc was thrown
// away (extractArc → null) instead of salvaged. Same class as the sot-hunter
// brace-matcher fix.
//
// Run: node api/qss-arc-extract.test.mjs   (also picked up by `bun run test`)

import { balanceJson, extractArc, normalizeArc } from './qss-arc-extract.js';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; fails.push(name); }
}
function eq(name, got, want) {
  ok(name + ` (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));
}
// balanceJson should always emit something JSON.parse can read back.
function parses(name, repaired) {
  let v, good = false;
  try { v = JSON.parse(repaired); good = true; } catch {}
  ok(name + ` → parseable (${JSON.stringify(repaired)})`, good);
  return good ? v : undefined;
}

// ---- INLINE RED PROOF: the OLD logic shattered nested truncations ----
function oldBalanceJson(s) {
  let opens = 0, closes = 0, openSq = 0, closeSq = 0, inStr = false, esc = false;
  for (const c of s) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') opens++;
    else if (c === '}') closes++;
    else if (c === '[') openSq++;
    else if (c === ']') closeSq++;
  }
  return s + ']'.repeat(Math.max(0, openSq - closeSq)) + '}'.repeat(Math.max(0, opens - closes));
}
{
  // The exact array-of-objects truncation the arc schema produces.
  const truncated = '{"synopsis":"ok","characters":[{"name":"Lee"';
  let oldOk = false; try { JSON.parse(oldBalanceJson(truncated)); oldOk = true; } catch {}
  ok('RED: old balanceJson produces INVALID json for array-of-objects truncation', oldOk === false);
  let newOk = false; try { JSON.parse(balanceJson(truncated)); newOk = true; } catch {}
  ok('GREEN: new balanceJson produces VALID json for the same input', newOk === true);
}

// ---- balanceJson: nesting order ----
{
  const v = parses('array-of-objects truncation', balanceJson('{"synopsis":"ok","characters":[{"name":"Lee"'));
  if (v) {
    eq('  synopsis preserved', v.synopsis, 'ok');
    eq('  character name preserved', v.characters?.[0]?.name, 'Lee');
  }
}
{
  // Truncated partway into the SECOND object of an array.
  const v = parses('mid-second-object truncation',
    balanceJson('{"threads":[{"description":"a","status":"open"},{"description":"b'));
  if (v) {
    ok('  first thread intact', v.threads?.[0]?.description === 'a' && v.threads[0].status === 'open');
    eq('  partial second thread kept', v.threads?.[1]?.description, 'b');
  }
}
{
  // Object-inside-array-inside-object, deepest level truncated.
  const v = parses('deep nesting truncation', balanceJson('{"a":{"b":[{"c":1'));
  if (v) eq('  deep value preserved', v.a?.b?.[0]?.c, 1);
}
{
  // Array of arrays — order of closers must be ]] not handled as }}.
  const v = parses('array of arrays', balanceJson('{"grid":[[1,2],[3'));
  if (v) ok('  grid rows preserved', v.grid?.[0]?.[1] === 2 && v.grid?.[1]?.[0] === 3);
}

// ---- balanceJson: unterminated strings ----
{
  const v = parses('unterminated string at tail', balanceJson('{"a":"hel'));
  if (v) eq('  partial string closed', v.a, 'hel');
}
{
  // A `}` sitting INSIDE an open string must not be counted as structural.
  const v = parses('brace inside open string', balanceJson('{"note":"closes } here'));
  if (v) eq('  brace-in-string kept literal', v.note, 'closes } here');
}
{
  // Escaped quote inside a string shouldn't toggle string state.
  const v = parses('escaped quote in string', balanceJson('{"q":"she said \\"hi'));
  if (v) eq('  escaped-quote string closed', v.q, 'she said "hi');
}

// ---- balanceJson: must NOT corrupt already-valid / simple input ----
eq('already-balanced object unchanged', balanceJson('{"a":1}'), '{"a":1}');
eq('already-balanced nested unchanged', balanceJson('{"a":[1,2],"b":{"c":3}}'), '{"a":[1,2],"b":{"c":3}}');
eq('simple single-level truncation', balanceJson('{"a":1'), '{"a":1}');
eq('empty string → empty', balanceJson(''), '');
{
  // A stray unmatched closer should be left alone, not over-closed.
  const out = balanceJson('{"a":1}}');
  ok('stray closer not double-counted', out === '{"a":1}}');
}

// ---- extractArc: end-to-end recovery ----
{
  const full = '<arc>{"synopsis":"Kevin accepts the helmet.","characters":[{"name":"Kevin","intro_block":1,"current_state":"resigned"}],"confidence":0.4}</arc>';
  const arc = extractArc(full);
  ok('extractArc parses a clean <arc> wrapper', !!arc);
  eq('  synopsis', arc.synopsis, 'Kevin accepts the helmet.');
  eq('  character', arc.characters[0].name, 'Kevin');
  eq('  confidence clamped/kept', arc.confidence, 0.4);
}
{
  // Truncated inside the characters array — the WHOLE point of the salvage path.
  const truncated = 'Sure! <arc>{"synopsis":"so far","characters":[{"name":"Scarlet","intro_block":2,"current_state":"furious"';
  const arc = extractArc(truncated);
  ok('extractArc RECOVERS a truncated array-of-objects (was null before fix)', !!arc);
  if (arc) {
    eq('  recovered synopsis', arc.synopsis, 'so far');
    eq('  recovered character', arc.characters[0]?.name, 'Scarlet');
    eq('  recovered intro_block', arc.characters[0]?.intro_block, 2);
  }
}
{
  // Fenced JSON with no <arc> wrapper, also truncated.
  const arc = extractArc('```json\n{"synopsis":"x","themes":["beans","resignation"');
  ok('extractArc recovers fenced + truncated', !!arc);
  if (arc) eq('  themes recovered', arc.themes, ['beans', 'resignation']);
}
eq('extractArc(null) → null', extractArc(null), null);
eq('extractArc("") → null', extractArc(''), null);
ok('extractArc(garbage) → null', extractArc('no json here at all') === null);

// ---- normalizeArc: coercion + clamping (locks the consumer of the parsed obj) ----
{
  const n = normalizeArc({
    synopsis: '  trimmed  ',
    characters: Array.from({ length: 14 }, (_, i) => ({ name: `C${i}`, intro_block: '3', current_state: 's' })),
    threads: [{ description: 'd', status: 'weird', opened_at_block: 'x' }, { description: '' }],
    themes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    tones: ['t1', 't2', 't3', 't4', 't5'],
    confidence: 5,
  });
  eq('  synopsis trimmed', n.synopsis, 'trimmed');
  eq('  characters capped at 10', n.characters.length, 10);
  eq('  intro_block coerced to number', n.characters[0].intro_block, 3);
  eq('  unknown status → open', n.threads[0].status, 'open');
  eq('  non-numeric opened_at_block → null', n.threads[0].opened_at_block, null);
  eq('  empty-description thread dropped', n.threads.length, 1);
  eq('  themes capped at 6', n.themes.length, 6);
  eq('  tones capped at 4', n.tones.length, 4);
  eq('  confidence clamped to 1', n.confidence, 1);
}
{
  // Empty themes are filtered AFTER the slice(0,6) cap, so an empty in the
  // first six legitimately reduces the surfaced count (documents the quirk).
  const n = normalizeArc({ themes: ['a', '', 'b', 'c', 'd', 'e', 'f'] });
  eq('  empty theme in first six filtered (5, not 6)', n.themes.length, 5);
  ok('  no empty themes survive', n.themes.every(Boolean));
}
{
  const n = normalizeArc({ confidence: -2, characters: 'nope', threads: null });
  eq('  confidence clamped to 0', n.confidence, 0);
  eq('  non-array characters → []', n.characters, []);
  eq('  null threads → []', n.threads, []);
}
eq('normalizeArc(null) is safe', normalizeArc(null).synopsis, '');

// ---- report ----
console.log(`\nqss-arc-extract: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n  - ' + fails.join('\n  - ')); process.exit(1); }
